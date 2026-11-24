/**
 * Gallery image storage (Yozora #1134): a picture keeps its name `x.png` everywhere (database, workspaces,
 * clients, URLs), but its bytes may lie on disk as `x.jxl` (lossless JPEG XL, about 56 % of the PNG).
 *
 * - The PNG wins when both exist (the swap writes the JXL first and removes the PNG last).
 * - A JXL carries the picture's text fields ([keyword, text], format-neutral, #1156) in one container box `sfMD`
 *   (modules/pictureMeta.js), so a PNG rebuilt from it reads like the original: pngMetadata's text chunks, the
 *   stealth bits in the alpha channel (lossless pixels) and NovelAI's signature (pixels + Comment). Files from
 *   before #1156 carry the PNG's own metadata chunks raw in `sfPN` instead; they are still read (sfMD first).
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
const pictureMeta = require('./pictureMeta');
const pictureIds = require('./pictureIds');

const ROOT = path.resolve(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'images');
const CACHE_DIR = path.join(ROOT, '.cache', 'jxl-png');
const CACHE_MAX_BYTES = 2 * 1024 * 1024 * 1024;
const BOX_TYPE = 'sfPN';
// the original PNG file's birth and modified times (date created / modified kept across the swap)
const TIMES_BOX = 'sfFT';
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

/** `x.png` -> `x.jxl`; a picture ID (#1156: no extension) -> `<id>.jxl`; null for any other name (never stored as JXL). */
function jxlNameFor(name) {
    if (isPngName(name)) return name.slice(0, -4) + '.jxl';
    return name.length === 36 && pictureIds.isId(name) ? name + '.jxl' : null;
}

/** A gallery picture's name: a legacy image file name, or a picture ID (#1156, no extension). */
function isPictureName(name) {
    return typeof name === 'string' && (/\.(png|jpe?g|gif)$/i.test(name) || (name.length === 36 && pictureIds.isId(name)));
}

/**
 * The name for a new upscale of `filename`: the picture's existing upscale when it has one (an upscale replaces
 * the earlier one), a legacy `x_upscaled.png` that is on disk, else a new picture ID linked to its parent (#1156).
 */
function upscaleNameFor(filename, dir = IMAGES_DIR) {
    const linked = pictureIds.upscaleOf(filename);
    if (linked) return linked;
    if (isPngName(filename) && !pictureIds.isId(filename)) {
        const legacy = filename.replace(/\.png$/i, '_upscaled.png');
        if (existsSync(legacy, dir)) return legacy;
    }
    return pictureIds.newUpscaleOf(filename);
}

/** The original of an upscale (its linked parent, or the legacy name without `_upscaled`); the name itself otherwise. */
function originalNameFor(filename) {
    const parent = pictureIds.parentOf(filename);
    if (parent && pictureIds.isUpscale(filename)) return parent;
    return /_upscaled\./.test(filename) ? filename.replace('_upscaled.', '.') : filename;
}

