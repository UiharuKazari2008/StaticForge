/**
 * Melaton Media Player's library on the server (Yozora #956): every music and video file in the VFS, with its tags,
 * length and album art, as Windows Media Player 11's library knows them.
 *
 *   Source      the VFS's user files whose type is audio/* or video/* and that are not in the Trash
 *               (vfsDatabase.getMediaUserFiles). Files are keyed by their content hash: a tag read is done once per
 *               file content, whatever folder or name it has.
 *   Tags        ffprobe (format tags + the first audio/video stream): title, artist, album artist, album, genre,
 *               year, track, disc, composer, length; video: width, height. Album art: the file's attached picture,
 *               a video's frame at 10 %, both scaled to 300 px JPEG in .cache/media-library/art/<hash>.jpg.
 *   Index       .cache/media-library/index.json { v, files: { <hash>: tags } }, written after a scan.
 *   Freshness   no polling and no file watching (phone-power-server): a client asking for the library scans what is
 *               new first; a VFS change (vfsDatabase.onUserFilesChanged) marks the library stale and, when someone
 *               used it in the last hour, scans in the background 10 s later and tells the clients
 *               ('media_library_changed').
 *   Routes      GET <vfsPath>/media/file/:id   the file, with HTTP Range (seeking)
 *               GET <vfsPath>/media/art/:hash  its art (immutable)
 *   Packets     media_library_get {} -> { audio[], video[], scannedAt }   (modules/ws/handlers/310-mediaLibraryHandler.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const INDEX_VERSION = 1;
const HASH_RE = /^[a-f0-9]{16,64}$/i;
const SCAN_CONCURRENCY = 2;
const PROBE_TIMEOUT_MS = 20000;
const ACTIVE_WINDOW_MS = 60 * 60 * 1000;

let globalResources = null;
let index = null;          // { v, files: { hash: tags } }
let scanning = null;       // the running scan's promise
let stale = true;
let lastUsedAt = 0;
let changeTimer = null;
let scannedAt = 0;

function baseDir() {
    return path.join(globalResources.getPath('cache'), 'media-library');
}
function artPath(hash) {
    return path.join(baseDir(), 'art', `${hash}.jpg`);
}

function loadIndex() {
    if (index) return index;
    try {
        const raw = JSON.parse(fs.readFileSync(path.join(baseDir(), 'index.json'), 'utf8'));
        index = raw && raw.v === INDEX_VERSION && raw.files && typeof raw.files === 'object' ? raw : { v: INDEX_VERSION, files: {} };
    } catch (_) {
        index = { v: INDEX_VERSION, files: {} };
    }
    return index;
}

async function saveIndex() {
    await fs.promises.mkdir(baseDir(), { recursive: true });
    const tmp = path.join(baseDir(), 'index.json.tmp');
    await fs.promises.writeFile(tmp, JSON.stringify(index));
    await fs.promises.rename(tmp, path.join(baseDir(), 'index.json'));
}

function run(cmd, args) {
    return new Promise((resolve) => {
        execFile(cmd, args, { timeout: PROBE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? null : String(stdout || '')));
    });
}

const tagOf = (tags, ...names) => {
    for (const n of names) {
        for (const k of Object.keys(tags)) if (k.toLowerCase() === n) { const v = String(tags[k] || '').trim(); if (v) return v; }
    }
    return '';
};
const numOf = (v) => { const n = parseInt(String(v || '').split('/')[0], 10); return Number.isFinite(n) ? n : 0; };

/** The file's tags and art (ffprobe / ffmpeg); a file the tools cannot read still gets its name and kind. */
async function probe(blob, kind, hash) {
    const out = { kind, title: '', artist: '', albumArtist: '', album: '', genre: '', year: 0, track: 0, disc: 0, composer: '', duration: 0, width: 0, height: 0, art: false };
    const json = await run('ffprobe', ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', blob]);
    let d = null;
    try { d = json ? JSON.parse(json) : null; } catch (_) { d = null; }
    if (d) {
        const fmt = d.format || {};
        const streams = Array.isArray(d.streams) ? d.streams : [];
        const tags = Object.assign({}, ...(streams.map((s) => s.tags || {})), fmt.tags || {});
        out.title = tagOf(tags, 'title');
        out.artist = tagOf(tags, 'artist', 'performer');
        out.albumArtist = tagOf(tags, 'album_artist', 'albumartist', 'album artist');
        out.album = tagOf(tags, 'album');
        out.genre = tagOf(tags, 'genre');
        out.year = numOf(tagOf(tags, 'date', 'year', 'originaldate'));
        out.track = numOf(tagOf(tags, 'track', 'tracknumber'));
        out.disc = numOf(tagOf(tags, 'disc', 'discnumber'));
        out.composer = tagOf(tags, 'composer');
        out.duration = Math.round((Number(fmt.duration) || 0) * 10) / 10;
        const video = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
        if (video) { out.width = video.width || 0; out.height = video.height || 0; }
        const pic = streams.find((s) => s.disposition && s.disposition.attached_pic);
        const dest = artPath(hash);
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        if (pic) {
            out.art = (await run('ffmpeg', ['-v', 'quiet', '-y', '-i', blob, '-map', `0:${pic.index}`, '-frames:v', '1', '-vf', 'scale=300:-2', dest])) !== null && fs.existsSync(dest);
        } else if (kind === 'video' && out.duration > 0) {
            out.art = (await run('ffmpeg', ['-v', 'quiet', '-y', '-ss', String(Math.max(0, out.duration * 0.1)), '-i', blob, '-frames:v', '1', '-vf', 'scale=300:-2', dest])) !== null && fs.existsSync(dest);
        }
    }
    return out;
}

/** Tags every file not in the index yet; files whose content left the VFS leave the index. */
function scan() {
    if (scanning) return scanning;
    scanning = (async () => {
        loadIndex();
        const db = require('./vfsDatabase');
        const rows = await db.getMediaUserFiles();
        const vfs = globalResources.getVfsManager();
        const seen = new Set();
        const todo = [];
        for (const r of rows) {
            if (!HASH_RE.test(r.content_hash || '')) continue;
            seen.add(r.content_hash);
            if (!index.files[r.content_hash]) todo.push(r);
        }
        let changed = false;
        for (const h of Object.keys(index.files)) {
            if (!seen.has(h)) { delete index.files[h]; changed = true; fs.promises.unlink(artPath(h)).catch(() => {}); }
        }
        let next = 0;
        const lane = async () => {
            while (next < todo.length) {
                const r = todo[next++];
                const blob = vfs.getFileBlobPath(r.content_hash);
                if (!blob || !fs.existsSync(blob)) continue;
                const kind = String(r.mime_type).startsWith('video/') ? 'video' : 'audio';
                index.files[r.content_hash] = await probe(blob, kind, r.content_hash);
                changed = true;
            }
        };
        await Promise.all(Array.from({ length: Math.min(SCAN_CONCURRENCY, todo.length) }, lane));
        if (changed) await saveIndex();
        stale = false;
        scannedAt = Date.now();
        return { rows, changed };
    })().finally(() => { scanning = null; });
    return scanning;
}

function titleFromName(name) {
    return String(name || '').replace(/\.[^.]+$/, '').replace(/_/g, ' ');
}

/** The library this session may see: { audio, video, scannedAt }. */
async function getLibrary(session) {
    lastUsedAt = Date.now();
    const db = require('./vfsDatabase');
    const workspaces = globalResources.getWorkspaceManager().getWorkspaces();
    const workspaceExists = (id) => !!workspaces[id];
    let rows;
    if (stale || !scannedAt) rows = (await scan()).rows;
    else rows = await db.getMediaUserFiles();
    const audio = [];
    const video = [];
    for (const r of rows) {
        if (!db.canSessionAccessVfsFile(session, r, { workspaceExists })) continue;
        const t = index.files[r.content_hash];
        if (!t) continue;
        const item = {
            id: r.id, hash: r.content_hash, name: r.original_name, mime: r.mime_type, size: r.size,
            added: (r.created_at || 0) * 1000, workspaceId: r.workspace_id || null,
            title: t.title || titleFromName(r.original_name), artist: t.artist, albumArtist: t.albumArtist, album: t.album,
            genre: t.genre, year: t.year, track: t.track, disc: t.disc, composer: t.composer, duration: t.duration,
            width: t.width, height: t.height, art: !!t.art
        };
        (t.kind === 'video' ? video : audio).push(item);
    }
    return { audio, video, scannedAt };
}

function onVfsChanged() {
    stale = true;
    if (!lastUsedAt || Date.now() - lastUsedAt > ACTIVE_WINDOW_MS) return;
    clearTimeout(changeTimer);
    changeTimer = setTimeout(async () => {
        try {
            const r = await scan();
            const ws = globalResources.getWebSocketServer && globalResources.getWebSocketServer();
            if (ws && typeof ws.broadcast === 'function') ws.broadcast({ type: 'media_library_changed', data: { changed: !!(r && r.changed) }, timestamp: new Date().toISOString() });
        } catch (e) {
            console.warn('[mediaLibrary] scan after a change failed:', e && e.message);
        }
    }, 10000);
}

/** One file, with HTTP Range so a long song or a video can seek. */
function sendRange(req, res, file, size, mime) {
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', mime || 'application/octet-stream');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (m && (m[1] || m[2])) {
        let start = m[1] ? parseInt(m[1], 10) : size - parseInt(m[2], 10);
        let end = m[1] && m[2] ? parseInt(m[2], 10) : size - 1;
        if (!Number.isFinite(start) || start < 0) start = 0;
        if (!Number.isFinite(end) || end >= size) end = size - 1;
        if (start > end || start >= size) { res.status(416).setHeader('Content-Range', `bytes */${size}`); return res.end(); }
        res.status(206);
        res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
        res.setHeader('Content-Length', String(end - start + 1));
        return fs.createReadStream(file, { start, end }).pipe(res);
    }
    res.setHeader('Content-Length', String(size));
    return fs.createReadStream(file).pipe(res);
}

