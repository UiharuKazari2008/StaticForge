#!/usr/bin/env node
// Windows Media Player across the Dreamscape app's two windows (melatonMediaSessions.js, Yukimi Nov 21 2026: "all
// media can transfer its session and know what each are doing"): the desktop's Media Player (desktop-apps/mediaPlayer.js
// mediaPlayerSession) and the phone screen's Melaton Media (wmMedia.js sessionEntry / sessionItem) register
// 'mediaplayer' and describe what plays in the same source shape, so each can play the other's session.
// Run: node scripts/test-mediaplayer-media-session.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- the desktop's half (the module exports it for node)
global.window = global;
global.location = { href: 'https://dreamscape.test/app.html' };
global.document = { body: { appendChild() {} }, createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, dataset: {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }), addEventListener() {} };
global.vfsClient = { getBasePath: () => '/vfs/abc' };
global.AndroidMediaLibrary = { baseUrl: () => 'https://appassets.local/media' };
const D = require('../public/scripts/comp/desktop-apps/mediaPlayer.js').mediaPlayerSession;
assert.ok(D && typeof D.entry === 'function' && typeof D.resolve === 'function', 'mediaPlayer.js exports mediaPlayerSession');

// ---- the phone's half, taken from the source (wmMedia.js runs only in the phone shell)
function extract(src, name) {
    const at = src.indexOf(`function ${name}(`);
    assert.ok(at >= 0, `wmMedia.js has ${name}`);
    let i = src.indexOf('{', src.indexOf(')', at));
    let depth = 0;
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) break;
    }
    return src.slice(at, i + 1);
}
const wm = read('public/scripts/comp/wmMedia.js');
// eslint-disable-next-line no-new-func
const P = new Function(`${extract(wm, 'sessionEntry')}\n${extract(wm, 'sessionItem')}\nreturn { sessionEntry, sessionItem };`)();
const HERE = global.location.href;
const ctx = { phoneBase: 'https://appassets.local/media', vfsBase: '/vfs/abc' };

const SHAPE = (e) => Object.keys(e).sort().join(',');
const ADDR = (e) => JSON.stringify({ type: e.type, id: e.id, hash: e.hash, volume: e.volume, path: e.path, fileId: e.fileId, url: e.url, kind: e.kind });

// the same things as each window holds them: a server library song, a phone MediaStore song and video, a workspace file, a URL
const pairs = [
    {
        label: 'server library song',
        desktop: { name: 'Song', title: 'Song', artist: 'A', album: 'B', mime: 'audio/mpeg', kind: 'audio', url: '/vfs/abc/media/file/7', source: { type: 'server', id: 7, hash: 'h7' } },
        phone: { kind: 'audio', src: 'vfs', serverId: 7, fileId: 7, hash: 'h7', name: 'Song', title: 'Song', file: 'song.mp3', artist: 'A', album: 'B', mime: 'audio/mpeg' }
    },
    {
        label: 'phone MediaStore song',
        desktop: { name: 'Tune', title: 'Tune', artist: 'C', album: '', mime: 'audio/mpeg', kind: 'audio', url: 'https://appassets.local/media/audio/external_primary/41', source: { type: 'phone', volume: 'external_primary', id: 41 } },
        phone: { kind: 'audio', src: 'android', id: 41, volume: 'external_primary', name: 'Tune', title: 'Tune', artist: 'C', album: '', mime: 'audio/mpeg', url: 'https://appassets.local/media/audio/external_primary/41' }
    },
    {
        label: 'phone MediaStore video',
        desktop: { name: 'Clip', title: 'Clip', mime: 'video/mp4', kind: 'video', url: 'https://appassets.local/media/video/external_primary/9', source: { type: 'phone', volume: 'external_primary', id: 9 } },
        phone: { kind: 'video', src: 'android', id: 9, volume: 'external_primary', name: 'Clip', title: 'Clip', mime: 'video/mp4', url: 'https://appassets.local/media/video/external_primary/9' }
    },
    {
        label: 'workspace file',
        desktop: { name: 'take.mp3', title: '', mime: '', kind: 'audio', vfs: { dir: '/Workspaces/Default/Music', item: { name: 'take.mp3' } } },
        phone: { kind: 'audio', src: 'vfs', path: '/Workspaces/Default/Music/take.mp3', fileId: null, name: 'take', title: 'take', file: 'take.mp3' }
    },
    {
        label: 'web address',
        desktop: { name: 'radio.mp3', title: '', kind: 'audio', url: 'https://example.test/radio.mp3' },
        phone: { kind: 'audio', name: 'radio', title: '', file: 'radio.mp3', url: 'https://example.test/radio.mp3' }
    }
];

pairs.forEach(({ label, desktop, phone }) => {
    const d = D.entry(desktop);
    const p = P.sessionEntry(phone, HERE);
    assert.ok(d && p, `${label}: both windows describe it`);
    assert.strictEqual(SHAPE(d), SHAPE(p), `${label}: the same entry keys on both shells`);
    assert.strictEqual(ADDR(d), ADDR(p), `${label}: the same address on both shells`);
});

// a file from this computer's disk cannot travel
assert.strictEqual(D.entry({ name: 'a.mp3', file: {}, url: '', kind: 'audio' }), null, 'a local File is left out');
assert.strictEqual(D.entry({ name: 'a.mp3', url: 'blob:https://x/1', kind: 'audio' }), null, 'a blob: address is left out');
assert.strictEqual(P.sessionEntry({ name: 'a', url: 'blob:https://x/1' }, HERE), null, 'and on the phone');

