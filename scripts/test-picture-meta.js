#!/usr/bin/env node
/**
 * Format-neutral picture metadata (#1156): modules/pictureMeta.js, pngMetadata on PNG / WebP / JPEG XL, imageStore's
 * sfMD box and writePicture for every format.
 *
 *   node scripts/test-picture-meta.js
 *
 * PICTURE_META_FIXTURES: a folder with real NovelAI output of one prompt and seed: nai-batch.png, nai-batch.webp,
 *   nai-stream.webp (default ~/.cache/claude-run/c1156/fixtures; the fixture checks are skipped without it).
 * PICTURE_META_OLD: a copy of pngMetadata.js from before #1156 (its requires pointing at this tree): every PNG result
 *   is compared byte for byte with it (skipped without it).
 * PICTURE_META_GALLERY: how many gallery pictures of each kind (PNG, JXL) to check, read-only (default 3).
 * Scratch files go to PICTURE_META_TMP (default ~/.cache/claude-run/c1156/test); images/ is never written.
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const pm = require('../modules/pictureMeta');
const store = require('../modules/imageStore');
const PngMetadata = require('../modules/pngMetadata');

const HOME = os.homedir();
const FIX = process.env.PICTURE_META_FIXTURES || path.join(HOME, '.cache/claude-run/c1156/fixtures');
const OLD = process.env.PICTURE_META_OLD || '';
const GALLERY_N = Number(process.env.PICTURE_META_GALLERY || 3);
const TMP = process.env.PICTURE_META_TMP || path.join(HOME, '.cache/claude-run/c1156/test');

// signing keys in memory (never secure.config.json)
const keys = crypto.generateKeyPairSync('ed25519');
const gr = {
    getSecureConfig: ({ path: p }) => (p === 'forgeSigning.privateKey'
        ? keys.privateKey.export({ type: 'pkcs8', format: 'pem' })
        : p === 'forgeSigning.publicKey' ? keys.publicKey.export({ type: 'spki', format: 'pem' }) : null),
    modifyConfig: () => { throw new Error('test must not persist keys'); },
    getPath: (n) => (n === 'images' ? store.IMAGES_DIR : path.join(TMP, n)),
    getPromptConfig: () => ({})
};
const meta = new PngMetadata(gr);
const old = OLD && fs.existsSync(OLD) ? new (require(OLD))(gr) : null;

let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed++; };
const eq = (a, b, what) => { assert.deepStrictEqual(a, b, what); passed++; };
const sameBuf = (a, b, what) => { assert.ok(Buffer.isBuffer(a) && Buffer.isBuffer(b) && a.equals(b), what); passed++; };
const log = (s) => console.log('  ' + s);

const PER_REQUEST = new Set(['Generation_time', 'Generation time']);
const stable = (fields) => fields.filter(([k]) => !PER_REQUEST.has(k));
const rgbOf = (raw) => {
    const out = Buffer.alloc(raw.width * raw.height * 3);
    for (let i = 0, o = 0; i < raw.width * raw.height; i++) {
        out[o++] = raw.data[i * 4]; out[o++] = raw.data[i * 4 + 1]; out[o++] = raw.data[i * 4 + 2];
    }
    return out;
};
const textChunkFields = (png) => pm.pngChunks(png).filter((c) => c.type === 'tEXt').map((c) => pm.decodeTextChunk('tEXt', c.data));
const commentOf = (buf) => meta.readMetadata(buf).tEXt.Comment;
const FORGE = { generation_type: 'generated', date_generated: 1764000000000, preset_name: 'test', input_prompt: '1girl' };

/** A copy with the stealth payload gone (alpha all 255), same RGB and fields, in the same format. */
async function withoutStealth(buf) {
    const raw = await pm.rgba(buf);
    const data = Buffer.from(raw.data);
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    return pm.encode({ ...raw, data }, pm.readFields(buf), pm.formatOf(buf));
}

