/**
 * Gallery image storage (Yozora #1134): a picture keeps its name `x.png` everywhere (database, workspaces,
 * clients, URLs), but its bytes may lie on disk as `x.jxl` (lossless JPEG XL, about 56 % of the PNG).
 *
 * - The PNG wins when both exist (the swap writes the JXL first and removes the PNG last).
 * - A JXL carries the PNG's own metadata chunks (tEXt / iTXt / zTXt / eXIf / pHYs ...) raw and in their order in
 *   one container box `sfPN`, so a PNG rebuilt from it reads exactly like the original: pngMetadata's text
 *   chunks, the stealth bits in the alpha channel (lossless pixels) and NovelAI's signature (pixels + Comment).
 * - Code that only reads pixels with sharp asks pixelPath(name): the JXL itself when sharp reads JXL.
 * - Whatever needs a real PNG asks pngPath(name): the original, or a decoded copy in .cache/jxl-png (one decode
 *   per name at a time, the oldest copies dropped past CACHE_MAX_BYTES).
 *
 * Decoding uses `djxl` (libjxl-tools on the host); nothing here runs unless a .jxl is actually on disk.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'images');
const CACHE_DIR = path.join(ROOT, '.cache', 'jxl-png');
const CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const BOX_TYPE = 'sfPN';
const BOX_VERSION = 1;
const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JXL_CONTAINER_SIG = Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
// chunks that describe the pixel layout: the decoder writes its own, the stored ones would not match it
const LAYOUT_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'bKGD', 'sBIT', 'hIST']);

// ---------------------------------------------------------------------------------------------------------
// names and paths

/** The bare file name of a gallery picture, or null for anything that is not one (no paths, no dot files). */
function cleanName(name) {
    if (typeof name !== 'string' || !name) return null;
    const base = path.basename(name);
    if (base !== name || base.startsWith('.')) return null;
    return base;
}

function isPngName(name) {
    return /\.png$/i.test(name);
}

/** `x.png` -> `x.jxl` (null for a name that is not a PNG: those are never stored as JXL). */
function jxlNameFor(name) {
    return isPngName(name) ? name.slice(0, -4) + '.jxl' : null;
}

/** A directory listing's names as the pictures' names: `x.jxl` shows as `x.png`, once. */
function logicalNames(entries) {
    const out = new Set();
    for (const e of entries) {
        const n = typeof e === 'string' ? e : e && e.name;
        if (!n) continue;
        out.add(/\.jxl$/i.test(n) ? n.slice(0, -4) + '.png' : n);
    }
    return [...out];
}

// ---------------------------------------------------------------------------------------------------------
// locating

function statOrNull(p) {
    return fs.promises.stat(p).then((s) => (s.isFile() ? s : null), () => null);
}

function statOrNullSync(p) {
    try {
        const s = fs.statSync(p);
        return s.isFile() ? s : null;
    } catch (_) {
        return null;
    }
}

/** Where the picture's bytes are: { kind: 'png' | 'jxl' | 'other', path, stat } or null. */
async function locate(name, dir = IMAGES_DIR) {
    const n = cleanName(name);
    if (!n) return null;
    const direct = path.join(dir, n);
    const s = await statOrNull(direct);
    if (s) return { kind: isPngName(n) ? 'png' : 'other', path: direct, stat: s };
    const j = jxlNameFor(n);
    if (!j) return null;
    const jp = path.join(dir, j);
    const js = await statOrNull(jp);
    return js ? { kind: 'jxl', path: jp, stat: js } : null;
}

function locateSync(name, dir = IMAGES_DIR) {
    const n = cleanName(name);
    if (!n) return null;
    const direct = path.join(dir, n);
    const s = statOrNullSync(direct);
    if (s) return { kind: isPngName(n) ? 'png' : 'other', path: direct, stat: s };
    const j = jxlNameFor(n);
    if (!j) return null;
    const jp = path.join(dir, j);
    const js = statOrNullSync(jp);
    return js ? { kind: 'jxl', path: jp, stat: js } : null;
}

async function exists(name, dir = IMAGES_DIR) {
    return !!(await locate(name, dir));
}

function existsSync(name, dir = IMAGES_DIR) {
    return !!locateSync(name, dir);
}

