#!/usr/bin/env node
/**
 * modules/videosRelayStore.js (StaticForge #1365): the session records of the live relays on disk, and the budget that
 * bounds how often a gone session is started again. Real files in a temp folder, no network, no ffmpeg.
 *
 *   node scripts/test-videos-relay-store.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const lib = require('../modules/videosRelayStore');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relay-store-test-'));
let n = 0;
const fileOf = () => path.join(tmp, `case${++n}`, 'sessions.json');
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const idOf = (i) => String(i).padStart(24, 'a');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const tick = () => new Promise((r) => setImmediate(r));

let pass = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log(`  ok  ${name}`); }, (e) => { console.error(`  FAIL ${name}\n${e.stack}`); process.exitCode = 1; });

const A = idOf(1);
const B = idOf(2);
const C = idOf(3);

(async () => {
    await ok('put / get / touch / remove / all', async () => {
        const f = fileOf();
        const s = lib.open(f);
        assert.strictEqual(s.get(A), null);
        assert.strictEqual(s.put(A, { slug: 'one', mode: '480', startedAt: 5, lastHit: 1000 + Date.now() }), true);
        const r = s.get(A);
        assert.deepStrictEqual([r.slug, r.mode, r.startedAt], ['one', '480', 5]);
        assert.strictEqual(s.touch(A, { mode: '360' }), true);
        assert.strictEqual(s.get(A).mode, '360');
        assert.strictEqual(s.touch(B, { mode: 'x' }), false, 'no record: nothing to touch');
        s.put(B, { slug: 'two', mode: '480', startedAt: 6 });
        assert.ok(s.get(B).lastHit > 0 && s.get(B).lastHit <= Date.now(), 'lastHit defaults to now');
        const all = s.all();
        assert.deepStrictEqual(all.map((x) => x.id), [A, B], 'newest lastHit first (A was given a later one)');
        assert.strictEqual(all[0].slug, 'one');
        assert.strictEqual(s.remove(A), true);
        assert.strictEqual(s.remove(A), false);
        assert.strictEqual(s.get(A), null);
        assert.deepStrictEqual(s.all().map((x) => x.id), [B]);
        s.close();
    });

    await ok('records are copies, not references', () => {
        const s = lib.open(fileOf());
        const input = { slug: 'one', nested: { a: 1 } };
        s.put(A, input);
        input.slug = 'changed';
        input.nested.a = 2;
        assert.strictEqual(s.get(A).slug, 'one');
        assert.strictEqual(s.get(A).nested.a, 1);
        const out = s.get(A);
        out.slug = 'x';
        out.nested.a = 9;
        assert.strictEqual(s.get(A).slug, 'one');
        assert.strictEqual(s.get(A).nested.a, 1);
        s.all()[0].slug = 'y';
        assert.strictEqual(s.get(A).slug, 'one');
        assert.ok(!('lastHit' in input), 'the caller\'s object is left alone');
        s.close();
    });

    await ok('ttl: an expired record is gone (and removed); touched ones live on', () => {
        const s = lib.open(fileOf(), { ttlMs: 1000 });
        s.put(A, { slug: 'old', lastHit: Date.now() - 5000 });
        s.put(B, { slug: 'fresh' });
        assert.strictEqual(s.get(A), null);
        assert.strictEqual(s.touch(A, { x: 1 }), false);
        assert.deepStrictEqual(s.all().map((x) => x.id), [B]);
        s.put(C, { slug: 'edge', lastHit: Date.now() - 900 });
        assert.ok(s.get(C));
        s.close();
    });

    await ok('max: the records with the oldest lastHit are dropped', () => {
        const s = lib.open(fileOf(), { max: 3 });
        const now = Date.now();
        s.put(idOf(1), { lastHit: now - 400 });
        s.put(idOf(2), { lastHit: now - 100 });
        s.put(idOf(3), { lastHit: now - 300 });
        s.put(idOf(4), { lastHit: now - 200 });
        assert.deepStrictEqual(s.all().map((x) => x.id), [idOf(2), idOf(4), idOf(3)]);
        assert.strictEqual(s.get(idOf(1)), null);
        s.put(idOf(5), { lastHit: now - 500 });
        assert.strictEqual(s.get(idOf(5)), null, 'the new one is the oldest: it goes');
        assert.strictEqual(s.all().length, 3);
        s.close();
    });

    await ok('bad ids: put ignores them, get / touch / remove say no', () => {
        const s = lib.open(fileOf());
        for (const bad of ['', 'abc', 'A'.repeat(24), 'g'.repeat(24), 'a'.repeat(23), 'a'.repeat(25), '../etc/passwd', null, undefined, 12]) {
            assert.strictEqual(s.put(bad, { x: 1 }), false, String(bad));
            assert.strictEqual(s.get(bad), null);
            assert.strictEqual(s.touch(bad, { x: 2 }), false);
            assert.strictEqual(s.remove(bad), false);
        }
        assert.strictEqual(s.put(A, 'not an object'), false);
        assert.strictEqual(s.put(A, null), false);
        assert.strictEqual(s.all().length, 0);
        s.close();
    });

    await ok('a missing, empty or garbage file is an empty store', () => {
        const f = fileOf();
        assert.deepStrictEqual(lib.open(f).all(), []);
        lib._test.forgetOpen();
        fs.mkdirSync(path.dirname(f), { recursive: true });
        for (const text of ['', '{', 'null', '[]', '{"v":1}', '{"v":1,"sessions":[]}', '\u0000\u0001garbage']) {
            fs.writeFileSync(f, text);
            assert.deepStrictEqual(lib.open(f).all(), [], JSON.stringify(text));
            lib._test.forgetOpen();
        }
        // a file with a bad id or a bad record among good ones keeps the good ones
        fs.writeFileSync(f, JSON.stringify({ v: 1, sessions: { [A]: { slug: 'good', lastHit: Date.now() }, nope: { slug: 'x', lastHit: Date.now() }, [B]: 'text' } }));
        const s = lib.open(f);
        assert.deepStrictEqual(s.all().map((x) => x.id), [A]);
        s.close();
    });

    await ok('writes are atomic, coalesced, mode 0600, and a second open reads them', async () => {
        const f = fileOf();
        const s = lib.open(f);
        s.put(A, { slug: 'one', mode: '480' });
        s.put(B, { slug: 'two', mode: '360' });
        s.remove(B);
        s.put(C, { slug: 'three', mode: '160' });
        assert.ok(!fs.existsSync(f), 'not written inside the call');
        await tick();
        assert.ok(fs.existsSync(f), 'written on the next tick');
        assert.ok(!fs.existsSync(`${f}.tmp`), 'no temp file left');
        assert.strictEqual(fs.statSync(f).mode & 0o777, 0o600);
        const j = read(f);
        assert.strictEqual(j.v, 1);
        assert.deepStrictEqual(Object.keys(j.sessions).sort(), [A, C]);
        // a second store on the same file (as after a restart)
        lib._test.forgetOpen();
        const s2 = lib.open(f);
        assert.notStrictEqual(s2, s);
        assert.strictEqual(s2.get(A).slug, 'one');
        assert.strictEqual(s2.get(C).mode, '160');
        assert.strictEqual(s2.get(B), null);
        s.close();
        s2.close();
    });

    await ok('put and remove make one write for any number of calls', async () => {
        const f = fileOf();
        const s = lib.open(f);
        const real = fs.renameSync;
        let renames = 0;
        fs.renameSync = (...a) => { renames++; return real(...a); };
        try {
            for (let i = 1; i <= 10; i++) s.put(idOf(i), { i });
            s.remove(idOf(1));
            await tick();
            await tick();
            assert.strictEqual(renames, 1);
        } finally { fs.renameSync = real; }
        s.close();
    });

    await ok('touch is debounced: at most one write per touchWriteMs, by a one-shot timer', async () => {
        const f = fileOf();
        const s = lib.open(f, { touchWriteMs: 150 });
        s.put(A, { slug: 'one' });
        await tick();
        const before = read(f).sessions[A].lastHit;
        const real = fs.renameSync;
        let renames = 0;
        fs.renameSync = (...x) => { renames++; return real(...x); };
        const timers = [];
        const realSet = global.setTimeout;
        global.setTimeout = (fn, ms, ...rest) => { const t = realSet(fn, ms, ...rest); timers.push({ ms, t }); return t; };
        try {
            await wait(5);
            s.touch(A, { lastHit: before + 1000 });
            s.touch(A, { lastHit: before + 2000 });
            s.touch(A, { lastHit: before + 3000 });
            assert.strictEqual(timers.filter((x) => x.ms === 150).length, 1, 'one timer armed for any number of touches');
            assert.strictEqual(timers.find((x) => x.ms === 150).t.hasRef(), false, 'unref\'d');
            await tick();
            assert.strictEqual(renames, 0, 'no write yet');
            assert.strictEqual(read(f).sessions[A].lastHit, before);
            await wait(250);
            assert.strictEqual(renames, 1, 'one write after the delay');
            assert.strictEqual(read(f).sessions[A].lastHit, before + 3000);
            // a touch that changes nothing arms nothing
            const armed = timers.length;
            s.touch(A, { lastHit: before + 3000 });
            assert.strictEqual(timers.length, armed);
            // a put in between writes everything at once, and the pending touch timer then finds nothing to do
            s.touch(A, { lastHit: before + 4000 });
            s.put(B, { slug: 'two' });
            await tick();
            assert.strictEqual(renames, 2);
            assert.strictEqual(read(f).sessions[A].lastHit, before + 4000);
            await wait(250);
            assert.strictEqual(renames, 2, 'the timer fired with nothing unwritten');
        } finally { fs.renameSync = real; global.setTimeout = realSet; }
        s.close();
    });

    await ok('flush writes now and cancels the timers; close flushes and lets a new open read afresh', async () => {
        const f = fileOf();
        const s = lib.open(f, { touchWriteMs: 60000 });
        s.put(A, { slug: 'one' });
        s.flush();
        assert.ok(fs.existsSync(f), 'written inside flush');
        s.touch(A, { lastHit: 42 + Date.now() });
        const want = s.get(A).lastHit;
        assert.notStrictEqual(read(f).sessions[A].lastHit, want);
        s.flush();
        assert.strictEqual(read(f).sessions[A].lastHit, want);
        s.put(B, { slug: 'two' });
        s.close();
        assert.ok(read(f).sessions[B], 'close flushed');
        await tick();
        const again = lib.open(f);
        assert.notStrictEqual(again, s, 'a closed store is not handed out again');
        assert.strictEqual(again.get(B).slug, 'two');
        again.close();
    });

    await ok('the same file gives the same store object', () => {
        const f = fileOf();
        const a = lib.open(f);
        const b = lib.open(path.join(path.dirname(f), '.', 'sessions.json'));
        assert.strictEqual(a, b);
        assert.notStrictEqual(lib.open(fileOf()), a);
        a.close();
    });

    await ok('a write error never throws: one warning, the store carries on in memory', async () => {
        const blocker = path.join(tmp, 'a-regular-file');
        fs.writeFileSync(blocker, 'x');
        const f = path.join(blocker, 'inside', 'sessions.json');
        const warns = [];
        const realWarn = console.warn;
        console.warn = (...a) => warns.push(a.join(' '));
        try {
            const s = lib.open(f);
            assert.strictEqual(s.put(A, { slug: 'one' }), true);
            await tick();
            s.put(B, { slug: 'two' });
            s.touch(A, { x: 1 });
            s.flush();
            s.remove(B);
            await tick();
            s.flush();
            assert.strictEqual(s.get(A).slug, 'one');
            assert.strictEqual(s.get(A).x, 1);
            assert.strictEqual(s.get(B), null);
            assert.strictEqual(warns.length, 1, `one warning, got ${warns.length}`);
            assert.ok(/^\[videos\] session records could not be written: /.test(warns[0]));
            s.close();
        } finally { console.warn = realWarn; }
        assert.ok(!fs.existsSync(`${f}.tmp`));
    });

    await ok('ReviveBudget: the gap is 20 s, 20 s, 40 s, 80 s ... up to 5 minutes', () => {
        const b = new lib.ReviveBudget({ maxInWindow: 99, windowMs: 1e9 });
        let t = 1000;
        assert.strictEqual(b.take(A, t), true);
        assert.strictEqual(b.waitMs(A, t), 20000);
        assert.strictEqual(b.take(A, t + 19999), false, 'not before the gap');
        assert.strictEqual(b.waitMs(A, t + 19999), 1);
        t += 20000;
        assert.strictEqual(b.take(A, t), true, '2nd take: 20 s after the 1st');
        assert.strictEqual(b.waitMs(A, t), 40000);
        assert.strictEqual(b.take(A, t + 39999), false);
        t += 40000;
        assert.strictEqual(b.take(A, t), true, '3rd: 40 s after the 2nd');
        assert.strictEqual(b.waitMs(A, t), 80000);
        t += 80000;
        assert.strictEqual(b.take(A, t), true, '4th: 80 s after the 3rd');
        assert.strictEqual(b.waitMs(A, t), 160000);
        t += 160000;
        assert.strictEqual(b.take(A, t), true);
        assert.strictEqual(b.waitMs(A, t), 300000, 'the cap (320 s would be next)');
        t += 300000;
        assert.strictEqual(b.take(A, t), true);
        assert.strictEqual(b.waitMs(A, t), 300000, 'and it stays there');
        assert.strictEqual(b.waitMs(B, t), 0, 'another id has its own gap');
        assert.strictEqual(b.take(B, t), true);
    });

    await ok('ReviveBudget: five in the window, then no, until the oldest has left it', () => {
        const b = new lib.ReviveBudget({ minGapMs: 1000, maxGapMs: 1000, windowMs: 100000, maxInWindow: 5 });
        for (let i = 0; i < 5; i++) assert.strictEqual(b.take(A, 1000 + i * 1000), true, `take ${i + 1}`);
        // the 5th was at 5000: the gap is over at 6000 but the window holds five
        assert.strictEqual(b.take(A, 6000), false);
        assert.strictEqual(b.take(A, 50000), false);
        assert.strictEqual(b.waitMs(A, 6000), 1000 + 100000 - 6000, 'until the 1st take leaves the window');
        assert.strictEqual(b.take(A, 100999), false);
        assert.strictEqual(b.take(A, 101000), true);
        assert.strictEqual(b.take(A, 101500), false, 'the gap again');
        assert.strictEqual(b.waitMs(A, 101500), 500);
        // a refused take counts nothing
        const c = new lib.ReviveBudget({ minGapMs: 1000, maxGapMs: 1000, windowMs: 10000, maxInWindow: 2 });
        assert.strictEqual(c.take(A, 0), true);
        for (let i = 0; i < 20; i++) assert.strictEqual(c.take(A, 500), false);
        assert.strictEqual(c.take(A, 1000), true);
        assert.strictEqual(c.take(A, 5000), false);
        assert.strictEqual(c.take(A, 10000), true, 'the first take left the window');
    });

    await ok('ReviveBudget: proven() starts the gap over but keeps the count; forget() drops everything', () => {
        const b = new lib.ReviveBudget({ minGapMs: 1000, maxGapMs: 8000, windowMs: 1e6, maxInWindow: 4 });
        let t = 0;
        assert.strictEqual(b.take(A, t), true);
        t += 1000;
        assert.strictEqual(b.take(A, t), true);
        t += 2000;
        assert.strictEqual(b.take(A, t), true);
        assert.strictEqual(b.waitMs(A, t), 4000, 'three that never played: 4 s');
        b.proven(A);
        assert.strictEqual(b.waitMs(A, t), 1000, 'the gap starts over');
        t += 1000;
        assert.strictEqual(b.take(A, t), true, '4th take, allowed after the short gap');
        t += 1000;
        assert.strictEqual(b.take(A, t), false, 'the count in the window stays: four are used');
        assert.ok(b.waitMs(A, t) > 1e5);
        b.forget(A);
        assert.strictEqual(b.waitMs(A, t), 0);
        assert.strictEqual(b.take(A, t), true);
        b.proven('unknown id is fine');
        b.forget('neither is this');
    });

    await ok('ReviveBudget: an id not taken within the window is dropped by the next take, no timer', () => {
        const b = new lib.ReviveBudget({ minGapMs: 1000, windowMs: 5000 });
        b.take(A, 0);
        b.take(B, 0);
        assert.strictEqual(b.entries.size, 2);
        assert.strictEqual(b.take(C, 5000), true);
        assert.strictEqual(b.entries.size, 1, 'A and B are gone');
        // a fresh start for a dropped id: the gap counts from nothing
        assert.strictEqual(b.take(A, 5001), true);
        assert.strictEqual(b.waitMs(A, 5001), 1000);
    });

    await ok('defaults: 20 s, 5 min, 10 min window, 5 tries', () => {
        const b = new lib.ReviveBudget();
        assert.deepStrictEqual([b.minGapMs, b.maxGapMs, b.windowMs, b.maxInWindow], [20000, 300000, 600000, 5]);
    });

    lib._test.forgetOpen();
    console.log(`\n${pass} passed${process.exitCode ? ', with failures' : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(process.exitCode || 0);
})();
