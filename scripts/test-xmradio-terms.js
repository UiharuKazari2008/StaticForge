#!/usr/bin/env node
'use strict';
// XM Radio search terms, the full rule set of the old Lizumi isWantedEvent (Yozora #1252 S5). No SiriusXM network, no
// ffmpeg: the xm client and the pump are stubbed, the state file is real. Every rule is off by default, so a term made
// before S5 behaves as it did.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const EventEmitter = require('events');

const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmterms-'));
const account = path.join(dir, 'xmradio-account.json');
fs.writeFileSync(account, '{}');

const pump = require('../modules/xmRadioPump');
pump.createPump = () => {
    const e = new EventEmitter();
    e.start = () => {};
    e.stop = async () => {};
    return e;
};

const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const recorder = require('../modules/xmRadioRecorder');
const store = require('../modules/xmRadioMeta');
recorder.init({
    accountFilePath: () => account,
    channelById: (id) => ([A, B].includes(id) ? { name: `Channel ${id[0]}`, number: 1 } : null),
    nowPlayingCuts: () => [], watch: () => {}, onLook: () => {}, imageUrlFor: () => '',
    slotCount: () => 2, slotReady: () => true, slotCanPlay: () => true, onSlots: () => {}
}, null, { resumeMs: 1e9 });
const T = recorder._test;
const M = T.matchOnAir;
const ids = () => recorder.deck().terms.map((t) => t.id);
const entries = () => [].concat(recorder.deck().queue, recorder.deck().jobs);

// a local time on a known weekday: 2026-11-25 is a Wednesday (3)
const at = (h, m = 0, d = 25) => new Date(2026, 10, d, h, m).getTime();
const cut = (over = {}) => Object.assign({ at: at(14), a: 'Armin van Buuren', t: 'Blah Blah Blah', s: 'A State of Trance', ad: false, ik: '' }, over);
const term = (over) => recorder.setTerms([Object.assign({ text: '' }, over)])[0];
const hit = (cur, over, ctx) => { const t = term(over); return M(A, cur, [], [t], ctx || { now: cur.at + 5000 }); };

