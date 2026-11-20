/**
 * Explorer's Network folder (DreamOS #910, Yukimi Nov 20 2026): the other DreamOS computers, as Vista's Network
 * lists the computers of the network, and the folders each one shares, as \\PC lists its shares. Only what a
 * computer shares is reachable; nothing else of its file system shows. A DreamOS computer is never a portable
 * device or a drive (explorerComputerView.js, activeSyncRemoteStorage.js leave platform 'cafeready' out), and the
 * computer this page runs on is never in its own Network.
 *
 * Places (Explorer's currentPath strings):
 *   net://                              Network: every computer listed for this page (whether it shares or not)
 *   net://<deviceId>                    \\NAME: the folders it shares (empty while it shares nothing)
 *   net://<deviceId>/<share>/<path>     a folder inside a share; address box \\NAME\share\folder
 *
 * The list comes from the server (modules/networkShares.js): net_computers once, then net_computers_updated pushed
 * when computers come and go or change what they share (never polled). Folder work inside a share goes over
 * net_share_call (storage.* with root 'share' on that computer); file bodies over the ActiveSync transfer routes:
 * GET /api/activesync/file/<id>/share/<share>/<path> and POST /api/activesync/upload/<id>/begin { root: 'share',
 * dir: '/<share>/<dir>' } ... commit. The server checks the user's access (the share's people and permissions,
 * Reader = read only), the computer checks again.
 *
 * Network discovery off on this computer (Network and Sharing Center, DreamOS shares.rs): nothing is listed, and
 * the folder says so in Vista's information bar.
 *
 * Like explorerHostDrive.js, this installs a router in front of window.explorerPhoneDrive: every place that knows
 * the phone's and the host's drives (Explorer, the Folders tree, the Open dialog) hands net:// paths and network
 * items here.
 */
