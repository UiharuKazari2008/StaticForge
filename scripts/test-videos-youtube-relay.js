#!/usr/bin/env node
/**
 * modules/videosYoutubeRelay.js (Yozora #920) without YouTube, yt-dlp or ffmpeg: the format asked of yt-dlp per
 * mode, the ffmpeg command (picture and sound from pipes, a start place, copy or a light encode), and a
 * session's life (start, the same request joined, a new place replacing it, stop). Also (StaticForge #1365) an
 * address that outlives its session: the record, adopt (a video written whole comes back from its files),
 * revive (the same address starts again, behind the catch-up gate, within a budget), and a module reload.
 * A real express app answers the route; the store and the budget are in-memory fakes.
 *
 *   node scripts/test-videos-youtube-relay.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-relay-test-'));
process.env.VIDEOS_YT_DIR = path.join(tmp, 'yt');
process.env.VIDEOS_YT_STORE = path.join(tmp, 'sessions.json'); // never the real one
const relay = require('../modules/videosYoutubeRelay');
const T = relay._test;

const tests = [];
const ok = (name, fn) => tests.push([name, fn]);
const SRC = { title: 'A video', duration: 600, formats: ['135', '140'], json: '{}', copy: true, audioOnly: false, height: 480, kbit: 500 };
const spawned = [];
function fakeSpawn(args, session) {
    const child = new EventEmitter();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); };
    spawned.push({ args, child, session });
    // ffmpeg writes its list a moment later
    setTimeout(() => { try { fs.writeFileSync(path.join(session.dir, 'index.m3u8'), '#EXTM3U\n#EXTINF:4,\ns00000.ts\n'); } catch (_e) { /* stopped */ } }, 30);
    return child;
}
function fresh(src, spawnFn) {
    T.reset(); spawned.length = 0; fresh.asked = [];
    try { fs.rmSync(process.env.VIDEOS_YT_DIR, { recursive: true, force: true }); } catch (_e) { /* none */ }
    T.setHooks({ info: async (id, mode) => { fresh.asked.push([id, mode.id]); if (src instanceof Error) throw src; return src || SRC; }, spawn: spawnFn || fakeSpawn });
    T.setStore(fresh.store = fakeStore());
    T.setBudget(fresh.budget = fakeBudget());
}

// ---- fakes for the record store and the revive budget (the contract of modules/videosRelayStore.js)
function fakeStore() {
    const m = new Map();
    const calls = { put: [], touch: [], remove: [], flush: 0 };
    return {
        calls, m,
        put(id, r) { calls.put.push(id); m.set(id, Object.assign({}, r, { lastHit: r.lastHit || Date.now() })); return true; },
        get(id) { const r = m.get(id); return r ? Object.assign({}, r) : null; },
        touch(id, patch) { const r = m.get(id); if (!r) return false; calls.touch.push([id, Object.assign({}, patch)]); Object.assign(r, patch); return true; },
        remove(id) { calls.remove.push(id); return m.delete(id); },
        all() { return [...m].map(([id, r]) => Object.assign({ id }, r)).sort((a, b) => b.lastHit - a.lastHit); },
        flush() { calls.flush++; },
        close() {}
    };
}
function fakeBudget(gap) {
    const g = gap || 20000;
    const last = new Map();
    return {
        taken: [], provenIds: [], forgotten: [],
        take(id, now) { if (last.has(id) && now - last.get(id) < g) return false; last.set(id, now); this.taken.push(id); return true; },
        waitMs(id, now) { return last.has(id) ? Math.max(0, last.get(id) + g - now) : 0; },
        proven(id) { last.delete(id); this.provenIds.push(id); },
        forget(id) { last.delete(id); this.forgotten.push(id); }
    };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) { const t = Date.now(); while (Date.now() - t < (ms || 3000)) { if (fn()) return; await sleep(5); } throw new Error('timed out waiting'); }
const newId = () => crypto.randomBytes(12).toString('hex');
const rec = (over) => Object.assign({ video: 'abcdefghijk', mode: 'v480', at: 0, startedAt: Date.now(), lastHit: Date.now(), maxSeg: 0, done: false, duration: 600, title: 'A video', height: 480, kbit: 500, copied: true }, over);
const pad = (i) => String(i).padStart(5, '0');
const ROOT = () => process.env.VIDEOS_YT_DIR;

