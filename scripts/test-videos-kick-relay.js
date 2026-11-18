#!/usr/bin/env node
/**
 * modules/videosKickRelay.js (Yozora #918) without Kick, the browser or ffmpeg: the stream's renditions and
 * which one a mode pulls, the ffmpeg command per mode, a session's life (start, join, replace, stop, idle end),
 * a restart with a fresh address when the encoder stops, and the end when the channel went offline.
 *
 *   node scripts/test-videos-kick-relay.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kick-relay-test-'));
process.env.VIDEOS_LIVE_DIR = path.join(tmp, 'live');
const relay = require('../modules/videosKickRelay');
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
// a stand-in encoder: writes a list with two pieces, then waits to be stopped
function fakeSpawn(args, session) {
    const child = new EventEmitter();
    child.kill = () => { child.killed = true; setImmediate(() => child.emit('close', 0)); };
    spawned.push({ args, child, session });
    setTimeout(() => { fs.promises.writeFile(path.join(session.dir, 'index.m3u8'), '#EXTM3U\n#EXTINF:4.0,\ns00000.ts\n#EXTINF:4.0,\ns00001.ts\n').catch(() => {}); }, 30);
    return child;
}
T.setHooks({ address: async () => { addressReads++; return live ? { live: true, playback: 'https://video.example/master.m3u8?token=t' } : { live: false, playback: '' }; }, spawn: fakeSpawn });
global.fetch = async () => ({ status: 200, text: async () => MASTER });
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
        for (const id of ['hw720', 'hw540', 'e480', 'e360']) assert.ok(/fps=30/.test(by[id]), id);
        assert.ok(/h264_vaapi/.test(by.hw720) && /-vaapi_device \S+ -i IN/.test(by.hw720));
        assert.ok(/libx264 -preset slow/.test(by.e360) && /scale=-2:360/.test(by.e360));
        assert.ok(/fps=1,/.test(by.audio) && /zerolatency/.test(by.audio) && /-b:a 96k/.test(by.audio));
        assert.ok(Object.values(by).every((a) => /-hls_time 4 -hls_list_size 15/.test(a) && /delete_segments/.test(a)));
        assert.deepStrictEqual(relay.modes().map((m) => m.id), ['480', '360', '160', 'hw720', 'hw540', 'e480', 'e360', 'audio']);
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

    T.reset();
    console.log(`\n${pass} passed${process.exitCode ? ', with failures' : ''}`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(process.exitCode || 0);
})();