/** A directory listing's names as the pictures' names: `x.jxl` shows as `x.png`, once. */
function logicalNames(entries) {
    const out = new Set();
    for (const e of entries) {
        const n = typeof e === 'string' ? e : e && e.name;
        if (!n) continue;
        if (!/\.jxl$/i.test(n)) { out.add(n); continue; }
        const stem = n.slice(0, -4);
        out.add(pictureIds.isId(stem) ? stem : stem + '.png'); // an ID is its own name; a legacy x.jxl shows as x.png
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

/**
 * The legacy sfPN box payload (written before #1156, read still): version, then per chunk: where (u8), its whole raw
 * PNG chunk (length, type, data, crc).
 */
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
 * The JXL with the source picture's text fields in an sfMD box after the codestream (#1156; a bare codestream is
 * wrapped in a container first; older sfPN / sfMD / sfFT boxes are replaced). source: a PNG, WebP, JPEG XL or JPEG
 * buffer, or a fields array ([[keyword, text], ...]). Decoders skip box types they do not know (djxl, sharp /
 * libvips and Chrome 157 checked).
 */
function attachPngMetadata(jxl, source, times = null) {
    const fields = Array.isArray(source) ? pictureMeta.normFields(source) : pictureMeta.readFields(source);
    // whether the source had a colour profile (the lossless preview asks; a JXL always reports one)
    const icc = Array.isArray(source) ? undefined : pictureMeta.hasIcc(source);
    const md = { v: 1, fields };
    if (typeof icc === 'boolean') md.icc = icc;
    // a PNG's pixel density and EXIF, kept in neutral form (#1156: nothing lost in the move to JXL)
    const extras = Array.isArray(source) ? {} : pictureMeta.extrasOf(source);
    if (extras.dpi) md.dpi = extras.dpi;
    if (extras.exif) md.exif = extras.exif;
    // the PNG file's own times (birth = date created, mtime = date modified): the JXL file is new, so its birth is
    // the swap; these stay with the picture (Yukimi: dates created and modified must not change)
    const tail = [box(pictureMeta.MD_BOX, Buffer.from(JSON.stringify(md), 'utf8'))];
    if (times && (times.birthtimeMs > 0 || times.mtimeMs > 0)) {
        const t = { b: Math.round(times.birthtimeMs || 0), m: Math.round(times.mtimeMs || 0) };
        if (typeof times.effort === 'number') t.e = times.effort; // e: the effort it was encoded at; 0 = not known (the nightly pass re-encodes it); no e = effort 7 (the Ruiko backlog)
        tail.push(box(TIMES_BOX, Buffer.from(JSON.stringify(t))));
    }
    const boxes = readBoxes(jxl);
    if (!boxes) {
        const ftyp = box('ftyp', Buffer.from('jxl \0\0\0\0jxl ', 'latin1'));
        // the codestream first: a browser draws while the rest arrives, and its size header is at the start
        // (a picture's metadata box can be hundreds of KB, #1134)
        return Buffer.concat([JXL_CONTAINER_SIG, ftyp, box('jxlc', jxl), ...tail]);
    }
    // explicit sizes throughout (a last box of size 0 runs to the end of the file)
    const kept = boxes.filter((b) => b.type !== BOX_TYPE && b.type !== pictureMeta.MD_BOX && b.type !== TIMES_BOX && b.type !== 'JXL ');
    return Buffer.concat([JXL_CONTAINER_SIG, ...kept.map((b) => box(b.type, b.payload)), ...tail]);
}

/**
 * The original PNG file's times kept in a JXL (sfFT box): { birthtimeMs, mtimeMs }, or null (a JXL made before the
 * box existed). Reads box headers only, then the small box.
 */
function readFileTimesSync(jxlPath) {
    let fd;
    try {
        fd = fs.openSync(jxlPath, 'r');
        const hb = Buffer.alloc(16);
        let off = 0;
        for (let i = 0; i < 64; i++) {
            const n = fs.readSync(fd, hb, 0, 16, off);
            if (n < 8) return null;
            if (off === 0 && !(hb.readUInt32BE(0) === 12 && hb.toString('latin1', 4, 8) === 'JXL ')) return null;
            let size = hb.readUInt32BE(0);
            let head = 8;
            if (size === 1) { size = Number(hb.readBigUInt64BE(8)); head = 16; }
            const type = hb.toString('latin1', 4, 8);
            if (type === TIMES_BOX && size - head < 4096) {
                const body = Buffer.alloc(size - head);
                fs.readSync(fd, body, 0, body.length, off + head);
                const t = JSON.parse(body.toString('utf8'));
                return { birthtimeMs: Number(t.b) || 0, mtimeMs: Number(t.m) || 0, effort: t.e === undefined ? null : Number(t.e), estimated: !!t.est };
            }
            if (size === 0 || size < head) return null;
            off += size;
        }
        return null;
    } catch (_) {
        return null;
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* closed */ } }
    }
}

/**
 * The picture's date created: a PNG's file birth time; for a JXL the PNG's birth time kept in it (sfFT), else its
 * kept mtime. ms, or null when the picture is missing.
 */
function createdMsSync(name, dir = IMAGES_DIR) {
    const loc = locateSync(name, dir);
    if (!loc) return null;
    if (loc.kind !== 'jxl') return loc.stat.birthtimeMs > 0 ? loc.stat.birthtimeMs : loc.stat.mtimeMs;
    const t = readFileTimesSync(loc.path);
    return t && t.birthtimeMs > 0 ? t.birthtimeMs : loc.stat.mtimeMs;
}