/** A spawn that writes nothing: the test writes the encoder's pieces itself. */
function ctlSpawn(args, session) {
    const child = new EventEmitter();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', null)); };
    spawned.push({ args, child, session });
    return child;
}
/** What the encoder has written: n pieces and a list of them (closed when `end`). */
function writePieces(dir, n, end) {
    fs.mkdirSync(dir, { recursive: true });
    let t = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:4\n';
    for (let i = 0; i < n; i++) { fs.writeFileSync(path.join(dir, `s${pad(i)}.ts`), 'x'); t += `#EXTINF:4,\ns${pad(i)}.ts\n`; }
    if (end) t += '#EXT-X-ENDLIST\n';
    fs.writeFileSync(path.join(dir, 'index.m3u8'), t);
}
/** The route on a real express app (ephemeral port, no auth); fn(get) with get(id, file) -> { status, retry, cache, body }. */
async function withServer(fn) {
    const express = require('express');
    const app = express();
    relay.mount(app, (_q, _r, next) => next());
    const srv = await new Promise((resolve) => { const sv = app.listen(0, '127.0.0.1', () => resolve(sv)); });
    const base = `http://127.0.0.1:${srv.address().port}`;
    const get = async (id, file) => {
        const r = await fetch(`${base}/api/videos/yt/${id}/${file}`);
        const body = await r.text();
        return { status: r.status, retry: Number(r.headers.get('retry-after')) || 0, cache: r.headers.get('cache-control') || '', body };
    };
    try { await fn(get); } finally { if (srv.closeAllConnections) srv.closeAllConnections(); await new Promise((r) => srv.close(r)); }
}
function quietWarn() { const w = console.warn; const l = console.log; const seen = { warn: [], log: [] }; console.warn = (m) => seen.warn.push(String(m)); console.log = (m) => seen.log.push(String(m)); return { seen, back() { console.warn = w; console.log = l; } }; }

ok('each mode asks yt-dlp for H.264 + AAC no taller than its height; Audio First for the sound alone', () => {
    const f = T.formatFor(T.MODES.find((m) => m.id === 'v480'));
    assert.ok(f.startsWith('bv*[height<=480][vcodec^=avc1]+ba[acodec^=mp4a]'));
    assert.ok(!/1080|720/.test(f));
    assert.strictEqual(T.formatFor(T.MODES.find((m) => m.id === 'vaudio')), 'ba[acodec^=mp4a]/ba');
});

ok('ffmpeg reads picture and sound from pipes (yt-dlp downloads), from the start place, mapped, copied into a growing list', () => {
    const a = T.ffmpegArgs(SRC, 120, '/d');
    const s = a.join(' ');
    assert.ok(s.includes('-ss 120 -i pipe:0 -ss 120 -i pipe:3'));
    assert.ok(s.includes('-map 0:v:0 -map 1:a:0 -c copy'));
    assert.ok(s.includes('-hls_playlist_type event'));
    assert.ok(!T.ffmpegArgs(SRC, 0, '/d').includes('-ss'));
    assert.ok(!s.includes('http'), 'no address is handed to ffmpeg');
    const enc = T.ffmpegArgs(Object.assign({}, SRC, { copy: false }), 0, '/d').join(' ');
    assert.ok(enc.includes('libx264') && enc.includes('-c:a aac') && !enc.includes('-c copy'));
    const one = T.ffmpegArgs(Object.assign({}, SRC, { formats: ['140'], audioOnly: true }), 0, '/d').join(' ');
    assert.ok(one.includes('-i pipe:0') && !one.includes('pipe:3') && !one.includes('-map'));
    const t = T.toolArgs('/d/info.json', '135');
    assert.deepStrictEqual(t.slice(0, 2), ['--load-info-json', '/d/info.json']);
    assert.deepStrictEqual(t.slice(-4), ['-f', '135', '-o', '-']);
});