/** Every PNG-returning / reading method of the old module against the new one on a PNG. */
async function comparePngWithOld(name, png) {
    if (!old) return;
    eq(meta.readMetadata(png), old.readMetadata(png), `${name}: readMetadata`);
    eq(await meta.readAnyMetadata(png), await old.readAnyMetadata(png), `${name}: readAnyMetadata`);
    eq(await meta.readStealthMetadata(png), await old.readStealthMetadata(png), `${name}: readStealthMetadata`);
    sameBuf(meta.insertTextChunk(png, 'Comment', '{"a": 1}'), old.insertTextChunk(png, 'Comment', '{"a": 1}'), `${name}: insertTextChunk`);
    sameBuf(meta.insertTextChunk(png, 'Extra', 'x'), old.insertTextChunk(png, 'Extra', 'x'), `${name}: insertTextChunk new keyword`);
    sameBuf(meta.updateMetadata(png, FORGE), old.updateMetadata(png, FORGE), `${name}: updateMetadata`);
    sameBuf(meta.stripPngTextChunks(png), old.stripPngTextChunks(png), `${name}: stripPngTextChunks`);
    sameBuf(meta.updateMetadataWithExisting(png, { x: 1 }), old.updateMetadataWithExisting(png, { x: 1 }), `${name}: updateMetadataWithExisting`);
    const target = old.stripPngTextChunks(png);
    sameBuf(meta.copyMetadataToImage(png, target, { generation_type: 'upscaled', upscale_ratio: 4 }),
        old.copyMetadataToImage(png, target, { generation_type: 'upscaled', upscale_ratio: 4 }), `${name}: copyMetadataToImage`);
    sameBuf(await meta.extractRgbBytes(png), await old.extractRgbBytes(png), `${name}: extractRgbBytes`);
    const outer = { Description: 'd', Software: 'NovelAI', Source: 's', 'Generation time': 1, Comment: '{"x": 1}' };
    sameBuf(await meta.writeStealthPngComp(png, outer), await old.writeStealthPngComp(png, outer), `${name}: writeStealthPngComp`);
    const e1 = await meta.ensureOriginCommentInStealth(png);
    const e0 = await old.ensureOriginCommentInStealth(png);
    sameBuf(e1.buffer, e0.buffer, `${name}: ensureOriginCommentInStealth buffer`);
    eq({ ...e1, buffer: null }, { ...e0, buffer: null }, `${name}: ensureOriginCommentInStealth result`);
    const r1 = await meta.restoreOriginCommentFromStealth(png);
    const r0 = await old.restoreOriginCommentFromStealth(png);
    sameBuf(r1.buffer, r0.buffer, `${name}: restoreOriginCommentFromStealth`);
    const f1 = await meta.finalizeWithForgeData(png, FORGE);
    const f0 = await old.finalizeWithForgeData(png, FORGE);
    sameBuf(f1, f0, `${name}: finalizeWithForgeData`);
    eq(await meta.verifyNovelAiSignature(png), await old.verifyNovelAiSignature(png), `${name}: verifyNovelAiSignature`);
    eq(await meta.verifyForgeSignature(f1), await old.verifyForgeSignature(f0), `${name}: verifyForgeSignature`);
    const s1 = await meta.extractMetadataSummary(png, 'x.png');
    const s0 = await old.extractMetadataSummary(png, 'x.png');
    eq(s1, s0, `${name}: extractMetadataSummary`);
}