// ---------------------------------------------------------------------------------------------------------
// PNG chunks and the sfPN box

function readPngChunks(buf) {
    if (!Buffer.isBuffer(buf) || buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIG)) {
        throw new Error('not a PNG');
    }
    const chunks = [];
    let off = 8;
    while (off + 12 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const end = off + 12 + len;
        if (end > buf.length) throw new Error('truncated PNG chunk ' + type);
        chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len), raw: buf.subarray(off, end) });
        off = end;
        if (type === 'IEND') break;
    }
    return chunks;
}

/** The PNG's metadata chunks (everything but the pixel layout), each marked before (0) or after (1) the pixels. */
function metadataChunks(pngBuf) {
    const out = [];
    let afterIdat = false;
    for (const c of readPngChunks(pngBuf)) {
        if (c.type === 'IDAT') { afterIdat = true; continue; }
        if (LAYOUT_CHUNKS.has(c.type)) continue;
        out.push({ where: afterIdat ? 1 : 0, raw: c.raw });
    }
    return out;
}

/** The sfPN box payload: version, then per chunk: where (u8), its whole raw PNG chunk (length, type, data, crc). */
function encodeBoxPayload(pngBuf) {
    const parts = [Buffer.from([BOX_VERSION])];
    for (const c of metadataChunks(pngBuf)) {
        parts.push(Buffer.from([c.where]), c.raw);
    }
    return Buffer.concat(parts);
}

function decodeBoxPayload(payload) {
    if (!payload || payload[0] !== BOX_VERSION) throw new Error('unknown sfPN box version');
    const out = [];
    let off = 1;
    while (off < payload.length) {
        const where = payload[off];
        const len = payload.readUInt32BE(off + 1);
        const raw = payload.subarray(off + 1, off + 1 + 12 + len);
        out.push({ where, raw });
        off += 1 + 12 + len;
    }
    return out;
}

function box(type, payload) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, payload]);
}

/** A JXL file's boxes (container), or null for a bare codestream. */
function readBoxes(jxl) {
    if (!jxl.subarray(0, 12).equals(JXL_CONTAINER_SIG)) return null;
    const boxes = [];
    let off = 0;
    while (off + 8 <= jxl.length) {
        let size = jxl.readUInt32BE(off);
        const type = jxl.toString('latin1', off + 4, off + 8);
        let head = 8;
        if (size === 1) { size = Number(jxl.readBigUInt64BE(off + 8)); head = 16; }
        if (size === 0) size = jxl.length - off;
        if (size < head || off + size > jxl.length) throw new Error('bad JXL box ' + type);
        boxes.push({ type, payload: jxl.subarray(off + head, off + size), raw: jxl.subarray(off, off + size) });
        off += size;
    }
    return boxes;
}

/**
 * The JXL with the PNG's metadata in an sfPN box (a bare codestream is wrapped in a container first; an older
 * sfPN box is replaced). Decoders skip box types they do not know.
 */
function attachPngMetadata(jxl, pngBuf) {
    const payload = encodeBoxPayload(pngBuf);
    const boxes = readBoxes(jxl);
    if (!boxes) {
        const ftyp = box('ftyp', Buffer.from('jxl \0\0\0\0jxl ', 'latin1'));
        return Buffer.concat([JXL_CONTAINER_SIG, ftyp, box(BOX_TYPE, payload), box('jxlc', jxl)]);
    }
    // explicit sizes throughout (a last box of size 0 runs to the end of the file)
    const kept = boxes.filter((b) => b.type !== BOX_TYPE && b.type !== 'JXL ');
    return Buffer.concat([JXL_CONTAINER_SIG, ...kept.map((b) => box(b.type, b.payload)), box(BOX_TYPE, payload)]);
}

function readPngMetadataBox(jxl) {
    const boxes = readBoxes(jxl);
    const b = boxes && boxes.find((x) => x.type === BOX_TYPE);
    return b ? decodeBoxPayload(b.payload) : null;
}

