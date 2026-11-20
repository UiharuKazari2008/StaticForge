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

// the quality switch: our master names only the variant nearest the position's bandwidth
const mst = ['#EXTM3U', '#EXT-X-INDEPENDENT-SEGMENTS',
    '#EXT-X-STREAM-INF:BANDWIDTH=128000,CODECS="mp4a.40.2"', '128k/128k_slide_long.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=32000,CODECS="mp4a.40.5"', '32k/32k_slide_long.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.5"', '64k/64k_slide_long.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=256000,CODECS="mp4a.40.2"', '256k/256k_slide_long.m3u8', ''].join('\n');
for (const [q, want] of [['hi', '256k/256k_slide_long.m3u8'], ['std', '128k/128k_slide_long.m3u8'], ['low', '32k/32k_slide_long.m3u8']]) {
    const lines = t.onlyVariant(mst, q).split('\n').filter((l) => l && !l.startsWith('#'));
    assert.deepStrictEqual(lines, [want], q);
}

// the pump: variant choice, media parsing (sequence, date-time, key and IV), ID3 stripped, AES-128-CBC
const pump = require('../modules/xmRadioPump')._test;
assert.strictEqual(pump.pickVariant(mst, 'https://h.streaming.siriusxm.com/v1/x', 'std'), 'https://h.streaming.siriusxm.com/v1/128k/128k_slide_long.m3u8');
const pm = pump.parseMedia(['#EXTM3U', '#EXT-X-MEDIA-SEQUENCE:5029', '#EXT-X-PROGRAM-DATE-TIME:2026-11-20T21:00:00.000Z',
    '#EXT-X-KEY:METHOD=AES-128,URI="https://api.edge-gateway.siriusxm.com/playback/key/v1/abc-123",IV=0x3F26F41B2651345FBB04BB8895367253',
    '#EXTINF:9.75,', 'a.aac', '#EXTINF:10,', 'b.aac'].join('\n'), 'https://h.streaming.siriusxm.com/v1/128k/x.m3u8');
assert.deepStrictEqual(pm.map((m) => [m.seq, m.pdt, m.dur]), [[5029, Date.parse('2026-11-20T21:00:00.000Z'), 9.75], [5030, Date.parse('2026-11-20T21:00:09.750Z'), 10]]);
assert.strictEqual(pm[1].url, 'https://h.streaming.siriusxm.com/v1/128k/b.aac');
assert.strictEqual(pm[0].iv.toString('hex'), '3f26f41b2651345fbb04bb8895367253');
const crypto = require('crypto');
const kk = crypto.randomBytes(16);
const id3 = Buffer.concat([Buffer.from('ID3'), Buffer.from([4, 0, 0, 0, 0, 0, 5]), Buffer.from('hello')]);
const audio = Buffer.from([0xff, 0xf1, 0x50, 0x80]);
const c = crypto.createCipheriv('aes-128-cbc', kk, pm[0].iv);
const enc = Buffer.concat([c.update(Buffer.concat([id3, audio])), c.final()]);
assert.ok(pump.stripId3(pump.decrypt(enc, kk, pm[0].iv, 5029)).equals(audio));

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