/** pngMetadata on a WebP / JXL: same answers as the PNG of the same picture, output kept in its format. */
async function checkFormat(name, buf, fmt, expectFields, expectRgb, naiSigned) {
    eq(pm.formatOf(buf), fmt, `${name}: format`);
    if (expectFields) eq(stable(pm.readFields(buf)), stable(expectFields), `${name}: fields`);
    if (expectRgb) sameBuf(rgbOf(await pm.rgba(buf)), expectRgb, `${name}: RGB`);
    const m = meta.readMetadata(buf);
    ok(m.tEXt && typeof m.tEXt.Comment === 'string', `${name}: readMetadata Comment`);
    const st = await meta.readStealthMetadata(buf);
    ok(st && st.tEXt.Comment && st._encoding === 'LSB Alpha', `${name}: stealth readable`);
    if (naiSigned) {
        const v = await meta.verifyNovelAiSignature(buf);
        ok(v.ok, `${name}: NovelAI signature (${v.reason})`);
    }
    // insert / strip keep the format
    const ins = meta.insertTextChunk(buf, 'Comment', '{"a": 1}');
    eq(pm.formatOf(ins), fmt, `${name}: insertTextChunk keeps format`);
    eq(meta.readMetadata(ins).tEXt.Comment, '{"a": 1}', `${name}: insertTextChunk Comment`);
    eq(meta.readMetadata(ins).tEXt.Title, 'SI generated image', `${name}: insertTextChunk Title`);
    const stripped = meta.stripPngTextChunks(buf);
    eq(pm.formatOf(stripped), fmt, `${name}: strip keeps format`);
    eq(pm.readFields(stripped), [], `${name}: strip leaves no fields`);
    // finalize: stealth already there (no re-encode), forge_data signed, format kept
    const fin = await meta.finalizeWithForgeData(buf, FORGE);
    eq(pm.formatOf(fin), fmt, `${name}: finalize keeps format`);
    const vf = await meta.verifyForgeSignature(fin);
    ok(vf.ok, `${name}: forge signature (${vf.reason})`);
    ok(JSON.parse(commentOf(fin)).forge_data.preset_name === 'test', `${name}: finalize forge_data`);
    if (naiSigned) ok((await meta.verifyNovelAiSignature(fin)).ok, `${name}: NovelAI signature after finalize`);
    // copy metadata between formats keeps the target's format
    const copied = meta.copyMetadataToImage(fin, stripped, { generation_type: 'upscaled', upscale_ratio: 4 });
    eq(pm.formatOf(copied), fmt, `${name}: copyMetadataToImage keeps format`);
    eq(JSON.parse(commentOf(copied)).forge_data.upscale_ratio, 4, `${name}: copyMetadataToImage forge_data`);
    // restore from stealth
    const res = await meta.restoreOriginCommentFromStealth(fin);
    ok(res.restored && pm.formatOf(res.buffer) === fmt && commentOf(res.buffer) === st.tEXt.Comment, `${name}: restoreOriginCommentFromStealth`);
    // a path works like the bytes
    const p = path.join(TMP, `path-${name.replace(/\W+/g, '_')}.${fmt}`);
    await fs.promises.writeFile(p, buf);
    eq(meta.readMetadata(p), m, `${name}: readMetadata(path)`);
    eq(await meta.readStealthMetadata(p), st, `${name}: readStealthMetadata(path)`);
    // no stealth yet: finalize writes it, re-encoding losslessly in the same format
    const bare = await withoutStealth(buf);
    eq(await meta.readStealthMetadata(bare), null, `${name}: no stealth in the bare copy`);
    const fin2 = await meta.finalizeWithForgeData(bare, FORGE);
    eq(pm.formatOf(fin2), fmt, `${name}: finalize (stealth written) keeps format`);
    ok((await meta.verifyForgeSignature(fin2)).ok, `${name}: forge signature (stealth written)`);
    const st2 = await meta.readStealthMetadata(fin2);
    ok(st2 && st2.tEXt.Comment, `${name}: stealth written`);
    sameBuf(rgbOf(await pm.rgba(fin2)), rgbOf(await pm.rgba(buf)), `${name}: RGB unchanged by stealth`);
    const sum = await meta.extractMetadataSummary(buf, 'x');
    ok(sum.success && sum.content_type === { webp: 'image/webp', jxl: 'image/jxl' }[fmt], `${name}: extractMetadataSummary`);
}

