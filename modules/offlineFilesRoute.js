'use strict';

/**
 * Offline Files for CaféReady clients (#910, Yukimi, Nov 20 2026): Vista's Offline Files (Client-Side Caching) on
 * the installed clients. The client's CaféReady host keeps the local cache and its write-back queue (DreamOS:
 * cafeready offline.rs; DSApp: the same host interface) and talks to this route with the browser's session. Bodies go
 * over HTTP in chunks, resumable and verified by the VFS content hash (md5), so a proxy's body limit, a flaky link or
 * a multi-GB recording never decide whether a file reaches the server.
 *
 *   GET    /api/offline-files/settings                 { folders: { <display path>: { caching, writeBack } }, rules }
 *          caching = Vista's Offline Settings: manual ("Only the files and programs that users specify will be
 *          available offline"), auto ("All files and programs that users open ... automatically available offline",
 *          optimized: "Optimized for performance"), none ("Files or programs from the share will not be available
 *          offline"); writeBack = files written on a client are kept there first and sent here by Offline Files.
 *   POST   /api/offline-files/settings                 { path, caching, writeBack, optimized } -> that folder's setting
 *   GET    /api/offline-files/folder?path=             { path, display, files: [{ id, name, md5, size, mime, updated }],
 *                                                        folders: [{ id, name }] } (404 code NO_FOLDER)
 *   POST   /api/offline-files/upload/begin             { folder, name, size, md5, base, id?, mime } -> { id, received,
 *          chunkSize }; base = the server copy's md5 the client last saw (null: a file created on the client). The id
 *          is the client's own (it survives the client's reboots): a known id answers with what is already here.
 *   POST   /api/offline-files/upload/:id/chunk?offset=N raw bytes in order (409 OFFSET answers with what is here)
 *   POST   /api/offline-files/upload/:id/commit        { keep?: 'local' | 'both' } -> { file } | 409 CONFLICT { server }
 *          The bytes are hashed again here; a wrong md5 is 422 HASH (the client sends the file again). CONFLICT: a file
 *          of that name is on the server with another md5 than base (changed on the server and on the client). keep
 *          'local' replaces the server's copy, 'both' stores the client's beside it as "<name> (<computer> v1).<ext>".
 *   DELETE /api/offline-files/upload/:id
 *   GET    /api/offline-files/file/:id                 the file's bytes (Range) for "Always available offline"
 *
 * Folders are made as needed (Camera Roll, Camera Roll/Camcorder). The default rule: a workspace's "Camera Roll"
 * (and what is inside it) is caching none + writeBack (Yukimi: "Don't store files offline" and "Send files to server
 * using Offline Files"). Uploads in flight live in <databases>/offline-files/<id>(.json); a week untouched = swept.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHUNK_BYTES = 4 * 1024 * 1024;
const MAX_CHUNK_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024 * 1024;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const CACHING = ['manual', 'auto', 'none'];
const RULES = [{ name: 'Camera Roll', depth: 'workspace', caching: 'none', writeBack: true, inherit: true }];

const metas = new Map();
const writing = new Set();

function baseDir(gr) {
    const base = gr && typeof gr.getPath === 'function' ? gr.getPath('databases') : path.resolve(__dirname, '..', '.cache');
    return path.join(base, 'offline-files');
}
const isId = (s) => typeof s === 'string' && /^[0-9a-f]{32}$/.test(s);
const dataPath = (gr, id) => path.join(baseDir(gr), `${id}.part`);
const metaPath = (gr, id) => path.join(baseDir(gr), `${id}.json`);
const settingsPath = (gr) => path.join(baseDir(gr), 'settings.json');

function cleanName(s) {
    const n = String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').trim().slice(0, 255);
    return n && n !== '.' && n !== '..' ? n : '';
}
function cleanPath(p) {
    const s = String(p || '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/, '');
    return s.startsWith('/') && !s.split('/').some((x) => x === '..') ? s : '';
}
function refuse(res, status, code, error, extra) { res.status(status).json({ success: false, code, error, ...(extra || {}) }); }

function readBody(req, limit) {
    return new Promise((resolve, reject) => {
        const parts = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > limit) { reject(Object.assign(new Error('The chunk is too large.'), { code: 'TOO_LARGE' })); req.destroy(); return; }
            parts.push(c);
        });
        req.on('end', () => resolve(Buffer.concat(parts)));
        req.on('error', reject);
    });
}

function md5File(file) {
    return new Promise((resolve, reject) => {
        const h = crypto.createHash('md5');
        fs.createReadStream(file).on('error', reject).on('data', (c) => h.update(c)).on('end', () => resolve(h.digest('hex')));
    });
}

async function loadMeta(gr, id) {
    if (!isId(id)) return null;
    if (metas.has(id)) return metas.get(id);
    let meta;
    try { meta = JSON.parse(await fs.promises.readFile(metaPath(gr, id), 'utf8')); } catch (_) { return null; }
    // the description may lag the bytes by a chunk after a crash: the bytes are written in order, so their size is it
    try { meta.received = (await fs.promises.stat(dataPath(gr, id))).size; } catch (_) { meta.received = 0; }
    metas.set(id, meta);
    return meta;
}
async function persistMeta(gr, meta) {
    meta.touched = Date.now();
    const tmp = `${metaPath(gr, meta.id)}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(meta));
    await fs.promises.rename(tmp, metaPath(gr, meta.id));
}
async function removeUpload(gr, id) {
    metas.delete(id);
    await fs.promises.unlink(dataPath(gr, id)).catch(() => {});
    await fs.promises.unlink(metaPath(gr, id)).catch(() => {});
}
async function sweep(gr) {
    let names = [];
    try { names = await fs.promises.readdir(baseDir(gr)); } catch (_) { return; }
    const now = Date.now();
    for (const n of names) {
        const m = /^([0-9a-f]{32})\.json$/.exec(n);
        if (!m) continue;
        const meta = await loadMeta(gr, m[1]);
        if (meta && now - (meta.touched || meta.created || 0) > KEEP_MS) await removeUpload(gr, m[1]);
    }
}

// ---------------------------------------------------------------- folder settings (Vista's Offline Settings)

let settingsCache = null;
async function loadSettings(gr) {
    if (settingsCache) return settingsCache;
    try { settingsCache = JSON.parse(await fs.promises.readFile(settingsPath(gr), 'utf8')); } catch (_) { settingsCache = {}; }
    if (!settingsCache.folders || typeof settingsCache.folders !== 'object') settingsCache.folders = {};
    return settingsCache;
}
async function saveSettings(gr) {
    await fs.promises.mkdir(baseDir(gr), { recursive: true });
    const tmp = `${settingsPath(gr)}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(settingsCache));
    await fs.promises.rename(tmp, settingsPath(gr));
}

/** The built-in rule for a display path: /Workspaces/<ws>/Camera Roll[/...] is write-back, not kept offline. */
function ruleFor(display) {
    const parts = String(display || '').split('/').filter(Boolean);
    if (parts[0] !== 'Workspaces' || parts.length < 3) return null;
    for (const r of RULES) if (parts[2].toLowerCase() === r.name.toLowerCase()) return { caching: r.caching, writeBack: r.writeBack, rule: r.name };
    return null;
}

