/**
 * Picture metadata with no format assumed (Yozora #1156; Yukimi: "we dont want to leave any assumptions of png or
 * any requirements of png at any stages or functions"). A picture's text metadata is an ordered list of
 * [keyword, text] fields (NovelAI's Title, Description, Software, Source, Generation_time, Comment, plus whatever
 * else a picture carries), read from and written to:
 *
 * - PNG: tEXt / iTXt / zTXt chunks (written as tEXt, keyword Latin-1, text UTF-8 as pngMetadata always wrote).
 * - WebP: the EXIF chunk in NovelAI's own layout (big-endian TIFF). IFD0 holds DocumentName (0x010D) = Title,
 *   ImageDescription (0x010E) = Description, Software (0x0131) = Source (the model name, not "NovelAI"), and an
 *   Exif IFD pointer (0x8769); the Exif IFD holds UserComment (0x9286, UNDEFINED, "ASCII\0\0\0" + JSON). The JSON
 *   is every field as one object, keys sorted, compact separators, non-ASCII escaped (Python json.dumps with
 *   sort_keys and separators=(',', ':')): {"Comment":"...","Description":"...","Generation_time":"...",
 *   "Software":"NovelAI","Source":"...","Title":"..."}. It is the complete set, so it is what is read.
 * - JPEG XL: an `sfMD` box after the codestream, JSON { "v": 1, "fields": [[k, v], ...] } (optional "icc": whether
 *   the picture it was made from had a colour profile). Older files carry the PNG's raw chunks in `sfPN` instead
 *   (imageStore); they are read when there is no sfMD.
 * - JPEG: the same TIFF block in an APP1 "Exif" segment (when it fits in one segment).
 *
 * Pixels: rgba(buffer) gives raw RGBA for every format (sharp; djxl for JXL when sharp cannot read it), and
 * encode() writes them back losslessly (JPEG excepted) with the fields attached.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JXL_CONTAINER_SIG = Buffer.from([0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a]);
const MD_BOX = 'sfMD';
const MD_VERSION = 1;
const PN_BOX = 'sfPN';
const FT_BOX = 'sfFT';
const TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt']);
// NovelAI's PNG order (tEXt chunks of a real image): WebP EXIF JSON keys are sorted, so this restores it
const NAI_ORDER = ['Title', 'Description', 'Software', 'Source', 'Generation_time', 'Generation time', 'Comment'];

// imageStore requires this module: it is loaded lazily here
let storeMod = null;
const store = () => storeMod || (storeMod = require('./imageStore'));
let sharpMod = null;
const sharp = () => sharpMod || (sharpMod = require('sharp'));

function asBuffer(b) {
    if (Buffer.isBuffer(b)) return b;
    if (b instanceof Uint8Array) return Buffer.from(b.buffer, b.byteOffset, b.byteLength);
    return null;
}

/** 'png' | 'webp' | 'jxl' | 'jpeg' | null, from the leading bytes. */
function formatOf(buffer) {
    const b = asBuffer(buffer);
    if (!b || b.length < 4) return null;
    if (b.length >= 8 && b.subarray(0, 8).equals(PNG_SIG)) return 'png';
    if (b.length >= 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp';
    if (b[0] === 0xff && b[1] === 0x0a) return 'jxl';
    if (b.length >= 12 && b.subarray(0, 12).equals(JXL_CONTAINER_SIG)) return 'jxl';
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
    return null;
}

function normFields(fields) {
    const out = [];
    for (const f of fields || []) {
        if (!Array.isArray(f) || f.length < 2 || typeof f[0] !== 'string' || !f[0]) continue;
        const v = f[1];
        out.push([f[0], typeof v === 'string' ? v : v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v)]);
    }
    return out;
}

/** Fields as an object (a later field of the same keyword wins, as for PNG chunks read in order). */
function fieldsToObject(fields) {
    const o = {};
    for (const [k, v] of fields || []) o[k] = v;
    return o;
}

// ---------------------------------------------------------------------------------------------------------
// PNG

function pngChunks(buf) {
    const chunks = [];
    let off = 8;
    while (off + 12 <= buf.length) {
        const len = buf.readUInt32BE(off);
        const type = buf.toString('latin1', off + 4, off + 8);
        const end = off + 12 + len;
        if (end > buf.length) break;
        chunks.push({ type, data: buf.subarray(off + 8, off + 8 + len), raw: buf.subarray(off, end) });
        off = end;
        if (type === 'IEND') break;
    }
    return chunks;
}

