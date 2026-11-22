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

// the Channel Guide's genres by a channel's own words (its page has none)
assert.strictEqual(t.classify('80s on 8', 'Pop hits from the MTV era'), 'Pop');
assert.strictEqual(t.classify('ESPN Radio', 'Sports talk around the clock'), 'Sports');
assert.strictEqual(t.classify('Octane', 'Hard rock, new and loud'), 'Rock');
assert.strictEqual(t.classify('BPM', 'Dance hits and remixes'), 'Dance & Electronic');
assert.strictEqual(t.classify('The Highway', 'New country hits'), 'Country');
assert.strictEqual(t.classify('CNN', 'News as it happens'), 'News');
assert.strictEqual(t.classify('Zzz', ''), 'Other');
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

// the cassette deck (modules/xmRadioRecorder.js): ADTS frames, cuts at whole frames on the stream's clock, timers,
// alerts and search terms
(async () => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const { execFileSync } = require('child_process');
    const R = require('../modules/xmRadioRecorder')._test;
    const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmrec-'));
    try {
        // 30 s of AAC at 44.1 kHz as three 10 s segments, each opening with an ID3 tag as SiriusXM's do
        execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30:sample_rate=44100', '-c:a', 'aac', '-b:a', '64k', '-f', 'adts', path.join(dir, 'all.aac')]);
        const all = fs.readFileSync(path.join(dir, 'all.aac'));
        const frames = R.adtsFrames(all);
        assert.ok(frames.length > 1280 && frames.every((f) => f.sr === 44100), `frames ${frames.length}`);
        const per = Math.round(10 * 44100 / 1024);
        const t0 = Date.parse('2026-11-20T21:00:00.000Z');
        const rec = { dir, segs: [] };
        for (let i = 0; i * per < frames.length; i++) {
            const fr = frames.slice(i * per, (i + 1) * per);
            const body = all.subarray(fr[0].off, fr[fr.length - 1].off + fr[fr.length - 1].len);
            fs.writeFileSync(path.join(dir, `s${i}.aac`), Buffer.concat([id3, body]));
            rec.segs.push({ seq: i, pdt: t0 + Math.round(i * per * 1024000 / 44100), dur: fr.length * 1024 / 44100, f: `s${i}.aac` });
        }
        // a cut from 4 s to 17.5 s: 13.5 s of frames, starting on the frame at or after 4 s
        const out = path.join(dir, 'cut.aac');
        const bytes = await R.sliceAac(rec, t0 + 4000, t0 + 17500, out);
        const got = R.adtsFrames(fs.readFileSync(out));
        assert.ok(bytes > 0 && Math.abs(got.length * 1024 / 44100 - 13.5) < 0.05, `cut ${got.length} frames`);
        const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).toString().trim());
        assert.ok(Math.abs(dur - 13.5) < 0.1, `cut lasts ${dur}`);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }

    // timers: the next start on a chosen weekday, a dated one once
    const fri = new Date(2026, 10, 20, 17, 0, 0).getTime(); // Friday Nov 20 2026, 17:00 local
    assert.strictEqual(new Date(R.nextStart({ start: '18:30', days: [5] }, fri)).getHours(), 18);
    assert.strictEqual(new Date(R.nextStart({ start: '08:00', days: [1] }, fri)).getDay(), 1);
    assert.strictEqual(R.nextStart({ start: '08:00', date: '2026-11-19' }, fri), null);
    assert.strictEqual(new Date(R.nextStart({ start: '08:00', date: '2026-11-21' }, fri)).getDate(), 21);

    assert.strictEqual(R.norm('Beyoncé & JAY-Z'), 'beyonce jay z');

    // Recently Played names the show that was on at the song's start, not the one that came after it
    const shows = [
        { at: 100000, name: 'Episode 1', show: 'Morning Show', dur: 1800 },
        { at: 140000, name: 'Episode 2', show: 'Noon Show', dur: 1800 }
    ];
    assert.strictEqual(t.showForSong(101000, shows).show, 'Morning Show');
    assert.strictEqual(t.showForSong(139000, shows).show, 'Morning Show');
    assert.strictEqual(t.showForSong(141000, shows).show, 'Noon Show');
    assert.strictEqual(t.showForSong(50000, shows), null);
    assert.strictEqual(t.showForSong(141000, shows.map((s) => ({ at: s.at, name: s.name, show: '' }))).name, 'Episode 2');
    console.log('xmradio: ok');
})().catch((err) => { console.error(err); process.exit(1); });