/** The decoder's PNG with the stored metadata chunks back in their places (its own metadata chunks dropped). */
function rebuildPng(decodedPng, stored) {
    const chunks = readPngChunks(decodedPng);
    const ihdr = chunks.find((c) => c.type === 'IHDR');
    const idat = chunks.filter((c) => c.type === 'IDAT');
    const iend = chunks.find((c) => c.type === 'IEND');
    if (!ihdr || !idat.length || !iend) throw new Error('decoded PNG incomplete');
    // with nothing stored, the decoder's own chunks (colour space) stay
    if (!stored) return decodedPng;
    const pre = stored.filter((c) => c.where === 0).map((c) => c.raw);
    const post = stored.filter((c) => c.where === 1).map((c) => c.raw);
    return Buffer.concat([PNG_SIG, ihdr.raw, ...pre, ...idat.map((c) => c.raw), ...post, iend.raw]);
}

// ---------------------------------------------------------------------------------------------------------
// decoding and the cache

const inflight = new Map();
let cacheBytesKnown = null;

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        execFile(cmd, args, { maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) {
                err.message += ' ' + String(stderr || '').slice(-300);
                reject(err);
            } else {
                resolve(stdout);
            }
        });
    });
}

/** A full PNG (pixels + the original metadata chunks) from a JXL file. */
async function decodeJxlToPngBuffer(jxlPath) {
    const tmp = path.join(CACHE_DIR, `.dec-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.png`);
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    try {
        await run('djxl', ['--quiet', jxlPath, tmp]);
        const decoded = await fs.promises.readFile(tmp);
        const jxl = await fs.promises.readFile(jxlPath);
        return rebuildPng(decoded, readPngMetadataBox(jxl));
    } finally {
        fs.promises.unlink(tmp).catch(() => {});
    }
}

async function trimCache() {
    let entries;
    try {
        entries = await fs.promises.readdir(CACHE_DIR, { withFileTypes: true });
    } catch (_) {
        return;
    }
    const files = [];
    for (const e of entries) {
        if (!e.isFile() || e.name.startsWith('.')) continue;
        const p = path.join(CACHE_DIR, e.name);
        const s = await statOrNull(p);
        if (s) files.push({ p, size: s.size, used: s.atimeMs > s.mtimeMs ? s.atimeMs : s.mtimeMs });
    }
    let total = files.reduce((a, f) => a + f.size, 0);
    if (total <= CACHE_MAX_BYTES) { cacheBytesKnown = total; return; }
    files.sort((a, b) => a.used - b.used);
    for (const f of files) {
        if (total <= CACHE_MAX_BYTES * 0.8) break;
        await fs.promises.unlink(f.p).catch(() => {});
        total -= f.size;
    }
    cacheBytesKnown = total;
}

/**
 * A real PNG file for the picture: its own file, or the decoded copy of its JXL (made once, kept in the cache
 * while its JXL is unchanged). null when the picture is not there.
 */