function readPngMetadataBox(jxl) {
    const boxes = readBoxes(jxl);
    const b = boxes && boxes.find((x) => x.type === BOX_TYPE);
    return b ? decodeBoxPayload(b.payload) : null;
}

/**
 * A JXL's text fields ([[keyword, text], ...]): its sfMD box, else the text chunks of a legacy sfPN box; [] when it
 * has neither. jxl: the file's bytes or its path.
 */
async function readMetadataFields(jxl) {
    const buf = Buffer.isBuffer(jxl) ? jxl : await fs.promises.readFile(jxl);
    return pictureMeta.readFields(buf);
}

const TEXT_CHUNK_TYPES = new Set(['tEXt', 'iTXt', 'zTXt']);

/**
 * The decoder's PNG with the stored metadata back: the sfPN chunks in their places (the decoder's own metadata
 * chunks dropped), and, when the JXL has sfMD fields, those as tEXt chunks right after IHDR (where NovelAI puts
 * them; any text chunks in sfPN or from the decoder dropped).
 */
function rebuildPng(decodedPng, stored, fields = null, md = null) {
    const chunks = readPngChunks(decodedPng);
    const ihdr = chunks.find((c) => c.type === 'IHDR');
    const idat = chunks.filter((c) => c.type === 'IDAT');
    const iend = chunks.find((c) => c.type === 'IEND');
    if (!ihdr || !idat.length || !iend) throw new Error('decoded PNG incomplete');
    // with nothing stored, the decoder's own chunks (colour space) stay
    if (!stored && !fields) return decodedPng;
    if (!fields) {
        const pre = stored.filter((c) => c.where === 0).map((c) => c.raw);
        const post = stored.filter((c) => c.where === 1).map((c) => c.raw);
        return Buffer.concat([PNG_SIG, ihdr.raw, ...pre, ...idat.map((c) => c.raw), ...post, iend.raw]);
    }
    const isText = (raw) => TEXT_CHUNK_TYPES.has(raw.toString('latin1', 4, 8));
    let pre;
    let post;
    if (stored) {
        pre = stored.filter((c) => c.where === 0 && !isText(c.raw)).map((c) => c.raw);
        post = stored.filter((c) => c.where === 1 && !isText(c.raw)).map((c) => c.raw);
    } else {
        pre = [];
        post = [];
        let after = false;
        for (const c of chunks) {
            if (c.type === 'IDAT') { after = true; continue; }
            if (c.type === 'IHDR' || c.type === 'IEND' || TEXT_CHUNK_TYPES.has(c.type)) continue;
            (after ? post : pre).push(c.raw);
        }
    }
    const text = fields.map(([k, v]) => pictureMeta.pngTextChunk(k, v));
    // the source PNG's pixel density and EXIF kept in sfMD (#1156) replace whatever the decoder wrote for them
    const extras = pictureMeta.extrasPngChunks(md);
    if (extras.length) {
        const own = new Set(extras.map((c) => c.toString('latin1', 4, 8)));
        pre = pre.filter((raw) => !own.has(raw.toString('latin1', 4, 8)));
        post = post.filter((raw) => !own.has(raw.toString('latin1', 4, 8)));
    }
    return Buffer.concat([PNG_SIG, ihdr.raw, ...text, ...extras, ...pre, ...idat.map((c) => c.raw), ...post, iend.raw]);
}

/**
 * Pixel size from the start of a JPEG XL file (bare codestream or container), from its SizeHeader (ISO/IEC
 * 18181-1): no decode. null when the bytes do not reach it.
 */
