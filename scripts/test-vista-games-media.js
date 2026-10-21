#!/usr/bin/env node
// Setup's games come off "installation media": one zip per game
// (scripts/build-vista-games-media.js), art and sound in lighter copies that Setup replaces. A zip
// that no longer matches its game's files would hand Setup stale art or code, so every listed
// hash must be its source's, each entry what pack.json says, and the list the game's current set.
// Fails with the command to rebuild.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const assert = require('assert');
const fflate = require('fflate');
const media = require('./build-vista-games-media.js');

const PUBLIC = path.join(__dirname, '..', 'public');
const manifest = media.featureManifest();
let checked = 0;
try {
    Object.keys(media.GAMES).forEach((id) => {
        const zipPath = path.join(PUBLIC, 'static_images/vista-games/media', id + '.zip');
        assert.ok(fs.existsSync(zipPath), id + '.zip is missing');
        const files = fflate.unzipSync(new Uint8Array(fs.readFileSync(zipPath)));
        const meta = JSON.parse(fflate.strFromU8(files['pack.json']));
        assert.deepStrictEqual(meta.files.map((f) => f.url).sort(), media.urlsFor(id, manifest), id + '.zip lists another file set');
        const listing = JSON.parse(fs.readFileSync(zipPath.replace(/\.zip$/, '.json'), 'utf8'));
        assert.deepStrictEqual(listing, meta, id + '.json is not the zip\'s pack.json');
        const sha = (data) => crypto.createHash('sha256').update(data).digest('hex');
        meta.files.forEach((f) => {
            const src = fs.readFileSync(path.join(PUBLIC, f.url));
            assert.strictEqual(sha(src), f.hash, id + '.zip was built from an old ' + f.url);
            const entry = files[f.entry];
            assert.ok(entry, id + '.zip entry for ' + f.url);
            // a lighter copy, or the file itself
            const want = f.lite || { hash: f.hash, size: src.byteLength };
            assert.strictEqual(sha(entry), want.hash, id + '.zip entry for ' + f.url + ' is not what pack.json says');
            assert.strictEqual(entry.byteLength, want.size);
            if (f.lite) assert.ok(f.lite.size < f.size, 'a lighter copy is lighter: ' + f.url);
            if (/\.(js|css|json|html)$/i.test(f.url)) assert.ok(!f.lite, 'code and data stay whole: ' + f.url);
            checked += 1;
        });
        // the full files behind the lighter copies
        const full = fflate.unzipSync(new Uint8Array(fs.readFileSync(zipPath.replace(/\.zip$/, '.full.zip'))));
        const fullMeta = JSON.parse(fflate.strFromU8(full['pack.json']));
        assert.deepStrictEqual(fullMeta.files.map((f) => f.url), meta.files.filter((f) => f.lite).map((f) => f.url), id + '.full.zip lists another set');
        fullMeta.files.forEach((f) => assert.strictEqual(sha(full[f.entry]), f.hash, id + '.full.zip entry for ' + f.url));
    });
} catch (err) {
    console.error('❌ ' + err.message + '\n   rebuild: node scripts/build-vista-games-media.js');
    process.exit(1);
}
console.log('vista games media: ' + Object.keys(media.GAMES).length + ' zips, ' + checked + ' files current');