ok('a session starts, the same request joins it, another place replaces it, stop removes the files', async () => {
    fresh();
    const a = await relay.start('abcdefghijk', 'v480', 0);
    assert.strictEqual(a.state, 'live');
    assert.strictEqual(a.duration, 600);
    assert.ok(/^\/api\/videos\/yt\/[0-9a-f]{24}\/index\.m3u8$/.test(a.url));
    const b = await relay.start('abcdefghijk', 'v480', 0);
    assert.strictEqual(b.id, a.id);
    assert.strictEqual(spawned.length, 1);
    const c = await relay.start('abcdefghijk', 'v480', 300);
    assert.notStrictEqual(c.id, a.id);
    assert.strictEqual(c.at, 300);
    assert.strictEqual(relay.state(a.id).state, 'gone');
    assert.strictEqual(T.sessions.size, 1);
    const dir = path.join(process.env.VIDEOS_YT_DIR, c.id);
    assert.ok(fs.existsSync(dir));
    assert.strictEqual(await relay.stop(c.id), true);
    assert.ok(!fs.existsSync(dir));
});

ok('what yt-dlp refuses fails the start (the program then uses YouTube\'s own player); bad ids and places too', async () => {
    const e = new relay.YtRelayError('Sign in to confirm your age', 'YT_REFUSED');
    fresh(e);
    await assert.rejects(() => relay.start('abcdefghijk', 'v480', 0), /confirm your age/);
    assert.strictEqual(T.sessions.size, 0);
    fresh();
    await assert.rejects(() => relay.start('../../etc', 'v480', 0), /not a video/);
    await assert.rejects(() => relay.start('abcdefghijk', 'v480', 9999), /past the end/);
});

ok('ffmpeg finishing closes the session as done; breaking off marks it an error', async () => {
    fresh();
    const a = await relay.start('abcdefghijk', 'v360', 0);
    spawned[0].child.emit('close', 0);
    assert.strictEqual(relay.state(a.id).state, 'done');
    const b = await relay.start('lmnopqrstuv', 'v360', 0);
    spawned[1].child.emit('close', 1);
    assert.strictEqual(relay.state(b.id).state, 'error');
});

ok('SponsorBlock: only a hash prefix is sent, the wanted video is picked from the answer, whole-skip parts in order, kept for later', async () => {
    const sb = require('../modules/videosSponsorBlock');
    const crypto = require('crypto');
    sb._test.reset();
    const asked = [];
    sb._test.setFetch(async (url) => {
        asked.push(String(url));
        return { status: 200, json: async () => [
            { videoID: 'otherVideo1', segments: [{ segment: [1, 2], category: 'sponsor', actionType: 'skip' }] },
            { videoID: 'abcdefghijk', segments: [{ segment: [300.04, 360.5], category: 'sponsor', actionType: 'skip' }, { segment: [10, 20], category: 'intro', actionType: 'skip' }, { segment: [50, 60], category: 'sponsor', actionType: 'mute' }, { segment: [5, 5], category: 'sponsor', actionType: 'skip' }] }
        ] };
    });
    const r = await sb.segments('abcdefghijk');
    assert.deepStrictEqual(r, [{ start: 10, end: 20, category: 'intro' }, { start: 300, end: 360.5, category: 'sponsor' }]);
    assert.ok(asked[0].includes(`/api/skipSegments/${crypto.createHash('sha256').update('abcdefghijk').digest('hex').slice(0, 4)}?`));
    assert.ok(!asked[0].includes('abcdefghijk'), 'the video id itself is not sent');
    await sb.segments('abcdefghijk');
    assert.strictEqual(asked.length, 1);
    sb._test.setFetch(async () => { throw new Error('down'); });
    assert.deepStrictEqual(await sb.segments('lmnopqrstuv'), []);
    assert.deepStrictEqual(await sb.segments('bad id'), []);
    sb._test.setFetch(null);
});


// ------------------------------------------------------------------------------------------ an address outlives its session (#1365)

ok('an address nobody knows is a 404 and starts nothing (also a malformed one)', async () => {
    fresh();
    await withServer(async (get) => {
        assert.strictEqual((await get(newId(), 'index.m3u8')).status, 404);
        assert.strictEqual((await get('nothex', 'index.m3u8')).status, 404);
        assert.strictEqual(fresh.asked.length, 0);
        assert.strictEqual(spawned.length, 0);
    });
});