function jxlSizeFromHead(buf) {
    let cs = null;
    if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0x0a) {
        cs = buf;
    } else if (buf.length >= 12 && buf.subarray(0, 12).equals(JXL_CONTAINER_SIG)) {
        let off = 0;
        while (off + 8 <= buf.length) {
            let size = buf.readUInt32BE(off);
            const type = buf.toString('latin1', off + 4, off + 8);
            let head = 8;
            if (size === 1) { if (off + 16 > buf.length) return null; size = Number(buf.readBigUInt64BE(off + 8)); head = 16; }
            if (type === 'jxlc') { cs = buf.subarray(off + head); break; }
            if (type === 'jxlp') { cs = buf.subarray(off + head + 4); break; }
            if (size === 0 || size < head) return null;
            off += size;
        }
    }
    if (!cs || cs.length < 12 || cs[0] !== 0xff || cs[1] !== 0x0a) return null;
    let bit = 16;
    const u = (n) => {
        let v = 0;
        for (let i = 0; i < n; i++, bit++) v |= ((cs[bit >> 3] >> (bit & 7)) & 1) << i;
        return v >>> 0;
    };
    const u32 = () => [9, 13, 18, 30][u(2)];
    const div8 = u(1);
    const height = div8 ? 8 * (1 + u(5)) : 1 + u(u32());
    const ratio = u(3);
    const RATIOS = [null, [1, 1], [12, 10], [4, 3], [3, 2], [16, 9], [5, 4], [2, 1]];
    let width;
    if (ratio === 0) width = div8 ? 8 * (1 + u(5)) : 1 + u(u32());
    else width = Math.floor(height * RATIOS[ratio][0] / RATIOS[ratio][1]);
    return width > 0 && height > 0 ? { width, height } : null;
}

/**
 * The picture's pixel size from its file header (PNG IHDR or the JXL SizeHeader), synchronously and without a
 * decode: for callers that cannot wait (Cake Pantry's meal layout). null when unknown.
 */
function readSizeSync(name, dir = IMAGES_DIR) {
    const loc = locateSync(name, dir);
    if (!loc) return null;
    let fd;
    try {
        fd = fs.openSync(loc.path, 'r');
        if (loc.kind === 'jxl') {
            // walk the box headers (the sfPN box can be tens of KB) to the codestream; read only its start
            const hb = Buffer.alloc(64);
            let off = 0;
            for (let i = 0; i < 64; i++) {
                const n = fs.readSync(fd, hb, 0, 64, off);
                if (n < 16) return null;
                if (off === 0 && hb[0] === 0xff && hb[1] === 0x0a) return jxlSizeFromHead(hb.subarray(0, n));
                if (off === 0 && !hb.subarray(0, 12).equals(JXL_CONTAINER_SIG)) return null;
                let size = hb.readUInt32BE(0);
                const type = hb.toString('latin1', 4, 8);
                let head = 8;
                if (size === 1) { size = Number(hb.readBigUInt64BE(8)); head = 16; }
                if (type === 'jxlc' || type === 'jxlp') {
                    const skip = head + (type === 'jxlp' ? 4 : 0);
                    return jxlSizeFromHead(hb.subarray(skip, n));
                }
                if (size < head) return null;
                off += size;
            }
            return null;
        }
        const buf = Buffer.alloc(24);
        const n = fs.readSync(fd, buf, 0, 24, 0);
        const head = buf.subarray(0, n);
        if (n < 24 || !head.subarray(0, 8).equals(PNG_SIG)) return null;
        return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
    } catch (_) {
        return null;
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch (_) { /* closed */ } }
    }
}

// ---------------------------------------------------------------------------------------------------------
// decoding and the cache

/**
 * Where a picture's decoded copy lives: by name for images/; per folder for any other (tests, temp folders), so
 * the same name in two folders never shares a copy.
 */
function cacheFileFor(name, dir) {
    if (!dir || path.resolve(dir) === IMAGES_DIR) return path.join(CACHE_DIR, name);
    const tag = require('crypto').createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 12);
    const sub = path.join(CACHE_DIR, `d-${tag}`);
    try { fs.mkdirSync(sub, { recursive: true }); } catch (_) { /* exists */ }
    return path.join(sub, name);
}

const inflight = new Map();
let cacheBytesKnown = null;

