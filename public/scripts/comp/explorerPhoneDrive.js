/**
 * The Android phone as a drive in Cartograph (Yozora #698), over the DSApp app's storage bridge
 * (phoneStorageBridge.js, window.phoneStorage). Only inside the app: with no bridge every hook
 * answers "not mine" and nothing shows.
 *
 * Places (Explorer's currentPath strings, beside the VFS's "/..." and "Computer"):
 *   phone://                      the phone's drives (one per root) or its state (sharing off ...)
 *   phone://<root>/<path>         a folder on a root ("/" is the root itself)
 *   phone-trash://                Android's trash (trashList), with Restore
 *
 * Items (as vfsManager lists them, so the grid, details pane and sorting work unchanged):
 *   { id: 'phone:<root>:<path>', name, kind: 'folder' | 'file', targetKind: 'phone-entry',
 *     navPath (folders), size, modifiedAt (seconds), mimeType, icon, previewUrl (?thumb=256),
 *     phone: { root, path, dir, hidden, writable, count, mime } }
 *   Trash rows: targetKind 'phone-trash', phoneTrash: { id, ... }.
 *
 * The applet (explorerApplet.js) calls in where it branches for archives: list, open, the context
 * menus and their 'explorer-phone-' actions, rename / new folder / delete, deliver (paste and drops,
 * phone <-> VFS too), uploads of desktop files, downloads. Transfers run under the Vista progress
 * dialog (fileOperationProgress.js) with Cancel and a Replace / Keep both / Skip prompt.
 */