ok('a record with no session (the restart case): the playlist answers 503 + Retry-After and one start at the record\'s place; a second request joins it', async () => {
    fresh(null, ctlSpawn);
    const id = newId();
    fresh.store.put(id, rec({ at: 120 }));
    const q = quietWarn();
    try {
        await withServer(async (get) => {
            const a = await get(id, 'index.m3u8');
            assert.strictEqual(a.status, 503);
            assert.ok(a.retry >= 1 && a.retry <= 300);
            assert.strictEqual(a.cache, 'no-store');
            assert.strictEqual(a.body, '');
            await until(() => spawned.length === 1);
            assert.ok(spawned[0].args.join(' ').includes('-ss 120 -i pipe:0'), 'the record\'s place');
            assert.strictEqual(spawned[0].session.id, id, 'the same address');
            assert.strictEqual(spawned[0].session.dir, path.join(ROOT(), id), 'the same folder');
            const b = await get(id, 'index.m3u8');
            assert.strictEqual(b.status, 503);
            await sleep(50);
            assert.strictEqual(spawned.length, 1);
            assert.strictEqual(fresh.asked.length, 1);
            assert.deepStrictEqual(fresh.budget.taken, [id]);
            assert.strictEqual((await get(id, 's00000.ts')).status, 404, 'a piece that is not written yet');
        });
    } finally { q.back(); }
});

ok('the catch-up gate: the list is held back until it covers the old place + 8 pieces (or ends); pieces are served at once; the gate stays open', async () => {
    fresh(null, ctlSpawn);
    const id = newId();
    fresh.store.put(id, rec({ maxSeg: 20 }));
    const q = quietWarn();
    try {
        await withServer(async (get) => {
            await get(id, 'index.m3u8');
            await until(() => spawned.length === 1);
            const dir = spawned[0].session.dir;
            writePieces(dir, 5);
            const a = await get(id, 'index.m3u8');
            assert.strictEqual(a.status, 503);
            assert.strictEqual(a.retry, 2);
            assert.strictEqual((await get(id, 's00003.ts')).status, 200, 'a piece is served as soon as it exists');
            writePieces(dir, 27);
            assert.strictEqual((await get(id, 'index.m3u8')).status, 503, '27 of 28');
            assert.deepStrictEqual(fresh.budget.provenIds, []);
            writePieces(dir, 28);
            const ok1 = await get(id, 'index.m3u8');
            assert.strictEqual(ok1.status, 200);
            assert.strictEqual(ok1.cache, 'no-store');
            assert.ok(ok1.body.includes('s00027.ts'));
            assert.deepStrictEqual(fresh.budget.provenIds, [], 'not proven before pieces were served');
            for (let i = 0; i < 3; i++) assert.strictEqual((await get(id, `s${pad(i)}.ts`)).status, 200);
            assert.deepStrictEqual(fresh.budget.provenIds, [id], 'the gate opened and 3 pieces were served');
            writePieces(dir, 3);
            assert.strictEqual((await get(id, 'index.m3u8')).status, 200, 'once open it stays open');
        });
        // a list that ends with fewer pieces opens the gate too
        fresh(null, ctlSpawn);
        const id2 = newId();
        fresh.store.put(id2, rec({ maxSeg: 20 }));
        await withServer(async (get) => {
            await get(id2, 'index.m3u8');
            await until(() => spawned.length === 1);
            writePieces(spawned[0].session.dir, 5, true);
            assert.strictEqual((await get(id2, 'index.m3u8')).status, 200);
        });
        // and so does a pull that ended 'done'
        fresh(null, ctlSpawn);
        const id3 = newId();
        fresh.store.put(id3, rec({ maxSeg: 20 }));
        await withServer(async (get) => {
            await get(id3, 'index.m3u8');
            await until(() => spawned.length === 1);
            writePieces(spawned[0].session.dir, 5);
            assert.strictEqual((await get(id3, 'index.m3u8')).status, 503);
            spawned[0].child.emit('close', 0);
            assert.strictEqual((await get(id3, 'index.m3u8')).status, 200);
        });
    } finally { q.back(); }
});

