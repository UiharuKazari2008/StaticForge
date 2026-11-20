/**
 * Offline Files on CaféReady clients (#910, Yukimi, Nov 20 2026): the page's side of Vista's Offline Files.
 *
 * The CaféReady host keeps the cache, the write-back queue and the conflicts (DreamOS: cafeready offline.rs; DSApp:
 * the same interface, see docs/client-api/offline-files.md); this file only shows them and hands the host the page's
 * writes. Nothing here waits on the server (installed-boot-zero-wait): a write into an offline folder lands on this
 * computer's disk at loopback speed and the host sends it to the server when the link is up. No duty depends on this
 * page (cafeready-background): close it mid-upload and the host carries on.
 *
 * Host interface (window.AndroidOfflineFiles, given by the DreamOS shell extension; DSApp's to come):
 *   call(json) -> json          synchronous ops (op: state | space | policy | open | close | pin | set | sync | resolve
 *                               | delete | remove | limits | enable | list | stat)
 *   endpoint() -> json | null   { base, token }: binary writes as fetch bodies (DreamOS); null -> write() with base64
 *   write(handle, offset, b64) -> json   the portable write (DSApp)
 *   fileUrl(path) -> string     a URL the page can show / play the local copy from
 *   events: window 'cafeofflinefiles' (detail = the host's summary)
 *
 * window.melatonOfflineFiles (the page's API):
 *   available()                  a host with Offline Files is here
 *   state()                      the host's summary, from memory: { enabled, online, status, busy, pending, conflicts:
 *                                [..], errors: [..], lastSync, usage: { used, limitAll, limitTemp, disk, free, reserve,
 *                                writable }, folders: { <path>: { caching, writeBack, pinned } } }
 *   on(fn) -> off                the summary changed (also window event 'melaton:offlinefiles', detail = summary)
 *   policy(folder)               { caching, writeBack, pinned, takes } for a folder path (/Workspaces/<ws>/Camera Roll)
 *   takes(folder)                writes into folder go through the host
 *   space()                      { free, reserve, writable, disk } of the host's disk
 *   createWriter(folder, name, mime) -> Promise<{ path, name, write(blob) -> Promise<{ size, writable }>,
 *                                close() -> Promise<item>, abort() }>     a file written in pieces (a recording)
 *   putFile(folder, name, blob, mime) -> Promise<item>                   a whole file (a picture)
 *   list(folder) / stat(path) / fileUrl(path)
 *   pin(path, on) / setFolder(path, { caching, writeBack, optimized }) / syncNow() / resolve(path, keep)
 *   decorate(listing) / offlineListing(path)    Explorer's view (vfsClient.listDirectory)
 *   isLocalItem(item) / openLocal(item)        a file only this computer has yet
 *
 * Sync Center (syncCenter.js, #976): the 'offline-files' partnership, its conflicts and results, Resolve Conflict.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-offline';
    const appScopeSignal = root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' ? root.melatonSegments.callerSignal() : undefined;
    const host = () => root.AndroidOfflineFiles || null;
    const listeners = new Set();
    let sum = null;
    let endpoint;
    const RESULTS_KEY = 'melaton.offlineFiles.results';
    const PATHS_KEY = 'melaton.offlineFiles.paths';

    function call(op) {
        const h = host();
        if (!h || typeof h.call !== 'function') return null;
        try { return JSON.parse(h.call(JSON.stringify(op)) || 'null'); } catch (_) { return null; }
    }
    function ep() {
        if (endpoint !== undefined) return endpoint;
        const h = host();
        try { endpoint = h && typeof h.endpoint === 'function' ? JSON.parse(h.endpoint() || 'null') : null; } catch (_) { endpoint = null; }
        return endpoint;
    }
    const available = () => !!host() && !!(state() && state().enabled !== undefined);
    function state() {
        if (!sum && host()) sum = call({ op: 'state' });
        return sum;
    }

    // ---- results (Sync Center's Sync Results), kept on this computer ------------------------------------------------

    let results = null;
    function loadResults() {
        if (results) return results;
        try { results = JSON.parse(root.localStorage.getItem(RESULTS_KEY) || '[]'); } catch (_) { results = []; }
        if (!Array.isArray(results)) results = [];
        return results;
    }
    function addResult(kind, item, text) {
        const r = loadResults();
        r.unshift({ at: Date.now(), kind, item, text });
        r.length = Math.min(r.length, 100);
        try { root.localStorage.setItem(RESULTS_KEY, JSON.stringify(r)); } catch (_) { /* full */ }
    }

    function folderLabel(path) {
        const parts = String(path || '').split('/').filter(Boolean);
        return parts.length > 2 ? parts.slice(2).join('\\') : (parts[parts.length - 1] || 'Offline Files');
    }

    /** a summary arrived: what finished becomes a result (Vista's Sync Results lines), then everyone hears */
    function onSummary(next) {
        const prev = sum;
        sum = next;
        if (prev && next) {
            if (prev.busy && !next.busy) {
                const sent = Math.max(0, (prev.pending || 0) - (next.pending || 0));
                if (next.lastError) addResult('error', 'Offline Files', next.lastError);
                else if (sent) addResult('info', 'Offline Files', `Synced ${sent} file${sent === 1 ? '' : 's'}.`);
            }
            const was = new Set((prev.conflicts || []).map((c) => c.id));
            for (const c of next.conflicts || []) if (!was.has(c.id)) addResult('conflict', c.name, c.detail);
            const wasErr = new Set((prev.errors || []).map((c) => c.id));
            for (const e of next.errors || []) if (!wasErr.has(e.id)) addResult('error', e.name, e.error || 'The file could not be synced.');
        }
        for (const fn of [...listeners]) { try { fn(next); } catch (err) { console.error('offlineFiles listener', err); } }
        try { root.dispatchEvent(new CustomEvent('melaton:offlinefiles', { detail: next })); } catch (_) { /* no window */ }
    }
    if (doc) root.addEventListener('cafeofflinefiles', (ev) => onSummary(ev.detail || null), { signal: appScopeSignal });

    // ---- policies and space -------------------------------------------------------------------------------------------

    function policy(folder) {
        const r = call({ op: 'policy', path: folder });
        return r && !r.error ? r : null;
    }
    const takes = (folder) => !!(available() && (policy(folder) || {}).takes);
    const space = () => call({ op: 'space' }) || { free: 0, reserve: 0, writable: 0, disk: 0 };

    // ---- writes -------------------------------------------------------------------------------------------------------

    function b64(buf) {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }

    /** one piece at its offset; the host answers 409 with its size when the offset is not the end (a resend) */
    async function writePiece(handle, offset, blob) {
        const e = ep();
        if (e && e.base) {
            const resp = await fetch(`${e.base}/v1/offline/write?h=${encodeURIComponent(handle)}&offset=${offset}&token=${encodeURIComponent(e.token)}`, { method: 'POST', body: await blob.arrayBuffer() });
            const r = await resp.json().catch(() => ({}));
            return { status: resp.status, ...r };
        }
        const h = host();
        if (!h || typeof h.write !== 'function') throw new Error('Offline Files is not available.');
        const r = JSON.parse(h.write(handle, offset, b64(await blob.arrayBuffer())) || '{}');
        return { status: r.error === 'offset' ? 409 : r.error === 'full' ? 507 : r.error ? 400 : 200, ...r };
    }

    async function createWriter(folder, name, mime) {
        const o = call({ op: 'open', folder, name, mime: mime || '' });
        if (!o || o.error) {
            const e = new Error(o && o.error === 'full' ? 'There is not enough space on the disk.' : 'Offline Files could not create the file.');
            e.code = o && o.error === 'full' ? 'FULL' : 'OPEN';
            throw e;
        }
        let size = 0;
        let chain = Promise.resolve();
        let closed = false;
        const w = {
            path: o.path,
            name: o.name,
            writable: o.writable,
            /** pieces in order (a MediaRecorder's chunks): each appended at the file's end */
            write(blob) {
                const p = chain.then(async () => {
                    if (closed) throw new Error('The file is closed.');
                    for (let tries = 0; tries < 3; tries += 1) {
                        const r = await writePiece(o.handle, size, blob); // eslint-disable-line no-await-in-loop
                        if (r.status === 200) { size = r.size; w.writable = r.writable; return { size, writable: r.writable }; }
                        if (r.status === 409 && typeof r.size === 'number') {
                            // the last piece did arrive (its answer was lost): carry on from the host's size
                            if (r.size === size + blob.size) { size = r.size; return { size, writable: w.writable }; }
                            size = r.size;
                            continue;
                        }
                        const e = new Error(r.status === 507 ? 'There is not enough space on the disk.' : 'The file could not be written.');
                        e.code = r.status === 507 ? 'FULL' : 'WRITE';
                        throw e;
                    }
                    throw new Error('The file could not be written.');
                });
                chain = p.catch(() => {});
                return p;
            },
            async close() {
                await chain;
                closed = true;
                const r = call({ op: 'close', handle: o.handle });
                if (!r || r.error) throw new Error('The file could not be closed.');
                return r;
            },
            abort() {
                closed = true;
                call({ op: 'close', handle: o.handle, discard: true });
            }
        };
        return w;
    }

    async function putFile(folder, name, blob, mime) {
        const e = ep();
        if (e && e.base) {
            const q = `folder=${encodeURIComponent(folder)}&name=${encodeURIComponent(name)}&mime=${encodeURIComponent(mime || blob.type || '')}&token=${encodeURIComponent(e.token)}`;
            const resp = await fetch(`${e.base}/v1/offline/put?${q}`, { method: 'POST', body: await blob.arrayBuffer() });
            const r = await resp.json().catch(() => ({}));
            if (resp.status !== 200 || r.error) {
                const err = new Error(resp.status === 507 ? 'There is not enough space on the disk.' : 'Offline Files could not save the file.');
                err.code = resp.status === 507 ? 'FULL' : 'WRITE';
                throw err;
            }
            return r;
        }
        const w = await createWriter(folder, name, mime || blob.type);
        try { await w.write(blob); } catch (err) { w.abort(); throw err; }
        return w.close();
    }

    function fileUrl(path) {
        const e = ep();
        if (e && e.base) return `${e.base}/v1/offline/file?path=${encodeURIComponent(path)}&token=${encodeURIComponent(e.token)}`;
        const h = host();
        return h && typeof h.fileUrl === 'function' ? h.fileUrl(path) : null;
    }
    const list = (folder) => call({ op: 'list', path: folder }) || { items: [], folders: [] };
    const stat = (path) => call({ op: 'stat', path });

    // ---- settings ----------------------------------------------------------------------------------------------------

    function pin(path, on) { return call({ op: 'pin', path, on: on !== false }); }

    /** the folder's Offline Settings: kept on the server (every computer's), told to the host at once */
    async function setFolder(path, s) {
        const body = { path, caching: s.caching, writeBack: !!s.writeBack, optimized: !!s.optimized, reset: !!s.reset };
        call({ op: 'set', ...body });
        const resp = await fetch('/api/offline-files/settings', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!resp.ok) throw new Error('The server did not keep the setting.');
        call({ op: 'sync' });
        return resp.json();
    }

    const setLimits = (all, temp) => call({ op: 'limits', all, temp });
    const setEnabled = (on) => call({ op: 'enable', on: !!on });

    function syncNow() {
        call({ op: 'sync' });
        return new Promise((resolve) => {
            // done when the host says the pass is over (no wait on the page's side beyond that)
            let started = false;
            const off = on((s) => {
                if (s && s.busy) started = true;
                if (started && s && !s.busy) { off(); resolve(s); }
            });
            setTimeout(() => { if (!started) { off(); resolve(state()); } }, 3000);
        });
    }

    function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }

    // ---- Explorer -----------------------------------------------------------------------------------------------------

    // canonical listing paths (/Workspaces/<ws>/<folder id>) -> the offline name path, so an Explorer that lists with
    // no server can still find the folder's files on this computer
    let paths = null;
    function pathMap() {
        if (paths) return paths;
        try { paths = JSON.parse(root.localStorage.getItem(PATHS_KEY) || '{}') || {}; } catch (_) { paths = {}; }
        return paths;
    }
    function rememberPath(canonical, namePath) {
        const m = pathMap();
        if (!canonical || !namePath || m[canonical] === namePath) return;
        m[canonical] = namePath;
        try { root.localStorage.setItem(PATHS_KEY, JSON.stringify(m)); } catch (_) { /* full */ }
    }

    const overlayOf = (st) => (st === 'conflict' ? 'conflict' : 'sync');

    function localItem(it) {
        const isImage = /^image\//.test(it.mime || '');
        const url = it.local ? fileUrl(it.path) : null;
        return {
            id: `offline:${it.path}`,
            name: it.name,
            kind: 'file',
            targetKind: 'offline-file',
            targetId: it.path,
            mimeType: it.mime || 'application/octet-stream',
            icon: isImage ? 'fas fa-file-image' : (/^video\//.test(it.mime || '') ? 'fas fa-file-video' : 'fas fa-file'),
            system: false,
            protected: false,
            size: it.size,
            modifiedAt: Math.floor((it.modified || it.created || Date.now()) / 1000),
            previewUrl: isImage && url ? url : null,
            offlinePath: it.path,
            offline: { state: it.state, local: it.local },
            offlineOverlay: overlayOf(it.state),
            isOfflineLocal: true
        };
    }

    /** a server listing: the offline folder's files that only this computer has yet are added, every file marked */
    function decorate(listing) {
        if (!listing || !listing.offlinePath || !available()) return listing;
        const folder = listing.offlinePath;
        rememberPath(listing.path, folder);
        const pol = policy(folder);
        const inOffline = !!(pol && (pol.takes || pol.pinned || pol.writeBack));
        const sub = new Map();
        // a folder made available offline (or a write-back one: Camera Roll) carries the sync overlay where it is listed
        const folderOverlay = (it) => {
            if (inOffline) return pol.pinned || pol.writeBack ? 'sync' : null;
            if (sub.size > 200) return null;
            const p = policy(`${folder}/${it.name}`);
            sub.set(it.name, p);
            return p && (p.pinned || p.writeBack) ? 'sync' : null;
        };
        if (!inOffline) {
            const items = (listing.items || []).map((it) => {
                if (it.kind !== 'folder' || it.system) return it;
                const o = folderOverlay(it);
                return o ? { ...it, offlineOverlay: o } : it;
            });
            return { ...listing, items };
        }
        const local = list(folder);
        const byName = new Map((local.items || []).map((i) => [i.name.toLowerCase(), i]));
        const items = (listing.items || []).map((it) => {
            if (it.kind === 'folder') return { ...it, offlineOverlay: folderOverlay(it) };
            const mine = byName.get(String(it.name || '').toLowerCase());
            if (mine) byName.delete(String(it.name || '').toLowerCase());
            const st = mine ? mine.state : 'synced';
            return { ...it, offline: { state: st, local: !!(mine && mine.local), pinned: !!pol.pinned }, offlineOverlay: pol.pinned || (mine && mine.state !== 'synced') ? overlayOf(st) : null };
        });
        const names = new Set(items.filter((i) => i.kind === 'folder').map((i) => String(i.name).toLowerCase()));
        // folders this computer made that the server has not got yet (Camcorder's first recording)
        for (const n of local.folders || []) {
            if (names.has(n.toLowerCase())) continue;
            items.unshift({ id: `offline-folder:${folder}/${n}`, name: n, kind: 'folder', targetKind: 'offline-folder', navPath: `${folder}/${n}`, icon: 'fas fa-folder', offlineOverlay: 'sync' });
        }
        for (const it of byName.values()) if (it.state !== 'synced') items.push(localItem(it));
        return { ...listing, items, totalCount: items.length, offline: { policy: pol, online: !!(state() || {}).online } };
    }

    /** Explorer with no server: an offline folder's view from this computer (null: not an offline folder) */
    function offlineListing(path) {
        if (!available()) return null;
        const folder = pathMap()[path] || (/^\/Workspaces\/[^/]+\//.test(path || '') ? path : null);
        if (!folder) return null;
        const pol = policy(folder);
        if (!pol || !(pol.takes || pol.pinned)) return null;
        const l = list(folder);
        const items = [
            ...(l.folders || []).map((n) => ({ id: `offline-folder:${folder}/${n}`, name: n, kind: 'folder', targetKind: 'vfs-folder', navPath: `${folder}/${n}`, icon: 'fas fa-folder', offlineOverlay: 'sync' })),
            ...(l.items || []).filter((i) => i.local).map(localItem)
        ];
        return { path, items, totalCount: items.length, hasMore: false, offlinePath: folder, offline: { policy: pol, online: false }, emptyMessage: items.length ? null : 'This folder is empty.' };
    }

    const isLocalItem = (item) => !!(item && item.isOfflineLocal);
    /** a listed folder's offline name path (null: not a workspace folder, or not listed yet on this computer) */
    const namePathFor = (canonical) => pathMap()[canonical] || (/^\/Workspaces\/[^/]+(\/|$)/.test(canonical || '') && !/\/[0-9a-f-]{16,}(\/|$)/i.test(canonical) ? canonical : null);
    const isPinned = (path) => !!((policy(path) || {}).pinned);

    async function openLocal(item) {
        const url = fileUrl(item.offlinePath);
        if (!url) return false;
        const mime = item.mimeType || '';
        if (/^image\//.test(mime) && typeof root.openImageInViewer === 'function') { root.openImageInViewer(url, item.name, {}); return true; }
        if (/^(video|audio)\//.test(mime)) {
            const fl = root.featureLoader;
            if (fl && typeof fl.loadFeature === 'function') await fl.loadFeature('media_player');
            if (typeof root.openDesktopMediaPlayerUrl === 'function') { root.openDesktopMediaPlayerUrl(url, item.name); return true; }
        }
        return false;
    }

    // ---- Sync Center ------------------------------------------------------------------------------------------------

    function when(ms) {
        const d = new Date(ms);
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
    }

    function partnership() {
        const s = state() || {};
        const conflicts = (s.conflicts || []).length;
        const errors = (s.errors || []).length;
        const busy = !!s.busy;
        let percent = 0;
        if (busy && s.busy.total) percent = Math.min(100, Math.round((s.busy.done / s.busy.total) * 100));
        let status;
        if (busy) status = 'Sync in progress';
        else if (!s.lastSync) status = 'Ready for first sync';
        else if (conflicts) status = `Sync completed with ${conflicts} conflict${conflicts === 1 ? '' : 's'}`;
        else if (errors) status = `Sync failed with ${errors} error${errors === 1 ? '' : 's'}`;
        else status = `Last sync on ${when(s.lastSync)}`;
        const folders = Object.entries(s.folders || {}).filter(([, f]) => f.pinned || f.writeBack).map(([p]) => folderLabel(p));
        return {
            name: 'Offline Files',
            status,
            busy,
            percent,
            marquee: busy && !(s.busy && s.busy.total),
            category: 'Folders',
            last: s.lastSync ? { at: s.lastSync, result: conflicts ? 'conflict' : (errors || s.lastError ? 'error' : 'ok') } : null,
            conflicts,
            errors,
            icon: `${ART}/offline-files-16.png`,
            detail: s.online === false ? 'Offline (not connected)' : (folders.length ? `${folders.join(', ')}${s.pending ? ` - ${s.pending} file${s.pending === 1 ? '' : 's'} waiting to sync` : ''}` : 'Network files available offline')
        };
    }

    function conflicts() {
        return ((state() || {}).conflicts || []).map((c) => ({ id: c.id, name: c.name, path: folderLabel(c.folder), detail: c.detail, localAt: c.localAt || null, serverAt: c.serverAt || null }));
    }

    function resolve(path, keep) {
        if (keep) { const r = call({ op: 'resolve', path, keep }); return !!(r && r.ok); }
        return openResolve(path);
    }

    function kit() {
        const fl = root.featureLoader;
        const ready = fl && typeof fl.loadFeature === 'function' ? fl.loadFeature('vista_dialog_templates') : Promise.resolve();
        return Promise.resolve(ready).catch(() => null).then(() => root.vistaDialogTemplate || null);
    }
    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const sizeText = (n) => (typeof root.melatonStorage === 'object' && root.melatonStorage && typeof root.melatonStorage.size === 'function' ? root.melatonStorage.size(n || 0) : `${Math.round((n || 0) / 1024)} KB`);

    let resolving = null;
    /** Resolve Conflict (shell32's conflict dialog, as Sync Center opens it): keep one version, or both */
    async function openResolve(path) {
        const c = ((state() || {}).conflicts || []).find((x) => x.id === path);
        if (!c || resolving) return false;
        const V = await kit();
        if (!V || typeof V.openDialog !== 'function') return false;
        const server = 'the server';
        const icon = /\.(png|jpe?g|gif|webp|bmp)$/i.test(c.name) ? '/static_images/vista-icons/explorer/image-48.png' : '/static_images/vista-icons/explorer/file-48.png';
        const card = (loc, lines) => `<span class="ofc-card"><img src="${icon}" alt="" draggable="false" onerror="this.style.visibility='hidden'"><span class="ofc-card-text"><b>${esc(c.name)}</b><span class="ofc-loc">${esc(loc)}</span>${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</span></span>`;
        const newer = (a, b) => (a && b && a > b ? ' (newer)' : '');
        const deleted = c.kind === 'deleted-server';
        resolving = V.openDialog({
            id: 'offlineFilesResolveConflictDialog',
            tpl: { t: 'Resolve Conflict', w: 256, h: 235, f: ['Segoe UI', 9], s: 0x80C800C8, c: [] },
            icon: '/static_images/vista-sync/sync-center-16.png',
            bareCaption: true,
            init: (ctx) => {
                const wrap = doc.createElement('div');
                wrap.className = 'ofc';
                wrap.innerHTML = `
                    <div class="ofc-instruction">${esc(c.detail)}</div>
                    <div class="ofc-sub">Click the version you want to keep</div>
                    <button type="button" class="ofc-option" data-ofc="local">
                        <span class="ofc-head">Keep this version</span>
                        <span class="ofc-desc">Keep this version and copy it to the other location:</span>
                        ${card(`${folderLabel(c.folder)} (this computer)`, [`Size: ${sizeText(c.localSize)}`, `Date modified: ${c.localAt ? when(c.localAt) : 'Unknown'}${newer(c.localAt, c.serverAt)}`])}
                    </button>
                    <button type="button" class="ofc-option" data-ofc="server">
                        <span class="ofc-head">${deleted ? 'Delete this version' : 'Keep this version'}</span>
                        <span class="ofc-desc">${deleted ? 'The file was deleted on the server. Delete it on this computer too:' : 'Keep this version and copy it to the other location:'}</span>
                        ${deleted ? '' : card(`${folderLabel(c.folder)} (${server})`, [`Size: ${sizeText(c.serverSize)}`, `Date modified: ${c.serverAt ? when(c.serverAt) : 'Unknown'}${newer(c.serverAt, c.localAt)}`])}
                    </button>
                    ${deleted ? '' : `<button type="button" class="ofc-option ofc-both" data-ofc="both">
                        <span class="ofc-head">Keep both versions</span>
                        <span class="ofc-desc">The version on this computer is renamed and both are kept in the same location.</span>
                    </button>`}
                    <div class="ofc-footer"><button type="button" class="tbp-ctl tbp-button" data-ofc="cancel" data-dialog-primary="1">Cancel</button></div>`;
                ctx.content.appendChild(wrap);
                wrap.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-ofc]');
                    if (!b) return;
                    const keep = b.dataset.ofc;
                    const r = resolving;
                    resolving = null;
                    if (r) { try { r.close(); } catch (_) { /* gone */ } }
                    if (keep !== 'cancel') call({ op: 'resolve', path: c.id, keep });
                });
                ctx.modal.addEventListener('keydown', (ev) => {
                    if (ev.key !== 'Escape') return;
                    ev.preventDefault();
                    const r = resolving;
                    resolving = null;
                    if (r) { try { r.close(); } catch (_) { /* gone */ } }
                });
            },
            cancel: () => { resolving = null; }
        });
        return true;
    }

    // ---- Offline Settings (a folder's caching, filemgmt.dll dialog 239) ---------------------------------------------

    // filemgmt.dll.mui 239 as the VM has it, with Melaton's write-back check box (334) under the third choice
    const OFFLINE_SETTINGS = {
        t: 'Offline Settings', w: 273, h: 192, f: ['MS Shell Dlg', 8], s: 2160591040,
        c: [[400, 'S', 7, 7, 20, 20, 1342177283, '#237', 0],
            [402, 'S', 39, 7, 227, 25, 1342308352, 'You can choose whether and how the contents of the share will be available to users who are offline.', 0],
            [329, 'B', 7, 41, 259, 12, 1342383113, '&Only the files and programs that users specify will be available offline.', 0],
            [330, 'B', 7, 56, 259, 18, 1342186505, '&All files and programs that users open from the share will be automatically available offline.', 0],
            [332, 'B', 20, 75, 246, 10, 1342373891, 'Optimized for &performance', 0],
            [331, 'B', 7, 90, 259, 12, 1342186505, '&Files or programs from the share will not be available offline.', 0],
            [334, 'B', 7, 108, 259, 18, 1342373891, '&Send files created on a computer to the server using Offline Files (they are kept on that computer until the server has them).', 0],
            [333, 'SysLink', 7, 134, 259, 8, 1342242816, '<A>How do offline files work?</A>', 0],
            [1, 'B', 160, 171, 50, 14, 1342242817, 'OK', 0],
            [2, 'B', 216, 171, 50, 14, 1342242816, 'Cancel', 0]]
    };

    async function openOfflineSettings(folder, owner) {
        const V = await kit();
        if (!V || typeof V.openDialog !== 'function') return;
        const cur = policy(folder) || { caching: 'manual', writeBack: false, optimized: false };
        V.openDialog({
            id: 'offlineFilesSettingsDialog',
            tpl: OFFLINE_SETTINGS,
            key: 'filemgmt:239',
            owner,
            init: (ctx) => {
                ctx.set(329, cur.caching === 'manual');
                ctx.set(330, cur.caching === 'auto');
                ctx.set(331, cur.caching === 'none');
                ctx.set(332, !!cur.optimized);
                ctx.set(334, !!cur.writeBack);
                const sync = () => ctx.enable(332, ctx.get(330));
                sync();
                [329, 330, 331].forEach((id) => ctx.on(id, 'change', sync));
                ctx.on(333, 'click', (ev) => { if (ev && ev.preventDefault) ev.preventDefault(); if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('offline-files'); });
            },
            ok: async (ctx) => {
                const caching = ctx.get(330) ? 'auto' : (ctx.get(331) ? 'none' : 'manual');
                try {
                    await setFolder(folder, { caching, writeBack: ctx.get(334), optimized: caching === 'auto' && ctx.get(332) });
                } catch (err) {
                    if (typeof root.showConfirmationDialog === 'function') {
                        await root.showConfirmationDialog(`The offline settings could not be saved.\n${err.message || err}`, [{ text: 'OK', value: true }], null, { title: 'Offline Settings', icon: 'fas fa-circle-exclamation' });
                    }
                    return false;
                }
                return true;
            }
        });
    }

    root.melatonOfflineFiles = {
        available, state, on, policy, takes, space, createWriter, putFile, list, stat, fileUrl, pin, setFolder, syncNow,
        resolve, decorate, offlineListing, isLocalItem, openLocal, openOfflineSettings, folderLabel, namePathFor, isPinned, setLimits, setEnabled
    };

    // Sync Center's Offline Files partnership (syncCenter.js, loaded before this file; desktop pages only)
    const desktop = () => !(doc && doc.documentElement && doc.documentElement.classList.contains('ui-mobile'));
    // registered once syncCenter.js is there (it may load after this file)
    function registerPartnership() {
        if (!root.melatonSyncCenter || !host() || !desktop()) return false;
        root.melatonSyncCenter.register({
            id: 'offline-files',
            partnership,
            conflicts,
            results: () => loadResults().slice(),
            syncNow,
            resolve: (id) => { void openResolve(id); },
            clearResults: () => { results = []; try { root.localStorage.removeItem(RESULTS_KEY); } catch (_) { /* fine */ } for (const fn of [...listeners]) fn(sum); },
            on
        });
        return true;
    }
    if (!registerPartnership() && doc && host()) doc.addEventListener('DOMContentLoaded', registerPartnership, { once: true, signal: appScopeSignal });
})(typeof window !== 'undefined' ? window : globalThis);
