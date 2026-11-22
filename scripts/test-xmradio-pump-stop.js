#!/usr/bin/env node
'use strict';
// A recorder handoff stops pulling segments but lets the one on the wire land (Yukimi, Nov 22 2026). No network:
// fetch is stubbed and the first segment's body is a promise we release after stop() has been called.
const assert = require('assert');
const { createPump } = require('../modules/xmRadioPump');

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=256000\nvariant.m3u8\n';
const MEDIA = [
    '#EXTM3U', '#EXT-X-MEDIA-SEQUENCE:100',
    '#EXT-X-PROGRAM-DATE-TIME:2026-11-22T00:00:00.000Z', '#EXTINF:6.000,', 'seg100.aac',
    '#EXT-X-PROGRAM-DATE-TIME:2026-11-22T00:00:06.000Z', '#EXTINF:6.000,', 'seg101.aac',
    '#EXT-X-PROGRAM-DATE-TIME:2026-11-22T00:00:12.000Z', '#EXTINF:6.000,', 'seg102.aac', ''
].join('\n');
const ok = (body) => Promise.resolve({ ok: true, status: 200, text: async () => body, arrayBuffer: async () => Buffer.from(body) });
let release = null;
const body = new Promise((r) => { release = r; });
const fetched = [];
const realFetch = global.fetch;
global.fetch = async (url) => {
    const u = String(url);
    fetched.push(u);
    if (u.endsWith('master.m3u8')) return ok(MASTER);
    if (u.endsWith('variant.m3u8')) return ok(MEDIA);
    if (u.includes('seg')) return { ok: true, status: 200, arrayBuffer: async () => body };
    throw new Error(`unexpected ${u}`);
};

const seen = [];
const pump = createPump({ channelId: 'ch', tune: async () => ({ url: 'https://x/master.m3u8' }), keyBytes: async () => Buffer.alloc(16) });
pump.on('segment', (sg) => seen.push(sg));

(async () => {
    pump.start({ back: 0 });
    for (let i = 0; i < 200 && !fetched.some((u) => u.includes('seg')); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(fetched.some((u) => u.includes('seg')), 'a segment fetch started');

    let stopped = false;
    const p = pump.stop().then(() => { stopped = true; });
    await new Promise((r) => setTimeout(r, 10));
    assert.strictEqual(stopped, false, 'stop waits for the segment on the wire');
    release(Buffer.from('audio'));
    await p;
    assert.strictEqual(stopped, true);
    assert.strictEqual(seen.length, 1, 'the in-flight segment landed');
    const after = fetched.filter((u) => u.includes('seg')).length;
    await new Promise((r) => setTimeout(r, 60));
    assert.strictEqual(fetched.filter((u) => u.includes('seg')).length, after, 'no further segment is pulled after the stop');
    console.log('test-xmradio-pump-stop: ok');
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { global.fetch = realFetch; });