async function fixtures() {
    if (!['nai-batch.png', 'nai-batch.webp', 'nai-stream.webp'].every((f) => fs.existsSync(path.join(FIX, f)))) {
        console.log(`fixtures: skipped (none in ${FIX})`);
        return;
    }
    console.log('fixtures');
    const png = fs.readFileSync(path.join(FIX, 'nai-batch.png'));
    const webp = fs.readFileSync(path.join(FIX, 'nai-batch.webp'));
    const stream = fs.readFileSync(path.join(FIX, 'nai-stream.webp'));
    const fPng = pm.readFields(png);
    eq(fPng.map((f) => f[0]), ['Title', 'Description', 'Software', 'Source', 'Generation_time', 'Comment'], 'PNG field order');
    eq(pm.readFields(webp).map((f) => f[0]), fPng.map((f) => f[0]), 'WebP fields in NovelAI PNG order');
    // batch PNG and WebP: every field equal but the per-request generation time
    eq(stable(pm.readFields(webp)), stable(fPng), 'WebP fields = PNG fields');
    const so = pm.fieldsToObject(pm.readFields(stream));
    const po = pm.fieldsToObject(fPng);
    for (const k of ['Description', 'Software', 'Source']) eq(so[k], po[k], `stream ${k}`);
    // the EXIF we write is NovelAI's, byte for byte; a WebP rewritten with its own fields is unchanged
    const exif = pm.riffChunks(webp).find((c) => c.fourcc === 'EXIF').data;
    sameBuf(pm.buildExif(pm.readFields(webp)), exif, 'EXIF rebuilt byte-identical');
    sameBuf(pm.withFields(webp, pm.readFields(webp)), webp, 'WebP withFields(own fields) unchanged');
    sameBuf(pm.withFields(png, fPng), png, 'PNG withFields(own fields) unchanged');
    eq(pm.readFields(pm.withFields(stream, pm.readFields(stream))), pm.readFields(stream), 'stream WebP fields round trip');
    log('fields and EXIF layout ok');

    const rawPng = await pm.rgba(png);
    const rgb = rgbOf(rawPng);
    sameBuf(rgbOf(await pm.rgba(webp)), rgb, 'batch WebP RGB = PNG RGB');
    sameBuf(rgbOf(await pm.rgba(stream)), rgb, 'stream WebP RGB = PNG RGB');

    // JXL from the WebP's pixels and fields (phase 2's path), and from the PNG through imageStore
    const rawWebp = await pm.rgba(webp);
    const jxlW = await pm.encode(rawWebp, pm.readFields(webp), 'jxl', { icc: false });
    sameBuf((await pm.rgba(jxlW)).data, rawWebp.data, 'JXL from WebP: RGBA lossless');
    eq(pm.readFields(jxlW), pm.readFields(webp), 'JXL from WebP: fields');
    const jxlP = store.attachPngMetadata(await pm.encodeJxlPixels(rawPng, 3), png);
    eq(pm.readFields(jxlP), fPng, 'JXL via attachPngMetadata(png): fields');
    ok(pm.readMd(jxlP) && pm.readMd(jxlP).icc === false, 'JXL via attachPngMetadata: icc false');
    ok(!pm.jxlBoxes(jxlP).some((b) => b.type === 'sfPN'), 'no sfPN in new files');
    eq(pm.readFields(store.attachPngMetadata(await pm.encodeJxlPixels(rawWebp, 3), webp)), pm.readFields(webp), 'attachPngMetadata(webp)');
    eq(pm.readFields(store.attachPngMetadata(await pm.encodeJxlPixels(rawWebp, 3), fPng)), fPng, 'attachPngMetadata(fields)');
    log('pixels identical across PNG / WebP / JXL');

    // pngMetadata per format
    await checkFormat('batch.webp', webp, 'webp', fPng, rgb, true);
    await checkFormat('stream.webp', stream, 'webp', null, rgb, true);
    await checkFormat('jxl-from-webp', jxlW, 'jxl', fPng, rgb, true);
    await checkFormat('jxl-from-png', jxlP, 'jxl', fPng, rgb, true);
    ok((await meta.verifyNovelAiSignature(png)).ok, 'batch.png NovelAI signature');
    log('pngMetadata on WebP and JXL ok');

    // extractNovelAIMetadata reads every format alike
    const pathPng = path.join(TMP, 'nai.png');
    const pathWebp = path.join(TMP, 'nai.webp');
    const pathJxl = path.join(TMP, 'nai.jxl');
    fs.writeFileSync(pathPng, png); fs.writeFileSync(pathWebp, webp); fs.writeFileSync(pathJxl, jxlP);
    const nP = await meta.extractNovelAIMetadata(pathPng);
    const nW = await meta.extractNovelAIMetadata(pathWebp);
    const nJ = await meta.extractNovelAIMetadata(pathJxl);
    eq({ ...nW, _encoding: null }, { ...nP, _encoding: null }, 'extractNovelAIMetadata WebP = PNG');
    eq({ ...nJ, _encoding: null }, { ...nP, _encoding: null }, 'extractNovelAIMetadata JXL = PNG');
    eq([nP._encoding, nW._encoding, nJ._encoding], ['JtEXt', 'EXIF', 'JXL'], 'encodings');

    await comparePngWithOld('batch.png', png);
    if (old) {
        eq(await meta.extractNovelAIMetadata(pathPng), await old.extractNovelAIMetadata(pathPng), 'batch.png: extractNovelAIMetadata');
        log('PNG results byte-identical to the old module');
    }

    // imageStore: rebuilt PNG of an sfMD-only JXL carries the same text chunks; writePicture for every format
    const decoded = await store.decodeJxlToPngBuffer(jxlP);
    eq(textChunkFields(decoded), fPng, 'rebuilt PNG text chunks = fields');
    ok((await meta.verifyNovelAiSignature(decoded)).ok, 'rebuilt PNG NovelAI signature');
    eq(await store.readMetadataFields(jxlP), fPng, 'readMetadataFields(buffer)');
    eq(await store.readMetadataFields(pathJxl), fPng, 'readMetadataFields(path)');
    const dir = path.join(TMP, 'gallery');
    await fs.promises.mkdir(dir, { recursive: true });
    for (const [n, buf] of [['w-png.png', png], ['w-webp.png', webp], ['w-jxl.png', jxlW]]) {
        const r = await store.writePicture(n, buf, { dir });
        eq(r.kind, 'jxl', `writePicture ${n}: stored as JXL`);
        const stored = fs.readFileSync(r.path);
        ok(store.readFileTimesSync(r.path), `writePicture ${n}: sfFT`);
        eq(stable(pm.readFields(stored)), stable(pm.readFields(buf)), `writePicture ${n}: fields`);
        sameBuf((await pm.rgba(stored)).data, (await pm.rgba(buf)).data, `writePicture ${n}: pixels`);
        eq(await store.jxlOriginalHasIcc(r.path), false, `writePicture ${n}: no colour profile`);
        const rebuilt = await store.readPng(n, dir);
        eq(textChunkFields(rebuilt), pm.readFields(buf), `writePicture ${n}: PNG copy text chunks`);
    }
    // a JXL is stored as it is: every box but sfFT unchanged
    const kept = pm.jxlBoxes(fs.readFileSync(path.join(dir, 'w-jxl.jxl'))).filter((b) => b.type !== 'sfFT');
    eq(kept.map((b) => b.type), pm.jxlBoxes(jxlW).map((b) => b.type), 'writePicture JXL keeps its boxes');
    log('imageStore ok');
}

