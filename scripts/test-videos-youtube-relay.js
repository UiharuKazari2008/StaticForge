#!/usr/bin/env node
/**
 * modules/videosYoutubeRelay.js (Yozora #920) without YouTube, yt-dlp or ffmpeg: the format asked of yt-dlp per
 * mode, the ffmpeg command (picture and sound from pipes, a start place, copy or a light encode), and a
 * session's life (start, the same request joined, a new place replacing it, stop).
 *
 *   node scripts/test-videos-youtube-relay.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yt-relay-test-'));
process.env.VIDEOS_YT_DIR = path.join(tmp, 'yt');
const relay = require('../modules/videosYoutubeRelay');
const T = relay._test;

const tests = [];
const ok = (name, fn) => tests.push([name, fn]);
const SRC = { title: 'A video', duration: 600, formats: ['135', '140'], json: '{}', copy: true, audioOnly: false, height: 480, kbit: 500 };
const spawned = [];
function fakeSpawn(args, session) {
    const child = new EventEmitter();
    child.kill = () => { setImmediate(() => child.emit('close', null)); };
    spawned.push({ args, child });
    // ffmpeg writes its list a moment later
    setTimeout(() => { try { fs.writeFileSync(path.join(session.dir, 'index.m3u8'), '#EXTM3U\n#EXTINF:4,\ns00000.ts\n'); } catch (_e) { /* stopped */ } }, 30);
    return child;
}
function fresh(src) { T.reset(); spawned.length = 0; fresh.asked = []; T.setHooks({ info: async (id, mode) => { fresh.asked.push([id, mode.id]); if (src instanceof Error) throw src; return src || SRC; }, spawn: fakeSpawn }); }

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

(async () => {
    let pass = 0; let failed = 0;
    for (const [name, fn] of tests) { try { await fn(); pass++; console.log(`  ok  ${name}`); } catch (e) { failed++; console.error(`  FAIL ${name}\n${e.stack}`); } }
    T.reset();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`\n${pass} passed, ${failed} failed`);
    process.exit(failed ? 1 : 0);
})();