(function (root) {
    'use strict';

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const PREFIX = 'net://';
    const ACTION = 'explorer-net-';
    const ART = '/static_images/vista-explorer';
    const VFS = () => (typeof vfsClient !== 'undefined' ? vfsClient : root.vfsClient);
    const IMPORT = () => (typeof vfsImportRouter !== 'undefined' ? vfsImportRouter : root.vfsImportRouter);
    const WS = () => (root.wsClient && typeof root.wsClient.sendMessage === 'function' ? root.wsClient : null);
    const SHARES = () => root.DreamOSShares || null;
    const apps = new Set();

    function esc(text) {
        return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function message(text, title, icon) {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        const cls = { error: 'fas fa-circle-xmark', warning: 'fas fa-triangle-exclamation', info: 'fas fa-circle-info' }[icon || 'error'];
        return root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-primary' }], null, { title: title || 'Network Error', icon: cls });
    }

    // ---- the computers (pushed by the server) --------------------------------------------------------------------

    let view = { self: null, discovery: true, computers: [] };
    let loaded = false;
    let watching = false;
    let asking = null;

    /** This computer's own ActiveSync id (the CaféReady identity through the shell bridge), or ''. */
    function selfId() {
        try { const s = SHARES(); return s && typeof s.deviceId === 'function' ? String(s.deviceId() || '').toLowerCase() : ''; } catch (_) { return ''; }
    }
    /** Network discovery on this computer (a DreamOS machine's own setting; elsewhere on). */
    function discoveryOn() {
        try {
            const s = SHARES();
            const st = s && typeof s.get === 'function' ? s.get() : null;
            if (st && typeof st.discovery === 'boolean') return st.discovery;
        } catch (_) { /* no bridge */ }
        return view.discovery !== false;
    }

    function take(data) {
        if (!data || data.success === false) return;
        view = { self: data.self || null, discovery: data.discovery !== false, computers: Array.isArray(data.computers) ? data.computers : [] };
        loaded = true;
        changed();
    }

    function ask() {
        const ws = WS();
        if (!ws) return Promise.resolve(view);
        if (!asking) {
            asking = ws.sendMessage('net_computers', {}, false).then((d) => { take(d); return view; }, () => view).finally(() => { asking = null; });
        }
        return asking;
    }

    /** Start listening (once per page): the list now, then the server's pushes; a new socket asks again. */
    function watch() {
        if (watching) return loaded ? Promise.resolve(view) : ask();
        const ws = WS();
        if (!ws || typeof ws.on !== 'function') return Promise.resolve(view);
        watching = true;
        ws.on('net_computers_updated', (msg) => take((msg && msg.data) || msg), { signal: appScopeSignal });
        ws.on('connected', () => { void ask(); }, { signal: appScopeSignal });
        // this computer's own sharing settings changed (Network discovery on or off): the folder redraws
        root.addEventListener('dreamosshares', changed, { signal: appScopeSignal });
        return ask();
    }

    /** The computers this page shows: never itself, nothing while its Network discovery is off. */
    function computers() {
        if (!discoveryOn()) return [];
        const me = selfId() || (view.self || '');
        return view.computers.filter((c) => c.deviceId !== me);
    }
    function computer(id) { return computers().find((c) => c.deviceId === id) || null; }
    function computerByName(name) { const n = String(name || '').toLowerCase(); return computers().find((c) => String(c.name).toLowerCase() === n) || null; }

    let redrawQueued = false;
    function changed() {
        if (redrawQueued) return;
        redrawQueued = true;
        Promise.resolve().then(() => {
            redrawQueued = false;
            apps.forEach((app) => {
                try {
                    const p = parse(app.currentPath);
                    // a computer that went away (or stopped sharing what is open): back to Network, as Vista does
                    if (isPath(app.currentPath)) {
                        if (p.device && !computer(p.device)) app.navigateTo(PREFIX);
                        else if (p.device && p.share && !shareOf(p.device, p.share)) app.navigateTo(pathFor(p.device));
                        else if (!p.share) void app.softRefresh();
                    }
                    // the Folders tree's Network node lists the computers anew (one may have come or gone)
                    const v = app.vista;
                    if (v && v.el && v.el.tree && v.el.tree.childElementCount && isPath(app.currentPath) && typeof v.renderTreeRoot === 'function') { v.renderTreeRoot(); void v.syncTree(); }
                    else if (typeof app._syncVistaTree === 'function') app._syncVistaTree();
                    syncInfoBar(app);
                } catch (_) { /* a closed window */ }
            });
        });
    }

    function shareOf(deviceId, name) {
        const c = computer(deviceId);
        const n = String(name || '').toLowerCase();
        return c ? (c.shares || []).find((s) => s.name.toLowerCase() === n) || null : null;
    }

    // ---- paths ----------------------------------------------------------------------------------------------------

    function isPath(path) { return typeof path === 'string' && path.startsWith(PREFIX); }
    function parse(path) {
        const rest = String(path || '').slice(PREFIX.length).replace(/\/+$/, '');
        const parts = rest ? rest.split('/') : [];
        const device = parts.length ? decodeURIComponent(parts[0]).toLowerCase() : null;
        const share = parts.length > 1 ? decodeURIComponent(parts[1]) : null;
        const inner = parts.length > 2 ? `/${parts.slice(2).map(decodeURIComponent).join('/')}` : '/';
        return { device, share, path: inner };
    }
    function pathFor(device, share, inner) {
        let p = PREFIX;
        if (!device) return p;
        p += encodeURIComponent(device);
        if (!share) return p;
        p += `/${encodeURIComponent(share)}`;
        const parts = String(inner || '/').split('/').filter(Boolean);
        return parts.length ? `${p}/${parts.map(encodeURIComponent).join('/')}` : p;
    }
    function normalize(path) { const p = parse(path); return pathFor(p.device, p.share, p.path); }
    function isEntry(item) { return !!(item && /^net-(computer|share|entry)$/.test(item.targetKind || '')); }
    function isEntryRef(ref) { return !!(ref && ref.net && ref.net.share); }
    function joinPath(dir, name) { return `${String(dir || '/').replace(/\/+$/, '')}/${name}`.replace(/^\/*/, '/'); }
    function parentPath(path) { const parts = String(path || '/').split('/').filter(Boolean); parts.pop(); return '/' + parts.join('/'); }
    function fileUrl(device, share, path, download) {
        const inner = String(path || '/').split('/').filter(Boolean).map(encodeURIComponent).join('/');
        return `/api/activesync/file/${encodeURIComponent(device)}/share/${encodeURIComponent(share)}/${inner}${download ? '?download=1' : ''}`;
    }

    // ---- the computer's share calls -------------------------------------------------------------------------------

    async function shareCall(device, share, op, args) {
        const ws = WS();
        if (!ws) throw { code: 'offline', message: 'The network is not available.' };
        const r = await ws.sendMessage('net_share_call', Object.assign({ deviceId: device, share, op }, args || {}), false);
        if (!r || r.success === false) throw { code: (r && r.code) || 'io', message: (r && r.error) || 'The computer did not answer.' };
        return r.result;
    }

    // ---- listing --------------------------------------------------------------------------------------------------

    const COMPUTER_ICON = 'net-computer';
    function computerItem(c) {
        return {
            id: `net-computer:${c.deviceId}`, name: c.name, kind: 'folder', targetKind: 'net-computer', navPath: pathFor(c.deviceId),
            icon: 'fas fa-desktop', previewUrl: `${ART}/${COMPUTER_ICON}-48.png`, mimeType: '',
            net: { device: c.deviceId, computer: true }
        };
    }
    function shareItem(c, s) {
        return {
            // a share this user may not use has no way in: opening it answers Access is denied (open())
            id: `net-share:${c.deviceId}:${s.name}`, name: s.name, kind: 'folder', targetKind: 'net-share', navPath: s.access === 'none' ? undefined : pathFor(c.deviceId, s.name),
            // a share is imageres.dll 143 (the folder on a network pipe), as \\PC lists them on the VM
            icon: 'fas fa-folder', previewUrl: `${ART}/net-share-48.png`, mimeType: '', comment: s.comment || '',
            net: { device: c.deviceId, share: s.name, path: '/', dir: true, access: s.access || 'none', isShare: true }
        };
    }
    function entryItem(device, share, access, e) {
        const dir = !!e.dir;
        const item = {
            id: `net:${device}:${share}:${e.path}`, name: e.name, kind: dir ? 'folder' : 'file', targetKind: 'net-entry',
            mimeType: e.mime || '', icon: dir ? 'fas fa-folder' : 'fas fa-file',
            modifiedAt: Math.floor((Number(e.mtime) || 0) / 1000),
            net: { device, share, path: e.path, dir, access, hidden: !!e.hidden }
        };
        if (dir) item.navPath = pathFor(device, share, e.path);
        else {
            item.size = Number(e.size) || 0;
            item.downloadUrl = fileUrl(device, share, e.path);
            if (/^image\/(jpeg|png|gif|webp|bmp)$/.test(item.mimeType) && item.size < 16 * 1024 * 1024) item.previewUrl = item.downloadUrl;
        }
        return item;
    }

    function sortItems(items, field, direction) {
        const dir = direction === 'desc' ? -1 : 1;
        const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' });
        const cmp = {
            date: (a, b) => (a.modifiedAt || 0) - (b.modifiedAt || 0) || byName(a, b),
            size: (a, b) => (a.size || 0) - (b.size || 0) || byName(a, b),
            type: (a, b) => String(a.mimeType).localeCompare(String(b.mimeType)) || byName(a, b)
        }[field] || byName;
        return items.slice().sort((a, b) => ((a.kind === 'folder' ? 0 : 1) - (b.kind === 'folder' ? 0 : 1)) || cmp(a, b) * dir);
    }

    function attach(app) { if (app) apps.add(app); void watch(); }
    function leave() { /* nothing is watched on a computer */ }

    async function list(app, path) {
        attach(app);
        if (!loaded) await watch();
        const out = (items, empty) => ({ path, items, totalCount: items.length, totalSizeBytes: items.reduce((n, i) => n + (i.size || 0), 0), hasMore: false, emptyMessage: empty || null });
        const p = parse(path);
        if (!p.device) return out(sortItems(computers().map(computerItem), 'name', 'asc'), '');
        const c = computer(p.device);
        if (!c) throw new Error('Windows cannot access this computer. It is not on the network now.');
        // \\NAME: its shares (none while File sharing is off there); an empty view when it shares nothing
        if (!p.share) return out(sortItems((c.shares || []).map((s) => shareItem(c, s)), 'name', 'asc'), '');
        const s = shareOf(c.deviceId, p.share);
        if (!s) throw new Error(`\\\\${c.name}\\${p.share} is not accessible. The network name cannot be found.`);
        const r = await shareCall(c.deviceId, s.name, 'list', { path: p.path }).catch((err) => { throw new Error(err.message); });
        const hidden = typeof app.showHidden === 'boolean' ? app.showHidden : false;
        const items = ((r && r.entries) || []).filter((e) => !e.system && (hidden || !e.hidden)).map((e) => entryItem(c.deviceId, s.name, s.access, e));
        return out(sortItems(items, app.sortField, app.sortDirection), 'This folder is empty.');
    }

    /** Folders tree: Network's computers, a computer's shares, a share's folders. */
    async function folders(path) {
        await watch();
        const p = parse(path);
        if (!p.device) return computers().map((c) => ({ name: c.name, path: pathFor(c.deviceId), icon: 'net-computer' }));
        const c = computer(p.device);
        if (!c) return [];
        if (!p.share) return (c.shares || []).map((s) => ({ name: s.name, path: pathFor(c.deviceId, s.name), leaf: s.access === 'none' }));
        try {
            const r = await shareCall(c.deviceId, p.share, 'list', { path: p.path });
            return ((r && r.entries) || []).filter((e) => e.dir && !e.hidden && !e.system).map((e) => ({ name: e.name, path: pathFor(c.deviceId, p.share, e.path) }))
                .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
        } catch (_) { return []; }
    }

    // ---- names, address box, breadcrumb ---------------------------------------------------------------------------

    function computerName(id) { const c = computer(id); return c ? c.name : 'Computer'; }
    function displayName(path) {
        const p = parse(path);
        if (!p.device) return 'Network';
        if (!p.share) return computerName(p.device);
        return p.path === '/' ? p.share : p.path.split('/').filter(Boolean).pop();
    }
    /** Vista's address box: Network, then \\NAME\share\folder */
    function displayPath(path) {
        const p = parse(path);
        if (!p.device) return 'Network';
        const parts = [computerName(p.device)];
        if (p.share) parts.push(p.share, ...p.path.split('/').filter(Boolean));
        return `\\\\${parts.join('\\')}`;
    }
    function crumbs(path) {
        const p = parse(path);
        const list = [{ label: 'Network', path: PREFIX }];
        if (!p.device) return list;
        list.push({ label: computerName(p.device), path: pathFor(p.device) });
        if (!p.share) return list;
        list.push({ label: p.share, path: pathFor(p.device, p.share) });
        const parts = p.path.split('/').filter(Boolean);
        parts.forEach((part, i) => list.push({ label: part, path: pathFor(p.device, p.share, '/' + parts.slice(0, i + 1).join('/')) }));
        return list;
    }
    function crumbIcon(path) {
        const p = parse(path);
        if (!p.device) return 'net-place-16.png';
        if (!p.share) return `${COMPUTER_ICON}-16.png`;
        return p.path === '/' ? 'net-share-16.png' : 'crumb-folder.png';
    }
    /** "Network", \\NAME, \\NAME\share\folder (typed in the address box or Run) */
    function resolveInput(text) {
        const input = String(text || '').trim();
        if (input.startsWith(PREFIX)) return normalize(input);
        if (/^network$/i.test(input)) return PREFIX;
        const m = /^\\\\([^\\/]+)(?:[\\/](.*))?$/.exec(input);
        if (!m) return null;
        const c = computerByName(m[1]);
        if (!c) return null;
        const parts = String(m[2] || '').split(/[\\/]+/).filter(Boolean);
        return pathFor(c.deviceId, parts[0] || null, '/' + parts.slice(1).join('/'));
    }
    /** Up: a folder -> its parent, a share -> the computer, a computer -> Network, Network -> the Desktop. */
    function parentOf(path) {
        const p = parse(path);
        if (!p.device) {
            const ws = typeof root.activeWorkspace !== 'undefined' && root.activeWorkspace ? root.activeWorkspace : (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null); // eslint-disable-line no-undef
            return ws ? `/Workspaces/${ws}/Desktop` : '/';
        }
        if (!p.share) return PREFIX;
        if (p.path === '/') return pathFor(p.device);
        return pathFor(p.device, p.share, parentPath(p.path));
    }
    function accessAt(path) {
        const p = parse(path);
        const s = p.share ? shareOf(p.device, p.share) : null;
        return s ? s.access : 'none';
    }
    function isWritable(path) { const a = accessAt(path); return a === 'change' || a === 'full'; }

    // ---- open -----------------------------------------------------------------------------------------------------

    function sourceOf(item) { return { kind: 'net', device: item.net.device, share: item.net.share, path: item.net.path, name: item.name, size: item.size || 0, mime: item.mimeType || '', mtime: item.modifiedAt || 0 }; }
    function sourceLabel(src) { return `\\\\${computerName(src.device)}\\${src.share}${src.path.replace(/\//g, '\\')}`; }
    function sourceUrl(src) { return fileUrl(src.device, src.share, src.path); }
    function isSource(src) { return !!(src && src.kind === 'net'); }

    function kindOf(name, mime) {
        const pd = root.__explorerPhoneDriveOwn;
        return pd && typeof pd.kindOf === 'function' ? pd.kindOf(name, mime) : 'other';
    }

    async function denied(item) {
        const c = computer(item.net.device);
        await message(`\\\\${c ? c.name : 'computer'}\\${item.net.share} is not accessible. You might not have permission to use this network resource. Contact the administrator of this server to find out if you have access permissions.\n\nAccess is denied.`, `\\\\${c ? c.name : 'computer'}\\${item.net.share}`);
    }

    async function open(app, item) {
        if (item.targetKind === 'net-computer') { app.navigateTo(item.navPath); return; }
        // Vista: a share you may not use answers Access is denied before anything opens
        if (item.net && item.net.access === 'none') { await denied(item); return; }
        if (item.net && item.net.dir) { app.navigateTo(item.navPath); return; }
        const src = sourceOf(item);
        const url = sourceUrl(src);
        const kind = kindOf(item.name, item.mimeType);
        try {
            if (kind === 'image' && typeof root.openImageInViewer === 'function') {
                const rows = [];
                (app && app.items ? app.items : [item]).filter((i) => i.net && !i.net.dir && kindOf(i.name, i.mimeType) === 'image')
                    .forEach((i) => rows.push({ url: i.downloadUrl, base: sourceLabel(sourceOf(i)), title: i.name, siblings: rows }));
                root.openImageInViewer(url, sourceLabel(src), rows.find((r) => r.url === url) || { url, base: sourceLabel(src), title: item.name, siblings: rows });
            } else if (kind === 'media' && root.featureLoader) {
                await root.featureLoader.loadFeature('media_player');
                root.openDesktopMediaPlayerUrl(url, item.name);
            } else if (kind === 'pdf' && typeof root.openPdfDocument === 'function') {
                root.openPdfDocument(url, item.name);
            } else {
                await message(`Copy "${item.name}" to a folder on this computer to open it.`, 'Open With', 'info');
            }
        } catch (err) {
            await message((err && err.message) || String(err), 'Explorer');
        }
    }

    // ---- menus ----------------------------------------------------------------------------------------------------

    function entryMenuSections(app, item) {
        const def = (text) => ({ icon: 'fas fa-folder-open', text, action: 'explorer-open', className: 'context-menu-item-default' });
        if (item.targetKind === 'net-computer') return [{ type: 'list', items: [def('Open')] }];
        if (item.targetKind === 'net-share') {
            const items = [def('Open')];
            items.push({ separator: true }, { icon: 'fas fa-copy', text: 'Copy', action: 'explorer-copy', disabled: item.net.access === 'none' });
            return [{ type: 'list', items }];
        }
        const file = !item.net.dir;
        const writable = item.net.access === 'change' || item.net.access === 'full';
        const items = [def('Open')];
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

    function emptyMenuSections(app) {
        const p = parse(app.currentPath);
        const items = [{ icon: 'fas fa-rotate', text: 'Refresh', action: `${ACTION}refresh` }];
        if (p.share && isWritable(app.currentPath)) {
            items.push({ separator: true });
            if (app.clipboard) items.push({ icon: 'fas fa-paste', text: 'Paste', action: 'explorer-paste' });
            items.push({ icon: 'fas fa-folder-plus', text: 'New Folder', action: 'explorer-new-folder' });
        }
        return [{ type: 'list', items }];
    }

    async function handleAction(action, item, app) {
        const what = action.slice(ACTION.length);
        const sel = app && app.grid ? app.grid.getSelectedItems() : [];
        const many = item && sel.some((s) => s.id === item.id) ? sel : (item ? [item] : sel);
        switch (what) {
            case 'download': download(many); break;
            case 'paste-into': if (item && item.navPath) await app.pasteToPath(item.navPath); break;
            case 'refresh': await ask(); await app.softRefresh(); break;
            default: break;
        }
    }

    function download(items) {
        items.filter((i) => i.net && !i.net.dir && i.net.share).forEach((i) => {
            const a = document.createElement('a');
            a.href = fileUrl(i.net.device, i.net.share, i.net.path, true);
            a.download = i.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
        });
    }

    // ---- folder work inside a share (Contributor and Co-owner) ---------------------------------------------------

    function deniedWrite() { return message('You need permission to perform this action.', 'Destination Folder Access Denied'); }

    async function createFolder(app) {
        const p = parse(app.currentPath);
        if (!p.share) return;
        if (!isWritable(app.currentPath)) { await deniedWrite(); return; }
        for (let n = 1; n < 50; n += 1) {
            const name = n === 1 ? 'New Folder' : `New Folder (${n})`;
            try {
                await shareCall(p.device, p.share, 'mkdir', { path: joinPath(p.path, name) });
            } catch (err) {
                if (err && /exist/i.test(err.code || '')) continue;
                await message(err.message || String(err), 'Error Creating Folder');
            }
            await app.softRefresh();
            return;
        }
    }

    async function rename(app, item) {
        if (!item || item.targetKind !== 'net-entry') return;
        if (!isWritable(pathFor(item.net.device, item.net.share))) { await deniedWrite(); return; }
        const name = typeof root.showInputDialog === 'function' ? await root.showInputDialog('Type a new name:', item.name, '', null, null, { title: 'Rename' }) : null;
        if (!name || name === item.name) return;
        try { await shareCall(item.net.device, item.net.share, 'rename', { path: item.net.path, name }); } catch (err) {
            await message(err && /exist/i.test(err.code || '') ? 'There is already a file with the same name as the file name you specified. Specify a different file name.' : (err.message || String(err)), 'Error Renaming File or Folder');
        }
        await app.softRefresh();
    }

    /** Vista on a network share: delete is permanent, after its own question. */
    async function remove(app, items) {
        const entries = items.filter((i) => i.targetKind === 'net-entry');
        if (!entries.length) return;
        if (!isWritable(pathFor(entries[0].net.device, entries[0].net.share))) { await deniedWrite(); return; }
        const one = entries.length === 1 ? entries[0] : null;
        const title = one ? (one.net.dir ? 'Delete Folder' : 'Delete File') : 'Delete Multiple Items';
        const text = one ? `Are you sure you want to permanently delete this ${one.net.dir ? 'folder' : 'file'}?\n\n${one.name}` : `Are you sure you want to permanently delete these ${entries.length} items?`;
        const ok = typeof root.showConfirmationDialog === 'function'
            ? await root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'Yes', value: true, className: 'btn-primary' }, { text: 'No', value: false }], null, { title, icon: 'fas fa-triangle-exclamation' })
            : false;
        if (!ok) return;
        try { await shareCall(entries[0].net.device, entries[0].net.share, 'delete', { paths: entries.map((e) => e.net.path) }); } catch (err) {
            await message(err.message || String(err), 'Error Deleting File or Folder');
        }
        await app.softRefresh();
    }

    // ---- transfers: the existing ActiveSync routes, under Vista's progress dialog ----------------------------------

    const SKIPPED = Object.freeze({ skipped: true });
    const HOST = () => root.explorerHostDrive || null;

    function job(app, progress) {
        const ctl = new AbortController();
        return {
            app, progress, signal: ctl.signal, cancelled: false, bytesDone: 0, bytesTotal: 0,
            cancel() { this.cancelled = true; ctl.abort(); },
            tick(n) { this.bytesDone += n; if (this.progress) this.progress.progress(this.bytesDone, this.bytesTotal || undefined); },
            check() { if (this.cancelled || (this.progress && this.progress.cancelled)) throw { code: 'aborted', message: 'Cancelled' }; }
        };
    }

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

    /** A file in a share as a File, streamed so the bar moves. */
    async function fetchShareFile(j, device, share, path, name, mtimeSec) {
        const res = await fetch(fileUrl(device, share, path), { signal: j.signal, credentials: 'same-origin' });
        if (!res.ok) {
            let d = {};
            try { d = await res.json(); } catch (_) { /* no body */ }
            throw { code: d.code || (res.status === 404 ? 'not_found' : 'io'), message: d.error || `Could not read ${name} (${res.status})` };
        }
        const reader = res.body.getReader();
        const parts = [];
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            parts.push(value);
            j.tick(value.byteLength);
        }
        return new File(parts, name, { type: res.headers.get('content-type') || '', lastModified: mtimeSec ? mtimeSec * 1000 : Date.now() });
    }

    async function post(url, body, signal, json) {
        const res = await fetch(url, {
            method: 'POST', credentials: 'same-origin', signal: signal || undefined,
            headers: { 'Content-Type': json ? 'application/json' : 'application/octet-stream' },
            body: json ? JSON.stringify(body) : body
        });
        let data = null;
        try { data = await res.json(); } catch (_) { /* no body */ }
        return { status: res.status, data: data || {} };
    }

    function transferId() {
        const bytes = new Uint8Array(16);
        root.crypto.getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }

    /** A File into a folder of a share: to the server in chunks, then the computer pulls it (its half of the bar). */
    async function writeToShare(j, device, share, dir, file) {
        let conflict = j.conflict || 'fail';
        for (;;) {
            j.check();
            const id = transferId();
            const begun = await post(`/api/activesync/upload/${encodeURIComponent(device)}/begin`, {
                id, root: 'share', dir: `/${share}${dir === '/' ? '' : dir}`, name: file.name, size: file.size, conflict, mtime: file.lastModified || undefined
            }, j.signal, true);
            if (begun.status !== 200) throw { code: begun.data.code, message: begun.data.error };
            const giveUp = () => { fetch(`/api/activesync/upload/${id}`, { method: 'DELETE', credentials: 'same-origin' }).catch(() => {}); };
            const chunk = begun.data.chunkSize || 4 * 1024 * 1024;
            let offset = 0;
            let sentBytes = 0;
            try {
                while (offset < file.size) {
                    j.check();
                    const sent = await post(`/api/activesync/upload/${id}/chunk?offset=${offset}`, file.slice(offset, Math.min(file.size, offset + chunk)), j.signal, false);
                    if ((sent.status !== 200 && sent.status !== 409) || typeof sent.data.received !== 'number') throw { code: sent.data.code, message: sent.data.error || 'The upload failed.' };
                    j.tick(sent.data.received - offset);
                    sentBytes += sent.data.received - offset;
                    offset = sent.data.received;
                }
                const done = await post(`/api/activesync/upload/${id}/commit`, {}, null, true);
                if (done.status === 200) return done.data.entry;
                const code = String(done.data.code || '').toUpperCase();
                if (code === 'EXISTS' && conflict === 'fail') {
                    j.tick(-sentBytes);
                    const choice = await askConflict(file.name, false);
                    if (choice === 'cancel') { j.cancel(); throw { code: 'aborted' }; }
                    if (choice === 'skip') return SKIPPED;
                    conflict = choice;
                    continue;
                }
                throw { code: done.data.code, message: done.data.error };
            } catch (err) {
                giveUp();
                throw err;
            }
        }
    }

    /** A share's folder (or file) into Cartograph's folders. */
    async function shareToVfs(j, ref, vfsDir) {
        j.check();
        if (ref.net.dir) {
            await VFS().createFolder(vfsDir, ref.name);
            const listing = await VFS().listDirectory(vfsDir, { limit: 10000 });
            const made = (listing.items || []).find((i) => i.kind === 'folder' && i.name === ref.name);
            const sub = made ? (made.navPath || j.app.resolveNavigationPath(made)) : null;
            if (!sub) throw { code: 'io', message: `Could not make the folder "${ref.name}"` };
            const inner = await shareCall(ref.net.device, ref.net.share, 'list', { path: ref.net.path });
            for (const e of (inner && inner.entries) || []) await shareToVfs(j, entryItem(ref.net.device, ref.net.share, ref.net.access, e), sub);
            return undefined;
        }
        const file = await fetchShareFile(j, ref.net.device, ref.net.share, ref.net.path, ref.name, ref.modifiedAt);
        j.check();
        await IMPORT().routeFilesToPath(vfsDir, [file]);
        return undefined;
    }

    /** A share's folder (or file) onto this machine's own drive (DreamOS, explorerHostDrive.js). */
    async function shareToDrive(j, ref, dst) {
        j.check();
        const D = root.DreamOSDrives;
        if (ref.net.dir) {
            const sub = joinPath(dst.path, ref.name);
            const made = await D.mkdir(dst.root, sub);
            if (made && made.error && made.code !== 'exists') throw { code: made.code, message: made.error };
            const inner = await shareCall(ref.net.device, ref.net.share, 'list', { path: ref.net.path });
            for (const e of (inner && inner.entries) || []) await shareToDrive(j, entryItem(ref.net.device, ref.net.share, ref.net.access, e), { root: dst.root, path: sub });
            return undefined;
        }
        const file = await fetchShareFile(j, ref.net.device, ref.net.share, ref.net.path, ref.name, ref.modifiedAt);
        let conflict = j.conflict || 'fail';
        for (;;) {
            const r = await D.write(dst.root, dst.path, file, { conflict, mtime: file.lastModified, signal: j.signal });
            if (r && r.error && r.code === 'exists' && conflict === 'fail') {
                const choice = await askConflict(file.name, false);
                if (choice === 'cancel') { j.cancel(); throw { code: 'aborted' }; }
                if (choice === 'skip') return SKIPPED;
                conflict = choice;
                continue;
            }
            if (r && r.error) throw { code: r.code, message: r.error };
            return undefined;
        }
    }

    /** Cartograph's items, a drive's or another share's into a share. */
    async function intoShare(j, ref, dst) {
        j.check();
        const app = j.app;
        const sub = () => joinPath(dst.path, ref.name);
        const mkdir = async () => {
            try { await shareCall(dst.device, dst.share, 'mkdir', { path: sub() }); } catch (err) { if (!err || !/exist/i.test(err.code || '')) throw err; }
            return { device: dst.device, share: dst.share, path: sub() };
        };
        if (isEntryRef(ref)) {
            if (ref.net.dir) {
                const inner = await shareCall(ref.net.device, ref.net.share, 'list', { path: ref.net.path });
                const next = await mkdir();
                for (const e of (inner && inner.entries) || []) await intoShare(j, entryItem(ref.net.device, ref.net.share, ref.net.access, e), next);
                return undefined;
            }
            const file = await fetchShareFile(j, ref.net.device, ref.net.share, ref.net.path, ref.name, ref.modifiedAt);
            return writeToShare(j, dst.device, dst.share, dst.path, file);
        }
        if (ref.host && ref.host.drive) {
            const D = root.DreamOSDrives;
            if (ref.host.dir) {
                const inner = await D.list(ref.host.drive, ref.host.path);
                if (inner && inner.error) throw { code: inner.code, message: inner.error };
                const next = await mkdir();
                for (const e of (inner && inner.entries) || []) {
                    if (e.system) continue;
                    await intoShare(j, { name: e.name, size: Number(e.size) || 0, host: { drive: ref.host.drive, path: e.path, dir: !!e.dir } }, next);
                }
                return undefined;
            }
            const res = await fetch(D.fileUrl(ref.host.drive, ref.host.path), { signal: j.signal });
            if (!res.ok) throw { code: 'io', message: `Could not read ${ref.name}` };
            const file = new File([await res.blob()], ref.name, { lastModified: ref.modifiedAt ? ref.modifiedAt * 1000 : Date.now() });
            return writeToShare(j, dst.device, dst.share, dst.path, file);
        }
        if (app.isFolderItem(ref)) {
            const next = await mkdir();
            const listing = await VFS().listDirectory(ref.navPath || app.resolveNavigationPath(ref), { limit: 10000 });
            for (const child of listing.items || []) await intoShare(j, child, next);
            return undefined;
        }
        if (ref.targetKind !== 'user-file') throw { code: 'denied', message: `"${ref.name}" can't be copied to the network folder` };
        const resp = await VFS().downloadFile(ref.targetId);
        if (!resp || !resp.downloadUrl) throw { code: 'not_found', message: `Could not read ${ref.name}` };
        const res = await fetch(resp.downloadUrl, { signal: j.signal, credentials: 'same-origin' });
        if (!res.ok) throw { code: 'io', message: `Could not read ${ref.name} (${res.status})` };
        const blob = await res.blob();
        return writeToShare(j, dst.device, dst.share, dst.path, new File([blob], ref.name, { type: blob.type, lastModified: ref.modifiedAt ? ref.modifiedAt * 1000 : Date.now() }));
    }

    function placeLabel(app, path) {
        if (isPath(path)) return { name: displayName(path), path: displayPath(path) };
        return typeof app._progressPlace === 'function' ? app._progressPlace(path) : { name: path, path };
    }

    async function runJob(app, op, refs, from, to, each) {
        let j = null;
        const fop = root.fileOperationProgress;
        const progress = fop && (typeof fop.reports === 'function' ? fop.reports() : fop.available())
            ? fop.begin({ op: op === 'cut' ? 'move' : 'copy', items: refs.map((i) => ({ name: i.name, size: Number(i.size) || 0 })), from: placeLabel(app, from), to: placeLabel(app, to), onCancel: () => j && j.cancel() })
            : null;
        j = job(app, progress);
        j.bytesTotal = refs.reduce((n, r) => n + (Number(r.size) || 0), 0);
        const done = [];
        const step = async (ref) => {
            try { return (await each(j, ref)) !== SKIPPED && !j.cancelled; } catch (err) {
                if (err && err.code === 'aborted') { j.cancel(); return false; }
                const code = String((err && err.code) || '').toUpperCase();
                if (code === 'ACCESS_DENIED') { j.cancel(); await deniedWrite(); return false; }
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

    /** Paste / drop into navPath of refs where either side is a share; false when neither is. */
    async function deliver(app, refs, navPath, operation, options = {}) {
        const fromShare = refs.length && refs.every(isEntryRef);
        const toShare = isPath(navPath) && !!parse(navPath).share;
        if (!fromShare && !toShare) {
            if (isPath(navPath)) { await message('You can only copy into a shared folder.', 'Copy Item', 'info'); return true; }
            return false;
        }
        if (refs.some(isEntryRef) && !fromShare) { await message("Copy the network folder's items and this computer's items separately.", 'Copy Item', 'info'); return true; }
        const sourcePath = options.sourcePath || app.currentPath;
        // a move off another computer copies (Vista: dragging between computers copies); a cut from a share you may
        // change deletes the originals once they are here
        const op = options.drag ? 'copy' : operation;
        if (toShare) {
            const dst = parse(navPath);
            if (!isWritable(navPath)) { await deniedWrite(); return true; }
            const res = await runJob(app, op, refs, sourcePath, navPath, (j, ref) => intoShare(j, ref, { device: dst.device, share: dst.share, path: dst.path }));
            if (op === 'cut' && res.done.length && !res.cancelled) await originalsGone(app, res.done, sourcePath);
        } else {
            const host = HOST();
            const toDrive = host && host.isPath(navPath) ? host.parse(navPath) : null;
            if (toDrive && !toDrive.root) return true;
            const pd = root.__explorerPhoneDriveOwn;
            if (!toDrive && pd && pd.isPath(navPath)) { await message('Copy the items to this computer first.', 'Copy Item', 'info'); return true; }
            const res = await runJob(app, op, refs, sourcePath, navPath, (j, ref) => (toDrive ? shareToDrive(j, ref, toDrive) : shareToVfs(j, ref, navPath)));
            if (op === 'cut' && res.done.length && !res.cancelled && isWritable(sourcePath)) {
                try { await shareCall(res.done[0].net.device, res.done[0].net.share, 'delete', { paths: res.done.map((r) => r.net.path) }); } catch (err) {
                    await message(`Copied, but the originals stayed: ${(err && err.message) || err}`, 'Move Item', 'info');
                }
            }
        }
        if (navPath === app.currentPath || isPath(app.currentPath)) await app.softRefresh();
        return true;
    }

    async function originalsGone(app, done, sourcePath) {
        try {
            if (done.every(isEntryRef)) await shareCall(done[0].net.device, done[0].net.share, 'delete', { paths: done.map((r) => r.net.path) });
            else if (done.every((r) => r.host && r.host.drive)) await root.DreamOSDrives.remove(done[0].host.drive, done.map((r) => r.host.path));
            else await VFS().moveToTrash(done, sourcePath);
        } catch (err) { await message(`Copied, but the originals stayed: ${(err && err.message) || err}`, 'Move Item', 'info'); }
    }

    async function uploadFiles(app, navPath, files) {
        const dst = parse(navPath);
        if (!dst.share) return;
        if (!isWritable(navPath)) { await deniedWrite(); return; }
        await runJob(app, 'copy', [...files], { name: 'This computer', path: '' }, navPath, (j, f) => writeToShare(j, dst.device, dst.share, dst.path, f));
        if (navPath === app.currentPath) await app.softRefresh();
    }

    // ---- Vista's information bar: Network discovery is off -------------------------------------------------------

    function syncInfoBar(app) {
        const modal = app && app.modal;
        if (!modal) return;
        const host = modal.querySelector('#explorerGridHost') ? modal.querySelector('#explorerGridHost').parentElement : null;
        if (!host) return;
        let bar = modal.querySelector('.explorer-net-infobar');
        const st = sharingState();
        const want = isPath(app.currentPath) && !parse(app.currentPath).device && !discoveryOn();
        const cm = root.contextMenu;
        if (!want) {
            if (bar) { if (cm && cm.detachClickMenuFromElement) cm.detachClickMenuFromElement(bar); bar.remove(); }
            return;
        }
        // NetworkExplorer.dll.mui 1036 (both off) / 1047 (discovery off)
        const text = st && st.fileSharing === false
            ? 'Network discovery and file sharing are turned off. Network computers and devices are not visible. Click to change...'
            : 'Network discovery is turned off. Network computers and devices are not visible. Click to change...';
        if (bar && bar.dataset.text === text) return;
        if (!bar) {
            bar = document.createElement('button');
            bar.type = 'button';
            bar.className = 'explorer-net-infobar';
            host.insertBefore(bar, host.firstChild);
            // its click menu, NetworkExplorer MENU 2004 (Help about network discovery has no help here to open)
            if (cm && typeof cm.attachClickMenuToElement === 'function') {
                cm.attachClickMenuToElement(bar, {
                    sections: [{ type: 'list', items: [
                        { text: 'Turn on network discovery and file sharing', action: 'on', image: '/static_images/vista-cpl/shield-uac-16.png' },
                        { separator: true },
                        { text: 'Open Network and Sharing Center', action: 'nsc' }
                    ] }],
                    onAction: (a) => void infoBarAction(a)
                });
            }
        }
        bar.dataset.text = text;
        bar.textContent = text;
    }

    function sharingState() {
        try { const s = SHARES(); return s && typeof s.get === 'function' ? s.get() : null; } catch (_) { return null; }
    }

    async function infoBarAction(a) {
        if (a === 'nsc') { openSharingCenter(); return; }
        const s = SHARES();
        if (!s || typeof s.set !== 'function') return;
        const r = await s.set({ discovery: true, fileSharing: true });
        if (r && r.error) await message(r.error, 'Network and Sharing Center');
    }

    function openSharingCenter() {
        const loader = root.featureLoader;
        Promise.resolve(loader && typeof loader.loadFeature === 'function' ? loader.loadFeature('control_panel') : null)
            .then(() => { if (root.melatonControlPanel) root.melatonControlPanel.open('network'); })
            .catch((err) => console.error('Network and Sharing Center', err));
    }

    // ---- the details pane / columns of the Network folder ------------------------------------------------------------

    /** Network's own columns (Vista: Name, Category, Workgroup, Network location) and a share's (Name, Type, Comments). */
    function columnText(app, item, field) {
        if (!app || !isPath(app.currentPath)) return null;
        if (item.targetKind === 'net-computer') {
            if (field === 'date') return 'Computer';
            if (field === 'type') return workgroup();
            if (field === 'size') return networkLocation();
            return null;
        }
        if (item.targetKind === 'net-share') {
            if (field === 'date') return 'Share';
            if (field === 'type') return item.comment || '';
            if (field === 'size') return '';
        }
        return null;
    }

    function workgroup() {
        try {
            const g = root.userGlobalSettings || (typeof userGlobalSettings !== 'undefined' ? userGlobalSettings : null); // eslint-disable-line no-undef
            const name = g && g.desktop && g.desktop.domainName;
            return String(name || 'DREAMSCAPE').toUpperCase();
        } catch (_) { return 'DREAMSCAPE'; }
    }
    function networkLocation() { return workgroup(); }

    const HEADERS = {
        network: [['name', 'Name'], ['date', 'Category'], ['type', 'Workgroup'], ['size', 'Network location']],
        computer: [['name', 'Name'], ['date', 'Type'], ['type', 'Comments'], ['size', '']]
    };
    const PLAIN = { name: 'Name', date: 'Date modified', type: 'Type', size: 'Size' };

    /** The column headers: Network's own, a computer's own, or Explorer's again on the way out. */
    function syncHeader(app) {
        const head = app && app.modal ? app.modal.querySelector('#explorerDetailsHeader') : null;
        if (!head) return;
        const p = isPath(app.currentPath) ? parse(app.currentPath) : null;
        const set = p && !p.device ? HEADERS.network : p && !p.share ? HEADERS.computer : null;
        head.classList.toggle('explorer-net-header', !!set);
        head.querySelectorAll('.explorer-details-sort-col').forEach((b) => {
            const f = b.dataset.sortField;
            const label = b.querySelector('.explorer-details-col-label');
            const want = set ? (set.find((h) => h[0] === f) || [f, PLAIN[f]])[1] : PLAIN[f];
            if (label && want != null && label.textContent !== want) label.textContent = want;
        });
    }

    /** Network's own command (Vista: Network and Sharing Center after Organize and Views), made once. */
    function commandButton(app) {
        const set = app && app.modal ? app.modal.querySelector('.explorer-command-set') : null;
        if (!set) return null;
        let b = set.querySelector('#explorerNetCenterCmd');
        if (b) return b;
        b = document.createElement('button');
        b.type = 'button';
        b.id = 'explorerNetCenterCmd';
        b.className = 'explorer-command-btn explorer-net-cmd hidden';
        b.title = 'Open Network and Sharing Center.';
        b.innerHTML = '<img class="explorer-command-icon" src="/static_images/vista-net/netcenter-16.png" srcset="/static_images/vista-net/netcenter-16.png 1x, /static_images/vista-net/netcenter-16@2x.png 2x" alt="">Network and Sharing Center';
        b.addEventListener('click', openSharingCenter);
        set.appendChild(b);
        return b;
    }

    /** Share on the command bar with a folder of this computer's drives selected (Vista: Share opens the File Sharing
        wizard, as the folder's Share... does; explorerHostDrive.js, vistaFileSharing.js). */
    function shareButton(app) {
        const set = app && app.modal ? app.modal.querySelector('.explorer-command-set') : null;
        if (!set) return null;
        let b = set.querySelector('#explorerShareCmd');
        if (b) return b;
        b = document.createElement('button');
        b.type = 'button';
        b.id = 'explorerShareCmd';
        b.className = 'explorer-command-btn hidden';
        b.title = 'Share the selected folder with other people.';
        b.innerHTML = '<img class="explorer-command-icon" src="/static_images/vista-file-sharing/shared-folder-ntshrui-116-16.png" alt="">Share';
        b.addEventListener('click', () => {
            const host = root.explorerHostDrive;
            const sel = app.grid ? app.grid.getSelectedItems() : [];
            if (host && sel.length === 1) void host.share(app, sel[0]);
        });
        set.appendChild(b);
        return b;
    }

    function syncCommands(app, sel) {
        syncHeader(app);
        syncInfoBar(app);
        const at = !!app && isPath(app.currentPath) && !parse(app.currentPath).device;
        const b = at ? commandButton(app) : (app && app.modal ? app.modal.querySelector('#explorerNetCenterCmd') : null);
        if (b) b.classList.toggle('hidden', !at);
        const host = root.explorerHostDrive;
        const one = Array.isArray(sel) && sel.length === 1 ? sel[0] : null;
        const canShare = !!(root.DreamOSShares && host && one && one.targetKind === 'host-entry' && one.host && one.host.dir);
        const sb = canShare ? shareButton(app) : (app && app.modal ? app.modal.querySelector('#explorerShareCmd') : null);
        if (sb) sb.classList.toggle('hidden', !canShare);
    }

    // ---- the Folders tree ---------------------------------------------------------------------------------------------

    /** Network's node: its computers (each opening to its shares). */
    async function treeSpecs() {
        await watch();
        return computers().map((c) => ({
            label: c.name, icon: 'net-computer', path: pathFor(c.deviceId),
            children: async () => (computer(c.deviceId) ? (computer(c.deviceId).shares || []) : []).slice().sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: 'base' })).map((s) => ({
                label: s.name, icon: 'net-share', path: pathFor(c.deviceId, s.name), leaf: s.access === 'none',
                children: () => folders(pathFor(c.deviceId, s.name)).then((rows) => rows.map((r) => ({ label: r.name, icon: 'folder', path: r.path, children: () => folders(r.path).then((x) => x.map((y) => ({ label: y.name, icon: 'folder', path: y.path }))) })))
            }))
        }));
    }

    function syncPreview() { /* the details pane shows the selection's facts */ }

    /** Tiles: a computer shows its name alone (the VM's Network); a share its comment under the name, as \\PC does. */
    function tileLines(app, item) {
        if (!app || !isPath(app.currentPath)) return null;
        if (item.targetKind === 'net-computer') return ['', ''];
        if (item.targetKind === 'net-share') return [item.comment || '', ''];
        return null;
    }

    /** The details pane's rows for a computer (Vista: Categories, Workgroup, Network location) or a share; null else. */
    function details(app, item) {
        if (!item || !app || !isPath(app.currentPath)) return null;
        if (item.targetKind === 'net-computer') return [['Categories', 'Computer'], ['Workgroup', workgroup()], ['Network location', networkLocation()]];
        if (item.targetKind === 'net-share') return [['Type', 'Share'], ['Comments', item.comment || '']].filter((r) => r[1]);
        return null;
    }

    /** The details pane's picture with nothing selected: Network's, or a computer's. */
    function placeIcon(path) {
        if (!isPath(path)) return null;
        const p = parse(path);
        if (!p.device) return `${ART}/net-place-48.png`;
        if (!p.share) return `${ART}/${COMPUTER_ICON}-48.png`;
        return null;
    }

    const api = {
        PREFIX, PATH: PREFIX, isPath, isEntry, isEntryRef, parse, pathFor, normalize, attach, leave, list, folders, displayName,
        displayPath, crumbs, crumbIcon, resolveInput, parentOf, isWritable, open, sourceOf, sourceLabel, sourceUrl, isSource,
        entryMenuSections, emptyMenuSections, handleAction, download, createFolder, rename, remove, deliver, uploadFiles,
        columnText, tileLines, syncHeader, syncCommands, treeSpecs, details, placeIcon, computers, watch, syncPreview, discoveryOn, openSharingCenter,
        available: () => true,
        _test: { parse, pathFor, entryItem, sortItems }
    };
    root.explorerNetwork = api;

    // ---- the router in front of the phone / host drives ----------------------------------------------------------------
    function installRouter() {
        const cur = root.explorerPhoneDrive;
        // a new copy of this file (a live update) replaces the router the old one put in front
        const inner = cur && cur.__netRouter ? cur.__netInner : cur;
        // (the host drives' router put in front of this one keeps it: it hands net:// on to it)
        if (!inner || (cur.__netRouter && (cur.__netApi === api || cur.__hostRouter))) return;
        const r = Object.assign({}, inner);
        const byPath = (name) => function (path, ...rest) { return (isPath(path) ? api : inner)[name](path, ...rest); };
        const byAppItem = (name) => function (app, item, ...rest) { return (isEntry(item) ? api : inner)[name](app, item, ...rest); };
        const byAppPath = (name) => function (app, ...rest) { return (isPath(app && app.currentPath) ? api : inner)[name](app, ...rest); };
        const bySource = (name) => function (src, ...rest) { return (isSource(src) ? api : inner)[name](src, ...rest); };
        Object.assign(r, {
            __netRouter: true,
            __netInner: inner,
            __netApi: api,
            // the phone's own UI (its Favorite Links group, previews) follows the phone and the host drives only
            available: () => inner.available(),
            isPath: (path) => isPath(path) || inner.isPath(path),
            isEntry: (item) => isEntry(item) || inner.isEntry(item),
            isEntryRef: (ref) => isEntryRef(ref) || inner.isEntryRef(ref),
            normalize: byPath('normalize'),
            list: (app, path) => (isPath(path) ? api : inner).list(app, path),
            folders: byPath('folders'),
            displayName: byPath('displayName'),
            displayPath: byPath('displayPath'),
            crumbs: byPath('crumbs'),
            crumbIcon: byPath('crumbIcon'),
            parentOf: byPath('parentOf'),
            isWritable: byPath('isWritable'),
            resolveInput: (text) => resolveInput(text) || inner.resolveInput(text),
            attach: (app) => { if (app) apps.add(app); inner.attach(app); },
            leave: (app) => inner.leave(app),
            open: byAppItem('open'),
            entryMenuSections: byAppItem('entryMenuSections'),
            emptyMenuSections: byAppPath('emptyMenuSections'),
            createFolder: byAppPath('createFolder'),
            syncPreview: (app, sel) => (isPath(app && app.currentPath) ? api : inner).syncPreview(app, sel),
            rename: byAppItem('rename'),
            remove: (app, items, permanent) => (items.length && items.every(isEntry) ? api : inner).remove(app, items, permanent),
            download: (items) => (items.length && items.every(isEntry) ? api : inner).download(items),
            handleAction: (action, item, app) => (String(action).startsWith(ACTION) ? api : inner).handleAction(action, item, app),
            deliver: async (app, refs, navPath, op, opts) => (await deliver(app, refs, navPath, op, opts)) || inner.deliver(app, refs, navPath, op, opts),
            uploadFiles: (app, navPath, files) => (isPath(navPath) ? api : inner).uploadFiles(app, navPath, files),
            sourceUrl: bySource('sourceUrl'),
            sourceLabel: bySource('sourceLabel'),
            writeText: (src, ...rest) => (isSource(src) ? Promise.reject(new Error('The file is on another computer: save a copy on this computer.')) : inner.writeText(src, ...rest)),
            sendToMenuItem: (item) => (isEntry(item) ? null : inner.sendToMenuItem(item)),
            openOnPhoneMenuItem: (item) => (isEntry(item) ? null : (inner.openOnPhoneMenuItem ? inner.openOnPhoneMenuItem(item) : null))
        });
        root.explorerPhoneDrive = r;
    }
    installRouter();
    // the host drives' router can arrive later (the shell bridge came up late): this one goes in front of it again
    root.addEventListener('dreamosdrives', () => { if (root.explorerPhoneDrive && root.explorerPhoneDrive.__netApi !== api) installRouter(); }, { signal: appScopeSignal });
})(typeof window !== 'undefined' ? window : globalThis);