function inflateAny(data) {
    try {
        return zlib.inflateSync(data);
    } catch (_) {
        return zlib.inflateRawSync(data);
    }
}

/** [keyword, text] of a tEXt / zTXt / iTXt chunk's data, or null. */
function decodeTextChunk(type, data) {
    try {
        const z = data.indexOf(0);
        if (z <= 0) return null;
        const kw = data.toString('latin1', 0, z);
        if (type === 'tEXt') return [kw, new TextDecoder('utf-8').decode(data.subarray(z + 1))];
        if (type === 'zTXt') return [kw, inflateAny(data.subarray(z + 2)).toString('utf8')];
        if (type === 'iTXt') {
            const flag = data[z + 1];
            let p = z + 3;
            const lang = data.indexOf(0, p);
            if (lang < 0) return null;
            const tk = data.indexOf(0, lang + 1);
            if (tk < 0) return null;
            p = tk + 1;
            const body = data.subarray(p);
            return [kw, (flag ? inflateAny(body) : body).toString('utf8')];
        }
    } catch (_) { /* unreadable chunk */ }
    return null;
}

function pngReadFields(buf) {
    const out = [];
    for (const c of pngChunks(buf)) {
        if (!TEXT_CHUNKS.has(c.type)) continue;
        const f = decodeTextChunk(c.type, c.data);
        if (f) out.push(f);
    }
    return out;
}

/** A whole tEXt chunk (length, type, data, crc): keyword Latin-1, text UTF-8 (as pngMetadata.insertTextChunk). */
function pngTextChunk(keyword, text) {
    const data = Buffer.concat([Buffer.from(keyword, 'latin1'), Buffer.from([0]), Buffer.from(String(text), 'utf8')]);
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write('tEXt', 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
}

function pngChunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
    return Buffer.concat([head, data, crc]);
}

/**
 * What a PNG carries besides its text, in neutral form, so a JXL keeps it (#1156: nothing is lost): its pixel
 * density (pHYs) as numbers and its eXIf block as the TIFF bytes; a JXL's are read from its sfMD box. {} for
 * WebP and JPEG (their EXIF is the fields).
 */
function extrasOf(buffer) {
    const b = asBuffer(buffer);
    const fmt = formatOf(b);
    if (fmt === 'jxl') {
        // a JXL keeps them in its sfMD box
        const md = readMd(b);
        const o = {};
        if (md && md.dpi) o.dpi = md.dpi;
        if (md && md.exif) o.exif = md.exif;
        return o;
    }
    if (fmt !== 'png') return {};
    const out = {};
    for (const c of pngChunks(b)) {
        if (c.type === 'pHYs' && c.data.length === 9) {
            out.dpi = { x: c.data.readUInt32BE(0), y: c.data.readUInt32BE(4), unit: c.data[8] };
        } else if (c.type === 'eXIf' && c.data.length) {
            out.exif = c.data.toString('base64');
        }
    }
    return out;
}

/** The extras as PNG chunks again (pHYs, eXIf), for a PNG made from a JXL. */
function extrasPngChunks(md) {
    const out = [];
    if (md && md.dpi && md.dpi.x > 0 && md.dpi.y > 0) {
        const d = Buffer.alloc(9);
        d.writeUInt32BE(md.dpi.x >>> 0, 0);
        d.writeUInt32BE(md.dpi.y >>> 0, 4);
        d[8] = md.dpi.unit ? 1 : 0;
        out.push(pngChunk('pHYs', d));
    }
    if (md && typeof md.exif === 'string' && md.exif) out.push(pngChunk('eXIf', Buffer.from(md.exif, 'base64')));
    return out;
}

/** The PNG with its text chunks replaced by tEXt chunks of the fields (where the first one was, else before IEND). */
function pngWithFields(buf, fields) {
    const text = normFields(fields).map(([k, v]) => pngTextChunk(k, v));
    const parts = [PNG_SIG];
    let placed = false;
    for (const c of pngChunks(buf)) {
        if (TEXT_CHUNKS.has(c.type)) {
            if (!placed) { parts.push(...text); placed = true; }
            continue;
        }
        if (c.type === 'IEND' && !placed) { parts.push(...text); placed = true; }
        parts.push(c.raw);
    }
    return Buffer.concat(parts);
}

