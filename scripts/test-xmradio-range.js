#!/usr/bin/env node
'use strict';
// Recently Played's one-tap Record (xmradio_rec_range): a song from the stream's five-hour buffer is filed as one
// tagged m4a, even though lookAround no longer holds the cut. No SiriusXM network, a stubbed pump and real ffmpeg.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const EventEmitter = require('events');

const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmrange-'));
const account = path.join(dir, 'xmradio-account.json');
fs.writeFileSync(account, '{}');
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=30:sample_rate=44100', '-c:a', 'aac', '-b:a', '64k', '-f', 'adts', path.join(dir, 'all.aac')]);
const all = fs.readFileSync(path.join(dir, 'all.aac'));
const recorder = require('../modules/xmRadioRecorder');
const { adtsFrames } = recorder._test;
const frames = adtsFrames(all);
const per = Math.round(10 * 44100 / 1024);
const id3 = Buffer.concat([Buffer.from('ID3\x03\x00\x00\x00\x00\x00\x00'), Buffer.alloc(64)]);
const chunks = [];
for (let i = 0; i < 2; i++) {
    const f = frames.slice(i * per, (i + 1) * per);
    chunks.push(Buffer.concat([id3, all.subarray(f[0].off, f[f.length - 1].off + f[f.length - 1].len)]));
}
const dur = frames.length * 1024 / 44100 / 3;

// the pump would read the buffer behind live; here it hands the three prepared segments to the recorder
const pump = require('../modules/xmRadioPump');
let from = 0;
pump.createPump = () => {
    const e = new EventEmitter();
    e.start = () => { setTimeout(() => chunks.forEach((plain, i) => e.emit('segment', { seq: 100 + i, pdt: from - 8000 + i * dur * 1000, dur, plain })), 10); };
    e.stop = () => {};
    return e;
};
const CHANNEL = 'abcd1234abcd1234abcd1234';
recorder.init({
    accountFilePath: () => account,
    channelById: (id) => (id === CHANNEL ? { name: 'The Spectrum', number: 22 } : null),
    nowPlayingCuts: () => [], watch: () => {}, onLook: () => {}, imageUrlFor: () => ''
}, null, { resumeMs: 1e9 });

(async () => {
    from = Date.now() - 200000;
    const to = from + 12000;
    await assert.rejects(() => recorder.recordRange(CHANNEL, { from: 1, to: 2 }), /five-hour buffer/);
    await assert.rejects(() => recorder.recordRange('nope', { from, to }), /No such channel/);
    const r = await recorder.recordRange(CHANNEL, { from, to, a: 'Some Artist', t: 'Some Song', s: 'The Evening Show', ik: '' });
    assert.strictEqual(r.queued, false, 'a free recorder starts the song at once');
    assert.ok(r.rid, 'a recorder id comes back');
    const rec = recorder._test.recs.get(r.rid);
    assert.strictEqual(rec.meta.kind, 'song');
    assert.strictEqual(rec.meta.mode, 'range');
    assert.strictEqual(rec.meta.endPdt, to, 'the range stops at the song end, not on a wall-clock timer');
    for (let i = 0; i < 200 && !rec.meta.filed; i++) await new Promise((ok) => setTimeout(ok, 25));
    assert.strictEqual(rec.meta.filed, 1, 'one file filed');
    const spool = path.join(dir, 'xmradio-spool');
    const m4a = fs.readdirSync(spool).find((f) => f.endsWith('.m4a'));
    assert.ok(m4a, 'an m4a in the spool');
    const desc = JSON.parse(fs.readFileSync(path.join(spool, m4a.replace(/\.m4a$/, '.json')), 'utf8'));
    assert.ok(desc.name.endsWith('Some Artist - Some Song'), desc.name);
    const file = path.join(spool, m4a);
    const tags = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format_tags=title,artist,comment', '-of', 'json', file]).toString()).format.tags;
    assert.strictEqual(tags.title, 'Some Song');
    assert.strictEqual(tags.artist, 'Some Artist');
    assert.ok(tags.comment.includes('show: The Evening Show'), tags.comment);
    assert.ok(!tags.title.includes('partial'));
    const length = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
    assert.ok(Math.abs(length - 12) < 0.4, `range lasts ${length}s`);

    // when all four recorders are busy a Record stacks instead of starting, and reports its place
    for (let i = 0; i < 4; i++) {
        const rid = `busy${i}${'0'.repeat(18)}`.slice(0, 24);
        recorder._test.recs.set(rid, { meta: { rid, channelId: 'other', kind: 'manual', mode: 'long' }, segs: [], lastEnd: 0 });
    }
    const busy = await recorder.recordRange(CHANNEL, { from, to, a: 'Later', t: 'Song', s: '', ik: '' });
    assert.strictEqual(busy.queued, true, 'a busy deck stacks the song');
    assert.strictEqual(busy.rid, null);
    assert.ok(busy.position >= 1, 'the place in line comes back');
    recorder._test.recs.clear();

    // the queue runs in buffer-expiry order (soonest first), ties keep the order added; cancel and clear work
    const now = Date.now();
    const st = recorder._test.load();
    st.queue = [
        { id: 'first', channelId: CHANNEL, from: now - 4 * 3600000, to: now - 4 * 3600000 + 12000, expiresAt: now + 3600000, addedAt: now + 100, a: 'Old', t: 'Song', s: '', ik: '' },
        { id: 'tie1', channelId: CHANNEL, from: now - 100000, to: now - 88000, expiresAt: now + 4 * 3600000, addedAt: now + 200, a: 'A', t: 'One', s: '', ik: '' },
        { id: 'urgent', channelId: CHANNEL, from: now - 4.5 * 3600000, to: now - 4.5 * 3600000 + 12000, expiresAt: now + 1800000, addedAt: now + 300, a: 'Older', t: 'Song', s: '', ik: '' },
        { id: 'tie2', channelId: CHANNEL, from: now - 100000, to: now - 88000, expiresAt: now + 4 * 3600000, addedAt: now + 400, a: 'B', t: 'Two', s: '', ik: '' }
    ];
    assert.deepStrictEqual(recorder.queueList().map((q) => q.id), ['urgent', 'first', 'tie1', 'tie2'], 'expiry then added order');
    assert.ok(recorder.deck().queue.length === 4, 'the deck exposes the queue to the phone feed');
    recorder.queueRemove('first');
    assert.deepStrictEqual(recorder.queueList().map((q) => q.id), ['urgent', 'tie1', 'tie2']);
    recorder.queueClear();
    assert.strictEqual(recorder.queueList().length, 0);
    console.log('test-xmradio-range: ok');
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