// relative addresses travel absolute
assert.strictEqual(D.entry({ name: 'x.webm', url: '/gallery/x.webm', kind: 'video' }).url, 'https://dreamscape.test/gallery/x.webm');

// the phone's entries play on the desktop
const player = { library: { data: {} } };
const srv = D.resolve(player, P.sessionEntry(pairs[0].phone, HERE));
assert.strictEqual(srv.url, '/vfs/abc/media/file/7', 'a server song plays from the server library');
assert.deepStrictEqual(srv.source, { type: 'server', id: 7, hash: 'h7' }, 'and keeps its source for the next hand-over');
const tune = D.resolve(player, P.sessionEntry(pairs[1].phone, HERE));
assert.strictEqual(tune.url, pairs[1].phone.url, 'a phone song plays from the app\'s MediaStore address');
const clip = D.resolve(player, P.sessionEntry(pairs[2].phone, HERE));
assert.strictEqual(clip.url, pairs[2].phone.url, 'a phone video too');
const file = D.resolve(player, P.sessionEntry(pairs[3].phone, HERE));
assert.strictEqual(file.url, '/vfs/abc/fs/read?path=' + encodeURIComponent('/Workspaces/Default/Music/take.mp3'), 'a workspace file plays through the VFS');
assert.strictEqual(file.name, 'take.mp3', 'its file name picks the stream');
assert.strictEqual(D.resolve(player, { type: 'url', url: 'javascript:alert(1)' }), null, 'only web addresses');
// a library already read lends its art and tags
player.library.data.local = { audio: [{ key: 'local:h7', art: '/vfs/abc/media/art/h7', title: 'Song (Live)', artist: 'A', album: 'B' }], video: [] };
assert.strictEqual(D.resolve(player, P.sessionEntry(pairs[0].phone, HERE)).art, '/vfs/abc/media/art/h7');

// the desktop's entries play on the phone, as its own library items would
const pSrv = P.sessionItem(D.entry(pairs[0].desktop), ctx);
assert.strictEqual(pSrv.serverId, 7, 'a server song plays from the server library (vfsUrl serverId)');
assert.strictEqual(pSrv.src, 'vfs');
const pTune = P.sessionItem(D.entry(pairs[1].desktop), ctx);
assert.strictEqual(pTune.src, 'android');
assert.strictEqual(pTune.url, pairs[1].phone.url, 'a phone song plays from the MediaStore address scanAndroid builds');
const pClip = P.sessionItem(D.entry(pairs[2].desktop), ctx);
assert.strictEqual(pClip.url, pairs[2].phone.url);
assert.ok(pClip.poster && !pClip.art, 'a video has a poster');
const pFile = P.sessionItem(D.entry(pairs[3].desktop), ctx);
assert.strictEqual(pFile.path, '/Workspaces/Default/Music/take.mp3', 'a workspace file plays through the VFS path');
assert.strictEqual(pFile.file, 'take.mp3');
assert.strictEqual(P.sessionItem(D.entry(pairs[1].desktop), { phoneBase: '' }), null, 'no MediaStore here: the phone song cannot play');

// both describe() return the same session: { title, subtitle, kind, source: { item, queue, index }, position, playing }
const mp = read('public/scripts/comp/desktop-apps/mediaPlayer.js');
[['mediaPlayer.js', mp], ['wmMedia.js', wm]].forEach(([n, s]) => {
    assert.ok(/source: index >= 0 \? \{ item: queue\[index\], queue, index \} : null/.test(s), `${n}: describe's source is { item, queue, index }`);
    assert.ok(/position: Math\.round\(\([\w.]+\.currentTime \|\| 0\) \* 1000\)/.test(s), `${n}: position in ms`);
    assert.ok(/register\((?:APP|MEDIA_APP), \{ label: [^,]+, describe(?:: mediaDescribe)?, take(?:: mediaTake)?, release(?:: mediaRelease)? \}, \{ signal: [\w.]+ \}\)/.test(s), `${n}: registers with an owner signal`);
});
assert.ok(/const APP = 'mediaplayer'/.test(mp) && /const MEDIA_APP = 'mediaplayer'/.test(wm), "the same app id, 'mediaplayer', on both shells");
// opening the player with nothing playing here pulls the other window's session
assert.ok(/mediaPlayerSession\.pullHere\(player\)/.test(mp), 'the desktop pulls on open');
assert.ok(/if \(pullElsewhere\(\)\)/.test(wm), 'the phone pulls on show');
// a page that opens a file of its own does not pull
assert.ok(/openDesktopMediaPlayer\(url \? \{ pull: false \} : null\)/.test(mp), 'Open in Media Player keeps its file');
// no timers for this (phone-power-client)
const block = (s, from, to) => s.slice(s.indexOf(from), s.indexOf(to, s.indexOf(from)));
assert.ok(!/setTimeout|setInterval|timeupdate/.test(block(mp, 'const mediaPlayerSession = ', 'mediaPlayerSession.register();')), 'desktop: no timers');
assert.ok(!/setTimeout|setInterval|timeupdate/.test(block(wm, 'function sessionEntry(', 'Play All Songs')), 'phone: no timers');

console.log('test-mediaplayer-media-session: ok');