// ---------------------------------------------------------------- the VFS side

function vfsOf(gr) { return gr.getVfsManager(); }

/** Display path (names) -> { canonical, location }, making the missing folders when mkdirs. */
async function resolveFolder(gr, display, mkdirs) {
    const vfs = vfsOf(gr);
    try {
        const canonical = await vfs.resolvePathInput(display);
        return { canonical, location: vfs.resolveLocationFromPath(canonical) };
    } catch (error) {
        if (!mkdirs) throw Object.assign(new Error(`The folder ${display} is not on the server.`), { code: 'NO_FOLDER' });
        const parts = display.split('/').filter(Boolean);
        if (parts.length <= 2) throw error;
        const name = parts.pop();
        const parent = await resolveFolder(gr, `/${parts.join('/')}`, true);
        await vfs.createFolderAtPath(parent.canonical, name);
        const canonical = await vfs.resolvePathInput(display);
        return { canonical, location: vfs.resolveLocationFromPath(canonical) };
    }
}

async function filesIn(location) {
    const vfsDb = require('./vfsDatabase');
    return vfsDb.getUserFilesByLocation(location.scope, location.workspaceId, location.folderId);
}
async function sameName(location, name) {
    const needle = name.toLowerCase();
    const all = await filesIn(location);
    return all.find((f) => f.original_name === name) || all.find((f) => String(f.original_name || '').toLowerCase() === needle) || null;
}
const fileOut = (f) => ({ id: f.id, name: f.original_name, md5: f.content_hash, size: f.size, mime: f.mime_type, updated: (f.updated_at || f.created_at || 0) * 1000 });

