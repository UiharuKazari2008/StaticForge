#!/usr/bin/env node
'use strict';
// XM Radio's server helpers (modules/xmRadio.js, Yozora #989): our copy of a SiriusXM playlist, the tune reply's
// stream address, handle masking. No network.
const assert = require('assert');
const { _test: t } = require('../modules/xmRadio');

// the stream's folder is mirrored: relative lines pass through, absolute ones in the folder are mapped, the key line
// goes to our key route, anything else stays as it is (and is never fetched)
const base = 'https://live-akc-prod-device.streaming.siriusxm.com/v1/';
const sid = 'feedfacefeedfacefeedface';
const media = [
    '#EXTM3U',
    '#EXT-X-TARGETDURATION:10',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://api.edge-gateway.siriusxm.com/playback/key/v1/efc21546-0b86-4b4c-ac8a-17981f0534cf",IV=0x3F26',
    '#EXTINF:9.75,',
    '128k/seg_0001.aac',
    'https://live-akc-prod-device.streaming.siriusxm.com/v1/128k/seg_0002.aac',
    '#EXT-X-MAP:URI="https://live-akc-prod-device.streaming.siriusxm.com/v1/init.mp4"',
    'https://evil.example.com/x.aac'
].join('\n');
const r = t.rewritePlaylist(sid, base, media).split('\n');
assert.strictEqual(r[2], `#EXT-X-KEY:METHOD=AES-128,URI="/api/xmradio/key/${sid}/efc21546-0b86-4b4c-ac8a-17981f0534cf",IV=0x3F26`);
assert.strictEqual(r[4], '128k/seg_0001.aac');
assert.strictEqual(r[5], `/api/xmradio/live/${sid}/m/128k/seg_0002.aac`);
assert.strictEqual(r[6], `#EXT-X-MAP:URI="/api/xmradio/live/${sid}/m/init.mp4"`);
assert.strictEqual(r[7], 'https://evil.example.com/x.aac');
assert.strictEqual(t.upstream(base, 'https://evil.example.com/a'), null);

// art keys become image-service addresses
assert.ok(t.imageUrl('aem/9b/x.jpeg').startsWith('https://imgsrv-sxm-prod-device.streaming.siriusxm.com/'));
assert.strictEqual(JSON.parse(Buffer.from(t.imageUrl('aem/9b/x.jpeg').split('/').pop(), 'base64').toString()).key, 'aem/9b/x.jpeg');

// the stream address anywhere in a tune reply; image servers are not streams
assert.strictEqual(t.findStreamUrl({ images: { u: 'https://imgsrv-sxm-prod-device.streaming.siriusxm.com/x' }, streams: [{ urls: [{ url: base + 'x' }] }] }), base + 'x');
assert.strictEqual(t.findStreamUrl({ a: 1 }), null);

assert.strictEqual(t.maskHandle('yukimi@example.com'), 'y•••••@example.com');
assert.strictEqual(t.maskHandle('ab'), 'ab');
assert.ok(t.jwtExp('x.' + Buffer.from(JSON.stringify({ exp: 100 })).toString('base64url') + '.y') === 100000);

// the one-time sign-in page: its address answers only its own code
const xm = require('../modules/xmRadio');
const { url } = xm.signInPageStart();
const code = url.split('/').pop();
assert.ok(/^http:\/\/127\.0\.0\.1:\d+\/xmradio-signin\/[0-9a-f]{48}$/.test(url));
assert.strictEqual(xm.account().browserSignIn.waiting, true);
xm.signInPageCancel();
assert.strictEqual(xm.account().browserSignIn, null);
assert.ok(code.length === 48);

console.log('xmradio: ok');