async function roundTrips() {
    console.log('encode round trips');
    const w = 97; const h = 61;
    const data = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        data[i * 4] = (i * 37) & 255; data[i * 4 + 1] = (i * 91 + 13) & 255; data[i * 4 + 2] = (i * 7) & 255;
        data[i * 4 + 3] = 128 + (i % 128); // no fully transparent pixel: libwebp may recolour those
    }
    const raw = { data, width: w, height: h, channels: 4 };
    const fields = [['Title', 'T'], ['Description', 'a prompt, ünïcode ✓'], ['Software', 'NovelAI'], ['Source', 'S'],
        ['Generation_time', '1.5'], ['Comment', JSON.stringify({ prompt: 'x', note: 'ü' })], ['Extra', 'e']];
    for (const fmt of ['jxl', 'png', 'webp']) {
        const buf = await pm.encode(raw, fields, fmt);
        eq(pm.formatOf(buf), fmt, `${fmt}: format`);
        sameBuf((await pm.rgba(buf)).data, data, `${fmt}: RGBA lossless`);
        eq(pm.readFields(buf), fields, `${fmt}: fields`);
        const again = pm.withFields(buf, [['Comment', 'c']]);
        eq(pm.readFields(again), [['Comment', 'c']], `${fmt}: withFields replaces`);
        sameBuf((await pm.rgba(again)).data, data, `${fmt}: withFields keeps pixels`);
        eq(pm.readFields(pm.withFields(buf, [])), [], `${fmt}: withFields([])`);
    }
    const jpg = await pm.encode(raw, fields, 'jpeg');
    eq(pm.formatOf(jpg), 'jpeg', 'jpeg: format');
    eq(pm.readFields(jpg), fields, 'jpeg: fields as EXIF');
    // a bare JXL codestream gets a container with sfMD
    const bare = await pm.encodeJxlPixels(raw, 1);
    ok(pm.jxlBoxes(bare) === null, 'bare codestream');
    eq(pm.readFields(pm.withFields(bare, fields)), fields, 'bare JXL withFields');
    log('jxl / png / webp lossless with fields; jpeg fields');
}

