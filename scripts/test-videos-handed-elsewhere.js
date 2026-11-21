#!/usr/bin/env node
/**
 * Melaton Videos on two pages of one app (the Fold's phone screen and its DeX desktop share one WebView and its
 * localStorage): the page that hands a live stream to the app's native player (picture-in-picture / sound) notes it,
 * and Videos opened on the other page takes that stream back; a page whose own video starts playing stops the native
 * player, so two never play (Yukimi, Nov 21 2026: "it will play 2 and i have to go and close it").
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/wmYouTube.js'), 'utf8');
const block = src.match(/const HANDED_KEY = [\s\S]*?\n {4}function handedElsewhere\(\) \{[\s\S]*?\n {4}\}\n/);
assert.ok(block, 'the hand-off note is in wmYouTube.js');
const store = new Map();
const localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
let active = false;
const nativePlayer = () => ({ isActive: () => active });
const api = new Function('localStorage', 'nativePlayer', `${block[0]}\nreturn { noteHanded, dropHanded, handedElsewhere };`)(localStorage, nativePlayer);

const p = { slug: 'asmongold', channel: 'asmongold', streamTitle: 'BIG DAY', startedAt: 1, kickUrl: 'https://kick.com/asmongold' };
api.noteHanded(p);
assert.strictEqual(api.handedElsewhere(), null, 'nothing to take while the native player is not playing');
active = true;
assert.deepStrictEqual(api.handedElsewhere(), { id: 'kick:asmongold', channel: 'asmongold', title: 'BIG DAY', at: 1, url: 'https://kick.com/asmongold' }, 'Videos on the other page gets the channel to open');
api.dropHanded();
assert.strictEqual(api.handedElsewhere(), null, 'taken back: the note goes');
api.noteHanded({ kind: 'ytr', vod: true, slug: '' });
assert.strictEqual(api.handedElsewhere(), null, 'a YouTube video through the server is not noted (it needs its position)');
// the wiring: show() opens the noted stream, take-back drops the note, the page's own playing stops the native player
assert.ok(/if \(!player\) \{ const v = handedElsewhere\(\); if \(v\) watchLive\(v\); \}/.test(src), 'show() takes a stream another page handed over');
assert.ok(/try \{ nv\.stop\(\); \} catch \(_\) \{ \/\* gone \*\/ \}\n\s+dropHanded\(\);/.test(src), 'plTakeBack drops the note');
assert.ok(/addEventListener\('playing'[\s\S]{0,700}if \(active\) \{ try \{ nv\.stop\(\); \}/.test(src), "the page's own playing stops the native player");
assert.ok(/player\.handed = nv\.handOff\(\) === true;[^\n]*if \(player\.handed\) noteHanded\(player\)/.test(src) && /p\.popped = true;\n\s+noteHanded\(p\);/.test(src), 'hand-off and pop-out note the stream');
console.log('test-videos-handed-elsewhere: ok');
