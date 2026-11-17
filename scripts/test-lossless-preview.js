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

    // a refused PNG is remembered by its mtime: an 8-bit file put in its place with the same mtime is still
    // refused (no header read), a changed mtime is looked at again
    const deep = path.join(imagesDir, 'deep.png');
    const deepTime = new Date(Math.floor(Date.now() / 1000) * 1000 - 30000); // whole ms: utimes round-trips it
    fs.utimesSync(deep, deepTime, deepTime);
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'deep@ll.webp'), null, '16-bit, again');
    fs.copyFileSync(path.join(imagesDir, 'a.png'), deep);
    fs.utimesSync(deep, deepTime, deepTime);
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'deep@ll.webp'), null, 'refusal remembered');
    const later = new Date(deepTime.getTime() + 5000);
    fs.utimesSync(deep, later, later);
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'deep@ll.webp'), path.join(previewsDir, 'deep@ll.webp'), 'a changed file is copied');
    // an unreadable PNG: refused too, and no temp file
    fs.writeFileSync(path.join(imagesDir, 'bad.png'), 'not a png');
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'bad@ll.webp'), null);
    assert.strictEqual(await pu.ensureLosslessPreview(imagesDir, previewsDir, 'bad@ll.webp'), null);
    assert.ok(!fs.readdirSync(previewsDir).some((f) => f.endsWith('.tmp')), 'no temp files left');

    // the boot orphan sweep (globalResources.syncPreviews) keeps a lossless preview while its PNG exists
    assert.strictEqual(pu.previewSweepBase('a@ll.webp'), 'a');
    assert.strictEqual(pu.previewSweepBase('a_upscaled@ll.webp'), 'a');
    assert.strictEqual(pu.previewSweepBase('a_upscaled@studio.webp'), 'a');
    assert.strictEqual(pu.previewSweepBase('a@fit.webp'), 'a');
    assert.strictEqual(pu.previewSweepBase('a@lq.webp'), 'a');
    assert.strictEqual(pu.previewSweepBase('a@2x.webp'), 'a');
    assert.strictEqual(pu.previewSweepBase('a.webp'), 'a');
    assert.strictEqual(pu.previewSweepBase('a.png'), null);
    // and removes an encode's temp file only when another process left it
    assert.strictEqual(pu.isStalePreviewTmp('a@ll.webp.1234.1700000000000.tmp', 99), true);
    assert.strictEqual(pu.isStalePreviewTmp(`a@ll.webp.${process.pid}.1700000000000.tmp`), false, 'our own: in progress');
    assert.strictEqual(pu.isStalePreviewTmp('a@ll.webp'), false);
    assert.strictEqual(pu.isStalePreviewTmp('notes.tmp', 99), false);
    const gr = fs.readFileSync(path.join(__dirname, '..', 'modules', 'globalResources.js'), 'utf8');
    assert.ok(/previewSweepBase\(preview\)/.test(gr) && /isStalePreviewTmp\(name\)/.test(gr), 'syncPreviews uses both helpers');

    fs.rmSync(root, { recursive: true, force: true });
    console.log('lossless preview: ok');
})().catch((e) => { console.error(e); process.exit(1); });