async function gallery() {
    if (!GALLERY_N) return;
    console.log('gallery (read-only)');
    const names = fs.readdirSync(store.IMAGES_DIR).sort();
    const pngs = [];
    const jxls = [];
    for (const n of names) {
        if (pngs.length < GALLERY_N && /\.png$/i.test(n) && !n.startsWith('.')) {
            const b = fs.readFileSync(path.join(store.IMAGES_DIR, n));
            if (pm.formatOf(b) === 'png' && meta.readMetadata(b).tEXt?.Comment) pngs.push([n, b]);
        } else if (jxls.length < GALLERY_N && /\.jxl$/i.test(n)) {
            jxls.push([n, fs.readFileSync(path.join(store.IMAGES_DIR, n))]);
        }
        if (pngs.length >= GALLERY_N && jxls.length >= GALLERY_N) break;
    }
    for (const [n, png] of pngs) {
        await comparePngWithOld(n, png);
        // the same picture as JXL and WebP reads the same
        const raw = await pm.rgba(png);
        const jxl = store.attachPngMetadata(await pm.encodeJxlPixels(raw, 1), png);
        const webp = await pm.encode(raw, pm.readFields(png), 'webp', { effort: 0 });
        for (const [k, b] of [['jxl', jxl], ['webp', webp]]) {
            // NovelAI's WebP layout keeps the fields in its own order (sorted JSON in UserComment): the same set,
            // in NovelAI's order, for a picture whose PNG had another; JXL keeps the order exactly
            const order = (f) => (k === 'webp' ? [...f].sort((x, y) => String(x[0]).localeCompare(String(y[0]))) : f);
            eq(order(pm.readFields(b)), order(pm.readFields(png)), `${n} as ${k}: fields`);
            eq(meta.readMetadata(b).tEXt, meta.readMetadata(png).tEXt, `${n} as ${k}: readMetadata tEXt`);
            eq(await meta.readStealthMetadata(b), await meta.readStealthMetadata(png), `${n} as ${k}: stealth`);
        }
        log(`${n}: ok`);
    }
    for (const [n, jxl] of jxls) {
        // a legacy sfPN JXL reads like its rebuilt PNG
        const png = await store.decodeJxlToPngBuffer(jxl);
        const a = meta.readMetadata(jxl);
        const b = meta.readMetadata(png);
        eq([a.tEXt, a._encoding], [b.tEXt, b._encoding], `${n}: readMetadata = rebuilt PNG`);
        eq(await meta.readStealthMetadata(jxl), await meta.readStealthMetadata(png), `${n}: stealth = rebuilt PNG`);
        sameBuf(await meta.extractRgbBytes(jxl), await meta.extractRgbBytes(png), `${n}: RGB = rebuilt PNG`);
        eq(pm.readFields(jxl), pm.readFields(png), `${n}: fields = rebuilt PNG`);
        // rewritten with its own fields: sfMD, sfPN keeps only its non-text chunks, same text after a rebuild
        const moved = pm.withFields(jxl, pm.readFields(jxl));
        eq(pm.readFields(moved), pm.readFields(jxl), `${n}: sfMD fields`);
        const left = store.readPngMetadataBox(moved) || [];
        ok(!left.some((c) => /^(tEXt|iTXt|zTXt)$/.test(c.raw.toString('latin1', 4, 8))), `${n}: sfPN without text`);
        eq(textChunkFields(await store.decodeJxlToPngBuffer(moved)), pm.readFields(jxl), `${n}: rebuilt text after move`);
        if (a.tEXt?.Comment && (await meta.readStealthMetadata(jxl))) {
            const fin = await meta.finalizeWithForgeData(jxl, FORGE);
            eq(pm.formatOf(fin), 'jxl', `${n}: finalize keeps JXL`);
            ok((await meta.verifyForgeSignature(fin)).ok, `${n}: forge signature`);
        }
        log(`${n}: ok`);
    }
}

(async () => {
    await fs.promises.mkdir(TMP, { recursive: true });
    try {
        await roundTrips();
        await fixtures();
        await gallery();
        if (!old) console.log(`(no old module at PICTURE_META_OLD: PNG byte-identity not compared)`);
        console.log(`test-picture-meta: ${passed} checks passed`);
    } finally {
        await fs.promises.rm(TMP, { recursive: true, force: true }).catch(() => {});
        // the per-folder decoded copies writePicture / readPng made for the scratch gallery
        const tag = crypto.createHash('sha1').update(path.resolve(path.join(TMP, 'gallery'))).digest('hex').slice(0, 12);
        await fs.promises.rm(path.join(store.CACHE_DIR, `d-${tag}`), { recursive: true, force: true }).catch(() => {});
    }
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