function pngHasIcc(buf) {
    return pngChunks(buf).some((c) => c.type === 'iCCP');
}

// ---------------------------------------------------------------------------------------------------------
// EXIF (TIFF) in NovelAI's layout

const TIFF_TYPE_SIZE = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];

function parseTiff(t) {
    if (!t || t.length < 8) return null;
    const order = t.toString('latin1', 0, 2);
    if (order !== 'MM' && order !== 'II') return null;
    const le = order === 'II';
    const u16 = (o) => (le ? t.readUInt16LE(o) : t.readUInt16BE(o));
    const u32 = (o) => (le ? t.readUInt32LE(o) : t.readUInt32BE(o));
    if (u16(2) !== 42) return null;
    const readIfd = (off) => {
        const tags = new Map();
        if (!off || off + 2 > t.length) return tags;
        const n = u16(off);
        for (let i = 0; i < n; i++) {
            const p = off + 2 + i * 12;
            if (p + 12 > t.length) break;
            const tag = u16(p);
            const type = u16(p + 2);
            const count = u32(p + 4);
            const size = (TIFF_TYPE_SIZE[type] || 1) * count;
            const vo = size > 4 ? u32(p + 8) : p + 8;
            if (vo + size > t.length) continue;
            tags.set(tag, { type, count, value: t.subarray(vo, vo + size), ptr: u32(p + 8) });
        }
        return tags;
    };
    const ifd0 = readIfd(u32(4));
    const ep = ifd0.get(0x8769);
    const exif = ep ? readIfd(ep.ptr) : new Map();
    return { le, ifd0, exif };
}

function tiffAscii(v) {
    let end = v.length;
    while (end > 0 && v[end - 1] === 0) end--;
    return v.toString('utf8', 0, end);
}

function userCommentText(v, le) {
    if (v.length < 8) return null;
    const cs = v.toString('latin1', 0, 8);
    const body = v.subarray(8);
    if (cs.startsWith('UNICODE')) {
        if (le) return body.toString('utf16le').replace(/\0+$/, '');
        const sw = Buffer.from(body.subarray(0, body.length & ~1));
        sw.swap16();
        return sw.toString('utf16le').replace(/\0+$/, '');
    }
    return body.toString('utf8').replace(/\0+$/, '');
}

function orderNaiFields(obj) {
    const out = [];
    const seen = new Set();
    for (const k of NAI_ORDER) {
        if (Object.prototype.hasOwnProperty.call(obj, k)) { out.push([k, obj[k]]); seen.add(k); }
    }
    for (const k of Object.keys(obj)) if (!seen.has(k)) out.push([k, obj[k]]);
    return normFields(out);
}

/** Fields from a TIFF / EXIF block: the UserComment JSON (NovelAI: the complete set), else the IFD0 strings. */
function exifReadFields(tiff) {
    const t = parseTiff(tiff);
    if (!t) return [];
    const uc = t.exif.get(0x9286);
    const text = uc ? userCommentText(uc.value, t.le) : null;
    if (text) {
        try {
            const obj = JSON.parse(text);
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return orderNaiFields(obj);
        } catch (_) { /* a plain comment */ }
    }
    const out = [];
    const s = (tag) => { const e = t.ifd0.get(tag); return e && e.type === 2 ? tiffAscii(e.value) : null; };
    if (s(0x010d) != null) out.push(['Title', s(0x010d)]);
    if (s(0x010e) != null) out.push(['Description', s(0x010e)]);
    if (s(0x0131) != null) out.push(['Software', s(0x0131)]);
    if (text) out.push(['Comment', text]);
    return out;
}

/** JSON as Python json.dumps(obj, sort_keys=True, separators=(',', ':')) writes it (ASCII only). */
function naiJson(obj) {
    const sorted = {};
    for (const k of Object.keys(obj).sort()) sorted[k] = obj[k];
    return JSON.stringify(sorted).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}

/**
 * The TIFF block NovelAI writes into a WebP's EXIF chunk (big-endian): IFD0 DocumentName = Title,
 * ImageDescription = Description, Software = Source, Exif IFD pointer; Exif IFD UserComment = "ASCII\0\0\0" + the
 * fields as sorted compact JSON. Values follow their entries in order, unpadded (byte-identical to NovelAI's).
 */