function registerMediaLibraryRoutes(app, { vfsPath, authMiddleware, globalResources: gr, buildVfsSession }) {
    init(gr);
    const sessionOf = (req) => (typeof buildVfsSession === 'function' ? buildVfsSession(req) : { userType: req.userType || (req.session && req.session.userType) || 'admin', applicationScopes: req.applicationAuth && req.applicationAuth.applicationScopes });
    app.get(`${vfsPath}/media/file/:id`, authMiddleware, async (req, res) => {
        try {
            const db = require('./vfsDatabase');
            const file = await db.getUserFileById(String(req.params.id || ''));
            if (!file || file.trashed_at) return res.status(404).end();
            const workspaces = globalResources.getWorkspaceManager().getWorkspaces();
            if (!db.canSessionAccessVfsFile(sessionOf(req), file, { workspaceExists: (id) => !!workspaces[id] })) return res.status(403).end();
            if (!HASH_RE.test(file.content_hash || '')) return res.status(404).end();
            const blob = globalResources.getVfsManager().getFileBlobPath(file.content_hash);
            const st = await fs.promises.stat(blob).catch(() => null);
            if (!st) return res.status(404).end();
            return sendRange(req, res, blob, st.size, file.mime_type);
        } catch (e) {
            if (!res.headersSent) res.status(500).end(); else res.end();
        }
    });
    app.get(`${vfsPath}/media/art/:hash`, authMiddleware, async (req, res) => {
        const hash = String(req.params.hash || '');
        if (!HASH_RE.test(hash)) return res.status(404).end();
        const p = artPath(hash);
        const st = await fs.promises.stat(p).catch(() => null);
        if (!st) return res.status(404).end();
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
        res.setHeader('Content-Length', String(st.size));
        fs.createReadStream(p).pipe(res);
    });
}

let initDone = false;
function init(gr) {
    if (gr) globalResources = gr;
    if (initDone || !globalResources) return;
    initDone = true;
    try { require('./vfsDatabase').onUserFilesChanged(onVfsChanged); } catch (_) { /* no VFS */ }
}

module.exports = { init, getLibrary, scan, registerMediaLibraryRoutes, _test: { probe, sendRange } };
