#!/usr/bin/env node
'use strict';
// The durable cut store and its merge (modules/xmRadioMeta.js, Yozora #1252 section 1). No network.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('../modules/xmRadioMeta');

const dir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmmeta-'));
const file = path.join(dir, 'xmradio-meta.json');
const CH = 'abcd1234abcd1234abcd1234';
const NAME = 'Test Channel';
const HOUR = 3600 * 1000;
const NOW = Date.now();
let n = 0;
const ok = (name) => { n++; console.log(`ok ${n} - ${name}`); };
const fresh = () => { store._test.reset(file); try { fs.rmSync(file, { force: true }); } catch (_) { /* none */ } store._test.reset(file); };
const rec = (at) => store.cutsBetween(CH, 0, 0).find((r) => r.at === at);
const m = (items) => store.merge(CH, items, { source: 'test', channelName: NAME });

(async () => {
    // 1. a stale cut keeps its title when a later poll omits it (the window slid)
    fresh();
    const t0 = NOW - 30 * 60000;
    m([{ at: t0, a: 'Artist One', t: 'Song One', s: 'Show' }, { at: t0 + 200000, a: 'Artist Two', t: 'Song Two' }]);
    m([{ at: t0 + 200000, a: 'Artist Two', t: 'Song Two' }, { at: t0 + 400000, a: 'Artist Three', t: 'Song Three' }]);
    assert.strictEqual(rec(t0).title, 'Song One');
    assert.strictEqual(rec(t0).artist, 'Artist One');
    assert.strictEqual(rec(t0).album, 'Show');
    assert.strictEqual(store.cutsBetween(CH, 0, 0).length, 3);
    assert.deepStrictEqual(store.cutsBetween(CH, 0, 0).map((r) => r.at), [t0, t0 + 200000, t0 + 400000], 'sorted by at');
    ok('a cut a later poll omits keeps its name; the list is never cut to the window and stays sorted');

    // 2. a placeholder is repaired by a later read; attempts stop after 10
    fresh();
    let r = m([{ at: t0, a: NAME, t: 'Commercial', ad: false }]);
    assert.strictEqual(r.added, 1);
    r = m([{ at: t0, a: 'Real Artist', t: 'Real Title', s: 'Real Show' }]);
    assert.strictEqual(r.repaired, 1);
    assert.strictEqual(rec(t0).title, 'Real Title');
    assert.strictEqual(rec(t0).artist, 'Real Artist');
    assert.strictEqual(rec(t0).album, 'Real Show');
    const t1 = t0 + 400000;
    m([{ at: t1, a: '', t: 'Test channel' }]); // the channel's own name, any case
    // the same answer again (lookAround repeats itself every 20 s) is not an attempt
    for (let i = 0; i < 5; i++) m([{ at: t1, a: '', t: 'Test channel' }]);
    assert.strictEqual(rec(t1).updateCount, 0, 'a repeated identical answer uses no repair attempt');
    for (let i = 0; i < 10; i++) m([{ at: t1, a: '', t: i % 2 ? 'Test channel' : '@SiriusXM' }]);
    assert.strictEqual(rec(t1).updateCount, 10);
    r = m([{ at: t1, a: 'Late Artist', t: 'Late Title' }]);
    assert.strictEqual(r.repaired, 0, 'the 11th try does not apply');
    assert.strictEqual(rec(t1).title, 'Test channel');
    // an ad is a placeholder that a later real read repairs, and the ad flag goes
    const t2 = t0 + 800000;
    m([{ at: t2, a: 'x', t: 'x', ad: true }]);
    assert.strictEqual(rec(t2).ad, true);
    m([{ at: t2, a: 'Now A', t: 'Now T' }]);
    assert.strictEqual(rec(t2).title, 'Now T');
    assert.strictEqual(rec(t2).ad, false);
    // an extra ignored word from the settings
    store.settings.set({ ignoredWords: ['Station ID'] });
    m([{ at: t0 + 900000, a: '', t: 'station id' }]);
    m([{ at: t0 + 900000, a: 'B', t: 'Fixed' }]);
    assert.strictEqual(rec(t0 + 900000).title, 'Fixed');
    ok('a placeholder (empty, ignored word, channel name, ad) is repaired by a later read, at most 10 times');

    // 3. a real name is never overwritten by a later placeholder
    fresh();
    m([{ at: t0, a: 'Real Artist', t: 'Real Title' }]);
    m([{ at: t0, a: NAME, t: 'Commercial' }]);
    m([{ at: t0, a: '', t: '', ad: true }]);
    assert.strictEqual(rec(t0).title, 'Real Title');
    assert.strictEqual(rec(t0).artist, 'Real Artist');
    assert.strictEqual(rec(t0).ad, false);
    ok('a real name is never replaced by a placeholder');

    // 4. a user-edited (mod) record is never rewritten
    fresh();
    m([{ at: t0, a: '', t: 'Commercial' }]);
    const e = store.edit(CH, t0, { title: 'Mine', artist: 'Me' });
    assert.strictEqual(e.mod, true);
    m([{ at: t0, a: 'Theirs', t: 'Theirs Too' }]);
    assert.strictEqual(rec(t0).title, 'Mine');
    assert.strictEqual(rec(t0).artist, 'Me');
    // a placeholder edit stays too (the person decided)
    store.edit(CH, t0, { title: 'Commercial' });
    m([{ at: t0, a: 'Theirs', t: 'Theirs Too' }]);
    assert.strictEqual(rec(t0).title, 'Commercial');
    ok('an edited record keeps its text');

    // 5. dur / end / guid are always refreshed
    fresh();
    m([{ at: t0, a: 'A', t: 'T' }]);
    assert.strictEqual(rec(t0).guid, '');
    m([{ at: t0, a: 'A', t: 'T', dur: 200, guid: 'g1' }]);
    assert.strictEqual(rec(t0).dur, 200);
    assert.strictEqual(rec(t0).end, t0 + 200000);
    assert.strictEqual(rec(t0).guid, 'g1');
    m([{ at: t0, a: 'A', t: 'T', dur: 210, guid: 'g2', end: t0 + 211000 }]);
    assert.strictEqual(rec(t0).dur, 210);
    assert.strictEqual(rec(t0).end, t0 + 211000);
    assert.strictEqual(rec(t0).guid, 'g2');
    m([{ at: t0, a: 'A', t: 'T' }]); // a read that does not know the length does not wipe it
    assert.strictEqual(rec(t0).dur, 210);
    // even an edited record's length and guid are refreshed; its text is not
    store.edit(CH, t0, { title: 'Mine' });
    m([{ at: t0, a: 'A', t: 'Other', dur: 230, guid: 'g3' }]);
    assert.strictEqual(rec(t0).dur, 230);
    assert.strictEqual(rec(t0).guid, 'g3');
    assert.strictEqual(rec(t0).title, 'Mine');
    // an episode: no artist, no album; a song and a show may begin together
    m([{ at: t0, t: 'The Show', s: 'Show Name', a: 'ignored', ep: true, dur: 3600 }]);
    const eps = store.cutsBetween(CH, 0, 0).filter((x) => x.isEpisode);
    assert.strictEqual(eps.length, 1);
    assert.strictEqual(eps[0].artist, '');
    assert.strictEqual(eps[0].isSong, false);
    assert.strictEqual(store.cutsBetween(CH, 0, 0).length, 2);
    // isSong follows the length
    m([{ at: t0 + 5000000, a: 'Long', t: 'Mix', dur: 1800 }]);
    assert.strictEqual(rec(t0 + 5000000).isSong, false);
    ok('dur, end and guid are always refreshed; episodes carry no artist; isSong follows the length');

    // 6. retention
    fresh();
    const day = 24 * HOUR;
    m([{ at: NOW - day - HOUR, a: 'Old', t: 'Song', dur: 200 }]); // a song over a day old
    m([{ at: NOW - 2 * day, a: 'Mix', t: 'Long Set', dur: 3000 }]); // a non-song 2 days old stays
    m([{ at: NOW - 8 * day, a: 'Mix', t: 'Ancient Set', dur: 3000 }]); // over a week
    m([{ at: NOW - 3 * day, t: 'Old Show', s: 'S', ep: true, dur: 3600 }]);
    m([{ at: NOW - 8 * day, t: 'Older Show', s: 'S', ep: true, dur: 3600 }]);
    m([{ at: NOW - HOUR, a: 'New', t: 'Song', dur: 200 }]);
    m([{ at: NOW - 2 * HOUR, a: 'Short', t: 'Promo', dur: 30 }]); // known short: never stored
    assert.strictEqual(rec(NOW - 2 * HOUR), undefined);
    m([{ at: NOW - 3 * HOUR, a: 'Short', t: 'Provisional' }]); // length unknown: kept for now
    assert.ok(rec(NOW - 3 * HOUR));
    m([{ at: NOW - 3 * HOUR, a: 'Short', t: 'Provisional', dur: 20 }]); // now known: gone
    assert.strictEqual(rec(NOW - 3 * HOUR), undefined);
    m([{ at: NOW - 3 * HOUR, a: 'Short', t: 'Provisional' }]); // lookAround does not bring it back
    assert.strictEqual(rec(NOW - 3 * HOUR), undefined);
    // a short one that got in through the data (an old file) goes at prune
    store._test.data().channels[CH].cuts.push({ at: NOW - 4 * HOUR, end: 0, dur: 40, guid: '', title: 'x', artist: 'y', album: '', ad: false, ik: '', isSong: true, isEpisode: false, mod: false, updateCount: 0 });
    const pruned = store.prune(NOW);
    assert.ok(pruned >= 4, `pruned ${pruned}`);
    const left = store.cutsBetween(CH, 0, 0).map((x) => x.title).sort();
    assert.deepStrictEqual(left, ['Long Set', 'Old Show', 'Song'], 'only the fresh song, the 2 day set and the 3 day show remain');
    assert.strictEqual(store.prune(NOW + 2 * day), 1, 'two days on, the song is over a day old');
    assert.deepStrictEqual(store.cutsBetween(CH, 0, 0).map((x) => x.title).sort(), ['Long Set', 'Old Show'], 'the set (4 days old) and the show (5 days) are inside the week');
    ok('retention: songs a day, non-songs and shows a week, known-short cuts never');

    // 7. persistence round trip (debounced, atomic, 0600)
    fresh();
    const base = NOW - 10 * 60000;
    m([{ at: base, a: 'Persist', t: 'One', s: 'Show', guid: 'gg', dur: 180 }, { at: base + 180000, a: 'Persist', t: 'Two' }, { at: base, t: 'Ep', s: 'Sh', ep: true, dur: 3600 }]);
    store.edit(CH, base + 180000, { title: 'Two Edited' });
    const before = JSON.stringify(store.cutsBetween(CH, 0, 0));
    assert.ok(!fs.existsSync(file), 'not written at once (debounced)');
    await store.flush();
    assert.ok(fs.existsSync(file));
    assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
    assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => f.endsWith('.tmp')), [], 'no tmp file left');
    store._test.reset(file); // a new process: loaded from the file
    assert.strictEqual(JSON.stringify(store.cutsBetween(CH, 0, 0)), before);
    assert.strictEqual(store.cutsBetween(CH, 0, 0).find((x) => x.title === 'Two Edited').mod, true);
    assert.deepStrictEqual(store.stats(), { channels: 1, cuts: 3, oldest: base, newest: base + 180000, file });
    store.settings.set({ ignoredWords: ['Zed'] });
    await store.flush();
    store._test.reset(file);
    assert.deepStrictEqual(store.settings.get().ignoredWords, ['Zed']);
    // a damaged file is an empty store, not a crash
    fs.writeFileSync(file, '{ not json');
    store._test.reset(file);
    assert.strictEqual(store.stats().cuts, 0);
    ok('persistence: written off the loop (0600, atomic), reloaded identical, settings kept, a bad file is empty');

    // 8. dur back-fill on read (never stored)
    fresh();
    m([{ at: base, a: 'A', t: 'One' }, { at: base + 150000, a: 'B', t: 'Two' }, { at: base + 400000, a: 'C', t: 'Three', dur: 100 }]);
    const rows = store.cutsBetween(CH, 0, 0);
    assert.strictEqual(rows[0].dur, 150);
    assert.strictEqual(rows[0].end, base + 150000);
    assert.strictEqual(rows[1].dur, 250);
    assert.strictEqual(rows[2].dur, 100, 'a length that is known stays');
    assert.strictEqual(store._test.data().channels[CH].cuts[0].dur, 0, 'the guess is not stored');
    const cur = store.cutAt(CH, base + 200000);
    assert.strictEqual(cur.title, 'Two');
    assert.strictEqual(cur.dur, 250);
    assert.strictEqual(store.cutAt(CH, base - 1), null);
    // the window: only what overlaps
    assert.deepStrictEqual(store.cutsBetween(CH, base + 160000, base + 300000).map((x) => x.title), ['Two']);
    assert.deepStrictEqual(store.cutsBetween(CH, base + 100000, base + 160000).map((x) => x.title), ['One', 'Two']);
    ok('a missing length is filled from the next record when read, and not stored');

    // the single-writer helpers: other channels are independent, bad input is ignored
    assert.deepStrictEqual(store.merge('', [{ at: 1 }]), { added: 0, updated: 0, repaired: 0 });
    assert.deepStrictEqual(store.merge('other', [{ at: 0 }, null].filter(Boolean)), { added: 0, updated: 0, repaired: 0 });
    assert.deepStrictEqual(store.cutsBetween('nothing', 0, 0), []);
    const rr = store.mergeRange(CH, { items: [{ at: base + 600000, dur: 200, a: 'R', t: 'Range', ad: false, ik: 'k', guid: 'rg' }], episodes: [{ at: base + 600000, dur: 3600, name: 'Ep', show: 'Shw', ik: '', guid: 'eg' }] }, { channelName: NAME });
    assert.strictEqual(rr.added, 2);
    ok('range merge and bad input');

    // the recorder's wiring: the store takes lookAround for channels of interest only, a recording that reaches back
    // reads liveUpdate for its window, and the cut in force comes from the store over the recording's own short list
    store._test.reset('');
    const wdir = fs.mkdtempSync(path.join(process.env.XMRADIO_TEST_TMP || os.tmpdir(), 'xmmeta-wire-'));
    const account = path.join(wdir, 'xmradio-account.json');
    fs.writeFileSync(account, '{}');
    const EventEmitter = require('events');
    const pump = require('../modules/xmRadioPump');
    pump.createPump = () => { const e = new EventEmitter(); e.start = () => {}; e.stop = () => {}; return e; };
    const recorder = require('../modules/xmRadioRecorder');
    const CH2 = 'bbbb1234bbbb1234bbbb1234';
    const PRESET = 'cccc1234cccc1234cccc1234';
    const OTHER = 'dddd1234dddd1234dddd1234';
    const calls = [];
    const wnow = Date.now();
    recorder.init({
        accountFilePath: () => account,
        channelById: (id) => ([CH, CH2, PRESET, OTHER].includes(id) ? { name: id === CH ? NAME : 'Other', number: 1 } : null),
        presets: () => ({ A: [PRESET, null], B: [], C: [] }),
        nowPlayingCuts: () => [], watch: () => {}, onLook: () => {}, imageUrlFor: () => '',
        liveUpdateRange: async (id, from, to) => {
            calls.push({ id, from, to });
            return { items: [{ at: wnow - 3600000, dur: 200, a: 'Old Artist', t: 'Old Song', ad: false, ik: '', guid: 'og' }, { at: wnow - 3400000, dur: 250, a: 'Next', t: 'Next Song', ad: false, ik: '', guid: 'ng' }], episodes: [] };
        }
    }, null, { resumeMs: 1e9 });
    const st = recorder._test.load();
    st.timers.push({ channelId: CH });
    st.queue.push({ id: 'q', channelId: CH2 });
    const look = (at) => [{ at, a: 'Live A', t: 'Live T', ad: false, s: '', ik: '' }];
    recorder._test.onLook(new Map([[CH, look(wnow - 60000)], [CH2, look(wnow - 60000)], [PRESET, look(wnow - 60000)], [OTHER, look(wnow - 60000)]]));
    const wfile = path.join(wdir, 'xmradio-meta.json');
    assert.strictEqual(store.stats().file, wfile);
    assert.strictEqual(store.cutsBetween(CH, 0, 0).length, 1, 'a channel with a timer is stored');
    assert.strictEqual(store.cutsBetween(CH2, 0, 0).length, 1, 'a queued channel is stored');
    assert.strictEqual(store.cutsBetween(PRESET, 0, 0).length, 1, 'a preset channel is stored');
    assert.strictEqual(store.cutsBetween(OTHER, 0, 0).length, 0, 'the rest of the lineup is not');
    const started = await recorder.start({ channelId: CH, kind: 'manual', back: 2 * 3600 });
    const live = recorder._test.recs.get(started.rid);
    await live.metaPending;
    assert.strictEqual(calls.length, 1, 'one liveUpdate read for the reach-back');
    assert.ok(Math.abs(calls[0].from - (live.meta.startPdt - 60000)) < 50 && calls[0].to >= wnow, 'over [start - 60 s, now]');
    assert.strictEqual(store.cutsBetween(CH, 0, 0).length, 3, 'the range was merged next to the live cut');
    live.segs.push({ seq: 1, pdt: wnow - 3500000, dur: 10, f: 's1.aac', ok: true });
    const { cur: inForce, next } = recorder._test.cutAt(live, wnow - 3500000);
    assert.strictEqual(inForce.t, 'Old Song', 'the cut in force is the store\'s, though live.cuts never held it');
    assert.strictEqual(next.t, 'Next Song');
    await recorder.stop(started.rid);
    await recorder.shutdown();
    assert.ok(fs.existsSync(wfile), 'shutdown flushed the store');
    assert.strictEqual(JSON.parse(fs.readFileSync(wfile, 'utf8')).channels[CH].cuts.length, 3);
    ok('the recorder stores channels of interest, reads liveUpdate for a reach-back, names from the store, flushes at shutdown');
    recorder._test.reset();
    fs.rmSync(wdir, { recursive: true, force: true });

    fs.rmSync(dir, { recursive: true, force: true });
    console.log(`xmradio-meta: ${n} passed`);
})().catch((err) => { console.error(err); process.exit(1); });
