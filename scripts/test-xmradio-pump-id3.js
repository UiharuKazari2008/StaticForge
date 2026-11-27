#!/usr/bin/env node
'use strict';
// A segment with an ID3 tag between two frames (SiriusXM's song change inside a segment) is good audio: the pump hands it
// on at once, with only the audio in .adts and the segment as it came in .plain (#1354: it was read as corrupt, which held
// the recording two minutes and dropped ten seconds, and a Monitor listener ran dry). A truncated one is still refused.
// No network: fetch is stubbed.
const assert = require('assert');
const { createPump, adtsAudio } = require('../modules/xmRadioPump');

const frame = (fill) => {
    const f = Buffer.alloc(64, fill);
    f[0] = 0xff; f[1] = 0xf1; f[2] = 0x50; f[3] = 0x80; f[4] = 8; f[5] = 0x1f; f[6] = 0xfc; // 64 bytes: (8 << 3) | 0
    return f;
};
const id3 = (text, footer = false) => {
    const body = Buffer.from(text);
    const head = Buffer.from([0x49, 0x44, 0x33, 4, 0, footer ? 0x10 : 0, 0, 0, (body.length >> 7) & 0x7f, body.length & 0x7f]);
    return Buffer.concat(footer ? [head, body, Buffer.alloc(10)] : [head, body]);
};
const audio = Buffer.concat([frame(1), frame(2), frame(3)]);
const mid = Buffer.concat([id3('timestamp'), frame(1), id3('TIT2 the next song ÿñ'.repeat(12)), frame(2), id3('f', true), frame(3)]);

assert.ok(adtsAudio(mid).equals(audio), 'tags between frames come out, the frames stay');
assert.ok(adtsAudio(Buffer.concat([audio, id3('trailing')])).equals(audio), 'a tag after the last frame');
assert.ok(adtsAudio(audio).equals(audio));
assert.strictEqual(adtsAudio(mid.subarray(0, mid.length - 5)), null, 'a cut-off last frame');
assert.strictEqual(adtsAudio(Buffer.concat([frame(1), id3('x'.repeat(40)).subarray(0, 30)])), null, 'a cut-off tag');
assert.strictEqual(adtsAudio(Buffer.concat([frame(1), Buffer.from('junk between frames'), frame(2)])), null, 'bytes that are neither');
assert.strictEqual(adtsAudio(id3('only a tag')), null, 'no audio at all');

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=256000\nvariant.m3u8\n';
const MEDIA = [
    '#EXTM3U', '#EXT-X-MEDIA-SEQUENCE:100',
    '#EXT-X-PROGRAM-DATE-TIME:2026-11-26T00:00:00.000Z', '#EXTINF:6.000,', 'seg100.aac',
    '#EXT-X-PROGRAM-DATE-TIME:2026-11-26T00:00:06.000Z', '#EXTINF:6.000,', 'seg101.aac', ''
].join('\n');
const text = (body) => Promise.resolve({ ok: true, status: 200, text: async () => body });
const fetched = [];
const realFetch = global.fetch;
global.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('master.m3u8')) return text(MASTER);
    if (u.endsWith('variant.m3u8')) return text(MEDIA);
    fetched.push(u);
    return { ok: true, status: 200, arrayBuffer: async () => mid };
};

const seen = [];
const gaps = [];
const pump = createPump({ channelId: 'ch', tune: async () => ({ url: 'https://x/master.m3u8' }), keyBytes: async () => Buffer.alloc(16), settings: () => ({ healthyBuffer: 0 }) });
pump.on('segment', (sg) => seen.push(sg));
pump.on('gap', (g) => gaps.push(g));

(async () => {
    pump.start({ back: 30 });
    for (let i = 0; i < 200 && !seen.length; i++) await new Promise((r) => setTimeout(r, 10));
    await pump.stop();
    assert.ok(seen.length >= 1, 'the segment was handed on');
    assert.ok(seen[0].adts.equals(audio), 'only audio for ffmpeg');
    assert.ok(seen[0].plain.equals(mid), 'the segment is kept as it came');
    assert.strictEqual(fetched.filter((u) => u.endsWith('seg100.aac')).length, 1, 'fetched once, never re-fetched');
    assert.strictEqual(pump.stats().refetches, 0);
    assert.strictEqual(gaps.length, 0);
    // a hole whose segment is held after all (fetched again by a resumed recording) is dropped on load; a real one stays
    const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'xmrec-'));
    const seg = (seq, pdt) => JSON.stringify({ seq, pdt, dur: 10, f: `s${seq}.aac` });
    require('fs').writeFileSync(require('path').join(dir, 'segs.ndjson'), [seg(1, 0), '{"gap":true,"from":10000,"to":20000}', seg(2, 10000.2), '{"gap":true,"from":20000,"to":40000}', seg(3, 20000), seg(5, 40000), '{"gap":true,"from":50000,"to":60000}', seg(7, 60000)].join('\n'));
    const disk = await require('../modules/xmRadioRecorder')._test.readRecDisk(dir);
    require('fs').rmSync(dir, { recursive: true, force: true });
    assert.deepStrictEqual(disk.gaps, [{ from: 20000, to: 40000 }, { from: 50000, to: 60000 }]);
    console.log('test-xmradio-pump-id3: ok');
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { global.fetch = realFetch; });