ok('adopt: a video written whole comes back from its files after sweep() with no request to YouTube; an incomplete folder goes and the address starts again', async () => {
    fresh();
    const whole = newId(); const partial = newId(); const stray = newId();
    fresh.store.put(whole, rec({ done: true }));
    fresh.store.put(partial, rec({ done: true, video: 'lmnopqrstuv' }));
    writePieces(path.join(ROOT(), whole), 3, true);
    writePieces(path.join(ROOT(), partial), 3, false);
    writePieces(path.join(ROOT(), stray), 2, true);
    await relay.sweep();
    assert.ok(fs.existsSync(path.join(ROOT(), whole)), 'a whole video stays');
    assert.ok(!fs.existsSync(path.join(ROOT(), partial)), 'an incomplete folder goes');
    assert.ok(!fs.existsSync(path.join(ROOT(), stray)), 'a folder with no record goes');
    assert.strictEqual(fresh.store.get(partial).done, false);
    assert.strictEqual(fresh.store.get(whole).done, true);
    const q = quietWarn();
    try {
        await withServer(async (get) => {
            const a = await get(whole, 'index.m3u8');
            assert.strictEqual(a.status, 200);
            assert.ok(a.body.includes('#EXT-X-ENDLIST'));
            assert.strictEqual((await get(whole, 's00001.ts')).status, 200);
            assert.strictEqual(fresh.asked.length, 0);
            assert.strictEqual(spawned.length, 0);
            assert.strictEqual(fresh.budget.taken.length, 0);
            assert.strictEqual(T.sessions.get(whole).state, 'done');
            assert.strictEqual(relay.state(whole).title, 'A video');
            assert.ok(q.seen.log.some((l) => l.includes('taken back from its files')));
            const b = await get(partial, 'index.m3u8');
            assert.strictEqual(b.status, 503);
            await until(() => spawned.length === 1);
            assert.deepStrictEqual(fresh.asked, [['lmnopqrstuv', 'v480']]);
            assert.deepStrictEqual(fresh.budget.taken, [partial]);
        });
    } finally { q.back(); }
});

ok('stop(id) removes the record; the idle end keeps it and the address starts again; a new start at another place removes the old record', async () => {
    fresh();
    const a = await relay.start('abcdefghijk', 'v480', 0);
    const r = fresh.store.get(a.id);
    assert.ok(r && r.video === 'abcdefghijk' && r.mode === 'v480' && r.at === 0 && r.done === false && r.maxSeg === 0 && r.duration === 600 && r.title === 'A video' && r.height === 480 && r.kbit === 500 && r.copied === true);
    await relay.stop(a.id);
    assert.strictEqual(fresh.store.get(a.id), null);
    await withServer(async (get) => {
        assert.strictEqual((await get(a.id, 'index.m3u8')).status, 404);
        assert.strictEqual(spawned.length, 1);
        // the idle end
        const b = await relay.start('abcdefghijk', 'v480', 0);
        T.sessions.get(b.id).lastHit = Date.now() - 21 * 60000;
        T.idleTick();
        assert.ok(!T.sessions.has(b.id));
        assert.ok(fresh.store.get(b.id), 'the idle end keeps the record');
        await until(() => !fs.existsSync(path.join(ROOT(), b.id)));
        const q = quietWarn();
        try {
            assert.strictEqual((await get(b.id, 'index.m3u8')).status, 503);
            await until(() => spawned.length === 3);
            assert.strictEqual(spawned[2].session.id, b.id);
            await until(() => T.sessions.get(b.id) && T.sessions.get(b.id).state === 'live');
        } finally { q.back(); }
    });
    // the viewer moved: the old address is dead for good
    fresh();
    const c = await relay.start('abcdefghijk', 'v480', 0);
    const d = await relay.start('abcdefghijk', 'v480', 300);
    assert.strictEqual(fresh.store.get(c.id), null);
    assert.strictEqual(fresh.store.get(d.id).at, 300);
    // a record of the same video at another place, with no session in memory, goes too
    const lost = newId();
    fresh.store.put(lost, rec({ at: 50 }));
    await relay.start('abcdefghijk', 'v480', 300);
    const e = await relay.start('abcdefghijk', 'v360', 300);
    assert.strictEqual(fresh.store.get(lost), null);
    assert.strictEqual(fresh.store.get(d.id), null);
    assert.strictEqual(fresh.store.all().length, 1);
    assert.strictEqual(fresh.store.all()[0].id, e.id);
});

