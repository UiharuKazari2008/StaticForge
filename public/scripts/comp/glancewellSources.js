/**
 * Melaton Photo Gallery's galleries (Windows Photo Gallery, Yozora #446): where the library's pictures come from. Each root of
 * the navigation tree is one source (Yukimi, Nov 20 2026: four separate roots, plus a root per ActiveSync device):
 *
 *   pictures   Pictures: this device's own picture library (the Android app's MediaStore in DeX; the phone's cards)
 *   prints     DreamScape: the gallery's prints (request_gallery, newest first, paged); workspaceId '*' lists every
 *              workspace's (the tree's Workspaces node, Yukimi Nov 21 2026)
 *   refs       References (inside DreamScape): base images, character references and vibes (get_references)
 *   folders    Folders: the VFS folders added with Add Folder to Gallery (glancewell_watched), prints left out
 *   device:<id> a phone connected through ActiveSync (activeSyncRemoteStorage.js), its folders walked with list
 *
 * Every source answers list(scope) with the same item shape:
 *   { id, source, key, name, video, width, height, size, taken (ms), modified (ms), folder, thumb(px) -> url,
 *     full -> url, workspaceId?, pinned?, refType?, refTags?, refComment?, raw }
 * so the library groups, sorts, searches and shows them alike. Pushes keep them current (gallery_updated,
 * vfs_updated, glancewell_changed, the phone's watch); nothing polls.
 *
 *   window.glancewellSources = { get(id), all(), devices(), itemId(source, key) }
 */
