/**
 * Phone pictures the desktop shows again (Yozora #1012, no-base64-images): the app icons the phone relays with its
 * notifications (notify.posted / notify.seen / notify.list "icon") and Programs' apps.icon. The phone sends them as
 * small PNG / JPEG data URLs (transport); the server keeps each picture once as a content-hashed file and the
 * desktop page loads it by URL, so no page holds the pixels as text.
 *
 *   GET /api/activesync/icons/<sha1 hex>.<png|jpg|webp>   an admin desktop; the file never changes (immutable)
 *
 * Files live in <databases>/activesync-icons/. Each file has owners (a device's notification app icons "n:<id>:<pkg>",
 * Programs' icons "a:<id>:<pkg>:<size>"); an owner that sends another picture lets go of the old one, and a device
 * that disconnects or is forgotten lets go of all of its owners; a file without owners is deleted. The count is
 * capped (the oldest unowned go first), and the files an earlier run left are swept once per run after a week.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MAX_ICON_BYTES = 128 * 1024;
const MAX_FILES = 400;
const STALE_MS = 7 * 24 * 3600 * 1000;
const DATA_URL = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\s]+)$/;
const EXT = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const TYPE = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const URL_PREFIX = '/api/activesync/icons/';
const NAME = /^[0-9a-f]{40}\.(png|jpg|webp)$/;

const owned = new Map();   // owner -> file name
const holders = new Map(); // file name -> count of owners
let swept = false;

function dirOf(globalResources) {
    const root = globalResources && typeof globalResources.getPath === 'function'
        ? globalResources.getPath('databases')
        : path.resolve(__dirname, '..', '.cache');
    return path.join(root, 'activesync-icons');
}

function drop(globalResources, name) {
    const left = (holders.get(name) || 1) - 1;
    if (left > 0) { holders.set(name, left); return; }
    holders.delete(name);
    try { fs.unlinkSync(path.join(dirOf(globalResources), name)); } catch (_) { /* gone */ }
}

/** Old files a previous run left (nothing owns them now) and, past the cap, the oldest unowned ones. */
function sweep(globalResources) {
    const dir = dirOf(globalResources);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => NAME.test(n)); } catch (_) { return; }
    const now = Date.now();
    const aged = [];
    for (const n of names) {
        let st;
        try { st = fs.statSync(path.join(dir, n)); } catch (_) { continue; }
        if (holders.has(n)) continue;
        if (!swept && now - st.mtimeMs > STALE_MS) { try { fs.unlinkSync(path.join(dir, n)); } catch (_) { /* gone */ } continue; }
        aged.push({ n, at: st.mtimeMs });
    }
    swept = true;
    const over = names.length - MAX_FILES;
    if (over > 0) {
        aged.sort((a, b) => a.at - b.at);
        for (const e of aged.slice(0, over)) { try { fs.unlinkSync(path.join(dir, e.n)); } catch (_) { /* gone */ } }
    }
}

let sinceSweep = 0;

/**
 * Keep a data URL as a file for [owner]; returns its URL, or null when it is not a small PNG / JPEG / WebP (the caller
 * then leaves the value as it came). An owner's earlier picture is let go.
 */
function keep(globalResources, owner, dataUrl) {
    const m = typeof dataUrl === 'string' && dataUrl.length < MAX_ICON_BYTES * 1.4 ? DATA_URL.exec(dataUrl) : null;
    if (!m) return null;
    const buf = Buffer.from(m[2], 'base64');
    if (!buf.length || buf.length > MAX_ICON_BYTES) return null;
    const name = `${crypto.createHash('sha1').update(buf).digest('hex')}.${EXT[m[1]]}`;
    const dir = dirOf(globalResources);
    const file = path.join(dir, name);
    const was = owned.get(owner);
    if (was === name) return URL_PREFIX + name;
    try {
        if (!fs.existsSync(file)) {
            fs.mkdirSync(dir, { recursive: true });
            const tmp = `${file}.${process.pid}.tmp`;
            fs.writeFileSync(tmp, buf);
            fs.renameSync(tmp, file);
        }
    } catch (err) {
        console.warn('[activeSync icons] could not store a picture:', err.message);
        return null;
    }
    holders.set(name, (holders.get(name) || 0) + 1);
    owned.set(owner, name);
    if (was) drop(globalResources, was);
    if (++sinceSweep >= 50 || !swept) { sinceSweep = 0; sweep(globalResources); }
    return URL_PREFIX + name;
}

/** The owner's picture is gone. */
function release(globalResources, owner) {
    const name = owned.get(owner);
    if (!name) return;
    owned.delete(owner);
    drop(globalResources, name);
}

/** A device disconnected or was forgotten: all of its owners. */
function releaseDevice(globalResources, deviceId) {
    for (const owner of [...owned.keys()]) {
        const parts = owner.split(':');
        if (parts[1] === deviceId) release(globalResources, owner);
    }
}

/**
 * A device's event or answer with its pictures as URLs: returns a copy ([detail] itself is never changed, other
 * modules hold it). Only notify.* events' "icon" and a notify.list answer's notifications[].icon are touched.
 */
function relayEvent(globalResources, deviceId, name, detail) {
    if (!detail || typeof detail !== 'object' || !/^notify\./.test(name) || typeof detail.icon !== 'string') return detail;
    const url = keep(globalResources, `n:${deviceId}:${String(detail.package || '')}`, detail.icon);
    return url ? Object.assign({}, detail, { icon: url }) : detail;
}

function relayResult(globalResources, deviceId, op, args, result) {
    if (!result || typeof result !== 'object') return result;
    if (op === 'apps.icon' && typeof result.icon === 'string') {
        const url = keep(globalResources, `a:${deviceId}:${String(args && args.package || '')}:${Number(args && args.size) || 32}`, result.icon);
        return url ? Object.assign({}, result, { icon: url }) : result;
    }
    if (op === 'notify.list' && Array.isArray(result.notifications)) {
        const list = result.notifications.map((n) => {
            if (!n || typeof n !== 'object' || typeof n.icon !== 'string') return n;
            const url = keep(globalResources, `n:${deviceId}:${String(n.package || '')}`, n.icon);
            return url ? Object.assign({}, n, { icon: url }) : n;
        });
        return Object.assign({}, result, { notifications: list });
    }
    return result;
}

function mount(app, authMiddleware, globalResources) {
    const auth = authMiddleware || ((req, res, next) => next());
    app.get(`${URL_PREFIX}:name`, auth, (req, res) => {
        const name = String(req.params.name || '');
        if (req.userType !== 'admin') { res.status(403).json({ success: false, code: 'INSUFFICIENT_PERMISSIONS', error: 'Admin access required' }); return; }
        if (!NAME.test(name)) { res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'No such picture.' }); return; }
        fs.readFile(path.join(dirOf(globalResources), name), (err, buf) => {
            if (err) { res.status(404).json({ success: false, code: 'NOT_FOUND', error: 'No such picture.' }); return; }
            // the name is the file's hash: it never changes
            res.set({ 'Content-Type': TYPE[path.extname(name).slice(1)] || 'application/octet-stream', 'Cache-Control': 'private, max-age=31536000, immutable' });
            res.end(buf);
        });
    });
}

module.exports = { mount, keep, release, releaseDevice, relayEvent, relayResult, URL_PREFIX };
