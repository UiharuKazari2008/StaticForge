'use strict';

/**
 * Recent calendar texts by content hash (#1157). A client that edits a calendar sends the hash of the
 * version it loaded (baseHash); calendarMerge.js merges its save three-way against that text. The VFS
 * removes a blob the moment no file points at it (vfsManager._gcContentBlobIfUnreferenced), so after a
 * later save the base is gone and a delete made in a stale window would come back. Every .ics about to be
 * replaced is kept here first, under its hash, in <data dir>/calendar-bases/<hash>.ics.
 *
 * Capped at MAX_FILES files and MAX_AGE_MS; pruned on a write that adds a file (no timer).
 */

const fs = require('fs');
const path = require('path');

const MAX_FILES = 300;
const MAX_AGE_MS = 30 * 24 * 3600 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;
const HASH = /^[0-9a-f]{16,64}$/i;

let dir = null;
let pruning = null;

/** The folder (tests and the server set it; the default is .cache/calendar-bases next to the databases). */
function setDir(d) { dir = d || null; }
function folder(gr) {
    if (dir) return dir;
    let base = null;
    try { base = gr && gr.getPath ? gr.getPath('databases') : null; } catch (_e) { base = null; }
    return path.join(base || path.join(__dirname, '..', '.cache'), 'calendar-bases');
}
const fileOf = (hash, gr) => path.join(folder(gr), `${String(hash).toLowerCase()}.ics`);

/** Drops the oldest files past the cap and any older than the age limit. */
function prune(gr, now = Date.now()) {
    if (pruning) return pruning;
    pruning = (async () => {
        const d = folder(gr);
        const names = (await fs.promises.readdir(d)).filter((n) => /\.ics$/i.test(n));
        const rows = [];
        for (const n of names) {
            try { rows.push({ n, t: (await fs.promises.stat(path.join(d, n))).mtimeMs }); } catch (_e) { /* gone */ }
        }
        rows.sort((a, b) => b.t - a.t);
        const drop = rows.filter((r, i) => i >= MAX_FILES || now - r.t > MAX_AGE_MS);
        await Promise.all(drop.map((r) => fs.promises.unlink(path.join(d, r.n)).catch(() => {})));
    })().catch(() => {}).finally(() => { pruning = null; });
    return pruning;
}

/** Keeps `text` under `hash` (the hash of that text as the VFS stores it). Answers true when it wrote a file. */
async function save(hash, text, gr) {
    if (!hash || !HASH.test(String(hash)) || typeof text !== 'string' || !text || text.length > MAX_BYTES) return false;
    const f = fileOf(hash, gr);
    try {
        await fs.promises.access(f);
        return false; // already kept
    } catch (_e) { /* not yet */ }
    try {
        await fs.promises.mkdir(path.dirname(f), { recursive: true });
        await fs.promises.writeFile(f, text, 'utf8');
    } catch (e) {
        console.warn(`[calendar-bases] could not keep ${hash}: ${e.message}`);
        return false;
    }
    await prune(gr);
    return true;
}

/** Keeps the text of a stored blob (the version about to be overwritten) under its hash. */
async function saveFromBlob(hash, blobPath, gr) {
    if (!hash || !HASH.test(String(hash))) return false;
    try {
        const st = await fs.promises.stat(blobPath);
        if (st.size > MAX_BYTES) return false;
        return await save(hash, await fs.promises.readFile(blobPath, 'utf8'), gr);
    } catch (_e) { return false; }
}

/** The text kept under `hash`, or '' . */
async function read(hash, gr) {
    if (!hash || !HASH.test(String(hash))) return '';
    try { return await fs.promises.readFile(fileOf(hash, gr), 'utf8'); } catch (_e) { return ''; }
}

module.exports = { save, saveFromBlob, read, prune, setDir, MAX_FILES, MAX_AGE_MS };