function buildExif(fields) {
    const obj = fieldsToObject(normFields(fields));
    const ifd0 = [];
    const str = (tag, v) => { if (v != null) ifd0.push({ tag, type: 2, data: Buffer.concat([Buffer.from(v, 'utf8'), Buffer.from([0])]) }); };
    str(0x010d, obj.Title);
    str(0x010e, obj.Description);
    str(0x0131, obj.Source);
    const uc = Buffer.concat([Buffer.from('ASCII\0\0\0', 'latin1'), Buffer.from(naiJson(obj), 'utf8')]);
    const n0 = ifd0.length + 1;
    const ifd0Size = 2 + 12 * n0 + 4;
    let dataOff = 8 + ifd0Size;
    for (const e of ifd0) {
        if (e.data.length > 4) { e.off = dataOff; dataOff += e.data.length; }
    }
    const exifIfdOff = dataOff;
    const exifIfdSize = 2 + 12 + 4;
    const ucOff = exifIfdOff + exifIfdSize;
    const out = Buffer.alloc(ucOff + uc.length);
    out.write('MM', 0, 'latin1');
    out.writeUInt16BE(42, 2);
    out.writeUInt32BE(8, 4);
    out.writeUInt16BE(n0, 8);
    let p = 10;
    const entry = (tag, type, count, valueOrOff, inline) => {
        out.writeUInt16BE(tag, p);
        out.writeUInt16BE(type, p + 2);
        out.writeUInt32BE(count, p + 4);
        if (inline) inline.copy(out, p + 8);
        else out.writeUInt32BE(valueOrOff, p + 8);
        p += 12;
    };
    for (const e of ifd0) {
        if (e.data.length > 4) {
            entry(e.tag, 2, e.data.length, e.off);
            e.data.copy(out, e.off);
        } else {
            entry(e.tag, 2, e.data.length, 0, e.data);
        }
    }
    entry(0x8769, 4, 1, exifIfdOff);
    out.writeUInt32BE(0, p);
    p = exifIfdOff;
    out.writeUInt16BE(1, p);
    p += 2;
    entry(0x9286, 7, uc.length, ucOff);
    out.writeUInt32BE(0, p);
    uc.copy(out, ucOff);
    return out;
}

// ---------------------------------------------------------------------------------------------------------
// WebP

function riffChunks(buf) {
    const out = [];
    let off = 12;
    while (off + 8 <= buf.length) {
        const fourcc = buf.toString('latin1', off, off + 4);
        const len = buf.readUInt32LE(off + 4);
        if (off + 8 + len > buf.length) break;
        out.push({ fourcc, data: buf.subarray(off + 8, off + 8 + len) });
        off += 8 + len + (len & 1);
    }
    return out;
}

function riffChunk(fourcc, data) {
    const head = Buffer.alloc(8);
    head.write(fourcc, 0, 'latin1');
    head.writeUInt32LE(data.length, 4);
    return data.length & 1 ? Buffer.concat([head, data, Buffer.from([0])]) : Buffer.concat([head, data]);
}

function stripExifHeader(d) {
    return d.length >= 6 && d.toString('latin1', 0, 6) === 'Exif\0\0' ? d.subarray(6) : d;
}

function webpReadFields(buf) {
    const exif = riffChunks(buf).find((c) => c.fourcc === 'EXIF');
    return exif ? exifReadFields(stripExifHeader(exif.data)) : [];
}

/** Canvas size and alpha of a simple-format WebP (VP8L / VP8), for a VP8X header. */
function webpCanvas(chunks) {
    const l = chunks.find((c) => c.fourcc === 'VP8L');
    if (l && l.data.length >= 5 && l.data[0] === 0x2f) {
        const v = l.data.readUInt32LE(1);
        return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1, alpha: !!((v >>> 28) & 1) };
    }
    const v8 = chunks.find((c) => c.fourcc === 'VP8 ');
    if (v8 && v8.data.length >= 10) {
        return {
            width: v8.data.readUInt16LE(6) & 0x3fff,
            height: v8.data.readUInt16LE(8) & 0x3fff,
            alpha: chunks.some((c) => c.fourcc === 'ALPH')
        };
    }
    return null;
}

const IMAGE_FOURCC = new Set(['VP8 ', 'VP8L', 'ALPH', 'ANMF']);

