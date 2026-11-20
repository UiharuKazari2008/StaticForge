'use strict';

/**
 * Glancewell's Fix (Windows Photo Gallery's Fix pane, Yozora #446) saving a fixed print.
 *
 *   overwrite   the print's file takes the fixed pixels. Its PNG text chunks (the prompt, seed and parameters)
 *               carry over, and the first original is kept for Revert to Original, as Photo Gallery keeps
 *               originals.
 *   copy        a new print next to it in the same workspace, with the same text chunks (<name>_fixed.png).
 *
 * Originals live in <cache>/glancewell-originals/<filename>. Revert copies the original back and removes it.
 * The previews are made again, the database row is read again from the file (size, dimensions, md5), and the
 * gallery hears about it like any other change.
 */

const fs = require('fs');
const path = require('path');

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TEXT_CHUNKS = new Set(['tEXt', 'iTXt', 'zTXt']);
const MAX_BYTES = 120 * 1024 * 1024;

function isPng(buf) {
    return Buffer.isBuffer(buf) && buf.length > 33 && buf.subarray(0, 8).equals(PNG_SIG);
}

/** The text chunks of a PNG, whole (length, type, data, CRC), in file order. */
function textChunks(buf) {
    const out = [];
    if (!isPng(buf)) return out;
    let p = 8;
    while (p + 12 <= buf.length) {
        const len = buf.readUInt32BE(p);
        const type = buf.toString('latin1', p + 4, p + 8);
        const end = p + 12 + len;
        if (end > buf.length) break;
        if (TEXT_CHUNKS.has(type)) out.push(buf.subarray(p, end));
        if (type === 'IEND') break;
        p = end;
    }
    return out;
}

/** The fixed PNG with the original's text chunks after its IHDR (and none of its own). */
function withTextChunks(fixed, chunks) {
    if (!isPng(fixed)) throw new Error('The fixed picture is not a PNG');
    const parts = [fixed.subarray(0, 8)];
    let p = 8;
    let placed = false;
    while (p + 12 <= fixed.length) {
        const len = fixed.readUInt32BE(p);
        const type = fixed.toString('latin1', p + 4, p + 8);
        const end = p + 12 + len;
        if (end > fixed.length) throw new Error('The fixed picture is cut short');
        if (!TEXT_CHUNKS.has(type)) parts.push(fixed.subarray(p, end));
        if (type === 'IHDR' && !placed) { parts.push(...chunks); placed = true; }
        if (type === 'IEND') break;
        p = end;
    }
    return Buffer.concat(parts);
}

function safeName(filename) {
    const base = path.basename(String(filename || ''));
    if (!base || base !== String(filename) || !/\.png$/i.test(base)) throw new Error('Not a print');
    return base;
}

function originalsDir(gr) {
    const d = path.join(gr.getPath('cache'), 'glancewell-originals');
    fs.mkdirSync(d, { recursive: true });
    return d;
}

async function remakePreviews(gr, filename) {
    const { generateMobilePreviews } = require('./previewUtils');
    const imagesDir = gr.getPath('images');
    const base = path.basename(filename, path.extname(filename));
    // previews made on first ask (Studio's, the lossless one) are dropped and made again from the new pixels
    const previewsDir = path.resolve(__dirname, '../.previews');
    for (const suffix of ['@studio.webp', '@ll.webp', '@fit.webp']) {
        try { await fs.promises.unlink(path.join(previewsDir, `${base}${suffix}`)); } catch (_) { /* none */ }
    }
    const res = await generateMobilePreviews(path.join(imagesDir, filename), base);
    const db = gr.getMetadataDatabase();
    if (res && res.blurhash) await db.setImageBlurhash(filename, res.blurhash);
    // the row is read again from the file (size, dimensions, md5 differ)
    await db.getImageMetadata(filename, imagesDir);
}

/**
 * Save fixed pixels for a print. buffer: the fixed picture as PNG. Returns { filename, mode, hasOriginal }.
 */
async function saveFixed(gr, { filename, buffer, mode, workspaceId }) {
    const name = safeName(filename);
    if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_BYTES) throw new Error('No picture to save');
    const imagesDir = gr.getPath('images');
    const src = path.join(imagesDir, name);
    const original = await fs.promises.readFile(src);
    const out = withTextChunks(buffer, textChunks(original));
    if (mode === 'overwrite') {
        const keep = path.join(originalsDir(gr), name);
        try { await fs.promises.access(keep); } catch (_) { await fs.promises.writeFile(keep, original); }
        const tmp = `${src}.glancewell-${process.pid}.tmp`;
        await fs.promises.writeFile(tmp, out);
        await fs.promises.rename(tmp, src);
        await remakePreviews(gr, name);
        return { filename: name, mode, hasOriginal: true };
    }
    if (mode === 'copy') {
        const base = path.basename(name, '.png').replace(/_fixed(_\d+)?$/, '');
        let next = `${base}_fixed.png`;
        for (let n = 2; fs.existsSync(path.join(imagesDir, next)); n++) next = `${base}_fixed_${n}.png`;
        await fs.promises.writeFile(path.join(imagesDir, next), out);
        await remakePreviews(gr, next);
        gr.getWorkspaceManager().addToWorkspaceArray('files', next, workspaceId || 'default');
        return { filename: next, mode, hasOriginal: false };
    }
    throw new Error(`Unknown save mode ${mode}`);
}

async function hasOriginal(gr, filename) {
    try { await fs.promises.access(path.join(originalsDir(gr), safeName(filename))); return true; } catch (_) { return false; }
}

/** Revert to Original: the kept original goes back over the print. */
async function revert(gr, filename) {
    const name = safeName(filename);
    const keep = path.join(originalsDir(gr), name);
    const original = await fs.promises.readFile(keep);
    const src = path.join(gr.getPath('images'), name);
    const tmp = `${src}.glancewell-${process.pid}.tmp`;
    await fs.promises.writeFile(tmp, original);
    await fs.promises.rename(tmp, src);
    await fs.promises.unlink(keep);
    await remakePreviews(gr, name);
    return { filename: name };
}

/**
 * Options > Original Pictures: "Move originals to Recycle Bin after" (0 = Never). Kept originals older than that are
 * removed (they are the server's own copies; the print itself stays). Returns how many went.
 */
async function sweepOriginals(gr, days) {
    const d = Number(days) || 0;
    if (d <= 0) return 0;
    const dir = originalsDir(gr);
    const cutoff = Date.now() - d * 86400000;
    let n = 0;
    for (const name of await fs.promises.readdir(dir)) {
        const p = path.join(dir, name);
        try {
            const st = await fs.promises.stat(p);
            if (st.isFile() && st.mtimeMs < cutoff) { await fs.promises.unlink(p); n++; }
        } catch (_) { /* gone */ }
    }
    return n;
}

module.exports = { saveFixed, revert, hasOriginal, sweepOriginals, textChunks, withTextChunks };
