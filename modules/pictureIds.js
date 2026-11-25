/**
 * Picture IDs (Yozora #1156 phase 3): a new picture's name is an ID, not a file name.
 *
 * - The ID is UUIDv7-shaped (RFC 9562, method 3): 48 bits of unix milliseconds, then the nanosecond remainder of
 *   that millisecond (12 bits), then random bits - time-ordered, unique without a lookup, no extension, no spaces.
 *   The stored file is `<id>.jxl`; anywhere a name is passed, `<id>` is the whole name.
 * - Pictures from before keep their `x.png` names. isId() tells the two apart (a legacy name is never a UUID).
 * - An upscale (or any derived picture) is its own ID, linked to its parent here, not by a `_upscaled` suffix.
 *   The links live in data/picture-links.jsonl (append-only, one `{id, parent, kind}` per line, loaded once) so
 *   baseOf() / upscaleOf() answer synchronously for the gallery's grouping code.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const LINKS_FILE = path.join(__dirname, '..', 'data', 'picture-links.jsonl');
const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let lastMs = 0;
let lastSub = -1;

/** A new picture ID. Strictly increasing within the process even inside one millisecond. */
function newId() {
    const ns = process.hrtime.bigint();
    let ms = Date.now();
    // the nanosecond remainder from the monotonic clock's fraction of this millisecond (12 bits of 1e6 ns)
    let sub = Number((ns % 1000000n) * 4096n / 1000000n);
    if (ms < lastMs) ms = lastMs;
    if (ms === lastMs && sub <= lastSub) {
        sub = lastSub + 1;
        if (sub > 4095) { ms += 1; sub = 0; }
    }
    lastMs = ms;
    lastSub = sub;
    const r = crypto.randomBytes(8);
    r[0] = (r[0] & 0x3f) | 0x80;
    const hexMs = ms.toString(16).padStart(12, '0');
    const hexSub = sub.toString(16).padStart(3, '0');
    const tail = r.toString('hex');
    return `${hexMs.slice(0, 8)}-${hexMs.slice(8)}-7${hexSub}-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

/** `<id>`, `<id>.jxl` or any other extension of an ID: the ID itself, or null. */
function idOf(name) {
    if (typeof name !== 'string' || name.length < 36) return null;
    const stem = name.length === 36 ? name : name.replace(/\.(jxl|png|webp|jpe?g)$/i, '');
    return ID_RE.test(stem) ? stem : null;
}

function isId(name) {
    return idOf(name) !== null;
}

/** The creation time (ms) an ID encodes. */
function timeOf(name) {
    const id = idOf(name);
    return id ? parseInt(id.slice(0, 8) + id.slice(9, 13), 16) : null;
}

// ---- links ----------------------------------------------------------------------------------------------
// Keyed by stem (the name without its extension) so `x.png`, `x.jxl`, `x` and an ID with or without `.jxl` meet.

const EXT_RE = /\.(jxl|png|webp|jpe?g|gif)$/i;
const parents = new Map();   // child stem -> { parent: parent's name as given, kind }
const children = new Map();  // parent stem -> Map(kind -> child's name as given) (the latest of each kind wins)
let loaded = false;

function stemOf(name) {
    return typeof name === 'string' ? name.replace(EXT_RE, '') : '';
}

function load() {
    if (loaded) return;
    loaded = true;
    let text = '';
    try { text = fs.readFileSync(LINKS_FILE, 'utf8'); } catch (_) { return; }
    for (const line of text.split('\n')) {
        if (!line) continue;
        try {
            const l = JSON.parse(line);
            if (l && l.id && l.parent) remember(l.id, l.parent, l.kind || 'upscale');
        } catch (_) { /* a torn last line */ }
    }
}

function remember(id, parent, kind) {
    parents.set(stemOf(id), { parent, kind });
    const ps = stemOf(parent);
    let m = children.get(ps);
    if (!m) children.set(ps, (m = new Map()));
    m.set(kind, id);
}

/** Record that `id` is `kind` ('upscale', 'expand', ...) of `parent`; both are names (a legacy parent keeps its .png). */
function link(id, parent, kind = 'upscale') {
    load();
    if (!id || !parent || stemOf(id) === stemOf(parent)) return;
    remember(id, parent, kind);
    try {
        fs.mkdirSync(path.dirname(LINKS_FILE), { recursive: true });
        fs.appendFileSync(LINKS_FILE, JSON.stringify({ id, parent, kind, t: Date.now() }) + '\n');
    } catch (_) { /* the in-memory link still serves this process; the DB parent column holds it too */ }
}

/** The ID of a new upscale of `parent` (a legacy name or an ID), linked. */
function newUpscaleOf(parent) {
    const id = newId();
    link(id, parent, 'upscale');
    return id;
}

/** The gallery base of any name: the stem of the root original of an upscale chain (legacy `_upscaled` stripped). */
function baseOf(name) {
    load();
    let cur = stemOf(name);
    for (let i = 0; i < 8; i++) {
        const p = parents.get(cur);
        if (!p || p.kind !== 'upscale') break;
        cur = stemOf(p.parent);
    }
    return cur.replace(/_upscaled$/i, '');
}

/** True for a linked upscale and for a legacy `_upscaled` name. */
function isUpscale(name) {
    load();
    const p = parents.get(stemOf(name));
    return !!(p && p.kind === 'upscale') || /_upscaled\.[a-z]+$/i.test(String(name || ''));
}

function parentOf(name) {
    load();
    const p = parents.get(stemOf(name));
    return p ? p.parent : null;
}

/** The latest linked upscale of `name`'s picture (as named when linked), or null. */
function upscaleOf(name) {
    load();
    const m = children.get(stemOf(name));
    return (m && m.get('upscale')) || null;
}

module.exports = { newId, idOf, isId, timeOf, stemOf, link, newUpscaleOf, baseOf, isUpscale, parentOf, upscaleOf, LINKS_FILE };