(async () => {
    // 1. an old term (text and channel only) is unchanged: every word in artist, title or show, on its channel
    assert.ok(hit(cut(), { text: 'armin trance' }), 'every word, across the fields');
    assert.ok(!hit(cut(), { text: 'armin nothing' }), 'a missing word fails');
    assert.ok(hit(cut({ at: Date.now() - 3600 * 1000 }), { text: 'armin' }, { now: Date.now() }), 'a cut that began an hour ago still matches (not fast)');
    assert.ok(!M(B, cut(), [], [term({ text: 'armin', channelId: A })], {}), 'another channel');
    const old = recorder.setTerms([{ id: 'a'.repeat(12), text: 'armin' }])[0];
    assert.deepStrictEqual([old.days, old.afterHour, old.beforeHour, old.minDuration, old.allowShows, old.fastTrigger, old.notify, old.destination, old.artist, old.artistExact],
        [[], null, null, 0, false, false, false, null, '', false], 'new fields default off');
    assert.deepStrictEqual(M(A, cut(), [], [old], {}), { kind: 'term', ref: old.id }, 'the hit keeps its old shape');
    assert.deepStrictEqual(recorder.setTerms([{ text: '  ' }, { text: '', artist: '' }]), [], 'a term that names nothing is dropped');
    console.log('ok 1 - an old term behaves as before; new fields default off');

    // 2. days
    assert.ok(hit(cut(), { text: 'armin', days: [3] }), 'Wednesday');
    assert.ok(!hit(cut(), { text: 'armin', days: [0, 6] }), 'weekend only');
    assert.deepStrictEqual(term({ text: 'x', days: [9, -1, 'a', 2, 2, 6] }).days, [2, 6], 'days are clamped to 0-6 and deduped');
    console.log('ok 2 - days');

    // 3. hour window, including past midnight
    assert.ok(hit(cut({ at: at(14) }), { text: 'armin', afterHour: 12, beforeHour: 18 }), '14:00 in 12-18');
    assert.ok(!hit(cut({ at: at(18) }), { text: 'armin', afterHour: 12, beforeHour: 18 }), '18:00 is out (before is exclusive)');
    assert.ok(!hit(cut({ at: at(11, 59) }), { text: 'armin', afterHour: 12, beforeHour: 18 }), '11:59 is before it');
    const wrap = { text: 'armin', afterHour: 22, beforeHour: 4 };
    assert.ok(hit(cut({ at: at(23) }), wrap), '23:00 in 22-4');
    assert.ok(hit(cut({ at: at(2) }), wrap), '02:00 in 22-4');
    assert.ok(!hit(cut({ at: at(4) }), wrap), '04:00 out');
    assert.ok(!hit(cut({ at: at(14) }), wrap), '14:00 out');
    assert.ok(hit(cut({ at: at(14) }), { text: 'armin', afterHour: 14 }), 'after only');
    assert.ok(!hit(cut({ at: at(13) }), { text: 'armin', afterHour: 14 }));
    assert.ok(hit(cut({ at: at(3) }), { text: 'armin', beforeHour: 6 }), 'before only');
    assert.strictEqual(term({ text: 'x', afterHour: 40, beforeHour: 'zz' }).afterHour, null, 'an hour out of range is off');
    console.log('ok 3 - hour window incl. wrap past midnight');

    // 4. exact versus substring, per field
    assert.ok(hit(cut(), { artist: 'armin' }), 'substring artist');
    assert.ok(!hit(cut(), { artist: 'armin', artistExact: true }), 'exact artist needs the whole name');
    assert.ok(hit(cut(), { artist: 'Armin van Buuren', artistExact: true }), 'exact artist, case and marks ignored');
    assert.ok(hit(cut(), { title: 'blah', titleExact: false }));
    assert.ok(!hit(cut(), { title: 'blah', titleExact: true }));
    assert.ok(hit(cut(), { show: 'state of', showExact: false }));
    assert.ok(!hit(cut(), { show: 'state of', showExact: true }));
    assert.ok(hit(cut(), { show: 'a state of trance', showExact: true }));
    assert.ok(!hit(cut(), { artist: 'armin', title: 'other' }), 'every field given must hold');
    assert.ok(hit(cut(), { text: 'trance', artist: 'armin', title: 'blah' }), 'free text and fields together');
    console.log('ok 4 - artist, title, show: substring or exact');

    // 5. fast trigger: default records a cut that began long ago; on, only one caught within a minute
    const c5 = cut({ at: at(14) });
    assert.ok(M(A, c5, [], [term({ text: 'armin' })], { now: c5.at + 20 * 60000 }), 'default: 20 minutes in still records');
    assert.ok(!M(A, c5, [], [term({ text: 'armin', fastTrigger: true })], { now: c5.at + 20 * 60000 }), 'fast: too late');
    assert.ok(M(A, c5, [], [term({ text: 'armin', fastTrigger: true })], { now: c5.at + 45000 }), 'fast: 45 s in');
    console.log('ok 5 - fastTrigger');

    // 6. minDuration waits for an unknown length, then matches once known (the durable store's)
    store._test.reset(path.join(dir, 'xmradio-meta.json'));
    const c6 = cut({ at: Date.now() - 20000 });
    const t6 = term({ text: 'armin', minDuration: 180 });
    assert.strictEqual(M(A, c6, [], [t6], { now: Date.now() }), null, 'length unknown: not a miss, not a match');
    store.merge(A, [{ at: c6.at, a: c6.a, t: c6.t, s: c6.s, dur: 120 }]);
    assert.strictEqual(M(A, c6, [], [t6], { now: Date.now() }), null, 'known and too short');
    store.merge(A, [{ at: c6.at, a: c6.a, t: c6.t, s: c6.s, dur: 240 }]);
    assert.ok(M(A, c6, [], [t6], { now: Date.now() }), 'known and long enough');
    assert.ok(M(A, Object.assign({}, c6, { dur: 300 }), [], [t6], { now: Date.now() }), 'the cut\'s own length counts too');
    assert.strictEqual(term({ text: 'x', minDuration: 'abc' }).minDuration, 0);
    assert.strictEqual(term({ text: 'x', minDuration: 1e9 }).minDuration, 86400);
    console.log('ok 6 - minDuration waits for an unknown length, then matches once known');

    // 7. through onLook: the wait is not a miss (the cut is not marked), and then it queues once
    T.reset();
    store._test.reset(path.join(dir, 'xmradio-meta.json'));
    const live = Date.now() - 30000;
    const cuts = () => new Map([[A, [{ at: live, a: 'Armin van Buuren', t: 'Blah', s: '', ad: false, ik: '' }]]]);
    recorder.setTerms([{ text: 'armin', minDuration: 200 }]);
    T.onLook(cuts());
    await new Promise((ok) => setTimeout(ok, 20));
    assert.strictEqual(entries().length, 0, 'length unknown: nothing queued');
    store.merge(A, [{ at: live, a: 'Armin van Buuren', t: 'Blah', dur: 260 }]);
    T.onLook(cuts());
    await new Promise((ok) => setTimeout(ok, 20));
    assert.strictEqual(entries().length, 1, 'known: queued');
    T.onLook(cuts());
    await new Promise((ok) => setTimeout(ok, 20));
    assert.strictEqual(entries().length, 1, 'and only once');
    console.log('ok 7 - onLook: waits for the next read, then one entry');

    // 8. allowShows: an episode on air matches only terms that allow shows
    T.reset();
    store._test.reset(path.join(dir, 'xmradio-meta.json'));
    const ep = Date.now() - 10 * 60000;
    store.merge(B, [{ at: ep, t: 'Trancegiving Special', s: 'Anjuna', dur: 7200, ep: true }]);
    const chOnly = new Map([[B, [{ at: Date.now() - 60000, a: 'Someone', t: 'Else', s: '', ad: false, ik: '' }]]]);
    recorder.setTerms([{ text: 'trancegiving' }]);
    T.onLook(chOnly);
    await new Promise((ok) => setTimeout(ok, 20));
    assert.strictEqual(entries().length, 0, 'shows are not matched by default');
    recorder.setTerms([{ text: 'trancegiving', allowShows: true }]);
    T.onLook(chOnly);
    await new Promise((ok) => setTimeout(ok, 20));
    assert.strictEqual(entries().length, 1, 'allowShows: the episode queues');
    assert.strictEqual(entries()[0].t, 'Trancegiving Special');
    assert.ok(M(A, { at: Date.now(), a: '', t: 'Trancegiving', s: '' }, [], [term({ text: 'trancegiving' })], { episode: true }) === null, 'an episode never matches a term that does not allow shows');
    console.log('ok 8 - allowShows');

    // 9. destination reaches the entry and start()
    T.reset();
    store._test.reset(path.join(dir, 'xmradio-meta.json'));
    const t9 = recorder.setTerms([{ text: 'armin', destination: ' Trance/Live: 2 ' }])[0];
    assert.strictEqual(t9.destination, 'Trance_Live_ 2', 'a safe tape name');
    T.onLook(new Map([[A, [{ at: Date.now() - 30000, a: 'Armin van Buuren', t: 'Blah', s: '', ad: false, ik: '' }]]]));
    await new Promise((ok) => setTimeout(ok, 20));
    const job = entries()[0];
    assert.ok(job && job.rid, 'started');
    assert.strictEqual(job.tape, 'Trance_Live_ 2', 'the entry carries it');
    assert.strictEqual(T.recs.get(job.rid).meta.tape, 'Trance_Live_ 2', 'start() filed the recording on that tape');
    // no destination: the deck's tape
    T.reset();
    recorder.setTerms([{ text: 'armin' }]);
    T.onLook(new Map([[A, [{ at: Date.now() - 30000, a: 'Armin van Buuren', t: 'Blah', s: '', ad: false, ik: '' }]]]));
    await new Promise((ok) => setTimeout(ok, 20));
    assert.strictEqual(T.recs.get(entries()[0].rid).meta.tape, recorder.deck().tape, 'no destination: the deck\'s tape');
    // timers and alerts
    const tm = recorder.setTimers([{ channelId: A, start: '08:00', minutes: 30, days: [1], destination: 'Mornings', notify: true }])[0];
    assert.deepStrictEqual([tm.destination, tm.notify], ['Mornings', true]);
    assert.strictEqual(recorder.setTimers([{ channelId: A, start: '08:00' }])[0].destination, null);
    recorder.addAlert({ kind: 'artist', artist: 'Armin', destination: 'Alerts' });
    const al = recorder.deck().alerts.find((x) => x.artist === 'Armin');
    assert.strictEqual(al.destination, 'Alerts');
    assert.strictEqual(M(A, cut({ a: 'Armin' }), [al], [], {}).tape, 'Alerts', 'an alert hit names its tape');
    recorder.addAlert({ kind: 'artist', artist: 'Armin', destination: 'Other' });
    assert.strictEqual(recorder.deck().alerts.filter((x) => x.artist === 'Armin').length, 1, 'the same alert again only moves its destination');
    assert.strictEqual(recorder.deck().alerts.find((x) => x.artist === 'Armin').destination, 'Other');
    console.log('ok 9 - destination reaches the entry and start(); timers and alerts carry it');

    // 10. validation: unknown fields dropped, strings capped
    const v = recorder.setTerms([{ text: 'x'.repeat(500), bogus: 1, notify: 'yes', channelId: A }])[0];
    assert.strictEqual(v.text.length, 120);
    assert.ok(!('bogus' in v));
    assert.strictEqual(v.notify, true);
    console.log('ok 10 - validation');

    process.exit(0);
})().catch((err) => { console.error(err); process.exit(1); });
