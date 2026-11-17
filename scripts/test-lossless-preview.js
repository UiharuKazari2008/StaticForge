#!/usr/bin/env node
/**
 * /previews/<stem>@ll.webp (#890 P14, modules/previewUtils.js ensureLosslessPreview): a lossless WebP
 * of images/<stem>.png with exactly its pixels (alpha kept), made once and kept; none (404, the page
 * loads the PNG) for a missing PNG, a 16-bit one, or one with an embedded colour profile.
 *   node scripts/test-lossless-preview.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const pu = require('../modules/previewUtils');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lossless-preview-'));
const imagesDir = path.join(root, 'images');
const previewsDir = path.join(root, 'previews');
fs.mkdirSync(imagesDir);
fs.mkdirSync(previewsDir);

(async () => {
    // a noisy RGBA picture with see-through parts (no flat colour a lossy encoder could get right by luck)
    const w = 96; const h = 64;
    const px = Buffer.alloc(w * h * 4);
    for (let i = 0; i < w * h; i++) {
        px[i * 4] = (i * 37) & 255; px[i * 4 + 1] = (i * 91 + 13) & 255; px[i * 4 + 2] = (i * 7) & 255;
        px[i * 4 + 3] = i % 5 === 0 ? 128 : 255;
    }
    await sharp(px, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(imagesDir, 'a.png'));
    assert.strictEqual(pu.losslessPreviewNameForFile('a.png'), 'a@ll.webp');
    assert.strictEqual(pu.isLosslessPreviewName('a@ll.webp'), true);
    assert.strictEqual(pu.isLosslessPreviewName('a@lq.webp'), false);

    const [p1, p2] = await Promise.all([
        pu.ensureLosslessPreview(imagesDir, previewsDir, 'a@ll.webp'),
        pu.ensureLosslessPreview(imagesDir, previewsDir, 'a@ll.webp')
    ]);
    assert.strictEqual(p1, path.join(previewsDir, 'a@ll.webp'));
    assert.strictEqual(p2, p1, 'one encode for both');
    const meta = await sharp(p1).metadata();
    assert.strictEqual(meta.format, 'webp');
    assert.strictEqual(meta.hasAlpha, true, 'alpha kept');
    const a = await sharp(path.join(imagesDir, 'a.png')).ensureAlpha().raw().toBuffer();
    const b = await sharp(p1).ensureAlpha().raw().toBuffer();
    assert.ok(a.equals(b), 'pixel-identical');

    // kept: asked again, the same file
    const mtime = fs.statSync(p1).mtimeMs;
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'a@ll.webp'), p1);
    assert.strictEqual(fs.statSync(p1).mtimeMs, mtime);
    // a PNG newer than its copy: made again
    fs.writeFileSync(p1, 'stale');
    const earlier = new Date(Date.now() - 60000);
    fs.utimesSync(p1, earlier, earlier);
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'a@ll.webp'), p1);
    assert.ok((await sharp(p1).ensureAlpha().raw().toBuffer()).equals(a), 'remade after the PNG changed');

    // none: no PNG, a 16-bit PNG, a PNG with a colour profile, a name that is no lossless preview
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'missing@ll.webp'), null);
    await sharp(px, { raw: { width: w, height: h, channels: 4 } }).toColourspace('rgb16').png().toFile(path.join(imagesDir, 'deep.png'));
    assert.strictEqual((await sharp(path.join(imagesDir, 'deep.png')).metadata()).depth, 'ushort');
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'deep@ll.webp'), null, '16-bit: the PNG');
    await sharp(px, { raw: { width: w, height: h, channels: 4 } }).withMetadata({ icc: 'p3' }).png().toFile(path.join(imagesDir, 'p3.png'));
    if ((await sharp(path.join(imagesDir, 'p3.png')).metadata()).icc) {
        assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'p3@ll.webp'), null, 'a colour profile: the PNG');
    }
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'a.webp'), null);
    assert.ok(!fs.readdirSync(previewsDir).some((f) => f.endsWith('.tmp')), 'no temp files left');

    fs.rmSync(root, { recursive: true, force: true });
    console.log('lossless preview: ok');
})().catch((e) => { console.error(e); process.exit(1); });