function broadcast(gr, canonical) {
    try {
        const ws = typeof gr.getWebSocketServer === 'function' ? gr.getWebSocketServer() : null;
        if (ws && ws.broadcast) ws.broadcast({ type: 'vfs_updated', data: { path: canonical }, timestamp: new Date().toISOString() });
    } catch (_) { /* no socket server */ }
    try { require('./vfsFuseHttp').invalidateFuseLookupCache(); } catch (_) { /* optional */ }
}

/** "<name> (<computer> v<n>).<ext>": Vista's name for the client's copy kept beside the server's (cscui string 47). */
async function bothName(location, name, computer) {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    const taken = new Set((await filesIn(location)).map((f) => String(f.original_name || '').toLowerCase()));
    for (let v = 1; v < 1000; v += 1) {
        const n = `${stem} (${computer} v${v})${ext}`;
        if (!taken.has(n.toLowerCase())) return n;
    }
    return `${stem} (${computer} v${Date.now()})${ext}`;
}

/**
 * A workspace folder's canonical path (/Workspaces/<ws>/<folder id>/...) by names (/Workspaces/<ws>/Camera Roll/...):
 * the key CaféReady's cache uses, so a client finds its offline copies with no server. null outside workspace folders.
 */
async function namePathOf(gr, canonical) {
    const parts = String(canonical || '').split('/').filter(Boolean);
    if (parts[0] !== 'Workspaces' || parts.length < 2) return null;
    const vfsDb = require('./vfsDatabase');
    const out = parts.slice(0, 2);
    for (const seg of parts.slice(2)) {
        // reserved folders (Desktop, Pictures, ...) are names already; user folders are ids
        if (/^[A-Z][A-Za-z ]*$/.test(seg) && ['Desktop', 'Pictures', 'References', 'Notes', 'Scraps', 'Trash'].includes(seg)) { out.push(seg); continue; }
        let f = null;
        try { f = await vfsDb.getFolderById(seg); } catch (_) { f = null; }
        if (!f || !f.name) return null;
        out.push(f.name);
    }
    return `/${out.join('/')}`;
}

// ---------------------------------------------------------------- routes

