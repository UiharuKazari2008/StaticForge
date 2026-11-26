#!/usr/bin/env node
'use strict';
// Lizumi S6 (Yozora #1252): the pump's buffer health. No SiriusXM network: fetch is stubbed and the media playlist is a fake
// that the test advances. Segments are real ADTS frames behind an ID3 tag, AES-128-CBC encrypted like SiriusXM's.
//   - the pump never fetches closer to the live edge than healthyBuffer whole segments
//   - a recording is 'buffering' until it holds healthyBuffer segments
//   - caught up (a stall at the live edge) it pauses, then carries on once the buffer refills, no seq skipped
//   - falling behind while catching up reports 'behind' (a deliberate reach-back does not), nothing is skipped
//   - a truncated segment is fetched again by the same URL and the accepted bytes equal the original
//   - audio that left the window before it was fetched is a gap with the right from/to
const assert = require('assert');
const crypto = require('crypto');
const { createPump } = require('../modules/xmRadioPump');

const T0 = Date.parse('2026-11-26T10:00:00.000Z');
const SEG = 6; // seconds
const pdtOf = (seq) => T0 + (seq - 100) * SEG * 1000;
const KEY = crypto.randomBytes(16);
const IV = Buffer.alloc(16, 7);

/** An ADTS frame (44.1 kHz, stereo, LC) of `len` bytes. */
function frame(len, fill) {
    const f = Buffer.alloc(len, fill);
    f[0] = 0xff; f[1] = 0xf1; f[2] = 0x50; f[3] = 0x80 | ((len >> 11) & 3); f[4] = (len >> 3) & 0xff; f[5] = ((len & 7) << 5) | 0x1f; f[6] = 0xfc;
    return f;
}
const id3 = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(0)]);
const audioOf = (seq) => Buffer.concat([frame(200, seq & 0xff), frame(300, (seq + 1) & 0xff), frame(150, (seq + 2) & 0xff)]);
const encOf = (seq) => { const c = crypto.createCipheriv('aes-128-cbc', KEY, IV); return Buffer.concat([c.update(Buffer.concat([id3, audioOf(seq)])), c.final()]); };

const MASTER = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=256000\nvariant.m3u8\n';
const rig = { lo: 100, hi: 109, shift: 0, segFail: new Map(), bodyFor: null, calls: [] }; // shift: ms the playlist's clock has jumped
const pdt = (seq) => pdtOf(seq) + rig.shift;
function media() {
    const out = ['#EXTM3U', `#EXT-X-MEDIA-SEQUENCE:${rig.lo}`, `#EXT-X-KEY:METHOD=AES-128,URI="key.bin",IV=0x${IV.toString('hex')}`];
    for (let q = rig.lo; q <= rig.hi; q++) out.push(`#EXT-X-PROGRAM-DATE-TIME:${new Date(pdt(q)).toISOString()}`, `#EXTINF:${SEG}.000,`, `seg${q}.aac`);
    return `${out.join('\n')}\n`;
}
const realFetch = global.fetch;
global.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('master.m3u8')) return { ok: true, status: 200, text: async () => MASTER };
    if (u.endsWith('variant.m3u8')) return { ok: true, status: 200, text: async () => media() };
    const m = /seg(\d+)\.aac$/.exec(u);
    if (!m) throw new Error(`unexpected ${u}`);
    const seq = Number(m[1]);
    rig.calls.push(seq);
    const fail = rig.segFail.get(seq);
    if (fail && fail.n > 0) {
        fail.n -= 1;
        if (fail.http) return { ok: false, status: fail.http };
        const full = encOf(seq);
        const body = full.subarray(0, fail.keep(full.length));
        return { ok: true, status: 200, headers: { get: (h) => (/content-length/i.test(h) && fail.declare ? String(full.length) : null) }, arrayBuffer: async () => body };
    }
    const full = encOf(seq);
    return { ok: true, status: 200, headers: { get: (h) => (/content-length/i.test(h) ? String(full.length) : null) }, arrayBuffer: async () => full };
};