ok('a start at the same place and quality takes the old address along: it serves the new session\'s list; stopping the video ends both', async () => {
    fresh();
    const a = await relay.start('abcdefghijk', 'v480', 0);
    T.sessions.get(a.id).lastHit = Date.now() - 21 * 60000;
    T.idleTick();
    await until(() => !fs.existsSync(path.join(ROOT(), a.id)));
    const b = await relay.start('abcdefghijk', 'v480', 0);
    assert.notStrictEqual(b.id, a.id);
    assert.strictEqual(T.aliases.get(a.id), b.id);
    assert.ok(fresh.store.get(a.id), 'its record stays');
    await withServer(async (get) => {
        const r = await get(a.id, 'index.m3u8');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.includes('#EXTINF'));
        assert.strictEqual(relay.state(a.id).id, b.id);
        assert.strictEqual(spawned.length, 2, 'nothing started for the old address');
        await relay.stop(b.id);
        assert.strictEqual(fresh.store.get(a.id), null);
        assert.strictEqual(fresh.store.get(b.id), null);
        assert.strictEqual(T.aliases.size, 0);
        assert.strictEqual((await get(a.id, 'index.m3u8')).status, 404);
    });
});

ok('a piece of a dead address never brings it back', async () => {
    fresh();
    const id = newId();
    fresh.store.put(id, rec());
    await withServer(async (get) => {
        assert.strictEqual((await get(id, 's00000.ts')).status, 404);
        await sleep(30);
        assert.strictEqual(fresh.asked.length, 0);
        assert.strictEqual(spawned.length, 0);
        assert.strictEqual(fresh.budget.taken.length, 0);
    });
});

ok('a session that broke part way is started again in place by a playlist request, within the budget', async () => {
    fresh(null, (args, session) => (spawned.length === 0 ? fakeSpawn(args, session) : ctlSpawn(args, session)));
    const a = await relay.start('abcdefghijk', 'v480', 40);
    const old = T.sessions.get(a.id);
    spawned[0].child.emit('close', 1);
    assert.strictEqual(relay.state(a.id).state, 'error');
    const q = quietWarn();
    try {
        await withServer(async (get) => {
            assert.strictEqual((await get(a.id, 'index.m3u8')).status, 503);
            await until(() => spawned.length === 2);
            const now = T.sessions.get(a.id);
            assert.notStrictEqual(now, old);
            assert.ok(now.revived);
            assert.ok(spawned[1].args.join(' ').includes('-ss 40'));
            assert.ok(fresh.store.get(a.id), 'the record stays');
            assert.deepStrictEqual(fresh.budget.taken, [a.id]);
            // broken again at once: the budget says wait
            spawned[1].child.emit('close', 1);
            assert.strictEqual(T.sessions.get(a.id).state, 'error');
            const r = await get(a.id, 'index.m3u8');
            assert.strictEqual(r.status, 503);
            assert.ok(r.retry >= 1);
            await sleep(50);
            assert.strictEqual(spawned.length, 2);
        });
    } finally { q.back(); }
});

