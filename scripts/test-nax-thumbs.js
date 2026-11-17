#!/usr/bin/env node
/**
 * GET /naxCache/<slug>/<file>?w=480 (#890 P13, modules/naxImageServer.js): a 480-px-wide WebP of the
 * cached original, aspect kept, made once and kept on disk, served immutable; without ?w (or another
 * width) the original as before.
 *   node scripts/test-nax-thumbs.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const express = require('express');
const sharp = require('sharp');
const { handleNaxImageRequest } = require('../modules/naxImageServer');

const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nax-thumbs-'));
const slug = 'test-gallery';
const file = 'pic_001.webp';

function get(port, url) {
    return new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: url }, (res) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(parts) }));
        }).on('error', reject);
    });
}

(async () => {
    const dir = path.join(cacheDir, 'nax_images', slug);
    fs.mkdirSync(dir, { recursive: true });
    const original = await sharp({ create: { width: 832, height: 1216, channels: 3, background: { r: 200, g: 40, b: 90 } } }).webp({ quality: 90 }).toBuffer();
    fs.writeFileSync(path.join(dir, file), original);
    const gr = {
        getNaxTagsDatabase: () => ({
            slugExists: (s) => s === slug,
            findTagByGalleryFilename: (s, f) => (s === slug && f === file ? { filename: file } : null)
        })
    };
    const app = express();
    app.get('/naxCache/:gallerySlug/:filename', (req, res) => handleNaxImageRequest(gr, req, res, cacheDir));
    const server = app.listen(0, '127.0.0.1');
    await new Promise((r) => server.on('listening', r));
    const port = server.address().port;

    // the original, as before
    let r = await get(port, `/naxCache/${slug}/${file}`);
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.equals(original));
    assert.strictEqual(r.headers['cache-control'], 'public, max-age=2592000');

    // two requests at once for the thumbnail share one encode
    const [a, b] = await Promise.all([get(port, `/naxCache/${slug}/${file}?w=480`), get(port, `/naxCache/${slug}/${file}?w=480`)]);
    for (const x of [a, b]) {
        assert.strictEqual(x.status, 200);
        assert.strictEqual(x.headers['content-type'], 'image/webp');
        assert.strictEqual(x.headers['cache-control'], 'public, max-age=31536000, immutable');
    }
    const meta = await sharp(a.body).metadata();
    assert.strictEqual(meta.format, 'webp');
    assert.strictEqual(meta.width, 480);
    assert.strictEqual(meta.height, Math.round((1216 * 480) / 832), 'aspect kept');
    assert.ok(a.body.length < original.length, 'smaller than the original');
    const thumbPath = path.join(dir, '.w480', `${file}.webp`);
    assert.ok(fs.existsSync(thumbPath), 'kept on disk');

    // the kept file is served (not encoded again)
    const before = fs.statSync(thumbPath).mtimeMs;
    r = await get(port, `/naxCache/${slug}/${file}?w=480`);
    assert.strictEqual(r.status, 200);
    assert.strictEqual(fs.statSync(thumbPath).mtimeMs, before);

    // another width: the original
    r = await get(port, `/naxCache/${slug}/${file}?w=123`);
    assert.ok(r.body.equals(original));
    // not in the dataset
    r = await get(port, `/naxCache/${slug}/nope.webp?w=480`);
    assert.strictEqual(r.status, 404);

    server.close();
    fs.rmSync(cacheDir, { recursive: true, force: true });
    console.log('nax thumbs: ok');
})().catch((e) => { console.error(e); process.exit(1); });