(function (root) {
    'use strict';

    const PREFIX = 'phone://';
    const TRASH = 'phone-trash://';
    const ART = '/static_images/vista-explorer';
    const HIDDEN_KEY = 'explorerPhoneShowHidden';
    const THUMB = 256;
    const ACTION = 'explorer-phone-';

    const PS = () => root.phoneStorage || null;
    // vfsClient.js / vfsImportRouter.js declare top-level consts (not window properties)
    const VFS = () => (typeof vfsClient !== 'undefined' ? vfsClient : root.vfsClient);
    const IMPORT = () => (typeof vfsImportRouter !== 'undefined' ? vfsImportRouter : root.vfsImportRouter);
    const available = () => !!(PS() && PS().available);

    const apps = new Set();
    let bound = false;

    function esc(text) {
        return String(text == null ? '' : text)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /** showConfirmationDialog renders a message with tags as HTML: always escaped, lines kept. */
    function confirmDialog(text, options) {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        return root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`, options);
    }

    function toast(type, message) {
        if (typeof root.showGlassToast === 'function') root.showGlassToast(type, 'Phone', message, false, type === 'error' ? 6000 : 4000);
    }

    function errText(err) {
        if (!err) return 'Something went wrong on the phone';
        return err.message || err.code || String(err);
    }

    // ---- places ----------------------------------------------------------------------------

    function isPath(path) {
        return available() && typeof path === 'string' && (path.startsWith(PREFIX) || path === TRASH);
    }

    function isTrashPath(path) {
        return path === TRASH;
    }

    /** phone://internal/DCIM/Camera -> { root: 'internal', path: '/DCIM/Camera' }; phone:// -> { root: null } */
    function parse(path) {
        if (!String(path || '').startsWith(PREFIX)) return { root: null, path: '/' };
        const rest = path.slice(PREFIX.length);
        if (!rest) return { root: null, path: '/' };
        const slash = rest.indexOf('/');
        const rootId = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
        const inner = slash < 0 ? '/' : (rest.slice(slash).replace(/\/+$/, '') || '/');
        return { root: rootId, path: inner };
    }

    function pathFor(rootId, path) {
        if (!rootId) return PREFIX;
        const inner = !path || path === '/' ? '' : path.replace(/\/+$/, '');
        return `${PREFIX}${encodeURIComponent(rootId)}${inner}`;
    }

    function normalize(path) {
        if (path === TRASH) return TRASH;
        const p = parse(path);
        return pathFor(p.root, p.path);
    }

    function isEntry(item) {
        return !!(item && (item.targetKind === 'phone-entry' || item.targetKind === 'phone-trash' || item.targetKind === 'phone-drive'));
    }

    function isEntryRef(ref) {
        return !!(ref && ref.phone && ref.phone.root);
    }

    // ---- state -----------------------------------------------------------------------------

    function state() {
        return PS() ? PS().state() : null;
    }

    function rootsOf(st) {
        return st && Array.isArray(st.roots) ? st.roots : [];
    }

    function rootInfo(rootId) {
        return rootsOf(state()).find((r) => r.id === rootId) || null;
    }

    /** What the drive shows instead of its roots: null when browsable. */
    function blocker(st) {
        if (!st) return { kind: 'loading', text: 'Connecting to the phone…' };
        if (!st.enabled) return { kind: 'disabled', text: 'Turn on in app settings', action: 'settings' };
        if (!st.access) return { kind: 'no_access', text: 'Allow access', action: 'access' };
        if (st.locked) return { kind: 'locked', text: 'Unlock the app to browse the phone' };
        if (!rootsOf(st).length) return { kind: 'no_root', text: 'No storage to show' };
        return null;
    }

    async function ensureState() {
        if (!available()) return null;
        try { return await PS().hello(); } catch (_err) { return state(); }
    }

    function shownHidden() {
        try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch (_err) { return false; }
    }

    function setShowHidden(on) {
        try { localStorage.setItem(HIDDEN_KEY, on ? '1' : '0'); } catch (_err) { /* storage blocked */ }
    }

    // ---- items -----------------------------------------------------------------------------

    function seconds(mtime) {
        const n = Number(mtime) || 0;
        return n > 1e12 ? Math.floor(n / 1000) : n;
    }

    function faIcon(entry) {
        if (entry.dir) return 'fas fa-folder';
        const mime = String(entry.mime || '');
        const ext = String(entry.name || '').split('.').pop().toLowerCase();
        if (mime.startsWith('image/')) return 'fas fa-file-image';
        if (mime.startsWith('video/')) return 'fas fa-file-video';
        if (mime.startsWith('audio/')) return 'fas fa-file-audio';
        if (mime === 'application/pdf') return 'fas fa-file-pdf';
        if (mime.startsWith('text/') || mime === 'application/json') return 'fas fa-file-lines';
        if (/^(zip|7z|rar|tar|gz)$/.test(ext)) return 'fas fa-file-zipper';
        if (ext === 'apk') return 'fab fa-android';
        return 'fas fa-file';
    }

    function entryToItem(rootId, entry) {
        const dir = !!entry.dir;
        const item = {
            id: `phone:${rootId}:${entry.path}`,
            name: entry.name,
            kind: dir ? 'folder' : 'file',
            targetKind: 'phone-entry',
            mimeType: entry.mime || '',
            icon: faIcon(entry),
            modifiedAt: seconds(entry.mtime),
            phone: {
                root: rootId,
                path: entry.path,
                dir,
                hidden: !!entry.hidden,
                writable: entry.writable !== false,
                count: entry.count,
                mime: entry.mime || ''
            }
        };
        if (dir) {
            item.navPath = pathFor(rootId, entry.path);
        } else {
            item.size = Number(entry.size) || 0;
            if (entry.thumb) item.previewUrl = PS().fileUrl(rootId, entry.path, { thumb: THUMB });
        }
        return item;
    }

    function driveItem(r) {
        return {
            id: `phone-drive:${r.id}`,
            name: rootName(r.id),
            kind: 'folder',
            targetKind: 'phone-drive',
            navPath: pathFor(r.id, '/'),
            // Vista's removable disk (imageres.dll 29) as the item's picture in every view
            icon: 'fas fa-hard-drive',
            previewUrl: `${ART}/drive-removable-48.png`,
            size: undefined,
            phone: { root: r.id, path: '/', dir: true, drive: r }
        };
    }

    /** Sharing off / no access / locked as one item in the view (opens its fix, as the nav link does). */
    function stateItem(block) {
        return {
            id: `phone-state:${block.kind}`,
            name: block.text,
            kind: 'file',
            targetKind: 'phone-drive',
            icon: 'fas fa-mobile-screen',
            phone: { root: null, path: '/', dir: false, action: block.action || null }
        };
    }

    function typeKey(item) {
        if (item.kind === 'folder') return '';
        const ext = String(item.name || '').includes('.') ? String(item.name).split('.').pop().toLowerCase() : '';
        return `${item.mimeType || ''}|${ext}`;
    }

    function sortItems(items, field, direction) {
        const dir = direction === 'desc' ? -1 : 1;
        const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
        const cmp = {
            name: byName,
            date: (a, b) => (a.modifiedAt || 0) - (b.modifiedAt || 0) || byName(a, b),
            size: (a, b) => (a.size || 0) - (b.size || 0) || byName(a, b),
            type: (a, b) => typeKey(a).localeCompare(typeKey(b)) || byName(a, b)
        }[field] || byName;
        return items.slice().sort((a, b) => {
            const fa = a.kind === 'folder' ? 0 : 1;
            const fb = b.kind === 'folder' ? 0 : 1;
            if (fa !== fb) return fa - fb;
            return cmp(a, b) * dir;
        });
    }

    // ---- watching the open folder ----------------------------------------------------------

    function watchFor(app, rootId, path) {
        const key = rootId ? `${rootId}\n${path}` : '';
        if (app._phoneWatchKey === key) return;
        leave(app);
        app._phoneWatchKey = key;
        if (rootId) void PS().watch(rootId, path);
    }

    /** Explorer left the phone folder (another place, closed): stop watching it. */
    function leave(app) {
        if (!app || !app._phoneWatchKey) return;
        const [rootId, path] = app._phoneWatchKey.split('\n');
        app._phoneWatchKey = '';
        if (available()) void PS().unwatch(rootId, path);
    }

    function bind() {
        if (bound || !available()) return;
        bound = true;
        PS().on('changed', (m) => {
            if (documents.size) void checkDocuments(m.root, m.path || '/');
            apps.forEach((app) => {
                if (!isPath(app.currentPath)) return;
                const here = parse(app.currentPath);
                if (here.root === m.root && here.path === (m.path || '/')) void app.softRefresh();
            });
        });
        PS().on('config', () => {
            apps.forEach((app) => {
                renderNav(app);
                if (app.computer && typeof app._isComputerPath === 'function' && app._isComputerPath()) app.computer.render();
                if (isPath(app.currentPath)) void app.softRefresh();
            });
        });
        PS().on('state', () => apps.forEach((app) => renderNav(app)));
    }

    function attach(app) {
        if (!available() || !app) return;
        apps.add(app);
        bind();
        void ensureState().then(() => renderNav(app));
    }

    // ---- listing ---------------------------------------------------------------------------

    /** The applet's listing for a phone place: { path, items, totalCount, hasMore, emptyMessage }. */
    async function list(app, path) {
        attach(app);
        const st = await ensureState();
        const out = (items, emptyMessage) => ({ path, items, totalCount: items.length, totalSizeBytes: items.reduce((n, i) => n + (i.size || 0), 0), hasMore: false, emptyMessage: emptyMessage || null });
        const block = blocker(st);
        if (path === TRASH) {
            watchFor(app, null);
            if (block) return out([stateItem(block)], block.text);
            const rows = await PS().call('trashList');
            const items = (rows || []).map((t) => ({
                id: `phone-trash:${t.id}`,
                name: t.name,
                kind: 'file',
                targetKind: 'phone-trash',
                mimeType: t.mime || '',
                icon: faIcon({ name: t.name, mime: t.mime }),
                size: Number(t.size) || 0,
                modifiedAt: seconds(t.expires),
                phoneTrash: t
            }));
            return out(sortItems(items, app.sortField, app.sortDirection), 'Phone trash is empty.');
        }
        const p = parse(path);
        if (!p.root) {
            watchFor(app, null);
            if (block) return out([stateItem(block)], block.text);
            return out(rootsOf(st).map(driveItem));
        }
        if (block) {
            watchFor(app, null);
            return out([stateItem(block)], block.text);
        }
        const result = await PS().call('list', { root: p.root, path: p.path });
        watchFor(app, p.root, p.path);
        // a caller with its own hidden-files switch (Melaton Mobile's Show All Files) passes it as app.showHidden
        const hidden = typeof app.showHidden === 'boolean' ? app.showHidden : shownHidden();
        const items = (result.entries || []).filter((e) => hidden || !e.hidden).map((e) => entryToItem(p.root, e));
        return out(sortItems(items, app.sortField, app.sortDirection), 'This folder is empty.');
    }

    // ---- labels, breadcrumb ----------------------------------------------------------------

    function phoneName() {
        return 'Phone';
    }

    /** Drive letters after Cartograph's C:, in the phone's root order: D: internal storage, E: a USB drive... */
    function driveLetter(rootId) {
        const i = rootsOf(state()).findIndex((r) => r.id === rootId);
        return i < 0 ? '' : String.fromCharCode(Math.min(90, 68 + i));
    }

    /** "Internal storage (D:)", as Vista names a removable disk. */
    function rootName(rootId) {
        const r = rootInfo(rootId);
        const name = r ? (r.name || r.id) : rootId;
        const letter = driveLetter(rootId);
        return letter ? `${name} (${letter}:)` : name;
    }

    function displayName(path) {
        if (path === TRASH) return 'Phone trash';
        const p = parse(path);
        if (!p.root) return phoneName();
        if (p.path === '/') return rootName(p.root);
        return p.path.split('/').filter(Boolean).pop();
    }

    /** The address box, as Vista shows a removable disk: D:\DCIM\Camera */
    function displayPath(path) {
        if (path === TRASH) return `${phoneName()}/Phone trash`;
        const p = parse(path);
        if (!p.root) return phoneName();
        const letter = driveLetter(p.root);
        if (!letter) return `${phoneName()}/${rootName(p.root)}${p.path === '/' ? '' : p.path}`;
        return `${letter}:\\${p.path.split('/').filter(Boolean).join('\\')}`;
    }

    /** Computer ▸ Internal storage (D:) ▸ DCIM ▸ Camera: a drive sits right under Computer. */
    function crumbs(path) {
        if (path === TRASH || !parse(path).root) {
            const list = [{ label: phoneName(), path: PREFIX }];
            if (path === TRASH) list.push({ label: 'Phone trash', path: TRASH });
            return list;
        }
        const list = [];
        const p = parse(path);
        list.push({ label: rootName(p.root), path: pathFor(p.root, '/') });
        const parts = p.path.split('/').filter(Boolean);
        parts.forEach((part, i) => list.push({ label: part, path: pathFor(p.root, '/' + parts.slice(0, i + 1).join('/')) }));
        return list;
    }

    function crumbIcon(path) {
        const p = parse(path);
        if (path === TRASH) return 'fav-recycle.png';
        if (!p.root || p.path === '/') return 'drive-removable-16.png';
        return 'crumb-folder.png';
    }

    /** Typed into the address box: phone://..., "Phone", "Phone/<drive name>/<folders>", or null. */
    function resolveInput(text) {
        if (!available()) return null;
        const input = String(text || '').trim();
        if (input.startsWith(PREFIX) || input === TRASH) return normalize(input);
        const drive = /^([d-z]):(?:[\\/](.*))?$/i.exec(input);
        if (drive) {
            const r = rootsOf(state()).find((x) => driveLetter(x.id) === drive[1].toUpperCase());
            return r ? pathFor(r.id, '/' + String(drive[2] || '').split(/[\\/]+/).filter(Boolean).join('/')) : null;
        }
        const parts = input.split('/').filter(Boolean);
        if (!parts.length || parts[0].toLowerCase() !== phoneName().toLowerCase()) return null;
        if (parts.length === 1) return PREFIX;
        if (parts[1].toLowerCase() === 'phone trash') return TRASH;
        const want = parts[1].toLowerCase();
        const r = rootsOf(state()).find((x) => rootName(x.id).toLowerCase() === want || (x.name || x.id).toLowerCase() === want || x.id === parts[1]);
        if (!r) return null;
        return pathFor(r.id, '/' + parts.slice(2).join('/'));
    }

    function parentOf(path) {
        if (path === TRASH) return PREFIX;
        const p = parse(path);
        // up from a drive (or the drive list) is Computer
        if (!p.root || p.path === '/') return null;
        return pathFor(p.root, PS().parentPath(p.path));
    }

    function isWritable(path) {
        if (!isPath(path) || path === TRASH) return false;
        const p = parse(path);
        return !!p.root && !blocker(state());
    }

    // ---- open, preview -----------------------------------------------------------------------

    async function open(app, item, chooser) {
        if (item.phone && !item.phone.root && item.id.startsWith('phone-state:')) {
            if (item.phone.action) await handleAction(`${ACTION}${item.phone.action === 'settings' ? 'settings' : 'access'}`, null, app);
            return;
        }
        if (item.targetKind === 'phone-drive' || (item.phone && item.phone.dir)) {
            app.navigateTo(item.navPath);
            return;
        }
        if (item.targetKind === 'phone-trash') {
            await restore(app, [item]);
            return;
        }
        if (chooser === 'android') {
            try {
                await PS().call('open', { root: item.phone.root, path: item.phone.path, chooser: true });
            } catch (err) {
                toast('error', errText(err));
            }
            return;
        }
        if (chooser) {
            await openWith(app, item);
            return;
        }
        await openInApp(app, item, programFor(item.name, item.mimeType));
    }

    // ---- phone files in Dreamscape's own apps ----------------------------------------------------

    // Default Programs (cplPages.js PROGRAMS, HKCU\...\Explorer\FileExts): the same associations
    // a VFS file follows. A phone file is a source, never copied into the VFS first:
    //   { kind: 'phone', root, path, name, size, mime, mtime }
    // read from its file URL (rebuilt from hello() each launch, never stored), saved back with
    // writeBegin / chunks / writeEnd (phoneStorage.write).
    const ASSOC = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Explorer\\FileExts';
    const PROGRAMS = {
        lumen: { name: 'Lumen', icon: '/static_images/app_icons/32/vista-photo-viewer.webp' },
        'media-player': { name: 'Melaton Media Player', icon: '/static_images/app_icons/32/media_player.webp' },
        notepad: { name: 'Notepad', icon: '/static_images/app_icons/32/vista-notepad.webp' },
        paint: { name: 'Paint', icon: '/static_images/app_icons/32/vista-paint.webp' },
        viewer: { name: 'Document Viewer', icon: '/static_images/app_icons/32/vista-explorer.webp' }
    };
    const TEXT_EXT = /\.(txt|log|ini|inf|cfg|conf|json|md|csv|tsv|xml|html?|css|js|ts|py|sh|bat|cmd|yml|yaml|srt|nfo)$/i;

    function extOf(name) {
        const m = String(name || '').match(/\.[a-z0-9]+$/i);
        return m ? m[0].toLowerCase() : '';
    }

    /** What a file is, for the default program: image | media | text | pdf | other. */
    function kindOf(name, mime) {
        const type = String(mime || '').toLowerCase();
        if (type.startsWith('image/')) return 'image';
        if (type.startsWith('audio/') || type.startsWith('video/')) return 'media';
        if (type === 'application/pdf' || extOf(name) === '.pdf') return 'pdf';
        if (type.startsWith('text/') || /json|xml|javascript/.test(type) || TEXT_EXT.test(name || '')) return 'text';
        if (/^\.(jpe?g|png|gif|webp|bmp|heic|avif)$/.test(extOf(name))) return 'image';
        if (/^\.(mp4|webm|mkv|mov|3gp|mp3|m4a|aac|ogg|opus|wav|flac)$/.test(extOf(name))) return 'media';
        return 'other';
    }

    /** The program for a file: the user's association (Default Programs) or the type's default. */
    function programFor(name, mime) {
        const reg = root.melatonRegistry;
        const assoc = reg ? reg.get(ASSOC, extOf(name), '') : '';
        if (assoc && PROGRAMS[assoc]) return assoc;
        return { image: 'lumen', media: 'media-player', text: 'notepad', pdf: 'viewer' }[kindOf(name, mime)] || null;
    }

    function sourceOf(item) {
        return { kind: 'phone', root: item.phone.root, path: item.phone.path, name: item.name, size: item.size || 0, mime: item.mimeType || item.phone.mime || '', mtime: item.modifiedAt || 0 };
    }

    /** "Phone › Internal storage/DCIM/Camera/a.jpg" for titles and Recent Items. */
    function sourceLabel(src) {
        return `${phoneName()} \u203a ${rootName(src.root)}${src.path}`;
    }

    function sourceUrl(src) {
        return PS().fileUrl(src.root, src.path);
    }

    /** Recent Items keeps { root, path } only (the file URL's token changes every launch). */
    function noteRecent(src) {
        const ri = root.recentItems;
        if (!ri || typeof ri.add !== 'function') return;
        ri.add({
            kind: 'phone',
            key: `${src.root}:${src.path}`,
            title: src.name,
            sub: `${phoneName()} \u203a ${rootName(src.root)}${PS().parentPath(src.path) === '/' ? '' : PS().parentPath(src.path)}`,
            data: { root: src.root, path: src.path, name: src.name, mime: src.mime }
        });
    }

    /** A Recent Items entry again: stat it (the drive may be gone or sharing off), then its program. */
    async function openRecent(data) {
        const st = await ensureState();
        if (!data || !data.root || blocker(st) || !rootInfo(data.root)) {
            toast('error', "Phone storage isn't available");
            return false;
        }
        let entry;
        try {
            entry = await PS().call('stat', { root: data.root, path: data.path });
        } catch (err) {
            toast('error', err && err.code === 'not_found' ? `${data.name || 'The file'} is no longer on the phone` : "Phone storage isn't available");
            return false;
        }
        const item = entryToItem(data.root, entry);
        await openInApp(null, item, programFor(item.name, item.mimeType));
        return true;
    }

    /** The folder's pictures for Lumen's Previous / Next (the window's list when it shows that folder). */
    async function siblingPictures(app, src) {
        const dir = PS().parentPath(src.path);
        let items = app && isPath(app.currentPath) && parse(app.currentPath).root === src.root && parse(app.currentPath).path === dir
            ? (app.items || [])
            : null;
        if (!items) {
            try {
                const res = await PS().call('list', { root: src.root, path: dir });
                items = (res.entries || []).filter((e) => shownHidden() || !e.hidden).map((e) => entryToItem(src.root, e));
                items = sortItems(items, app ? app.sortField : 'name', app ? app.sortDirection : 'asc');
            } catch (_err) {
                items = [];
            }
        }
        const rows = [];
        items.filter((i) => i.phone && !i.phone.dir && kindOf(i.name, i.mimeType) === 'image').forEach((i) => {
            const s = sourceOf(i);
            rows.push({ url: sourceUrl(s), base: sourceLabel(s), title: i.name, phoneSource: s, siblings: rows });
        });
        return rows;
    }

    async function openInApp(app, item, program) {
        const src = sourceOf(item);
        const url = sourceUrl(src);
        const label = sourceLabel(src);
        try {
            switch (program) {
                case 'lumen': {
                    const rows = await siblingPictures(app, src);
                    let row = rows.find((r) => r.phoneSource.path === src.path);
                    if (!row) {
                        row = { url, base: label, title: item.name, phoneSource: src, siblings: rows };
                        rows.push(row);
                    }
                    // openImageInViewer: public/scripts/comp/imageViewer.js (Lumen); the row carries
                    // the folder's pictures for Previous / Next (metadata.siblings)
                    root.openImageInViewer(url, label, row);
                    break;
                }
                case 'media-player':
                    await root.featureLoader.loadFeature('media_player');
                    // openDesktopMediaPlayerUrl: public/scripts/comp/desktop-apps/mediaPlayer.js
                    root.openDesktopMediaPlayerUrl(url, item.name);
                    break;
                case 'notepad':
                    if (typeof root.loadNotepadManager === 'function') await root.loadNotepadManager();
                    else if (root.featureLoader) await root.featureLoader.loadFeature('notepad');
                    if (!root.notepadVista || typeof root.notepadVista.openPhoneFile !== 'function') throw { code: 'no_app', message: 'Notepad is not available' };
                    await root.notepadVista.openPhoneFile(src, label);
                    break;
                case 'paint':
                    await root.featureLoader.loadFeature('paint');
                    if (root.openMelatonPaint) root.openMelatonPaint({ image: url, name: item.name });
                    break;
                case 'viewer':
                    openDocumentViewer(src, label);
                    break;
                default:
                    await openWith(app, item);
                    return;
            }
            noteRecent(src);
        } catch (err) {
            showError(err);
        }
    }

    /** Open With: Dreamscape's programs, the type's own first; Android's app is the last choice. */
    async function openWith(app, item) {
        if (typeof root.showConfirmationDialog !== 'function') return;
        const kind = kindOf(item.name, item.mimeType);
        const fits = { image: ['lumen', 'paint'], media: ['media-player'], text: ['notepad'], pdf: ['viewer'], other: ['notepad', 'viewer'] }[kind];
        const order = [...new Set([programFor(item.name, item.mimeType), ...fits].filter(Boolean))];
        const options = order.map((id, i) => ({ text: PROGRAMS[id].name, value: id, className: i === 0 ? 'btn-primary' : 'btn-secondary' }));
        options.push({ text: 'Android app…', value: 'android', className: 'btn-secondary' });
        options.push({ text: 'Cancel', value: null, className: 'btn-secondary' });
        const intro = programFor(item.name, item.mimeType) ? 'Choose the program you want to use to open this file:' : 'Dreamscape has no program set for this type of file. Choose one to open it with:';
        const choice = await confirmDialog(`${intro}\n\n${item.name}`, options);
        if (!choice) return;
        if (choice === 'android') await open(app, item, 'android');
        else await openInApp(app, item, choice);
    }

    /** PDFs (and anything a frame shows) in a Vista window of their own, read from the file URL. */
    function openDocumentViewer(src, label) {
        const key = `${src.root}:${src.path}`;
        const id = `phoneDocViewer_${key.replace(/[^A-Za-z0-9_-]/g, '_')}`.slice(0, 120);
        const existing = document.getElementById(id);
        if (existing) {
            if (typeof root.bringModalToFront === 'function') root.bringModalToFront(existing);
            return;
        }
        const modal = document.createElement('div');
        modal.id = id;
        modal.className = 'modal resizeable-window explorer-phone-doc-window hidden';
        modal.dataset.windowClient = 'light';
        modal.dataset.windowIdentifier = 'phoneDocViewer';
        modal.dataset.windowDefaultWidth = '720';
        modal.dataset.windowDefaultHeight = '640';
        modal.dataset.windowMinWidth = '320';
        modal.dataset.windowMinHeight = '240';
        // a child of Cartograph: its icon (window icon policy) and Dovecote's caption / controls markup
        modal.dataset.iconOwnerId = 'explorerModal';
        const isPdf = kindOf(src.name, src.mime) === 'pdf';
        modal.innerHTML = `<div class="modal-window-title"><div class="modal-window-title-main"><i class="${isPdf ? 'fas fa-file-pdf' : 'fas fa-file-lines'} icon-fa" aria-hidden="true"></i><span>${esc(`${src.name} - Document Viewer`)}</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize" aria-label="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small" title="Close" aria-label="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content win7 explorer-phone-doc-client" title="${esc(label)}">${isPdf
                ? '<div class="explorer-phone-pdf" tabindex="0"><div class="explorer-phone-pdf-status">Opening…</div></div>'
                : `<iframe class="explorer-phone-doc-frame" src="${esc(sourceUrl(src))}" title="${esc(label)}"></iframe>`}
            </div>`;
        document.body.appendChild(modal);
        const close = modal.querySelector('.close-btn');
        if (close) {
            close.addEventListener('click', () => {
                // closeModal: public/scripts/comp/modalUtils.js
                const closing = typeof root.closeModal === 'function' ? root.closeModal(modal) : null;
                Promise.resolve(closing).then(() => modal.remove());
            });
        }
        if (typeof root.openModal === 'function') root.openModal(modal);
        else modal.classList.remove('hidden');
        const pdfHost = modal.querySelector('.explorer-phone-pdf');
        if (pdfHost) void renderPdf(pdfHost, sourceUrl(src), modal);
    }

    // pdf.js (public/dist/pdfjs, pdfjs-dist 5.7.284): Android WebView has no PDF viewer of its own,
    // so pages are drawn into canvases, each when it scrolls into view. The file URL serves byte
    // ranges, so a large PDF is read as its pages are needed.
    const PDFJS = '/dist/pdfjs';
    let pdfjsPromise = null;

    function loadPdfJs() {
        if (!pdfjsPromise) {
            pdfjsPromise = import(`${PDFJS}/pdf.min.mjs`).then((lib) => {
                lib.GlobalWorkerOptions.workerSrc = `${PDFJS}/pdf.worker.min.mjs`;
                return lib;
            }, (err) => {
                pdfjsPromise = null;
                throw err;
            });
        }
        return pdfjsPromise;
    }

    async function renderPdf(host, url, modal) {
        const status = host.querySelector('.explorer-phone-pdf-status');
        let pdf;
        try {
            const lib = await loadPdfJs();
            pdf = await lib.getDocument({
                url,
                cMapUrl: `${PDFJS}/cmaps/`,
                cMapPacked: true,
                standardFontDataUrl: `${PDFJS}/standard_fonts/`
            }).promise;
        } catch (err) {
            if (status) status.textContent = `This PDF could not be opened. ${(err && err.message) || ''}`;
            return;
        }
        if (status) status.remove();
        const dpr = Math.min(2, root.devicePixelRatio || 1);
        const pages = [];
        for (let n = 1; n <= pdf.numPages; n += 1) {
            const box = document.createElement('div');
            box.className = 'explorer-phone-pdf-page';
            box.dataset.page = String(n);
            host.appendChild(box);
            pages.push(box);
        }
        const width = () => Math.max(200, host.clientWidth - 24);
        // every page sized from the first one until it is drawn (most PDFs keep one page size)
        try {
            const first = await pdf.getPage(1);
            const vp = first.getViewport({ scale: 1 });
            pages.forEach((box) => { box.style.aspectRatio = `${vp.width} / ${vp.height}`; });
        } catch (_err) { /* sized when drawn */ }
        const draw = async (box) => {
            if (box.dataset.drawn) return;
            box.dataset.drawn = '1';
            try {
                const page = await pdf.getPage(Number(box.dataset.page));
                const base = page.getViewport({ scale: 1 });
                const vp = page.getViewport({ scale: (width() / base.width) * dpr });
                const canvas = document.createElement('canvas');
                canvas.width = Math.floor(vp.width);
                canvas.height = Math.floor(vp.height);
                box.style.aspectRatio = `${base.width} / ${base.height}`;
                box.appendChild(canvas);
                await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
            } catch (_err) {
                box.dataset.drawn = '';
            }
        };
        if (typeof IntersectionObserver === 'function') {
            const io = new IntersectionObserver((entries) => {
                entries.forEach((e) => { if (e.isIntersecting) void draw(e.target); });
            }, { root: host, rootMargin: '400px 0px' });
            pages.forEach((box) => io.observe(box));
            // closed: let pdf.js and the observer go
            const gone = new MutationObserver(() => {
                if (modal.isConnected) return;
                gone.disconnect();
                io.disconnect();
                void pdf.destroy();
            });
            gone.observe(document.body, { childList: true });
        } else {
            for (const box of pages) await draw(box);
        }
    }

    // ---- NovelAI images: their blueprint into Studio, Properties --------------------------------

    // A PNG off the phone may carry NovelAI's metadata (tEXt / iTXt Comment, zTXt, or stealth alpha):
    // reference/pngMetadata.js extractPNGMetadata reads all three, as an upload's blueprint check does.
    const naiCache = new Map(); // "<id>|<mtime>|<size>" -> Promise of the metadata or null
    const naiKnown = new Map(); // same key -> true / false once read

    function naiKey(item) {
        return `${item.id}|${item.modifiedAt || 0}|${item.size || 0}`;
    }

    function naiCandidate(item) {
        return !!(item && item.phone && !item.phone.dir && item.targetKind === 'phone-entry'
            && (/\.png$/i.test(item.name || '') || String(item.mimeType || '').toLowerCase() === 'image/png'));
    }

    /** The image's NovelAI metadata, or null (not a NovelAI image, or unreadable). */
    function readNai(item) {
        if (!naiCandidate(item) || typeof root.extractPNGMetadata !== 'function') return Promise.resolve(null);
        const key = naiKey(item);
        if (naiCache.has(key)) return naiCache.get(key);
        const job = (async () => {
            const res = await fetch(fileUrl(item));
            if (!res.ok) return null;
            const blob = await res.blob();
            const md = await root.extractPNGMetadata(new File([blob], item.name, { type: 'image/png' }));
            const nai = md && ((md.source && String(md.source).includes('NovelAI')) || (md.prompt !== undefined && (md.steps !== undefined || md.forge_data)));
            return nai ? md : null;
        })().catch(() => null).then((md) => {
            naiKnown.set(key, !!md);
            return md;
        });
        naiCache.set(key, job);
        return job;
    }

    function naiKnownFor(item) {
        return naiKnown.get(naiKey(item));
    }

    /** Studio with the image's settings, as the upload dialog's Open in Studio loads a blueprint. */
    async function openInStudio(item) {
        const md = await readNai(item);
        if (!md) {
            toast('info', `${item.name} has no NovelAI settings to load`);
            return;
        }
        // transformMetadataForEditor: public/scripts/comp/referenceManager.js
        const data = typeof root.transformMetadataForEditor === 'function' ? root.transformMetadataForEditor(md) : md;
        // openManualModalWithContent: public/scripts/comp/manualModalManager.js
        await root.openManualModalWithContent({ type: 'metadata', data, title: item.name });
    }

    /** The image's Properties (imagePromptInspector.js) from the metadata read here: no gallery lookup. */
    async function openProperties(item) {
        const md = await readNai(item);
        if (!md) {
            toast('info', `${item.name} has no NovelAI settings to show`);
            return;
        }
        await root.featureLoader.loadFeature('image_prompt_inspector');
        // keyed by the phone file (an id, never a gallery filename, so nothing asks the server)
        root.openImagePromptInspector({ ...md, id: item.id, title: item.name, image_url: fileUrl(item) });
    }

    // ---- open documents follow the phone (an editor's file changed or deleted there) -----------

    const documents = new Set(); // { src, onChange(kind, entry) , alive() }

    /** An app showing a phone file (Notepad): told when it changes ('changed') or goes ('deleted'). */
    function trackDocument(src, onChange, alive) {
        const doc = { src, onChange, alive: alive || (() => true) };
        documents.add(doc);
        void PS().watch(src.root, PS().parentPath(src.path));
        bind();
        return () => {
            if (!documents.delete(doc)) return;
            void PS().unwatch(src.root, PS().parentPath(src.path));
        };
    }

    async function checkDocuments(rootId, dir) {
        for (const doc of [...documents]) {
            if (!doc.alive()) {
                documents.delete(doc);
                void PS().unwatch(doc.src.root, PS().parentPath(doc.src.path));
                continue;
            }
            if (doc.src.root !== rootId || PS().parentPath(doc.src.path) !== (dir || '/')) continue;
            try {
                const entry = await PS().call('stat', { root: doc.src.root, path: doc.src.path });
                const mtime = seconds(entry.mtime);
                if (mtime && doc.src.mtime && mtime !== doc.src.mtime) {
                    doc.src.mtime = mtime;
                    doc.src.size = entry.size;
                    doc.onChange('changed', entry);
                }
            } catch (err) {
                if (err && err.code === 'not_found') doc.onChange('deleted', null);
            }
        }
    }

    /** An editor's Save: the text back into the same file (Replace), the source's mtime updated. */
    async function writeText(src, text, mime) {
        const blob = new Blob([text], { type: mime || 'text/plain' });
        const entry = await PS().write(src.root, PS().parentPath(src.path), blob, { name: src.name, conflict: 'replace' });
        if (entry) {
            src.mtime = seconds(entry.mtime) || src.mtime;
            src.size = entry.size != null ? entry.size : blob.size;
        }
        return entry;
    }

    function fileUrl(item, opts) {
        return item && item.phone ? PS().fileUrl(item.phone.root, item.phone.path, opts) : '';
    }

    function previewKind(item) {
        const mime = String(item.mimeType || '');
        const ext = String(item.name || '').split('.').pop().toLowerCase();
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        if (mime.startsWith('audio/')) return 'audio';
        if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
        if (mime.startsWith('text/') || /^(txt|log|md|json|csv|xml|ini|cfg)$/.test(ext)) return 'text';
        return 'other';
    }

    /** Its own pane beside Contacts' #explorerPreviewPane (same place and look), so neither
        redraws over the other. */
    function previewPane() {
        let pane = document.getElementById('explorerPhonePreviewPane');
        if (pane) return pane;
        const contacts = document.getElementById('explorerPreviewPane');
        if (!contacts || !contacts.parentNode) return null;
        pane = document.createElement('div');
        pane.id = 'explorerPhonePreviewPane';
        pane.className = 'explorer-preview-pane explorer-phone-preview-pane hidden';
        pane.setAttribute('aria-label', 'Preview pane');
        contacts.parentNode.insertBefore(pane, contacts.nextSibling);
        return pane;
    }

    function syncPreview(app, sel) {
        const pane = previewPane();
        if (!pane) return;
        const on = isPath(app.currentPath) && app.currentPath !== TRASH && !!parse(app.currentPath).root;
        if (app.modal) app.modal.classList.toggle('explorer-in-phone', on);
        if (!on) {
            if (pane.dataset.phone) {
                pane.dataset.phone = '';
                pane.innerHTML = '';
                pane.classList.add('hidden');
            }
            return;
        }
        pane.classList.remove('hidden');
        const one = Array.isArray(sel) && sel.length === 1 && sel[0].phone ? sel[0] : null;
        const key = one ? `${one.id}|${one.modifiedAt || ''}|${one.size || ''}` : 'none';
        if (pane.dataset.phone === key) return;
        pane.dataset.phone = key;
        if (!one) {
            pane.innerHTML = '<div class="explorer-preview-empty">Select a file to preview.</div>';
            return;
        }
        const facts = [
            ['Type', one.phone.dir ? 'File Folder' : (one.mimeType || 'File')],
            ['Size', one.phone.dir ? '' : (app._formatStatusSize ? app._formatStatusSize(one.size || 0) : `${one.size || 0} bytes`)],
            ['Items', one.phone.dir && one.phone.count != null ? String(one.phone.count) : ''],
            ['Date modified', one.modifiedAt && app.vista ? app.vista.formatDate(one.modifiedAt) : '']
        ].filter((f) => f[1]).map(([k, v]) => `<div class="explorer-phone-fact"><span>${esc(k)}:</span> ${esc(v)}</div>`).join('');
        const kind = one.phone.dir ? 'other' : previewKind(one);
        const url = one.phone.dir ? '' : fileUrl(one);
        let media = '';
        if (kind === 'image') media = `<img class="explorer-phone-preview-media" src="${esc(url)}" alt="" decoding="async">`;
        else if (kind === 'video') media = `<video class="explorer-phone-preview-media" src="${esc(url)}" controls preload="metadata" playsinline></video>`;
        else if (kind === 'audio') media = `<audio class="explorer-phone-preview-audio" src="${esc(url)}" controls preload="metadata"></audio>`;
        else if (kind === 'pdf' || kind === 'text') media = `<iframe class="explorer-phone-preview-frame" src="${esc(url)}" title="Preview"></iframe>`;
        else media = `<div class="explorer-phone-preview-icon explorer-item-icon-box explorer-item-icon-box-md"></div>`;
        pane.innerHTML = `<div class="explorer-phone-preview" data-kind="${kind}">${media}
            <div class="explorer-phone-preview-name">${esc(one.name)}</div>${facts}</div>`;
        const box = pane.querySelector('.explorer-phone-preview-icon');
        if (box && typeof app._populateIconBox === 'function') app._populateIconBox(box, one);
        if (naiCandidate(one)) {
            void readNai(one).then((md) => {
                if (!md || pane.dataset.phone !== key) return;
                const prompt = String(md.prompt || (md.v4_prompt && md.v4_prompt.caption && md.v4_prompt.caption.base_caption) || '');
                const host = pane.querySelector('.explorer-phone-preview');
                if (!host) return;
                host.insertAdjacentHTML('beforeend', `<div class="explorer-phone-nai">
                    <div class="explorer-phone-fact"><span>NovelAI image</span></div>
                    ${prompt ? `<div class="explorer-phone-nai-prompt">${esc(prompt.length > 240 ? `${prompt.slice(0, 240)}…` : prompt)}</div>` : ''}
                    <div class="explorer-phone-nai-actions">
                        <button type="button" class="explorer-preview-link" data-phone-nai="studio">Open in Studio</button>
                        <button type="button" class="explorer-preview-link" data-phone-nai="properties">Properties</button>
                    </div></div>`);
                host.querySelectorAll('[data-phone-nai]').forEach((btn) => btn.addEventListener('click', () => {
                    void (btn.dataset.phoneNai === 'studio' ? openInStudio(one) : openProperties(one));
                }));
            });
        }
    }

    // ---- context menus ---------------------------------------------------------------------

    function entryMenuSections(app, item) {
        if (item.targetKind === 'phone-trash') {
            return [{ type: 'list', items: [{ icon: 'fas fa-trash-arrow-up', text: 'Restore', action: `${ACTION}restore` }] }];
        }
        if (item.targetKind === 'phone-drive') {
            if (item.id.startsWith('phone-state:') && !item.phone.action) return [{ type: 'list', items: [{ icon: 'fas fa-rotate', text: 'Refresh', action: `${ACTION}refresh` }] }];
            return [{ type: 'list', items: [{ icon: 'fas fa-folder-open', text: 'Open', action: 'explorer-open' }] }];
        }
        const file = !item.phone.dir;
        const items = [{ icon: 'fas fa-folder-open', text: 'Open', action: 'explorer-open' }];
        if (file) {
            items.push({ icon: 'fas fa-up-right-from-square', text: 'Open with…', action: `${ACTION}open-with` });
            items.push({ icon: 'fab fa-android', text: 'Open in Android app', action: `${ACTION}open-android` });
            // a NovelAI image (read once, cached; unread PNGs offer it and say so if there is none)
            if (naiCandidate(item) && naiKnownFor(item) !== false) {
                items.push({ separator: true });
                items.push({ icon: 'fas fa-compass-drafting', text: 'Open in Studio', action: `${ACTION}studio` });
                items.push({ icon: 'fas fa-circle-info', text: 'Properties', action: `${ACTION}properties` });
            }
            items.push({ icon: 'fas fa-share-nodes', text: 'Share', action: `${ACTION}share` });
            items.push({ icon: 'fas fa-download', text: 'Download', action: `${ACTION}download` });
        }
        items.push({ icon: 'fas fa-link', text: 'Copy path', action: `${ACTION}copy-path` });
        items.push({ separator: true });
        items.push({ icon: 'fas fa-scissors', text: 'Cut', action: 'explorer-cut' });
        items.push({ icon: 'fas fa-copy', text: 'Copy', action: 'explorer-copy' });
        if (!file && app.clipboard) items.push({ icon: 'fas fa-paste', text: 'Paste', action: `${ACTION}paste-into` });
        items.push({ separator: true });
        items.push({ icon: 'fas fa-trash', text: 'Delete', action: 'explorer-delete' });
        items.push({ icon: 'fas fa-i-cursor', text: 'Rename', action: 'explorer-rename' });
        return [{ type: 'list', items }];
    }

    function emptyMenuSections(app) {
        const path = app.currentPath;
        const items = [];
        const sortBy = typeof app.sortByMenuItem === 'function' ? app.sortByMenuItem() : null;
        if (sortBy) items.push(sortBy, { separator: true });
        items.push({ icon: 'fas fa-rotate', text: 'Refresh', action: `${ACTION}refresh` });
        if (path === TRASH) return [{ type: 'list', items }];
        if (isWritable(path)) {
            items.push({ separator: true });
            items.push({ icon: 'fas fa-folder-plus', text: 'New Folder', action: 'explorer-new-folder' });
            items.push({ icon: 'fas fa-upload', text: 'Upload', action: 'explorer-upload' });
            if (app.clipboard) items.push({ icon: 'fas fa-paste', text: 'Paste', action: 'explorer-paste' });
        }
        items.push({ separator: true });
        items.push({ icon: shownHidden() ? 'fas fa-check' : '', text: 'Show hidden files', action: `${ACTION}toggle-hidden` });
        items.push({ icon: 'fas fa-trash-can', text: 'Phone trash', action: `${ACTION}trash-view` });
        items.push({ icon: 'fas fa-gear', text: 'Phone storage settings', action: `${ACTION}settings` });
        return [{ type: 'list', items }];
    }

    async function handleAction(action, item, app) {
        const sel = app.grid ? app.grid.getSelectedItems() : [];
        const many = item && sel.some((s) => s.id === item.id) ? sel : (item ? [item] : sel);
        const what = action.slice(ACTION.length);
        try {
            switch (what) {
                case 'open-with': if (item) await open(app, item, true); break;
                case 'open-android': if (item) await open(app, item, 'android'); break;
                case 'studio': if (item) await openInStudio(item); break;
                case 'properties': if (item) await openProperties(item); break;
                case 'share': {
                    const files = many.filter((i) => i.phone && !i.phone.dir);
                    if (files.length) await PS().call('share', { root: files[0].phone.root, paths: files.filter((f) => f.phone.root === files[0].phone.root).map((f) => f.phone.path) });
                    break;
                }
                case 'download': download(many); break;
                case 'copy-path': if (item) await copyPath(item); break;
                case 'paste-into': if (item && item.navPath) await app.pasteToPath(item.navPath); break;
                case 'refresh': await app.softRefresh(); break;
                case 'toggle-hidden': setShowHidden(!shownHidden()); await app.softRefresh(); break;
                case 'trash-view': app.navigateTo(TRASH); break;
                case 'settings': await PS().call('openSettings'); break;
                case 'access': await PS().call('requestAccess'); break;
                case 'restore': await restore(app, many.filter((i) => i.targetKind === 'phone-trash')); break;
                default: break;
            }
        } catch (err) {
            showError(err);
        }
    }

    function download(items) {
        items.filter((i) => i.phone && !i.phone.dir).forEach((i) => {
            const a = document.createElement('a');
            a.href = fileUrl(i, { download: true });
            a.download = i.name;
            a.rel = 'noopener';
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }

    async function copyPath(item) {
        const r = rootInfo(item.phone.root);
        const full = `${r && r.path ? r.path.replace(/\/+$/, '') : ''}${item.phone.path}`;
        try {
            await navigator.clipboard.writeText(full);
            toast('success', 'Path copied');
        } catch (_err) {
            toast('error', full);
        }
    }

    function showError(err) {
        const code = err && err.code;
        if (code === 'no_space') {
            if (typeof root.showConfirmationDialog === 'function') {
                void confirmDialog('There is not enough free space on the phone for this. Free up some space and try again.', [{ text: 'OK', value: true, className: 'btn-primary' }]);
            } else toast('error', errText(err));
            return;
        }
        if (code === 'aborted') return;
        toast('error', errText(err));
    }

    // ---- commands ----------------------------------------------------------------------------

    async function createFolder(app) {
        const p = parse(app.currentPath);
        if (!p.root) return;
        const base = 'New Folder';
        for (let n = 1; n < 50; n += 1) {
            const name = n === 1 ? base : `${base} (${n})`;
            try {
                await PS().call('mkdir', { root: p.root, path: PS().joinPath(p.path, name) });
                await app.softRefresh();
                return;
            } catch (err) {
                if (err && err.code === 'exists') continue;
                showError(err);
                return;
            }
        }
    }

    async function rename(app, item) {
        if (!item || !item.phone || item.targetKind !== 'phone-entry') return;
        const name = typeof root.prompt === 'function' ? root.prompt('Rename to:', item.name) : null;
        if (!name || name === item.name) return;
        try {
            await PS().call('rename', { root: item.phone.root, path: item.phone.path, name });
            await app.softRefresh();
        } catch (err) {
            if (err && err.code === 'exists') toast('error', `There is already an item named "${name}" here.`);
            else showError(err);
        }
    }

    /** Delete: to Android's trash; what cannot go there may be deleted for good after a confirm. */
    async function remove(app, items, permanent) {
        const entries = items.filter((i) => i.targetKind === 'phone-entry');
        if (!entries.length) return;
        const rootId = entries[0].phone.root;
        const paths = entries.filter((i) => i.phone.root === rootId).map((i) => i.phone.path);
        let left = paths;
        try {
            if (!permanent) {
                const results = await PS().call('trash', { root: rootId, paths });
                left = (results || []).filter((r) => !r.trashed).map((r) => r.path);
                if (!left.length) {
                    await app.softRefresh();
                    return;
                }
            }
            const names = left.map((p) => PS().baseName(p));
            const list = names.slice(0, 8).map((n) => `• ${n}`).join('\n') + (names.length > 8 ? `\n…and ${names.length - 8} more` : '');
            const message = permanent
                ? `Permanently delete ${names.length === 1 ? `"${names[0]}"` : `these ${names.length} items`}? This cannot be undone.`
                : `${names.length === 1 ? 'This item' : 'These items'} can't go to the Phone trash (folders and files Android does not index):\n${list}\n\nDelete ${names.length === 1 ? 'it' : 'them'} permanently? This cannot be undone.`;
            const ok = typeof root.showConfirmationDialog === 'function'
                ? await confirmDialog(message, [
                    { text: 'Delete Permanently', value: true, className: 'btn-danger' },
                    { text: 'Cancel', value: false, className: 'btn-secondary' }
                ])
                : false;
            if (ok) {
                const results = await PS().call('delete', { root: rootId, paths: left });
                const failed = (Array.isArray(results) ? results : []).filter((r) => r && r.deleted === false);
                if (failed.length) toast('error', `${failed.length} item(s) could not be deleted`);
            }
        } catch (err) {
            showError(err);
        }
        await app.softRefresh();
    }

    async function restore(app, items) {
        const ids = items.map((i) => i.phoneTrash && i.phoneTrash.id).filter((id) => id != null);
        if (!ids.length) return;
        try {
            const results = await PS().call('restore', { ids });
            const failed = (results || []).filter((r) => !r.restored).length;
            if (failed) toast('error', `${failed} item(s) could not be restored`);
            else toast('success', ids.length === 1 ? 'Restored' : `${ids.length} items restored`);
        } catch (err) {
            showError(err);
        }
        await app.softRefresh();
    }

    // ---- transfers -----------------------------------------------------------------------------

    /** Replace / Keep both / Skip (Replace only for files), or 'cancel'. */
    async function askConflict(name, isDir, where) {
        if (typeof root.showConfirmationDialog !== 'function') return 'rename';
        const options = [];
        if (!isDir) options.push({ text: 'Replace', value: 'replace', className: 'btn-primary' });
        options.push({ text: 'Keep both', value: 'rename', className: isDir ? 'btn-primary' : 'btn-secondary' });
        options.push({ text: 'Skip', value: 'skip', className: 'btn-secondary' });
        options.push({ text: 'Cancel', value: 'cancel', className: 'btn-secondary' });
        const choice = await confirmDialog(`There is already ${isDir ? 'a folder' : 'a file'} named "${name}" in ${where}.`, options);
        return choice || 'cancel';
    }

    function beginProgress(app, op, items, from, to, verb, onCancel) {
        const fop = root.fileOperationProgress;
        if (!fop || !fop.available()) return null;
        return fop.begin({
            op,
            verb,
            items: items.map((i) => ({ name: i.name, size: Number(i.size) || 0 })),
            from: typeof from === 'string' ? app._progressPlace(from) : from,
            to: typeof to === 'string' ? app._progressPlace(to) : to,
            onCancel
        });
    }

    /** A job's shared state: cancel, the batch conflict choice, bytes for the progress bar. */
    function job(app, progress) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        return {
            app,
            progress,
            ctl,
            signal: ctl ? ctl.signal : null,
            cancelled: false,
            bytesDone: 0,
            bytesTotal: 0,
            cancel() { this.cancelled = true; if (this.ctl) this.ctl.abort(); },
            tick(n) {
                this.bytesDone += n;
                if (this.progress) this.progress.progress(this.bytesDone, this.bytesTotal || undefined);
            },
            check() { if (this.cancelled || (this.progress && this.progress.cancelled)) throw { code: 'aborted', message: 'Cancelled' }; }
        };
    }

    /** A phone file as a File (name and mtime kept), streamed so the bar moves. */
    async function fetchPhoneFile(j, rootId, entry) {
        const res = await fetch(PS().fileUrl(rootId, entry.path), { signal: j.signal || undefined });
        if (!res.ok) throw { code: res.status === 404 ? 'not_found' : res.status === 423 ? 'locked' : 'io', message: `The phone answered ${res.status} for ${entry.name}` };
        let blob;
        if (res.body && typeof res.body.getReader === 'function') {
            const reader = res.body.getReader();
            const parts = [];
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                parts.push(value);
                j.tick(value.byteLength);
            }
            blob = new Blob(parts, { type: entry.mime || 'application/octet-stream' });
        } else {
            blob = await res.blob();
            j.tick(blob.size);
        }
        return new File([blob], entry.name, { type: entry.mime || blob.type, lastModified: (seconds(entry.mtime) || 0) * 1000 || Date.now() });
    }

    /** A VFS file's bytes (its download URL). */
    async function fetchVfsFile(j, ref) {
        const resp = await VFS().downloadFile(ref.targetId);
        if (!resp || !resp.downloadUrl) throw { code: 'not_found', message: `Could not read ${ref.name}` };
        const res = await fetch(resp.downloadUrl, { signal: j.signal || undefined, credentials: 'same-origin' });
        if (!res.ok) throw { code: 'io', message: `Could not read ${ref.name} (${res.status})` };
        const blob = await res.blob();
        return new File([blob], ref.name, { type: blob.type, lastModified: ref.modifiedAt ? ref.modifiedAt * 1000 : Date.now() });
    }

    /** What a transfer step returns when the user chose Skip (nothing written; a cut keeps the source). */
    const SKIPPED = Object.freeze({ skipped: true });

    async function writeToPhone(j, rootId, dir, file, mtimeMs) {
        let conflict = j.conflict || 'fail';
        for (;;) {
            j.check();
            let last = 0;
            try {
                return await PS().write(rootId, dir, file, {
                    conflict,
                    mtime: mtimeMs || file.lastModified || undefined,
                    signal: j.signal,
                    onProgress: (n) => { j.tick(n - last); last = n; }
                });
            } catch (err) {
                j.tick(-last);
                if (err && err.code === 'exists' && conflict === 'fail') {
                    const choice = await askConflict(file.name, false, 'this phone folder');
                    if (choice === 'cancel') { j.cancel(); throw { code: 'aborted' }; }
                    if (choice === 'skip') return SKIPPED;
                    conflict = choice;
                    continue;
                }
                throw err;
            }
        }
    }

    async function mkdirOnPhone(rootId, dir, name) {
        const path = PS().joinPath(dir, name);
        try {
            await PS().call('mkdir', { root: rootId, path });
        } catch (err) {
            if (!err || err.code !== 'exists') throw err;
        }
        return path;
    }

    /** VFS item (file or folder ref) into a phone folder. */
    async function vfsToPhone(j, ref, rootId, dir) {
        j.check();
        const app = j.app;
        if (app.isFolderItem(ref)) {
            const sub = await mkdirOnPhone(rootId, dir, ref.name);
            const navPath = ref.navPath || app.resolveNavigationPath(ref);
            const listing = await VFS().listDirectory(navPath, { limit: 10000 });
            // one skipped child keeps the whole source folder (a cut must not trash it)
            let skipped = false;
            for (const child of listing.items || []) if ((await vfsToPhone(j, child, rootId, sub)) === SKIPPED) skipped = true;
            return skipped ? SKIPPED : undefined;
        }
        if (ref.targetKind !== 'user-file') throw { code: 'denied', message: `"${ref.name}" can't be copied to the phone` };
        const file = await fetchVfsFile(j, ref);
        return (await writeToPhone(j, rootId, dir, file, ref.modifiedAt ? ref.modifiedAt * 1000 : undefined)) === SKIPPED ? SKIPPED : undefined;
    }

    /** A phone entry (file or folder) into a VFS folder. */
    async function phoneToVfs(j, rootId, entry, vfsDir) {
        j.check();
        if (entry.dir) {
            await VFS().createFolder(vfsDir, entry.name);
            const listing = await VFS().listDirectory(vfsDir, { limit: 10000 });
            const made = (listing.items || []).find((i) => i.kind === 'folder' && i.name === entry.name);
            const sub = made ? (made.navPath || j.app.resolveNavigationPath(made)) : null;
            if (!sub) throw { code: 'io', message: `Could not make the folder "${entry.name}"` };
            const inner = await PS().call('list', { root: rootId, path: entry.path });
            for (const child of inner.entries || []) await phoneToVfs(j, rootId, child, sub);
            return;
        }
        const file = await fetchPhoneFile(j, rootId, entry);
        j.check();
        await IMPORT().routeFilesToPath(vfsDir, [file]);
    }

    /** Phone -> phone (copy / move, across roots too) with the conflict prompt. */
    async function phoneToPhone(j, ref, dst, op) {
        // a copy into its own folder never offers Replace (source and target are one file):
        // the bridge picks a free name straight away
        const ownFolder = ref.phone.root === dst.root && PS().parentPath(ref.phone.path) === dst.path;
        let conflict = ownFolder && op !== 'cut' ? 'rename' : (j.conflict || 'fail');
        for (;;) {
            j.check();
            try {
                await PS().call(op === 'cut' ? 'move' : 'copy', { root: ref.phone.root, path: ref.phone.path, toRoot: dst.root, toDir: dst.path, conflict });
                return;
            } catch (err) {
                if (err && err.code === 'exists' && conflict === 'fail') {
                    const choice = await askConflict(ref.name, !!ref.phone.dir, 'this phone folder');
                    if (choice === 'cancel') { j.cancel(); throw { code: 'aborted' }; }
                    if (choice === 'skip') return SKIPPED;
                    conflict = choice;
                    continue;
                }
                throw err;
            }
        }
    }

    /** Sizes for the bar: a folder's are not known up front (they count as they arrive). */
    function knownBytes(refs) {
        return refs.reduce((n, r) => n + (Number(r.size) || 0), 0);
    }

    async function runJob(app, op, refs, from, to, verb, each) {
        let j = null;
        const progress = beginProgress(app, op === 'cut' ? 'move' : 'copy', refs, from, to, verb, () => j && j.cancel());
        j = job(app, progress);
        j.bytesTotal = knownBytes(refs);
        const done = [];
        // a cancel (the dialog's, or Cancel in the conflict prompt) and a full phone stop the job
        // here instead of reaching the dialog's Try Again / Skip prompt
        const step = async (ref) => {
            try {
                // a skipped item (name clash, Skip) is not done: a cut leaves its source alone
                return (await each(j, ref)) !== SKIPPED && !j.cancelled;
            } catch (err) {
                if (err && err.code === 'aborted') { j.cancel(); return false; }
                if (err && err.code === 'no_space') { j.cancel(); showError(err); return false; }
                throw err;
            }
        };
        try {
            for (const ref of refs) {
                if (j.cancelled || (progress && !progress.next())) break;
                const item = { name: ref.name, size: Number(ref.size) || 0 };
                if (progress) {
                    const r = await progress.attempt(item, () => step(ref));
                    if (r.ok && r.value) done.push(ref);
                    progress.done(item);
                } else {
                    try {
                        if (await step(ref)) done.push(ref);
                    } catch (err) {
                        showError(err);
                    }
                }
            }
        } finally {
            if (progress) progress.finish();
        }
        return { done, cancelled: j.cancelled };
    }

    /**
     * Paste / drop into navPath (phone or VFS) of refs from the phone or the VFS. A drag across
     * drives copies (Vista); a cut across them moves (the phone source goes to its trash, the VFS
     * source to its Trash). Resolves false when nothing was ours to do.
     */
    async function deliver(app, refs, navPath, operation, options = {}) {
        const fromPhone = refs.length && refs.every(isEntryRef);
        const toPhone = isPath(navPath) && navPath !== TRASH;
        if (!fromPhone && !toPhone) return false;
        if (refs.some(isEntryRef) && !fromPhone) {
            toast('warning', 'Copy phone items and Cartograph items separately');
            return true;
        }
        const sourcePath = options.sourcePath || app.currentPath;
        const op = options.drag && fromPhone !== toPhone ? 'copy' : operation;
        if (toPhone) {
            const dst = parse(navPath);
            if (!dst.root) { toast('warning', 'Open a drive on the phone to paste there'); return true; }
            if (fromPhone) {
                if (refs.some((r) => r.phone.root === dst.root && (PS().parentPath(r.phone.path) === dst.path || dst.path === r.phone.path || dst.path.startsWith(r.phone.path + '/')))) {
                    if (refs.every((r) => r.phone.root === dst.root && PS().parentPath(r.phone.path) === dst.path) && op === 'cut') {
                        toast('info', 'Items are already in this location');
                        return true;
                    }
                }
                await runJob(app, op, refs, sourcePath, navPath, op === 'cut' ? 'Moving' : 'Copying', (j, ref) => phoneToPhone(j, ref, dst, op));
            } else {
                const res = await runJob(app, op, refs, sourcePath, navPath, 'Copying', (j, ref) => vfsToPhone(j, ref, dst.root, dst.path));
                if (op === 'cut' && res.done.length && !res.cancelled) {
                    try { await VFS().moveToTrash(res.done, sourcePath); } catch (err) { toast('error', `Copied, but the originals stayed: ${errText(err)}`); }
                }
            }
        } else {
            const res = await runJob(app, op, refs, sourcePath, navPath, 'Copying', (j, ref) => phoneToVfs(j, ref.phone.root, { name: ref.name, path: ref.phone.path, dir: !!ref.phone.dir, mime: ref.phone.mime || ref.mimeType, mtime: ref.modifiedAt }, navPath));
            if (op === 'cut' && res.done.length && !res.cancelled) {
                const rootId = res.done[0].phone.root;
                try {
                    const results = await PS().call('trash', { root: rootId, paths: res.done.filter((r) => r.phone.root === rootId).map((r) => r.phone.path) });
                    const kept = (results || []).filter((r) => !r.trashed).length;
                    if (kept) toast('info', `Copied. ${kept} original(s) could not go to the Phone trash and stayed on the phone.`);
                } catch (err) {
                    toast('error', `Copied, but the originals stayed on the phone: ${errText(err)}`);
                }
            }
        }
        if (navPath === app.currentPath || isPath(app.currentPath)) await app.softRefresh();
        return true;
    }

    /** Files from the computer (a desktop drop, Upload) into a phone folder. */
    async function uploadFiles(app, navPath, files) {
        const dst = parse(navPath);
        if (!dst.root) { toast('warning', 'Open a drive on the phone to upload there'); return; }
        const list = [...files];
        await runJob(app, 'copy', list, { name: 'This computer', path: '' }, navPath, 'Copying', (j, f) => writeToPhone(j, dst.root, dst.path, f, f.lastModified));
        if (navPath === app.currentPath) await app.softRefresh();
    }

    // ---- navigation pane: the Phone group ------------------------------------------------------

    function navHost(app) {
        const pane = app.modal ? app.modal.querySelector('#explorerNavPane .explorer-favorites') : null;
        if (!pane) return null;
        let host = pane.querySelector('.explorer-phone-nav');
        if (!host) {
            host = document.createElement('div');
            host.className = 'explorer-phone-nav';
            pane.appendChild(host);
            host.addEventListener('click', (ev) => {
                const btn = ev.target.closest('button[data-phone-action], button[data-path]');
                if (!btn) return;
                if (btn.dataset.phoneAction) void handleAction(`${ACTION}${btn.dataset.phoneAction}`, null, app);
                else app.navigateTo(btn.dataset.path);
            });
            // files from the computer dropped on a drive go to its root
            host.addEventListener('dragover', (ev) => {
                const btn = ev.target.closest('button[data-drop-path]');
                if (!btn || !ev.dataTransfer || ![...ev.dataTransfer.types].includes('Files')) return;
                ev.preventDefault();
                btn.classList.add('is-drop-target');
            });
            host.addEventListener('dragleave', (ev) => {
                const btn = ev.target.closest('button[data-drop-path]');
                if (btn) btn.classList.remove('is-drop-target');
            });
            host.addEventListener('drop', (ev) => {
                const btn = ev.target.closest('button[data-drop-path]');
                if (!btn) return;
                ev.preventDefault();
                btn.classList.remove('is-drop-target');
                const files = [...(ev.dataTransfer?.files || [])];
                if (files.length) void uploadFiles(app, btn.dataset.dropPath, files);
            });
        }
        return host;
    }

    function renderNav(app) {
        if (!available()) return;
        const host = navHost(app);
        if (!host) return;
        const st = state();
        const block = blocker(st);
        const current = app.currentPath;
        // the device icons fall back to the hard disk's until the Vista ones are in place
        // imageres.dll 29, Vista's removable disk (every phone root is one to Cartograph)
        const img = (icon) => `<img src="${ART}/${icon}" alt="">`;
        const link = (attrs, icon, label, cls = '') => `<li><button type="button" class="explorer-favorite-link ${cls}" ${attrs} title="${esc(label)}">${img(icon)}<span>${esc(label)}</span></button></li>`;
        let rows = '';
        if (block) {
            rows = link(block.action ? `data-phone-action="${block.action === 'settings' ? 'settings' : 'access'}"` : 'disabled', 'drive-removable-16.png', block.text, 'explorer-phone-state');
        } else {
            rows = rootsOf(st).map((r) => {
                const path = pathFor(r.id, '/');
                const on = current === path || (isPath(current) && parse(current).root === r.id);
                const free = r.total ? ` (${Math.round((r.free || 0) / 1e9)} GB free)` : '';
                return `<li><button type="button" class="explorer-favorite-link explorer-phone-drive${on ? ' is-current' : ''}" data-path="${esc(path)}" data-drop-path="${esc(path)}" title="${esc(rootName(r.id) + free)}">`
                    + `${img('drive-removable-16.png')}<span>${esc(rootName(r.id))}</span>`
                    + '</button></li>';
            }).join('') + link(`data-path="${TRASH}"`, 'fav-recycle.png', 'Phone trash', current === TRASH ? 'is-current' : '');
        }
        host.innerHTML = `<div class="explorer-nav-heading">${esc(phoneName())}</div><ul class="explorer-favorite-links explorer-phone-links">${rows}</ul>`;
    }

    // ---- Computer: Portable Devices ------------------------------------------------------------

    /** Tiles for Computer's Portable Devices group: { key, name, icon, total, free, kind, block }. */
    function computerDrives() {
        if (!available()) return [];
        const st = state();
        if (!st) { void ensureState().then(() => apps.forEach((a) => a.computer && a._isComputerPath && a._isComputerPath() && a.computer.render())); }
        const block = blocker(st);
        if (block) return [{ key: 'phone:', name: phoneName(), icon: 'drive-removable', block }];
        return rootsOf(st).map((r) => ({
            key: `phone:${r.id}`,
            name: rootName(r.id),
            icon: 'drive-removable',
            total: Number(r.total) || 0,
            free: Number(r.free) || 0,
            kind: r.kind,
            path: pathFor(r.id, '/')
        }));
    }

    function openComputerDrive(app, key) {
        const d = computerDrives().find((x) => x.key === key);
        if (!d) return;
        if (d.block) {
            if (d.block.action) void handleAction(`${ACTION}${d.block.action === 'settings' ? 'settings' : 'access'}`, null, app);
            return;
        }
        app.navigateTo(d.path);
    }

    root.explorerPhoneDrive = {
        PREFIX,
        TRASH,
        driveLetter,
        rootName,
        available,
        isPath,
        isTrashPath,
        isEntry,
        isEntryRef,
        normalize,
        parse,
        pathFor,
        attach,
        leave,
        list,
        displayName,
        displayPath,
        crumbs,
        crumbIcon,
        parentOf,
        resolveInput,
        isWritable,
        open,
        openInApp,
        readNai,
        openInStudio,
        openProperties,
        openWith,
        openRecent,
        programFor,
        kindOf,
        sourceOf,
        sourceLabel,
        sourceUrl,
        trackDocument,
        writeText,
        syncPreview,
        entryMenuSections,
        emptyMenuSections,
        handleAction,
        createFolder,
        rename,
        remove,
        download,
        deliver,
        uploadFiles,
        renderNav,
        computerDrives,
        openComputerDrive,
        _test: { sortItems, entryToItem, blocker, seconds }
    };
})(typeof window !== 'undefined' ? window : globalThis);