/** The WebP with its EXIF chunk rebuilt from the fields (none when there are none) and VP8X's EXIF flag set. */
function webpWithFields(buf, fields) {
    const f = normFields(fields);
    let chunks = riffChunks(buf).filter((c) => c.fourcc !== 'EXIF');
    let vp8x = chunks.find((c) => c.fourcc === 'VP8X');
    if (!vp8x) {
        if (!f.length) return buf;
        const cv = webpCanvas(chunks);
        if (!cv) throw new Error('webp: no image data');
        const d = Buffer.alloc(10);
        d[0] = cv.alpha ? 0x10 : 0;
        d.writeUIntLE(cv.width - 1, 4, 3);
        d.writeUIntLE(cv.height - 1, 7, 3);
        vp8x = { fourcc: 'VP8X', data: d };
        chunks = [vp8x, ...chunks];
    } else {
        vp8x.data = Buffer.from(vp8x.data);
    }
    if (f.length) vp8x.data[0] |= 0x08;
    else vp8x.data[0] &= ~0x08;
    let at = -1;
    chunks.forEach((c, i) => { if (IMAGE_FOURCC.has(c.fourcc)) at = i; });
    if (f.length) chunks.splice(at + 1, 0, { fourcc: 'EXIF', data: buildExif(f) });
    const body = Buffer.concat([Buffer.from('WEBP', 'latin1'), ...chunks.map((c) => riffChunk(c.fourcc, c.data))]);
    const head = Buffer.alloc(8);
    head.write('RIFF', 0, 'latin1');
    head.writeUInt32LE(body.length, 4);
    return Buffer.concat([head, body]);
}

function webpHasIcc(buf) {
    const x = riffChunks(buf).find((c) => c.fourcc === 'VP8X');
    return !!(x && x.data[0] & 0x20);
}

// ---------------------------------------------------------------------------------------------------------
// JPEG

function jpegSegments(buf) {
    const segs = [];
    let off = 2;
    while (off + 4 <= buf.length && buf[off] === 0xff) {
        const marker = buf[off + 1];
        if (marker === 0xda || marker === 0xd9) break;
        const len = buf.readUInt16BE(off + 2);
        segs.push({ marker, start: off, end: off + 2 + len, data: buf.subarray(off + 4, off + 2 + len) });
        off += 2 + len;
    }
    return { segs, rest: off };
}

function isExifApp1(s) {
    return s.marker === 0xe1 && s.data.length >= 6 && s.data.toString('latin1', 0, 6) === 'Exif\0\0';
}

function jpegReadFields(buf) {
    const s = jpegSegments(buf).segs.find(isExifApp1);
    return s ? exifReadFields(s.data.subarray(6)) : [];
}

/** The JPEG with its Exif APP1 rebuilt from the fields (dropped when they do not fit one 64 KB segment). */
function jpegWithFields(buf, fields) {
    const f = normFields(fields);
    const { segs } = jpegSegments(buf);
    const kept = segs.filter((s) => !isExifApp1(s));
    let app1 = null;
    if (f.length) {
        const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), buildExif(f)]);
        if (payload.length + 2 <= 0xffff) {
            app1 = Buffer.alloc(4);
            app1[0] = 0xff;
            app1[1] = 0xe1;
            app1.writeUInt16BE(payload.length + 2, 2);
            app1 = Buffer.concat([app1, payload]);
        }
    }
    // after a JFIF APP0 when there is one, else first
    const parts = [buf.subarray(0, 2)];
    let placed = !app1;
    for (const s of kept) {
        if (!placed && s.marker !== 0xe0) { parts.push(app1); placed = true; }
        parts.push(buf.subarray(s.start, s.end));
    }
    if (!placed) parts.push(app1);
    const lastEnd = segs.length ? segs[segs.length - 1].end : 2;
    parts.push(buf.subarray(lastEnd));
    return Buffer.concat(parts);
}

function jpegHasIcc(buf) {
    return jpegSegments(buf).segs.some((s) => s.marker === 0xe2 && s.data.toString('latin1', 0, 11) === 'ICC_PROFILE');
}

// ---------------------------------------------------------------------------------------------------------
// JPEG XL boxes and sfMD