let clock = T0;
const until = async (cond, what, ms = 4000) => {
    for (let i = 0; i < ms / 5 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(cond(), `timed out: ${what}`);
};
const settle = () => new Promise((r) => setTimeout(r, 60));
function make(settings = {}) {
    const p = createPump({
        channelId: 'ch', tune: async () => ({ url: 'https://x/master.m3u8' }), keyBytes: async () => KEY,
        settings: () => Object.assign({ healthyBuffer: 3, behindSeconds: 60, refetchRetries: 3 }, settings),
        now: () => clock, sleep: () => Promise.resolve(), pollMs: 5
    });
    const seen = [];
    const gaps = [];
    const events = [];
    p.on('segment', (s) => seen.push(s));
    p.on('gap', (g) => gaps.push(g));
    for (const e of ['pause', 'refetch', 'state']) p.on(e, (d) => events.push([e, d]));
    return { p, seen, gaps, events };
}
const reset = (lo, hi) => { rig.lo = lo; rig.hi = hi; rig.shift = 0; rig.segFail.clear(); rig.calls.length = 0; clock = T0 + (hi - 100) * SEG * 1000; };

(async () => {
    // 1. the healthy buffer: with ten segments in the playlist the newest three are never fetched
    reset(100, 109);
    let { p, seen, events } = make();
    p.start({ back: 3600 });
    await until(() => seen.length === 7, 'seven segments fetched');
    await settle();
    assert.deepStrictEqual(seen.map((s) => s.seq), [100, 101, 102, 103, 104, 105, 106], 'oldest first, contiguous');
    assert.ok(!rig.calls.some((q) => q > 106), 'no fetch inside the healthy buffer (107-109 untouched)');
    assert.ok(seen[0].adts.equals(audioOf(100)), 'the accepted bytes are the decrypted audio, ID3 stripped');
    assert.strictEqual(p.stats().bufferSegs, 3, 'bufferSegs: what is available beyond the position');
    assert.strictEqual(p.stats().behindS, 0, 'a position at the healthy edge is not behind');
    assert.strictEqual(p.stats().state, 'recording');
    await p.stop();
    console.log('ok 1 - never fetches inside the healthy buffer; bufferSegs and behindS read right');

    // 2. buffering at a live start, then recording once it holds healthyBuffer segments
    reset(100, 103);
    ({ p, seen, events } = make());
    p.start({ back: 0 });
    await settle();
    assert.strictEqual(seen.length, 0, 'at the live edge nothing is fetched until three newer segments exist');
    assert.strictEqual(p.stats().state, 'buffering');
    rig.hi = 105; // 103 is the live segment the start stood on: 104 and 105 are newer, still only two
    await settle();
    assert.strictEqual(seen.length, 0);
    rig.hi = 106;
    await until(() => seen.length === 1, 'the first segment once three newer ones exist');
    assert.strictEqual(seen[0].seq, 103);
    assert.strictEqual(p.stats().state, 'buffering', 'one segment held of three');
    rig.hi = 108;
    await until(() => seen.length === 3, 'three held');
    await settle();
    assert.strictEqual(p.stats().state, 'recording', 'recording once healthyBuffer segments are held');
    await p.stop();
    console.log('ok 2 - buffering until the buffer is healthy, then recording');

    // 3. caught up and the stream stalls: it pauses, waits for the buffer to refill, then continues with no skipped seq
    reset(100, 109);
    ({ p, seen, events } = make());
    p.start({ back: 3600 });
    await until(() => seen.length === 7, 'caught up');
    clock += 2 * SEG * 1000; // two segments of nothing new: still just jitter
    await settle();
    assert.strictEqual(p.stats().state, 'recording');
    clock += 2 * SEG * 1000; // more than two and a half segment lengths with nothing: SiriusXM stalled
    await until(() => p.stats().state === 'paused-refilling', 'paused');
    assert.strictEqual(p.stats().pauses, 1);
    assert.strictEqual(seen.length, 7, 'nothing taken while paused');
    rig.hi = 112; // 110, 111, 112: three more: 107 may go (three newer exist), the rest wait
    await until(() => seen.length === 10, 'resumes when the buffer is back');
    await settle();
    assert.strictEqual(seen.length, 10, 'the playlist has 13 segments: ten are fetchable');
    assert.deepStrictEqual(seen.map((s) => s.seq), [100, 101, 102, 103, 104, 105, 106, 107, 108, 109], 'every seq, in order, none skipped across the pause');
    assert.strictEqual(p.stats().state, 'recording');
    assert.strictEqual(p.stats().pauses, 1, 'one pause counted');
    assert.ok(events.some(([e]) => e === 'pause'), 'a pause event');
    await p.stop();
    console.log('ok 3 - pauses when the stream stalls, resumes when refilled, nothing skipped');

    // 4. falling behind while catching up reports "behind"; a deliberate reach-back does not; nothing is skipped either way
    reset(100, 109);
    ({ p, seen, events } = make({ behindSeconds: 30 }));
    p.start({ back: 3600 });
    await until(() => seen.length === 7, 'caught up (the reach-back was deliberate)');
    assert.notStrictEqual(p.stats().state, 'behind');
    rig.segFail.set(107, { n: 1000, http: 500 }); // the fetch of 107 stalls while the stream moves on
    rig.hi = 130;
    await until(() => p.stats().state === 'behind', 'behind');
    assert.ok(p.stats().behindS > 30, `behindS ${p.stats().behindS}`);
    rig.segFail.clear();
    await until(() => seen.length === 28, 'caught up again');
    assert.deepStrictEqual(seen.map((s) => s.seq), Array.from({ length: 28 }, (_, i) => 100 + i), 'still every seq, nothing skipped while behind');
    await settle();
    assert.strictEqual(p.stats().state, 'recording');
    await p.stop();
    // a deliberate reach-back that stalls partway is not "behind"
    reset(100, 160);
    rig.segFail.set(120, { n: 1000, http: 500 });
    ({ p, seen, events } = make({ behindSeconds: 30 }));
    p.start({ back: 3600 });
    await until(() => seen.length === 20, 'stalled partway through a reach-back');
    await settle();
    assert.notStrictEqual(p.stats().state, 'behind', 'a reach-back is deliberate, not behind');
    await p.stop();
    console.log('ok 4 - behind is reported when it falls behind, not during a reach-back; never skips');

    // 5. a truncated segment is fetched again by the same URL; the bytes that are accepted equal the original
    reset(200, 209);
    ({ p, seen, events } = make());
    rig.segFail.set(202, { n: 1, keep: (n) => n - 16, declare: true }); // fewer bytes than Content-Length declared
    rig.segFail.set(203, { n: 2, keep: (n) => n - 5, declare: false }); // no length declared: the AES block is cut
    rig.segFail.set(204, { n: 1, keep: () => 0, declare: false }); // an empty body
    p.start({ back: 3600 });
    await until(() => seen.length === 7, 'all fetchable fetched');
    await settle();
    assert.deepStrictEqual(seen.map((s) => s.seq), [200, 201, 202, 203, 204, 205, 206]);
    for (const s of seen) assert.ok(s.adts.equals(audioOf(s.seq)), `segment ${s.seq} is the original`);
    assert.strictEqual(rig.calls.filter((q) => q === 202).length, 2, '202 fetched twice');
    assert.strictEqual(rig.calls.filter((q) => q === 203).length, 3, '203 fetched three times');
    assert.strictEqual(p.stats().refetches, 4, 'refetches counted');
    assert.strictEqual(events.filter(([e]) => e === 'refetch').length, 4);
    await p.stop();
    // still bad after refetchRetries: the segment is not skipped, the next tick tries it again (it is still in the window)
    reset(300, 309);
    ({ p, seen, events } = make({ refetchRetries: 2 }));
    rig.segFail.set(303, { n: 4, keep: (n) => Math.floor(n / 2), declare: true });
    p.start({ back: 3600 });
    await until(() => seen.length === 7, 'the bad segment came good on a later tick');
    await settle();
    assert.deepStrictEqual(seen.map((s) => s.seq), [300, 301, 302, 303, 304, 305, 306], 'held up, never skipped');
    assert.ok(seen[3].adts.equals(audioOf(303)));
    assert.ok(rig.calls.filter((q) => q === 303).length >= 5, 'two ticks of three attempts, the last good');
    await p.stop();
    console.log('ok 5 - a truncated segment is refetched and its bytes equal the original; never skipped');

    // 6. a window jump (the wanted audio left SiriusXM's window): a gap with the right from/to
    reset(400, 409);
    ({ p, seen, events } = make());
    const gaps = [];
    p.on('gap', (g) => gaps.push(g));
    p.start({ back: 3600 });
    await until(() => seen.length === 7, 'first window fetched');
    const lastEnd = pdt(406) + SEG * 1000;
    rig.lo = 450; rig.hi = 459; // the playlist moved on: 407-449 left the window before they were fetched
    await until(() => seen.length === 14, 'carries on from what exists');
    await settle();
    assert.strictEqual(gaps.length, 1, 'one gap');
    assert.deepStrictEqual(gaps[0], { from: lastEnd, to: pdt(450) }, 'from where the audio stopped to the first segment available');
    assert.deepStrictEqual(seen.slice(7).map((s) => s.seq), [450, 451, 452, 453, 454, 455, 456]);
    await p.stop();
    // a recording that resumes (from: where its disk ends) finds that audio gone: a gap there too, not a silent skip
    reset(500, 509);
    ({ p, seen, events } = make());
    const gaps2 = [];
    p.on('gap', (g) => gaps2.push(g));
    const resumeAt = pdt(495) + SEG * 1000;
    p.start({ back: 0, from: resumeAt });
    await until(() => seen.length === 7, 'resumed at the oldest available');
    assert.deepStrictEqual(gaps2, [{ from: resumeAt, to: pdt(500) }]);
    assert.strictEqual(seen[0].seq, 500);
    await p.stop();
    // within a second of where it stands is not a gap (clock rounding)
    reset(600, 609);
    ({ p, seen, events } = make());
    const gaps3 = [];
    p.on('gap', (g) => gaps3.push(g));
    p.start({ back: 0, from: pdt(600) - 800 });
    await until(() => seen.length === 7, 'no gap for 800 ms');
    assert.strictEqual(gaps3.length, 0);
    await p.stop();
    console.log('ok 6 - a window jump emits a gap with the exact from/to, once; under a second is not a gap');

    // 7. the settings are read on every tick (the console changes them live)
    reset(700, 709);
    let hb = 3;
    const seen7 = [];
    const p7 = createPump({ channelId: 'ch', tune: async () => ({ url: 'https://x/master.m3u8' }), keyBytes: async () => KEY, settings: () => ({ healthyBuffer: hb }), now: () => clock, sleep: () => Promise.resolve(), pollMs: 5 });
    p7.on('segment', (s) => seen7.push(s));
    p7.start({ back: 3600 });
    await until(() => seen7.length === 7, 'three kept back');
    hb = 1;
    await until(() => seen7.length === 9, 'one kept back after the setting changed');
    await p7.stop();
    assert.strictEqual(seen7[seen7.length - 1].seq, 708);
    console.log('ok 7 - healthyBuffer is read live');
    console.log('test-xmradio-behind: ok');
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { global.fetch = realFetch; });
