'use strict';

/**
 * The service worker cache update broadcast as a delta (rule server-push-not-polling: only what
 * changed). Every notify used to send the whole manifest (9,410 rows, ~1.5 MB) to every client;
 * a phone got 3.1 MB in two minutes when another session published twice.
 *
 *   next(rows) -> { full: true, files, hash }                       the first broadcast after start
 *              -> { delta: true, files: changed, baseHash, hash }   rows new or with another hash
 *              -> { same: true, hash }                             nothing changed: no broadcast
 *   current()  -> the hash of the last broadcast list (OPTIONS / sends it as
 *                 X-Manifest-Broadcast-Hash, so a booting client knows which delta it can apply)
 *
 * A client applies a delta only when baseHash is the list it last took; otherwise it reads the
 * manifest in full (serviceWorkerManager), as before.
 *
 *   swScriptHash() -> sha1 hex of public/sw.js (cached by its mtime and size; null when unreadable),
 *                     sent as swHash with every broadcast (#890): a page calls registration.update()
 *                     only when it differs from the one it stored, instead of on every notify
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SW_FILE = path.join(__dirname, '..', 'public', 'sw.js');
let swCache = null; // { mtimeMs, size, hash }

function swScriptHash(file = SW_FILE) {
    try {
        const st = fs.statSync(file);
        if (swCache && swCache.file === file && swCache.mtimeMs === st.mtimeMs && swCache.size === st.size) return swCache.hash;
        const hash = crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
        swCache = { file, mtimeMs: st.mtimeMs, size: st.size, hash };
        return hash;
    } catch (_) {
        return null;
    }
}

let lastMap = null;
let lastHash = null;

function digest(rows) {
    const lines = (Array.isArray(rows) ? rows : []).map((f) => `${(f && f.url) || ''}\t${(f && f.hash) || ''}`).sort();
    return crypto.createHash('sha256').update(lines.join('\n')).digest('hex');
}

function next(rows) {
    const list = Array.isArray(rows) ? rows : [];
    const hash = digest(list);
    if (!lastMap) {
        lastMap = new Map(list.map((r) => [r.url, r.hash]));
        lastHash = hash;
        return { full: true, files: list, hash };
    }
    if (hash === lastHash) return { same: true, hash };
    const changed = list.filter((r) => r && lastMap.get(r.url) !== r.hash);
    const baseHash = lastHash;
    lastMap = new Map(list.map((r) => [r.url, r.hash]));
    lastHash = hash;
    return { delta: true, files: changed, baseHash, hash };
}

const current = () => lastHash;

module.exports = { next, current, digest, swScriptHash };
