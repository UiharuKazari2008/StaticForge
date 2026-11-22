#!/usr/bin/env node
/**
 * XM Radio on the cross-window media session bus (melatonMediaSessions.js): the phone (public/scripts/comp/wmXmRadio.js)
 * and the desktop (apps/xmradio/client/xmradio.js) describe a playing channel with the same shape, and each finds the
 * other's channel from its source. Both register 'xmradio' with an owner signal, report changes, pull on opening, and
 * the phone's release stops the app's native player only when XM handed the stream to it. Source extraction, no DOM.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const phoneSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/wmXmRadio.js'), 'utf8');
const deskSrc = fs.readFileSync(path.join(__dirname, '../apps/xmradio/client/xmradio.js'), 'utf8');

/** The body (with its braces) of the block that starts at `sig`. */
function block(src, sig) {
    const at = src.indexOf(sig);
    assert.ok(at >= 0, `found: ${sig}`);
    let i = src.indexOf('{', at + sig.length - 1);
    const from = i;
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(from, i + 1);
    }
    throw new Error(`unclosed: ${sig}`);
}

const lineup = [{ id: 'hits1', number: 2, name: 'SiriusXM Hits 1' }, { id: 'octane', number: 37, name: 'Octane' }];
const nowMap = { octane: { a: 'Artist', t: 'Song', ad: false } };

// ---- the phone
// eslint-disable-next-line no-new-func
const phoneDescribe = new Function('radio', 'chan', 'nowOf', 'chanLabel', `return (function mediaSession() ${block(phoneSrc, 'function mediaSession()')})();`);
const pChan = (id) => lineup.find((c) => c.id === id) || null;
const pLabel = (c) => (c ? `${c.number} ${c.name}` : '');
const pNow = (id) => nowMap[id] || null;
const phone = (radio) => phoneDescribe(radio, pChan, pNow, pLabel);

// ---- the desktop
// eslint-disable-next-line no-new-func
const deskDescribe = new Function(`return ${block(deskSrc, '        mediaSession() {')};`.replace('return {', 'return function () {'));
const deskFn = deskDescribe();
const desk = (st) => deskFn.call(Object.assign({ now: new Map(Object.entries(nowMap)), recording: null }, st));
// eslint-disable-next-line no-new-func
const deskChannelOf = new Function('src', block(deskSrc, '        mediaChannel(src) {').slice(1, -1));
const deskThis = { byId: new Map(lineup.map((c) => [c.id, c])), lineup };

// off / nothing: null on both
assert.strictEqual(phone({ mode: 'live', state: 'off', channelId: 'octane' }), null, 'phone off: null');
assert.strictEqual(phone({ mode: 'live', state: 'error', channelId: 'octane' }), null, 'phone no signal: null');
assert.strictEqual(phone({ mode: 'track', state: 'playing', channelId: 'octane' }), null, 'phone tape recording: null');
assert.strictEqual(desk({ on: false, channel: lineup[1], state: 'off' }), null, 'desktop off: null');
assert.strictEqual(desk({ on: true, channel: lineup[1], state: 'nosignal' }), null, 'desktop no signal: null');
assert.strictEqual(desk({ on: true, channel: lineup[1], state: 'playing', recording: { rid: 1 } }), null, 'desktop deck recording: null');

// the same channel playing: the same session on both shells
const p = phone({ mode: 'live', state: 'playing', channelId: 'octane' });
const d = desk({ on: true, channel: lineup[1], state: 'playing' });
assert.deepStrictEqual(p, d, 'phone and desktop describe a channel alike');
assert.deepStrictEqual(Object.keys(p.source).sort(), ['channelId', 'name', 'number'], 'source: channelId, number, name');
assert.strictEqual(p.subtitle, 'Artist - Song', 'subtitle: what is on now');
assert.strictEqual(p.kind, 'radio');
assert.strictEqual(p.playing, true);
assert.deepStrictEqual(phone({ mode: 'live', state: 'paused', channelId: 'hits1' }), desk({ on: true, channel: lineup[0], state: 'paused' }), 'paused alike');
assert.strictEqual(phone({ mode: 'live', state: 'paused', channelId: 'hits1' }).playing, false, 'paused: playing false');
assert.strictEqual(phone({ mode: 'live', state: 'paused', channelId: 'hits1' }).subtitle, 'SiriusXM', 'nothing known on air: SiriusXM');

// each finds the other's channel: by id, else by number
assert.strictEqual(deskChannelOf.call(deskThis, p.source), lineup[1], 'the desktop finds the phone channel');
assert.strictEqual(deskChannelOf.call(deskThis, { channelId: 'gone', number: 2 }), lineup[0], 'the desktop falls back to the number');
assert.strictEqual(deskChannelOf.call(deskThis, { channelId: 'gone' }), null, 'unknown: null');
// eslint-disable-next-line no-new-func
const phoneChannelOf = new Function('chan', 'cache', `return ${phoneSrc.match(/const chanOfSource = (\([^)]*\) => [^\n]*);/)[1]}`)(pChan, { lineup: { channels: lineup } });
assert.strictEqual(phoneChannelOf(d.source), lineup[1], 'the phone finds the desktop channel');
assert.strictEqual(phoneChannelOf({ channelId: 'gone', number: 37 }), lineup[1], 'the phone falls back to the number');

// wiring: one registration per page with an owner signal; changes told; pulled on opening
assert.match(phoneSrc, /MEDIA\(\)\.register\('xmradio', \{[^}]*describe: mediaSession, take: mediaTake, release: mediaRelease \}, \{ signal: appScopeSignal \}\)/, 'phone registers with its segment signal');
assert.match(deskSrc, /media\.register\('xmradio', \{[^\n]*\}, \{ signal: this\.app\.signal \}\)/, 'desktop registers with app.signal');
assert.match(block(phoneSrc, 'function changed()'), /mediaChanged\(\)/, 'phone changed() tells the bus');
assert.match(block(deskSrc, '        paint() {'), /this\.mediaChanged\(\)/, 'desktop paint() tells the bus');
assert.match(block(phoneSrc, '        show() {'), /mediaPullHere\(\)/, 'phone pulls when the program shows');
assert.match(deskSrc, /this\.loaded\.then\(\(\) => this\.mediaPullHere\(\)\)/, 'desktop pulls once loaded');
assert.match(block(deskSrc, 'function start(app) {'), /running\.mediaPullHere\(\)/, 'desktop pulls when opened again');
// the native player is shared with Melaton Videos: the phone stops it only for its own stream
const rel = block(phoneSrc, 'function mediaRelease()');
assert.match(rel, /if \(radio\.native\) stopRadio\(\);\s*else \{[^}]*\}/, 'release stops the native player only when XM handed it the stream');
assert.ok(!/AndroidVideos|nv\.stop|dropNative/.test(rel.replace(/stopRadio\(\)/, '')), 'release never touches the native player directly');
assert.ok(!/setInterval/.test(block(phoneSrc, 'function mediaChanged()') + block(deskSrc, '        mediaChanged() {')), 'no timers');

console.log('test-xmradio-media-session: ok');