ok('budget: a failed revive keeps the record and the next request within the gap asks nobody; "live" removes the record for good', async () => {
    fresh(new Error('boom'), ctlSpawn);
    const id = newId();
    fresh.store.put(id, rec());
    let q = quietWarn();
    try {
        await withServer(async (get) => {
            assert.strictEqual((await get(id, 'index.m3u8')).status, 503);
            await until(() => fresh.asked.length === 1 && !T.sessions.has(id));
            assert.ok(fresh.store.get(id), 'a plain failure keeps the record');
            assert.strictEqual(q.seen.warn.length, 1);
            assert.ok(q.seen.warn[0].includes('abcdefghijk'));
            const r = await get(id, 'index.m3u8');
            assert.strictEqual(r.status, 503);
            assert.ok(r.retry >= 1);
            await sleep(30);
            assert.strictEqual(fresh.asked.length, 1, 'no second request to YouTube');
            assert.strictEqual(spawned.length, 0);
            assert.strictEqual(q.seen.warn.length, 1, 'one warning per failed revive, nothing per request');
        });
        fresh(new relay.YtRelayError('A live stream plays in YouTube\'s own player', 'YT_LIVE'), ctlSpawn);
        const live = newId();
        fresh.store.put(live, rec());
        await withServer(async (get) => {
            assert.strictEqual((await get(live, 'index.m3u8')).status, 503);
            await until(() => fresh.store.get(live) === null);
            assert.strictEqual((await get(live, 'index.m3u8')).status, 404);
        });
        // a record that is not a video / mode: removed, nothing asked
        fresh();
        const bad = newId(); const bad2 = newId();
        fresh.store.put(bad, rec({ mode: 'v999' }));
        fresh.store.put(bad2, rec({ video: '../../x' }));
        await withServer(async (get) => {
            assert.strictEqual((await get(bad, 'index.m3u8')).status, 404);
            assert.strictEqual((await get(bad2, 'index.m3u8')).status, 404);
            assert.strictEqual(fresh.store.get(bad), null);
            assert.strictEqual(fresh.store.get(bad2), null);
            assert.strictEqual(fresh.asked.length, 0);
        });
        // past the end of the video: removed
        fresh();
        const past = newId();
        fresh.store.put(past, rec({ at: 5000 }));
        await withServer(async (get) => {
            assert.strictEqual((await get(past, 'index.m3u8')).status, 503);
            await until(() => fresh.store.get(past) === null);
        });
    } finally { q.back(); }
});

ok('a full house: sessions being watched are never pushed out (503); one quiet for over a minute makes room and keeps its record', async () => {
    fresh();
    const a = await relay.start('abcdefghijk', 'v480', 0);
    const b = await relay.start('lmnopqrstuv', 'v480', 0);
    const id = newId();
    fresh.store.put(id, rec({ video: 'wxyzabcdefg' }));
    const q = quietWarn();
    try {
        await withServer(async (get) => {
            assert.strictEqual((await get(id, 'index.m3u8')).status, 503);
            await sleep(30);
            assert.ok(T.sessions.has(a.id) && T.sessions.has(b.id), 'nothing was stopped');
            assert.strictEqual(spawned.length, 2);
            assert.strictEqual(fresh.asked.length, 2);
            assert.strictEqual(fresh.budget.taken.length, 0, 'no budget spent while there is no room');
            T.sessions.get(a.id).lastHit = Date.now() - 61000;
            assert.strictEqual((await get(id, 'index.m3u8')).status, 503);
            await until(() => spawned.length === 3);
            assert.ok(!T.sessions.has(a.id));
            assert.ok(T.sessions.has(b.id) && T.sessions.has(id));
            assert.ok(fresh.store.get(a.id), 'the one that made room keeps its record');
            assert.deepStrictEqual(fresh.budget.taken, [id]);
        });
    } finally { q.back(); }
});

ok('the record learns the highest piece sent and that the video was written whole', async () => {
    fresh();
    const a = await relay.start('abcdefghijk', 'v480', 0);
    const dir = path.join(ROOT(), a.id);
    for (const n of [3, 7]) fs.writeFileSync(path.join(dir, `s${pad(n)}.ts`), 'x');
    const maxes = () => fresh.store.calls.touch.filter(([i, p]) => i === a.id && p.maxSeg !== undefined).map(([, p]) => p.maxSeg);
    await withServer(async (get) => {
        assert.strictEqual((await get(a.id, 's00003.ts')).status, 200);
        assert.strictEqual((await get(a.id, 's00007.ts')).status, 200);
        assert.strictEqual((await get(a.id, 's00003.ts')).status, 200);
        assert.deepStrictEqual(maxes(), [3, 7], 'a touch only when the number grew');
        assert.strictEqual(fresh.store.get(a.id).maxSeg, 7);
        T.sessions.get(a.id).recHit = Date.now() - 6000;
        assert.strictEqual((await get(a.id, 's00003.ts')).status, 200);
        assert.deepStrictEqual(maxes(), [3, 7, 7], 'and when lastHit moved more than 5 s');
        assert.strictEqual((await get(a.id, 's00003.ts')).status, 200);
        assert.deepStrictEqual(maxes(), [3, 7, 7]);
    });
    const flushed = fresh.store.calls.flush;
    spawned[0].child.emit('close', 0);
    assert.ok(fresh.store.calls.touch.some(([i, p]) => i === a.id && p.done === true));
    assert.strictEqual(fresh.store.get(a.id).done, true);
    assert.ok(fresh.store.calls.flush > flushed, 'flushed when the encoder closed with 0');
    const b = await relay.start('lmnopqrstuv', 'v480', 0);
    spawned[1].child.emit('close', 1);
    assert.ok(!fresh.store.calls.touch.some(([i, p]) => i === b.id && p.done === true), 'a broken pull is not done');
});