// The size of each picture's rebuilt PNG (what pngPath / FUSE reads send), by name: { m: the JXL's mtimeMs, s: bytes }.
// djxl and the rebuild are deterministic, so a size stays right while the JXL is unchanged. Kept in
// .cache/jxl-png/.sizes.json (the cache trim skips dot files); filled whenever a PNG is rebuilt (#1152).
const SIZES_FILE = path.join(CACHE_DIR, '.sizes.json');
let pngSizes = null;
let pngSizesSave = null;
function sizesMap() {
    if (!pngSizes) {
        try { pngSizes = new Map(Object.entries(JSON.parse(fs.readFileSync(SIZES_FILE, 'utf8')))); } catch (_) { pngSizes = new Map(); }
    }
    return pngSizes;
}
function notePngSize(name, jxlMtimeMs, size) {
    const m = sizesMap();
    const was = m.get(name);
    if (was && was.m === jxlMtimeMs && was.s === size) return;
    m.set(name, { m: jxlMtimeMs, s: size });
    scheduleSizesSave();
}
function scheduleSizesSave() {
    if (pngSizesSave) return;
    pngSizesSave = setTimeout(() => {
        pngSizesSave = null;
        const tmp = SIZES_FILE + `.${process.pid}.tmp`;
        fs.promises.mkdir(CACHE_DIR, { recursive: true })
            .then(() => fs.promises.writeFile(tmp, JSON.stringify(Object.fromEntries(sizesMap()))))
            .then(() => fs.promises.rename(tmp, SIZES_FILE))
            .catch(() => {});
    }, 5000);
    if (pngSizesSave.unref) pngSizesSave.unref();
}
/** The rebuilt PNG's size for a JXL-stored picture whose JXL has this mtime, if it was ever rebuilt; else null. */
function knownPngSize(name, jxlMtimeMs) {
    const e = sizesMap().get(name);
    return e && Math.abs(e.m - jxlMtimeMs) < 1000 ? e.s : null;
}
/**
 * The size of the PNG a read of the picture sends: the PNG's own, or for a JXL the rebuilt one (decoding it once
 * when { decode: true } and it is not known yet). null when unknown or missing.
 */
async function pngSize(name, opts = {}, dir = IMAGES_DIR) {
    const loc = await locate(name, dir);
    if (!loc) return null;
    if (loc.kind !== 'jxl') return loc.stat.size;
    const known = knownPngSize(cleanName(name), loc.stat.mtimeMs);
    if (known != null || !opts.decode) return known;
    const p = await pngPath(name, dir);
    const s = p ? await statOrNull(p) : null;
    return s ? s.size : null;
}

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

let djxlMissing = false;

/**
 * A full PNG (pixels + the original metadata chunks) from a JXL file. djxl first (libjxl-tools; its output is what
 * the size map was learnt from on this host), sharp when djxl is not installed and sharp reads JXL (#1134
 * install: a host may have either one).
 */
