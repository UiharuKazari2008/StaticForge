#!/usr/bin/env node
/**
 * Melaton Videos on the media session bus (melatonMediaSessions.js): the phone screen and the DeX desktop are two
 * pages of one app; opening Videos on one takes the other's stream (live or a YouTube video through the server, with
 * its position), a stream started on one stops Videos on the other, and Videos only ever stops the app's native player
 * for a stream it handed over itself (the native player is shared with XM Radio).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/wmYouTube.js'), 'utf8');

assert.ok(!/localStorage\.\w+\(\s*HANDED_KEY|wmVideosHanded/.test(src), 'no localStorage note any more: the bus carries it');
assert.ok(/window\.melatonMedia\.register\('videos', mediaSpec, \{ signal: appScopeSignal \}\)/.test(src), 'Videos registers its session with an owner signal');
assert.ok(/if \(window\.melatonMedia && page\) window\.melatonMedia\.offerTransfer\('videos', page\);/.test(src), 'show() offers "Playing on <the other screen>" with its Transfer');
assert.ok(!/melatonMedia\.pull\('videos'\)/.test(src), 'nothing moves without the Transfer');
assert.ok(/function plTell\(\) \{\s*\/\/[^\n]*\n\s*if \(window\.melatonMedia\) window\.melatonMedia\.changed\('videos'\);/.test(src), 'every play state change tells the other window');
assert.ok(/if \(nv && \(p\.handed \|\| p\.popped\)\) \{ try \{ nv\.stop\(\); \}/.test(src), 'stopPlayer stops the native player only for its own hand-off');
assert.ok(!/addEventListener\('playing'[\s\S]{0,600}nv\.stop\(\)/.test(src), 'starting a video here never stops the shared native player directly');

// describe / take round trip, run on the extracted functions with stubs
const desc = src.match(/function mediaDescribe\(\) \{[\s\S]*?\n {4}\}\n/)[0];
const spec = src.match(/const mediaSpec = \{[\s\S]*?\n {4}\};\n/)[0];
const calls = [];
const env = new Function('player', 'els', 'nativePlayer', 'watchLive', 'watchVideo', 'stopPlayer', `${desc}\n${spec}\nreturn { mediaDescribe, mediaSpec };`);
const live = env({ slug: 'asmongold', channel: 'asmongold', streamTitle: 'BIG DAY', startedAt: 5, kickUrl: 'https://kick.com/asmongold', state: 'live', handed: true },
    { video: { paused: true, ended: false, currentTime: 0 } }, () => null, (v) => calls.push(['live', v]), (v) => calls.push(['video', v]), () => calls.push(['stop']));
const s = live.mediaDescribe();
assert.deepStrictEqual(s, { title: 'asmongold', subtitle: 'BIG DAY', kind: 'live', source: { v: { id: 'kick:asmongold', channel: 'asmongold', title: 'BIG DAY', at: 5, url: 'https://kick.com/asmongold' } }, playing: true, native: true }, 'a handed-over live stream counts as playing');
assert.strictEqual(live.mediaSpec.take(s), true);
assert.deepStrictEqual(calls.pop(), ['live', s.source.v], 'take() opens the same channel');
assert.deepStrictEqual(live.mediaSpec.release('taken'), s, 'release() says what it was');
assert.deepStrictEqual(calls.pop(), ['stop'], 'and stops it here');
const vod = env({ kind: 'ytr', item: { id: 'abc123def45', title: 'T' }, title: 'T', channel: 'C', state: 'live' },
    { video: { paused: false, ended: false, currentTime: 61.5 } }, () => null, () => {}, (v) => calls.push(['video', v]), () => {});
const sv = vod.mediaDescribe();
assert.strictEqual(sv.kind, 'video'); assert.strictEqual(sv.position, 61500); assert.strictEqual(sv.playing, true);
vod.mediaSpec.take(sv);
const [, v] = calls.pop();
assert.ok(v.id === 'abc123def45' && v.resume === 61 && v.progress === 50 && v.watched === false, 'a YouTube video resumes where it was');
console.log('test-videos-media-session: ok');
