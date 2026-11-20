/**
 * This computer's own drives on DreamOS (#910): USB sticks and disks, the SD card and further internal volumes,
 * mounted and served by the CaféReady host (cafeready drives.rs) through the kiosk's shell bridge
 * (window.DreamOSDrives). Without that bridge (a browser, the Android app) nothing here shows.
 *
 * Places (Explorer's currentPath strings):
 *   drive://<id>/<path>    a folder on a drive ("/" is the drive itself); <id> is the volume's id (its UUID)
 *   address box            E:\DCIM\Camera, as Vista shows a drive; typed letters resolve here first
 *
 * Items: { id: 'host:<drive>:<path>', name, kind, targetKind: 'host-entry', navPath (folders), size, modifiedAt
 * (seconds), mimeType, previewUrl (pictures), downloadUrl (the file's URL on the host: the Open dialog and
 * downloads read it), host: { drive, path, dir } }.
 *
 * The host drives sit beside the phone's in every place that already knows about drives (Explorer, the Folders
 * tree, Computer, the Open dialog), so this file installs itself in front of explorerPhoneDrive.js: the object
 * window.explorerPhoneDrive becomes a router that hands each call to the drive the path or item belongs to (the
 * phone's own calls are unchanged). Computer lists these drives itself (explorerComputerView.js hostDrives):
 * fixed volumes under Hard Disk Drives, removable ones under Devices with Removable Storage, with Eject.
 *
 * Transfers (paste, drops, cut) run under Vista's progress dialog: drive <-> drive on the host (its own copy with
 * progress), drive <-> Cartograph's folders through the file URL and the VFS import, files from the desktop into a
 * drive by the bridge's write. Delete on a drive is permanent, as Vista's is on a removable disk.
 */
