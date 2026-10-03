// modules/vfsFuseHttp.js
//
// VFS-over-HTTP for a Linux FUSE client. Mounted by web_server.js registerVfsRoutes at
// `${vfsPath}/fs/...` behind the same authMiddleware as `${vfsPath}/files/:fileId`.
// Every operation delegates to modules/vfsManager.js / vfsDatabase — the same engine the
// WS packets in modules/vfsWebSocketHandlers.js use. There is no second storage engine.
//
// ---------------------------------------------------------------------------
// CONTRACT (match this in the separate fuse repo)
// ---------------------------------------------------------------------------
// `path`/`from`/`to` are VFS paths built from display names, e.g. `/`, `/@desktop`,
// `/System/Director/workspace/AGENTS.md`, `/Workspaces/default/Pictures/foo.png`.
// They are NOT host paths. Segments are matched by name (exact, then case-insensitive)
// against the parent listing, so canonical folder-id paths work too.
// `.` and `..` segments are refused: a request cannot leave the VFS root.
//
// Responses are JSON `{ success: true, ... }` except GET /fs/read, which returns raw
// bytes with the entry's own Content-Type. Failures are JSON `{ success: false, error }`
// with 400 (bad request), 403 (denied / not writable / escapes root), 404 (not found),
// 413 (too large) or 415 (entry has no byte stream).
//
//   GET  /fs/list?path=&offset=&limit=&sortField=&sortDirection=&search=
//        -> { success, path, canonicalPath, totalCount, totalSizeBytes, hasMore,
//             entries: [{ path, name, kind: 'dir'|'file', size, mtime, mimeType,
//                         targetKind, targetId, readOnly, systemFileKey }] }
//        `mtime` is unix seconds or an ISO string, depending on the backing store.
//
//   GET  /fs/stat?path=
//        -> { success, ...same entry fields, canonicalPath }
//
//   GET  /fs/read?path=
//        -> raw bytes. Readable kinds: user-file, system-file, image, scrap, note.
//           Other kinds (reference, vibe, shortcut) answer 415.
//
//   PUT  /fs/write?path=
//        Raw request body. Content-Type becomes the stored mime type (an existing
//        file keeps its own type when the body is sent as application/octet-stream).
//        Creates a user file, or replaces the bytes of an existing user file.
//        -> { success, file }
//
//   POST /fs/mkdir   { path }            -> { success, folder }
//   POST /fs/rename  { from, to }        in-place rename; `to` is a bare name or a
//                                        path with the same parent as `from`.
//                                        -> { success, name }
//   POST /fs/move    { from, to }        full FUSE rename(2): `to` is the complete
//                                        destination path, so it both moves and
//                                        renames.  -> { success, path }
//   POST /fs/copy    { from, to }        as /fs/move but duplicates.
//                                        -> { success, path }
//   POST /fs/trash   { path }            -> { success, results }
//
// /System is read-only; writes under it answer 403 from the manager.
// ---------------------------------------------------------------------------

const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LIST_HARD_LIMIT = 100000;
const LIST_DEFAULT_LIMIT = 1000;
const WRITE_MAX_BYTES = 100 * 1024 * 1024;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{16,128}$/i;
const READABLE_KINDS = new Set(['user-file', 'system-file', 'image', 'scrap', 'note']);