function jxlBoxes(jxl) {
    if (jxl.length < 12 || !jxl.subarray(0, 12).equals(JXL_CONTAINER_SIG)) return null;
    const boxes = [];
    let off = 0;
    while (off + 8 <= jxl.length) {
        let size = jxl.readUInt32BE(off);
        const type = jxl.toString('latin1', off + 4, off + 8);
        let head = 8;
        if (size === 1) { size = Number(jxl.readBigUInt64BE(off + 8)); head = 16; }
        if (size === 0) size = jxl.length - off;
        if (size < head || off + size > jxl.length) throw new Error('bad JXL box ' + type);
        boxes.push({ type, payload: jxl.subarray(off + head, off + size) });
        off += size;
    }
    return boxes;
}

function jxlBox(type, payload) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(8 + payload.length, 0);
    head.write(type, 4, 'latin1');
    return Buffer.concat([head, payload]);
}

/** The sfMD box payload: { v: 1, fields, icc? } as UTF-8 JSON. */
function encodeMdPayload(fields, icc, extras = null) {
    const o = { v: MD_VERSION, fields: normFields(fields) };
    if (typeof icc === 'boolean') o.icc = icc;
    if (extras && extras.dpi) o.dpi = extras.dpi;
    if (extras && extras.exif) o.exif = extras.exif;
    return Buffer.from(JSON.stringify(o), 'utf8');
}

/** The sfMD box of a JXL as { fields, icc }, or null when it has none. */
function readMd(jxl) {
    const boxes = jxlBoxes(jxl);
    const b = boxes && boxes.find((x) => x.type === MD_BOX);
    if (!b) return null;
    try {
        const o = JSON.parse(b.payload.toString('utf8'));
        if (!o || o.v !== MD_VERSION) return null;
        return { fields: normFields(o.fields), icc: typeof o.icc === 'boolean' ? o.icc : undefined, dpi: o.dpi || null, exif: o.exif || null };
    } catch (_) {
        return null;
    }
}

function jxlReadFields(jxl) {
    const md = readMd(jxl);
    if (md) return md.fields;
    let stored = null;
    try { stored = store().readPngMetadataBox(jxl); } catch (_) { stored = null; }
    if (!stored) return [];
    const out = [];
    for (const c of stored) {
        const type = c.raw.toString('latin1', 4, 8);
        if (!TEXT_CHUNKS.has(type)) continue;
        const f = decodeTextChunk(type, c.raw.subarray(8, c.raw.length - 4));
        if (f) out.push(f);
    }
    return out;
}

/** An sfPN payload with its text chunks taken out (null when nothing else is left). */
function sfpnWithoutText(payload) {
    if (!payload || payload[0] !== 1) return null;
    const parts = [payload.subarray(0, 1)];
    let off = 1;
    let any = false;
    while (off + 5 <= payload.length) {
        const len = payload.readUInt32BE(off + 1);
        const end = off + 1 + 12 + len;
        if (end > payload.length) break;
        const type = payload.toString('latin1', off + 5, off + 9);
        if (!TEXT_CHUNKS.has(type)) { parts.push(payload.subarray(off, end)); any = true; }
        off = end;
    }
    return any ? Buffer.concat(parts) : null;
}

/**
 * The JXL with its text fields in a new sfMD box (none when there are no fields and nothing else to say). Every
 * other box stays (sfFT included); a legacy sfPN box keeps only its non-text chunks (colour profile, pHYs).
 * opts.icc: whether the source picture had a colour profile (else the old sfMD's value is kept).
 */
function jxlWithFields(jxl, fields, opts = {}) {
    const f = normFields(fields);
    const boxes = jxlBoxes(jxl);
    const old = boxes ? readMd(jxl) : null;
    const icc = typeof opts.icc === 'boolean' ? opts.icc : old ? old.icc : undefined;
    // the extras (pixel density, EXIF) stay with the picture unless new ones are given
    const extras = opts.extras || (old ? { dpi: old.dpi, exif: old.exif } : null);
    const md = f.length || typeof icc === 'boolean' ? jxlBox(MD_BOX, encodeMdPayload(f, icc, extras)) : null;
    if (!boxes) {
        if (!md && !opts.times) return jxl;
        const ftyp = jxlBox('ftyp', Buffer.from('jxl \0\0\0\0jxl ', 'latin1'));
        return Buffer.concat([JXL_CONTAINER_SIG, ftyp, jxlBox('jxlc', jxl), ...(md ? [md] : []), ...(opts.times ? [timesBox(opts.times)] : [])]);
    }
    const kept = [];
    let pn = null;
    let ft = null;
    for (const b of boxes) {
        if (b.type === 'JXL ' || b.type === MD_BOX) continue;
        if (b.type === PN_BOX) { pn = sfpnWithoutText(b.payload); continue; }
        if (b.type === FT_BOX) { ft = b.payload; continue; }
        kept.push(jxlBox(b.type, b.payload));
    }
    const tail = [];
    if (pn) tail.push(jxlBox(PN_BOX, pn));
    if (md) tail.push(md);
    if (opts.times) tail.push(timesBox(opts.times));
    else if (ft) tail.push(jxlBox(FT_BOX, ft));
    return Buffer.concat([JXL_CONTAINER_SIG, ...kept, ...tail]);
}

