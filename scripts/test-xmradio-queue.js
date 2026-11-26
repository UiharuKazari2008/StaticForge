#!/usr/bin/env node
'use strict';
// XM Radio's common recording queue and slot dispatcher (Yozora #1252 S3). No SiriusXM network, no ffmpeg: the xm client
// and the pump are stubbed, the state file is real. Every producer queues an entry; a dispatcher hands it to a free,
// signed-in, entitled slot that is not already streaming; an entry whose five hours run out is missed, with its reason.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmqueue-'));
const account = path.join(dir, 'xmradio-account.json');
const stateFile = path.join(dir, 'xmradio-recorder.json');
fs.writeFileSync(account, '{}');

const pump = require('../modules/xmRadioPump');
const pumpStarts = [];
pump.createPump = (o) => {
    const e = new EventEmitter();
    e.start = (so) => { pumpStarts.push({ channelId: o.channelId, back: so && so.back }); };
    e.stop = async () => {};
    return e;
};

const [A, B, C, D, E, F] = ['a', 'b', 'c', 'd', 'e', 'f'].map((c) => c.repeat(24));
// what the stubbed SiriusXM client says about the slots; every test sets it
const cfg = { count: 2, ready: { 1: true, 2: true, 3: true, 4: true }, deny: {} };
let slotListener = null;
const recorder = require('../modules/xmRadioRecorder');
recorder.init({
    accountFilePath: () => account,
    channelById: (id) => ([A, B, C, D, E, F].includes(id) ? { name: `Channel ${id[0]}`, number: 1 } : null),
    nowPlayingCuts: () => [], watch: () => {}, onLook: () => {}, imageUrlFor: () => '',
    slotCount: () => cfg.count,
    slotReady: (n) => !!cfg.ready[n],
    slotCanPlay: (n, ch) => !!cfg.ready[n] && !(cfg.deny[n] && cfg.deny[n].has(ch)),
    onSlots: (fn) => { slotListener = fn; }
}, null, { resumeMs: 1e9 });
const T = recorder._test;

function fresh(over = {}) {
    T.reset();
    try { fs.unlinkSync(stateFile); } catch (_) { /* none */ }
    Object.assign(cfg, { count: 2, ready: { 1: true, 2: true, 3: true, 4: true }, deny: {} }, over);
    pumpStarts.length = 0;
}
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const now = () => Date.now();
const H = 3600 * 1000;
const song = (ch, ago, extra = {}) => { const from = now() - ago; return recorder.recordRange(ch, Object.assign({ from, to: from + 12000, a: 'Artist', t: `Song ${ch[0]}`, s: '', ik: '' }, extra)); };
const jobs = () => recorder.deck().jobs;
const queued = () => recorder.deck().queue;
const history = () => recorder.deck().history;
const slotOf = (rid) => T.recs.get(rid).meta.slot;
const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