async function decodeJxlToPngBuffer(jxlPath) {
    // a path, or the JXL's bytes (#1156: pictures in memory)
    const jxl = Buffer.isBuffer(jxlPath) ? jxlPath : await fs.promises.readFile(jxlPath);
    const stored = readPngMetadataBox(jxl);
    const md = pictureMeta.readMd(jxl);
    const fields = md ? md.fields : null;
    if (!djxlMissing) {
        const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const tmp = path.join(CACHE_DIR, `.dec-${stamp}.png`);
        const src = Buffer.isBuffer(jxlPath) ? path.join(CACHE_DIR, `.dec-${stamp}.jxl`) : jxlPath;
        await fs.promises.mkdir(CACHE_DIR, { recursive: true });
        try {
            if (src !== jxlPath) await fs.promises.writeFile(src, jxl);
            await run('djxl', ['--quiet', src, tmp]);
            return rebuildPng(await fs.promises.readFile(tmp), stored, fields, md);
        } catch (e) {
            if (e && e.code !== 'ENOENT') throw e;
            djxlMissing = true;
            console.warn('[imageStore] djxl is not installed (apt install libjxl-tools): decoding JPEG XL with sharp');
        } finally {
            fs.promises.unlink(tmp).catch(() => {});
            if (src !== jxlPath) fs.promises.unlink(src).catch(() => {});
        }
    }
    if (!sharpReadsJxl()) {
        throw new Error('no JPEG XL decoder: install libjxl-tools (djxl), or build sharp against a libvips with libjxl');
    }
    const decoded = await require('sharp')(jxl).png({ compressionLevel: 6 }).toBuffer();
    return rebuildPng(decoded, stored, fields, md);
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
    const cached = cacheFileFor(n, dir);
    const cs = await statOrNull(cached);
    if (cs && cs.mtimeMs === loc.stat.mtimeMs) {
        notePngSize(n, loc.stat.mtimeMs, cs.size);
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
        notePngSize(n, loc.stat.mtimeMs, buf.length);
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
 * Whether the picture a JXL was made from carried a colour profile (sfMD's icc, else an iCCP chunk in its legacy
 * sfPN box). libvips reports an ICC profile for every JXL (the format always names its colour space), so a JXL's
 * own metadata cannot tell; unknown counts as yes.
 */
async function jxlOriginalHasIcc(jxlPath) {
    const known = pictureMeta.hasIcc(await fs.promises.readFile(jxlPath));
    return typeof known === 'boolean' ? known : true;
}

/**
 * The picture as JPEG XL with its text fields in the sfMD box (the download window, #1134): the stored file for
 * a JXL; a PNG is encoded losslessly now (cjxl effort 7, or sharp when cjxl is not installed). null when missing.
 */
async function jxlBytes(name, dir = IMAGES_DIR) {
    const loc = await locate(name, dir);
    if (!loc) return null;
    if (loc.kind === 'jxl') return fs.promises.readFile(loc.path);
    if (loc.kind !== 'png') return null;
    const png = await fs.promises.readFile(loc.path);
    let jxl = null;
    const tmp = path.join(CACHE_DIR, `.enc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.jxl`);
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    try {
        await run('cjxl', [loc.path, tmp, '-d', '0', '-e', '7', '--quiet']);
        jxl = await fs.promises.readFile(tmp);
    } catch (e) {
        if (!e || e.code !== 'ENOENT') throw e;
        const sharp = require('sharp');
        if (!(sharp.format.jxl && sharp.format.jxl.output && sharp.format.jxl.output.buffer)) {
            throw new Error('no JPEG XL encoder: install libjxl-tools (cjxl)');
        }
        jxl = await sharp(png).jxl({ lossless: true, effort: 7 }).toBuffer();
    } finally {
        fs.promises.unlink(tmp).catch(() => {});
    }
    return attachPngMetadata(jxl, png);
}

// effort for pictures written as they are made: fast on the save path (1024x1024 about 0.2 s, 62 % of the PNG);
// the nightly converter re-encodes them at effort 7 (56 %) when the host is idle
const WRITE_EFFORT = 3;

async function encodeLossless(pngBuf, effort) {
    const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tmpPng = path.join(CACHE_DIR, `.w-${stamp}.png`);
    const tmpJxl = path.join(CACHE_DIR, `.w-${stamp}.jxl`);
    await fs.promises.mkdir(CACHE_DIR, { recursive: true });
    try {
        await fs.promises.writeFile(tmpPng, pngBuf);
        await run('cjxl', [tmpPng, tmpJxl, '-d', '0', '-e', String(effort), '--quiet']);
        return await fs.promises.readFile(tmpJxl);
    } catch (e) {
        if (!e || e.code !== 'ENOENT') throw e;
        const sharp = require('sharp');
        if (!(sharp.format.jxl && sharp.format.jxl.output && sharp.format.jxl.output.buffer)) return null;
        return sharp(pngBuf).jxl({ lossless: true, effort }).toBuffer();
    } finally {
        fs.promises.unlink(tmpPng).catch(() => {});
        fs.promises.unlink(tmpJxl).catch(() => {});
    }
}

/**
 * Store a picture (Yukimi, Nov 24 2026: "after generating an image it directly writes the output as JPEG XL, never
 * PNG; PNG is only legacy"). buffer is the picture as made: a PNG, WebP or JPEG XL (#1156). Its text fields and
 * alpha stealth data are kept (lossless pixels, sfMD box). A JXL is stored as it is (its boxes kept, sfFT set); a
 * WebP / JPEG is encoded to JXL from its pixels with its fields; a PNG through cjxl, and its bytes go into the
 * decoded cache with the JXL's mtime, so whatever reads the new picture next as PNG gets it without a decode.
 * Writes x.jxl atomically and removes any x.png; a rewrite of an existing picture keeps its date created.
 * Resolves { path (the stored file), pngPath (a PNG file of it; null for a WebP / JXL input: ask pngPath(name)
 * only when a PNG is really needed), pixelPath (a file sharp reads), kind }. With no JPEG XL encoder on the host it
 * writes a PNG.
 */
async function writePicture(name, buffer, opts = {}) {
    const n = cleanName(name);
    if (!n || !(isPngName(n) || pictureIds.isId(n))) throw new Error('writePicture: a picture ID or a legacy gallery .png name is required');
    const fmt = pictureMeta.formatOf(buffer);
    if (!fmt) throw new Error('writePicture: not a PNG, WebP, JPEG XL or JPEG picture');
    if (fmt !== 'png') return writeOtherPicture(n, buffer, fmt, opts);
    const pngBuf = buffer;
    const dir = opts.dir || IMAGES_DIR;
    const pngP = path.join(dir, n);
    const jxlP = path.join(dir, jxlNameFor(n));
    const prior = locateSync(n, dir);
    const created = prior ? createdMsSync(n, dir) : null;
    const effort = opts.effort || WRITE_EFFORT;
    const jxl = await encodeLossless(pngBuf, effort);
    if (!jxl) {
        await fs.promises.writeFile(pngP, pngBuf);
        return { path: pngP, pngPath: pngP, pixelPath: pngP, kind: 'png' };
    }
    const now = Date.now();
    const boxed = attachPngMetadata(jxl, pngBuf, { birthtimeMs: created || now, mtimeMs: now, effort });
    const tmp = `${jxlP}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, boxed);
    await fs.promises.utimes(tmp, now / 1000, now / 1000);
    await fs.promises.rename(tmp, jxlP);
    if (prior && prior.kind === 'png') await fs.promises.unlink(pngP).catch(() => {});
    // the original PNG as this picture's decoded copy (valid while the JXL keeps this mtime)
    const cached = cacheFileFor(n, dir);
    try {
        await fs.promises.writeFile(cached + '.seed', pngBuf);
        await fs.promises.utimes(cached + '.seed', now / 1000, now / 1000);
        await fs.promises.rename(cached + '.seed', cached);
        notePngSize(n, now, pngBuf.length);
        if (cacheBytesKnown === null || (cacheBytesKnown += pngBuf.length) > CACHE_MAX_BYTES) void trimCache();
    } catch (_) {
        return { path: jxlP, pngPath: await pngPath(n, dir), pixelPath: await pixelPath(n, dir), kind: 'jxl' };
    }
    return { path: jxlP, pngPath: cached, pixelPath: sharpReadsJxl() ? jxlP : cached, kind: 'jxl' };
}

/** writePicture for a JXL (stored as it is) or a WebP / JPEG (encoded to JXL from its pixels, its fields kept). */
async function writeOtherPicture(n, buffer, fmt, opts) {
    const dir = opts.dir || IMAGES_DIR;
    const pngP = path.join(dir, n);
    const jxlP = path.join(dir, jxlNameFor(n));
    const prior = locateSync(n, dir);
    const created = prior ? createdMsSync(n, dir) : null;
    const now = Date.now();
    let jxl;
    let effort = opts.effort || 0;
    if (fmt === 'jxl') {
        // as it is: only its times change (the effort it was made at stays when it said one)
        const had = pictureMeta.jxlTimes(buffer);
        if (!effort && had && had.effort) effort = had.effort;
        jxl = buffer;
    } else {
        effort = effort || WRITE_EFFORT;
        const fields = pictureMeta.readFields(buffer);
        const icc = pictureMeta.hasIcc(buffer);
        const raw = await pictureMeta.rgba(buffer);
        try {
            jxl = await pictureMeta.encode(raw, fields, 'jxl', { effort, icc: typeof icc === 'boolean' ? icc : undefined });
        } catch (e) {
            if (!e || e.code !== 'NO_JXL_ENCODER') throw e;
            // no JPEG XL encoder on this host: a PNG of the pixels with the fields
            const png = await pictureMeta.encode(raw, fields, 'png');
            await fs.promises.writeFile(pngP, png);
            return { path: pngP, pngPath: pngP, pixelPath: pngP, kind: 'png' };
        }
    }
    const boxed = pictureMeta.jxlWithTimes(jxl, { birthtimeMs: created || now, mtimeMs: now, effort });
    const tmp = `${jxlP}.${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, boxed);
    await fs.promises.utimes(tmp, now / 1000, now / 1000);
    await fs.promises.rename(tmp, jxlP);
    if (prior && prior.kind === 'png') await fs.promises.unlink(pngP).catch(() => {});
    // an older decoded copy is stale (its mtime no longer matches); dropped now so the cache does not hold it
    fs.promises.unlink(cacheFileFor(n, dir)).catch(() => {});
    if (sizesMap().delete(n)) scheduleSizesSave();
    return { path: jxlP, pngPath: null, pixelPath: sharpReadsJxl() ? jxlP : null, kind: 'jxl' };
}

/**
 * The stored file's bytes as they are (a JPEG XL, or a legacy PNG), or null: for code that reads the picture's
 * fields or pixels in any format (pictureMeta / pngMetadata take both) and needs no PNG (#1156).
 */
async function readStored(name, dir = IMAGES_DIR) {
    const loc = await locate(name, dir);
    return loc ? fs.promises.readFile(loc.path) : null;
}

/**
 * The picture as lossless WebP, encoded from its pixels with no PNG step (#1156): what is sent to NovelAI (img2img
 * and inpaint sources, references, vibe encodes) and what a generation result reused from the gallery hands on.
 * opts.fields: true (default) keeps the picture's text fields (EXIF, NovelAI's layout); false sends bare pixels.
 * opts.effort: libwebp effort (default 0, the fastest lossless). null when missing.
 */
async function webpBytes(name, dir = IMAGES_DIR, opts = {}) {
    const buf = await readStored(name, dir);
    if (!buf) return null;
    const effort = opts.effort != null ? opts.effort : 0;
    let raw;
    if (pictureMeta.formatOf(buf) === 'jxl' && !sharpReadsJxl()) {
        raw = await pictureMeta.rgba(buf);
    } else {
        // the stored channels as they are (an opaque picture stays RGB)
        const out = await require('sharp')(buf).raw().toBuffer({ resolveWithObject: true });
        raw = { data: out.data, width: out.info.width, height: out.info.height, channels: out.info.channels };
    }
    const fields = opts.fields === false ? [] : pictureMeta.readFields(buf);
    return pictureMeta.encode(raw, fields, 'webp', { effort });
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
    fs.promises.unlink(cacheFileFor(n, dir)).catch(() => {});
    return removed;
}

/**
 * After a fresh x.png was written for a picture that was stored as x.jxl (a metadata rewrite, a new upscale over
 * an old one): the old JXL and its decoded copy go, so the disk does not hold the picture twice (#1152).
 */
async function dropStaleJxl(name, dir = IMAGES_DIR) {
    const n = cleanName(name);
    const j = n && jxlNameFor(n);
    if (!j) return false;
    let dropped = false;
    try { await fs.promises.unlink(path.join(dir, j)); dropped = true; } catch (_) { /* none */ }
    fs.promises.unlink(cacheFileFor(n, dir)).catch(() => {});
    if (sizesMap().delete(n)) scheduleSizesSave();
    return dropped;
}

/** Rename a picture in whatever form it is stored (`a.png` -> `b.png` moves `a.jxl` to `b.jxl`). */
async function rename(oldName, newName, dir = IMAGES_DIR) {
    const loc = await locate(oldName, dir);
    const nn = cleanName(newName);
    if (!loc || !nn) throw new Error('rename: picture not found or bad name');
    const target = loc.kind === 'jxl' ? path.join(dir, jxlNameFor(nn)) : path.join(dir, nn);
    await fs.promises.rename(loc.path, target);
    fs.promises.unlink(cacheFileFor(cleanName(oldName), dir)).catch(() => {});
    return target;
}

module.exports = {
    IMAGES_DIR,
    CACHE_DIR,
    BOX_TYPE,
    cleanName,
    jxlNameFor,
    logicalNames,
    isPictureName,
    upscaleNameFor,
    originalNameFor,
    locate,
    locateSync,
    exists,
    existsSync,
    pngPath,
    pixelPath,
    readSizeSync,
    jxlSizeFromHead,
    sharpReadsJxl,
    jxlOriginalHasIcc,
    readPng,
    readStored,
    webpBytes,
    writePicture,
    WRITE_EFFORT,
    jxlBytes,
    pngSize,
    knownPngSize,
    notePngSize,
    stat,
    remove,
    rename,
    dropStaleJxl,
    // the swap / converter and tests
    attachPngMetadata,
    readFileTimesSync,
    createdMsSync,
    readPngMetadataBox,
    readMetadataFields,
    rebuildPng,
    decodeJxlToPngBuffer,
    metadataChunks
};
