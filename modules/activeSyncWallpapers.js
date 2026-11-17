/**
 * The phones' wallpapers, kept on the server (Yozora #827): Device Center draws a phone with its own
 * wallpapers in it, so they are here before Device Center opens and while the phone is away.
 *
 *   POST /api/activesync/wallpapers/:deviceId          the phone (its page or the app's service, in its
 *        { inner, cover, external, innerLock, ... }     session), when a wallpaper changes and once per
 *                                                       connection; only the kinds sent change (null clears one);
 *        each a same-site path or a JPEG / PNG / WebP data URL (at most 720 px, see activeSyncScreen.js)
 *   GET  /api/activesync/wallpapers/:deviceId          an admin desktop (or the phone): { inner, cover,
 *                                                       external, screen, at } as URLs, null when none
 *   GET  /api/activesync/wallpapers/:deviceId/:kind     the stored picture (inner | cover | external)
 *   GET  /api/activesync/wallpapers/:deviceId/hashes    the phone (#890): { hashes: { <kind>: sha1 hex of
 *                                                       the stored file's bytes, or "path:<path>" for a kind
 *                                                       stored as a same-site path } }
 *
 * Re-uploads (#890): the phone sends only the kinds whose picture differs from what is stored (it
 * compares sha1 of the decoded bytes with /hashes, once per connection), and "same:<kind>" for a kind
 * whose picture is another kind's (from the same request, or the one stored). A picture whose bytes
 * are unchanged is not written again, an unchanged set does not rewrite index.json (nor move its stamp,
 * so Device Center is not told of a change), and the reply lists the kinds sent that were unchanged
 * (unchanged: [...]).
 *
 * Files live in <databases>/activesync-wallpapers/<deviceId>/ with an index.json. A partnership ended
 * or a device removed leaves them; the next push replaces them.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const activeSync = require('./activeSync');

// Melaton's home pictures (the page: Today on each screen, the DeX window's desktop), the lock screens and
// Android's own home wallpapers (the app's service, #827: Samsung keeps one per screen)
const KINDS = ['inner', 'cover', 'external', 'innerLock', 'coverLock', 'externalLock', 'androidInner', 'androidCover', 'androidExternal'];
const MAX_PICTURE_BYTES = 2 * 1024 * 1024;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/;
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

function baseDir(globalResources) {
    const root = globalResources && typeof globalResources.getPath === 'function'
        ? globalResources.getPath('databases')
        : path.resolve(__dirname, '..', '.cache');
    return path.join(root, 'activesync-wallpapers');
}

function dirOf(globalResources, deviceId) {
    return path.join(baseDir(globalResources), deviceId);
}

const stamps = new Map(); // deviceId -> index.json's at (describeDevice asks on every broadcast)

function readIndex(globalResources, deviceId) {
    let idx = {};
    try { idx = JSON.parse(fs.readFileSync(path.join(dirOf(globalResources, deviceId), 'index.json'), 'utf8')) || {}; } catch (_) { idx = {}; }
    stamps.set(deviceId, idx.at || 0);
    return idx;
}

/** When the stored set last changed (0: none), for the device's description. */
function stampOf(globalResources, deviceId) {
    if (!stamps.has(deviceId)) readIndex(globalResources, deviceId);
    return stamps.get(deviceId) || 0;
}

/** The stored set as URLs for a page: { inner, cover, external, screen, at }. */
function describe(globalResources, deviceId) {
    const idx = readIndex(globalResources, deviceId);
    const out = { inner: null, cover: null, external: null, screen: idx.screen || null, at: idx.at || 0 };
    for (const k of KINDS) {
        const e = idx[k];
        if (!e) continue;
        if (e.path) out[k] = e.path;
        else if (e.file) out[k] = `/api/activesync/wallpapers/${deviceId}/${k}?v=${e.at || idx.at || 0}`;
    }
    return out;
}

// sha1 of the stored files, kept while a file's mtime and size stay the same (/hashes is asked once
// per phone connection; a picture is hashed once, not on every ask)
const hashCache = new Map(); // absolute file path -> { mtimeMs, size, sha1 }

function sha1Of(buf) {
    return crypto.createHash('sha1').update(buf).digest('hex');
}

function rememberHash(file, sha1) {
    try {
        const st = fs.statSync(file);
        hashCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, sha1 });
    } catch (_) { hashCache.delete(file); }
}