ok('a reload ends every session like a restart: records stay, whole folders stay, the rest goes; the next request brings the address back', async () => {
    fresh();
    const a = await relay.start('abcdefghijk', 'v480', 0);
    const b = await relay.start('lmnopqrstuv', 'v480', 0);
    const dirA = path.join(ROOT(), a.id); const dirB = path.join(ROOT(), b.id);
    spawned[0].child.emit('close', 0);
    fs.appendFileSync(path.join(dirA, 'index.m3u8'), '#EXT-X-ENDLIST\n'); // ffmpeg closes the list when it finishes
    assert.ok(relay.hot && typeof relay.hot.dispose === 'function' && typeof relay.hot.accept === 'function', 'marked reloadable');
    const flushed = fresh.store.calls.flush;
    assert.strictEqual(relay.hot.dispose(), null);
    assert.strictEqual(T.sessions.size, 0);
    assert.strictEqual(T.aliases.size, 0);
    assert.ok(fresh.store.get(a.id) && fresh.store.get(b.id), 'records kept');
    assert.ok(fresh.store.calls.flush > flushed);
    assert.strictEqual(spawned[1].child.killed, true, 'the running pull is ended');
    await until(() => !fs.existsSync(dirB));
    assert.ok(fs.existsSync(dirA), 'a whole video stays');
    fresh.store.calls.touch.length = 0;
    relay.hot.accept(null); // the new version
    const q = quietWarn();
    try {
        await withServer(async (get) => {
            assert.strictEqual((await get(a.id, 'index.m3u8')).status, 200);
            assert.strictEqual(fresh.asked.length, 2, 'no request to YouTube for the whole video');
            assert.strictEqual((await get(b.id, 'index.m3u8')).status, 503);
            await until(() => spawned.length === 3);
            assert.strictEqual(spawned[2].session.id, b.id);
        });
    } finally { q.back(); }
});

const realStoreFile = path.join(__dirname, '..', 'modules', 'videosRelayStore.js');
if (fs.existsSync(realStoreFile)) {
    ok('the restart case against the real store in a temp file', async () => {
        const mod = require(realStoreFile);
        const file = path.join(tmp, 'real-store.json');
        fresh();
        const st = mod.open(file, { ttlMs: 24 * 3600000 });
        T.setStore(st);
        T.setBudget(new mod.ReviveBudget());
        const a = await relay.start('abcdefghijk', 'v480', 60);
        st.close(); // written, and the next open reads the file afresh: a restart
        T.reset();
        spawned.length = 0;
        const st2 = mod.open(file, { ttlMs: 24 * 3600000 });
        assert.notStrictEqual(st2, st);
        assert.strictEqual(st2.get(a.id).at, 60);
        T.setStore(st2);
        T.setBudget(new mod.ReviveBudget());
        await relay.sweep();
        assert.ok(!fs.existsSync(path.join(ROOT(), a.id)), 'the unfinished folder went');
        const q = quietWarn();
        try {
            await withServer(async (get) => {
                const r = await get(a.id, 'index.m3u8');
                assert.strictEqual(r.status, 503);
                assert.ok(r.retry >= 1);
                await until(() => spawned.length === 1);
                assert.ok(spawned[0].args.join(' ').includes('-ss 60'));
                assert.strictEqual(spawned[0].session.id, a.id);
                await relay.stop(a.id);
                assert.strictEqual(st2.get(a.id), null);
                assert.strictEqual((await get(a.id, 'index.m3u8')).status, 404);
            });
        } finally { q.back(); }
        st2.close();
    });
}

(async () => {
    let pass = 0; let failed = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { failed++; console.error(`  FAIL ${name}\n${e.stack}`); } }
    T.reset();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${pass} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
