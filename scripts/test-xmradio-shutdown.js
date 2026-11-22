#!/usr/bin/env node
'use strict';
// A signal hands the recorder over to a new process (Yukimi, Nov 22 2026): the segment on the wire is finished, the
// exact next one stored, and the queue kept. The new process resumes the same recording at that segment. No network,
// a stubbed pump; real state-file reads and writes.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmshut-'));
const account = path.join(dir, 'xmradio-account.json');
fs.writeFileSync(account, '{}');
const state = path.join(dir, 'xmradio-recorder.json');

const pump = require('../modules/xmRadioPump');
let lastPump = null;
let stops = 0;
const starts = [];
pump.createPump = () => {
    const e = new EventEmitter();
    let pending = null;
    e.start = (o) => { starts.push(o.back); };
    // like the real pump: finish a segment already being fetched before returning
    e.stop = async () => { stops++; if (pending) { const f = pending; pending = null; f(); } await new Promise((ok) => setTimeout(ok, 5)); };
    e.hold = (f) => { pending = f; };
    e.segment = (sg) => e.emit('segment', sg);
    lastPump = e;
    return e;
};
const CHANNEL = 'abcd1234abcd1234abcd1234';
const recorder = require('../modules/xmRadioRecorder');
recorder.init({
    accountFilePath: () => account,
    channelById: (id) => (id === CHANNEL ? { name: 'The Spectrum', number: 22 } : null),
    nowPlayingCuts: () => [], watch: () => {}, onLook: () => {}, imageUrlFor: () => ''
}, null, { resumeMs: 1e9 });

(async () => {
    const r = await recorder.start({ channelId: CHANNEL, kind: 'manual', mode: 'long' });
    const rec = recorder._test.recs.get(r.rid);
    const t = Date.now() - 60000;
    lastPump.segment({ seq: 100, pdt: t, dur: 6, plain: Buffer.from('a') });
    await new Promise((ok) => setTimeout(ok, 20));
    assert.strictEqual(rec.lastEnd, t + 6000, 'first segment landed');

    // a second segment is on the wire when the signal arrives, and a queued song must survive the handoff
    lastPump.hold(() => lastPump.segment({ seq: 101, pdt: t + 6000, dur: 6, plain: Buffer.from('b') }));
    recorder._test.load().queue.push({ id: 'q1', channelId: CHANNEL, from: t, to: t + 12000, expiresAt: Date.now() + 3600000, addedAt: Date.now(), a: 'A', t: 'Song', s: '', ik: '' });

    const hand = await recorder.shutdown();
    assert.strictEqual(stops, 1, 'the pump was asked to stop');
    assert.strictEqual(rec.lastEnd, t + 12000, 'the segment on the wire finished before the handoff');
    assert.strictEqual(rec.segs.length, 2);
    assert.strictEqual(hand.recordings, 1);
    assert.strictEqual(hand.queue, 1, 'the queue is handed over too');

    const saved = JSON.parse(fs.readFileSync(state, 'utf8'));
    assert.strictEqual(saved.active.length, 1, 'the recording stays active in the state file');
    assert.strictEqual(saved.active[0].resumeAt, t + 12000, 'the exact next segment is stored');
    assert.strictEqual(saved.active[0].resumeSeq, 102);
    assert.strictEqual(saved.queue.length, 1, 'the queue is on disk');
    const segLines = fs.readFileSync(path.join(recorder.recRoot(), r.rid, 'segs.ndjson'), 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(segLines.length, 2, 'both segments are on disk, not half written');

    // new process: reset the module's memory, pick the state file back up
    recorder._test.reset();
    starts.length = 0;
    await recorder._test.resume();
    const again = recorder._test.recs.get(r.rid);
    assert.ok(again, 'the same recording is back');
    assert.strictEqual(recorder._test.recs.size, 1);
    assert.strictEqual(again.meta.resumeAt, undefined, 'the stored point is consumed on resume');
    const expected = Math.ceil((Date.now() - (t + 12000)) / 1000) + 2;
    assert.ok(Math.abs(starts[0] - expected) <= 2, `pump restarts at the stored segment (${starts[0]} vs ${expected})`);
    assert.strictEqual(recorder._test.load().queue.length, 1, 'the queue survives the restart');
    console.log('test-xmradio-shutdown: ok');
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
