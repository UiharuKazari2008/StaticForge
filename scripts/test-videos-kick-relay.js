#!/usr/bin/env node
/**
 * modules/videosKickRelay.js (Yozora #918) without Kick, the browser or ffmpeg: the stream's renditions and
 * which one a mode pulls, the ffmpeg command per mode, a session's life (start, join, replace, stop, idle end),
 * a restart with a fresh address when the encoder stops, and the end when the channel went offline; and (StaticForge
 * #1365) the records that outlive a session: a playlist asked for under an address with no session starts the stream
 * again under the same address, bounded by a budget, never by a piece, never after the viewer ended the stream.
 * The real ffmpeg is used for one test (skipped with a note when it is not installed).
 *
 *   node scripts/test-videos-kick-relay.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { spawnSync } = require('child_process');
const { EventEmitter } = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-relay-test-'));
process.env.VIDEOS_LIVE_DIR = path.join(tmp, 'live');
process.env.VIDEOS_LIVE_STORE = path.join(tmp, 'sessions.json'); // the tests before the fake store use a real one, here
const relay = require('../modules/videosKickRelay');
const { ReviveBudget } = require('../modules/videosRelayStore');
const T = relay._test;

let pass = 0;
const ok = (name, fn) => Promise.resolve().then(fn).then(() => { pass++; console.log(`  ok  ${name}`); }, (e) => { console.error(`  FAIL ${name}\n${e.stack}`); process.exitCode = 1; });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MASTER = ['#EXTM3U',
    '#EXT-X-STREAM-INF:BANDWIDTH=8397000,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2"', '1080/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=3423000,RESOLUTION=1280x720,FRAME-RATE=60.000', 'https://cdn.example/720/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=1428000,RESOLUTION=852x480,FRAME-RATE=30.000', '480/index.m3u8',
    '#EXT-X-STREAM-INF:BANDWIDTH=630000,RESOLUTION=640x360,FRAME-RATE=30.000', '360/index.m3u8'].join('\n');

let live = true;
let addressReads = 0;
const spawned = [];
// a stand-in encoder: writes a list with two pieces (after encoderDelay ms, or at once), then waits to be stopped
let encoderDelay = 30;
function fakeSpawn(args, session) {
    const child = new EventEmitter();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', 0)); };
    spawned.push({ args, child, session });
    const list = '#EXTM3U\n#EXTINF:4.0,\ns00000.ts\n#EXTINF:4.0,\ns00001.ts\n';
    if (encoderDelay) setTimeout(() => { fs.promises.writeFile(path.join(session.dir, 'index.m3u8'), list).catch(() => {}); }, encoderDelay);
    else { try { fs.writeFileSync(path.join(session.dir, 'index.m3u8'), list); } catch (_) { /* the folder is gone */ } }
    return child;
}
T.setHooks({ address: async () => { addressReads++; return live ? { live: true, playback: 'https://video.example/master.m3u8?token=t' } : { live: false, playback: '' }; }, spawn: fakeSpawn });
global.fetch = async () => ({ status: 200, text: async () => MASTER });
const stdFetch = global.fetch;
relay.bind({ allowed: (slug) => ['streamer_one', 'other_two', 'third_3', 'fourth_4'].includes(slug) });