(function (root) {
    'use strict';

    const PAGE = 750;               // request_gallery's block size
    const MAX_PRINTS = 20000;
    const VFS_PAGE = 300;
    const FOLDER_LIMIT = 6000;      // pictures read from the watched folders at most
    const FOLDER_DEPTH = 6;
    const WALK_LIMIT = 300;         // folders a device walk reads at most
    const WALK_DEPTH = 4;
    const SKIP = /^(Android|\.thumbnails|\.Trash.*|LOST\.DIR|\.android_secure)$/i;
    // a walk (no MediaStore over ActiveSync) reads the folders a phone keeps pictures in, as MediaStore lists them,
    // not app data (icon caches and the like)
    const MEDIA_DIRS = ['/DCIM', '/Pictures', '/Movies', '/Download', '/Documents'];
    const PICTURE = /\.(jpe?g|jfif|png|gif|bmp|webp|avif|heic|heif|tiff?)$/i;
    const VIDEO = /\.(mp4|m4v|mov|webm|mkv|3gp|avi|wmv|mpe?g)$/i;

    const ws = () => root.wsClient || null;
    const send = (type, data) => {
        const c = ws();
        return c && typeof c.sendMessage === 'function' ? c.sendMessage(type, data || {}, false) : Promise.reject(new Error('offline'));
    };
    const itemId = (source, key) => `${source}|${key}`;
    const ms = (v) => {
        const n = Number(v);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return n < 1e11 ? n * 1000 : n; // seconds or milliseconds
    };
    const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name || '') || [])[1] || '';
    const isMedia = (name, mime) => /^(image|video)\//.test(mime || '') || PICTURE.test(name || '') || VIDEO.test(name || '');
    const isVideo = (name, mime) => /^video\//.test(mime || '') || VIDEO.test(name || '');

    // ------------------------------------------------------------------ DreamScape Prints

    /** A print's thumbnail at its own aspect: the 128 px @lq below 128, else the 320 px @fit (made on first ask). */
    function printThumb(row) {
        const base = row.base || String(row.filename || '').replace(/\.(png|jpe?g|webp)$/i, '');
        return (px) => {
            if (!base) return '';
            if (px <= 128 && row.preview) return `/previews/${encodeURIComponent(String(row.preview).replace(/\.webp$/i, '@lq.webp'))}`;
            return `/previews/${encodeURIComponent(`${base}@fit.webp`)}?wait=1`;
        };
    }

    function printItem(row, workspaceId, scrap) {
        const file = row.filename || row.upscaled || row.original;
        return {
            id: itemId('prints', file),
            source: 'prints',
            key: file,
            name: file,
            video: false,
            width: Number(row.width) || 0,
            height: Number(row.height) || 0,
            size: Number(row.size) || 0,
            taken: ms(row.mtime),
            modified: ms(row.mtime),
            folder: scrap ? 'Scraps' : workspaceLabel(workspaceId),
            workspaceId,
            pinned: !!row.isPinned,
            scrap: !!scrap,
            thumb: printThumb(row),
            full: () => (typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(file) : `/images/${encodeURIComponent(file)}`),
            raw: row
        };
    }

    function workspaceLabel(id) {
        /* global workspaces */
        const w = typeof workspaces !== 'undefined' && workspaces ? workspaces[id] : null;
        return (w && (w.name || w.title)) || (id === 'default' ? 'Default' : String(id || ''));
    }

    function workspaceIds() {
        return typeof workspaces !== 'undefined' && workspaces ? Object.keys(workspaces) : [];
    }

    function activeWorkspaceId() {
        /* global activeWorkspace */
        return (typeof activeWorkspace !== 'undefined' && activeWorkspace) || 'default';
    }

    const prints = {
        id: 'prints',
        label: 'DreamScape',
        /** scope: { view: images | pinned | scraps, workspaceId ('*': every workspace) } ; onPage(items) as each block lands */
        async list(scope = {}, onPage) {
            const view = scope.view || 'images';
            if (scope.workspaceId === '*') {
                const all = [];
                // the desktop's workspace list can still be on its way (a gallery opened just after boot listed none)
                let ids = workspaceIds();
                if (!ids.length) {
                    const r = await send('workspace_list', {}).catch(() => null);
                    ids = ((r && r.workspaces) || []).map((w) => w && w.id).filter(Boolean);
                }
                for (const id of ids) {
                    if (all.length >= MAX_PRINTS) break;
                    all.push(...await this.list(Object.assign({}, scope, { workspaceId: id }), onPage));
                }
                return all;
            }
            const workspaceId = scope.workspaceId || activeWorkspaceId();
            const out = [];
            for (let offset = 0; offset < MAX_PRINTS; offset += PAGE) {
                // request_gallery: modules/ws/handlers/120-galleryHandler.js (light, LIMIT/OFFSET blocks, newest first)
                const data = await send('request_gallery', { viewType: view, includePinnedStatus: view !== 'scraps', workspaceId, offset, limit: PAGE, light: true });
                const rows = (data && data.gallery) || [];
                const page = rows.map((r) => printItem(r, workspaceId, view === 'scraps'));
                out.push(...page);
                if (onPage && page.length) onPage(page);
                const more = data && data.pagination ? data.pagination.hasMore : rows.length >= PAGE;
                if (!more || !rows.length) break;
            }
            return out;
        },
        workspaces: () => workspaceIds().map((id) => ({ id, name: workspaceLabel(id) })),
        activeWorkspaceId
    };

    // ------------------------------------------------------------------ DreamScape References

    const REF_TYPES = [
        { id: 'base', name: 'Base Images' },
        { id: 'character', name: 'Character References' },
        { id: 'vibe', name: 'Vibe Transfers' }
    ];
    // the reference store's own markers, not the user's tags
    const REF_INTERNAL_TAG = /^(precisionReference|preciseRefType:.*)$/;

    function refItem(row, vibe) {
        const md = row.metadata || {};
        const tags = Array.isArray(md.tags) ? md.tags : [];
        const character = !vibe && tags.includes('precisionReference');
        const key = vibe ? (row.id || row.filename) : (row.hash || row.filename);
        const preview = vibe ? row.preview : `${row.hash}.webp`;
        const url = preview && typeof localCachePreviewUrl === 'function' ? localCachePreviewUrl(preview) : (preview ? `/cache/preview/${encodeURIComponent(preview)}` : '');
        return {
            id: itemId('refs', key),
            source: 'refs',
            key,
            name: md.displayName || (vibe ? (row.filename || key) : key),
            video: false,
            width: 0,
            height: 0,
            size: Number(row.size) || 0,
            taken: ms(row.createdAt || row.mtime),
            modified: ms(row.mtime),
            folder: vibe ? 'Vibe Transfers' : (character ? 'Character References' : 'Base Images'),
            workspaceId: row.workspaceId || null,
            refType: vibe ? 'vibe' : (character ? 'character' : 'base'),
            refTags: tags.filter((t) => !REF_INTERNAL_TAG.test(t)),
            refComment: md.comment || '',
            thumb: () => url,
            full: () => (vibe ? url : `/cache/upload/${encodeURIComponent(row.filename || row.hash)}`),
            raw: row
        };
    }

    const refs = {
        id: 'refs',
        label: 'References',
        types: REF_TYPES,
        async list() {
            // get_references: modules/referencesWebSocketHandlers.js (every workspace, newest first)
            const r = await send('get_references', {});
            const d = (r && (r.data || r)) || {};
            const out = [];
            (d.cacheFiles || []).forEach((row) => out.push(refItem(row, false)));
            (d.vibeImages || []).forEach((row) => out.push(refItem(row, true)));
            return out;
        },
        /** Base images and character references keep their own tags and comment (reference_metadata.db). */
        ownsMeta: (item) => item.refType !== 'vibe',
        /**
         * update_reference_metadata replaces the whole row (referenceMetadataDatabase.setMetadata), so the
         * reference's other fields go back with it; the store's own markers (precisionReference) stay.
         */
        async saveMeta(item, { tags, comment, displayName }) {
            const md = Object.assign({}, (item.raw && item.raw.metadata) || {});
            const internal = (Array.isArray(md.tags) ? md.tags : []).filter((t) => REF_INTERNAL_TAG.test(t));
            if (tags) md.tags = internal.concat(tags);
            if (comment != null) md.comment = comment || null;
            if (displayName != null) md.displayName = displayName || null;
            const r = await send('update_reference_metadata', { hash: item.key, metadata: md });
            if (item.raw) item.raw.metadata = md;
            if (tags) item.refTags = tags.slice();
            if (comment != null) item.refComment = comment;
            if (displayName) item.name = displayName;
            return r;
        }
    };

    // ------------------------------------------------------------------ Folders (watched VFS folders)

    /*
     * A VFS video has no preview: Media Player's library (modules/mediaLibrary.js, media_library_get) knows its frame at
     * 10 % (art), size and length, and serves the file with HTTP Range so the viewer can seek (/files/ cannot).
     */
    const vfsBase = () => {
        /* global vfsClient */
        const uuid = typeof vfsClient !== 'undefined' && vfsClient.ensureVfsPathUuid ? vfsClient.ensureVfsPathUuid() : null;
        return uuid ? `/${uuid}` : '';
    };
    let mediaVideos = new Map();

    async function loadMediaVideos() {
        try {
            const r = await send('media_library_get', {});
            mediaVideos = new Map(((r && r.video) || []).map((v) => [v.id, v]));
        } catch (_) { /* Media Player's library is not available: no frames */ }
    }

    function vfsItem(e, folderName, parentPath) {
        const video = isVideo(e.name, e.mimeType);
        const id = e.id || e.targetId;
        const media = () => (video ? mediaVideos.get(e.targetId || id) || mediaVideos.get(id) || null : null);
        return {
            id: itemId('folders', e.id || e.targetId),
            source: 'folders',
            key: e.id || e.targetId,
            name: e.name,
            video,
            width: Number(e.width) || 0,
            height: Number(e.height) || 0,
            size: Number(e.sizeBytes || e.size) || 0,
            taken: ms(e.createdAt || e.modifiedAt),
            modified: ms(e.modifiedAt),
            folder: folderName,
            thumb: () => {
                if (e.previewUrl) return e.previewUrl;
                const m = media();
                return m && m.art && vfsBase() ? `${vfsBase()}/media/art/${encodeURIComponent(m.hash)}` : '';
            },
            // the file itself: /<vfs>/files/<id> beside /<vfs>/previews/<id> (web_server.js); a video from
            // /<vfs>/media/file/<id>, with Range
            full: () => {
                if (video && vfsBase()) return `${vfsBase()}/media/file/${encodeURIComponent(e.targetId || id)}`;
                return e.url || e.downloadUrl || e.fileUrl || String(e.previewUrl || '').replace('/previews/', '/files/');
            },
            parentPath,
            raw: e
        };
    }

    const folders = {
        id: 'folders',
        label: 'Folders',
        async watched() {
            const r = await send('glancewell_watched', {});
            return (r && r.folders) || [];
        },
        async setWatched(change) {
            const r = await send('glancewell_watched_set', change);
            return (r && r.folders) || [];
        },
        /** The pictures and videos under the folders (subfolders included, as Photo Gallery reads them). */
        async list(scope = {}, onPage) {
            /* global vfsClient */
            if (typeof vfsClient === 'undefined') return [];
            const roots = scope.folders || (await folders.watched()).map((f) => ({ path: f.folder, name: f.name }));
            const out = [];
            let videosLoaded = false;
            const queue = roots.map((f) => ({ path: f.path, name: f.name, depth: 0 }));
            while (queue.length && out.length < FOLDER_LIMIT) {
                const at = queue.shift();
                for (let offset = 0; offset < 100000; offset += VFS_PAGE) {
                    let res = null;
                    try { res = await vfsClient.listDirectory(at.path, { offset, limit: VFS_PAGE }); } catch (_) { break; }
                    const page = [];
                    for (const e of (res && res.items) || []) {
                        if (e.kind === 'folder') {
                            // the gallery's own folders hold prints and references: they have their own roots
                            if (!e.system && e.targetKind === 'vfs-folder' && at.depth < FOLDER_DEPTH && !scope.shallow) queue.push({ path: e.navPath || `${at.path}/${e.id}`, name: e.name, depth: at.depth + 1 });
                            continue;
                        }
                        if (e.targetKind !== 'user-file' || !isMedia(e.name, e.mimeType)) continue;
                        page.push(vfsItem(e, at.name, at.path));
                    }
                    if (page.some((it) => it.video)) {
                        if (!videosLoaded) { videosLoaded = true; await loadMediaVideos(); }
                        for (const it of page) {
                            const m = it.video && mediaVideos.get(it.raw.targetId || it.key);
                            if (!m) continue;
                            it.width = it.width || Number(m.width) || 0;
                            it.height = it.height || Number(m.height) || 0;
                            it.duration = Number(m.duration) || 0;
                        }
                    }
                    out.push(...page);
                    if (onPage && page.length) onPage(page);
                    if (!res || !res.hasMore) break;
                }
            }
            return out;
        },
        /** The subfolders of a VFS folder, for the tree. */
        async subfolders(path) {
            if (typeof vfsClient === 'undefined') return [];
            let res = null;
            try { res = await vfsClient.listDirectory(path, { offset: 0, limit: VFS_PAGE }); } catch (_) { return []; }
            return ((res && res.items) || []).filter((e) => e.kind === 'folder' && !e.system && e.targetKind === 'vfs-folder')
                .map((e) => ({ path: e.navPath || `${path}/${e.id}`, name: e.name }));
        }
    };

    // ------------------------------------------------------------------ a phone's storage (this device, or ActiveSync)

    /**
     * ps: a phoneStorage (phoneStorageBridge.js on the phone, activeSyncRemoteStorage.js on a computer). For a
     * remote device every call goes to the device picked with select(), so a device root picks its own first.
     */
    function phoneSource({ id, label, ps, deviceId }) {
        let albums = null;
        const urlOf = (rootId, path, opts) => {
            const p = ps();
            if (!p) return '';
            if (!deviceId) return p.fileUrl(rootId, path, opts);
            // a device's own address, so two devices' thumbnails show side by side (activeSyncRemoteStorage fileUrl)
            let url = `/api/activesync/file/${encodeURIComponent(deviceId)}/${encodeURIComponent(rootId)}/${p.encodePath(path)}`;
            const q = [];
            if (opts && opts.thumb) q.push(`thumb=${Math.max(32, Math.min(1024, Math.round(opts.thumb)))}`);
            if (q.length) url += `?${q.join('&')}`;
            return url;
        };
        async function ready() {
            const p = ps();
            if (!p) return null;
            if (deviceId && p.deviceId !== deviceId && typeof p.select === 'function') await p.select(deviceId);
            return p;
        }
        async function cards() {
            const p = await ready();
            if (!p) return [];
            let h = null;
            try { h = await p.hello(); } catch (_) { h = null; }
            return ((h && h.roots) || []).filter((r) => r && r.id);
        }
        async function loadAlbums() {
            const p = await ready();
            if (!p) return [];
            const h = await p.hello().catch(() => null);
            // MediaStore's albums: the page's bridge, or a device whose app answers them over ActiveSync (#984)
            if (h && h.features && h.features.media) {
                try { return (await p.call('media.albums', {})) || []; } catch (_) { /* an older app: walk */ }
            }
            const out = [];
            for (const c of await cards()) {
                const queue = MEDIA_DIRS.map((path) => ({ path, depth: 1 }));
                let lists = 0;
                while (queue.length && lists < WALK_LIMIT) {
                    const at = queue.shift();
                    let r = null;
                    try { r = await p.call('list', { root: c.id, path: at.path }); } catch (_) { r = null; }
                    lists++;
                    if (!r) continue;
                    let count = 0;
                    for (const e of r.entries || []) {
                        if (e.hidden) continue;
                        if (e.dir) { if (at.depth < WALK_DEPTH && !SKIP.test(e.name)) queue.push({ path: e.path, depth: at.depth + 1 }); continue; }
                        if (isMedia(e.name, e.mime)) count++;
                    }
                    if (count) out.push({ root: c.id, path: r.path || at.path, name: at.path === '/' ? (c.name || c.label) : p.baseName(at.path), count });
                }
            }
            return out;
        }
        function entryItem(rootId, e, folderName) {
            const key = `${rootId}:${e.path}`;
            return {
                id: itemId(id, key),
                source: id,
                key,
                name: e.name || (ps() ? ps().baseName(e.path) : e.path),
                video: !!e.video || isVideo(e.name, e.mime),
                width: Number(e.width) || 0,
                height: Number(e.height) || 0,
                size: Number(e.size) || 0,
                // the phone's media entries carry a video's length in ms
                duration: Number(e.duration) > 0 ? Number(e.duration) / 1000 : 0,
                taken: ms(e.taken || e.mtime),
                modified: ms(e.mtime),
                folder: folderName,
                thumb: (px) => urlOf(rootId, e.path, { thumb: Math.max(128, px) }),
                full: () => urlOf(rootId, e.path, {}),
                raw: Object.assign({ root: rootId }, e)
            };
        }
        return {
            id,
            label,
            deviceId: deviceId || null,
            // where this source's files are written back (Fix, rotation)
            store: () => ps(),
            /** One storage call on this source's own device (a computer may have several partners). */
            async call(op, args) {
                const p = await ready();
                if (!p) throw new Error('The device is not connected.');
                return p.call(op, args);
            },
            available: () => !!(ps() && (deviceId ? true : ps().available)),
            async albums(force) {
                if (!albums || force) albums = await loadAlbums();
                return albums;
            },
            async list(scope = {}, onPage) {
                const p = await ready();
                if (!p) return [];
                const list = scope.album ? [scope.album] : await this.albums();
                const h = await p.hello().catch(() => null);
                const media = !!(h && h.features && h.features.media);
                const out = [];
                for (const a of list) {
                    let entries = [];
                    try {
                        if (media) entries = ((await p.call('media.list', { root: a.root, path: a.path })) || {}).entries || [];
                        else entries = (((await p.call('list', { root: a.root, path: a.path })) || {}).entries || []).filter((e) => !e.dir && !e.hidden && isMedia(e.name, e.mime));
                    } catch (_) { entries = []; }
                    const page = entries.map((e) => entryItem(a.root, e, a.name));
                    out.push(...page);
                    if (onPage && page.length) onPage(page);
                }
                return out;
            }
        };
    }

    /**
     * DreamOS: this computer's own drives (window.DreamOSDrives, CaféReady drives.rs; explorerHostDrive.js) in the
     * phone storage's shape, so Pictures reads their picture folders the same way. The host makes no thumbnails:
     * the files themselves show.
     */
    let hostAdapter = null;
    function hostPs() {
        const D = root.DreamOSDrives;
        if (!D || typeof D.get !== 'function' || typeof D.list !== 'function') return null;
        if (hostAdapter) return hostAdapter;
        const drives = () => { const st = D.get(); return (st && Array.isArray(st.drives)) ? st.drives : []; };
        const baseName = (pth) => String(pth || '').split('/').filter(Boolean).pop() || '';
        hostAdapter = {
            remote: false,
            get available() { return drives().length > 0; },
            hello: async () => ({ roots: drives().map((d) => ({ id: d.id, name: d.label || d.name || 'Local Disk' })), features: {} }),
            call: async (op, a) => {
                if (op === 'list') return D.list(a.root, a.path);
                if (op === 'rename' && typeof D.rename === 'function') return D.rename(a.root, a.path, a.name);
                if (op === 'delete' && typeof D.remove === 'function') return D.remove(a.root, [a.path]);
                throw new Error('unsupported');
            },
            fileUrl: (id, pth) => D.fileUrl(id, pth, {}),
            baseName,
            parentPath: (pth) => { const parts = String(pth || '/').split('/').filter(Boolean); parts.pop(); return `/${parts.join('/')}`; },
            encodePath: (pth) => String(pth || '').split('/').filter(Boolean).map(encodeURIComponent).join('/'),
            write: (rootId, dir, file, opts) => D.write(rootId, dir, file, { name: (opts && opts.name) || file.name, conflict: (opts && opts.conflict) || 'fail' })
        };
        return hostAdapter;
    }

    // Pictures: this device's own library (the Android app's bridge on a phone or DeX; DreamOS's own drives). In DeX the
    // desktop's remote storage holds root.phoneStorage, so the phone's own bridge is phoneStorageLocal (Yukimi, Nov 21
    // 2026: on the Fold the phone's gallery was missing from Pictures and the Fold showed as a device at the bottom)
    if (root.AndroidPhoneStorage && !root.phoneStorageLocal && root.document) {
        const s = root.document.createElement('script');
        s.src = '/scripts/comp/phoneStorageBridge.js';
        root.document.head.appendChild(s);
    }
    const localPs = () => root.phoneStorageLocal || (root.phoneStorage && !root.phoneStorage.remote ? root.phoneStorage : hostPs());
    /** This phone's own ActiveSync id (in its DeX window), so it is not listed again as a device. */
    const ownDeviceId = () => {
        try { const a = root.AndroidActiveSync; return a && typeof a.getDeviceId === 'function' ? String(a.getDeviceId() || '').toLowerCase() : ''; } catch (_) { return ''; }
    };
    const pictures = phoneSource({ id: 'pictures', label: 'Pictures', ps: localPs });

    const deviceSources = new Map();
    function devices() {
        const p = root.phoneStorage;
        if (!p || !p.remote || typeof p.devices !== 'function') return [];
        const own = ownDeviceId();
        return p.devices().filter((d) => !own || String(d.deviceId).toLowerCase() !== own).map((d) => {
            const sid = `device:${d.deviceId}`;
            if (!deviceSources.has(sid)) deviceSources.set(sid, phoneSource({ id: sid, label: d.name, ps: () => root.phoneStorage, deviceId: d.deviceId }));
            const s = deviceSources.get(sid);
            s.label = d.name;
            return s;
        });
    }

    const fixed = { pictures, prints, refs, folders };

    root.glancewellSources = {
        get: (id) => fixed[id] || deviceSources.get(id) || null,
        all: () => [pictures, prints, refs, folders, ...devices()],
        devices,
        itemId,
        extOf,
        isVideo
    };
})(typeof window !== 'undefined' ? window : globalThis);
