/**
 * Melaton Mobile: Melaton Media, the phone's Windows Media Player 10 Mobile (wmplayer.exe 10.3, the same
 * program on WM 6.1 and 6.5), Yozora #732 (parent #709), #801, completed 1:1 in #975 (Nov 20 2026).
 *
 * Measured on the Device Emulator (WM 6.1 Pro VGA build 19202, WM 6.5 Pro VGA build 21234; captures in
 * ~/.cache/claude-run/wmwmp/ref61 and ref65, VGA pixels halved = units). Every screen of the device:
 *
 *   Now Playing (playback screen)  the ROM's skin (wmp_WPC_player_480x640.skn / _640x480.skn; art in
 *                 public/static_images/wm61/wmp): album art / video 10,74 460x310, marquee = the title (else
 *                 the file name), the status line cycling Playing (10 s) > artist > album > genre > bit rate >
 *                 artist (4.5 s each), the rating stars (a tap rates one more, 5 > none), time (Options:
 *                 elapsed or remaining), seek bar, volume %, the buttons (full screen, Windows Media = the
 *                 online guide, previous, play / pause, next, volume - / +, mute). Soft keys Now Playing | Menu
 *                 (Library..., Play/Pause, Stop, Shuffle/Repeat >, Full Screen, Options..., Properties, About).
 *   Full screen   the video alone over the whole screen, turned to landscape on a portrait screen; it ends
 *                 with the clip (or the back key / Full Screen key).
 *   Library       "Library" drop-down (the path as indented levels, then the libraries with the current one
 *                 dotted) and Back; Library > My Music (All Music, Artist, Album, Genre: each group list
 *                 starts with All Songs By ...), My Videos (All Video, Genre), My TV, My Playlists, Now
 *                 Playing. A tap opens a category; a tap on a song or video selects it, Play plays it. Menu:
 *                 Queue Up, Delete from Library, Now Playing, Library >, Update Library..., Open File...,
 *                 Open URL..., Properties.
 *   Libraries     the phone's own media library per storage volume (Android's MediaStore through
 *                 window.AndroidMediaLibrary: My Device and each Storage Card), then the server's library
 *                 ("<workspace> on Dreamscape": media_library_get, tags read on the server, #956; without it
 *                 the workspace's folders are walked).
 *   Update Library  progress bar, "N files found / Searching for files...", "N files added / Adding files...",
 *                 "The library has been updated. To continue, click Done."; Search (disabled) | Cancel / Done.
 *   Delete from Library  "Do you also want to permanently delete the file from the device?" Yes / No: No
 *                 takes it out of the library only (until Update Library finds it again), Yes deletes the file
 *                 (Android: AndroidMediaLibrary.delete; the server: vfs_delete_file).
 *   Open File...  the File System in the library's view (folders and media files); Open URL... URL edit and
 *                 History list, OK | Menu (Clear History, Cancel).
 *   Now Playing list  the queue (the playing item bold with the play arrow), tool bar (up, down, add, remove,
 *                 properties); Play | Menu (Library..., Move Up, Move Down, Remove from Playlist, Shuffle/Repeat >,
 *                 Save Playlist..., Clear Now Playing, Error Details, Properties). Save Playlist: "Enter
 *                 playlist name:" Playlist N, Done | Cancel; the list shows under My Playlists.
 *   Properties    the item's fields as label / value rows (song: Artist, Album, Album Artist, Title, Genre,
 *                 Rating, Play Count, Location, Bit Rate, Track Number; video: Artist, Title, Genre, Length,
 *                 Rating, Audio Codec, Video Codec, Play Count, Location, Bit Rate), OK | Menu (Buy CD, disabled
 *                 as on the device).
 *   Options       tabs Playback (Show time as; 6.1: Pause playback while using another program, Resume
 *                 playback after a phone call; and which programs Now Playing follows, #801), Video (Play
 *                 video in full screen: Never / Only when oversized / Always; Scale to fit window), Network
 *                 (protocols, UDP port, Internet connection speed, Detect connection speed), Library (Start
 *                 Player on Library screen), Skins (Default (Portrait / Landscape), Previous / Next), Buttons
 *                 (the hardware keys for 13 functions: Assign / Reset / None). ok keeps them.
 *   About         Melaton Media Player 10 Mobile for Pocket PC, Version 10.3, the copyright and the warning.
 *
 * Phone behaviour: what plays is Android's media session too (lock screen, shade, headset; DSApp
 * MediaLibraryBridge), the 6.5 Music panel and Today follow it (wmMediaChange); another program taking the
 * audio (a call, another player) pauses it through Android's audio focus (dreamscape:mediacontrol with
 * focus: 'transient' / 'loss' / 'gain' / 'duck') and a call's end resumes it when Options say so. When Melaton
 * Media itself plays nothing, Now Playing shows and controls what else Android plays (AndroidMediaSession).
 * Kept in this browser: options (wmMediaOptions), ratings (wmpRatings, shared with the desktop's Media
 * Player), play counts, playlists, items taken out of a library, the URL history.
 * Only on phones. Styles: public/css/wm-media.css.
 */