/** An sfFT box: the picture's own date created / modified (and the effort it was encoded at). */
function timesBox(times) {
    const t = { b: Math.round(times.birthtimeMs || 0), m: Math.round(times.mtimeMs || 0) };
    if (typeof times.effort === 'number') t.e = times.effort; // e: the effort it was encoded at; 0 = not known (the nightly pass re-encodes it); no e = effort 7 (the Ruiko backlog)
    return jxlBox(FT_BOX, Buffer.from(JSON.stringify(t)));
}

/** The JXL with its sfFT box replaced (every other box kept as it is). */
function jxlWithTimes(jxl, times) {
    const boxes = jxlBoxes(jxl);
    if (!boxes) {
        const ftyp = jxlBox('ftyp', Buffer.from('jxl \0\0\0\0jxl ', 'latin1'));
        return Buffer.concat([JXL_CONTAINER_SIG, ftyp, jxlBox('jxlc', jxl), timesBox(times)]);
    }
    const kept = boxes.filter((b) => b.type !== 'JXL ' && b.type !== FT_BOX).map((b) => jxlBox(b.type, b.payload));
    return Buffer.concat([JXL_CONTAINER_SIG, ...kept, timesBox(times)]);
}

function jxlTimes(jxl) {
    const boxes = jxlBoxes(jxl);
    const b = boxes && boxes.find((x) => x.type === FT_BOX);
    if (!b) return null;
    try {
        const t = JSON.parse(b.payload.toString('utf8'));
        return { birthtimeMs: Number(t.b) || 0, mtimeMs: Number(t.m) || 0, effort: t.e === undefined ? null : Number(t.e) };
    } catch (_) {
        return null;
    }
}

function jxlHasIcc(jxl) {
    const md = readMd(jxl);
    if (md && typeof md.icc === 'boolean') return md.icc;
    let stored = null;
    try { stored = store().readPngMetadataBox(jxl); } catch (_) { stored = null; }
    if (stored) return stored.some((c) => c.raw.toString('latin1', 4, 8) === 'iCCP');
    return undefined;
}

// ---------------------------------------------------------------------------------------------------------
// the format-neutral API

/** The picture's text fields, in order: [[keyword, text], ...] ([] when it has none or the format is unknown). */
function readFields(buffer) {
    const b = asBuffer(buffer);
    switch (formatOf(b)) {
        case 'png': return pngReadFields(b);
        case 'webp': return webpReadFields(b);
        case 'jxl': return jxlReadFields(b);
        case 'jpeg': return jpegReadFields(b);
        default: return [];
    }
}

/** The same picture in the same format with its text fields replaced by these. */
function withFields(buffer, fields, opts = {}) {
    const b = asBuffer(buffer);
    switch (formatOf(b)) {
        case 'png': return pngWithFields(b, fields);
        case 'webp': return webpWithFields(b, fields);
        case 'jxl': return jxlWithFields(b, fields, opts);
        case 'jpeg': return jpegWithFields(b, fields);
        default: throw new Error('withFields: not a PNG, WebP, JPEG XL or JPEG picture');
    }
}

/** Whether the picture carries a colour profile (true / false), undefined when its format cannot tell. */
function hasIcc(buffer) {
    const b = asBuffer(buffer);
    switch (formatOf(b)) {
        case 'png': return pngHasIcc(b);
        case 'webp': return webpHasIcc(b);
        case 'jxl': return jxlHasIcc(b);
        case 'jpeg': return jpegHasIcc(b);
        default: return undefined;
    }
}