function registerVfsFuseRoutes(app, { vfsPath, authMiddleware, globalResources }) {
    const vfs = () => globalResources.getVfsManager();
    const vfsDb = () => globalResources.getVfsDatabase();

    function fail(res, status, error) {
        return res.status(status).json({ success: false, error });
    }

    // Same per-file scope gate the `${vfsPath}/files/:fileId` route applies.
    const workspaceExists = (id) => !!globalResources.getWorkspaceManager().getWorkspaces()[id];

    function buildVfsSession(req) {
        return {
            userType: req.userType || req.session?.userType || 'admin',
            applicationScopes: req.applicationAuth?.applicationScopes
        };
    }

    function statusForError(err) {
        const message = err?.message || '';
        if (/not found|no longer exists|missing/i.test(message)) return 404;
        if (/denied|cannot |reserved|read-?only|not supported|only supported/i.test(message)) return 403;
        if (/too large/i.test(message)) return 413;
        return 400;
    }

    // Confinement: a VFS path is a list of plain display segments. Empty, `.` and `..`
    // segments are refused, and resolution only ever follows navPath values the manager
    // itself produced, so a request cannot address anything outside the VFS root.
    function pathSegments(input) {
        if (input == null) return null;
        const raw = String(input).replace(/\\/g, '/');
        const segments = raw.split('/').filter(Boolean);
        if (segments.some(s => s === '.' || s === '..')) return null;
        return segments;
    }

    function joinSegments(segments) {
        return segments.length ? `/${segments.join('/')}` : '/';
    }

    function childPath(basePath, name) {
        return basePath === '/' ? `/${name}` : `${basePath}/${name}`;
    }

    function toInt(value, fallback) {
        const parsed = parseInt(value, 10);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
    }

    function describeEntry(item, itemPath) {
        return {
            path: itemPath,
            name: item.name,
            kind: item.kind === 'folder' ? 'dir' : 'file',
            size: item.size || 0,
            mtime: item.modifiedAt || null,
            mimeType: item.mimeType || null,
            targetKind: item.targetKind || null,
            targetId: item.targetId || null,
            readOnly: !!(item.protected || item.system || item.readOnly),
            systemFileKey: item.systemFileKey || null
        };
    }

    function broadcastVfsUpdated(pathHint) {
        try {
            globalResources.getWebSocketServer().broadcast({
                type: 'vfs_updated',
                data: { path: pathHint },
                timestamp: new Date().toISOString()
            });
        } catch (_) { /* HTTP mutations must not depend on a live WS server */ }
    }

    async function findChild(dirPath, name) {
        const result = await vfs().listDirectory(dirPath, {
            offset: 0,
            limit: LIST_HARD_LIMIT,
            search: name.length >= 2 ? name : ''
        });
        const items = result.items || [];
        return items.find(i => i.name === name)
            || items.find(i => (i.name || '').toLowerCase() === name.toLowerCase())
            || null;
    }

    async function resolveDirPath(segments) {
        let canonical = '/';
        for (const segment of segments) {
            const item = await findChild(canonical, segment);
            if (!item || item.kind !== 'folder' || !item.navPath) return null;
            canonical = item.navPath;
        }
        return canonical;
    }

    async function resolveEntry(segments) {
        if (!segments.length) {
            return { kind: 'dir', canonicalPath: '/', parentPath: null, name: '/', item: null };
        }
        const parentPath = await resolveDirPath(segments.slice(0, -1));
        if (!parentPath) return null;
        const item = await findChild(parentPath, segments[segments.length - 1]);
        if (!item) return null;
        if (item.kind === 'folder') {
            if (!item.navPath) return null;
            return { kind: 'dir', canonicalPath: item.navPath, parentPath, name: item.name, item };
        }
        return { kind: 'file', canonicalPath: null, parentPath, name: item.name, item };
    }

    // modules/vfsWebSocketHandlers.js _gcContentBlobIfUnreferenced
    async function gcContentBlobIfUnreferenced(contentHash) {
        if (!contentHash) return;
        const remaining = await vfsDb().countUserFilesByContentHash(contentHash);
        if (remaining > 0) return;
        const manager = vfs();
        const blobPath = manager.getFileBlobPath(contentHash);
        if (fs.existsSync(blobPath)) {
            try { fs.unlinkSync(blobPath); } catch (_) { /* ignore */ }
        }
        const previewPath = manager.getFilePreviewPath(`${contentHash}.webp`);
        if (previewPath && fs.existsSync(previewPath)) {
            try { fs.unlinkSync(previewPath); } catch (_) { /* ignore */ }
        }
    }

    async function streamSystemFile(res, item) {
        const manager = vfs();
        const key = item.systemFileKey || item.targetId;
        let download = null;
        try {
            download = manager.resolveSystemFileDownload(key);
        } catch (_) { /* text and image keys preview instead of downloading */ }

        if (download) {
            if (!fs.existsSync(download.absPath)) return fail(res, 404, 'File not found');
            res.setHeader('Content-Type', download.mimeType || 'application/octet-stream');
            res.setHeader('Content-Length', String(download.size));
            return fs.createReadStream(download.absPath).pipe(res);
        }

        const payload = await manager.readSystemFile(key);
        if (payload.kind === 'image') {
            const buffer = Buffer.from(payload.base64, 'base64');
            res.setHeader('Content-Type', payload.mimeType || 'application/octet-stream');
            res.setHeader('Content-Length', String(buffer.length));
            return res.end(buffer);
        }
        if (payload.kind === 'text') {
            const buffer = Buffer.from(payload.content || '', 'utf8');
            res.setHeader('Content-Type', `${payload.mimeType || 'text/plain'}; charset=utf-8`);
            res.setHeader('Content-Length', String(buffer.length));
            return res.end(buffer);
        }
        return fail(res, 415, payload.message || 'Entry has no byte stream');
    }

    async function streamFileEntry(req, res, item) {
        const kind = item.targetKind;
        if (!READABLE_KINDS.has(kind)) {
            return fail(res, 415, `Cannot read ${kind || item.kind} entries`);
        }

        if (kind === 'user-file') {
            const file = await vfsDb().getUserFileById(item.targetId);
            if (!file) return fail(res, 404, 'File not found');
            if (!vfsDb().canSessionAccessVfsFile(buildVfsSession(req), file, { workspaceExists })) {
                return fail(res, 403, 'Access denied');
            }
            if (!CONTENT_HASH_PATTERN.test(file.content_hash || '')) {
                return fail(res, 404, 'File blob missing');
            }
            const blobPath = vfs().getFileBlobPath(file.content_hash);
            if (!fs.existsSync(blobPath)) return fail(res, 404, 'File blob missing');
            res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
            res.setHeader('Content-Length', String(fs.statSync(blobPath).size));
            return fs.createReadStream(blobPath).pipe(res);
        }

        if (kind === 'image' || kind === 'scrap') {
            // Membership was already proven by the workspace listing that produced this item.
            const filename = path.basename(String(item.targetId || ''));
            const abs = path.join(globalResources.getPath('images'), filename);
            if (!filename || !fs.existsSync(abs)) return fail(res, 404, 'Image not found');
            res.setHeader('Content-Type', item.mimeType || 'image/png');
            res.setHeader('Content-Length', String(fs.statSync(abs).size));
            return fs.createReadStream(abs).pipe(res);
        }

        if (kind === 'note') {
            const note = await globalResources.getNotesDatabase().getNote(item.targetId);
            if (!note) return fail(res, 404, 'Note not found');
            const buffer = Buffer.from(note.content || '', 'utf8');
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Length', String(buffer.length));
            return res.end(buffer);
        }

        return streamSystemFile(res, item);
    }

    async function renameEntryInPlace(item, newName) {
        const kind = item.targetKind;
        if (kind === 'vfs-folder') {
            return vfs().renameFolderAtPath(item.targetId || item.id, newName);
        }
        if (kind === 'user-file') {
            return vfsDb().updateUserFile(item.targetId, { original_name: newName });
        }
        if (kind === 'vfs-entry' || item.isShortcut || item.vfsEntryId) {
            return vfs().renameEntry(item.vfsEntryId || item.id, newName);
        }
        throw new Error(`Cannot rename ${kind || item.kind} entries`);
    }

    function requestBodyBuffer(req) {
        if (Buffer.isBuffer(req.body)) return req.body;
        if (typeof req.body === 'string') return Buffer.from(req.body, 'utf8');
        // The global express.json() already consumed an application/json body.
        if (req.body && typeof req.body === 'object') {
            return Buffer.from(JSON.stringify(req.body), 'utf8');
        }
        return Buffer.alloc(0);
    }

    app.get(`${vfsPath}/fs/list`, authMiddleware, async (req, res) => {
        try {
            const segments = pathSegments(req.query.path == null ? '/' : req.query.path);
            if (!segments) return fail(res, 403, 'Path escapes the VFS root');
            const dirPath = await resolveDirPath(segments);
            if (!dirPath) return fail(res, 404, 'Directory not found');

            const result = await vfs().listDirectory(dirPath, {
                offset: toInt(req.query.offset, 0),
                limit: Math.min(toInt(req.query.limit, LIST_DEFAULT_LIMIT), LIST_HARD_LIMIT),
                sortField: req.query.sortField || 'name',
                sortDirection: req.query.sortDirection || 'asc',
                search: req.query.search || ''
            });

            const base = joinSegments(segments);
            res.json({
                success: true,
                path: base,
                canonicalPath: result.path,
                totalCount: result.totalCount,
                totalSizeBytes: result.totalSizeBytes,
                hasMore: result.hasMore,
                entries: (result.items || []).map(item => describeEntry(item, childPath(base, item.name)))
            });
        } catch (e) {
            fail(res, statusForError(e), e.message);
        }
    });

    app.get(`${vfsPath}/fs/stat`, authMiddleware, async (req, res) => {
        try {
            const segments = pathSegments(req.query.path);
            if (!segments) return fail(res, 403, 'path is required and must stay inside the VFS root');
            const entry = await resolveEntry(segments);
            if (!entry) return fail(res, 404, 'Path not found');

            const base = joinSegments(segments);
            if (!entry.item) {
                const stats = await vfs().getPathStats('/');
                return res.json({
                    success: true,
                    path: base,
                    canonicalPath: '/',
                    name: '/',
                    kind: 'dir',
                    size: stats.totalSizeBytes || 0,
                    mtime: null,
                    mimeType: null,
                    targetKind: 'vfs-root',
                    targetId: null,
                    readOnly: true,
                    systemFileKey: null
                });
            }
            res.json({
                success: true,
                ...describeEntry(entry.item, base),
                canonicalPath: entry.canonicalPath
            });
        } catch (e) {
            fail(res, statusForError(e), e.message);
        }
    });

    app.get(`${vfsPath}/fs/read`, authMiddleware, async (req, res) => {
        try {
            const segments = pathSegments(req.query.path);
            if (!segments) return fail(res, 403, 'path is required and must stay inside the VFS root');
            if (!segments.length) return fail(res, 403, 'Path is a directory');
            const entry = await resolveEntry(segments);
            if (!entry) return fail(res, 404, 'Path not found');
            if (entry.kind !== 'file') return fail(res, 403, 'Path is a directory');
            await streamFileEntry(req, res, entry.item);
        } catch (e) {
            if (res.headersSent) return res.end();
            fail(res, statusForError(e), e.message);
        }
    });

    app.put(
        `${vfsPath}/fs/write`,
        authMiddleware,
        express.raw({ type: '*/*', limit: WRITE_MAX_BYTES }),
        async (req, res) => {
            try {
                const segments = pathSegments(req.query.path);
                if (!segments) return fail(res, 403, 'path is required and must stay inside the VFS root');
                if (!segments.length) return fail(res, 403, 'Cannot write the VFS root');

                const name = segments[segments.length - 1];
                const parentPath = await resolveDirPath(segments.slice(0, -1));
                if (!parentPath) return fail(res, 404, 'Parent directory not found');

                const buffer = requestBodyBuffer(req);
                if (buffer.length > WRITE_MAX_BYTES) {
                    return fail(res, 413, 'Body exceeds the write limit');
                }
                const declaredMime = (req.get('content-type') || '').split(';')[0].trim();
                const existing = await findChild(parentPath, name);

                if (existing) {
                    if (existing.targetKind !== 'user-file') {
                        return fail(res, 403, `Cannot overwrite ${existing.targetKind} entries`);
                    }
                    const file = await vfsDb().getUserFileById(existing.targetId);
                    if (!file) return fail(res, 404, 'File not found');

                    const mimeType = declaredMime && declaredMime !== 'application/octet-stream'
                        ? declaredMime
                        : (file.mime_type || 'application/octet-stream');
                    const hash = crypto.createHash('md5').update(buffer).digest('hex');
                    const blobPath = vfs().getFileBlobPath(hash);
                    if (!fs.existsSync(blobPath)) {
                        fs.writeFileSync(blobPath, buffer);
                    }
                    const updated = await vfsDb().updateUserFile(file.id, {
                        content_hash: hash,
                        mime_type: mimeType,
                        size: buffer.length
                    });
                    if (file.content_hash && file.content_hash !== hash) {
                        await gcContentBlobIfUnreferenced(file.content_hash);
                    }
                    broadcastVfsUpdated(parentPath);
                    return res.json({ success: true, file: updated });
                }

                const location = vfs().resolveLocationFromPath(parentPath);
                const file = await vfs().saveUserFileBuffer(buffer, {
                    originalName: name,
                    mimeType: declaredMime || 'application/octet-stream',
                    scope: location.scope,
                    workspaceId: location.workspaceId,
                    folderId: location.folderId
                });
                broadcastVfsUpdated(parentPath);
                res.json({ success: true, file });
            } catch (e) {
                fail(res, statusForError(e), e.message);
            }
        }
    );

    app.post(`${vfsPath}/fs/mkdir`, authMiddleware, async (req, res) => {
        try {
            const segments = pathSegments(req.body?.path);
            if (!segments) return fail(res, 403, 'path is required and must stay inside the VFS root');
            if (!segments.length) return fail(res, 403, 'Cannot create the VFS root');

            const parentPath = await resolveDirPath(segments.slice(0, -1));
            if (!parentPath) return fail(res, 404, 'Parent directory not found');
            const folder = await vfs().createFolderAtPath(parentPath, segments[segments.length - 1]);
            broadcastVfsUpdated(parentPath);
            res.json({ success: true, folder });
        } catch (e) {
            fail(res, statusForError(e), e.message);
        }
    });

    app.post(`${vfsPath}/fs/rename`, authMiddleware, async (req, res) => {
        try {
            const from = pathSegments(req.body?.from);
            const to = pathSegments(req.body?.to);
            if (!from || !to) return fail(res, 403, 'from and to are required and must stay inside the VFS root');
            if (!from.length || !to.length) return fail(res, 403, 'Cannot rename the VFS root');
            if (to.length > 1 && joinSegments(to.slice(0, -1)) !== joinSegments(from.slice(0, -1))) {
                return fail(res, 400, 'rename only changes the last segment — use /fs/move to change parents');
            }

            const entry = await resolveEntry(from);
            if (!entry) return fail(res, 404, 'Path not found');
            const newName = to[to.length - 1];
            await renameEntryInPlace(entry.item, newName);
            broadcastVfsUpdated(entry.parentPath);
            res.json({ success: true, name: newName });
        } catch (e) {
            fail(res, statusForError(e), e.message);
        }
    });

    async function relocate(req, res, { copy }) {
        const from = pathSegments(req.body?.from);
        const to = pathSegments(req.body?.to);
        if (!from || !to) return fail(res, 403, 'from and to are required and must stay inside the VFS root');
        if (!from.length || !to.length) return fail(res, 403, 'Cannot relocate the VFS root');

        const entry = await resolveEntry(from);
        if (!entry) return fail(res, 404, 'Path not found');
        const destParent = await resolveDirPath(to.slice(0, -1));
        if (!destParent) return fail(res, 404, 'Destination directory not found');

        const destName = to[to.length - 1];
        if (copy) {
            await vfs().copyItems([entry.item], destParent, { userFileCopyMode: 'duplicate' });
        } else if (destParent !== entry.parentPath) {
            await vfs().moveItems([entry.item], destParent);
        }

        if (destName !== entry.name) {
            const landed = await findChild(destParent, entry.name);
            if (!landed) return fail(res, 404, 'Relocated entry could not be resolved for rename');
            await renameEntryInPlace(landed, destName);
        }

        broadcastVfsUpdated(destParent);
        res.json({ success: true, path: childPath(joinSegments(to.slice(0, -1)), destName) });
    }

    app.post(`${vfsPath}/fs/move`, authMiddleware, async (req, res) => {
        try {
            await relocate(req, res, { copy: false });
        } catch (e) {
            fail(res, statusForError(e), e.message);
        }
    });

    app.post(`${vfsPath}/fs/copy`, authMiddleware, async (req, res) => {
        try {
            await relocate(req, res, { copy: true });
        } catch (e) {
            fail(res, statusForError(e), e.message);
        }
    });

    app.post(`${vfsPath}/fs/trash`, authMiddleware, async (req, res) => {
        try {
            const segments = pathSegments(req.body?.path);
            if (!segments) return fail(res, 403, 'path is required and must stay inside the VFS root');
            if (!segments.length) return fail(res, 403, 'Cannot trash the VFS root');

            const entry = await resolveEntry(segments);
            if (!entry) return fail(res, 404, 'Path not found');
            const results = await vfs().moveItemsToTrash([entry.item], entry.parentPath);
            broadcastVfsUpdated(entry.parentPath);
            res.json({ success: true, results });
        } catch (e) {
            fail(res, statusForError(e), e.message);
        }
    });
}

module.exports = { registerVfsFuseRoutes };