function fileSha1(file) {
    let st;
    try { st = fs.statSync(file); } catch (_) { hashCache.delete(file); return null; }
    const hit = hashCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.sha1;
    let buf;
    try { buf = fs.readFileSync(file); } catch (_) { return null; }
    const sha1 = sha1Of(buf);
    hashCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, sha1 });
    return sha1;
}

/**
 * { <kind>: sha1 hex of the stored picture's bytes, or "path:<path>" for a kind stored as a path }: every
 * kind the server holds, so a page whose kinds are all paths still sees a server that lost its set
 * (the page compares its own "path:<path>" digests, activeSyncScreen.js pictureHash).
 */
function hashes(globalResources, deviceId) {
    const idx = readIndex(globalResources, deviceId);
    const dir = dirOf(globalResources, deviceId);
    const out = {};
    for (const k of KINDS) {
        const e = idx[k];
        if (!e) continue;
        if (e.path) { out[k] = `path:${e.path}`; continue; }
        if (!e.file) continue;
        const h = fileSha1(path.join(dir, e.file));
        if (h) out[k] = h;
    }
    return out;
}

const SAME = /^same:([A-Za-z]+)$/;

/**
 * Store what the phone sent; unchanged pictures keep their file and stamp.
 * Returns { wallpapers (describe), changed (the stored set changed), unchanged (kinds sent that were) }.
 */
function storeDetailed(globalResources, deviceId, body) {
    const src = body && typeof body === 'object' ? body : {};
    const dir = dirOf(globalResources, deviceId);
    const old = readIndex(globalResources, deviceId);
    const now = Date.now();
    const idx = { at: now, screen: src.screen === 'cover' || src.screen === 'inner' ? src.screen : (old.screen || null) };
    const keep = new Set(['index.json']);
    const unchanged = [];
    const has = (k) => Object.prototype.hasOwnProperty.call(src, k);

    // what a value stands for: { path } | { buf, ext } | null (cleared, or not a picture we take)
    const parse = (raw) => {
        const v = typeof raw === 'string' ? raw.trim() : '';
        if (!v) return null;
        if (/^\/[^/\\]/.test(v) && v.length <= 1024) return { path: v };
        const m = DATA_URL.exec(v);
        if (!m) return null;
        const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
        if (!buf.length || buf.length > MAX_PICTURE_BYTES) return null;
        return { buf, ext: EXT[m[1]] };
    };
    // a kind's picture for "same:<kind>": the one sent now, else the one stored (chains followed once each)
    const resolved = new Map();
    const sourceOf = (k, seen) => {
        if (!KINDS.includes(k) || seen.has(k)) return null;
        if (resolved.has(k)) return resolved.get(k);
        seen.add(k);
        let out = null;
        if (has(k)) {
            const v = typeof src[k] === 'string' ? src[k].trim() : '';
            const same = SAME.exec(v);
            out = same ? sourceOf(same[1], seen) : parse(v);
        } else if (old[k] && old[k].path) {
            out = { path: old[k].path };
        } else if (old[k] && old[k].file) {
            try {
                const buf = fs.readFileSync(path.join(dir, old[k].file));
                const ext = path.extname(old[k].file).slice(1);
                if (buf.length && TYPE[ext]) out = { buf, ext };
            } catch (_) { out = null; }
        }
        resolved.set(k, out);
        return out;
    };

    for (const k of KINDS) {
        // a kind not sent keeps what it had (the page and the service each send their own)
        if (!has(k)) {
            if (old[k]) { idx[k] = old[k]; if (old[k].file) keep.add(old[k].file); }
            continue;
        }
        const pic = sourceOf(k, new Set());
        if (!pic) continue; // null clears it (so does anything that is not a picture we take)
        if (pic.path) {
            const same = !!(old[k] && old[k].path === pic.path);
            idx[k] = { path: pic.path, at: same ? old[k].at : now };
            if (same) unchanged.push(k);
            continue;
        }
        const file = `${k}.${pic.ext}`;
        const target = path.join(dir, file);
        const sha1 = sha1Of(pic.buf);
        const same = !!(old[k] && old[k].file === file && fileSha1(target) === sha1);
        if (same) {
            unchanged.push(k);
        } else {
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(target, pic.buf);
            rememberHash(target, sha1);
        }
        idx[k] = { file, at: same ? old[k].at : now };
        keep.add(file);
    }

    const entryKey = (e) => (e ? `${e.file || ''}|${e.path || ''}|${e.at || 0}` : '');
    const changed = idx.screen !== (old.screen || null) || KINDS.some((k) => entryKey(idx[k]) !== entryKey(old[k]));
    // pictures of a kind the phone no longer has go
    try {
        for (const f of fs.readdirSync(dir)) {
            if (keep.has(f)) continue;
            try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* gone */ }
            hashCache.delete(path.join(dir, f));
        }
    } catch (_) { /* no folder yet: nothing was ever stored */ }
    if (changed) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx));
        stamps.set(deviceId, idx.at);
    }
    return { wallpapers: describe(globalResources, deviceId), changed, unchanged };
}

