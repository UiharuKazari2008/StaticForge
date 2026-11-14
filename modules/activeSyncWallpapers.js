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
 *
 * Files live in <databases>/activesync-wallpapers/<deviceId>/ with an index.json. A partnership ended
 * or a device removed leaves them; the next push replaces them.
 */
'use strict';

const fs = require('fs');
const path = require('path');
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

/** Store what the phone sent; unchanged pictures keep their file and stamp. */
function store(globalResources, deviceId, body) {
    const src = body && typeof body === 'object' ? body : {};
    const dir = dirOf(globalResources, deviceId);
    fs.mkdirSync(dir, { recursive: true });
    const old = readIndex(globalResources, deviceId);
    const idx = { at: Date.now(), screen: src.screen === 'cover' || src.screen === 'inner' ? src.screen : (old.screen || null) };
    const keep = new Set(['index.json']);
    for (const k of KINDS) {
        // a kind not sent keeps what it had (the page and the service each send their own)
        if (!Object.prototype.hasOwnProperty.call(src, k)) {
            if (old[k]) { idx[k] = old[k]; if (old[k].file) keep.add(old[k].file); }
            continue;
        }
        const v = typeof src[k] === 'string' ? src[k].trim() : '';
        if (!v) continue;
        if (/^\/[^/\\]/.test(v) && v.length <= 1024) { idx[k] = { path: v, at: old[k] && old[k].path === v ? old[k].at : idx.at }; continue; }
        const m = DATA_URL.exec(v);
        if (!m) continue;
        const buf = Buffer.from(m[2].replace(/\s+/g, ''), 'base64');
        if (!buf.length || buf.length > MAX_PICTURE_BYTES) continue;
        const file = `${k}.${EXT[m[1]]}`;
        const target = path.join(dir, file);
        let same = false;
        try { same = old[k] && old[k].file === file && fs.readFileSync(target).equals(buf); } catch (_) { same = false; }
        if (!same) fs.writeFileSync(target, buf);
        idx[k] = { file, at: same ? old[k].at : idx.at };
        keep.add(file);
    }
    // pictures of a kind the phone no longer has go
    for (const f of fs.readdirSync(dir)) if (!keep.has(f)) { try { fs.unlinkSync(path.join(dir, f)); } catch (_) { /* gone */ } }
    fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(idx));
    stamps.set(deviceId, idx.at);
    return describe(globalResources, deviceId);
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
            const out = store(globalResources, id, req.body);
            try { activeSync.touchDevice(globalResources, ws(), id); } catch (_) { /* no broadcast */ }
            res.json({ success: true, wallpapers: out });
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

module.exports = { mount, describe, store, stampOf, KINDS };