(function () {
    'use strict';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'windows-media';
    const TITLE = 'Melaton Media';
    const SKIN = '/static_images/wm61/wmp/';
    const AUDIO = /\.(mp3|ogg|oga|wav|aac|m4a|flac|opus|weba|wma)$/i;
    const VIDEO = /\.(mp4|webm|ogv|m4v|mov|wmv|asf|3gp)$/i;
    const MAX_DIRS = 160;
    const SKIP_DIRS = new Set(['Trash', 'Calendars', 'Contacts', 'Notes']);
    const SYSTEM_SKIP = new Set(['Pictures', 'Scraps', 'References', 'Notes', 'Trash']);
    const SOURCE_KEY = 'wmMediaSource';
    const OPT_KEY = 'wmMediaOptions';
    const RATINGS_KEY = 'wmpRatings'; // shared with the desktop's Media Player (mediaPlayer.js)
    const COUNTS_KEY = 'wmMediaPlayCounts';
    const REMOVED_KEY = 'wmMediaRemoved';
    const PLAYLISTS_KEY = 'wmMediaPlaylists';
    const URLS_KEY = 'wmMediaUrls';
    const OWN_PACKAGE = /^jp\.net\.seventhreeseven\.dreamscape/;
    // the online guide behind the skin's Windows Media button: on the device Internet Explorer opened
    // WindowsMedia.com's guide; here the suite's online video and music program
    const GUIDE_APP = 'youtube';

    // skin layouts in VGA pixels (x, y, w, h) and their sprite offsets in the pushed / disabled strips
    const LAYOUT = {
        portrait: {
            size: [480, 536], bg: 'np-portrait', pushed: 'pushed-portrait', disabled: 'disabled-portrait',
            art: [10, 74, 460, 310], marquee: [10, 10, 311, 33, 26.7], status: [10, 44, 311, 26, 21.3],
            ratings: [321, 4, 153, 37], time: [10, 406, 100, 26], vol: [410, 406, 64, 26], seek: [114, 408, 256, 20],
            buttons: {
                full: [8, 440, 50, 58, 0], online: [64, 454, 50, 58, 50], prev: [136, 450, 58, 66, 100],
                play: [202, 440, 76, 86, 158, 420, 496], next: [286, 450, 58, 66, 234],
                voldown: [368, 454, 50, 58, 292], volup: [424, 440, 50, 58, 342], mute: [380, 404, 28, 32, 392]
            }
        },
        landscape: {
            size: [640, 376], bg: 'np-landscape', pushed: 'pushed-landscape', disabled: 'disabled-landscape',
            art: [16, 60, 608, 210], marquee: [16, 2, 465, 26, 21.3], status: [16, 28, 465, 26, 21.3],
            ratings: [481, 6, 153, 37], time: [16, 282, 97, 26], vol: [568, 282, 60, 26], seek: [114, 284, 412, 26],
            buttons: {
                full: [104, 312, 46, 56, 0], online: [162, 312, 46, 56, 46], prev: [232, 312, 46, 56, 92],
                play: [290, 312, 60, 62, 138, 362, 422], next: [362, 312, 46, 56, 198],
                voldown: [434, 312, 44, 56, 244], volup: [490, 312, 44, 56, 288], mute: [536, 280, 30, 28, 332]
            }
        }
    };
    const PUSHED_W = { portrait: [724, 86], landscape: [602, 62] };
    // the strips' own sizes in VGA units (disabled-landscape.png is 122 x 31: 244, not portrait's 292)
    const DISABLED_W = { portrait: [292, 86], landscape: [244, 62] };

    // Options > Network > Internet connection speed (the device's list)
    const SPEEDS = ['Cellular (33.6 Kbps)', 'Modem (56 Kbps)', 'Cellular (128 Kbps)', 'Cellular (256 Kbps)', 'Cellular (384 Kbps)', 'Wi-Fi/LAN (1.0 Mbps or faster)'];
    // Options > Buttons: the functions in the device's order and their default keys
    const FUNCS = [
        ['playpause', 'Play/Pause', 'Enter'], ['stop', 'Stop', null], ['pause', 'Pause', null], ['prev', 'Previous', 'ArrowLeft'],
        ['next', 'Next', 'ArrowRight'], ['volup', 'Volume Up', 'ArrowUp'], ['voldown', 'Volume Down', 'ArrowDown'], ['mute', 'Mute', null],
        ['full', 'Full Screen', null], ['rating', 'Rating', null], ['ff', 'Fast Forward', 'hold:ArrowRight'], ['rew', 'Rewind', 'hold:ArrowLeft'],
        ['screen', 'Toggle Screen', null]
    ];
    const KEY_NAMES = { Enter: 'ENTER', ArrowLeft: 'Left', ArrowRight: 'Right', ArrowUp: 'Up', ArrowDown: 'Down', ' ': 'Space', Escape: 'Esc' };
    const keyLabel = (k) => (!k ? 'Not assigned' : k.startsWith('hold:') ? `Hold ${keyLabel(k.slice(5))}` : KEY_NAMES[k] || (k.length === 1 ? k.toUpperCase() : k));
    const DEFAULTS = {
        time: 'elapsed', pauseOther: false, resumeCall: true, fullScreen: 'never', scale: true,
        udp: true, tcp: true, http: true, udpPort: '0', speed: 0, detect: true, startLibrary: true,
        buttons: Object.fromEntries(FUNCS.map(([k, , d]) => [k, d]))
    };

    let ws = null;
    let page = null;
    let layer = 'skin'; // skin | library | queue | options | props | update | about | url | save
    const stack = []; // the layers under this one (back / ok return to them)
    let libPath = []; // the Library's open levels (see libRows)
    let libSel = 0;
    let queueSel = 0;
    let orient = 'portrait';
    let full = false; // full-screen video
    let screenOff = false; // Options > Buttons > Toggle Screen

    // ---------------------------------------------------------------- stored state

    const lsGet = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (_) { return d; } };
    const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) { /* storage off */ } };

    let opts = Object.assign({}, DEFAULTS, lsGet(OPT_KEY, {}));
    opts.buttons = Object.assign({}, DEFAULTS.buttons, opts.buttons || {});
    const saveOpts = () => lsSet(OPT_KEY, opts);

    /** The item's key across the libraries (the desktop's Media Player keys its ratings the same way). */
    function keyOf(it) {
        if (!it) return '';
        if (it.src === 'android') return `phone:${it.volume}:${it.kind === 'video' ? 'v' : ''}${it.id}`;
        if (it.hash) return `local:${it.hash}`;
        if (it.path) return `vfs:${it.path}`;
        return it.url ? `url:${it.url}` : '';
    }
    let ratings = null;
    const ratingOf = (it) => { if (!ratings) ratings = lsGet(RATINGS_KEY, {}); return Number(ratings[keyOf(it)]) || 0; };
    function setRating(it, n) {
        ratings = lsGet(RATINGS_KEY, {}); // the desktop window may have rated since
        const k = keyOf(it);
        if (!k) return;
        if (n > 0) ratings[k] = n; else delete ratings[k];
        lsSet(RATINGS_KEY, ratings);
    }
    let counts = null;
    const playCount = (it) => { if (!counts) counts = lsGet(COUNTS_KEY, {}); return Number(counts[keyOf(it)]) || 0; };
    function countPlay(it) {
        const k = keyOf(it);
        if (!k) return;
        counts = lsGet(COUNTS_KEY, {});
        counts[k] = (Number(counts[k]) || 0) + 1;
        lsSet(COUNTS_KEY, counts);
    }

    // ---------------------------------------------------------------- playback

    const media = { el: null, queue: [], index: -1, shuffle: false, repeat: false, volume: 70, muted: false, status: 'Ready', error: '', counted: -1 };
    let focusPaused = ''; // paused because another program took the audio: 'transient' (a call) | 'loss'

    function player() {
        if (media.el) return media.el;
        const v = document.createElement('video');
        v.className = 'wmp-video';
        v.playsInline = true;
        v.preload = opts.speed >= 5 ? 'auto' : 'metadata';
        v.addEventListener('timeupdate', paintTime);
        v.addEventListener('durationchange', () => { paintTime(); tellAndroid(); });
        v.addEventListener('loadedmetadata', autoFull);
        v.addEventListener('play', () => { setStatus('Playing'); tellAndroid(); });
        v.addEventListener('pause', () => { if (!v.ended && media.status !== 'Error') setStatus('Paused'); tellAndroid(); });
        v.addEventListener('waiting', () => { setStatus('Buffering...'); });
        v.addEventListener('playing', () => {
            focusPaused = '';
            if (media.counted !== media.index) { media.counted = media.index; countPlay(current()); }
            setStatus('Playing');
            tellAndroid();
        });
        v.addEventListener('seeked', tellAndroid);
        v.addEventListener('ended', () => { setStatus('Stopped'); if (full) setFull(false); next(true); });
        v.addEventListener('error', () => {
            if (!v.getAttribute('src')) return;
            media.error = 'Melaton Media cannot play the file. The file might not be supported, or the codec used to compress it is not available.';
            setStatus('Error');
            ws.notify({ title: TITLE, icon: 'error', text: media.error });
        });
        media.el = v;
        applyVolume();
        return v;
    }

    function applyVolume() {
        if (!media.el) return;
        media.el.volume = media.volume / 100;
        media.el.muted = media.muted;
    }

    function vfsUrl(item) {
        const V = (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; // eslint-disable-line no-undef
        if (!V) return Promise.resolve('');
        const base = V.getBasePath && V.getBasePath();
        if (base && item.serverId) return Promise.resolve(`${base}/media/file/${encodeURIComponent(item.serverId)}`);
        if (base && item.path) return Promise.resolve(`${base}/fs/read?path=${encodeURIComponent(item.path)}`);
        if (item.fileId) return V.downloadFile(item.fileId).then((r) => (r && r.downloadUrl) || '');
        return Promise.resolve('');
    }

    async function playIndex(i) {
        const it = media.queue[i];
        if (!it) return;
        media.index = i;
        media.error = '';
        setStatus('Opening...');
        const v = player();
        try {
            if (it.url && /^http:/i.test(it.url) && !opts.http && !it.local) throw Object.assign(new Error('http'), { name: 'ProtocolOff' });
            const url = it.url || await ws.busy(vfsUrl(it), { timeout: 15000 });
            if (!url) throw new Error('no url');
            v.poster = it.poster || '';
            v.src = url;
            await v.play();
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            if (err && err.name === 'NotAllowedError') { setStatus('Paused'); return; }
            if (err && err.name === 'ProtocolOff') media.error = 'Melaton Media cannot play the file because the HTTP protocol is turned off. To turn it on, tap Menu > Options > Network.';
            if (!media.error) media.error = `${it.name} cannot be played.`;
            setStatus('Error');
            ws.notify({ title: TITLE, icon: 'error', text: media.error });
        }
    }

    function playPause() {
        if (!media.queue.length) return;
        const v = player();
        if (media.index < 0 || !v.getAttribute('src')) { playIndex(Math.max(0, media.index)); return; }
        if (v.paused) v.play().catch(() => {}); else v.pause();
    }

    function pause() { if (media.el && !media.el.paused) media.el.pause(); }

    function stop() {
        if (!media.el) return;
        media.el.pause();
        try { media.el.currentTime = 0; } catch (_) { /* not seekable */ }
        if (full) setFull(false);
        setStatus('Stopped');
        tellAndroid();
    }

    /** The status word (Ready, Opening..., Playing ...): the line cycles through the item's details while it plays. */
    function setStatus(s) {
        media.status = s;
        statusStep = 0;
        statusAt = Date.now();
        paintSkin();
    }

    // ---------------------------------------------------------------- Android's media session (#801)

    const library = () => window.AndroidMediaLibrary || null;

    /** What Melaton Media plays, as Android's media session (lock screen, shade, headset buttons). */
    let tellTimer = 0;
    function tellAndroid() {
        const L = library();
        if (!L || typeof L.setNowPlaying !== 'function') return;
        clearTimeout(tellTimer);
        tellTimer = setTimeout(() => {
            const it = current();
            const v = media.el;
            if (!it || !v || !v.getAttribute('src')) { try { L.setNowPlaying(''); } catch (_) { /* bridge gone */ } return; }
            const playing = !v.paused && !v.ended;
            try {
                L.setNowPlaying(JSON.stringify({
                    title: it.title || it.name,
                    artist: it.artist || (it.kind === 'audio' && it.src !== 'android' ? it.folder || '' : ''),
                    album: it.album || '',
                    art: it.art || it.poster || '',
                    duration: Number.isFinite(v.duration) ? Math.round(v.duration * 1000) : Math.round((it.duration || 0) * 1000),
                    position: Math.round((v.currentTime || 0) * 1000),
                    playing,
                    // keeps Android's audio focus while a call holds it (the call's end gives it back)
                    held: !playing && focusPaused === 'transient',
                    canNext: media.queue.length > 1 || media.repeat,
                    canPrev: media.queue.length > 0
                }));
            } catch (_) { /* bridge gone */ }
        }, 80);
    }

    // the notification's / lock screen's / headset's buttons, and Android's audio focus
    window.addEventListener('dreamscape:mediacontrol', (e) => {
        const d = (e && e.detail) || {};
        const v = media.el;
        switch (d.action) {
            case 'play': if (v && v.getAttribute('src')) v.play().catch(() => {}); else playPause(); break;
            case 'pause': if (v) v.pause(); break;
            case 'toggle': playPause(); break;
            case 'next': next(false); break;
            case 'previous': prev(); break;
            case 'stop': stop(); break;
            case 'seek': if (v && Number.isFinite(d.position)) { try { v.currentTime = d.position / 1000; } catch (_) { /* not seekable */ } } break;
            // another program took the audio: a call (transient) pauses and may resume; a player (loss) pauses
            case 'focus':
                if (d.focus === 'transient' || d.focus === 'loss') {
                    if (v && !v.paused && !v.ended) { v.pause(); focusPaused = d.focus; tellAndroid(); }
                } else if (d.focus === 'duck') {
                    if (v) v.volume = media.volume / 400;
                } else if (d.focus === 'gain') {
                    applyVolume();
                    if (focusPaused === 'transient' && opts.resumeCall && v) v.play().catch(() => {});
                    focusPaused = '';
                }
                break;
            default: break;
        }
    }, { signal: appScopeSignal });
    window.addEventListener('melatonopenapp', (e) => { if (e && e.detail === APP_ID && ws) { toSkin(); ws.open(APP_ID); render(); } }, { signal: appScopeSignal });

    // Options > Playback > Pause playback while using another program: another program in front pauses
    function otherProgram() { if (opts.pauseOther && media.el && !media.el.paused) media.el.pause(); }
    document.addEventListener('wmAppChange', (e) => { const d = (e && e.detail) || {}; if (d.prev === APP_ID && d.id !== APP_ID) otherProgram(); }, { signal: appScopeSignal });

    // ---------------------------------------------------------------- what else Android plays (#801)

    let androidState = null; // AndroidMediaSession.getState(), from its events
    const artCache = new Map(); // artKey -> data URL
    let androidTick = 0;

    function readAndroidState() {
        const S = window.AndroidMediaSession;
        if (!S || typeof S.getState !== 'function') return null;
        try { androidState = JSON.parse(S.getState() || 'null'); } catch (_) { androidState = null; }
        return androidState;
    }

    window.addEventListener('dreamscape:media', (e) => {
        androidState = (e && e.detail) || null;
        if (window.wmMediaApps && window.wmMediaApps.noteSeen) window.wmMediaApps.noteSeen(androidState);
        if (page && layer === 'skin') paintSkin();
    }, { signal: appScopeSignal });

    /** Android's active session that is not Dreamscape's own (else null). */
    function androidSession() {
        const st = androidState || readAndroidState();
        // Options > Playback > the programs Now Playing follows (shared with Today's Music item: window.wmMediaApps)
        const A = window.wmMediaApps;
        const hidden = A && typeof A.hidden === 'function' ? A.hidden() : new Set();
        const list = ((st && st.sessions) || []).filter((s) => !OWN_PACKAGE.test(s.package || '') && !hidden.has(s.package));
        if (!list.length) return null;
        return list.find((s) => s.id === st.active) || list.find((s) => s.state === 'playing') || list[0];
    }

    /** Now Playing shows Android's session while Melaton Media itself plays nothing (or Android plays). */
    function androidMode() {
        const v = media.el;
        if (v && v.getAttribute('src') && !v.paused && !v.ended) return null;
        const s = androidSession();
        if (!s || s.state === 'none' || s.state === 'stopped' && !s.title) return null;
        if (s.state === 'playing' || s.state === 'buffering' || !current()) return s;
        return null;
    }

    function androidPosition(s) {
        if (!s) return 0;
        let p = Number(s.position) || 0;
        if (s.state === 'playing' && s.positionAt) p += (Date.now() - s.positionAt) * (Number(s.speed) || 1);
        return Math.max(0, s.duration ? Math.min(p, s.duration) : p) / 1000;
    }

    function androidArt(s) {
        if (!s || !s.artKey) return '';
        if (artCache.has(s.artKey)) return artCache.get(s.artKey);
        let url = '';
        try { url = window.AndroidMediaSession.getArt(s.id) || ''; } catch (_) { url = ''; }
        if (artCache.size > 8) artCache.delete(artCache.keys().next().value);
        artCache.set(s.artKey, url);
        return url;
    }

    function androidCommand(k) {
        const S = window.AndroidMediaSession;
        const s = androidSession();
        if (!S || !s) return false;
        const can = (a) => !s.actions || s.actions.includes(a);
        try {
            if (k === 'play') S.toggle(s.id);
            else if (k === 'prev' && can('previous')) S.previous(s.id);
            else if (k === 'next' && can('next')) S.next(s.id);
            else return false;
        } catch (_) { return false; }
        return true;
    }

    /**
     * Now Playing on screen: Media in front on its skin, the page shown, the screen on, not behind an
     * Android program (wmShell.onScreen). Playback goes on regardless; only the drawing waits.
     */
    function skinSeen() {
        if (!page || layer !== 'skin' || document.documentElement.dataset.wmApp !== APP_ID) return false;
        return !ws || typeof ws.onScreen !== 'function' || ws.onScreen(page);
    }
    let skinStale = false; // the skin changed while it was not seen: painted when it shows again

    // the playing item's clock (Android's) and the status line's details move only while the skin is on
    // screen (local, no requests); the tick runs only then (the screen off, another app in front: none)
    let statusStep = 0;
    let statusAt = 0;
    function wantTick() {
        if (!skinSeen()) return false;
        const a = androidMode();
        if (a) return a.state === 'playing';
        return !!(media.el && !media.el.paused && !media.el.ended && current());
    }
    function syncTick() {
        const want = wantTick();
        // perf: allow the playing item's clock and status line while the skin is on screen (cleared when it is not)
        if (want && !androidTick) androidTick = setInterval(() => { if (wantTick()) { if (androidMode()) paintTime(); paintStatus(); } else syncTick(); }, 1000);
        else if (!want && androidTick) { clearInterval(androidTick); androidTick = 0; }
    }
    // seen again (screen on, the page shown, back from an Android program): painted as it is now
    function wake() {
        syncTick();
        if (skinStale && skinSeen()) paintSkin();
    }
    window.addEventListener('melatonscreen', wake, { signal: appScopeSignal });
    document.addEventListener('visibilitychange', wake, { signal: appScopeSignal });
    document.addEventListener('wmBehind', (e) => { if (e && e.detail && e.detail.on) otherProgram(); wake(); }, { signal: appScopeSignal });

    function next(auto) {
        if (!media.queue.length) return;
        let i;
        if (media.shuffle && media.queue.length > 1) {
            do { i = Math.floor(Math.random() * media.queue.length); } while (i === media.index);
        } else i = media.index + 1;
        if (i >= media.queue.length) {
            if (!media.repeat) { if (auto) setStatus('Ready'); return; }
            i = 0;
        }
        playIndex(i);
    }

    function prev() {
        if (!media.queue.length) return;
        // as the device: past the first seconds, back to the start of this one
        if (media.el && media.el.currentTime > 3) { media.el.currentTime = 0; return; }
        playIndex(Math.max(0, media.index - 1));
    }

    function enqueue(items, playNow) {
        const start = media.queue.length;
        items.forEach((it) => media.queue.push({ ...it }));
        if (playNow && items.length) {
            playIndex(start);
            toSkin();
            render();
            ws.syncHistory();
        } else render();
    }

    // ---------------------------------------------------------------- the libraries
    // sources: the phone's own media library per storage volume (#801), and the workspace's library on the
    // server: { id, label, kind: 'vfs' | 'android', volume }

    const libs = new Map(); // source id -> { audio, video, playlists, needsAccess? }
    const scans = new Map(); // source id -> promise
    let source = null;
    const unindexed = new Set(); // volumes whose library Android answers "not found" for
    const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

    function workspaceName() {
        let w = 'Default';
        try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return w;
    }
    const workspaceRoot = () => `/Workspaces/${workspaceName()}`;

    let volumesCache = null;
    function sources() {
        const out = [];
        const L = library();
        if (L && typeof L.volumes === 'function') {
            if (!volumesCache) { try { volumesCache = JSON.parse(L.volumes() || '[]'); } catch (_) { volumesCache = []; } }
            let cards = 0;
            const removable = volumesCache.filter((v) => v.removable).length;
            volumesCache.forEach((v) => {
                if ((v.state && !/^mounted/.test(v.state)) || unindexed.has(v.id)) return;
                if (v.primary) out.push({ id: `android:${v.id}`, label: 'My Device', kind: 'android', volume: v.id });
                else {
                    cards += 1;
                    out.push({ id: `android:${v.id}`, label: removable > 1 ? `Storage Card ${cards}` : 'Storage Card', kind: 'android', volume: v.id });
                }
            });
        }
        out.push({ id: 'vfs', label: out.length ? `${workspaceName()} on Dreamscape` : 'My Device', kind: 'vfs' });
        return out;
    }

    function currentSource() {
        const all = sources();
        if (!source) source = lsGet(SOURCE_KEY, null);
        let s = all.find((x) => x.id === source);
        if (!s) { s = all[0]; source = s.id; }
        return s;
    }

    function setSource(id) {
        source = id;
        lsSet(SOURCE_KEY, id);
        libPath = [];
        libSel = 0;
        if (layer !== 'library') { stack.length = 0; stack.push('skin'); layer = 'library'; }
        render();
        ws.syncHistory();
        ensureLibrary(false).then(() => { if (layer === 'library') render(); });
    }

    /** The workspace's media files by walking its folders (when the server has no media library). */
    async function walkVfs(progress) {
        const V = (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; // eslint-disable-line no-undef
        if (!V) throw new Error('Files are not available.');
        const out = { audio: [], video: [], playlists: [] };
        const queue = [workspaceRoot()];
        let dirs = 0;
        while (queue.length && dirs < MAX_DIRS) {
            const dir = queue.shift();
            dirs += 1;
            let items = [];
            try { items = ((await V.listDirectory(dir, { offset: 0, limit: 500, sortField: 'name', sortDirection: 'asc', search: '' })) || {}).items || []; } catch (_) { items = []; }
            for (const i of items) {
                const name = i.name || '';
                const isDir = i.kind === 'folder' || i.kind === 'dir' || i.targetKind === 'vfs-folder';
                if (isDir) {
                    // the workspace's own system folders hold no audio or video (#890)
                    if (i.system && SYSTEM_SKIP.has(name)) continue;
                    if (!SKIP_DIRS.has(name)) queue.push(`${dir.replace(/\/+$/, '')}/${name}`);
                    continue;
                }
                const kind = AUDIO.test(name) ? 'audio' : VIDEO.test(name) ? 'video' : null;
                if (!kind) continue;
                const folder = dir.split('/').filter(Boolean).pop() || '';
                out[kind].push({ name: name.replace(/\.[^.]+$/, ''), title: name.replace(/\.[^.]+$/, ''), file: name, path: `${dir.replace(/\/+$/, '')}/${name}`, fileId: i.targetKind === 'user-file' ? i.targetId || i.id : null, folder, kind, src: 'vfs', size: i.size || 0 });
                if (progress) progress(out.audio.length + out.video.length);
            }
        }
        return out;
    }

    /** The server's media library (#956: tags, length, art; files at <vfs>/media/file/<id>). */
    async function serverLibrary() {
        const W = window.wsClient;
        if (!W || typeof W.sendMessage !== 'function') return null;
        let r = null;
        try { r = await Promise.race([W.sendMessage('media_library_get', {}), new Promise((res) => setTimeout(() => res(null), 30000))]); } catch (_) { r = null; }
        const d = (r && r.data) || r;
        if (!d || !Array.isArray(d.audio)) return null;
        const V = (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; // eslint-disable-line no-undef
        const base = V && V.getBasePath ? V.getBasePath() : '';
        const map = (x, kind) => ({
            kind, src: 'vfs', serverId: x.id, fileId: x.id, hash: x.hash, name: x.title || String(x.name || '').replace(/\.[^.]+$/, ''), title: x.title || '',
            file: x.name || '', artist: x.artist || '', albumArtist: x.albumArtist || '', album: x.album || '', genre: x.genre || '',
            year: x.year || 0, track: x.track || 0, disc: x.disc || 0, duration: x.duration || 0, size: x.size || 0, mime: x.mime || '',
            workspace: x.workspaceId || '', width: x.width || 0, height: x.height || 0,
            art: x.art && base ? `${base}/media/art/${x.hash}` : '', poster: kind === 'video' && x.art && base ? `${base}/media/art/${x.hash}` : ''
        });
        return { audio: d.audio.map((x) => map(x, 'audio')), video: (d.video || []).map((x) => map(x, 'video')), playlists: [] };
    }

    /** The phone's media library for one volume (MediaStore, served by the app). */
    async function scanAndroid(s) {
        const L = library();
        let acc = {};
        try { acc = JSON.parse(L.access() || '{}'); } catch (_) { acc = {}; }
        if (!acc.granted) return { audio: [], video: [], playlists: [], needsAccess: true };
        const base = L.baseUrl();
        const vol = encodeURIComponent(s.volume);
        const r = await fetch(`${base}/library/${vol}`, { cache: 'no-store' });
        if (!r.ok) throw new Error(r.status === 403 ? 'Melaton Media is not allowed to read your music and videos.' : 'The library could not be read.');
        const d = await r.json();
        // storage Android's media library does not index (a USB drive): not a library
        if (Array.isArray(d.errors) && d.errors.length && d.errors.every((e) => /not found/i.test(e))) {
            unindexed.add(s.volume);
            throw new Error("This storage isn't in Android's media library.");
        }
        const byId = new Map();
        const audio = (d.songs || []).map((x) => {
            const it = {
                kind: 'audio', src: 'android', id: x.id, volume: s.volume,
                name: x.title || 'Unknown', title: x.title || '',
                artist: x.artist || '', albumArtist: x.albumArtist || '', album: x.album || '', albumId: x.albumId,
                genre: x.genre || '', track: x.track || 0, disc: x.disc || 0, year: x.year || 0, composer: x.composer || '',
                duration: (x.duration || 0) / 1000, size: x.size || 0, mime: x.mime || '', path: x.path || '',
                url: `${base}/audio/${vol}/${x.id}`, art: `${base}/cover/${vol}/${x.id}?px=512`, albumArt: x.albumId ? `${base}/album/${vol}/${x.albumId}?px=512` : ''
            };
            byId.set(x.id, it);
            return it;
        });
        const video = (d.videos || []).map((x) => ({
            kind: 'video', src: 'android', id: x.id, volume: s.volume, name: x.title || 'Video', title: x.title || '',
            artist: x.artist || '', folder: x.folder || '', duration: (x.duration || 0) / 1000, size: x.size || 0, mime: x.mime || '',
            path: x.path || '', width: x.width || 0, height: x.height || 0,
            url: `${base}/video/${vol}/${x.id}`, poster: `${base}/video/${vol}/${x.id}?thumb=480`
        }));
        const playlists = (d.playlists || []).map((p) => ({ name: p.name || 'Playlist', android: true, items: (p.songs || []).map((id) => byId.get(id)).filter(Boolean) }));
        return { audio, video, playlists };
    }

    async function scanSource(s, progress) {
        if (s.kind === 'android') return scanAndroid(s);
        return (await serverLibrary()) || walkVfs(progress);
    }

    /** Titles in the device's order (A-Z, numbers by value). */
    const byTitle = (a, b) => coll.compare(a.name, b.name);
    function finish(s, r) {
        r.audio.sort(byTitle);
        r.video.sort(byTitle);
        libs.set(s.id, r);
        return r;
    }

    function ensureLibrary(force) {
        const s = currentSource();
        if (libs.has(s.id) && !force) return Promise.resolve(libs.get(s.id));
        if (scans.has(s.id)) return scans.get(s.id);
        const run = ws.busy(scanSource(s), { paint: true, timeout: 60000 }).then((r) => finish(s, r)).catch((err) => {
            ws.notify({ title: TITLE, icon: 'error', text: (err && err.message) || 'The library could not be updated.' });
            return finish(s, libs.get(s.id) || { audio: [], video: [], playlists: [] });
        }).finally(() => { scans.delete(s.id); });
        scans.set(s.id, run);
        return run;
    }

    // the server's library changed (a push, #956): read again the next time it is shown
    if (window.wsClient && typeof window.wsClient.on === 'function') {
        window.wsClient.on('media_library_changed', () => { libs.delete('vfs'); if (layer === 'library' && currentSource().id === 'vfs') ensureLibrary(false).then(() => { if (layer === 'library') render(); }); }, { signal: appScopeSignal });
    }

    // the answers of the phone's library: "Allow ... to access music and audio?", a file deleted
    window.addEventListener('dreamscape:medialib', (e) => {
        const d = (e && e.detail) || {};
        if (d.type === 'access') {
            volumesCache = null;
            sources().filter((s) => s.kind === 'android').forEach((s) => libs.delete(s.id));
            if (d.granted && page) ensureLibrary(true).then(() => { if (layer === 'library') render(); });
            else if (!d.granted && ws) ws.notify({ title: TITLE, icon: 'info', text: 'Melaton Media cannot show your music and videos without permission. Allow it in Android Settings > Apps > Dreamscape > Permissions.' });
        } else if (d.type === 'delete') {
            const L = libs.get(`android:${d.volume}`);
            if (d.ok && L) {
                const gone = (it) => it.volume === d.volume && String(it.id) === String(d.id) && (d.kind === 'video') === (it.kind === 'video');
                L.audio = L.audio.filter((it) => !gone(it));
                L.video = L.video.filter((it) => !gone(it));
                if (layer === 'library') render();
            } else if (!d.ok && ws) ws.notify({ title: TITLE, icon: 'error', text: 'The file could not be deleted.' });
        } else if (d.type === 'volumes') { volumesCache = null; }
    }, { signal: appScopeSignal });

    function askAccess() {
        const L = library();
        if (L && typeof L.requestAccess === 'function') { try { L.requestAccess(); } catch (_) { /* bridge gone */ } }
    }

    // items taken out of a library with Delete from Library > No (until Update Library finds them again)
    let removed = null;
    const isRemoved = (it) => { if (!removed) removed = lsGet(REMOVED_KEY, {}); return !!removed[keyOf(it)]; };
    function setRemoved(list, on) {
        removed = lsGet(REMOVED_KEY, {});
        list.forEach((it) => { const k = keyOf(it); if (!k) return; if (on) removed[k] = 1; else delete removed[k]; });
        lsSet(REMOVED_KEY, removed);
    }

    /** The open source's library as the lists show it: removed items out, the saved playlists in. */
    function shown() {
        const s = currentSource();
        const L = libs.get(s.id) || { audio: [], video: [], playlists: [] };
        const keep = (it) => !isRemoved(it);
        const audio = L.audio.filter(keep);
        const video = L.video.filter(keep);
        const all = new Map([...L.audio, ...L.video].map((it) => [keyOf(it), it]));
        const own = (lsGet(PLAYLISTS_KEY, {})[s.id] || []).map((p, i) => ({ name: p.name, own: i, items: (p.keys || []).map((k) => all.get(k)).filter(Boolean) }));
        const playlists = (L.playlists || []).map((p) => ({ ...p, items: p.items.filter(keep) })).concat(own).sort((a, b) => coll.compare(a.name, b.name));
        return { audio, video, playlists, needsAccess: L.needsAccess, loaded: libs.has(s.id) };
    }

    const UNKNOWN = 'Unknown';
    const GROUP = { artist: ['Artist', 'wmp-artist', 'All Songs By Artist'], album: ['Album', 'wmp-disc', 'All Songs By Album'], genre: ['Genre', 'wmp-genre', 'All Songs By Genre'] };
    const field = (it, by) => (by === 'artist' ? it.artist || it.albumArtist : by === 'album' ? it.album : it.genre) || '';
    const byTrack = (a, b) => ((a.disc || 0) - (b.disc || 0)) || ((a.track || 0) - (b.track || 0)) || coll.compare(a.name, b.name);

    /** Items grouped by artist / album / genre: [{ key, label, items }] sorted, Unknown last. */
    function groups(items, by) {
        const m = new Map();
        items.forEach((it) => {
            const k = field(it, by);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(it);
        });
        return [...m.entries()].map(([k, list]) => ({ key: k, label: k || UNKNOWN, items: by === 'album' ? list.slice().sort(byTrack) : list }))
            .sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || coll.compare(a.label, b.label));
    }

    /**
     * The rows of the open Library level: { label, icon, open?, item?, items?, ask?, queue?, playlist? }.
     *   []                              My Music, My Videos, My TV, My Playlists, Now Playing
     *   ['music']                       All Music, Artist, Album, Genre
     *   ['music', 'all']                the songs
     *   ['music', g]                    All Songs By <g>, then the groups (artist / album / genre)
     *   ['music', g, '*']               every song, by <g>
     *   ['music', 'artist', a]          All Songs By Artist (a's), then a's albums
     *   ['music', 'artist', a, b]       a's songs ('*') or a's album b
     *   ['music', 'album' | 'genre', k] the album's / genre's songs
     *   ['video'], ['video', 'all'], ['video', 'genre'(, '*' | k)]   the same for videos (All Video, Genre)
     *   ['tv']                          (no TV programs: as the device without any)
     *   ['playlists'(, i)]              the playlists, a playlist's items
     *   ['fs', path...]                 Open File...: the file system
     */
    function libRows() {
        if (libPath[0] === 'fs') return fsRows();
        const [cat, sub, a1, a2] = libPath;
        const L = shown();
        const file = (it) => ({ label: it.name, icon: it.kind === 'video' ? 'wmp-video' : 'wmp-music', item: it });
        if (L.needsAccess && cat && cat !== 'tv') return [{ label: 'Allow access to music and videos...', icon: 'wmp-properties', ask: true }];
        if (!cat) {
            return [
                { label: 'My Music', icon: 'wmp-music', open: ['music'] },
                { label: 'My Videos', icon: 'wmp-video', open: ['video'] },
                { label: 'My TV', icon: 'wmp-tv', open: ['tv'] },
                { label: 'My Playlists', icon: 'wmp-playlist', open: ['playlists'] },
                { label: 'Now Playing', icon: 'wmp-play', queue: true }
            ];
        }
        if (cat === 'music' || cat === 'video') {
            const list = cat === 'music' ? L.audio : L.video;
            const icon = cat === 'music' ? 'wmp-music' : 'wmp-video';
            if (!sub) {
                return cat === 'music' ? [
                    { label: 'All Music', icon, open: ['music', 'all'], items: list },
                    { label: 'Artist', icon: 'wmp-artist', open: ['music', 'artist'], items: list },
                    { label: 'Album', icon: 'wmp-disc', open: ['music', 'album'], items: list },
                    { label: 'Genre', icon: 'wmp-genre', open: ['music', 'genre'], items: list }
                ] : [
                    { label: 'All Video', icon, open: ['video', 'all'], items: list },
                    { label: 'Genre', icon: 'wmp-genre', open: ['video', 'genre'], items: list }
                ];
            }
            if (sub === 'all') return list.map(file);
            const g = GROUP[sub];
            if (!g) return [];
            const allLabel = cat === 'video' ? 'All Videos By Genre' : g[2];
            const sorted = (items) => items.slice().sort((x, y) => coll.compare(field(x, sub) || '￿', field(y, sub) || '￿') || byTrack(x, y));
            if (a1 == null) {
                return [{ label: allLabel, icon, open: [cat, sub, '*'], items: sorted(list) }]
                    .concat(groups(list, sub).map((x) => ({ label: x.label, icon: g[1], open: [cat, sub, x.key], items: x.items })));
            }
            if (a1 === '*') return sorted(list).map(file);
            const hit = groups(list, sub).find((x) => x.key === a1);
            if (!hit) return [];
            if (sub !== 'artist') return hit.items.map(file);
            const albums = groups(hit.items, 'album');
            if (a2 == null) {
                return [{ label: g[2], icon, open: [cat, sub, a1, '*'], items: albums.flatMap((x) => x.items) }]
                    .concat(albums.map((x) => ({ label: x.label, icon: 'wmp-disc', open: [cat, sub, a1, x.key], items: x.items })));
            }
            if (a2 === '*') return albums.flatMap((x) => x.items).map(file);
            const al = albums.find((x) => x.key === a2);
            return al ? al.items.map(file) : [];
        }
        if (cat === 'playlists') {
            if (sub == null) return L.playlists.map((p, i) => ({ label: p.name, icon: 'wmp-playlist', open: ['playlists', String(i)], items: p.items, playlist: p }));
            const p = L.playlists[Number(sub)];
            return p ? p.items.map(file) : [];
        }
        return [];
    }

    /** A level's own name and icon (the header and the drop-down's path). */
    function levelTitle(path) {
        const [cat, sub, a1, a2] = path;
        if (!cat) return { label: 'Library', icon: 'wmp-search' };
        if (cat === 'fs') return path.length === 1 ? { label: 'File System', icon: 'wmp-search' } : { label: fsName(path[path.length - 1]), icon: 'wmp-folder' };
        if (cat === 'tv') return { label: 'My TV', icon: 'wmp-tv' };
        if (cat === 'playlists') {
            if (sub == null) return { label: 'My Playlists', icon: 'wmp-playlist' };
            const p = shown().playlists[Number(sub)];
            return { label: p ? p.name : 'My Playlists', icon: 'wmp-playlist' };
        }
        const icon = cat === 'music' ? 'wmp-music' : 'wmp-video';
        if (!sub) return { label: cat === 'music' ? 'My Music' : 'My Videos', icon };
        if (sub === 'all') return { label: cat === 'music' ? 'All Music' : 'All Video', icon };
        const g = GROUP[sub];
        const allLabel = cat === 'video' ? 'All Videos By Genre' : g[2];
        if (a1 == null) return { label: g[0], icon: g[1] };
        if (a1 === '*') return { label: allLabel, icon };
        if (a2 == null) return { label: a1 || UNKNOWN, icon: g[1] };
        if (a2 === '*') return { label: g[2], icon };
        return { label: a2 || UNKNOWN, icon: 'wmp-disc' };
    }

    function rowItems(r) {
        if (!r) return [];
        if (r.item) return [r.item];
        if (r.items) return r.items;
        return [];
    }

    // ---------------------------------------------------------------- Open File...: the file system

    let fsList = null; // { path, rows } of the open folder
    const fsName = (p) => (p === '/' ? 'My Device' : String(p).split('/').filter(Boolean).pop() || p);
    function fsRows() { return (fsList && fsList.rows) || []; }

    async function fsLoad(path) {
        const V = (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; // eslint-disable-line no-undef
        fsList = { path, rows: [] };
        if (!V) return;
        let items = [];
        try { items = ((await ws.busy(V.listDirectory(path, { offset: 0, limit: 500, sortField: 'name', sortDirection: 'asc', search: '' }), { timeout: 20000 })) || {}).items || []; } catch (_) { items = []; }
        if (!fsList || fsList.path !== path) return;
        const folders = [];
        const files = [];
        items.forEach((i) => {
            const name = i.name || '';
            const isDir = i.kind === 'folder' || i.kind === 'dir' || i.targetKind === 'vfs-folder';
            const p = `${path.replace(/\/+$/, '')}/${name}`;
            if (isDir) { folders.push({ label: name, icon: 'wmp-folder', open: libPath.concat([p]) }); return; }
            const kind = AUDIO.test(name) ? 'audio' : VIDEO.test(name) ? 'video' : null;
            if (!kind) return;
            files.push({ label: name, icon: kind === 'video' ? 'wmp-video' : 'wmp-music', item: { name: name.replace(/\.[^.]+$/, ''), title: name.replace(/\.[^.]+$/, ''), file: name, path: p, fileId: i.targetKind === 'user-file' ? i.targetId || i.id : null, folder: fsName(path), kind, src: 'vfs', size: i.size || 0 } });
        });
        fsList.rows = folders.sort((a, b) => coll.compare(a.label, b.label)).concat(files.sort((a, b) => coll.compare(a.label, b.label)));
    }

    function openFile() {
        stack.length = 0;
        stack.push('skin');
        layer = 'library';
        libPath = ['fs'];
        libSel = 0;
        fsLoad('/').then(() => { if (layer === 'library' && libPath[0] === 'fs') render(); });
        render();
        ws.syncHistory();
    }

    /** A Library level change (the file system loads its folder first). */
    function goLevel(path) {
        libPath = path;
        libSel = 0;
        if (path[0] === 'fs') {
            fsList = null;
            fsLoad(path.length > 1 ? path[path.length - 1] : '/').then(() => { if (layer === 'library' && libPath === path) render(); });
        }
        render();
        ws.syncHistory();
    }

    // ---------------------------------------------------------------- painting

    const pad = (n) => String(n).padStart(2, '0');
    function fmtTime(s) {
        if (!Number.isFinite(s) || s < 0) s = 0;
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = Math.floor(s % 60);
        return h ? `${h}:${pad(m)}:${pad(ss)}` : `${pad(m)}:${pad(ss)}`;
    }
    const at = (r) => `--x:${r[0]};--y:${r[1]};--w:${r[2]};--h:${r[3]}`;

    /**
     * The skin in this screen's shape: a portrait screen taller than the skin's 480x536 gives the extra
     * height to the album art (the background's gradient above the control bar stretches with it) and
     * the control bar stays at the bottom, instead of an empty band under the skin.
     */
    let skinExtra = 0;
    const BAR_TOP = 396; // portrait: the control bar's top edge in the background (VGA units)
    function skinLayout() {
        const L = LAYOUT[orient];
        // a landscape screen wider than the skin's 640x376 (#829: phones are about 20:9): the control
        // strip stays centred at its own size, the album art and the title lines take the full width,
        // the ratings follow the right edge (the background's plain edge columns fill the sides)
        if (orient === 'landscape' && skinExtra) {
            const e = skinExtra;
            const mid = (r) => [r[0] + e / 2, r[1]].concat(r.slice(2));
            const buttons = {};
            Object.entries(L.buttons).forEach(([k, b]) => { buttons[k] = mid(b); });
            return {
                ...L, size: [L.size[0] + e, L.size[1]],
                art: [L.art[0], L.art[1], L.art[2] + e, L.art[3]],
                marquee: [L.marquee[0], L.marquee[1], L.marquee[2] + e].concat(L.marquee.slice(3)),
                status: [L.status[0], L.status[1], L.status[2] + e].concat(L.status.slice(3)),
                ratings: [L.ratings[0] + e].concat(L.ratings.slice(1)),
                time: mid(L.time), vol: mid(L.vol), seek: mid(L.seek), buttons
            };
        }
        if (orient !== 'portrait' || !skinExtra) return L;
        const d = skinExtra;
        const down = (r) => [r[0], r[1] + d].concat(r.slice(2));
        const buttons = {};
        Object.entries(L.buttons).forEach(([k, b]) => { buttons[k] = down(b); });
        return { ...L, size: [L.size[0], L.size[1] + d], art: [L.art[0], L.art[1], L.art[2], L.art[3] + d], time: down(L.time), vol: down(L.vol), seek: down(L.seek), buttons };
    }

    const img = (name) => `image-set(url('${SKIN}${name}.png') 1x, url('${SKIN}${name}@2x.png') 2x)`;
    function skinHtml() {
        const L = skinLayout();
        const btn = (k) => {
            const b = L.buttons[k];
            return `<button type="button" class="wmp-btn wmp-at" data-b="${k}" style="${at(b)};--px:${-b[4]};--px2:${-(b[5] || b[4])};--px3:${-(b[6] || b[4])}" aria-label="${k}"></button>`;
        };
        const stretch = orient === 'portrait' && skinExtra ? `;--wmp-extra:${skinExtra};--wmp-bar:${BAR_TOP}` : '';
        const wide = orient === 'landscape' && skinExtra ? `;--wmp-wx:${skinExtra}` : '';
        return `<div class="wmp-skin is-${orient}${stretch ? ' is-stretched' : ''}${wide ? ' is-wide' : ''}" style="--sw:${L.size[0]};--sh:${L.size[1]}${stretch}${wide};--bg:${img(L.bg)};--pushed:${img(L.pushed)};--pw:${PUSHED_W[orient][0]};--ph:${PUSHED_W[orient][1]};--disabled:${img(L.disabled)};--dw:${DISABLED_W[orient][0]};--dh:${DISABLED_W[orient][1]};--ratings-art:${img('ratings')};--thumb-art:${img('seek-thumb')}">
            <div class="wmp-art wmp-at" style="${at(L.art)}"></div>
            <div class="wmp-marquee wmp-at" style="${at(L.marquee)};--fs:${L.marquee[4]}"></div>
            <div class="wmp-status wmp-at" style="${at(L.status)};--fs:${L.status[4]}"></div>
            <button type="button" class="wmp-ratings wmp-at" style="${at(L.ratings)}" aria-label="Rating"></button>
            <div class="wmp-time wmp-at" style="${at(L.time)}">00:00</div>
            <div class="wmp-vol wmp-at" style="${at(L.vol)}">70%</div>
            <div class="wmp-seek wmp-at" style="${at(L.seek)}"><span class="wmp-thumb"></span></div>
            ${Object.keys(L.buttons).map(btn).join('')}
        </div>`;
    }

    function fitSkin() {
        if (!page || layer !== 'skin') return;
        const host = page.querySelector('.wmp-np');
        const w = host.clientWidth;
        const h = host.clientHeight;
        if (!w || !h) return;
        const o = w > h * 1.15 ? 'landscape' : 'portrait';
        const L = LAYOUT[o];
        // the skin keeps its shape and fills the screen (its VGA units scaled to fit)
        const unit = Math.min(w / L.size[0], h / L.size[1]);
        const extra = o === 'portrait' ? Math.max(0, Math.floor(h / unit - L.size[1])) : Math.max(0, Math.floor(w / unit - L.size[0]));
        const u = `${unit}px`;
        if (host.style.getPropertyValue('--wmp-u') !== u) host.style.setProperty('--wmp-u', u);
        if (o !== orient || extra !== skinExtra || !host.querySelector('.wmp-skin')) {
            orient = o;
            skinExtra = extra;
            host.innerHTML = skinHtml();
            paintSkin();
        }
    }

    function current() { return media.queue[media.index] || null; }

    // the 6.5 home screen's Music panel follows what plays (wmTodayWidgets.js, #796)
    let changeTimer = 0;
    function changed() {
        clearTimeout(changeTimer);
        changeTimer = setTimeout(() => document.dispatchEvent(new CustomEvent('wmMediaChange')), 60);
    }

    const setText = (el, t) => { if (el && el.textContent !== t) el.textContent = t; };
    const setClass = (el, c, on) => { if (el && el.classList.contains(c) !== !!on) el.classList.toggle(c, !!on); };

    function bitRate(it) {
        if (!it || !it.size || !it.duration) return '';
        return `${Math.max(1, Math.round((it.size * 8) / it.duration / 1000))}Kbps`;
    }

    /**
     * The status line (skin file's Status): the state word; while an item plays the device goes on to its
     * details, Playing 10 s, then artist, album, genre, bit rate and the artist again 4.5 s each.
     */
    function statusText() {
        const it = current();
        if (!it) return '';
        const v = media.el;
        if (media.status !== 'Playing' || !v || v.paused) return media.status;
        const steps = [media.status, it.artist, it.kind === 'audio' ? it.album : '', it.genre, bitRate(it), it.artist].filter((x, i) => i === 0 || x);
        if (steps.length < 2) return media.status;
        const t = Date.now() - statusAt;
        const cycle = 10000 + (steps.length - 1) * 4500;
        const p = t % cycle;
        statusStep = p < 10000 ? 0 : 1 + Math.floor((p - 10000) / 4500);
        return steps[Math.min(statusStep, steps.length - 1)];
    }
    function paintStatus() {
        if (!skinSeen()) return;
        const skin = page.querySelector('.wmp-skin');
        if (!skin || androidMode()) return;
        setText(skin.querySelector('.wmp-status'), statusText());
    }

    function paintSkin() {
        changed();
        if (!page) return;
        syncTick();
        // not seen: painted in full when it shows (render on show, wake)
        if (!skinSeen()) { skinStale = true; return; }
        const skin = page.querySelector('.wmp-skin');
        if (!skin) return;
        skinStale = false;
        const a = androidMode();
        const it = current();
        const v = media.el;
        const art = skin.querySelector('.wmp-art');
        const stars = skin.querySelector('.wmp-ratings');
        setClass(skin, 'is-android', !!a);
        if (a) {
            // something else plays on the phone: Now Playing is its remote (#801)
            setText(skin.querySelector('.wmp-marquee'), a.title || a.app || '');
            const st = { playing: 'Playing', paused: 'Paused', buffering: 'Buffering...', stopped: 'Stopped', error: 'Error' }[a.state] || 'Ready';
            setText(skin.querySelector('.wmp-status'), a.app ? `${st} (${a.app})` : st);
            if (v && v.parentNode) v.remove();
            setCover(art, androidArt(a), '');
            const can = (x) => !a.actions || a.actions.includes(x);
            const playingA = a.state === 'playing' || a.state === 'buffering';
            skin.querySelectorAll('.wmp-btn').forEach((b) => {
                const k = b.dataset.b;
                const dis = k === 'full' || (k === 'prev' && !can('previous')) || (k === 'next' && !can('next')) || (k === 'play' && !(can('play') || can('pause')));
                if (b.disabled !== dis) b.disabled = dis;
                setClass(b, 'is-disabled', dis);
                setClass(b, 'is-pause', k === 'play' && playingA);
                setClass(b, 'is-on', k === 'mute' && media.muted);
            });
            setText(skin.querySelector('.wmp-vol'), `${media.volume}%`);
            stars.hidden = true;
            paintTime();
            return;
        }
        // the marquee is the item's title, else its file name (skin file: Title,Filename)
        setText(skin.querySelector('.wmp-marquee'), it ? it.title || it.file || it.name : '');
        setText(skin.querySelector('.wmp-status'), statusText());
        // video plays in the album-art rectangle; music shows its album art there
        if (v && it && it.kind === 'video' && !full) { setCover(art, '', ''); if (v.parentNode !== art) art.appendChild(v); } else {
            if (v && v.parentNode && !full) v.remove();
            setCover(art, it && it.kind === 'audio' ? it.art || '' : '', it && it.albumArt || '');
        }
        setClass(art, 'is-video', !!(it && it.kind === 'video'));
        setClass(art, 'is-noscale', !opts.scale);
        const empty = !media.queue.length;
        const playing = !!(v && !v.paused && !v.ended);
        skin.querySelectorAll('.wmp-btn').forEach((b) => {
            const k = b.dataset.b;
            // as the device: next only with an item after this one (or Repeat / Shuffle), full screen for a video
            const dis = (empty && (k === 'play' || k === 'prev')) || (k === 'next' && (empty || (media.index >= media.queue.length - 1 && !media.repeat && !media.shuffle))) || (k === 'full' && !(it && it.kind === 'video'));
            if (b.disabled !== dis) b.disabled = dis;
            setClass(b, 'is-disabled', dis);
            setClass(b, 'is-pause', k === 'play' && playing);
            setClass(b, 'is-on', k === 'mute' && media.muted);
        });
        setText(skin.querySelector('.wmp-vol'), `${media.volume}%`);
        // the stars show for an item (none queued: none on 6.5, empty on 6.1 as the device drew them)
        stars.hidden = !it && ws.version === '6.5';
        const r = String(it ? ratingOf(it) : 0);
        if (stars.style.getPropertyValue('--r') !== r) stars.style.setProperty('--r', r);
        paintTime();
    }

    /** The album art picture in the art rectangle: url, then fallback, else empty. */
    function setCover(art, url, fallback) {
        let im = art.querySelector('.wmp-cover');
        if (!url) { if (im) im.remove(); return; }
        if (!im) {
            im = document.createElement('img');
            im.className = 'wmp-cover';
            im.alt = '';
            im.decoding = 'async';
            im.addEventListener('error', () => {
                const fb = im.dataset.fallback;
                if (fb && im.getAttribute('src') !== fb) im.src = fb; else im.hidden = true;
            });
            art.prepend(im);
        }
        im.dataset.fallback = fallback || '';
        if (im.getAttribute('src') !== url && im.dataset.want !== url) { im.dataset.want = url; im.hidden = false; im.src = url; }
    }

    function paintTime() {
        if (!page) return;
        // timeupdate fires ~4 times a second while something plays, also with the screen off: drawn only when seen
        if (!skinSeen()) { skinStale = true; return; }
        const skin = page.querySelector('.wmp-skin');
        if (!skin) return;
        const v = media.el;
        const a = androidMode();
        const t = a ? androidPosition(a) : v ? v.currentTime : 0;
        const d = a ? (a.duration || 0) / 1000 : v && Number.isFinite(v.duration) ? v.duration : 0;
        // Options > Playback > Show time as: Elapsed, or Remaining (no sign, as the device)
        setText(skin.querySelector('.wmp-time'), fmtTime(opts.time === 'remaining' && d ? Math.max(0, d - t) : t));
        const seek = skin.querySelector('.wmp-seek');
        // written only when it moved (#890: the same value written again restyles each tick)
        const p = String(d ? Math.min(1, t / d) : 0);
        if (seek.style.getPropertyValue('--p') !== p) seek.style.setProperty('--p', p);
        setClass(seek, 'is-disabled', !d);
    }

    // ---------------------------------------------------------------- full screen (#975)

    /** Options > Video > Play video in full screen: Always, or Only when oversized (bigger than the art rectangle). */
    function autoFull() {
        const v = media.el;
        const it = current();
        if (!v || !it || it.kind !== 'video' || full) return;
        if (opts.fullScreen === 'always') setFull(true);
        else if (opts.fullScreen === 'oversized' && page) {
            const art = page.querySelector('.wmp-art');
            const r = art && art.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            if (r && (v.videoWidth > r.width * dpr || v.videoHeight > r.height * dpr)) setFull(true);
        }
    }

    function setFull(on) {
        const it = current();
        on = !!on && !!(it && it.kind === 'video' && media.el);
        if (on === full) return;
        full = on;
        document.documentElement.classList.toggle('wmp-full', full);
        const fs = page && page.querySelector('.wmp-fs');
        if (fs) {
            fs.hidden = !full;
            if (full) fs.appendChild(media.el);
            else if (media.el && media.el.parentNode === fs) media.el.remove();
        }
        if (full) fitFull();
        paintSkin();
        if (ws && ws.current === APP_ID) { ws.syncHistory(full ? undefined : { noPush: true }); ws.refreshSoftKeys(); ws.refreshTitleAction(); }
    }

    /** The video over the whole screen, on its side when the screen stands upright (the device's landscape). */
    function fitFull() {
        const fs = page && page.querySelector('.wmp-fs');
        if (!fs || !full) return;
        const w = fs.clientWidth;
        const h = fs.clientHeight;
        const turn = h > w;
        setClass(fs, 'is-turned', turn);
        setClass(fs, 'is-fit', opts.scale);
        const W = turn ? h : w;
        const H = turn ? w : h;
        fs.style.setProperty('--fw', `${W}px`);
        fs.style.setProperty('--fh', `${H}px`);
    }

    // Toggle Screen (a hardware key): the screen goes dark while the music plays, a tap or key lights it
    function setScreen(off) {
        screenOff = !!off;
        const c = page && page.querySelector('.wmp-dark');
        if (c) c.hidden = !screenOff;
    }

    // ---------------------------------------------------------------- the lists

    function renderLibrary() {
        const head = page.querySelector('.wmp-lib .wmp-lhead');
        const t = levelTitle(libPath);
        head.innerHTML = `<button type="button" class="wmp-lsel" aria-haspopup="menu">${ws.art.img(t.icon)}<span>${ws.escapeHtml(t.label)}</span><span class="wmp-larrow"></span></button>
            <button type="button" class="wmp-lback">${ws.art.img('wmp-back')}<span>Back</span></button>`;
        const rows = libRows();
        if (libSel >= rows.length) libSel = 0;
        const list = page.querySelector('.wmp-llist');
        list.innerHTML = rows.map((r, i) => `<div class="wmp-lrow${i === libSel ? ' is-selected' : ''}" data-i="${i}">${ws.art.img(r.icon)}<span>${ws.escapeHtml(r.label)}</span></div>`).join('');
        list.dataset.empty = rows.length ? '' : '1';
    }

    /** The Library drop-down: the path (each level indented), then the libraries with the current one dotted. */
    function libMenu() {
        const out = [];
        for (let n = 0; n <= libPath.length; n++) {
            const p = libPath.slice(0, n);
            // the file system's root is its own first level (under it, no Library)
            if (libPath[0] === 'fs' && n === 0) continue;
            const t = levelTitle(p);
            const lvl = libPath[0] === 'fs' ? n - 1 : n;
            // the path rows are regular weight; the drop-down opens on its first row
            out.push({ label: t.label, icon: t.icon, indent: (lvl * 5) / 12, plain: true, hot: !out.length, action: () => goLevel(p) });
        }
        out.push('-');
        const cur = currentSource();
        sources().forEach((s) => out.push({ label: s.label, radio: s.id === cur.id, action: () => setSource(s.id) }));
        return out;
    }

    function sourceMenu() {
        const cur = currentSource();
        return sources().map((s) => ({ label: s.label, radio: s.id === cur.id, action: () => setSource(s.id) }));
    }

    function renderQueue() {
        if (queueSel >= media.queue.length) queueSel = Math.max(0, media.queue.length - 1);
        page.querySelector('.wmp-qlist').innerHTML = media.queue.map((it, i) => `<div class="wmp-lrow${i === queueSel ? ' is-selected' : ''}${i === media.index ? ' is-current' : ''}" data-i="${i}">${ws.art.img(i === media.index ? 'wmp-play' : it.kind === 'video' ? 'wmp-video' : 'wmp-music')}<span>${ws.escapeHtml(it.name)}</span></div>`).join('');
        const has = media.queue.length > 0;
        page.querySelectorAll('.wmp-qtool').forEach((b) => {
            const k = b.dataset.t;
            const dis = k === 'add' ? false : !has || (k === 'up' && queueSel === 0) || (k === 'down' && queueSel >= media.queue.length - 1);
            if (b.disabled !== dis) b.disabled = dis;
        });
    }

    // ---------------------------------------------------------------- pages

    const esc = (s) => (ws ? ws.escapeHtml(s) : String(s));
    let propsOf = null; // the item Properties shows

    function renderProps() {
        const it = propsOf;
        const box = page.querySelector('.wmp-props');
        if (!it) { box.innerHTML = ''; return; }
        const v = media.el;
        const len = it === current() && v && Number.isFinite(v.duration) ? v.duration : it.duration;
        const unk = (s) => (s ? String(s) : UNKNOWN);
        const vol = sources().find((s) => s.kind === 'android' && s.volume === it.volume);
        const where = it.src === 'android'
            ? `\\${vol && vol.label !== 'My Device' ? `${vol.label}\\` : ''}${String(it.path || it.name).replace(/\//g, '\\')}`
            : it.path ? String(it.path).replace(/\//g, '\\') : it.file ? `\\${workspaceName()} on Dreamscape\\${it.file}` : it.url || '';
        const stars = `<span class="wmp-pstars" style="--r:${ratingOf(it)}"><i></i><i></i><i></i><i></i><i></i></span>`;
        const rows = it.kind === 'video' ? [
            ['Artist', unk(it.artist || it.title)], ['Title', unk(it.title || it.name)], ['Genre', unk(it.genre)], ['Length', len ? fmtTime(len) : UNKNOWN],
            ['Rating', null], ['Audio Codec', unk(it.audioCodec)], ['Video Codec', unk(it.videoCodec)], ['Play Count', String(playCount(it))], ['Location', where], ['Bit Rate', bitRate(it) || UNKNOWN]
        ] : [
            ['Artist', unk(it.artist)], ['Album', unk(it.album)], ['Album Artist', unk(it.albumArtist)], ['Title', unk(it.title || it.name)], ['Genre', unk(it.genre)],
            ['Rating', null], ['Play Count', String(playCount(it))], ['Location', where], ['Bit Rate', bitRate(it) || UNKNOWN], ['Track Number', it.track ? String(it.track) : UNKNOWN]
        ];
        box.innerHTML = rows.map(([k, val]) => `<div class="wmp-pk">${esc(k)}</div><div class="wmp-pv">${val == null ? stars : esc(val)}</div>`).join('');
    }

    function renderAbout() {
        page.querySelector('.wmp-about').innerHTML = `<div class="wmp-ab-name">Melaton Media Player 10 Mobile<br>for Pocket PC</div>
            <div class="wmp-ab-ver">Version 10.3 Build ${ws.version === '6.5' ? '21234' : '19202'}</div>
            <div class="wmp-ab-copy">© 1999-2006 Xyridian Corporation.<br>All rights reserved.</div>
            <textarea class="wm-edit wmp-ab-warn wm-pv-scroll wm-pg-scroll" readonly tabindex="-1">Warning:  This computer program is protected by copyright law and international treaties.\n\nUnauthorized reproduction or distribution of this program, or any portion of it, may result in severe civil and criminal penalties, and will be prosecuted to the maximum extent possible under the law.</textarea>`;
    }

    // Update Library: Searching for files... (found), Adding files... (added), then Done
    let update = null; // { phase: 'search' | 'add' | 'done', found, added, cancelled }
    function renderUpdate() {
        const box = page.querySelector('.wmp-update');
        if (!update) { box.innerHTML = ''; return; }
        if (!box.firstChild) box.innerHTML = '<div class="wmp-ubar"><span></span></div><div class="wmp-u1"></div><div class="wmp-u2"></div>';
        const n = update.phase === 'search' ? update.found : update.added;
        setText(box.querySelector('.wmp-u1'), `${n} file${n === 1 ? '' : 's'} ${update.phase === 'search' ? 'found' : 'added'}`);
        setText(box.querySelector('.wmp-u2'), update.phase === 'search' ? 'Searching for files...' : update.phase === 'add' ? 'Adding files...' : 'The library has been updated. To continue, click Done.');
        // the bar: searching fills the first part as files turn up, adding the rest, done fills it
        const total = Math.max(1, update.found);
        const frac = update.phase === 'done' ? 1 : update.phase === 'search' ? Math.min(0.4, 0.05 + update.found / 200) : 0.4 + 0.6 * (update.added / total);
        const bar = box.querySelector('.wmp-ubar > span');
        const b = String(Math.round(frac * 24)); // the device's bar holds 24 blocks
        if (bar.style.getPropertyValue('--blocks') !== b) bar.style.setProperty('--blocks', b);
    }

    async function runUpdate() {
        const s = currentSource();
        pushLayer('update');
        update = { phase: 'search', found: 0, added: 0, cancelled: false };
        const me = update;
        render();
        let r = null;
        try {
            if (s.kind === 'android') volumesCache = null;
            r = await scanSource(s, (n) => { if (me === update) { me.found = n; renderUpdate(); } });
        } catch (err) {
            if (me !== update) return;
            popLayer();
            ws.notify({ title: TITLE, icon: 'error', text: (err && err.message) || 'The library could not be updated.' });
            return;
        }
        if (me !== update || me.cancelled) return;
        const items = r.audio.concat(r.video);
        // the search shows its count rising, then the adding (the device's two steps, at a usable pace)
        const per = Math.max(1, Math.ceil(items.length / 8));
        for (let i = Math.min(me.found, items.length); i < items.length && me === update && !me.cancelled; i += per) {
            me.found = Math.min(items.length, i + per);
            renderUpdate();
            await new Promise((res) => setTimeout(res, 60));
        }
        if (me !== update || me.cancelled) return;
        me.found = items.length;
        me.phase = 'add';
        renderUpdate();
        // Update Library finds again what was taken out of the library (Delete from Library > No)
        setRemoved(items, false);
        // added at the device's pace, a few at a time (the list is ready at once; the count catches up)
        const step = Math.max(1, Math.ceil(items.length / 12));
        for (let i = 0; i < items.length && me === update && !me.cancelled; i += step) {
            me.added = Math.min(items.length, i + step);
            renderUpdate();
            await new Promise((res) => setTimeout(res, 60));
        }
        if (me !== update || me.cancelled) return;
        finish(s, r);
        me.added = items.length;
        me.phase = 'done';
        renderUpdate();
        ws.refreshSoftKeys();
    }

    function endUpdate() {
        if (update) update.cancelled = true;
        update = null;
        popLayer();
    }

    // Open URL: the address, the history (newest first, 10)
    function renderUrl() {
        const box = page.querySelector('.wmp-url');
        const hist = lsGet(URLS_KEY, []);
        const prev = box.querySelector('.wmp-url-edit');
        const value = prev ? prev.value : '';
        box.innerHTML = `<div class="wmp-url-k">URL:</div><input class="wm-edit wmp-url-edit" type="url" autocomplete="off" spellcheck="false" value="${esc(value)}">
            <div class="wmp-url-h">History:</div><div class="wmp-url-list wm-pv-scroll wm-pg-scroll" role="listbox">${hist.map((u, i) => `<div class="wmp-lrow" data-u="${i}"><span>${esc(u)}</span></div>`).join('')}</div>`;
    }

    function openUrlNow() {
        const box = page.querySelector('.wmp-url');
        const raw = String((box.querySelector('.wmp-url-edit') || {}).value || '').trim();
        if (!raw) return;
        let url;
        try { url = new URL(/^[a-z]+:/i.test(raw) ? raw : `http://${raw}`); } catch (_) { ws.messageBox({ title: TITLE, icon: 'error', text: 'The URL is not valid.', modal: true }); return; }
        if (!/^https?:$/.test(url.protocol)) { ws.messageBox({ title: TITLE, icon: 'error', text: 'Melaton Media cannot open this type of URL.', modal: true }); return; }
        const hist = lsGet(URLS_KEY, []).filter((u) => u !== url.href);
        hist.unshift(url.href);
        lsSet(URLS_KEY, hist.slice(0, 10));
        const name = decodeURIComponent(url.pathname.split('/').pop() || url.host);
        stack.length = 0;
        layer = 'skin';
        media.queue = [];
        media.index = -1;
        enqueue([{ name: name.replace(/\.[^.]+$/, ''), title: '', file: name, url: url.href, kind: VIDEO.test(name) ? 'video' : 'audio' }], true);
    }

    // Save Playlist: "Enter playlist name:" Playlist N
    function renderSave() {
        const box = page.querySelector('.wmp-save');
        const s = currentSource();
        const own = lsGet(PLAYLISTS_KEY, {})[s.id] || [];
        let n = 1;
        while (own.some((p) => p.name === `Playlist ${n}`)) n += 1;
        box.innerHTML = `<div class="wmp-save-k">Enter playlist name:</div><input class="wm-edit wmp-save-edit" type="text" autocomplete="off" maxlength="64" value="Playlist ${n}">`;
        const ed = box.querySelector('.wmp-save-edit');
        setTimeout(() => { if (layer === 'save') { ed.focus(); ed.select(); } }, 0);
    }

    function savePlaylist() {
        const ed = page.querySelector('.wmp-save-edit');
        const name = String(ed && ed.value || '').trim();
        if (!name) return;
        const s = currentSource();
        const all = lsGet(PLAYLISTS_KEY, {});
        const list = (all[s.id] || []).filter((p) => p.name !== name);
        list.push({ name, keys: media.queue.map(keyOf).filter(Boolean) });
        all[s.id] = list;
        lsSet(PLAYLISTS_KEY, all);
        popLayer();
    }

    // ---------------------------------------------------------------- Options

    let draft = null;
    let optTab = 'playback';
    const tabState = {};
    const TABS = [['playback', 'Playback'], ['video', 'Video'], ['network', 'Network'], ['library', 'Library'], ['skins', 'Skins'], ['buttons', 'Buttons']];
    let btnSel = -1;

    function openOptions(tab) {
        draft = JSON.parse(JSON.stringify(opts));
        const A = window.wmMediaApps;
        draft.hiddenApps = [...(A && A.hidden ? A.hidden() : [])];
        optTab = tab || 'playback';
        btnSel = -1;
        pushLayer('options');
    }

    function renderOptions() {
        const box = page.querySelector('.wmp-opts');
        const ui = window.wmSettings && window.wmSettings.ui;
        const check = (k, label, on, extra = '') => (ui ? ui.check('wmp-o', label, on, `data-k="${k}" ${extra}`) : `<label class="wm-check"><input type="checkbox" name="wmp-o" data-k="${k}"${on ? ' checked' : ''} ${extra}><span>${esc(label)}</span></label>`);
        const combo = (act, label) => `<button type="button" class="wm-combo" data-act="${act}"><span>${esc(label)}</span></button>`;
        const d = draft;
        let body = '';
        if (optTab === 'playback') {
            const A = window.wmMediaApps;
            const choices = A && A.choices ? A.choices() : [];
            body = `<div class="wmp-o-b wmp-o-time">Show time as:</div>${combo('time', d.time === 'remaining' ? 'Remaining' : 'Elapsed')}
                <div class="wmp-o-61">${check('pauseOther', 'Pause playback while using another program', d.pauseOther)}${check('resumeCall', 'Resume playback after a phone call', d.resumeCall)}</div>
                ${choices.length ? `<div class="wmp-o-b wmp-o-apps">When Melaton Media is not playing, Now Playing shows what these programs play:</div>
                <div class="wmp-o-applist">${choices.map(([pkg, label]) => check('app', label, !d.hiddenApps.includes(pkg), `value="${esc(pkg)}"`)).join('')}</div>` : ''}`;
        } else if (optTab === 'video') {
            body = `<div class="wmp-o-vlabel">Play video in full screen:</div>${combo('full', { never: 'Never', oversized: 'Only when oversized', always: 'Always' }[d.fullScreen] || 'Never')}
                ${check('scale', 'Scale to fit window', d.scale)}`;
        } else if (optTab === 'network') {
            body = `<div class="wmp-o-b wmp-o-proto">Protocol</div>
                <div class="wmp-o-protos">${check('udp', 'UDP', d.udp)}${check('tcp', 'TCP', d.tcp)}${check('http', 'HTTP', d.http)}</div>
                <div class="wmp-o-port"><span>UDP Port</span><input class="wm-edit" type="text" inputmode="numeric" maxlength="5" data-k="udpPort" value="${esc(d.udpPort)}"${d.udp ? '' : ' disabled'}></div>
                <div class="wmp-o-b wmp-o-speedk">Internet connection speed</div>${combo('speed', SPEEDS[d.speed] || SPEEDS[0])}
                ${check('detect', 'Detect connection speed', d.detect)}`;
        } else if (optTab === 'library') {
            body = check('startLibrary', 'Start Player on Library screen', d.startLibrary);
        } else if (optTab === 'skins') {
            const land = orient === 'landscape';
            body = `<div class="wmp-o-skin">Default(${land ? 'Landscape' : 'Portrait'})</div>
                <div class="wmp-o-preview${land ? ' is-landscape' : ''}"></div>
                <div class="wmp-o-skinbtns"><button type="button" class="wm-button" disabled>Previous</button><button type="button" class="wm-button" disabled>Next</button></div>`;
        } else {
            body = `<div class="wmp-o-keys wm-pv-scroll wm-pg-scroll" role="listbox">${FUNCS.map(([k, label], i) => `<div class="wmp-o-key${i === btnSel ? ' is-selected' : ''}" data-i="${i}"><span>${esc(label)}</span><div>${esc(keyLabel(d.buttons[k]))}</div></div>`).join('')}</div>
                <div class="wmp-o-keybtns">${['Assign', 'Reset', 'None'].map((l) => `<button type="button" class="wm-button" data-kb="${l.toLowerCase()}"${btnSel < 0 ? ' disabled' : ''}>${l}</button>`).join('')}</div>`;
        }
        box.innerHTML = `<div class="wm-form-hdr">Options</div><div class="wmp-o-body is-${optTab}">${body}</div>
            <div class="wm-tabs" role="tablist">${TABS.map(([k, l]) => `<button type="button" class="wm-tab" role="tab" data-tab="${k}" aria-selected="${optTab === k}">${l}</button>`).join('')}</div>`;
        if (window.wmSettings && typeof window.wmSettings.fitTabs === 'function') window.wmSettings.fitTabs(box.querySelector('.wm-tabs'), tabState);
        const preview = box.querySelector('.wmp-o-preview');
        if (preview) preview.style.setProperty('--art', img(orient === 'landscape' ? 'np-landscape' : 'np-portrait'));
        box.querySelectorAll('.wm-tab').forEach((t) => t.addEventListener('click', () => { optTab = t.dataset.tab; renderOptions(); }));
        box.querySelectorAll('input[type="checkbox"][data-k]').forEach((c) => c.addEventListener('change', () => {
            const k = c.dataset.k;
            if (k === 'app') { const set = new Set(d.hiddenApps); if (c.checked) set.delete(c.value); else set.add(c.value); d.hiddenApps = [...set]; return; }
            d[k] = c.checked;
            if (k === 'udp') { const port = box.querySelector('[data-k="udpPort"]'); if (port) port.disabled = !c.checked; }
        }));
        const port = box.querySelector('[data-k="udpPort"]');
        if (port) port.addEventListener('input', () => { port.value = port.value.replace(/\D+/g, ''); d.udpPort = port.value || '0'; });
        box.querySelectorAll('.wm-combo').forEach((b) => b.addEventListener('click', (e) => {
            e.stopPropagation();
            const act = b.dataset.act;
            const pick = (k, v) => { d[k] = v; renderOptions(); };
            const rows = act === 'time' ? [['elapsed', 'Elapsed'], ['remaining', 'Remaining']].map(([v, l]) => ({ label: l, radio: d.time === v, action: () => pick('time', v) }))
                : act === 'full' ? [['never', 'Never'], ['oversized', 'Only when oversized'], ['always', 'Always']].map(([v, l]) => ({ label: l, radio: d.fullScreen === v, action: () => pick('fullScreen', v) }))
                    : SPEEDS.map((l, i) => ({ label: l, radio: d.speed === i, action: () => pick('speed', i) }));
            ws.dropdown(b, rows, 'left');
        }));
        // a function is chosen by a tap (none at first, as the device: Assign / Reset / None wait for it)
        box.querySelectorAll('.wmp-o-key').forEach((r) => r.addEventListener('click', () => {
            btnSel = Number(r.dataset.i);
            box.querySelectorAll('.wmp-o-key').forEach((x) => setClass(x, 'is-selected', x === r));
            box.querySelectorAll('[data-kb]').forEach((b) => { b.disabled = false; });
        }));
        box.querySelectorAll('[data-kb]').forEach((b) => b.addEventListener('click', () => {
            if (btnSel < 0) return;
            const [k] = FUNCS[btnSel];
            if (b.dataset.kb === 'reset') { d.buttons[k] = DEFAULTS.buttons[k]; renderOptions(); } else if (b.dataset.kb === 'none') { d.buttons[k] = null; renderOptions(); } else assignKey(k);
        }));
    }

    /** Assign: "Press button to assign"; the next key pressed is the function's (Escape / X: none taken). */
    function assignKey(k) {
        let done = false;
        const onKey = (e) => {
            if (done || e.key === 'Escape' || e.repeat) return;
            if (/^(Shift|Control|Alt|Meta|Unidentified|Process)$/.test(e.key)) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            done = true;
            draft.buttons[k] = e.key;
            // the box closes the way the device's did: at the key
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        };
        window.addEventListener('keydown', onKey, { capture: true, signal: appScopeSignal });
        ws.messageBox({ title: 'Assign Button', text: 'Press button to assign', buttons: [], titleAction: { kind: 'close', value: null }, cancelValue: null, modal: true }).then(() => {
            window.removeEventListener('keydown', onKey, { capture: true });
            if (layer === 'options') renderOptions();
        });
    }

    function keepOptions() {
        if (!draft) return;
        const A = window.wmMediaApps;
        if (A && A.setHidden) A.setHidden(draft.hiddenApps || []);
        delete draft.hiddenApps;
        opts = draft;
        draft = null;
        saveOpts();
        if (media.el) media.el.preload = opts.speed >= 5 ? 'auto' : 'metadata';
    }

    // ---------------------------------------------------------------- layers

    function pushLayer(l) {
        stack.push(layer);
        layer = l;
        render();
        ws.syncHistory();
    }

    function popLayer() {
        const was = layer;
        layer = stack.pop() || 'skin';
        if (was === 'options') draft = null;
        if (was === 'props') propsOf = null;
        render();
        ws.syncHistory({ noPush: true });
    }

    function toSkin() {
        stack.length = 0;
        layer = 'skin';
        draft = null;
        update = null;
        propsOf = null;
    }

    const PAGE_CLASS = { options: 'wmp-opts', props: 'wmp-props', update: 'wmp-update', about: 'wmp-about', url: 'wmp-url', save: 'wmp-save' };

    function render() {
        if (!page) return;
        if (page.dataset.layer !== layer) page.dataset.layer = layer;
        if (layer === 'skin') { fitSkin(); paintSkin(); } else syncTick();
        if (layer === 'library') renderLibrary();
        else if (layer === 'queue') renderQueue();
        else if (layer === 'options') renderOptions();
        else if (layer === 'props') renderProps();
        else if (layer === 'about') renderAbout();
        else if (layer === 'update') renderUpdate();
        else if (layer === 'url') renderUrl();
        else if (layer === 'save') renderSave();
        // the pages not shown keep nothing
        Object.entries(PAGE_CLASS).forEach(([l, c]) => { if (l !== layer) { const el = page.querySelector(`.${c}`); if (el && el.firstChild) el.innerHTML = ''; } });
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    // ---------------------------------------------------------------- actions

    function openLibrary() {
        stack.length = 0;
        stack.push('skin');
        layer = 'library';
        if (libPath[0] === 'fs') libPath = [];
        libSel = 0;
        render();
        ws.syncHistory();
        ensureLibrary(false).then(() => { if (layer === 'library') render(); });
    }

    function openQueue() {
        if (layer === 'library') { stack.push('library'); layer = 'queue'; } else { stack.length = 0; stack.push('skin'); layer = 'queue'; }
        queueSel = Math.max(0, media.index);
        render();
        ws.syncHistory();
    }

    function showProps(it) {
        if (!it) return;
        propsOf = it;
        pushLayer('props');
        page.querySelector('.wmp-props').scrollTop = 0;
    }

    /** A tap in the Library: a category opens; a song or video is selected (Play plays it), as on the device. */
    function libTap(i) {
        const r = libRows()[i];
        if (!r) return;
        if (r.queue) { openQueue(); return; }
        if (r.ask) { askAccess(); return; }
        if (r.open) { goLevel(r.open); return; }
        libSel = i;
        renderLibrary();
        ws.refreshSoftKeys();
    }

    /** Play: the selected file and what follows it in the list, or everything under the selected row. */
    async function playFrom(i) {
        const rows = libRows();
        const r = rows[i];
        if (!r) return;
        if (r.queue) { openQueue(); return; }
        // Open File...: Play on a folder plays its media files
        if (r.open && r.open[0] === 'fs') {
            const keep = fsList;
            await fsLoad(r.open[r.open.length - 1]);
            const files = fsRows().filter((x) => x.item).map((x) => x.item);
            fsList = keep;
            if (!files.length) return;
            media.queue = [];
            enqueue(files, true);
            return;
        }
        if (r.item) {
            const files = rows.filter((x) => x.item).map((x) => x.item);
            const k = files.indexOf(r.item);
            media.queue = [];
            enqueue(files.slice(k).concat(files.slice(0, k)), true);
            return;
        }
        const items = rowItems(r);
        if (!items.length) return;
        media.queue = [];
        enqueue(items, true);
    }

    function queueUp() {
        const items = rowItems(libRows()[libSel]);
        if (!items.length) return;
        enqueue(items, false);
    }

    /** Delete from Library: "Do you also want to permanently delete the file from the device?" */
    async function deleteFromLibrary() {
        const r = libRows()[libSel];
        if (!r || !(r.item || r.playlist)) return;
        const ans = await ws.messageBox({ title: TITLE, icon: 'question', text: 'Do you also want to permanently delete the file from the device?', buttons: [{ text: 'Yes', value: 'yes', default: true }, { text: 'No', value: 'no' }], cancelValue: null });
        if (!ans) return;
        const s = currentSource();
        const list = r.item ? [r.item] : r.playlist.items;
        if (r.playlist) {
            if (r.playlist.own != null) {
                const all = lsGet(PLAYLISTS_KEY, {});
                (all[s.id] || []).splice(r.playlist.own, 1);
                lsSet(PLAYLISTS_KEY, all);
            } else setRemoved([{ src: 'playlist', path: `${s.id}:${r.playlist.name}` }], true);
        } else setRemoved(list, true);
        if (ans === 'yes') {
            for (const it of list) {
                if (it.src === 'android') {
                    const L = library();
                    if (L && typeof L.delete === 'function') { try { L.delete(it.volume, it.kind, String(it.id)); } catch (_) { /* bridge gone */ } } else {
                        ws.messageBox({ title: TITLE, icon: 'error', text: 'This version of the Dreamscape app cannot delete files from the phone. The file was removed from the library only.', modal: true });
                        break;
                    }
                } else if (it.fileId && window.wsClient) {
                    try { await ws.busy(window.wsClient.sendMessage('vfs_delete_file', { fileId: it.fileId }), { timeout: 15000 }); } catch (_) { ws.notify({ title: TITLE, icon: 'error', text: `${it.name} could not be deleted.` }); }
                }
            }
        }
        render();
    }

    function shuffleRepeat() {
        return [
            { label: 'Shuffle', checked: media.shuffle, action: () => { media.shuffle = !media.shuffle; paintSkin(); tellAndroid(); } },
            { label: 'Repeat', checked: media.repeat, action: () => { media.repeat = !media.repeat; paintSkin(); tellAndroid(); } }
        ];
    }

    function rate() {
        const it = current();
        if (!it || androidMode()) return;
        setRating(it, (ratingOf(it) + 1) % 6);
        paintSkin();
    }

    function onlineGuide() { ws.open(GUIDE_APP); }

    function pressButton(k) {
        if ((k === 'play' || k === 'prev' || k === 'next') && androidMode() && androidCommand(k)) return;
        if (k === 'play') playPause();
        else if (k === 'prev') prev();
        else if (k === 'next') next(false);
        else if (k === 'volup') { media.volume = Math.min(100, media.volume + 10); applyVolume(); paintSkin(); }
        else if (k === 'voldown') { media.volume = Math.max(0, media.volume - 10); applyVolume(); paintSkin(); }
        else if (k === 'mute') { media.muted = !media.muted; applyVolume(); paintSkin(); }
        else if (k === 'full') setFull(!full);
        else if (k === 'online') onlineGuide();
    }

    function moveQueue(d) {
        const i = queueSel;
        const j = i + d;
        if (j < 0 || j >= media.queue.length) return;
        const [it] = media.queue.splice(i, 1);
        media.queue.splice(j, 0, it);
        if (media.index === i) media.index = j; else if (media.index === j) media.index = i;
        queueSel = j;
        renderQueue();
        ws.refreshSoftKeys();
    }

    function removeQueue() {
        if (!media.queue.length) return;
        const i = queueSel;
        media.queue.splice(i, 1);
        if (media.index === i) { stop(); if (media.el) media.el.removeAttribute('src'); media.index = -1; media.status = 'Ready'; } else if (media.index > i) media.index -= 1;
        render();
        tellAndroid();
    }

    function clearQueue() {
        stop();
        if (media.el) { media.el.removeAttribute('src'); media.el.load(); }
        media.queue = [];
        media.index = -1;
        media.status = 'Ready';
        render();
        tellAndroid();
    }

    // ---------------------------------------------------------------- the hardware keys (Options > Buttons)

    let hold = null; // { key, timer, rep, held }
    function keyFunc(k) {
        const v = media.el;
        if (k === 'playpause') pressButton('play');
        else if (k === 'stop') stop();
        else if (k === 'pause') pause();
        else if (k === 'prev') pressButton('prev');
        else if (k === 'next') pressButton('next');
        else if (k === 'volup' || k === 'voldown' || k === 'mute') pressButton(k);
        else if (k === 'full') setFull(!full);
        else if (k === 'rating') rate();
        else if (k === 'screen') setScreen(!screenOff);
        else if ((k === 'ff' || k === 'rew') && v && Number.isFinite(v.duration)) {
            try { v.currentTime = Math.max(0, Math.min(v.duration - 0.5, v.currentTime + (k === 'ff' ? 5 : -5))); } catch (_) { /* not seekable */ }
        }
    }
    const funcFor = (key) => (FUNCS.find(([k]) => opts.buttons[k] === key) || [])[0] || null;

    function onKeyDown(e) {
        if (!ws || ws.current !== APP_ID || (layer !== 'skin' && !full) || e.ctrlKey || e.metaKey || e.altKey) return;
        const t = e.target;
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
        if (document.querySelector('#wmShell .wm-popup:not([hidden]), #wmShell .wm-msgbox-layer:not([hidden])')) return;
        if (screenOff) { e.preventDefault(); setScreen(false); return; }
        const tap = funcFor(e.key);
        const held = funcFor(`hold:${e.key}`);
        if (!tap && !held) return;
        e.preventDefault();
        if (e.repeat) return;
        if (!held) { keyFunc(tap); return; }
        // a key with a hold function: a short press is its tap function, a hold repeats the hold one
        if (hold) { clearTimeout(hold.timer); clearInterval(hold.rep); }
        const h = { key: e.key, held: false, timer: 0, rep: 0 };
        // perf: allow press-and-hold repeat, only while the key is down (cleared on keyup / blur)
        h.timer = setTimeout(() => { h.held = true; keyFunc(held); h.rep = setInterval(() => keyFunc(held), 300); }, 500);
        hold = h;
    }
    function onKeyUp(e) {
        if (!hold || e.key !== hold.key) return;
        clearTimeout(hold.timer);
        clearInterval(hold.rep);
        const h = hold;
        hold = null;
        if (!h.held) { const tap = funcFor(h.key); if (tap) keyFunc(tap); }
    }
    document.addEventListener('keydown', onKeyDown, { signal: appScopeSignal });
    document.addEventListener('keyup', onKeyUp, { signal: appScopeSignal });
    window.addEventListener('blur', () => { if (hold) { clearTimeout(hold.timer); clearInterval(hold.rep); hold = null; } }, { signal: appScopeSignal });

    // ---------------------------------------------------------------- the app

    function mount(p) {
        page = p;
        p.classList.add('wm-media');
        p.style.setProperty('--wmp-stars', img('stars'));
        p.innerHTML = `
            <div class="wmp-np"></div>
            <div class="wmp-lib">
                <div class="wmp-lhead"></div>
                <div class="wmp-llist wm-pv-scroll wm-pg-scroll" role="listbox"></div>
            </div>
            <div class="wmp-opts"></div>
            <div class="wmp-props wm-pv-scroll wm-pg-scroll"></div>
            <div class="wmp-update"></div>
            <div class="wmp-about"></div>
            <div class="wmp-url"></div>
            <div class="wmp-save"></div>
            <div class="wmp-queue">
                <div class="wmp-lhead"><span class="wmp-lsel is-static">${ws.art.img('wmp-playlist')}<span>Now Playing</span></span></div>
                <div class="wmp-qlist wm-pv-scroll wm-pg-scroll" role="listbox"></div>
                <div class="wmp-qbar">
                    <button type="button" class="wmp-qtool" data-t="up" aria-label="Move Up">${ws.art.img('wmp-up')}</button>
                    <button type="button" class="wmp-qtool" data-t="down" aria-label="Move Down">${ws.art.img('wmp-down')}</button>
                    <button type="button" class="wmp-qtool" data-t="add" aria-label="Add">${ws.art.img('wmp-add')}</button>
                    <button type="button" class="wmp-qtool" data-t="remove" aria-label="Remove from Playlist">${ws.art.img('wmp-delete')}</button>
                    <button type="button" class="wmp-qtool" data-t="props" aria-label="Properties">${ws.art.img('wmp-properties')}</button>
                </div>
            </div>
            <div class="wmp-fs" hidden></div>
            <div class="wmp-dark" hidden></div>`;
        // skin buttons: pushed while the stylus is down, act on release over the button
        p.addEventListener('pointerdown', (e) => {
            const b = e.target.closest('.wmp-btn');
            if (b && !b.disabled) b.classList.add('is-down');
        });
        const up = () => p.querySelectorAll('.wmp-btn.is-down').forEach((b) => b.classList.remove('is-down'));
        p.addEventListener('pointerup', up);
        p.addEventListener('pointercancel', up);
        p.addEventListener('click', (e) => {
            const t = e.target;
            if (t.closest('.wmp-dark')) { setScreen(false); return; }
            const b = t.closest('.wmp-btn');
            if (b) { if (!b.disabled) pressButton(b.dataset.b); return; }
            if (t.closest('.wmp-ratings')) { rate(); return; }
            const seek = t.closest('.wmp-seek');
            const a = seek && androidMode();
            if (a) {
                if (a.duration && (!a.actions || a.actions.includes('seek'))) {
                    const r = seek.getBoundingClientRect();
                    try { window.AndroidMediaSession.seekTo(a.id, Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * a.duration); } catch (_) { /* bridge gone */ }
                }
                return;
            }
            if (seek && media.el && Number.isFinite(media.el.duration)) {
                const r = seek.getBoundingClientRect();
                media.el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * media.el.duration;
                return;
            }
            // Back: one level up, at the top back to the screen the Library came from (the back key's own
            // step, so the history entries stay in step)
            if (t.closest('.wmp-lback')) { history.back(); return; }
            const sel = t.closest('.wmp-lsel:not(.is-static)');
            if (sel) { ws.dropdown(sel, libMenu(), 'left'); return; }
            const tool = t.closest('.wmp-qtool');
            if (tool) {
                const k = tool.dataset.t;
                if (k === 'up') moveQueue(-1);
                else if (k === 'down') moveQueue(1);
                else if (k === 'remove') removeQueue();
                else if (k === 'add') openLibrary();
                else if (k === 'props') showProps(media.queue[queueSel]);
                return;
            }
            const hist = t.closest('.wmp-url-list .wmp-lrow');
            if (hist) {
                const u = lsGet(URLS_KEY, [])[Number(hist.dataset.u)];
                const ed = page.querySelector('.wmp-url-edit');
                if (u && ed) ed.value = u;
                page.querySelectorAll('.wmp-url-list .wmp-lrow').forEach((x) => setClass(x, 'is-selected', x === hist));
                return;
            }
            const row = t.closest('.wmp-lrow');
            if (!row) return;
            const i = Number(row.dataset.i);
            if (layer === 'library') libTap(i);
            else if (layer === 'queue') {
                queueSel = i;
                renderQueue();
                ws.refreshSoftKeys();
            }
        });
        p.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            if (e.target.closest('.wmp-url-edit')) { e.preventDefault(); openUrlNow(); } else if (e.target.closest('.wmp-save-edit')) { e.preventDefault(); savePlaylist(); }
        });
        try { new ResizeObserver(() => { fitSkin(); fitFull(); }).observe(p); } catch (_) { window.addEventListener('resize', () => { fitSkin(); fitFull(); }, { signal: appScopeSignal }); }
    }

    function nowPlayingMenu() {
        const it = current();
        return [
            { label: 'Library...', action: openLibrary }, '-',
            { label: 'Play/Pause', action: playPause, disabled: !media.queue.length },
            { label: 'Stop', action: stop, disabled: !media.el || !media.el.getAttribute('src') || (media.el.paused && !media.el.currentTime) },
            { label: 'Shuffle/Repeat', submenu: shuffleRepeat() },
            { label: 'Full Screen', action: () => setFull(true), disabled: !(it && it.kind === 'video') }, '-',
            { label: 'Options...', action: () => openOptions() },
            { label: 'Properties', action: () => showProps(it), disabled: !it }, '-',
            { label: 'About', action: () => pushLayer('about') }
        ];
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: TITLE,
            startLabel: TITLE,
            icon: 'app-windows-media',
            inStart: 'programs',
            // the input panel button as on the device: none on the playback screen, Properties and About
            sip: () => !full && layer !== 'skin' && layer !== 'props' && layer !== 'about' && layer !== 'update',
            mount,
            show() {
                // Options > Library > Start Player on Library screen (on by default): a start with nothing playing opens the Library
                if (opts.startLibrary && !media.queue.length && layer === 'skin' && !libs.has(currentSource().id) && !androidMode()) { openLibrary(); return; }
                render();
            },
            // the playback screen has X; every other screen ok (Options keeps its changes, Properties closes)
            titleKind: () => (full || layer === 'update' ? null : layer === 'skin' ? 'close' : 'ok'),
            onTitleOk() {
                if (layer === 'options') { keepOptions(); popLayer(); return true; }
                if (layer === 'url') { openUrlNow(); return true; }
                if (layer === 'save') { savePlaylist(); return true; }
                if (layer === 'update') { endUpdate(); return true; }
                if (layer === 'props' || layer === 'about') { popLayer(); return true; }
                if (layer === 'library' || layer === 'queue') { toSkin(); render(); return true; }
                return false;
            },
            historyDepth: () => (full ? 1 : 0) + stack.length + (layer === 'library' || stack.includes('library') ? Math.max(0, libPath.length - (libPath[0] === 'fs' ? 1 : 0)) : 0),
            onBack() {
                if (full) { setFull(false); return true; }
                if (layer === 'library' && libPath.length > (libPath[0] === 'fs' ? 1 : 0)) { goLevel(libPath.slice(0, -1)); return true; }
                // the back key keeps Options, as ok and back do on every WM settings page
                if (layer === 'options') { keepOptions(); popLayer(); return true; }
                if (layer === 'update') { endUpdate(); return true; }
                if (stack.length) { popLayer(); return true; }
                return false;
            },
            softKeys() {
                if (full) return { left: null, right: null };
                if (layer === 'options' || layer === 'about') return { left: null, right: null };
                if (layer === 'props') return { left: { label: 'OK', action: popLayer }, right: { label: 'Menu', menu: () => [{ label: 'Buy CD', disabled: true }] } };
                if (layer === 'update') {
                    const done = update && update.phase === 'done';
                    return { left: { label: 'Search', disabled: true }, right: { label: done ? 'Done' : 'Cancel', action: endUpdate } };
                }
                if (layer === 'url') {
                    return {
                        left: { label: 'OK', action: openUrlNow },
                        right: { label: 'Menu', menu: () => [{ label: 'Clear History', action: () => { lsSet(URLS_KEY, []); renderUrl(); } }, { label: 'Cancel', action: popLayer }] }
                    };
                }
                if (layer === 'save') return { left: { label: 'Done', action: savePlaylist }, right: { label: 'Cancel', action: popLayer } };
                if (layer === 'skin') return { left: { label: 'Now Playing', action: openQueue }, right: { label: 'Menu', menu: nowPlayingMenu } };
                if (layer === 'queue') {
                    const has = media.queue.length > 0;
                    return {
                        left: { label: 'Play', action: () => { if (has) { playIndex(queueSel); toSkin(); render(); ws.syncHistory({ noPush: true }); } }, disabled: !has },
                        right: { label: 'Menu', menu: () => [
                            { label: 'Library...', action: openLibrary }, '-',
                            { label: 'Move Up', action: () => moveQueue(-1), disabled: !has || queueSel === 0 },
                            { label: 'Move Down', action: () => moveQueue(1), disabled: !has || queueSel >= media.queue.length - 1 },
                            { label: 'Remove from Playlist', action: removeQueue, disabled: !has },
                            { label: 'Shuffle/Repeat', submenu: shuffleRepeat() }, '-',
                            { label: 'Save Playlist...', action: () => pushLayer('save'), disabled: !has },
                            { label: 'Clear Now Playing', action: clearQueue, disabled: !has }, '-',
                            { label: 'Error Details', action: () => ws.messageBox({ title: TITLE, icon: 'error', text: media.error, modal: true }), disabled: !media.error },
                            { label: 'Properties', action: () => showProps(media.queue[queueSel]), disabled: !has }
                        ] }
                    };
                }
                const r = libRows()[libSel];
                const playable = rowItems(r).length > 0 || !!(r && r.open && r.open[0] === 'fs');
                return {
                    left: { label: 'Play', action: () => playFrom(libSel), disabled: !playable },
                    right: { label: 'Menu', menu: () => [
                        { label: 'Queue Up', action: queueUp, disabled: !playable },
                        { label: 'Delete from Library', action: deleteFromLibrary, disabled: !(r && (r.item || r.playlist)) }, '-',
                        { label: 'Now Playing', action: openQueue },
                        { label: 'Library', submenu: sourceMenu() },
                        { label: 'Update Library...', action: runUpdate },
                        { label: 'Open File...', action: openFile },
                        { label: 'Open URL...', action: () => pushLayer('url') }, '-',
                        { label: 'Properties', action: () => showProps(r && r.item), disabled: !(r && r.item) }
                    ] }
                };
            }
        });
    }

    /** Play All Songs (the 6.5 Music panel): every song of the library from the first, in the background. */
    async function playAll() {
        await ensureLibrary(false);
        const L = shown();
        if (!L.audio.length) return false;
        media.queue = [];
        media.index = -1;
        enqueue(L.audio, true);
        return true;
    }

    window.wmMedia = {
        enqueue: (items, play) => enqueue(items, play),
        state: () => ({ layer, libPath, queue: media.queue.length, index: media.index, status: media.status, orient, full, stack: stack.slice() }),
        // what plays, for the Music panel: null with nothing queued; artist = the tag (phone library) or the song's folder (server files)
        now: () => {
            const it = current();
            if (!it) return null;
            const v = media.el;
            return { title: it.name, artist: it.artist || (it.kind === 'audio' ? it.folder || '' : ''), art: it.kind === 'audio' ? it.art || '' : '', albumArt: it.kind === 'audio' ? it.albumArt || '' : '', playing: !!(v && !v.paused && !v.ended), status: media.status, index: media.index, count: media.queue.length };
        },
        // Options (#829): open Melaton Media on its Options page (Playback: which programs Now Playing may show)
        options: () => { if (!ws) return false; if (ws.current !== APP_ID) ws.open(APP_ID); toSkin(); openOptions('playback'); return true; },
        playPause: () => playPause(),
        next: () => next(false),
        previous: () => prev(),
        playAll
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