(async () => {
    await ok('renditions: parsed best first; a mode takes its height, else the next one down', () => {
        const v = T.parseMaster(MASTER, 'https://video.example/master.m3u8?token=t');
        assert.deepStrictEqual(v.map((x) => [x.height, x.fps, x.kbit]), [[1080, 60, 8397], [720, 60, 3423], [480, 30, 1428], [360, 30, 630]]);
        assert.strictEqual(v[0].url, 'https://video.example/1080/index.m3u8');
        assert.strictEqual(v[1].url, 'https://cdn.example/720/index.m3u8');
        assert.strictEqual(T.pickVariant(v, 480).height, 480);
        assert.strictEqual(T.pickVariant(v, 160).height, 360, 'no 160p: the smallest there is');
        assert.strictEqual(T.pickVariant(v, 540).height, 480);
        assert.strictEqual(T.pickVariant([], 480), null);
    });

    await ok('modes: pass-through copies; no re-encode goes over 30 fps; Audio First is one picture a second', () => {
        const by = Object.fromEntries(T.MODES.map((m) => [m.id, T.ffmpegArgs(m, 'IN', '/d').join(' ')]));
        assert.ok(/-i IN -c copy -f hls/.test(by['480']) && /-c copy/.test(by['360']) && /-c copy/.test(by['160']));
        for (const id of ['hw1080', 'hw720', 'hw540', 'e480', 'e360']) assert.ok(/fps=30/.test(by[id]), id);
        assert.ok(/fps=24/.test(by.hw1080f24) && /scale_vaapi=w=-2:h=1080/.test(by.hw1080f24) && /-g 96 /.test(by.hw1080f24));
        assert.ok(/fps=15/.test(by.hw720f15) && /-g 60 /.test(by.hw720f15));
        assert.ok(T.MODES.every((m) => m.copy || !/fps=(4[0-9]|[5-9][0-9])/.test(T.ffmpegArgs(m, 'IN', '/d').join(' '))), 'nothing re-encodes above 30 fps');
        assert.ok(/h264_vaapi/.test(by.hw720) && /-vaapi_device \S+ -i IN/.test(by.hw720));
        assert.ok(/libx264 -preset slow/.test(by.e360) && /scale=-2:360/.test(by.e360));
        assert.ok(/fps=1,/.test(by.audio) && /zerolatency/.test(by.audio) && /-b:a 96k/.test(by.audio));
        assert.ok(Object.values(by).every((a) => /-hls_time 4 -hls_list_size 15/.test(a) && /delete_segments/.test(a)));
        // the program's Quality list: three sub-lists (1080p, 720p, More) and three direct rows
        const view = relay.modes();
        assert.deepStrictEqual([...new Set(view.map((m) => m.group))], ['1080p', '720p', 'More', '']);
        assert.deepStrictEqual(view.filter((m) => !m.group).map((m) => m.short), ['480p', '360p', 'Audio First']);
        assert.deepStrictEqual(view.filter((m) => m.group === '1080p').map((m) => m.short), ['30 fps', '24 fps', '15 fps']);
        assert.deepStrictEqual(relay.modes().map((m) => m.id), ['hw1080', 'hw1080f24', 'hw1080f15', 'hw720', 'hw720f24', 'hw720f15', 'hw540', '480', '360', '160', 'e480', 'e360', 'audio']);
    });

    await ok('a session starts once its list has pieces; the same channel and mode joins it', async () => {
        await assert.rejects(relay.start('not_listed', '480'), (e) => e.code === 'KICK_NOT_LISTED');
        const a = await relay.start('kick:Streamer_One', '360');
        assert.strictEqual(a.state, 'live');
        assert.strictEqual(a.mode, '360');
        assert.strictEqual(a.source.height, 360);
        assert.ok(new RegExp(`^/api/videos/live/${a.id}/index\\.m3u8$`).test(a.url));
        assert.ok(spawned[0].args.includes('https://video.example/360/index.m3u8'));
        const b = await relay.start('streamer_one', '360');
        assert.strictEqual(b.id, a.id);
        assert.strictEqual(spawned.length, 1);
        assert.strictEqual(addressReads, 1);
    });

    await ok('another quality replaces the channel\'s session; at most two streams run', async () => {
        const first = [...T.sessions.keys()][0];
        const b = await relay.start('streamer_one', 'audio');
        assert.notStrictEqual(b.id, first);
        assert.strictEqual(relay.state(first).state, 'gone');
        assert.ok(spawned[0].child.killed, 'the old encoder was stopped');
        assert.ok(!fs.existsSync(path.join(process.env.VIDEOS_LIVE_DIR, first)), 'and its files removed');
        assert.strictEqual(addressReads, 1, 'the address is reused for a few minutes');
        await relay.start('other_two', '480');
        await relay.start('third_3', '480');
        assert.strictEqual(T.sessions.size, 2);
        assert.strictEqual(relay.state(b.id).state, 'gone', 'the stream watched longest ago made room');
    });

    await ok('the encoder stopping while someone watches: a fresh address and another run', async () => {
        const s = [...T.sessions.values()].find((x) => x.slug === 'third_3');
        const reads = addressReads;
        const n = spawned.length;
        s.child.emit('close', 1);
        await wait(1700);
        assert.strictEqual(spawned.length, n + 1);
        assert.strictEqual(addressReads, reads + 1);
        assert.deepStrictEqual([relay.state(s.id).state, relay.state(s.id).restarts], ['live', 1]);
    });

    await ok('the channel going offline ends the session', async () => {
        const s = [...T.sessions.values()].find((x) => x.slug === 'third_3');
        live = false;
        s.child.emit('close', 1);
        await wait(3300);
        assert.strictEqual(relay.state(s.id).state, 'ended');
        await assert.rejects(relay.start('fourth_4', '480'), (e) => e.code === 'KICK_OFFLINE');
        assert.strictEqual(T.sessions.size, 2, 'a channel that is not live takes no place');
        live = true;
    });

    await ok('stop removes the session and its files', async () => {
        const s = [...T.sessions.values()].find((x) => x.slug === 'other_two');
        assert.strictEqual(await relay.stop(s.id), true);
        assert.strictEqual(relay.state(s.id).state, 'gone');
        assert.ok(!fs.existsSync(s.dir));
        assert.strictEqual(await relay.stop(s.id), false);
    });

    // ------------------------------------------------------------------------------------------ #1365: an address outlives its session

    const express = require('express');
    const app = express();
    relay.mount(app, (req, res, next) => next());
    const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const port = server.address().port;
    const get = (id, file) => new Promise((resolve, reject) => {
        http.get({ host: '127.0.0.1', port, path: `/api/videos/live/${id}/${file}`, agent: false }, (res) => {
            let body = '';
            res.setEncoding('utf8');
            res.on('data', (c) => { body += c; });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
        }).on('error', reject);
    });
    const until = async (fn, ms = 5000) => {
        const t = Date.now();
        while (!fn()) { assert.ok(Date.now() - t < ms, `timed out waiting for ${fn}`); await wait(10); }
    };
    // asks again until the playlist plays (a 503 on the way is the revive under way)
    async function until200(id, file = 'index.m3u8') {
        const t = Date.now();
        for (;;) {
            const r = await get(id, file);
            if (r.status === 200) return r;
            assert.strictEqual(r.status, 503, `got ${r.status}`);
            assert.ok(Date.now() - t < 6000, 'no playlist in 6 s');
            await wait(100);
        }
    }
    async function logged(fn) {
        const lines = { log: [], warn: [] };
        const l = console.log;
        const w = console.warn;
        console.log = (...a) => lines.log.push(a.join(' '));
        console.warn = (...a) => lines.warn.push(a.join(' '));
        try { await fn(lines); } finally { console.log = l; console.warn = w; }
    }
    const idN = (n) => String(n).padStart(24, 'b');
    const OLD = idN(1);
    const REC = (extra) => Object.assign({ slug: 'streamer_one', mode: '480', startedAt: Date.now() - 3600000 }, extra);
    // a 503 that tells the player to come back: no body, never cached; returns the seconds
    const comeBack = (r) => {
        assert.strictEqual(r.status, 503);
        assert.strictEqual(r.body, '');
        assert.strictEqual(r.headers['cache-control'], 'no-store');
        const n = Number(r.headers['retry-after']);
        assert.ok(Number.isInteger(n) && n >= 1 && n <= 300, `Retry-After ${r.headers['retry-after']}`);
        return n;
    };
    function fakeStore() {
        const m = new Map();
        return {
            m, flushed: 0,
            put(id, r) { if (!/^[a-f0-9]{24}$/.test(id)) return false; m.set(id, Object.assign({ lastHit: Date.now() }, JSON.parse(JSON.stringify(r)))); return true; },
            get(id) { const r = m.get(id); return r ? Object.assign({}, r) : null; },
            touch(id, p) { const r = m.get(id); if (!r) return false; Object.assign(r, p); return true; },
            remove(id) { return m.delete(id); },
            all() { return [...m].map(([id, r]) => Object.assign({}, r, { id })); },
            flush() { this.flushed++; }, close() {}
        };
    }
    function fakeBudget() {
        return { calls: [], provenIds: [], forgotten: [], allow: true, wait: 0, take(id) { this.calls.push(id); return this.allow; }, waitMs() { return this.wait; }, proven(id) { this.provenIds.push(id); }, forget(id) { this.forgotten.push(id); } };
    }
    const stdAddress = async () => { addressReads++; return live ? { live: true, playback: 'https://video.example/master.m3u8?token=t' } : { live: false, playback: '' }; };
    function fresh(recs = {}) {
        T.reset();
        global.fetch = stdFetch; // a test that failed with its gate shut must not hold up the next one
        encoderDelay = 0; // the encoder has its list at once, but for the tests that watch a session start
        T.setHooks({ address: stdAddress, spawn: fakeSpawn });
        live = true;
        addressReads = 0;
        spawned.length = 0;
        const st = fakeStore();
        for (const [id, r] of Object.entries(recs)) st.put(id, r);
        const b = fakeBudget();
        T.setStore(st);
        T.setBudget(b);
        return { st, b };
    }
    const settle = () => until(() => T.reviving.size === 0);

    await ok('ffmpegArgs: -start_number only when asked for; the rest is unchanged', () => {
        const m = T.MODES.find((x) => x.id === '480');
        const plain = T.ffmpegArgs(m, 'IN', '/d');
        assert.deepStrictEqual(plain, ['-hide_banner', '-loglevel', 'error', '-nostdin', '-i', 'IN', '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_list_size', '15',
            '-hls_flags', 'delete_segments+append_list+omit_endlist+independent_segments+temp_file+discont_start', '-hls_segment_filename', '/d/s%05d.ts', '/d/index.m3u8']);
        const n = T.ffmpegArgs(m, 'IN', '/d', 1234);
        const i = n.indexOf('-start_number');
        assert.strictEqual(n[i + 1], '1234');
        assert.ok(i > n.indexOf('-hls_flags') && i < n.indexOf('-hls_segment_filename'), 'an hls option, before the output names');
        assert.deepStrictEqual(n.filter((_, k) => k !== i && k !== i + 1), plain);
        assert.ok(!T.ffmpegArgs(m, 'IN', '/d', 0).includes('-start_number'));
        assert.ok(!T.ffmpegArgs(m, 'IN', '/d', undefined).includes('-start_number'));
    });

    if (spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status !== 0) {
        console.log('  skip real ffmpeg: ffmpeg is not on PATH');
    } else {
        await ok('real ffmpeg: -start_number gives the first piece its number, and a restart into the same folder continues after the last piece', () => {
            const dir = path.join(tmp, 'ffmpeg-real');
            fs.mkdirSync(dir, { recursive: true });
            // a sound and a picture made by ffmpeg itself; the picture is the "address" the relay's own argument list reads
            const mode = { id: 'lavfi', pre: ['-f', 'lavfi', '-i', 'sine=frequency=440', '-f', 'lavfi'], args: ['-t', '9', '-c:v', 'libx264', '-preset', 'ultrafast', '-g', '40', '-keyint_min', '40', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '32k'] };
            const run = () => {
                const r = spawnSync('ffmpeg', T.ffmpegArgs(mode, 'testsrc=size=160x90:rate=10', dir, 1234), { encoding: 'utf8', timeout: 60000 });
                assert.strictEqual(r.status, 0, r.stderr);
            };
            const pieces = () => fs.readdirSync(dir).filter((f) => /^s\d+\.ts$/.test(f)).sort();
            const list = () => fs.readFileSync(path.join(dir, 'index.m3u8'), 'utf8');
            run();
            const first = pieces();
            assert.ok(first.length >= 2, first.join(' '));
            assert.strictEqual(first[0], 's01234.ts', 'the first piece');
            assert.ok(!fs.existsSync(path.join(dir, 's00000.ts')));
            assert.ok(/#EXT-X-MEDIA-SEQUENCE:1234\n/.test(list()), list());
            // the in-session restart (append_list) with -start_number still on the command line
            run();
            const all = pieces();
            const numbers = all.map((f) => Number(/s(\d+)\.ts/.exec(f)[1]));
            assert.ok(all.length > first.length, 'more pieces were written');
            assert.deepStrictEqual(numbers, numbers.map((_, k) => 1234 + k), `contiguous from 1234, no going back: ${all.join(' ')}`);
            assert.ok(/#EXT-X-MEDIA-SEQUENCE:1234\n/.test(list()), list());
            const listed = [...list().matchAll(/^(s\d+\.ts)$/gm)].map((x) => x[1]);
            assert.deepStrictEqual(listed, all, 'the list carries the old pieces then the new ones');
        });
    }

    await ok('unknown address, no record: 404 and nothing read or started', async () => {
        const { b } = fresh();
        for (const f of ['index.m3u8', 's00001.ts', 'other.txt']) assert.strictEqual((await get(idN(1), f)).status, 404, f);
        assert.strictEqual((await get('short', 'index.m3u8')).status, 404);
        assert.deepStrictEqual([addressReads, spawned.length, b.calls.length], [0, 0, 0]);
    });

    await ok('the restart case: a record and no session - the playlist starts the stream again under the same address', async () => {
        await logged(async (lines) => {
            const startedAt = Date.now() - 3600000;
            const { st, b } = fresh({ [OLD]: REC({ startedAt }) });
            T.setHooks({ address: async () => { await wait(200); return stdAddress(); }, spawn: fakeSpawn }); // a slow read: the second ask lands in the middle of it
            encoderDelay = 30; // and a slow start: asks land while ffmpeg is starting
            const t0 = Date.now();
            assert.strictEqual(comeBack(await get(OLD, 'index.m3u8')), 3);
            comeBack(await get(OLD, 'index.m3u8')); // while the address is still being read
            assert.strictEqual(spawned.length, 0);
            assert.strictEqual(T.sessions.size, 0, 'no session yet: the address is being read');
            await until(() => spawned.length === 1);
            comeBack(await get(OLD, 'index.m3u8')); // while ffmpeg is starting
            assert.strictEqual(spawned.length, 1, 'one start, however many asked');
            const r = await until200(OLD);
            const t1 = Date.now();
            assert.ok(r.body.includes('s00000.ts'));
            assert.strictEqual(r.headers['content-type'], 'application/vnd.apple.mpegurl');
            assert.strictEqual(r.headers['cache-control'], 'no-store');
            assert.strictEqual(spawned.length, 1);
            assert.strictEqual(addressReads, 1);
            const s = T.sessions.get(OLD);
            assert.ok(s && s.dir.endsWith(OLD), 'the same id, the same folder');
            assert.strictEqual(s.startedAt, startedAt, 'the start time comes from the record');
            const args = spawned[0].args;
            const at = args.indexOf('-start_number');
            assert.ok(at > 0, 'a revived session numbers its pieces past the earlier run');
            const n = Number(args[at + 1]);
            assert.ok(n >= Math.floor((t0 - startedAt) / 4000) + 8 && n <= Math.floor((t1 - startedAt) / 4000) + 8, `start number ${n}`);
            assert.ok(n > 800, 'an hour of 4 s pieces');
            assert.deepStrictEqual(b.calls, [OLD]);
            assert.ok(st.get(OLD) && st.get(OLD).lastHit >= t0, 'the record stays and follows the requests');
            assert.deepStrictEqual(lines.log, ['[videos] kick streamer_one: session started again (restart)']);
            assert.deepStrictEqual(lines.warn, []);
            // once it plays, every ask is just served
            assert.strictEqual((await get(OLD, 'index.m3u8')).status, 200);
            assert.strictEqual(spawned.length, 1);
            assert.strictEqual(lines.log.length, 1, 'nothing per request');
        });
    });

    await ok('a brand-new session keeps today\'s numbering (no -start_number)', async () => {
        fresh();
        await relay.start('streamer_one', '480');
        assert.ok(!spawned[0].args.includes('-start_number'));
    });

    await ok('the idle end keeps the record: a later playlist starts the stream again; the viewer\'s stop ends it for good', async () => {
        await logged(async (lines) => {
            const { st } = fresh();
            const a = await relay.start('streamer_one', '480');
            const rec = st.get(a.id);
            assert.deepStrictEqual([rec.slug, rec.mode], ['streamer_one', '480']);
            assert.ok(rec.startedAt > 0 && rec.lastHit > 0);
            const dir = T.sessions.get(a.id).dir;
            T.sessions.get(a.id).lastHit = Date.now() - T.IDLE_MS - 1000;
            T.sweep(); // what the 15 s timer does
            assert.strictEqual(T.sessions.size, 0, 'nobody watching: the session is gone');
            assert.ok(st.get(a.id), 'its record is not');
            await until(() => !fs.existsSync(dir));
            comeBack(await get(a.id, 'index.m3u8'));
            const r = await until200(a.id);
            assert.ok(r.body.includes('#EXTINF'));
            assert.strictEqual(spawned.length, 2);
            assert.ok(spawned[1].args.includes('-start_number'));
            assert.deepStrictEqual(lines.log, ['[videos] kick streamer_one: session started again (idle)']);
            // the viewer ends it
            assert.strictEqual(await relay.stop(a.id), true);
            assert.strictEqual(st.get(a.id), null);
            assert.strictEqual((await get(a.id, 'index.m3u8')).status, 404);
            assert.strictEqual(spawned.length, 2, 'an ended stream stays ended');
        });
    });

    await ok('stop() of an address with no session (after a restart) removes its record too', async () => {
        const { st, b } = fresh({ [OLD]: REC() });
        assert.strictEqual(await relay.stop(OLD), false, 'there was no session to stop');
        assert.strictEqual(st.get(OLD), null);
        assert.ok(b.forgotten.includes(OLD), 'and the budget forgets it');
        assert.strictEqual((await get(OLD, 'index.m3u8')).status, 404);
        assert.strictEqual(spawned.length, 0);
    });

    await ok('the encoder giving up with nobody watching is an idle end: the record stays', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480');
        const s = T.sessions.get(a.id);
        s.lastHit = Date.now() - T.IDLE_MS - 1000;
        s.child.emit('close', 1);
        await until(() => T.sessions.size === 0);
        assert.ok(st.get(a.id));
    });

    await ok('"replaced" removes the old record; a record of another quality with no session goes when the viewer picks a quality', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480');
        const b = await relay.start('streamer_one', '360');
        assert.notStrictEqual(a.id, b.id);
        assert.strictEqual(st.get(a.id), null);
        assert.ok(st.get(b.id));
        assert.strictEqual((await get(a.id, 'index.m3u8')).status, 404);
        const stale = idN(7);
        const same = idN(8);
        st.put(stale, { slug: 'other_two', mode: '360', startedAt: 1 });
        st.put(same, { slug: 'other_two', mode: '480', startedAt: 1 });
        await relay.start('other_two', '480');
        assert.strictEqual(st.get(stale), null, 'another quality of the channel: dead for good');
        assert.ok(st.get(same), 'the same quality stays');
        assert.ok(st.get(b.id), 'another channel is left alone');
        assert.strictEqual((await get(stale, 'index.m3u8')).status, 404);
    });

    await ok('a piece never brings a stream back', async () => {
        const { st, b } = fresh({ [OLD]: REC() });
        for (const f of ['s00001.ts', 's01234.ts']) assert.strictEqual((await get(OLD, f)).status, 404, f);
        assert.deepStrictEqual([addressReads, spawned.length, b.calls.length, T.reviving.size], [0, 0, 0, 0]);
        assert.ok(st.get(OLD), 'and the record is not touched');
    });

    await ok('budget (fake): a failed revive keeps the record; no Kick request until the budget allows another try', async () => {
        await logged(async (lines) => {
            const { st, b } = fresh({ [OLD]: REC() });
            live = false;
            comeBack(await get(OLD, 'index.m3u8'));
            await settle();
            assert.deepStrictEqual([addressReads, spawned.length, T.sessions.size], [1, 0, 0]);
            assert.ok(st.get(OLD), 'the channel being offline is not the end of the address');
            assert.strictEqual(lines.warn.length, 1);
            assert.ok(/the stream could not be started again \(That channel is not live right now\)/.test(lines.warn[0]), lines.warn[0]);
            b.allow = false;
            b.wait = 17000;
            assert.strictEqual(comeBack(await get(OLD, 'index.m3u8')), 17, 'Retry-After from the budget');
            assert.strictEqual(addressReads, 1, 'within the gap: no address read');
            assert.strictEqual(spawned.length, 0);
            b.wait = 1;
            assert.strictEqual(comeBack(await get(OLD, 'index.m3u8')), 1);
            b.wait = 9999999;
            assert.strictEqual(comeBack(await get(OLD, 'index.m3u8')), 300, 'at most five minutes');
            assert.strictEqual(addressReads, 1);
            assert.strictEqual(lines.warn.length, 1, 'nothing per request');
            b.allow = true;
            live = true;
            comeBack(await get(OLD, 'index.m3u8'));
            await until200(OLD);
            assert.deepStrictEqual([addressReads, spawned.length], [2, 1], 'after the gap it tries again');
            assert.strictEqual(lines.log.length, 1);
        });
    });

    await ok('a failed revive: a channel Kick does not know removes the record; any other failure keeps it', async () => {
        await logged(async () => {
            const { st } = fresh({ [OLD]: REC() });
            T.setHooks({ address: async () => { addressReads++; return { missing: true }; }, spawn: fakeSpawn });
            comeBack(await get(OLD, 'index.m3u8'));
            await settle();
            assert.strictEqual(st.get(OLD), null, 'KICK_NOT_FOUND');
            assert.strictEqual((await get(OLD, 'index.m3u8')).status, 404);
            for (const code of ['ALCHEMY_OFFLINE', 'KICK_STREAM', 'KICK_PAGE']) {
                st.put(OLD, REC());
                T.setHooks({ address: async () => { throw new relay.RelayError('boom', code); }, spawn: fakeSpawn });
                comeBack(await get(OLD, 'index.m3u8'));
                await settle();
                assert.ok(st.get(OLD), code);
                assert.strictEqual(T.sessions.size, 0);
            }
        });
    });

    await ok('budget (real, clock moved): 20 s, then 40 s, then 80 s apart', async () => {
        await logged(async () => {
            fresh({ [OLD]: REC() });
            T.setBudget(new ReviveBudget());
            live = false; // every try fails after one address read
            const realNow = Date.now;
            let skew = 0;
            Date.now = () => realNow() + skew;
            try {
                const attempt = async (at, reads, retry) => {
                    skew = at;
                    const before = addressReads;
                    const r = await get(OLD, 'index.m3u8');
                    const secs = comeBack(r);
                    if (retry) assert.ok(secs >= retry[0] && secs <= retry[1], `at ${at}: Retry-After ${secs}`);
                    await settle();
                    assert.strictEqual(addressReads - before, reads, `at ${at} ms: ${reads ? 'a try' : 'no try'}`);
                };
                await attempt(0, 1);
                await attempt(19000, 0, [1, 2]);
                await attempt(21000, 1);
                await attempt(58000, 0, [3, 4]);
                await attempt(62500, 1);
                await attempt(139000, 0, [3, 5]);
                await attempt(144000, 1);
            } finally { Date.now = realNow; }
        });
    });

    await ok('budget (real, clock moved): five tries in ten minutes, then wait for the window', async () => {
        await logged(async () => {
            fresh({ [OLD]: REC() });
            T.setBudget(new ReviveBudget({ minGapMs: 1000, maxGapMs: 1000 }));
            live = false;
            const realNow = Date.now;
            let skew = 0;
            Date.now = () => realNow() + skew;
            try {
                for (let i = 0; i < 5; i++) {
                    skew = i * 1100;
                    const before = addressReads;
                    comeBack(await get(OLD, 'index.m3u8'));
                    await settle();
                    assert.strictEqual(addressReads - before, 1, `try ${i + 1}`);
                }
                skew = 5500;
                const before = addressReads;
                assert.strictEqual(comeBack(await get(OLD, 'index.m3u8')), 300, 'a long wait, at most five minutes');
                await settle();
                assert.strictEqual(addressReads, before, 'the sixth is not allowed');
                skew = 600500;
                comeBack(await get(OLD, 'index.m3u8'));
                await settle();
                assert.strictEqual(addressReads, before + 1, 'once the first has left the window');
            } finally { Date.now = realNow; }
        });
    });

    await ok('alias: a running session of the channel answers for the old address - no spawn, no Kick request, no budget', () => logged(async () => {
        const { st, b } = fresh();
        const a = await relay.start('streamer_one', '480');
        const reads = addressReads;
        const spawns = spawned.length;
        st.put(OLD, REC({ mode: '360' })); // another quality: the viewer's last choice is what plays
        const r = await get(OLD, 'index.m3u8');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.includes('s00000.ts'));
        assert.deepStrictEqual([addressReads, spawned.length, b.calls.length], [reads, spawns, 0]);
        assert.strictEqual(T.aliases.get(OLD), a.id);
        fs.writeFileSync(path.join(T.sessions.get(a.id).dir, 's00000.ts'), 'piece');
        const piece = await get(OLD, 's00000.ts');
        assert.deepStrictEqual([piece.status, piece.body, piece.headers['cache-control']], [200, 'piece', 'private, max-age=120, immutable']);
        assert.strictEqual(relay.state(OLD).id, a.id, 'the page asking about the old address learns the real one');
        // the stream goes idle: the alias goes, both records stay, the old address is started again by itself
        T.sessions.get(a.id).lastHit = Date.now() - T.IDLE_MS - 1000;
        T.sweep();
        assert.strictEqual(T.aliases.size, 0);
        assert.ok(st.get(a.id) && st.get(OLD));
        comeBack(await get(OLD, 'index.m3u8'));
        await until200(OLD);
        assert.strictEqual(spawned.length, spawns + 1);
        assert.ok(T.sessions.has(OLD));
    }));

    await ok('alias: the viewer ending the stream ends the old address too', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480');
        st.put(OLD, REC());
        assert.strictEqual((await get(OLD, 'index.m3u8')).status, 200);
        assert.strictEqual(await relay.stop(a.id), true);
        assert.strictEqual(st.get(OLD), null);
        assert.strictEqual(st.get(a.id), null);
        assert.strictEqual(T.aliases.size, 0);
        assert.strictEqual((await get(OLD, 'index.m3u8')).status, 404);
    });

    await ok('full: a revive never pushes a running stream out', async () => {
        const { st, b } = fresh({ [OLD]: REC() });
        const x = await relay.start('other_two', '480');
        const y = await relay.start('third_3', '480');
        const n = spawned.length;
        const reads = addressReads;
        assert.strictEqual(comeBack(await get(OLD, 'index.m3u8')), 30);
        assert.deepStrictEqual([...T.sessions.keys()].sort(), [x.id, y.id].sort(), 'nothing stopped');
        assert.ok(!spawned.some((sp) => sp.child.killed));
        assert.deepStrictEqual([spawned.length, addressReads, b.calls.length], [n, reads, 0]);
        assert.ok(st.get(OLD));
    });

    await ok('a channel taken off the list, an unknown quality or a bad record: 404 and the record is removed', async () => {
        const bad = [OLD, idN(5), idN(6)];
        const { st, b } = fresh({ [bad[0]]: REC({ slug: 'taken_off' }), [bad[1]]: REC({ mode: 'nope' }), [bad[2]]: REC({ slug: 'Bad Slug!' }) });
        for (const id of bad) {
            assert.strictEqual((await get(id, 'index.m3u8')).status, 404, id);
            assert.strictEqual(st.get(id), null, id);
        }
        assert.deepStrictEqual([addressReads, spawned.length, b.calls.length], [0, 0, 0]);
    });

    await ok('proven() is called once, after five pieces were served for a revived session', async () => {
        await logged(async () => {
            const { b } = fresh({ [OLD]: REC() });
            comeBack(await get(OLD, 'index.m3u8'));
            await until200(OLD);
            const dir = T.sessions.get(OLD).dir;
            for (let i = 0; i < 6; i++) fs.writeFileSync(path.join(dir, `s0100${i}.ts`), 'piece');
            assert.strictEqual((await get(OLD, 's09999.ts')).status, 404, 'a piece that is not there');
            for (let i = 0; i < 4; i++) assert.strictEqual((await get(OLD, `s0100${i}.ts`)).status, 200);
            await get(OLD, 'index.m3u8');
            assert.deepStrictEqual(b.provenIds, [], 'four pieces are not enough, and lists and misses do not count');
            assert.strictEqual((await get(OLD, 's01004.ts')).status, 200);
            assert.deepStrictEqual(b.provenIds, [OLD]);
            assert.strictEqual((await get(OLD, 's01005.ts')).status, 200);
            assert.deepStrictEqual(b.provenIds, [OLD], 'once');
        });
        // a session nobody revived has nothing to prove
        const { b: b2 } = fresh();
        const a = await relay.start('streamer_one', '480');
        for (let i = 0; i < 6; i++) { fs.writeFileSync(path.join(T.sessions.get(a.id).dir, `s0200${i}.ts`), 'piece'); await get(a.id, `s0200${i}.ts`); }
        assert.deepStrictEqual(b2.provenIds, []);
    });

    await ok('the route is late-bound: a reload that replaces serve() needs no new route', async () => {
        const real = relay.serve;
        relay.serve = (req, res) => res.status(418).end();
        try { assert.strictEqual((await get(OLD, 'index.m3u8')).status, 418); } finally { relay.serve = real; }
        assert.strictEqual(typeof relay.serve, 'function');
    });

    await ok('a module reload (dispose) ends the sessions like a restart, keeps the records, and the next playlist brings the stream back', async () => {
        await logged(async (lines) => {
            const { st } = fresh();
            assert.ok(relay.hot && typeof relay.hot.dispose === 'function' && typeof relay.hot.accept === 'function', 'marked reloadable');
            const a = await relay.start('streamer_one', '480');
            const dir = T.sessions.get(a.id).dir;
            const session = T.sessions.get(a.id);
            const child = spawned[0].child;
            const handed = T.dispose();
            assert.strictEqual(typeof handed.allowed, 'function');
            assert.ok(child.killed, 'the encoder was told to stop');
            assert.strictEqual(session.stopped, true);
            assert.strictEqual(T.sessions.size, 0);
            assert.ok(!fs.existsSync(dir), 'the folder is gone');
            assert.ok(st.get(a.id), 'the record stays');
            assert.ok(st.flushed >= 1, 'and is written');
            T.accept(handed); // the new version
            comeBack(await get(a.id, 'index.m3u8'));
            const r = await until200(a.id);
            assert.ok(r.body.includes('#EXTINF'));
            assert.ok(T.sessions.has(a.id), 'under the same address');
            assert.deepStrictEqual(lines.log, ['[videos] kick streamer_one: session started again (restart)']);
            // the channel check is handed over
            T.accept({ allowed: () => false });
            await assert.rejects(relay.start('other_two', '480'), (e) => e.code === 'KICK_NOT_LISTED');
            T.accept(handed);
            T.accept(null);
            await relay.start('other_two', '480');
        });
    });

    // ------------------------------------------------------------------------------------------ #1410: two viewers of one stream

    // holds every read of the stream's list until open(): what is under way can be looked at, and raced
    function gateFetch() {
        let release;
        const held = new Promise((r) => { release = r; });
        const gate = { waiting: 0, open() { global.fetch = stdFetch; release(); } };
        global.fetch = async (...args) => { gate.waiting++; await held; return stdFetch(...args); };
        return gate;
    }
    // an encoder that never writes a list: its session stays "starting" until the test fails it (child = null)
    function silentSpawn(args, session) {
        const child = new EventEmitter();
        child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', 0)); };
        spawned.push({ args, child, session });
        return child;
    }
    // a run that broke: no encoder, and the state a failed restart leaves
    const breakRun = (id) => { const s = T.sessions.get(id); s.child = null; s.state = 'error'; return s; };
    const status = async (id) => (await get(id, 'index.m3u8')).status;
    const onIt = (id) => [...T.sessions.get(id).viewers].sort();
    const listed = (st, id) => { const r = st.get(id); return r && r.viewers ? [...r.viewers].sort() : r && 'no list'; };
    const leaves = (id, viewer) => relay.stop(id, 'closed', { viewer });
    const idleEnd = (id) => { T.sessions.get(id).lastHit = Date.now() - T.IDLE_MS - 1000; T.sweep(); };

    await ok('#1410 acceptance: two viewers on one session, one stops, the other\'s playlist still answers 200; the last one ends it and then it is 404', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        const b = await relay.start('streamer_one', '480', 'vb');
        assert.strictEqual(b.id, a.id, 'one session for both');
        assert.strictEqual(await leaves(a.id, 'va'), false, 'nothing ended');
        const r = await get(a.id, 'index.m3u8');
        assert.strictEqual(r.status, 200);
        assert.ok(r.body.includes('#EXTINF'));
        assert.ok(!spawned[0].child.killed, 'the encoder goes on');
        assert.deepStrictEqual([onIt(a.id), listed(st, a.id)], [['vb'], ['vb']]);
        assert.strictEqual(await leaves(a.id, 'va'), false, 'the one who left saying so again ends nothing');
        assert.strictEqual(await leaves(a.id, 'a-stranger'), false, 'nor does one who was never on it');
        assert.strictEqual(await status(a.id), 200);
        assert.strictEqual(await leaves(a.id, 'vb'), true, 'the last one ends it');
        assert.strictEqual(await status(a.id), 404);
        assert.strictEqual(st.get(a.id), null);
        assert.ok(spawned[0].child.killed);
        assert.strictEqual(spawned.length, 1);
    });

    await ok('a single viewer\'s stop ends the stream for good; the same viewer starting twice is still one viewer', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        assert.strictEqual(await leaves(a.id, 'va'), true);
        assert.deepStrictEqual([st.get(a.id), T.sessions.size, await status(a.id)], [null, 0, 404]);
        const b = await relay.start('streamer_one', '480', 'va');
        assert.strictEqual((await relay.start('streamer_one', '480', 'va')).id, b.id);
        assert.deepStrictEqual(listed(st, b.id), ['va']);
        assert.strictEqual(await leaves(b.id, 'va'), true);
        assert.deepStrictEqual([st.get(b.id), T.sessions.size, await status(b.id)], [null, 0, 404]);
        assert.strictEqual(spawned.length, 2, 'an ended stream stays ended');
    });

    await ok('no viewer id (or a bad one) works as before: its stop ends the stream; ids are cleaned and the list is capped at 16', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        await relay.start('streamer_one', '480');
        for (const bad of ['', 'two words', 'x'.repeat(65), 'a,b', 'a\n', 7, {}, ['vb'], null]) await relay.start('streamer_one', '480', bad);
        assert.deepStrictEqual([onIt(a.id), listed(st, a.id)], [['va'], ['va']]);
        assert.strictEqual(await relay.stop(a.id, 'closed', { viewer: 'two words' }), true, 'a bad id is no id: it ends for everybody, as before');
        assert.deepStrictEqual([st.get(a.id), await status(a.id)], [null, 404]);
        const b = await relay.start('streamer_one', '480', `Aa0_.:-${'x'.repeat(57)}`);
        assert.strictEqual(onIt(b.id).length, 1, '64 characters of the allowed ones');
        for (let i = 1; i <= 20; i++) await relay.start('streamer_one', '480', `v${i}`);
        const want = Array.from({ length: 16 }, (_, i) => `v${i + 5}`);
        assert.deepStrictEqual([...T.sessions.get(b.id).viewers], want, 'the ones longest here are dropped');
        assert.deepStrictEqual(st.get(b.id).viewers, want);
        assert.strictEqual(await relay.stop(b.id), true, 'a stop with no viewer is unconditional');
        assert.strictEqual(await status(b.id), 404);
    });

    await ok('viewer changes are on disk by the next tick (the real store), not after the 20 s of the touches', async () => {
        fresh();
        const file = path.join(tmp, 'viewers-real.json');
        const real = require('../modules/videosRelayStore').open(file);
        T.setStore(real);
        const tick = () => new Promise((r) => setImmediate(() => setImmediate(r)));
        const onDisk = (id) => JSON.parse(fs.readFileSync(file, 'utf8')).sessions[id].viewers;
        const a = await relay.start('streamer_one', '480', 'va');
        await tick();
        assert.deepStrictEqual(onDisk(a.id), ['va']);
        await relay.start('streamer_one', '480', 'vb');
        await tick();
        assert.deepStrictEqual(onDisk(a.id), ['va', 'vb']);
        await leaves(a.id, 'va');
        await tick();
        assert.deepStrictEqual(onDisk(a.id), ['vb']);
        await leaves(a.id, 'vb');
        real.close();
    });

    await ok('one of two takes another quality: the other\'s stream still answers 200, and each is ended by its own viewer', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        await relay.start('streamer_one', '480', 'vb');
        const b = await relay.start('streamer_one', '360', 'vb');
        assert.notStrictEqual(b.id, a.id);
        assert.ok(!spawned[0].child.killed, 'va\'s encoder goes on');
        assert.deepStrictEqual([await status(a.id), await status(b.id)], [200, 200]);
        assert.deepStrictEqual([onIt(a.id), listed(st, a.id), onIt(b.id), listed(st, b.id)], [['va'], ['va'], ['vb'], ['vb']]);
        assert.strictEqual(await leaves(a.id, 'va'), true);
        assert.deepStrictEqual([await status(a.id), await status(b.id), st.get(a.id)], [404, 200, null]);
        assert.strictEqual(await leaves(b.id, 'vb'), true);
        assert.strictEqual(await status(b.id), 404);
    });

    await ok('the join path leaves the other quality too: it ends once nobody is on it', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        await relay.start('streamer_one', '480', 'vb');
        const b = await relay.start('streamer_one', '360', 'vc'); // two qualities side by side
        assert.strictEqual(T.sessions.size, 2);
        assert.strictEqual((await relay.start('streamer_one', '360', 'vb')).id, b.id, 'vb joins');
        assert.deepStrictEqual([onIt(a.id), onIt(b.id), await status(a.id)], [['va'], ['vb', 'vc'], 200]);
        assert.strictEqual((await relay.start('streamer_one', '360', 'va')).id, b.id, 'va joins as the last one off the first');
        assert.deepStrictEqual([T.sessions.size, await status(a.id), st.get(a.id)], [1, 404, null]);
        assert.ok(spawned[0].child.killed);
        assert.deepStrictEqual([onIt(b.id), listed(st, b.id)], [['va', 'vb', 'vc'], ['va', 'vb', 'vc']]);
    });

    await ok('a sole viewer\'s quality change replaces the stream as before', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        const b = await relay.start('streamer_one', '360', 'va');
        assert.deepStrictEqual([T.sessions.size, st.get(a.id), await status(a.id), await status(b.id)], [1, null, 404, 200]);
        assert.ok(spawned[0].child.killed);
        assert.ok(!fs.existsSync(path.join(process.env.VIDEOS_LIVE_DIR, a.id)), 'its files are gone when start() answers');
    });

    await ok('a player with no id changing quality does not cut a named viewer; the two-stream bound stays', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        const b = await relay.start('streamer_one', '360');
        assert.deepStrictEqual([T.sessions.size, await status(a.id), await status(b.id)], [2, 200, 200]);
        assert.deepStrictEqual(listed(st, a.id), ['va']);
        T.sessions.get(a.id).lastHit -= 10000; // asked for longest ago, but there is room once the nameless one is gone
        const c = await relay.start('streamer_one', '160', 'vc');
        assert.deepStrictEqual([...T.sessions.keys()].sort(), [a.id, c.id].sort(), 'the nameless stream of another quality ends (nobody on it); va\'s stays');
        assert.deepStrictEqual([st.get(b.id), await status(b.id), await status(a.id)], [null, 404, 200]);
    });

    await ok('the two-stream bound: with three qualities wanted, the least recently asked one goes', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        const b = await relay.start('streamer_one', '360', 'vb');
        T.sessions.get(a.id).lastHit -= 10000;
        const c = await relay.start('streamer_one', '160', 'vc');
        assert.deepStrictEqual([...T.sessions.keys()].sort(), [b.id, c.id].sort());
        assert.ok(st.get(a.id), 'va is somebody else: the bound does not end va\'s address for good');
        assert.strictEqual(await status(a.id), 200, 'with no room another quality of the channel answers it');
        assert.strictEqual(T.sessions.size, 2);
    });

    await ok('the two-stream bound: another channel somebody else is on keeps its record; the requester\'s own and a nameless one end for good', async () => {
        for (const [victim, kept] of [['vx', true], ['vc', false], [undefined, false]]) {
            const { st } = fresh();
            const x = await relay.start('other_two', '480', victim);
            await relay.start('third_3', '480', 'vy');
            T.sessions.get(x.id).lastHit -= 10000;
            await relay.start('streamer_one', '480', 'vc');
            assert.ok(!T.sessions.has(x.id));
            assert.strictEqual(!!st.get(x.id), kept, `victim held by ${victim}`);
            assert.strictEqual(await status(x.id), kept ? 503 : 404, 'kept: full house, come back later');
        }
    });

    await ok('records of other qualities: the viewer is taken off; only those with nobody left (or that name nobody) go', async () => {
        const mine = idN(11);
        const shared = idN(12);
        const empty = idN(13);
        const legacy = idN(14);
        const theirs = idN(15);
        const sameQ = idN(16);
        const { st } = fresh({ [mine]: REC({ mode: '360', viewers: ['va'] }), [shared]: REC({ mode: '360', viewers: ['va', 'vb'] }), [empty]: REC({ mode: '160', viewers: [] }), [legacy]: REC({ mode: 'audio' }), [theirs]: REC({ mode: 'audio', viewers: ['vc'] }), [sameQ]: REC({ viewers: ['va'] }) });
        await relay.start('streamer_one', '480', 'va');
        assert.deepStrictEqual([st.get(mine), st.get(empty), st.get(legacy)], [null, null, null]);
        assert.deepStrictEqual([listed(st, shared), listed(st, theirs), listed(st, sameQ)], [['vb'], ['vc'], ['va']]);
    });

    await ok('after a module reload the list comes from the record: one leaving does not end it, the last one does', async () => {
        await logged(async () => {
            const { st } = fresh();
            const a = await relay.start('streamer_one', '480', 'va');
            await relay.start('streamer_one', '480', 'vb');
            T.accept(T.dispose());
            assert.strictEqual(T.sessions.size, 0);
            comeBack(await get(a.id, 'index.m3u8'));
            await until200(a.id);
            assert.deepStrictEqual(onIt(a.id), ['va', 'vb']);
            assert.strictEqual(await leaves(a.id, 'va'), false);
            assert.deepStrictEqual([await status(a.id), listed(st, a.id)], [200, ['vb']]);
            assert.strictEqual(await leaves(a.id, 'vb'), true);
            assert.deepStrictEqual([await status(a.id), st.get(a.id)], [404, null]);
        });
    });

    await ok('after the idle end and the revive the same rule holds', async () => {
        await logged(async () => {
            const { st } = fresh();
            const a = await relay.start('streamer_one', '480', 'va');
            await relay.start('streamer_one', '480', 'vb');
            const dir = T.sessions.get(a.id).dir;
            idleEnd(a.id);
            assert.strictEqual(T.sessions.size, 0);
            assert.deepStrictEqual(listed(st, a.id), ['va', 'vb'], 'an idle end takes nobody off');
            await until(() => !fs.existsSync(dir));
            comeBack(await get(a.id, 'index.m3u8'));
            await until200(a.id);
            assert.deepStrictEqual(onIt(a.id), ['va', 'vb']);
            assert.strictEqual(await leaves(a.id, 'vb'), false);
            assert.deepStrictEqual([await status(a.id), listed(st, a.id)], [200, ['va']]);
            assert.strictEqual(await leaves(a.id, 'va'), true);
            assert.strictEqual(await status(a.id), 404);
        });
    });

    await ok('stop with no session in memory: the record loses the viewer and stays while others are listed', async () => {
        const legacy = idN(2);
        const { st, b } = fresh({ [OLD]: REC({ viewers: ['va', 'vb'] }), [legacy]: REC() });
        assert.strictEqual(await leaves(OLD, 'va'), false);
        assert.deepStrictEqual(listed(st, OLD), ['vb']);
        assert.strictEqual(await leaves(OLD, 'va'), false);
        assert.deepStrictEqual([listed(st, OLD), b.forgotten], [['vb'], []]);
        assert.strictEqual(await leaves(OLD, 'vb'), false, 'there was no session to stop');
        assert.deepStrictEqual([st.get(OLD), await status(OLD)], [null, 404]);
        assert.ok(b.forgotten.includes(OLD));
        assert.strictEqual(await leaves(legacy, 'va'), false);
        assert.deepStrictEqual([st.get(legacy), await status(legacy)], [null, 404], 'a record with no list: as before');
        assert.strictEqual(spawned.length, 0);
    });

    await ok('leaving while a revive reads the address: it goes on for the others, with the list as it is now', async () => {
        await logged(async () => {
            const { st } = fresh({ [OLD]: REC({ viewers: ['va', 'vb'] }) });
            const gate = gateFetch();
            comeBack(await get(OLD, 'index.m3u8'));
            await until(() => gate.waiting === 1);
            assert.strictEqual(await leaves(OLD, 'va'), false);
            gate.open();
            await until200(OLD);
            await settle();
            assert.deepStrictEqual([onIt(OLD), listed(st, OLD), spawned.length], [['vb'], ['vb'], 1], 'va does not come back with the session');
            assert.strictEqual(await leaves(OLD, 'vb'), true);
            assert.strictEqual(await status(OLD), 404);
        });
    });

    await ok('the only viewer leaving while a revive reads the address: it ends without a session', async () => {
        await logged(async () => {
            const { st } = fresh({ [OLD]: REC({ viewers: ['va'] }) });
            const gate = gateFetch();
            comeBack(await get(OLD, 'index.m3u8'));
            await until(() => gate.waiting === 1);
            assert.strictEqual(await leaves(OLD, 'va'), false);
            gate.open();
            await settle();
            assert.deepStrictEqual([T.sessions.size, spawned.length, st.get(OLD), await status(OLD)], [0, 0, null, 404]);
        });
    });

    await ok('leaving while the revived session is starting: one of two lets it go on, the last one ends it', async () => {
        await logged(async () => {
            const { st } = fresh({ [OLD]: REC({ viewers: ['va', 'vb'] }) });
            T.setHooks({ address: stdAddress, spawn: silentSpawn });
            comeBack(await get(OLD, 'index.m3u8'));
            await until(() => spawned.length === 1);
            assert.strictEqual(await leaves(OLD, 'va'), false);
            assert.deepStrictEqual([T.sessions.size, onIt(OLD), listed(st, OLD)], [1, ['vb'], ['vb']]);
            assert.strictEqual(await leaves(OLD, 'vb'), true);
            await settle();
            assert.deepStrictEqual([T.sessions.size, st.get(OLD), await status(OLD)], [0, null, 404]);
        });
    });

    await ok('alias merge: the old address\'s viewer is protected when the running session\'s viewer leaves', async () => {
        const { st, b } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        st.put(OLD, REC({ viewers: ['vb'] }));
        assert.strictEqual(await status(OLD), 200);
        assert.strictEqual(T.aliases.get(OLD), a.id);
        assert.deepStrictEqual([onIt(a.id), listed(st, a.id), listed(st, OLD)], [['va', 'vb'], ['va', 'vb'], ['vb']]);
        assert.strictEqual(await leaves(a.id, 'va'), false);
        assert.deepStrictEqual([await status(a.id), await status(OLD)], [200, 200]);
        assert.ok(!spawned[0].child.killed);
        assert.strictEqual(await leaves(OLD, 'vb'), true);
        assert.deepStrictEqual([await status(a.id), await status(OLD), st.get(a.id), st.get(OLD), T.aliases.size], [404, 404, null, null, 0]);
        assert.deepStrictEqual([spawned.length, b.calls.length], [1, 0]);
    });

    await ok('an old address nobody is left on goes while the session stays; one that names nobody stays with it', async () => {
        const legacy = idN(2);
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        st.put(OLD, REC({ viewers: ['vb'] }));
        st.put(legacy, REC());
        assert.deepStrictEqual([await status(OLD), await status(legacy)], [200, 200]);
        assert.strictEqual(await leaves(OLD, 'vb'), false);
        assert.deepStrictEqual([st.get(OLD), T.aliases.has(OLD), await status(OLD)], [null, false, 404]);
        assert.deepStrictEqual([await status(a.id), await status(legacy), listed(st, legacy)], [200, 200, 'no list']);
        assert.strictEqual(await leaves(a.id, 'va'), true);
        assert.deepStrictEqual([await status(a.id), await status(legacy), st.get(legacy)], [404, 404, null]);
    });

    await ok('alias merge into a session still starting: its record gets the merged list', async () => {
        const { st } = fresh();
        encoderDelay = 150;
        const pending = relay.start('streamer_one', '480', 'va');
        await until(() => spawned.length === 1);
        st.put(OLD, REC({ viewers: ['vb'] }));
        comeBack(await get(OLD, 'index.m3u8'));
        const a = await pending;
        assert.deepStrictEqual([onIt(a.id), listed(st, a.id)], [['va', 'vb'], ['va', 'vb']]);
        assert.strictEqual(await leaves(a.id, 'va'), false);
        assert.strictEqual(await status(OLD), 200);
    });

    await ok('two starts of one quality at the same time are ONE session with both viewers', async () => {
        const { st } = fresh();
        const gate = gateFetch();
        const both = [relay.start('streamer_one', '480', 'va'), relay.start('streamer_one', '480', 'vb')];
        await until(() => gate.waiting === 2);
        gate.open();
        const [a, b] = await Promise.all(both);
        assert.strictEqual(a.id, b.id);
        assert.deepStrictEqual([T.sessions.size, spawned.length, a.state, b.state], [1, 1, 'live', 'live']);
        assert.deepStrictEqual([onIt(a.id), listed(st, a.id)], [['va', 'vb'], ['va', 'vb']]);
    });

    await ok('the same with a stream to replace on the way: still one session', async () => {
        fresh();
        const old = await relay.start('streamer_one', '360');
        const gate = gateFetch();
        const both = [relay.start('streamer_one', '480', 'va'), relay.start('streamer_one', '480', 'vb')];
        await until(() => gate.waiting === 2);
        gate.open();
        const [a, b] = await Promise.all(both);
        assert.strictEqual(a.id, b.id);
        assert.deepStrictEqual([T.sessions.size, spawned.length, onIt(a.id), await status(old.id)], [1, 2, ['va', 'vb'], 404]);
    });

    await ok('an Audio First viewer is not handed another viewer\'s 1080p: its own quality is started when there is room', async () => {
        await logged(async () => {
            const { st, b } = fresh();
            const big = await relay.start('streamer_one', 'hw1080', 'desk');
            st.put(OLD, REC({ mode: 'audio', viewers: ['phone'] }));
            comeBack(await get(OLD, 'index.m3u8'));
            await until200(OLD);
            assert.deepStrictEqual([T.sessions.size, T.sessions.get(OLD).mode.id, T.aliases.size, b.calls], [2, 'audio', 0, [OLD]]);
            assert.deepStrictEqual([onIt(OLD), onIt(big.id), await status(big.id)], [['phone'], ['desk'], 200]);
            assert.ok(!spawned[0].child.killed);
        });
    });

    await ok('the revive budget applies to it: a refused try waits and is not aliased to the other quality', async () => {
        const { st, b } = fresh();
        await relay.start('streamer_one', 'hw1080', 'desk');
        st.put(OLD, REC({ mode: 'audio', viewers: ['phone'] }));
        b.allow = false;
        b.wait = 12000;
        assert.strictEqual(comeBack(await get(OLD, 'index.m3u8')), 12);
        assert.deepStrictEqual([T.aliases.size, T.sessions.size, spawned.length], [0, 1, 1]);
    });

    await ok('another quality still answers when all its viewers are on it, or when there is no room', async () => {
        const { st, b } = fresh();
        const big = await relay.start('streamer_one', 'hw1080', 'desk');
        st.put(OLD, REC({ mode: 'audio', viewers: ['desk'] }));
        assert.strictEqual(await status(OLD), 200);
        assert.strictEqual(T.aliases.get(OLD), big.id);
        await relay.start('other_two', '480', 'x');
        const full = idN(2);
        st.put(full, REC({ mode: 'audio', viewers: ['phone'] }));
        assert.strictEqual(await status(full), 200);
        assert.deepStrictEqual([T.aliases.get(full), T.sessions.size, spawned.length, b.calls.length], [big.id, 2, 2, 0]);
        assert.deepStrictEqual(onIt(big.id), ['desk', 'phone'], 'and the phone is on it now');
    });

    await ok('a running session of the same quality is preferred over another one of the channel', async () => {
        const { st } = fresh();
        await relay.start('streamer_one', '480', 'va');
        const sound = await relay.start('streamer_one', 'audio', 'vb');
        st.put(OLD, REC({ mode: 'audio', viewers: ['vc'] }));
        assert.strictEqual(await status(OLD), 200);
        assert.deepStrictEqual([T.aliases.get(OLD), spawned.length], [sound.id, 2]);
    });

    await ok('another quality started while a revive reads the address: the same rule after the read', async () => {
        await logged(async () => {
            fresh({ [OLD]: REC({ mode: 'audio', viewers: ['phone'] }) });
            const gate = gateFetch();
            comeBack(await get(OLD, 'index.m3u8'));
            await until(() => gate.waiting === 1);
            const pending = relay.start('streamer_one', 'hw1080', 'desk');
            await until(() => gate.waiting === 2);
            gate.open();
            const big = await pending;
            await until200(OLD);
            await settle();
            assert.deepStrictEqual([T.sessions.size, T.sessions.get(OLD).mode.id, onIt(OLD), onIt(big.id), T.aliases.size], [2, 'audio', ['phone'], ['desk'], 0]);
        });
    });

    await ok('state() of an address with no session is "gone" even with a record (decided so), and its playlist comes back', async () => {
        await logged(async () => {
            const { st } = fresh({ [OLD]: REC({ viewers: ['va'] }) });
            assert.deepStrictEqual(relay.state(OLD), { id: OLD, state: 'gone' });
            assert.deepStrictEqual([addressReads, spawned.length, T.sessions.size, T.reviving.size], [0, 0, 0, 0], 'asking for the state starts nothing');
            assert.ok(st.get(OLD));
            assert.strictEqual(comeBack(await get(OLD, 'index.m3u8')), 3);
            await until200(OLD);
        });
    });

    await ok('a broken run others are on is replaced: their address answers from the new one and their viewers come over', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        await relay.start('streamer_one', '480', 'vb');
        breakRun(a.id);
        const b = await relay.start('streamer_one', '480', 'va');
        assert.notStrictEqual(b.id, a.id);
        assert.deepStrictEqual([T.sessions.size, T.aliases.get(a.id), onIt(b.id), listed(st, b.id)], [1, b.id, ['va', 'vb'], ['va', 'vb']]);
        assert.ok(st.get(a.id), 'the old record stays');
        assert.deepStrictEqual([await status(a.id), await status(b.id)], [200, 200]);
        assert.strictEqual(await leaves(b.id, 'va'), false);
        assert.deepStrictEqual([await status(a.id), await status(b.id)], [200, 200]);
        assert.strictEqual(await leaves(a.id, 'vb'), true);
        assert.deepStrictEqual([await status(a.id), await status(b.id), st.get(a.id), st.get(b.id)], [404, 404, null, null]);
    });

    await ok('a broken run only the starter is on is replaced for good; a nameless start carries named viewers over', async () => {
        const { st } = fresh();
        const a = await relay.start('streamer_one', '480', 'va');
        breakRun(a.id);
        const b = await relay.start('streamer_one', '480', 'va');
        assert.deepStrictEqual([st.get(a.id), T.aliases.size, await status(a.id), await status(b.id)], [null, 0, 404, 200]);
        breakRun(b.id);
        const c = await relay.start('streamer_one', '480');
        assert.deepStrictEqual([T.aliases.get(b.id), onIt(c.id), await status(b.id)], [c.id, ['va'], 200]);
    });

    await ok('a failed start takes no other viewer\'s address with it, even one already pointed at it', async () => {
        await logged(async () => {
            const nameless = idN(2);
            const { st } = fresh();
            const a = await relay.start('streamer_one', '480', 'va');
            await relay.start('streamer_one', '480', 'vb');
            breakRun(a.id);
            T.setHooks({ address: stdAddress, spawn: silentSpawn });
            const pending = relay.start('streamer_one', '480', 'va');
            const failed = assert.rejects(pending, (e) => e.code === 'KICK_STREAM');
            await until(() => spawned.length === 2);
            const s = spawned[1].session;
            st.put(nameless, REC());
            comeBack(await get(a.id, 'index.m3u8')); // pointed at the one still starting
            comeBack(await get(nameless, 'index.m3u8'));
            assert.deepStrictEqual([T.aliases.get(a.id), T.aliases.get(nameless)], [s.id, s.id]);
            s.child = null; // the encoder gave up: the start fails
            await failed;
            assert.deepStrictEqual([T.sessions.size, T.aliases.size, st.get(nameless)], [0, 0, null], 'an address that names nobody goes with it, as before');
            assert.ok(listed(st, a.id).includes('vb'), 'vb\'s record stays');
            T.setHooks({ address: stdAddress, spawn: fakeSpawn });
            comeBack(await get(a.id, 'index.m3u8'));
            await until200(a.id);
        });
    });

    await ok('a failed revive clears only its own run, never the newer session its address has moved to', async () => {
        await logged(async () => {
            const { st } = fresh({ [OLD]: REC({ viewers: ['va'] }) });
            T.setHooks({ address: stdAddress, spawn: silentSpawn });
            comeBack(await get(OLD, 'index.m3u8'));
            await until(() => spawned.length === 1);
            T.sessions.get(OLD).state = 'error'; // it broke while starting
            T.setHooks({ address: stdAddress, spawn: fakeSpawn });
            const b = await relay.start('streamer_one', '480', 'vb');
            await settle(); // the revive notices its run is gone and fails
            assert.deepStrictEqual([[...T.sessions.keys()], T.aliases.get(OLD)], [[b.id], b.id]);
            assert.ok(!spawned[1].child.killed, 'the new encoder runs');
            assert.deepStrictEqual([await status(OLD), await status(b.id), listed(st, OLD), onIt(b.id)], [200, 200, ['va'], ['va', 'vb']]);
        });
    });

    await ok('stopped while a restart reads the address: no encoder is started for the gone session', () => logged(async () => {
        fresh();
        const a = await relay.start('streamer_one', '480');
        let release = null;
        T.setHooks({ address: async () => { await new Promise((r) => { release = r; }); return stdAddress(); }, spawn: fakeSpawn });
        spawned[0].child.emit('close', 1);
        await until(() => !!release); // the restart is reading a fresh address
        const n = spawned.length;
        assert.strictEqual(await relay.stop(a.id), true);
        release();
        await wait(100);
        assert.strictEqual(spawned.length, n, 'nothing started');
        assert.strictEqual(T.sessions.size, 0);
    }));

    server.close();
    T.reset();
    console.log(`\n${pass} passed${process.exitCode ? ', with failures' : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(process.exitCode || 0);
})();
