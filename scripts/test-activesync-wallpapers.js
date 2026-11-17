#!/usr/bin/env node
/**
 * The phones' wallpapers on the server (#827 / #890, modules/activeSyncWallpapers.js): /hashes lists
 * every stored kind (sha1 for files, "path:<path>" for paths), unchanged pictures are not written
 * again, "same:<kind>" copies another kind's picture, and an unchanged set neither rewrites
 * index.json nor counts as a change.
 *   node scripts/test-activesync-wallpapers.js
 */
'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const w = require('../modules/activeSyncWallpapers');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-wallpapers-'));
const gr = { getPath: () => root };
const DEV = 'a1b2c3d4e5f60718';
const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const jpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
const url = (type, buf) => `data:image/${type};base64,${buf.toString('base64')}`;
const sha1 = (b) => crypto.createHash('sha1').update(b).digest('hex');
const dir = path.join(root, 'activesync-wallpapers', DEV);

// a picture, a path, and a copy of the picture
let out = w.storeDetailed(gr, DEV, { inner: url('png', png), cover: 'same:inner', external: '/static_images/wall/a.jpg', screen: 'inner' });
assert.strictEqual(out.changed, true);
assert.deepStrictEqual(out.unchanged, []);
assert.deepStrictEqual(w.hashes(gr, DEV), { inner: sha1(png), cover: sha1(png), external: 'path:/static_images/wall/a.jpg' }, 'paths are listed too');
assert.ok(out.wallpapers.inner.startsWith(`/api/activesync/wallpapers/${DEV}/inner?v=`));
assert.strictEqual(out.wallpapers.external, '/static_images/wall/a.jpg');
assert.ok(fs.readFileSync(path.join(dir, 'cover.png')).equals(png), 'same:<kind> stored the picture');
const indexAt = fs.statSync(path.join(dir, 'index.json')).mtimeMs;
const stamp = w.stampOf(gr, DEV);

// the same set again: nothing written, no change, every kind sent listed as unchanged
out = w.storeDetailed(gr, DEV, { inner: url('png', png), cover: 'same:inner', external: '/static_images/wall/a.jpg', screen: 'inner' });
assert.strictEqual(out.changed, false);
assert.deepStrictEqual(out.unchanged.sort(), ['cover', 'external', 'inner']);
assert.strictEqual(fs.statSync(path.join(dir, 'index.json')).mtimeMs, indexAt, 'index.json not rewritten');
assert.strictEqual(w.stampOf(gr, DEV), stamp, 'the stamp did not move');

// only one kind sent (the service's own): the others stay
out = w.storeDetailed(gr, DEV, { androidInner: url('jpeg', jpg) });
assert.strictEqual(out.changed, true);
assert.strictEqual(w.hashes(gr, DEV).androidInner, sha1(jpg));
assert.strictEqual(w.hashes(gr, DEV).external, 'path:/static_images/wall/a.jpg');

// a kind cleared, a path changed
out = w.storeDetailed(gr, DEV, { cover: null, external: '/static_images/wall/b.jpg' });
const h = w.hashes(gr, DEV);
assert.ok(!('cover' in h), 'cleared');
assert.strictEqual(h.external, 'path:/static_images/wall/b.jpg');
assert.ok(!fs.existsSync(path.join(dir, 'cover.png')), 'its file went');

// a page whose kinds are all paths: a server that lost the set says so ({}), one that has it lists them
const DEV2 = 'b1b2c3d4e5f60718';
assert.deepStrictEqual(w.hashes(gr, DEV2), {}, 'nothing stored: empty');
w.storeDetailed(gr, DEV2, { inner: '/static_images/wall/x.jpg', external: '/static_images/wall/y.jpg' });
assert.deepStrictEqual(w.hashes(gr, DEV2), { inner: 'path:/static_images/wall/x.jpg', external: 'path:/static_images/wall/y.jpg' });
fs.rmSync(path.join(root, 'activesync-wallpapers', DEV2), { recursive: true, force: true });
assert.deepStrictEqual(w.hashes(gr, DEV2), {}, 'lost: empty again');

fs.rmSync(root, { recursive: true, force: true });
console.log('activesync wallpapers: ok');
