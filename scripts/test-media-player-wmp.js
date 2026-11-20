#!/usr/bin/env node
// Media Player: Music and Video merged into one Windows Media Player 11 window (Yozora #454).
// The stream tables pick the kind, Next / Previous honour repeat and the list's ends, the tab
// menus carry WMP's entries, the Library filters by category, and the markup / CSS / launcher
// carry the pieces. Run: node scripts/test-media-player-wmp.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

global.window = global;
global.document = { body: { appendChild() {} }, createElement: () => ({ style: {}, classList: { add() {}, toggle() {} }, dataset: {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {} }), addEventListener() {} };
const mp = require('../public/scripts/comp/desktop-apps/mediaPlayer.js');

// kinds and playability
assert.strictEqual(mp.mediaPlayerKindFor('song.mp3', ''), 'audio');
assert.strictEqual(mp.mediaPlayerKindFor('clip.webm', ''), 'video');
assert.strictEqual(mp.mediaPlayerKindFor('clip.bin', 'video/mp4'), 'video', 'the mime wins over the name');
assert.strictEqual(mp.mediaPlayerKindFor('notes.txt', ''), '', 'unknown files are neither');
const media = { canPlayType: (t) => (t === 'audio/mpeg' || t === 'video/webm' ? 'probably' : '') };
assert.strictEqual(mp.mediaPlayerCanPlay(media, 'song.mp3', ''), true);
assert.strictEqual(mp.mediaPlayerCanPlay(media, 'song.flac', ''), false, 'the browser decides');
assert.strictEqual(mp.mediaPlayerTitle('Bear.wmv'), 'Bear');
assert.strictEqual(mp.mediaPlayerTypeName({ name: 'a.mp3' }), 'MP3 Format Sound', "Vista's type names");
assert.strictEqual(mp.mediaPlayerTypeName({ name: 'x', kind: 'folder' }), 'File Folder');
assert.strictEqual(mp.desktopMediaClock(65), '1:05');

// Next / Previous
const p = { items: [1, 2, 3], index: 2, shuffle: false, repeat: false };
assert.strictEqual(mp.mediaPlayerNextIndex(p, 1), -1, 'the list ends');
p.repeat = true;
assert.strictEqual(mp.mediaPlayerNextIndex(p, 1), 0, 'repeat wraps');
p.index = 0;
assert.strictEqual(mp.mediaPlayerNextIndex(p, -1), 2, 'and wraps backwards');
p.repeat = false;
assert.strictEqual(mp.mediaPlayerNextIndex(p, -1), -1);
assert.strictEqual(mp.mediaPlayerNextIndex({ items: [], index: -1 }, 1), -1);
p.shuffle = true;
for (let i = 0; i < 20; i++) assert.notStrictEqual(mp.mediaPlayerNextIndex(p, 1), p.index, 'shuffle never repeats the current item');

// tabs and menus
assert.deepStrictEqual(mp.WMP_TABS.map((t) => t.label), ['Now Playing', 'Library', 'Rip', 'Burn', 'Sync', 'Online Stores'], "WMP 11's tabs");
const player = { listPane: true, shuffle: false, repeat: true, items: [1], library: { category: 'video' } };
const np = mp.mediaPlayerMenuItems(player, 'now-playing').filter((i) => !i.separator);
assert.deepStrictEqual(np.map((i) => i.text), ['Show List Pane', 'Shuffle', 'Repeat', 'Open File...', 'Open URL...', 'Clear Now Playing List', 'View Full Screen']);
assert.strictEqual(np.find((i) => i.text === 'Repeat').checked, true);
const lib = mp.mediaPlayerMenuItems(player, 'library').filter((i) => !i.separator);
assert.strictEqual(lib.find((i) => i.text === 'Video').checked, true, 'the category is checked');
assert.strictEqual(mp.mediaPlayerMenuItems(player, 'rip'), null, 'the hardware tabs have no menu');
assert.ok(mp.WMP_BLANK_PAGES.rip && mp.WMP_BLANK_PAGES['online-stores']);

// Library views (#956): stacks and lengths
const L = mp.mediaPlayerLibrary;
const tracks = [
    { title: 'A', artist: 'X', album: 'One', year: 2006, genre: 'Jazz', duration: 61, art: '/a.jpg' },
    { title: 'B', artist: 'X', album: 'One', year: 2006, genre: 'Jazz', duration: 120 },
    { title: 'C', artist: 'Y', album: 'Two', year: 2009, duration: 30 }
];
const albums = L.groups(tracks, 'album');
assert.deepStrictEqual(albums.map((g) => [g.label, g.sub, g.tracks.length, g.duration, g.art]), [['One', 'X', 2, 181, '/a.jpg'], ['Two', 'Y', 1, 30, '']]);
assert.deepStrictEqual(L.groups(tracks, 'year').map((g) => g.label), ['2009', '2006'], 'years newest first');
assert.deepStrictEqual(L.groups(tracks, 'genre').map((g) => g.label), ['Jazz', 'Unknown Genre']);
assert.strictEqual(L.length(61), '1:01');
assert.strictEqual(L.length(3725), '1:02:05');

// markup
const html = mp.mediaPlayerBodyHtml();
['wmp-tabstrip', 'wmp-orb-back', 'wmp-stage', 'wmp-listpane', 'wmp-listpane-clear', 'wmp-playlist', 'wmp-addr', 'wmp-crumbs', 'wmp-search', 'wmp-tree', 'wmp-list-head', 'wmp-transport', 'wmp-seek', 'wmp-pill', 'wmp-shuffle', 'wmp-repeat', 'wmp-stop', 'wmp-prev', 'wmp-play', 'wmp-next', 'wmp-mute', 'wmp-volume', 'wmp-fullscreen', 'wmp-compact']
    .forEach((cls) => assert.ok(html.includes('class="' + cls) || html.includes(' ' + cls + '"') || html.includes(' ' + cls + ' '), cls + ' in the markup'));
assert.ok(!html.includes('data-aero-surface'), 'the transport is frame, not a surface');
assert.ok(!html.includes('Date modified'), 'the Library list head is built per view, not a file list');

// wiring
const js = read('public/scripts/comp/desktop-apps/mediaPlayer.js');
assert.ok(js.includes("window.openDesktopVideoPlayerUrl = openDesktopVideoPlayerUrl") && js.includes('const openDesktopVideoPlayerUrl = openDesktopMediaPlayerUrl'), 'the gallery / eMotion entry point still works');
assert.ok(js.includes('function openDesktopMusicPlayer()') && js.includes('function openDesktopVideoPlayer()'), 'the old launchers land on the one player');
assert.ok(/map = \{ p: 'play-pause', s: 'stop', b: 'previous', f: 'next', h: 'shuffle', t: 'repeat', o: 'open-file', u: 'open-url' \}/.test(js), "WMP's shortcuts");
const app = read('public/app.html');
const loader = read('public/scripts/comp/featureLoader.js');
assert.ok(loader.includes("'css/desktop-apps/mediaPlayer.css'") && loader.includes("'scripts/comp/desktop-apps/mediaPlayer.js'"), 'Media Player loads on open');
assert.ok(!app.includes('mediaPlayer.css') && !app.includes('desktop-apps/mediaPlayer.js'), 'Media Player is not on the boot page');
assert.ok(!app.includes('mediaPlayers.'), 'the old files are gone from app.html');
const mu = read('public/scripts/comp/modalUtils.js');
assert.ok(mu.includes("launchId: 'media-player'") && mu.includes("text: 'Media Player'") && mu.includes("imageIcon: 'media_player.png'"), 'one launcher');
assert.ok(!mu.includes("launchId: 'music'") && !mu.includes("launchId: 'video'"), 'Music and Video launchers are gone');
assert.ok(read('public/scripts/comp/galleryActions.js').includes("text: 'Open in Media Player'"));
assert.ok(read('public/scripts/comp/desktop-apps/emotion.js').includes("resultBadge.title = 'Open in Media Player'"));
const css = read('public/css/desktop-apps/mediaPlayer.css');
assert.ok(css.includes('--window-frame-bottom: 60px;'), 'the frame extends 60px into the client for the transport (the VM)');
assert.ok(read('public/css/aero-glass.css').includes('--window-frame-bottom: 0px;') && read('public/css/modal-window-title-toolbar.css').includes('bottom: calc(var(--window-frame-inset) + var(--window-frame-bottom, 0px) - 2px);'), 'the frame honours the extension');
assert.ok(css.includes('height: 36px;') && css.includes('#7a8295 0, #7a8295 1px, #626c88 1px, #393f4d 16px, #151516 16px'), "the tab strip's measured gradient");
// the bar (#956): wmploc's art placed where the VM draws it, around the client's centre
assert.ok(css.includes('left: calc(round(down, 50%, 1px) - 279px);') && css.includes('width: 558px;'), 'the pill (2164) centred on the whole pixel left of the middle (the VM at odd widths)');
assert.ok(css.includes('left: 171px;') && css.includes('width: 182px;'), 'the transport group (4153) at -108');
assert.ok(css.includes('right: calc(round(up, 50%, 1px) + 217px);'), 'the elapsed time 217px left of the centre');
const theme = read('public/css/themes/vista/media-player.css');
// narrow and compact (#956 round 2): the narrow pill under a 614px client, the time 158px left of the centre and
// gone under 544px, the window folding to 96px below 201px, the VM's minimum 374px
assert.ok(css.includes('@container (max-width: 613.98px)') && css.includes('left: calc(round(down, 50%, 1px) - 137px);') && css.includes('right: calc(round(up, 50%, 1px) + 158px);') && css.includes('@container (max-width: 543.98px)'), 'the narrow layout');
assert.ok(js.includes('MIN_WIDTH: 374, FOLDED_HEIGHT: 96, UNFOLD_MIN: 201'), "WMP 11's window limits");
assert.ok(js.includes("modal.windowResizeConstrain = (width, height) => ({ width, height: height < mediaPlayerBar.UNFOLD_MIN ? mediaPlayerBar.FOLDED_HEIGHT : height });"), 'a resize below 201px folds the window');
assert.ok(js.includes("if (key === '1') {") && !js.includes("mediaPlayerSetCompact(player, key === '2')"), 'Ctrl+1 is full mode; Ctrl+2 (skin mode) does not fold the window');
assert.ok(html.includes('class="wmp-volarrow"') && html.includes('class="wmp-volpop hidden"'), 'the narrow volume split button and its pop-up');
assert.ok(css.includes('--wmp-focus-t') && js.includes('function mediaPlayerSyncFocus(player, el)'), 'the dotted focus rectangle on the window checkerboard');
['transport-pill-narrow', 'volume-popup', 'volume-split-arrow', 'volume-split-arrow-hot', 'volume-split-speaker-hot', 'volume-split-speaker-near']
    .forEach((name) => assert.ok(theme.includes("url('/static_images/vista-wmp/" + name + ".png')"), name + ' in the theme'));
['transport-pill', 'transport-group', 'transport-orbface', 'transport-orbface-hot', 'transport-orbface-down', 'transport-prevbar-hot', 'transport-nextbar-down', 'transport-stop-hot', 'seek-groove', 'seek-fill', 'seek-tip', 'seek-thumb', 'volume-fill', 'button-hot', 'button-down', 'orb-halo']
    .forEach((name) => assert.ok(theme.includes("url('/static_images/vista-wmp/" + name + ".png')"), name + ' in the theme'));
assert.ok(!/#[0-9a-f]{3,8}\b|rgb\(/i.test(css.slice(css.indexOf('/* ---- the transport'), css.indexOf('/* ---- compact mode')).replace(/\/\*[\s\S]*?\*\//g, '')), 'no colour literal in the bar layout (ui-standard)');
assert.ok(html.includes('title="Turn shuffle on"') && html.includes('title="Previous (press and hold to rewind)"') && html.includes('title="Press and hold to fast-forward"') && html.includes('title="View full screen"') && html.includes('title="Seek"'), "the VM's tooltips");
assert.deepStrictEqual(mp.mediaPlayerNowLines({ title: 'Amanda', artist: 'Aisha Duo', composer: 'Luca Gusella', album: 'Quiet Songs' }), ['Amanda', 'Aisha Duo', 'Luca Gusella [Composer]', 'Quiet Songs'], 'the rotating line');
assert.deepStrictEqual(mp.mediaPlayerNowLines({ name: 'Bear.webm', kind: 'video', artist: 'x' }), ['Bear'], 'a video shows its title only');
['play', 'pause', 'next', 'prev', 'stop', 'shuffle', 'shuffle-on', 'repeat', 'repeat-on', 'transport-pill', 'transport-group', 'transport-orbface', 'orb-halo', 'seek-groove', 'thumb', 'volume-high', 'volume-mute', 'button-hot', 'view-stack', 'star', 'nav-library', 'nav-songs', 'nav-video', 'art-music', 'art-video', 'app-16']
    .forEach((name) => assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-wmp', name + '.png')), name + '.png shipped'));
assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/app_icons/media_player.png')), 'the app icon');
assert.ok(!fs.existsSync(path.join(ROOT, 'public/scripts/comp/desktop-apps/mediaPlayers.js')), 'the old script is gone');

console.log('test-media-player-wmp: ok');