function mount(app, authMiddleware, globalResources) {
    const gr = globalResources;
    const auth = authMiddleware || ((req, res, next) => next());
    const allowed = (req) => req.userType === 'admin';
    sweep(gr).catch(() => {});
    const sweeper = setInterval(() => { sweep(gr).catch(() => {}); }, 6 * 3600 * 1000);
    if (sweeper.unref) sweeper.unref();

    app.get('/api/offline-files/settings', auth, async (req, res) => {
        if (!allowed(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const s = await loadSettings(gr);
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, folders: s.folders, rules: RULES });
    });

    app.post('/api/offline-files/settings', auth, async (req, res) => {
        if (!allowed(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const p = cleanPath(b.path);
        if (!p) { refuse(res, 400, 'BAD_PATH', 'path is required'); return; }
        const s = await loadSettings(gr);
        if (b.reset === true) delete s.folders[p];
        else {
            if (!CACHING.includes(b.caching)) { refuse(res, 400, 'BAD_CACHING', 'caching: manual | auto | none'); return; }
            s.folders[p] = { caching: b.caching, writeBack: b.writeBack === true, optimized: b.caching === 'auto' && b.optimized === true };
        }
        await saveSettings(gr);
        res.json({ success: true, path: p, setting: s.folders[p] || ruleFor(p) || { caching: 'manual', writeBack: false } });
    });

    app.get('/api/offline-files/folder', auth, async (req, res) => {
        if (!allowed(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const display = cleanPath(req.query.path);
        if (!display) { refuse(res, 400, 'BAD_PATH', 'path is required'); return; }
        try {
            const { canonical, location } = await resolveFolder(gr, display, false);
            const vfsDb = require('./vfsDatabase');
            const folders = location.scope === 'workspace'
                ? await vfsDb.getFoldersByParent('workspace', location.workspaceId, location.folderId)
                : await vfsDb.getFoldersByParent('root', null, location.folderId);
            res.set('Cache-Control', 'no-store');
            res.json({
                success: true, path: canonical, display,
                files: (await filesIn(location)).map(fileOut),
                folders: folders.filter((f) => !f.trashed_at && !/^\./.test(f.name || '')).map((f) => ({ id: f.id, name: f.name }))
            });
        } catch (error) {
            refuse(res, error.code === 'NO_FOLDER' ? 404 : 400, error.code || 'ERROR', error.message);
        }
    });

    app.post('/api/offline-files/upload/begin', auth, async (req, res) => {
        if (!allowed(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const b = req.body && typeof req.body === 'object' ? req.body : {};
        const folder = cleanPath(b.folder);
        const name = cleanName(b.name);
        const size = Number(b.size);
        const md5 = String(b.md5 || '').toLowerCase();
        if (!folder || !name) { refuse(res, 400, 'BAD_FILE', 'folder and name are required'); return; }
        if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_BYTES) { refuse(res, 400, 'BAD_SIZE', 'size is not valid'); return; }
        if (!/^[0-9a-f]{32}$/.test(md5)) { refuse(res, 400, 'BAD_HASH', 'md5 is required'); return; }
        // the same upload asked for again (the client restarted): where it stands
        if (isId(b.id)) {
            const known = await loadMeta(gr, b.id);
            if (known && !known.committed && known.md5 === md5 && known.size === size) {
                res.json({ success: true, id: known.id, received: known.received, chunkSize: CHUNK_BYTES });
                return;
            }
            if (known) await removeUpload(gr, known.id);
        }
        const id = isId(b.id) ? b.id : crypto.randomBytes(16).toString('hex');
        const meta = {
            id, folder, name, size, md5, received: 0, created: Date.now(), committed: false,
            base: /^[0-9a-f]{32}$/.test(String(b.base || '')) ? String(b.base) : null,
            mime: String(b.mime || 'application/octet-stream').slice(0, 128),
            computer: cleanName(b.computer).slice(0, 64) || 'Offline'
        };
        metas.set(id, meta);
        try {
            await fs.promises.mkdir(baseDir(gr), { recursive: true });
            await fs.promises.writeFile(dataPath(gr, id), Buffer.alloc(0));
            await persistMeta(gr, meta);
        } catch (error) {
            await removeUpload(gr, id);
            refuse(res, 500, 'IO', error.message);
            return;
        }
        res.json({ success: true, id, received: 0, chunkSize: CHUNK_BYTES });
    });

    app.post('/api/offline-files/upload/:id/chunk', auth, async (req, res) => {
        if (!allowed(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const meta = await loadMeta(gr, req.params.id);
        if (!meta || meta.committed) { refuse(res, 404, 'NOT_FOUND', 'No such upload'); return; }
        const offset = Number(req.query.offset);
        if (offset !== meta.received || writing.has(meta.id)) { res.status(409).json({ success: false, code: 'OFFSET', received: meta.received }); return; }
        writing.add(meta.id);
        try {
            const body = await readBody(req, MAX_CHUNK_BYTES);
            if (metas.get(meta.id) !== meta) { refuse(res, 404, 'NOT_FOUND', 'No such upload'); return; }
            if (meta.received + body.length > meta.size) { refuse(res, 400, 'TOO_MUCH', 'More bytes than the file has'); return; }
            try {
                await fs.promises.appendFile(dataPath(gr, meta.id), body);
                meta.received += body.length;
            } catch (error) {
                try { await fs.promises.truncate(dataPath(gr, meta.id), meta.received); } catch (_) { /* measured on load */ }
                refuse(res, 500, 'IO', error.message);
                return;
            }
            persistMeta(gr, meta).catch(() => {});
            res.json({ success: true, received: meta.received });
        } catch (error) {
            refuse(res, 413, error.code || 'ERROR', error.message);
        } finally {
            writing.delete(meta.id);
        }
    });

    app.post('/api/offline-files/upload/:id/commit', auth, async (req, res) => {
        if (!allowed(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const meta = await loadMeta(gr, req.params.id);
        if (!meta || meta.committed) { refuse(res, 404, 'NOT_FOUND', 'No such upload'); return; }
        if (meta.received !== meta.size || writing.has(meta.id)) { res.status(409).json({ success: false, code: 'INCOMPLETE', received: meta.received }); return; }
        const keep = req.body && ['local', 'both'].includes(req.body.keep) ? req.body.keep : null;
        const file = dataPath(gr, meta.id);
        let hash;
        try { hash = await md5File(file); } catch (error) { refuse(res, 500, 'IO', error.message); return; }
        if (hash !== meta.md5) {
            // the bytes are not the client's file: start again
            await removeUpload(gr, meta.id);
            refuse(res, 422, 'HASH', 'The file did not arrive intact.', { md5: hash });
            return;
        }
        try {
            const { canonical, location } = await resolveFolder(gr, meta.folder, true);
            const existing = await sameName(location, meta.name);
            let name = meta.name;
            let overwrite = false;
            if (existing && existing.content_hash !== meta.md5) {
                if (existing.content_hash !== meta.base && !keep) {
                    res.status(409).json({ success: false, code: 'CONFLICT', error: meta.base ? 'A file was changed on this computer and the server while this computer was offline.' : 'A file created on this computer while offline has the same name as an existing file on the server.', server: fileOut(existing), kind: meta.base ? 'both-changed' : 'created-exists' });
                    return;
                }
                if (keep === 'both') name = await bothName(location, meta.name, meta.computer);
                else overwrite = true;
            } else if (existing) {
                // the server already has these bytes under this name
                meta.committed = true;
                await removeUpload(gr, meta.id);
                res.json({ success: true, file: fileOut(existing), path: canonical, same: true });
                return;
            }
            meta.committed = true;
            const stored = await vfsOf(gr).saveUserFileFromPath(file, {
                originalName: name, mimeType: meta.mime, scope: location.scope, workspaceId: location.workspaceId, folderId: location.folderId, overwrite
            });
            await removeUpload(gr, meta.id);
            try {
                await require('./replicationJournal').recordVfsFile(stored.content_hash, { operation: 'INSERT', payload: { fileId: stored.id, originalName: stored.original_name, scope: location.scope, workspaceId: location.workspaceId } });
            } catch (_) { /* no replication */ }
            broadcast(gr, canonical);
            res.json({ success: true, file: fileOut(stored), path: canonical, renamed: name !== meta.name ? name : undefined });
        } catch (error) {
            meta.committed = false;
            refuse(res, error.code === 'NO_FOLDER' ? 404 : 500, error.code || 'ERROR', error.message);
        }
    });

    app.delete('/api/offline-files/upload/:id', auth, async (req, res) => {
        if (!allowed(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        if (isId(req.params.id)) await removeUpload(gr, req.params.id);
        res.json({ success: true });
    });

    app.get('/api/offline-files/file/:id', auth, async (req, res) => {
        if (!allowed(req)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const vfsDb = require('./vfsDatabase');
        const f = await vfsDb.getUserFileById(String(req.params.id || ''));
        if (!f || f.trashed_at) { refuse(res, 404, 'NOT_FOUND', 'No such file'); return; }
        res.set('ETag', `"${f.content_hash}"`);
        res.set('X-Content-MD5', f.content_hash);
        res.set('Cache-Control', 'no-store');
        res.type(f.mime_type || 'application/octet-stream');
        res.sendFile(vfsOf(gr).getFileBlobPath(f.content_hash), { acceptRanges: true, cacheControl: false, etag: false, lastModified: false });
    });
}

module.exports = { mount, namePathOf, _test: { ruleFor, cleanName, cleanPath, bothName, RULES } };