(function (root) {
    'use strict';

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const PREFIX = 'drive://';
    const ACTION = 'explorer-phone-host-';
    const ART = '/static_images/vista-explorer';
    const HIDDEN_KEY = 'explorerPhoneShowHidden';

    const D = () => root.DreamOSDrives || null;
    const VFS = () => (typeof vfsClient !== 'undefined' ? vfsClient : root.vfsClient);
    const IMPORT = () => (typeof vfsImportRouter !== 'undefined' ? vfsImportRouter : root.vfsImportRouter);
    const available = () => !!(D() && typeof D().get === 'function');
    const apps = new Set();

    function esc(text) {
        return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function message(text, title, icon) {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        // the dialog's picture follows its icon class (Vista's error / warning / information)
        const cls = { error: 'fas fa-circle-xmark', warning: 'fas fa-triangle-exclamation', info: 'fas fa-circle-info' }[icon || 'error'];
        return root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-primary' }], null, { title: title || 'Explorer', icon: cls });
    }

    function failed(r) { return !r || (typeof r.error === 'string' && r.error); }
    function fail(r) { return { code: (r && r.code) || 'io', message: (r && r.error) || 'The drive did not answer.' }; }
    async function ask(promise) {
        const r = await promise;
        if (failed(r)) throw fail(r);
        return r;
    }

    // ---- drives ------------------------------------------------------------------------------------------------

    function drives() {
        const st = available() ? D().get() : null;
        return (st && Array.isArray(st.drives)) ? st.drives : [];
    }
    function driveInfo(id) { return drives().find((d) => d.id === id) || null; }
    function driveByLetter(letter) { return drives().find((d) => String(d.letter).toUpperCase() === String(letter).toUpperCase()) || null; }
    /** "Removable Disk (E:)", "KINGSTON (E:)" */
    function rootName(id) {
        const d = driveInfo(id);
        return d ? `${d.name} (${d.letter}:)` : id;
    }

    function isPath(path) { return available() && typeof path === 'string' && path.startsWith(PREFIX); }
    function parse(path) {
        const rest = String(path || '').slice(PREFIX.length);
        if (!rest) return { root: null, path: '/' };
        const slash = rest.indexOf('/');
        const id = decodeURIComponent(slash < 0 ? rest : rest.slice(0, slash));
        const inner = slash < 0 ? '/' : (rest.slice(slash).replace(/\/+$/, '') || '/');
        return { root: id, path: inner };
    }
    function pathFor(id, path) {
        const inner = !path || path === '/' ? '' : path.replace(/\/+$/, '');
        return `${PREFIX}${encodeURIComponent(id)}${inner}`;
    }
    function normalize(path) { const p = parse(path); return p.root ? pathFor(p.root, p.path) : PREFIX; }
    function isEntry(item) { return !!(item && (item.targetKind === 'host-entry' || item.targetKind === 'host-drive')); }
    function isEntryRef(ref) { return !!(ref && ref.host && ref.host.drive); }
    function parentPath(path) { const parts = String(path || '/').split('/').filter(Boolean); parts.pop(); return '/' + parts.join('/'); }
    function joinPath(dir, name) { return `${String(dir || '/').replace(/\/+$/, '')}/${name}`.replace(/^\/*/, '/'); }

    function shownHidden() { try { return localStorage.getItem(HIDDEN_KEY) === '1'; } catch (_) { return false; } }

    function fileUrl(id, path, opts) { return available() ? D().fileUrl(id, path, opts || {}) : ''; }

    function entryToItem(id, e) {
        const dir = !!e.dir;
        const item = {
            id: `host:${id}:${e.path}`,
            name: e.name,
            kind: dir ? 'folder' : 'file',
            targetKind: 'host-entry',
            mimeType: e.mime || '',
            icon: dir ? 'fas fa-folder' : 'fas fa-file',
            modifiedAt: Math.floor((Number(e.mtime) || 0) / 1000),
            host: { drive: id, path: e.path, dir, hidden: !!e.hidden, mime: e.mime || '' }
        };
        if (dir) item.navPath = pathFor(id, e.path);
        else {
            item.size = Number(e.size) || 0;
            item.downloadUrl = fileUrl(id, e.path);
            // pictures show themselves (the file itself: the host makes no thumbnails; big ones keep the icon)
            if (/^image\/(jpeg|png|gif|webp|bmp|avif)$/.test(item.mimeType) && item.size < 24 * 1024 * 1024) item.previewUrl = item.downloadUrl;
        }
        return item;
    }

    function sortItems(items, field, direction) {
        const dir = direction === 'desc' ? -1 : 1;
        const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
        const cmp = {
            name: byName,
            date: (a, b) => (a.modifiedAt || 0) - (b.modifiedAt || 0) || byName(a, b),
            size: (a, b) => (a.size || 0) - (b.size || 0) || byName(a, b),
            type: (a, b) => String(a.mimeType).localeCompare(String(b.mimeType)) || byName(a, b)
        }[field] || byName;
        return items.slice().sort((a, b) => ((a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1)) || cmp(a, b) * dir);
    }

    // ---- the drives coming and going ------------------------------------------------------------------------------

    let bound = false;
    function bind() {
        if (bound || !available()) return;
        bound = true;
        root.addEventListener('dreamosdrives', () => {
            apps.forEach((app) => {
                try {
                    if (app.computer && typeof app._isComputerPath === 'function' && app._isComputerPath()) app.computer.render();
                    // the drive this window shows was taken out: back to Computer, as Vista does
                    if (isPath(app.currentPath) && !driveInfo(parse(app.currentPath).root)) app.navigateTo((root.ExplorerComputerView && root.ExplorerComputerView.PATH) || 'Computer');
                    if (typeof app._syncVistaTree === 'function') app._syncVistaTree();
                } catch (_) { /* a closed window */ }
            });
        }, { signal: appScopeSignal });
    }
    function attach(app) { if (!available() || !app) return; apps.add(app); bind(); }
    function leave() { /* nothing is watched on the host */ }

    // ---- listing --------------------------------------------------------------------------------------------------

    async function list(app, path) {
        attach(app);
        const out = (items, empty) => ({ path, items, totalCount: items.length, totalSizeBytes: items.reduce((n, i) => n + (i.size || 0), 0), hasMore: false, emptyMessage: empty || null });
        const p = parse(path);
        if (!p.root) return out(drives().map((d) => ({ id: `host-drive:${d.id}`, name: rootName(d.id), kind: 'folder', targetKind: 'host-drive', navPath: pathFor(d.id, '/'), icon: 'fas fa-hard-drive', previewUrl: `${ART}/drive-${d.removable ? 'removable' : 'fixed'}-48.png`, host: { drive: d.id, path: '/', dir: true } })));
        if (!driveInfo(p.root)) return out([], 'The drive is not there any more.');
        const r = await D().list(p.root, p.path);
        if (failed(r)) {
            if (r.code === 'not_found') return out([], 'This folder is not there any more.');
            throw new Error(r.error);
        }
        const hidden = typeof app.showHidden === 'boolean' ? app.showHidden : shownHidden();
        const items = (r.entries || []).filter((e) => hidden || !e.hidden).map((e) => entryToItem(p.root, e));
        return out(sortItems(items, app.sortField, app.sortDirection), 'This folder is empty.');
    }

    async function folders(path) {
        const p = parse(path);
        if (!p.root) return drives().map((d) => ({ name: rootName(d.id), path: pathFor(d.id, '/') }));
        const r = await D().list(p.root, p.path);
        if (failed(r)) return [];
        const hidden = shownHidden();
        return (r.entries || []).filter((e) => e.dir && (hidden || !e.hidden)).map((e) => ({ name: e.name, path: pathFor(p.root, e.path) }))
            .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    }

    // ---- names, address box, breadcrumb ---------------------------------------------------------------------------

    function displayName(path) {
        const p = parse(path);
        if (!p.root) return 'Computer';
        return p.path === '/' ? rootName(p.root) : p.path.split('/').filter(Boolean).pop();
    }
    function displayPath(path) {
        const p = parse(path);
        const d = driveInfo(p.root);
        if (!d) return 'Computer';
        return `${d.letter}:\\${p.path.split('/').filter(Boolean).join('\\')}`;
    }
    function crumbs(path) {
        const p = parse(path);
        if (!p.root) return [];
        const list = [{ label: rootName(p.root), path: pathFor(p.root, '/') }];
        const parts = p.path.split('/').filter(Boolean);
        parts.forEach((part, i) => list.push({ label: part, path: pathFor(p.root, '/' + parts.slice(0, i + 1).join('/')) }));
        return list;
    }
    function crumbIcon(path) {
        const p = parse(path);
        if (p.path !== '/') return 'crumb-folder.png';
        const d = driveInfo(p.root);
        return d && !d.removable ? 'drive-fixed-16.png' : 'drive-removable-16.png';
    }
    function resolveInput(text) {
        if (!available()) return null;
        const input = String(text || '').trim();
        if (input.startsWith(PREFIX)) return normalize(input);
        const m = /^([d-z]):(?:[\\/](.*))?$/i.exec(input);
        if (!m) return null;
        const d = driveByLetter(m[1]);
        return d ? pathFor(d.id, '/' + String(m[2] || '').split(/[\\/]+/).filter(Boolean).join('/')) : null;
    }
    /** Up from a drive is Computer (the applet goes there on null). */
    function parentOf(path) {
        const p = parse(path);
        if (!p.root || p.path === '/') return null;
        return pathFor(p.root, parentPath(p.path));
    }
    function isWritable(path) {
        if (!isPath(path)) return false;
        const d = driveInfo(parse(path).root);
        return !!d && !d.readOnly;
    }

    // ---- open -----------------------------------------------------------------------------------------------------

    function sourceOf(item) { return { kind: 'host', root: item.host.drive, path: item.host.path, name: item.name, size: item.size || 0, mime: item.mimeType || '', mtime: item.modifiedAt || 0 }; }
    function sourceLabel(src) { return `${rootName(src.root)}${src.path}`; }
    function sourceUrl(src) { return fileUrl(src.root, src.path); }
    function isSource(src) { return !!(src && src.kind === 'host'); }

    /** Notepad's Save for a file on a drive: the text written over it. */
    async function writeText(src, text, mime) {
        const blob = new Blob([text], { type: mime || 'text/plain' });
        await ask(D().write(src.root, parentPath(src.path), blob, { name: src.path.split('/').pop(), conflict: 'replace' }));
    }

    function kindOf(name, mime) {
        const pd = root.__explorerPhoneDriveOwn;
        return pd && typeof pd.kindOf === 'function' ? pd.kindOf(name, mime) : 'other';
    }
    function programFor(name, mime) {
        const pd = root.__explorerPhoneDriveOwn;
        const p = pd && typeof pd.programFor === 'function' ? pd.programFor(name, mime) : null;
        return p === 'android' || (typeof p === 'string' && p.startsWith('android:')) ? { image: 'lumen', media: 'media-player', text: 'notepad', pdf: 'viewer' }[kindOf(name, mime)] || null : p;
    }

    async function open(app, item) {
        if (item.targetKind === 'host-drive' || (item.host && item.host.dir)) { app.navigateTo(item.navPath); return; }
        const src = sourceOf(item);
        const url = sourceUrl(src);
        const program = programFor(item.name, item.mimeType);
        try {
            switch (program) {
                case 'lumen': {
                    const rows = [];
                    (app && app.items ? app.items : [item]).filter((i) => i.host && !i.host.dir && kindOf(i.name, i.mimeType) === 'image')
                        .forEach((i) => rows.push({ url: i.downloadUrl, base: sourceLabel(sourceOf(i)), title: i.name, siblings: rows }));
                    const row = rows.find((r) => r.url === url) || { url, base: sourceLabel(src), title: item.name, siblings: rows };
                    root.openImageInViewer(url, sourceLabel(src), row);
                    break;
                }
                case 'media-player':
                    await root.featureLoader.loadFeature('media_player');
                    root.openDesktopMediaPlayerUrl(url, item.name);
                    break;
                case 'notepad':
                    if (typeof root.loadNotepadManager === 'function') await root.loadNotepadManager();
                    else if (root.featureLoader) await root.featureLoader.loadFeature('notepad');
                    if (!root.notepadVista || typeof root.notepadVista.openPhoneFile !== 'function') throw { message: 'Notepad is not available' };
                    await root.notepadVista.openPhoneFile(src, sourceLabel(src));
                    break;
                case 'paint':
                    await root.featureLoader.loadFeature('paint');
                    if (root.openMelatonPaint) root.openMelatonPaint({ image: url, name: item.name });
                    break;
                default: {
                    // a PDF opens in the PDF reader when one is there; anything else asks Vista's "cannot open"
                    if (program === 'viewer' && typeof root.openPdfDocument === 'function') { root.openPdfDocument(url, item.name); break; }
                    const ow = root.melatonOpenWith;
                    const how = ow ? await ow.cannotOpen(item.name) : null;
                    if (how === 'web' && root.__explorerPhoneDriveOwn) root.__explorerPhoneDriveOwn.webSearchFor(item.name);
                    else if (how === 'list') await message(`Copy "${item.name}" to a folder on C: to open it with another program.`, 'Open With', 'info');
                }
            }
        } catch (err) {
            await message((err && err.message) || String(err), 'Explorer');
        }
    }

    // ---- menus ----------------------------------------------------------------------------------------------------

    function entryMenuSections(app, item) {
        if (item.targetKind === 'host-drive') return [{ type: 'list', items: [{ icon: 'fas fa-folder-open', text: 'Open', action: 'explorer-open', className: 'context-menu-item-default' }].concat(ejectItems(item.host.drive)) }];
        const file = !item.host.dir;
        const writable = isWritable(pathFor(item.host.drive, '/'));
        const items = [{ icon: 'fas fa-folder-open', text: 'Open', action: 'explorer-open', className: 'context-menu-item-default' }];
        if (file) items.push({ icon: 'fas fa-download', text: 'Download', action: `${ACTION}download` });
        items.push({ separator: true });
        items.push({ icon: 'fas fa-scissors', text: 'Cut', action: 'explorer-cut', disabled: !writable });
        items.push({ icon: 'fas fa-copy', text: 'Copy', action: 'explorer-copy' });
        if (!file && app.clipboard && writable) items.push({ icon: 'fas fa-paste', text: 'Paste', action: `${ACTION}paste-into` });
        items.push({ separator: true });
        items.push({ icon: 'fas fa-trash', text: 'Delete', action: 'explorer-delete', disabled: !writable });
        items.push({ icon: 'fas fa-i-cursor', text: 'Rename', action: 'explorer-rename', disabled: !writable });
        return [{ type: 'list', items }];
    }

    function ejectItems(id) {
        const d = driveInfo(id);
        return d && d.removable ? [{ separator: true }, { text: 'Eject', action: `${ACTION}eject:${id}` }] : [];
    }

    function emptyMenuSections(app) {
        const items = [];
        const sortBy = typeof app.sortByMenuItem === 'function' ? app.sortByMenuItem() : null;
        if (sortBy) items.push(sortBy, { separator: true });
        items.push({ icon: 'fas fa-rotate', text: 'Refresh', action: `${ACTION}refresh` });
        if (isWritable(app.currentPath)) {
            items.push({ separator: true });
            items.push({ icon: 'fas fa-folder-plus', text: 'New Folder', action: 'explorer-new-folder' });
            if (app.clipboard) items.push({ icon: 'fas fa-paste', text: 'Paste', action: 'explorer-paste' });
        }
        return [{ type: 'list', items }];
    }

    async function handleAction(action, item, app) {
        const what = action.slice(ACTION.length);
        const sel = app && app.grid ? app.grid.getSelectedItems() : [];
        const many = item && sel.some((s) => s.id === item.id) ? sel : (item ? [item] : sel);
        if (what.startsWith('eject:')) { await eject(what.slice(6)); return; }
        switch (what) {
            case 'download': download(many); break;
            case 'paste-into': if (item && item.navPath) await app.pasteToPath(item.navPath); break;
            case 'refresh': await app.softRefresh(); break;
            default: break;
        }
    }

    function download(items) {
        items.filter((i) => i.host && !i.host.dir).forEach((i) => {
            const a = document.createElement('a');
            a.href = fileUrl(i.host.drive, i.host.path, { download: true });
            a.download = i.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }

    // ---- Safely Remove (also the tray icon's, hostDrivesShell.js) ---------------------------------------------------

    /** Vista's eject: "Safe To Remove Hardware" balloon, or "Problem Ejecting" while in use. Resolves true when ejected. */
    async function eject(id) {
        const shell = root.hostDrivesShell;
        if (shell && typeof shell.eject === 'function') return shell.eject(id);
        const r = await D().eject(id);
        if (failed(r)) { await message(r.code === 'in_use' ? "This device is currently in use. Close any programs or windows that might be using the device, and then try again." : r.error, 'Problem Ejecting USB Mass Storage Device', 'warning'); return false; }
        return true;
    }

    // ---- commands -------------------------------------------------------------------------------------------------

    async function createFolder(app) {
        const p = parse(app.currentPath);
        if (!p.root) return;
        for (let n = 1; n < 50; n += 1) {
            const name = n === 1 ? 'New Folder' : `New Folder (${n})`;
            const r = await D().mkdir(p.root, joinPath(p.path, name));
            if (failed(r) && r.code === 'exists') continue;
            if (failed(r)) await message(r.error);
            await app.softRefresh();
            return;
        }
    }

    async function rename(app, item) {
        if (!item || !item.host || item.targetKind !== 'host-entry') return;
        const name = typeof root.showInputDialog === 'function'
            ? await root.showInputDialog('Type a new name:', item.name, '', null, null, { title: 'Rename' })
            : null;
        if (!name || name === item.name) return;
        const r = await D().rename(item.host.drive, item.host.path, name);
        if (failed(r)) await message(r.code === 'exists' ? `There is already a file with the same name as the file name you specified. Specify a different file name.` : r.error, 'Error Renaming File or Folder');
        await app.softRefresh();
    }

    /** Vista on a removable disk: delete is permanent, after its own question. */
    async function remove(app, items) {
        const entries = items.filter((i) => i.targetKind === 'host-entry');
        if (!entries.length) return;
        const one = entries.length === 1 ? entries[0] : null;
        const title = one ? (one.host.dir ? 'Delete Folder' : 'Delete File') : 'Delete Multiple Items';
        const text = one
            ? `Are you sure you want to permanently delete this ${one.host.dir ? 'folder' : 'file'}?\n\n${one.name}`
            : `Are you sure you want to permanently delete these ${entries.length} items?`;
        const ok = typeof root.showConfirmationDialog === 'function'
            ? await root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'Yes', value: true, className: 'btn-primary' }, { text: 'No', value: false }], null, { title, icon: 'fas fa-triangle-exclamation' })
            : false;
        if (!ok) return;
        const byDrive = new Map();
        entries.forEach((e) => { if (!byDrive.has(e.host.drive)) byDrive.set(e.host.drive, []); byDrive.get(e.host.drive).push(e.host.path); });
        for (const [id, paths] of byDrive) {
            const r = await D().remove(id, paths);
            const bad = Array.isArray(r) ? r.filter((x) => x && x.deleted === false) : [];
            if (failed(r) || bad.length) await message(failed(r) ? r.error : `${bad.length} item(s) could not be deleted: ${bad[0].error}`, 'Error Deleting File or Folder');
        }
        await app.softRefresh();
    }

    // ---- transfers ------------------------------------------------------------------------------------------------

    async function askConflict(name, isDir) {
        if (typeof root.showConfirmationDialog !== 'function') return 'rename';
        const options = [];
        if (!isDir) options.push({ text: 'Copy and Replace', value: 'replace', className: 'btn-primary' });
        options.push({ text: 'Copy, but keep both files', value: 'rename' });
        options.push({ text: "Don't copy", value: 'skip' });
        options.push({ text: 'Cancel', value: 'cancel' });
        const v = await root.showConfirmationDialog(`<p>There is already ${isDir ? 'a folder' : 'a file'} with the same name in this location.</p><p>${esc(name)}</p>`, options, null, { title: isDir ? 'Confirm Folder Replace' : 'Copy File' });
        return v || 'cancel';
    }

    const SKIPPED = Object.freeze({ skipped: true });

    function job(app, progress) {
        const ctl = new AbortController();
        return {
            app, progress, signal: ctl.signal, cancelled: false, bytesDone: 0, bytesTotal: 0,
            cancel() { this.cancelled = true; ctl.abort(); },
            tick(n) { this.bytesDone += n; if (this.progress) this.progress.progress(this.bytesDone, this.bytesTotal || undefined); },
            check() { if (this.cancelled || (this.progress && this.progress.cancelled)) throw { code: 'aborted', message: 'Cancelled' }; }
        };
    }

    async function withConflict(j, name, isDir, run) {
        let conflict = j.conflict || 'fail';
        for (;;) {
            j.check();
            const r = await run(conflict);
            if (failed(r) && r.code === 'exists' && conflict === 'fail') {
                const choice = await askConflict(name, isDir);
                if (choice === 'cancel') { j.cancel(); throw { code: 'aborted' }; }
                if (choice === 'skip') return SKIPPED;
                conflict = choice;
                continue;
            }
            if (failed(r)) throw fail(r);
            return r;
        }
    }

    /** a drive's file as a File, streamed so the bar moves */
    async function fetchHostFile(j, id, path, name, mtimeSec) {
        const res = await fetch(fileUrl(id, path), { signal: j.signal });
        if (!res.ok) throw { code: res.status === 404 ? 'not_found' : 'io', message: `Could not read ${name} (${res.status})` };
        const reader = res.body.getReader();
        const parts = [];
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            j.tick(value.byteLength);
        }
        const type = res.headers.get('content-type') || '';
        return new File(parts, name, { type, lastModified: mtimeSec ? mtimeSec * 1000 : Date.now() });
    }

    async function writeToDrive(j, id, dir, file, mtimeMs) {
        let last = 0;
        return withConflict(j, file.name, false, async (conflict) => {
            j.tick(-last); last = 0;
            return D().write(id, dir, file, { conflict, mtime: mtimeMs || file.lastModified, signal: j.signal, onProgress: (n) => { j.tick(n - last); last = n; } });
        });
    }

    async function vfsToDrive(j, ref, id, dir) {
        j.check();
        const app = j.app;
        if (app.isFolderItem(ref)) {
            const sub = joinPath(dir, ref.name);
            const made = await D().mkdir(id, sub);
            if (failed(made) && made.code !== 'exists') throw fail(made);
            const listing = await VFS().listDirectory(ref.navPath || app.resolveNavigationPath(ref), { limit: 10000 });
            let skipped = false;
            for (const child of listing.items || []) if ((await vfsToDrive(j, child, id, sub)) === SKIPPED) skipped = true;
            return skipped ? SKIPPED : undefined;
        }
        if (ref.targetKind !== 'user-file') throw { code: 'denied', message: `"${ref.name}" can't be copied to the drive` };
        const resp = await VFS().downloadFile(ref.targetId);
        if (!resp || !resp.downloadUrl) throw { code: 'not_found', message: `Could not read ${ref.name}` };
        const res = await fetch(resp.downloadUrl, { signal: j.signal, credentials: 'same-origin' });
        if (!res.ok) throw { code: 'io', message: `Could not read ${ref.name} (${res.status})` };
        const blob = await res.blob();
        const file = new File([blob], ref.name, { type: blob.type, lastModified: ref.modifiedAt ? ref.modifiedAt * 1000 : Date.now() });
        return (await writeToDrive(j, id, dir, file)) === SKIPPED ? SKIPPED : undefined;
    }

    async function driveToVfs(j, id, entry, vfsDir) {
        j.check();
        if (entry.dir) {
            await VFS().createFolder(vfsDir, entry.name);
            const listing = await VFS().listDirectory(vfsDir, { limit: 10000 });
            const made = (listing.items || []).find((i) => i.kind === 'folder' && i.name === entry.name);
            const sub = made ? (made.navPath || j.app.resolveNavigationPath(made)) : null;
            if (!sub) throw { code: 'io', message: `Could not make the folder "${entry.name}"` };
            const inner = await ask(D().list(id, entry.path));
            for (const child of inner.entries || []) await driveToVfs(j, id, { name: child.name, path: child.path, dir: child.dir, mtime: Math.floor((child.mtime || 0) / 1000) }, sub);
            return;
        }
        const file = await fetchHostFile(j, id, entry.path, entry.name, entry.mtime);
        j.check();
        await IMPORT().routeFilesToPath(vfsDir, [file]);
    }

    async function driveToDrive(j, ref, dst, op) {
        let last = 0;
        return withConflict(j, ref.name, !!ref.host.dir, (conflict) => {
            const fn = op === 'cut' ? D().move : D().copy;
            return fn(ref.host.drive, ref.host.path, dst.root, dst.path, conflict, (done) => { j.tick(done - last); last = done; });
        });
    }

    async function runJob(app, op, refs, from, to, each) {
        let j = null;
        const fop = root.fileOperationProgress;
        const progress = fop && (typeof fop.reports === 'function' ? fop.reports() : fop.available())
            ? fop.begin({ op: op === 'cut' ? 'move' : 'copy', items: refs.map((i) => ({ name: i.name, size: Number(i.size) || 0 })), from: typeof from === 'string' ? app._progressPlace(from) : from, to: typeof to === 'string' ? app._progressPlace(to) : to, onCancel: () => j && j.cancel() })
            : null;
        j = job(app, progress);
        j.bytesTotal = refs.reduce((n, r) => n + (Number(r.size) || 0), 0);
        const done = [];
        const step = async (ref) => {
            try { return (await each(j, ref)) !== SKIPPED && !j.cancelled; } catch (err) {
                if (err && err.code === 'aborted') { j.cancel(); return false; }
                if (err && err.code === 'no_space') { j.cancel(); await message(`There is not enough space on ${typeof to === 'string' ? displayName(to) : 'the disk'}.`, 'Copy Item'); return false; }
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
                    try { if (await step(ref)) done.push(ref); } catch (err) { await message((err && err.message) || String(err), 'Copy Item'); }
                }
            }
        } finally {
            if (progress) progress.finish();
        }
        return { done, cancelled: j.cancelled };
    }

    /** Paste / drop into navPath of refs from a drive or the VFS; false when neither side is a host drive. */
    async function deliver(app, refs, navPath, operation, options = {}) {
        const fromDrive = refs.length && refs.every(isEntryRef);
        const toDrive = isPath(navPath);
        if (!fromDrive && !toDrive) return false;
        const phoneRef = (r) => !!(r && r.phone && r.phone.root);
        if (refs.some(phoneRef) || (refs.some(isEntryRef) && !fromDrive)) {
            await message('Copy the items to a folder on C: first, then from there to the drive.', 'Copy Item', 'info');
            return true;
        }
        const sourcePath = options.sourcePath || app.currentPath;
        const op = options.drag && fromDrive !== toDrive ? 'copy' : operation;
        if (toDrive) {
            const dst = parse(navPath);
            if (!dst.root) return true;
            if (!isWritable(navPath)) { await message('The disk is write-protected.\nRemove the write-protection or use another disk.', 'Copy Item'); return true; }
            if (fromDrive) {
                if (op === 'cut' && refs.every((r) => r.host.drive === dst.root && parentPath(r.host.path) === dst.path)) return true;
                await runJob(app, op, refs, sourcePath, navPath, (j, ref) => driveToDrive(j, ref, dst, op));
            } else {
                const res = await runJob(app, op, refs, sourcePath, navPath, (j, ref) => vfsToDrive(j, ref, dst.root, dst.path));
                if (op === 'cut' && res.done.length && !res.cancelled) {
                    try { await VFS().moveToTrash(res.done, sourcePath); } catch (err) { await message(`Copied, but the originals stayed: ${(err && err.message) || err}`); }
                }
            }
        } else {
            const res = await runJob(app, op, refs, sourcePath, navPath, (j, ref) => driveToVfs(j, ref.host.drive, { name: ref.name, path: ref.host.path, dir: !!ref.host.dir, mtime: ref.modifiedAt }, navPath));
            if (op === 'cut' && res.done.length && !res.cancelled) {
                const id = res.done[0].host.drive;
                await D().remove(id, res.done.filter((r) => r.host.drive === id).map((r) => r.host.path));
            }
        }
        if (navPath === app.currentPath || isPath(app.currentPath)) await app.softRefresh();
        return true;
    }

    async function uploadFiles(app, navPath, files) {
        const dst = parse(navPath);
        if (!dst.root) return;
        await runJob(app, 'copy', [...files], { name: 'This computer', path: '' }, navPath, (j, f) => writeToDrive(j, dst.root, dst.path, f, f.lastModified));
        if (navPath === app.currentPath) await app.softRefresh();
    }

    // ---- Computer -------------------------------------------------------------------------------------------------

    /** Tiles for Computer: { key, name (label), label, letter, icon, total, free, kind, hdd, removable, path } */
    function computerDrives() {
        return drives().map((d) => ({
            key: `host:${d.id}`,
            name: d.name,
            label: d.name,
            letter: d.letter,
            icon: d.removable ? 'drive-removable' : 'drive-fixed',
            total: Number(d.total) || 0,
            free: Number(d.free) || 0,
            kind: d.removable ? 'removable' : 'fixed',
            hdd: !d.removable,
            removable: !!d.removable,
            fileSystem: d.fs || '',
            path: pathFor(d.id, '/')
        }));
    }
    function openComputerDrive(app, key) {
        const d = computerDrives().find((x) => x.key === key);
        if (d) app.navigateTo(d.path);
    }

    function syncPreview() { /* the details pane shows the selection's facts; no preview transport for the host */ }

    const api = {
        PREFIX, available, isPath, isEntry, isEntryRef, parse, pathFor, normalize, attach, leave, list, folders,
        rootName, displayName, displayPath, crumbs, crumbIcon, resolveInput, parentOf, isWritable, open,
        sourceOf, sourceLabel, sourceUrl, isSource, writeText, entryMenuSections, emptyMenuSections, handleAction,
        download, eject, createFolder, rename, remove, deliver, uploadFiles, computerDrives, openComputerDrive,
        syncPreview, programFor, kindOf, fileUrl, drives,
        driveLetter: (id) => (driveInfo(id) || {}).letter || '',
        _test: { entryToItem, sortItems }
    };
    root.explorerHostDrive = api;

    // ---- the router in front of the phone drive -----------------------------------------------------------------
    // Explorer, the Folders tree, Computer and the Open dialog call window.explorerPhoneDrive for every drive that is
    // not Cartograph's: each call goes to the drive its path, item or source belongs to.
    function installRouter() {
        const phone = root.explorerPhoneDrive;
        if (!phone || phone.__hostRouter || !available()) return;
        root.__explorerPhoneDriveOwn = phone;
        const r = Object.assign({}, phone);
        const byPath = (name) => function (path, ...rest) { return (isPath(path) ? api : phone)[name](path, ...rest); };
        const byItem = (name) => function (item, ...rest) { return (isEntry(item) ? api : phone)[name](item, ...rest); };
        const byAppItem = (name) => function (app, item, ...rest) { return (isEntry(item) ? api : phone)[name](app, item, ...rest); };
        const byAppPath = (name) => function (app, ...rest) { return (isPath(app && app.currentPath) ? api : phone)[name](app, ...rest); };
        const bySource = (name) => function (src, ...rest) { return (isSource(src) ? api : phone)[name](src, ...rest); };
        Object.assign(r, {
            __hostRouter: true,
            available: () => phone.available() || available(),
            isPath: (path) => isPath(path) || phone.isPath(path),
            isEntry: (item) => isEntry(item) || phone.isEntry(item),
            isEntryRef: (ref) => isEntryRef(ref) || phone.isEntryRef(ref),
            normalize: byPath('normalize'),
            list: (app, path) => (isPath(path) ? api : phone).list(app, path),
            folders: byPath('folders'),
            displayName: byPath('displayName'),
            displayPath: byPath('displayPath'),
            crumbs: byPath('crumbs'),
            crumbIcon: byPath('crumbIcon'),
            parentOf: byPath('parentOf'),
            isWritable: byPath('isWritable'),
            resolveInput: (text) => resolveInput(text) || phone.resolveInput(text),
            attach: (app) => { attach(app); phone.attach(app); },
            leave: (app) => phone.leave(app),
            open: byAppItem('open'),
            entryMenuSections: byAppItem('entryMenuSections'),
            emptyMenuSections: byAppPath('emptyMenuSections'),
            createFolder: byAppPath('createFolder'),
            syncPreview: (app, sel) => (isPath(app && app.currentPath) ? api : phone).syncPreview(app, sel),
            rename: byAppItem('rename'),
            remove: (app, items, permanent) => (items.length && items.every(isEntry) ? api : phone).remove(app, items, permanent),
            download: (items) => (items.length && items.every(isEntry) ? api : phone).download(items),
            handleAction: (action, item, app) => (String(action).startsWith(ACTION) ? api : phone).handleAction(action, item, app),
            deliver: async (app, refs, navPath, op, opts) => (await deliver(app, refs, navPath, op, opts)) || phone.deliver(app, refs, navPath, op, opts),
            uploadFiles: (app, navPath, files) => (isPath(navPath) ? api : phone).uploadFiles(app, navPath, files),
            openComputerDrive: (app, key) => (String(key).startsWith('host:') ? api : phone).openComputerDrive(app, key),
            sourceUrl: bySource('sourceUrl'),
            sourceLabel: bySource('sourceLabel'),
            writeText: bySource('writeText'),
            // phone-only commands never act on a host file
            sendToMenuItem: (item) => (isEntry(item) ? null : phone.sendToMenuItem(item)),
            openOnPhoneMenuItem: (item) => (isEntry(item) ? null : (phone.openOnPhoneMenuItem ? phone.openOnPhoneMenuItem(item) : null)),
            renderNav: (app) => phone.renderNav(app),
            byItem
        });
        delete r.byItem;
        root.explorerPhoneDrive = r;
    }
    installRouter();
    // a drive that arrives after Explorer loaded (the bridge came up late) still gets the router
    if (!root.explorerPhoneDrive || !root.explorerPhoneDrive.__hostRouter) root.addEventListener('dreamosdrives', installRouter, { once: true, signal: appScopeSignal });

    // the Open dialog reads a drive's files through item.downloadUrl and hostDrivesShell.js's fileOpenPicker source
})(typeof window !== 'undefined' ? window : globalThis);