/** Store what the phone sent (storeDetailed); returns the stored set as URLs. */
function store(globalResources, deviceId, body) {
    return storeDetailed(globalResources, deviceId, body).wallpapers;
}

function mount(app, authMiddleware, globalResources) {
    const auth = authMiddleware || ((req, res, next) => next());
    const ws = () => { try { return typeof globalResources.getWebSocketServer === 'function' ? globalResources.getWebSocketServer() : null; } catch (_) { return null; } };
    const refuse = (res, status, code, error) => { if (!res.headersSent) res.status(status).json({ success: false, code, error }); };
    const idOf = (req, res) => {
        const id = String(req.params.deviceId || '').toLowerCase();
        if (!activeSync.isPeerId(id)) { refuse(res, 400, 'BAD_REQUEST', 'Bad device id.'); return null; }
        return id;
    };
    const isPhone = (req, id) => activeSync.isDeviceSession(globalResources, ws(), id, req.sessionId || (req.session && req.session.id));
    const mayRead = (req, id) => req.userType === 'admin' || isPhone(req, id);

    app.post('/api/activesync/wallpapers/:deviceId', auth, (req, res) => {
        const id = idOf(req, res);
        if (!id) return;
        if (!isPhone(req, id)) { refuse(res, 403, 'NOT_DEVICE', 'Only the device itself sends its wallpapers.'); return; }
        try {
            const out = storeDetailed(globalResources, id, req.body);
            // Device Center hears of new pictures only (an unchanged set is no news)
            if (out.changed) { try { activeSync.touchDevice(globalResources, ws(), id); } catch (_) { /* no broadcast */ } }
            res.json({ success: true, wallpapers: out.wallpapers, unchanged: out.unchanged });
        } catch (err) {
            refuse(res, 500, 'ERROR', err.message);
        }
    });

    // before /:kind ('hashes' is no kind): what is stored, so the phone sends only what differs (#890)
    app.get('/api/activesync/wallpapers/:deviceId/hashes', auth, (req, res) => {
        const id = idOf(req, res);
        if (!id) return;
        if (!mayRead(req, id)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        res.set('Cache-Control', 'no-store');
        try {
            res.json({ success: true, hashes: hashes(globalResources, id) });
        } catch (err) {
            refuse(res, 500, 'ERROR', err.message);
        }
    });

    app.get('/api/activesync/wallpapers/:deviceId', auth, (req, res) => {
        const id = idOf(req, res);
        if (!id) return;
        if (!mayRead(req, id)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        res.set('Cache-Control', 'no-store');
        res.json({ success: true, wallpapers: describe(globalResources, id) });
    });

    app.get('/api/activesync/wallpapers/:deviceId/:kind', auth, (req, res) => {
        const id = idOf(req, res);
        if (!id) return;
        if (!mayRead(req, id)) { refuse(res, 403, 'INSUFFICIENT_PERMISSIONS', 'Admin access required'); return; }
        const kind = String(req.params.kind || '');
        const e = KINDS.includes(kind) ? readIndex(globalResources, id)[kind] : null;
        if (!e || !e.file) { refuse(res, 404, 'NOT_FOUND', 'No such wallpaper.'); return; }
        const ext = path.extname(e.file).slice(1);
        fs.readFile(path.join(dirOf(globalResources, id), e.file), (err, buf) => {
            if (err) { refuse(res, 404, 'NOT_FOUND', 'No such wallpaper.'); return; }
            // the URL carries the stamp: a new picture is a new URL
            res.set({ 'Content-Type': TYPE[ext] || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' });
            res.end(buf);
        });
    });
}

module.exports = { mount, describe, store, storeDetailed, hashes, stampOf, KINDS };