/** Raw RGBA pixels of a PNG, WebP, JPEG XL or JPEG: { data, width, height, channels: 4 }. */
async function rgba(buffer) {
    const b = asBuffer(buffer);
    let input = b;
    if (formatOf(b) === 'jxl' && !store().sharpReadsJxl()) input = await store().decodeJxlToPngBuffer(b);
    const { data, info } = await sharp()(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    return { data, width: info.width, height: info.height, channels: info.channels };
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

let cjxlMissing = false;

/** Lossless JPEG XL of raw pixels: cjxl from a PAM (no PNG step), sharp when cjxl is not installed. */
async function encodeJxlPixels(raw, effort) {
    const { data, width, height, channels } = raw;
    if (!cjxlMissing) {
        const dir = store().CACHE_DIR;
        const stamp = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const pam = path.join(dir, `.p-${stamp}.pam`);
        const out = path.join(dir, `.p-${stamp}.jxl`);
        const tuple = channels === 4 ? 'RGB_ALPHA' : channels === 3 ? 'RGB' : channels === 2 ? 'GRAYSCALE_ALPHA' : 'GRAYSCALE';
        const head = Buffer.from(`P7\nWIDTH ${width}\nHEIGHT ${height}\nDEPTH ${channels}\nMAXVAL 255\nTUPLTYPE ${tuple}\nENDHDR\n`, 'latin1');
        await fs.promises.mkdir(dir, { recursive: true });
        try {
            await fs.promises.writeFile(pam, Buffer.concat([head, data]));
            await run('cjxl', [pam, out, '-d', '0', '-e', String(effort), '--quiet']);
            return await fs.promises.readFile(out);
        } catch (e) {
            if (!e || e.code !== 'ENOENT') throw e;
            cjxlMissing = true;
        } finally {
            fs.promises.unlink(pam).catch(() => {});
            fs.promises.unlink(out).catch(() => {});
        }
    }
    const s = sharp();
    if (!(s.format.jxl && s.format.jxl.output && s.format.jxl.output.buffer)) {
        const err = new Error('no JPEG XL encoder: install libjxl-tools (cjxl)');
        err.code = 'NO_JXL_ENCODER';
        throw err;
    }
    return s(data, { raw: { width, height, channels } }).jxl({ lossless: true, effort }).toBuffer();
}

/**
 * Raw pixels ({ data, width, height, channels }) as a picture with the fields attached.
 * format 'jxl' (lossless; opts.effort, default imageStore.WRITE_EFFORT; opts.icc for the sfMD box), 'png'
 * (opts.png: sharp png options), 'webp' (lossless, opts.effort default 4; libwebp may change the colour of
 * fully transparent pixels: neither sharp 0.32 nor libvips 8.16 offers `exact`) or 'jpeg' (lossy, opts.quality
 * default 90, fields as EXIF when they fit).
 */
async function encode(raw, fields, format, opts = {}) {
    const { data, width, height, channels } = raw;
    const rawOpt = { raw: { width, height, channels } };
    switch (format) {
        case 'jxl': {
            const effort = opts.effort || store().WRITE_EFFORT;
            const jxl = await encodeJxlPixels(raw, effort);
            return jxlWithFields(jxl, fields, { icc: typeof opts.icc === 'boolean' ? opts.icc : false });
        }
        case 'png':
            return pngWithFields(await sharp()(data, rawOpt).png(opts.png || {}).toBuffer(), fields);
        case 'webp':
            return webpWithFields(await sharp()(data, rawOpt).webp({ lossless: true, effort: opts.effort != null ? opts.effort : 4 }).toBuffer(), fields);
        case 'jpeg':
            return jpegWithFields(await sharp()(data, rawOpt).jpeg({ quality: opts.quality || 90 }).toBuffer(), fields);
        default:
            throw new Error('encode: unknown format ' + format);
    }
}

module.exports = {
    MD_BOX,
    NAI_ORDER,
    formatOf,
    readFields,
    withFields,
    rgba,
    encode,
    hasIcc,
    fieldsToObject,
    normFields,
    extrasOf,
    extrasPngChunks,
    // pieces (imageStore, tests)
    buildExif,
    exifReadFields,
    pngTextChunk,
    pngReadFields,
    pngChunks,
    decodeTextChunk,
    jxlBoxes,
    readMd,
    jxlWithFields,
    jxlWithTimes,
    jxlTimes,
    encodeJxlPixels,
    riffChunks
};