async function pngPath(name, dir = IMAGES_DIR) {
    const loc = await locate(name, dir);
    if (!loc) return null;
    if (loc.kind !== 'jxl') return loc.path;
    const n = cleanName(name);
    const cached = path.join(CACHE_DIR, n);
    const cs = await statOrNull(cached);
    if (cs && cs.mtimeMs === loc.stat.mtimeMs) {
        // used: the trim keeps it (atime is not always kept by the mount)
        fs.promises.utimes(cached, new Date(), loc.stat.mtime).catch(() => {});
        return cached;
    }
    if (inflight.has(cached)) return inflight.get(cached);
    const job = (async () => {
        const buf = await decodeJxlToPngBuffer(loc.path);
        const tmp = cached + `.${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, buf);
        // the copy carries the JXL's mtime: a later JXL (re-encode) is seen as new
        await fs.promises.utimes(tmp, new Date(), loc.stat.mtime);
        await fs.promises.rename(tmp, cached);
        if (cacheBytesKnown === null || (cacheBytesKnown += buf.length) > CACHE_MAX_BYTES) void trimCache();
        return cached;
    })().finally(() => inflight.delete(cached));
    inflight.set(cached, job);
    return job;
}

let sharpJxl = null;
/** sharp reads JPEG XL itself (built against the system libvips 8.16 with libjxl; the prebuilt one does not). */
function sharpReadsJxl() {
    if (sharpJxl === null) {
        try {
            const s = require('sharp');
            sharpJxl = !!(s.format && s.format.jxl && s.format.jxl.input && s.format.jxl.input.file);
        } catch (_) {
            sharpJxl = false;
        }
    }
    return sharpJxl;
}

/**
 * A file for code that only reads the pixels with sharp (previews, resizes, sizes): the stored file itself, a JXL
 * too when sharp reads JXL (no decode to PNG); else as pngPath. Never for code that needs the PNG's metadata
 * chunks or PNG bytes (uploads, downloads, metadata reads): those use pngPath / readPng.
 */
async function pixelPath(name, dir = IMAGES_DIR) {
    const loc = await locate(name, dir);
    if (!loc) return null;
    if (loc.kind === 'jxl' && !sharpReadsJxl()) return pngPath(name, dir);
    return loc.path;
}

/**
 * Whether the PNG a JXL was made from carried a colour profile (an iCCP chunk in its sfPN box). libvips reports an
 * ICC profile for every JXL (the format always names its colour space), so a JXL's own metadata cannot tell.
 */
async function jxlOriginalHasIcc(jxlPath) {
    const stored = readPngMetadataBox(await fs.promises.readFile(jxlPath));
    if (!stored) return true;
    return stored.some((c) => c.raw.toString('latin1', 4, 8) === 'iCCP');
}

/** The picture's PNG bytes (original or rebuilt), or null. */
async function readPng(name, dir = IMAGES_DIR) {
    const p = await pngPath(name, dir);
    return p ? fs.promises.readFile(p) : null;
}

/**
 * What the picture looks like on disk to a caller that reports it: mtime of the stored file (the swap keeps the
 * PNG's), size of the PNG when it is one, else of the JXL (pass { pngSize: true } to get the rebuilt PNG's size,
 * which decodes it).
 */
async function stat(name, opts = {}, dir = IMAGES_DIR) {
    const loc = await locate(name, dir);
    if (!loc) return null;
    if (loc.kind === 'jxl' && opts.pngSize) {
        const p = await pngPath(name, dir);
        const s = p ? await statOrNull(p) : null;
        return s ? { kind: 'jxl', size: s.size, mtime: loc.stat.mtime, mtimeMs: loc.stat.mtimeMs, stat: loc.stat } : null;
    }
    return { kind: loc.kind, size: loc.stat.size, mtime: loc.stat.mtime, mtimeMs: loc.stat.mtimeMs, stat: loc.stat };
}

/** Remove the picture in every form (PNG, JXL, cached copy). Resolves to true when something was removed. */
async function remove(name, dir = IMAGES_DIR) {
    const n = cleanName(name);
    if (!n) return false;
    const targets = [path.join(dir, n)];
    const j = jxlNameFor(n);
    if (j) targets.push(path.join(dir, j));
    let removed = false;
    for (const t of targets) {
        try { await fs.promises.unlink(t); removed = true; } catch (_) { /* not that form */ }
    }
    fs.promises.unlink(path.join(CACHE_DIR, n)).catch(() => {});
    return removed;
}

/** Rename a picture in whatever form it is stored (`a.png` -> `b.png` moves `a.jxl` to `b.jxl`). */
async function rename(oldName, newName, dir = IMAGES_DIR) {
    const loc = await locate(oldName, dir);
    const nn = cleanName(newName);
    if (!loc || !nn) throw new Error('rename: picture not found or bad name');
    const target = loc.kind === 'jxl' ? path.join(dir, jxlNameFor(nn)) : path.join(dir, nn);
    await fs.promises.rename(loc.path, target);
    fs.promises.unlink(path.join(CACHE_DIR, cleanName(oldName))).catch(() => {});
    return target;
}

module.exports = {
    IMAGES_DIR,
    CACHE_DIR,
    BOX_TYPE,
    cleanName,
    jxlNameFor,
    logicalNames,
    locate,
    locateSync,
    exists,
    existsSync,
    pngPath,
    pixelPath,
    sharpReadsJxl,
    jxlOriginalHasIcc,
    readPng,
    stat,
    remove,
    rename,
    // the swap / converter and tests
    attachPngMetadata,
    readPngMetadataBox,
    rebuildPng,
    decodeJxlToPngBuffer,
    metadataChunks
};