(async () => {
    // 1. one stream per account, slot 1 included: 2 slots and 3 jobs -> 2 run, 1 waits; expiry order, then added order;
    //    the waiting one starts when a recording stops
    fresh();
    const r1 = await song(A, 100000);
    const r2 = await song(B, 4 * H);
    assert.ok(r1.rid && r2.rid && !r1.queued && !r2.queued, 'two slots, two recordings');
    assert.deepStrictEqual([slotOf(r1.rid), slotOf(r2.rid)].sort(), [1, 2], 'each on its own slot');
    const r3 = await song(C, 3 * H);
    assert.strictEqual(r3.queued, true, 'the third waits: every account is streaming');
    assert.strictEqual(r3.position, 1);
    assert.strictEqual(r3.rid, null);
    const r4 = await song(D, 4.5 * H);
    assert.strictEqual(r4.position, 1, 'the song that leaves the buffer first goes ahead');
    assert.deepStrictEqual(queued().map((q) => [q.channelId, q.position, q.state]), [[D, 1, 'queued'], [C, 2, 'queued']]);
    assert.deepStrictEqual(recorder.deck().pool.map((p) => [p.slot, p.ready, p.streaming]), [[1, true, 1], [2, true, 1]]);
    assert.deepStrictEqual(recorder.deck().recordings.map((r) => r.slot).sort(), [1, 2], 'each recording carries its slot');
    assert.strictEqual(recorder.deck().settings.streamsPerAccount, 1);
    const freed = slotOf(r1.rid);
    await recorder.stop(r1.rid);
    await recorder.dispatch();
    assert.deepStrictEqual(queued().map((q) => q.channelId), [C], 'the most urgent entry took the freed slot');
    const started = jobs().find((j) => j.channelId === D);
    assert.ok(started && started.state === 'running' && started.slot === freed && started.rid, 'D runs on the slot that came free');
    assert.strictEqual(T.recs.get(started.rid).meta.channelId, D);
    assert.ok(history().some((h) => h.channelId === A && h.state === 'done'), 'a finished entry is in history');
    assert.ok(pumpStarts.find((p) => p.channelId === D).back >= 4.5 * H / 1000, 'a late start reaches back to its first moment');
    console.log('ok 1 - expiry then added order; one stream per account (slot 1 too): 2 run, 1 waits, starts when one stops');

    // 2. a slot whose account is not entitled to the channel is skipped
    fresh({ deny: { 1: new Set([A]) } });
    const e1 = await song(A, 100000);
    assert.strictEqual(slotOf(e1.rid), 2, 'slot 1 is free but not entitled to A: slot 2 takes it');
    const e2 = await song(B, 100000);
    assert.strictEqual(slotOf(e2.rid), 1);
    // nothing signed in can play it: a person waiting is told now
    cfg.deny = { 1: new Set([E]), 2: new Set([E]) };
    await assert.rejects(song(E, 100000), (e) => e.code === 'XMRADIO_SIGNED_OUT');
    // a slot that is signed out is not a candidate
    fresh({ ready: { 1: false, 2: true } });
    const e3 = await song(A, 100000);
    assert.strictEqual(slotOf(e3.rid), 2, 'slot 1 is signed out');
    console.log('ok 2 - a slot not entitled (or signed out) is skipped');

    // 3. an entry that passes its expiry while waiting is missed, with its reason, and kept in history
    fresh({ count: 1 });
    await song(A, 100000);
    const soon = await song(B, 5 * H - 60000 - 300); // its last fetchable moment is 0.3 s away
    assert.strictEqual(soon.queued, true);
    assert.strictEqual(queued().length, 1);
    await wait(500);
    assert.strictEqual(queued().length, 0, 'it left the queue');
    const missed = history().find((h) => h.channelId === B);
    assert.ok(missed, 'missed, not silently dropped');
    assert.strictEqual(missed.state, 'missed');
    assert.strictEqual(missed.reason, 'No virtual radio came free before it left the five-hour buffer');
    // nobody entitled is the specific reason
    cfg.deny = { 1: new Set([C]) };
    const st = T.load();
    const lost = T.makeEntry('alert', C, { from: now() - 5 * H + 60000 + 200, fromCut: 1 });
    st.queue.push(lost);
    await recorder.dispatch();
    await wait(400);
    const lostRow = history().find((h) => h.id === lost.id);
    assert.ok(lostRow && lostRow.state === 'missed' && /No signed-in account is entitled/.test(lostRow.reason), JSON.stringify(lostRow));
    // history keeps the last 100, newest first
    for (let i = 0; i < 120; i++) { const e = T.makeEntry('alert', C, { from: now() }); st.queue.push(e); recorder.queueRemove(e.id); }
    assert.strictEqual(history().length, 100);
    assert.strictEqual(history()[0].state, 'cancelled');
    console.log('ok 3 - an entry that expires while waiting is missed with its reason, and lands in history (last 100)');

    // 4. streamsPerAccount (a deck setting, 1 to 4) lets one account stream more than once
    fresh({ count: 1 });
    assert.throws(() => recorder.setSettings({ streamsPerAccount: 0 }), /1 to 4/);
    assert.throws(() => recorder.setSettings({ streamsPerAccount: 5 }), /1 to 4/);
    const a1 = await song(A, 100000);
    const b1 = await song(B, 100000);
    assert.ok(a1.rid && b1.queued, 'one stream per account by default');
    recorder.setSettings({ streamsPerAccount: 2 });
    await recorder.dispatch();
    assert.strictEqual(queued().length, 0, 'raising the setting starts the waiting entry');
    const pool4 = recorder.deck().pool[0];
    assert.deepStrictEqual([pool4.slot, pool4.name, pool4.ready, pool4.streaming, pool4.rids.length], [1, 'Lizumi-Recorder-1', true, 2, 2]);
    assert.strictEqual(recorder.deck().settings.streamsPerAccount, 2);
    // the same channel twice only on different slots: a different song of A has no second slot to go to
    const a2 = await song(A, 3 * H);
    assert.strictEqual(a2.queued, true, 'A is already recording on slot 1, the only slot');
    assert.strictEqual(T.load().settings.streamsPerAccount, 2);
    console.log('ok 4 - streamsPerAccount=2 lets slot 1 run two; the same channel never twice on one slot');

    // 5. timers, alerts and terms go through the queue
    fresh({ count: 1 });
    const busy = await recorder.start({ channelId: A, kind: 'manual', mode: 'long' });
    assert.ok(busy.rid);
    const st5 = T.load();
    st5.timers.push({ id: 'aabbccddeeff', channelId: C, start: hhmm(new Date()), minutes: 30, days: [], date: null, mode: null, off: false });
    st5.alerts.push({ id: '112233445566', kind: 'artist', artist: 'Alert Artist', title: '', channelId: null });
    st5.terms.push({ id: '665544332211', text: 'Trancegiving', channelId: null });
    T.fireTimers(now());
    T.onLook(new Map([
        [D, [{ at: now() - 60000, a: 'Alert Artist', t: 'Some Song', s: '', ad: false, ik: '' }]],
        [F, [{ at: now() - 30000, a: 'DJ', t: 'Set', s: 'Trancegiving Special', ad: false, ik: '' }]]
    ]));
    await recorder.dispatch();
    assert.deepStrictEqual(queued().map((q) => q.kind).sort(), ['alert', 'term', 'timer'], 'all three wait in the common queue');
    assert.strictEqual(queued().find((q) => q.kind === 'timer').ref, 'aabbccddeeff');
    assert.strictEqual(queued().find((q) => q.kind === 'alert').ref, '112233445566');
    assert.strictEqual(queued().find((q) => q.kind === 'term').ref, '665544332211');
    // the alert's cut is the oldest, so it leaves the buffer first and takes the slot first
    await recorder.stop(busy.rid);
    await recorder.dispatch();
    const run5 = jobs();
    assert.strictEqual(run5.length, 1);
    assert.strictEqual(run5[0].kind, 'alert', 'due order: the alert, then the term, then the timer');
    const arec = T.recs.get(run5[0].rid);
    assert.strictEqual(arec.meta.kind, 'alert');
    assert.ok(arec.meta.fromCut > 0, 'recorded from the matched cut');
    assert.ok(pumpStarts.find((p) => p.channelId === D).back >= 60, 'reaches back to the start of the cut');
    // with a slot free, a firing timer starts in the same call and records its window
    fresh({ count: 1 });
    const st5b = T.load();
    st5b.timers.push({ id: 'ffeeddccbbaa', channelId: B, start: hhmm(new Date()), minutes: 30, days: [], date: null, mode: null, off: false });
    T.fireTimers(now());
    await recorder.dispatch();
    assert.strictEqual(jobs().length, 1);
    assert.strictEqual(jobs()[0].kind, 'timer');
    const trec = T.recs.get(jobs()[0].rid);
    assert.strictEqual(trec.meta.kind, 'timer');
    assert.ok(trec.meta.endPdt > now() + 25 * 60000, 'the timer records its window');
    console.log('ok 5 - a timer, an alert and a term go through the queue (due order, reach back, slot when free)');

    // the deck's REC and one-touch Record answer as before when a slot is free, and queue when none is
    fresh({ count: 1 });
    const rc = await recorder.recordChannel(A);
    assert.ok(rc.rid && rc.url && rc.slot === 1, 'a free slot: the recording, like start()');
    const rc2 = await recorder.recordCut(B);
    assert.strictEqual(rc2.rid, null);
    assert.strictEqual(rc2.queued, true);
    assert.strictEqual(rc2.position, 1);
    assert.ok(rc2.id && Array.isArray(rc2.queue));
    recorder.cancel(rc2.id);
    assert.strictEqual(queued().length, 0);
    assert.strictEqual(history()[0].state, 'cancelled');
    assert.throws(() => recorder.cancel(rc2.id), /not waiting/);
    console.log('ok 5b - REC and one-touch Record: a recording when a slot is free, a place in line when not; cancel');

    // 6. a duplicate of a running job attaches to it; the same channel runs twice only for a different from-time, on another slot
    fresh();
    const m1 = await recorder.recordChannel(A);
    const m2 = await recorder.recordChannel(A);
    assert.strictEqual(m2.rid, m1.rid, 'the second REC joins the running one');
    assert.strictEqual(T.recs.size, 1, 'no second stream');
    assert.strictEqual(jobs().length, 2, 'both entries are linked to the one recording');
    assert.ok(jobs().some((j) => j.rid === m1.rid && j.slot === m1.slot));
    const earlier = await song(A, 2 * H); // a different moment on the same channel: another slot
    assert.ok(earlier.rid && T.recs.size === 2);
    assert.notStrictEqual(slotOf(earlier.rid), slotOf(m1.rid), 'same channel twice only on different slots');
    const rcut = T.recs.get(earlier.rid).meta;
    const again = await song(A, 2 * H, { from: rcut.rangeCut.at, to: rcut.endPdt });
    assert.strictEqual(again.rid, earlier.rid, 'the same song attaches to the running range');
    assert.strictEqual(T.recs.size, 2);
    await recorder.stop(m1.rid);
    assert.strictEqual(history().filter((h) => h.rid === m1.rid && h.state === 'done').length, 2, 'every entry on the recording ends with it');
    console.log('ok 6 - a duplicate attaches; one channel twice only on different slots and from-times');

    // 7. queued and running entries survive a restart; the running one is linked to its recording by rid
    fresh({ count: 1 });
    const live = await song(A, 100000);
    const wait7 = await song(B, 3 * H);
    assert.ok(live.rid && wait7.queued);
    const waitingId = queued()[0].id;
    const jobId = jobs()[0].id;
    const hand = await recorder.shutdown();
    assert.deepStrictEqual([hand.recordings, hand.queue, hand.running], [1, 1, 1]);
    const saved = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    assert.strictEqual(saved.queue.length, 1);
    assert.strictEqual(saved.running.length, 1);
    assert.strictEqual(saved.running[0].rid, live.rid);
    assert.strictEqual(saved.active[0].entryId, jobId);
    T.reset();
    pumpStarts.length = 0;
    await T.resume();
    await recorder.dispatch();
    assert.ok(T.recs.get(live.rid), 'the recording is back');
    assert.strictEqual(jobs().length, 1);
    assert.strictEqual(jobs()[0].id, jobId, 'the running entry is linked to it by rid');
    assert.strictEqual(jobs()[0].rid, live.rid);
    assert.deepStrictEqual(queued().map((q) => q.id), [waitingId], 'the waiting entry is still waiting (its slot is still streaming)');
    await recorder.stop(live.rid);
    await recorder.dispatch();
    assert.strictEqual(jobs()[0].channelId, B, 'and starts when the resumed recording ends');
    console.log('ok 7 - restart keeps queued and running entries');

    // 8. a slot signing in lets a waiting entry start (the auth op calls slotsChanged)
    fresh({ ready: { 1: true, 2: false } });
    await song(A, 100000);
    const w8 = await song(B, 100000);
    assert.strictEqual(w8.queued, true, 'slot 2 is signed out: nothing is free');
    cfg.ready[2] = true;
    await recorder.slotsChanged();
    assert.strictEqual(queued().length, 0, 'the token arriving starts it');
    assert.ok(typeof slotListener === 'function', 'the recorder listens to the slots');
    console.log('ok 8 - a slot signing in dispatches the waiting entry');

    // 9. a term recording from before S3 (its cut kept only as the song-mode cursor) and the same cut queued again by the
    //    term matching after a restart: the queued one joins the resumed recording, no second file of the same song
    fresh({ count: 1 });
    const cutStart = now() - 120000;
    const rid9 = 'f'.repeat(24);
    fs.mkdirSync(path.join(path.dirname(account), 'xmradio-rec', rid9), { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify({
        active: [{ rid: rid9, channelId: A, kind: 'term', mode: 'song', since: now() - 110000, until: now() + H, startPdt: cutStart - 8000, cursor: cutStart, filed: 0, endPdt: 0 }],
        queue: [{ id: 'dup000000001', kind: 'term', state: 'queued', channelId: A, from: cutStart, fromCut: cutStart, until: now() + H, addedAt: now(), expiresAt: cutStart + 5 * H - 60000, a: 'Paul van Dyk', t: 'Trancegiving (2024)' }]
    }));
    T.reset();
    await T.resume();
    await recorder.dispatch();
    assert.strictEqual(T.recs.size, 1, 'no second stream for the same cut');
    assert.strictEqual(queued().length, 0, 'the duplicate is not left waiting');
    assert.ok(jobs().some((j) => j.id === 'dup000000001' && j.rid === rid9), 'it joined the resumed recording');
    await recorder.stop(rid9);
    console.log('ok 9 - a cut queued again after a restart joins the pre-S3 recording that already records it');

    console.log('test-xmradio-queue: ok');
})().catch((err) => { console.error(err); process.exitCode = 1; }).finally(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} });
