/**
 * Melaton Mobile: Windows Media (WM 6.1 Professional's Windows Media Player 10 Mobile, wmplayer.exe),
 * Yozora #732, parent #709.
 *
 * Plays what the desktop Media Player plays: media files in the VFS, streamed from the same
 * /fs/read endpoint (desktop-apps/mediaPlayer.js desktopMediaVfsUrl), or a user file's download URL.
 * The Library is the active workspace's folders (as the desktop Library browses the VFS), scanned once
 * per session (Menu > Update Library... scans again): My Music / My Videos list the playable audio and
 * video files; Album groups music by its folder; Artist and Genre read "Unknown" (no tags are read).
 *
 * In the Android app (#801) the Library drop-down lists the phone's own libraries first: My Device (internal
 * storage) and Storage Card (each SD card), read from Android's media library (MediaStore through
 * window.AndroidMediaLibrary: tags, album art, Android's playlists; songs stream from the phone with
 * seeking), then the workspace's library on the server ("<workspace> on Dreamscape"). What Melaton Media
 * plays is Android's media session too (lock screen, notification shade, headset and car buttons). When
 * Melaton Media is not playing, Now Playing shows and controls whatever else Android plays
 * (window.AndroidMediaSession).
 *
 * Built from the ROM's own skin files (~/.cache/wm61/dump/win/wmp_WPC_player_480x640.skn and
 * _640x480.skn; art in public/static_images/wm61/wmp, the VGA files and their halves):
 *   Now Playing   the skin: album art / video 10,74 460x310, title marquee, status, rating, time,
 *                 seek bar (thumb 40x20), volume %, and its buttons (full screen, Windows Media, prev,
 *                 play / pause, next, volume -, +, mute) drawn from the pushed / disabled strips.
 *                 The skin keeps its proportions and grows to fit; landscape uses the 640x480 skin.
 *                 Soft keys: Now Playing | Menu.
 *   Library       "Library" drop-down and Back, then the categories (My Music, My Videos, My TV, My
 *                 Playlists, Now Playing) and their lists, icons from wmploc.dll; Play | Menu.
 *   Now Playing list   the queue with the toolbar (move up / down, add, remove, properties); Play | Menu.
 * Measured on the Device Emulator (~/.cache/wm61/ref-apps/wmp*.png). Programs lists it in place of the
 * desktop's Media Player (wmPrograms.js MAPPED). Only on phones. Styles: public/css/wm-media.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'windows-media';
    const SKIN = '/static_images/wm61/wmp/';
    const AUDIO = /\.(mp3|ogg|oga|wav|aac|m4a|flac|opus|weba)$/i;
    const VIDEO = /\.(mp4|webm|ogv|m4v|mov)$/i;
    const MAX_DIRS = 160;
    const SKIP_DIRS = new Set(['Trash', 'Calendars', 'Contacts', 'Notes']);
    const SOURCE_KEY = 'wmMediaSource';
    const OWN_PACKAGE = /^jp\.net\.seventhreeseven\.dreamscape/;

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
    const DISABLED_W = { portrait: [292, 86], landscape: [292, 62] };

    let ws = null;
    let page = null;
    let layer = 'skin'; // 'skin' | 'library' | 'queue' | 'options'
    let optsDraft = null; // Options: the packages left unchecked (hidden from Now Playing)
    let libPath = []; // the Library's open levels: ['music'], ['music', 'all'], ['music', 'album', '<folder>'] ...
    let libSel = 0;
    let queueSel = 0;
    let orient = 'portrait';

    // ---------------------------------------------------------------- playback

    const media = { el: null, queue: [], index: -1, shuffle: false, repeat: false, volume: 70, muted: false, status: 'Ready', error: '' };

    function player() {
        if (media.el) return media.el;
        const v = document.createElement('video');
        v.className = 'wmp-video';
        v.playsInline = true;
        v.preload = 'metadata';
        v.addEventListener('timeupdate', paintTime);
        v.addEventListener('durationchange', () => { paintTime(); tellAndroid(); });
        v.addEventListener('play', () => { media.status = 'Playing'; paintSkin(); tellAndroid(); });
        v.addEventListener('pause', () => { if (!v.ended) media.status = 'Paused'; paintSkin(); tellAndroid(); });
        v.addEventListener('waiting', () => { media.status = 'Buffering...'; paintSkin(); });
        v.addEventListener('playing', () => { media.status = 'Playing'; paintSkin(); tellAndroid(); });
        v.addEventListener('seeked', tellAndroid);
        v.addEventListener('ended', () => { media.status = 'Stopped'; next(true); });
        v.addEventListener('error', () => {
            if (!v.getAttribute('src')) return;
            media.status = 'Error';
            media.error = 'Melaton Media cannot play the file. The file might not be supported, or the codec used to compress it is not available.';
            paintSkin();
            ws.notify({ title: 'Melaton Media', icon: 'error', text: media.error });
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
        if (base && item.path) return Promise.resolve(`${base}/fs/read?path=${encodeURIComponent(item.path)}`);
        if (item.fileId) return V.downloadFile(item.fileId).then((r) => (r && r.downloadUrl) || '');
        return Promise.resolve('');
    }

    async function playIndex(i) {
        const it = media.queue[i];
        if (!it) return;
        media.index = i;
        media.error = '';
        media.status = 'Opening...';
        paintSkin();
        const v = player();
        try {
            const url = it.url || await ws.busy(vfsUrl(it), { timeout: 15000 });
            if (!url) throw new Error('no url');
            v.poster = it.poster || '';
            v.src = url;
            await v.play();
        } catch (err) {
            if (err && err.name === 'AbortError') return;
            if (err && err.name === 'NotAllowedError') { media.status = 'Paused'; paintSkin(); return; }
            if (!media.error) {
                media.status = 'Error';
                ws.notify({ title: 'Melaton Media', icon: 'error', text: `${it.name} cannot be played.` });
            }
        }
        paintSkin();
    }

    function playPause() {
        if (!media.queue.length) return;
        const v = player();
        if (media.index < 0 || !v.getAttribute('src')) { playIndex(Math.max(0, media.index)); return; }
        if (v.paused) v.play().catch(() => {}); else v.pause();
    }

    function stop() {
        if (!media.el) return;
        media.el.pause();
        try { media.el.currentTime = 0; } catch (_) { /* not seekable */ }
        media.status = 'Stopped';
        paintSkin();
        tellAndroid();
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
                    canNext: media.queue.length > 1 || media.repeat,
                    canPrev: media.queue.length > 0
                }));
            } catch (_) { /* bridge gone */ }
        }, 80);
    }

    // the notification's / lock screen's / headset's buttons
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
            default: break;
        }
    });
    window.addEventListener('melatonopenapp', (e) => { if (e && e.detail === APP_ID && ws) { layer = 'skin'; ws.open(APP_ID); render(); } });

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
    });

    /** Android's active session that is not Dreamscape's own (else null). */
    function androidSession() {
        const st = androidState || readAndroidState();
        // Options > Show what these programs play (shared with Today's Music item: window.wmMediaApps)
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

    // the clock of Android's playing item moves on the skin while it is on screen (local, no requests)
    function androidClock(on) {
        if (on && !androidTick) androidTick = setInterval(() => { if (page && layer === 'skin' && document.documentElement.dataset.wmApp === APP_ID) paintTime(); }, 1000);
        else if (!on && androidTick) { clearInterval(androidTick); androidTick = 0; }
    }

    function next(auto) {
        if (!media.queue.length) return;
        let i;
        if (media.shuffle && media.queue.length > 1) {
            do { i = Math.floor(Math.random() * media.queue.length); } while (i === media.index);
        } else i = media.index + 1;
        if (i >= media.queue.length) {
            if (!media.repeat) { if (auto) { media.status = 'Stopped'; paintSkin(); } return; }
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
            layer = 'skin';
            render();
            ws.syncHistory();
        } else render();
    }

    // ---------------------------------------------------------------- the libraries
    // sources: the workspace's library on the server (VFS scan), and in the Android app the phone's own
    // media library per storage volume (#801): { id, label, icon, kind: 'vfs' | 'android', volume }

    const libs = new Map(); // source id -> { audio, video, playlists, error? }
    const scans = new Map(); // source id -> promise
    let source = null;
    const unindexed = new Set(); // volumes whose library Android answers "not found" for

    function workspaceRoot() {
        let w = 'Default';
        try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return `/Workspaces/${w}`;
    }

    function sources() {
        const out = [];
        const L = library();
        if (L && typeof L.volumes === 'function') {
            let vols = [];
            try { vols = JSON.parse(L.volumes() || '[]'); } catch (_) { vols = []; }
            let cards = 0;
            const removable = vols.filter((v) => v.removable).length;
            vols.forEach((v) => {
                if ((v.state && !/^mounted/.test(v.state)) || unindexed.has(v.id)) return;
                if (v.primary) out.push({ id: `android:${v.id}`, label: 'My Device', icon: 'wmp-home', kind: 'android', volume: v.id });
                else {
                    cards += 1;
                    out.push({ id: `android:${v.id}`, label: removable > 1 ? `Storage Card ${cards}` : 'Storage Card', icon: 'fe-storage-card', kind: 'android', volume: v.id });
                }
            });
        }
        const ws0 = workspaceRoot().split('/').pop();
        out.push({ id: 'vfs', label: out.length ? `${ws0} on Dreamscape` : 'My Device', icon: out.length ? 'wmp-folder' : 'wmp-home', kind: 'vfs' });
        return out;
    }

    function currentSource() {
        const all = sources();
        if (!source) { try { source = localStorage.getItem(SOURCE_KEY); } catch (_) { source = null; } }
        let s = all.find((x) => x.id === source);
        if (!s) { s = all[0]; source = s.id; }
        return s;
    }

    function setSource(id) {
        source = id;
        try { localStorage.setItem(SOURCE_KEY, id); } catch (_) { /* storage off */ }
        libPath = [];
        libSel = 0;
        render();
        ensureLibrary(false).then(() => { if (layer === 'library') render(); });
    }

    function sourceMenu() {
        const cur = currentSource();
        return sources().map((s) => ({ label: s.label, radio: s.id === cur.id, action: () => setSource(s.id) }));
    }

    async function scanVfs() {
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
                    if (!SKIP_DIRS.has(name)) queue.push(`${dir.replace(/\/+$/, '')}/${name}`);
                    continue;
                }
                const kind = AUDIO.test(name) ? 'audio' : VIDEO.test(name) ? 'video' : null;
                if (!kind) continue;
                const folder = dir.split('/').filter(Boolean).pop() || '';
                // no tags are read from the server's files: the folder stands in for the album
                out[kind].push({ name: name.replace(/\.[^.]+$/, ''), file: name, path: `${dir.replace(/\/+$/, '')}/${name}`, fileId: i.targetKind === 'user-file' ? i.targetId || i.id : null, folder, album: folder, kind, src: 'vfs' });
            }
        }
        const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
        out.audio.sort((a, b) => coll.compare(a.name, b.name));
        out.video.sort((a, b) => coll.compare(a.name, b.name));
        return out;
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
        // storage Android's media library does not index (a USB drive): not a library (newer app builds leave it out of volumes())
        if (Array.isArray(d.errors) && d.errors.length && d.errors.every((e) => /not found/i.test(e))) {
            unindexed.add(s.volume);
            throw new Error("This storage isn't in Android's media library.");
        }
        const byId = new Map();
        const audio = (d.songs || []).map((x) => {
            const it = {
                kind: 'audio', src: 'android', id: x.id, volume: s.volume,
                name: x.title || 'Unknown', title: x.title || 'Unknown',
                artist: x.artist || '', albumArtist: x.albumArtist || '', album: x.album || '', albumId: x.albumId,
                genre: x.genre || '', track: x.track || 0, disc: x.disc || 0, year: x.year || 0, composer: x.composer || '',
                duration: (x.duration || 0) / 1000, size: x.size || 0, mime: x.mime || '', path: x.path || '',
                url: `${base}/audio/${vol}/${x.id}`, art: `${base}/cover/${vol}/${x.id}?px=512`, albumArt: x.albumId ? `${base}/album/${vol}/${x.albumId}?px=512` : ''
            };
            byId.set(x.id, it);
            return it;
        });
        const video = (d.videos || []).map((x) => ({
            kind: 'video', src: 'android', id: x.id, volume: s.volume, name: x.title || 'Video', title: x.title || 'Video',
            artist: x.artist || '', folder: x.folder || '', duration: (x.duration || 0) / 1000, size: x.size || 0, mime: x.mime || '',
            path: x.path || '', width: x.width || 0, height: x.height || 0,
            url: `${base}/video/${vol}/${x.id}`, poster: `${base}/video/${vol}/${x.id}?thumb=480`
        }));
        const playlists = (d.playlists || []).map((p) => ({ name: p.name || 'Playlist', items: (p.songs || []).map((id) => byId.get(id)).filter(Boolean) }));
        return { audio, video, playlists };
    }

    function ensureLibrary(force) {
        const s = currentSource();
        if (libs.has(s.id) && !force) return Promise.resolve(libs.get(s.id));
        if (scans.has(s.id)) return scans.get(s.id);
        const run = ws.busy(s.kind === 'android' ? scanAndroid(s) : scanVfs(), { paint: true, timeout: 60000 }).then((r) => { libs.set(s.id, r); return r; }).catch((err) => {
            ws.notify({ title: 'Melaton Media', icon: 'error', text: (err && err.message) || 'The library could not be updated.' });
            const r = libs.get(s.id) || { audio: [], video: [], playlists: [] };
            libs.set(s.id, r);
            return r;
        }).finally(() => { scans.delete(s.id); });
        scans.set(s.id, run);
        return run;
    }

    // the answer to Android's "Allow Melaton Media to access music and audio?"
    window.addEventListener('dreamscape:medialib', (e) => {
        const d = (e && e.detail) || {};
        if (d.type !== 'access') return;
        sources().filter((s) => s.kind === 'android').forEach((s) => libs.delete(s.id));
        if (d.granted && page) ensureLibrary(true).then(() => { if (layer === 'library') render(); });
        else if (!d.granted) ws.notify({ title: 'Melaton Media', icon: 'info', text: 'Melaton Media cannot show your music and videos without permission. Allow it in Android Settings > Apps > Dreamscape > Permissions.' });
    });

    function askAccess() {
        const L = library();
        if (L && typeof L.requestAccess === 'function') { try { L.requestAccess(); } catch (_) { /* bridge gone */ } }
    }

    const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const UNKNOWN = { artist: 'Unknown Artist', album: 'Unknown Album', genre: 'Unknown Genre' };
    const GROUP_ICON = { artist: 'wmp-artist', album: 'wmp-disc', genre: 'wmp-genre' };
    const keyOf = (it, by) => (by === 'artist' ? it.artist || it.albumArtist : by === 'album' ? it.album : it.genre) || '';
    const byTrack = (a, b) => ((a.disc || 0) - (b.disc || 0)) || ((a.track || 0) - (b.track || 0)) || coll.compare(a.name, b.name);

    /** Songs grouped by artist / album / genre: [{ key, label, items }] sorted, unknown last. */
    function groups(audio, by) {
        const m = new Map();
        audio.forEach((it) => {
            const k = keyOf(it, by);
            if (!m.has(k)) m.set(k, []);
            m.get(k).push(it);
        });
        return [...m.entries()].map(([k, items]) => ({ key: k, label: k || UNKNOWN[by], items: by === 'album' ? items.slice().sort(byTrack) : items }))
            .sort((a, b) => (a.key ? 0 : 1) - (b.key ? 0 : 1) || coll.compare(a.label, b.label));
    }

    /** The rows of the open Library level: { label, icon, open?, item?, items?, ask? }. */
    function libRows() {
        const [cat, sub, arg] = libPath;
        const s = currentSource();
        const L = libs.get(s.id) || { audio: [], video: [], playlists: [] };
        const file = (it) => ({ label: it.name, icon: it.kind === 'video' ? 'wmp-video' : 'wmp-music', item: it });
        if (L.needsAccess && cat && cat !== 'tv') {
            return [{ label: 'Allow access to music and videos...', icon: 'wmp-properties', ask: true }];
        }
        if (!cat) {
            return [
                { label: 'My Music', icon: 'wmp-music', open: ['music'] },
                { label: 'My Videos', icon: 'wmp-video', open: ['video'] },
                { label: 'My TV', icon: 'wmp-tv', open: ['tv'] },
                { label: 'My Playlists', icon: 'wmp-playlist', open: ['playlists'] },
                { label: 'Now Playing', icon: 'wmp-play', queue: true }
            ];
        }
        if (cat === 'music' && !sub) {
            return [
                { label: 'All Music', icon: 'wmp-music', open: ['music', 'all'], items: L.audio },
                { label: 'Artist', icon: 'wmp-artist', open: ['music', 'artist'], items: L.audio },
                { label: 'Album', icon: 'wmp-disc', open: ['music', 'album'], items: L.audio },
                { label: 'Genre', icon: 'wmp-genre', open: ['music', 'genre'], items: L.audio }
            ];
        }
        if (cat === 'music' && sub === 'all') return L.audio.map(file);
        if (cat === 'music' && GROUP_ICON[sub]) {
            const g = groups(L.audio, sub);
            if (arg == null) return g.map((x) => ({ label: x.label, icon: GROUP_ICON[sub], open: ['music', sub, x.key], items: x.items }));
            const hit = g.find((x) => x.key === arg);
            return hit ? hit.items.map(file) : [];
        }
        if (cat === 'video') return L.video.map(file);
        if (cat === 'playlists') {
            if (sub == null) return (L.playlists || []).map((p, i) => ({ label: p.name, icon: 'wmp-playlist', open: ['playlists', String(i)], items: p.items }));
            const p = (L.playlists || [])[Number(sub)];
            return p ? p.items.map(file) : [];
        }
        return [];
    }

    function libTitle() {
        const [cat, sub, arg] = libPath;
        if (!cat) { const s = currentSource(); return { label: s.label, icon: s.icon }; }
        if (cat === 'music') {
            if (!sub) return { label: 'My Music', icon: 'wmp-music' };
            if (sub === 'all') return { label: 'All Music', icon: 'wmp-music' };
            const label = sub === 'artist' ? 'Artist' : sub === 'album' ? 'Album' : 'Genre';
            return { label: arg == null ? label : arg || UNKNOWN[sub], icon: GROUP_ICON[sub] };
        }
        if (cat === 'video') return { label: 'My Videos', icon: 'wmp-video' };
        if (cat === 'tv') return { label: 'My TV', icon: 'wmp-tv' };
        if (sub != null) {
            const L = libs.get(currentSource().id);
            const p = L && L.playlists && L.playlists[Number(sub)];
            return { label: p ? p.name : 'My Playlists', icon: 'wmp-playlist' };
        }
        return { label: 'My Playlists', icon: 'wmp-playlist' };
    }

    function rowItems(r) {
        if (!r) return [];
        if (r.item) return [r.item];
        if (r.items) return r.items;
        return [];
    }

    // ---------------------------------------------------------------- painting

    const u = (n) => `calc(${n} * var(--wmp-u))`;
    const box = (r) => `left:${u(r[0])};top:${u(r[1])};width:${u(r[2])};height:${u(r[3])}`;

    function fmtTime(s) {
        if (!Number.isFinite(s) || s < 0) s = 0;
        const m = Math.floor(s / 60);
        const ss = Math.floor(s % 60);
        return `${pad(m)}:${pad(ss)}`;
    }
    const pad = (n) => String(n).padStart(2, '0');

    /**
     * The skin in this screen's shape: a portrait screen taller than the skin's 480x536 gives the extra
     * height to the album art (the background's gradient above the control bar stretches with it) and
     * the control bar stays at the bottom, instead of an empty band under the skin.
     */
    let skinExtra = 0;
    const BAR_TOP = 396; // portrait: the control bar's top edge in the background (VGA units)
    function skinLayout() {
        const L = LAYOUT[orient];
        if (orient !== 'portrait' || !skinExtra) return L;
        const d = skinExtra;
        const down = (r) => [r[0], r[1] + d].concat(r.slice(2));
        const buttons = {};
        Object.entries(L.buttons).forEach(([k, b]) => { buttons[k] = down(b); });
        return { ...L, size: [L.size[0], L.size[1] + d], art: [L.art[0], L.art[1], L.art[2], L.art[3] + d], time: down(L.time), vol: down(L.vol), seek: down(L.seek), buttons };
    }

    function skinHtml() {
        const L = skinLayout();
        const btn = (k) => {
            const b = L.buttons[k];
            return `<button type="button" class="wmp-btn" data-b="${k}" style="${box(b)};--px:${u(-b[4])};--px2:${u(-(b[5] || b[4]))};--px3:${u(-(b[6] || b[4]))}" aria-label="${k}"></button>`;
        };
        const stretch = orient === 'portrait' && skinExtra ? `;--wmp-extra:${skinExtra};--wmp-bar:${BAR_TOP}` : '';
        return `<div class="wmp-skin is-${orient}${stretch ? ' is-stretched' : ''}" style="width:${u(L.size[0])};height:${u(L.size[1])}${stretch};--bg:image-set(url('${SKIN}${L.bg}.png') 1x, url('${SKIN}${L.bg}@2x.png') 2x);--pushed:image-set(url('${SKIN}${L.pushed}.png') 1x, url('${SKIN}${L.pushed}@2x.png') 2x);--pw:${u(PUSHED_W[orient][0])};--ph:${u(PUSHED_W[orient][1])};--disabled:image-set(url('${SKIN}${L.disabled}.png') 1x, url('${SKIN}${L.disabled}@2x.png') 2x);--dw:${u(DISABLED_W[orient][0])};--dh:${u(DISABLED_W[orient][1])}">
            <div class="wmp-art" style="${box(L.art)}"></div>
            <div class="wmp-marquee" style="${box(L.marquee)};font-size:${u(L.marquee[4])}"></div>
            <div class="wmp-status" style="${box(L.status)};font-size:${u(L.status[4])}"></div>
            <div class="wmp-ratings" style="${box(L.ratings)};--rw:${u(918)};background-image:image-set(url('${SKIN}ratings.png') 1x, url('${SKIN}ratings@2x.png') 2x)"></div>
            <div class="wmp-time" style="${box(L.time)};font-size:${u(21.3)}">00:00</div>
            <div class="wmp-vol" style="${box(L.vol)};font-size:${u(21.3)}">70%</div>
            <div class="wmp-seek" style="${box(L.seek)}"><span class="wmp-thumb" style="width:${u(40)};height:${u(20)};--tw:${u(120)};background-image:image-set(url('${SKIN}seek-thumb.png') 1x, url('${SKIN}seek-thumb@2x.png') 2x)"></span></div>
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
        // portrait on a tall screen: the skin fills the height too (skinLayout)
        const extra = o === 'portrait' ? Math.max(0, Math.floor(h / unit - L.size[1])) : 0;
        host.style.setProperty('--wmp-u', `${unit}px`);
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

    function paintSkin() {
        changed();
        if (!page) return;
        const skin = page.querySelector('.wmp-skin');
        if (!skin) return;
        const it = current();
        const v = media.el;
        const art = skin.querySelector('.wmp-art');
        const a = androidMode();
        androidClock(!!(a && a.state === 'playing'));
        skin.classList.toggle('is-android', !!a);
        if (a) {
            // something else plays on the phone: Now Playing is its remote (#801)
            skin.querySelector('.wmp-marquee').textContent = [a.title, a.artist].filter(Boolean).join(' - ') || a.app || '';
            const st = { playing: 'Playing', paused: 'Paused', buffering: 'Buffering...', stopped: 'Stopped', error: 'Error' }[a.state] || 'Ready';
            skin.querySelector('.wmp-status').textContent = a.app ? `${st} (${a.app})` : st;
            if (v && v.parentNode) v.remove();
            setCover(art, androidArt(a), '');
            const can = (x) => !a.actions || a.actions.includes(x);
            const playingA = a.state === 'playing' || a.state === 'buffering';
            skin.querySelectorAll('.wmp-btn').forEach((b) => {
                const k = b.dataset.b;
                const dis = k === 'full' || (k === 'prev' && !can('previous')) || (k === 'next' && !can('next')) || (k === 'play' && !(can('play') || can('pause')));
                b.disabled = dis;
                b.classList.toggle('is-disabled', dis);
                b.classList.toggle('is-pause', k === 'play' && playingA);
                b.classList.toggle('is-on', k === 'mute' && media.muted);
            });
            skin.querySelector('.wmp-vol').textContent = `${media.volume}%`;
            skin.querySelector('.wmp-ratings').hidden = ws.version === '6.5';
            paintTime();
            return;
        }
        skin.querySelector('.wmp-marquee').textContent = it ? (it.artist && it.src === 'android' ? `${it.name} - ${it.artist}` : it.name) : '';
        skin.querySelector('.wmp-status').textContent = it ? media.status : '';
        // video plays in the album-art rectangle; music shows its album art there (the phone's library)
        if (v && it && it.kind === 'video') { setCover(art, '', ''); if (v.parentNode !== art) art.appendChild(v); } else {
            if (v && v.parentNode) v.remove();
            setCover(art, it && it.kind === 'audio' ? it.art || '' : '', it && it.albumArt || '');
        }
        const empty = !media.queue.length;
        const playing = !!(v && !v.paused && !v.ended);
        skin.querySelectorAll('.wmp-btn').forEach((b) => {
            const k = b.dataset.b;
            const dis = (empty && (k === 'play' || k === 'prev' || k === 'next')) || (k === 'full' && !(it && it.kind === 'video'));
            b.disabled = dis;
            b.classList.toggle('is-disabled', dis);
            b.classList.toggle('is-pause', k === 'play' && playing);
            b.classList.toggle('is-on', k === 'mute' && media.muted);
        });
        skin.querySelector('.wmp-vol').textContent = `${media.volume}%`;
        // 6.5 (as the device with nothing queued): the rating stars only show for a queued item
        skin.querySelector('.wmp-ratings').hidden = !it && ws.version === '6.5';
        paintTime();
    }

    /** The album art picture in the art rectangle: url, then fallback, else empty. */
    function setCover(art, url, fallback) {
        let img = art.querySelector('.wmp-cover');
        if (!url) { if (img) img.remove(); return; }
        if (!img) {
            img = document.createElement('img');
            img.className = 'wmp-cover';
            img.alt = '';
            img.decoding = 'async';
            img.addEventListener('error', () => {
                const fb = img.dataset.fallback;
                if (fb && img.getAttribute('src') !== fb) img.src = fb; else img.hidden = true;
            });
            art.prepend(img);
        }
        img.dataset.fallback = fallback || '';
        if (img.getAttribute('src') !== url && img.dataset.want !== url) { img.dataset.want = url; img.hidden = false; img.src = url; }
    }

    function paintTime() {
        if (!page) return;
        const skin = page.querySelector('.wmp-skin');
        if (!skin) return;
        const v = media.el;
        const a = androidMode();
        const t = a ? androidPosition(a) : v ? v.currentTime : 0;
        const d = a ? (a.duration || 0) / 1000 : v && Number.isFinite(v.duration) ? v.duration : 0;
        skin.querySelector('.wmp-time').textContent = fmtTime(t);
        const seek = skin.querySelector('.wmp-seek');
        seek.style.setProperty('--p', d ? Math.min(1, t / d) : 0);
        seek.classList.toggle('is-disabled', !d);
    }

    function renderLibrary() {
        const head = page.querySelector('.wmp-lhead');
        const t = libTitle();
        head.innerHTML = `<button type="button" class="wmp-lsel" aria-haspopup="menu">${ws.art.img(t.icon)}<span>${ws.escapeHtml(t.label)}</span><span class="wmp-larrow"></span></button>
            <button type="button" class="wmp-lback">${ws.art.img('wmp-back')}<span>Back</span></button>`;
        const rows = libRows();
        if (libSel >= rows.length) libSel = 0;
        const list = page.querySelector('.wmp-llist');
        list.innerHTML = rows.length ? rows.map((r, i) => `<div class="wmp-lrow${i === libSel ? ' is-selected' : ''}" data-i="${i}">${ws.art.img(r.icon)}<span>${ws.escapeHtml(r.label)}</span></div>`).join('')
            : '';
    }

    function renderQueue() {
        if (queueSel >= media.queue.length) queueSel = Math.max(0, media.queue.length - 1);
        page.querySelector('.wmp-qlist').innerHTML = media.queue.map((it, i) => `<div class="wmp-lrow${i === queueSel ? ' is-selected' : ''}${i === media.index ? ' is-current' : ''}" data-i="${i}">${ws.art.img(it.kind === 'video' ? 'wmp-video' : 'wmp-music')}<span>${ws.escapeHtml(it.name)}</span></div>`).join('');
        const has = media.queue.length > 0;
        page.querySelectorAll('.wmp-qtool').forEach((b) => {
            const k = b.dataset.t;
            b.disabled = k === 'add' ? false : !has || (k === 'up' && queueSel === 0) || (k === 'down' && queueSel >= media.queue.length - 1);
        });
    }

    function render() {
        if (!page) return;
        page.dataset.layer = layer;
        if (layer === 'skin') { fitSkin(); paintSkin(); } else if (layer === 'library') renderLibrary(); else if (layer === 'options') renderOptions(); else renderQueue();
        ws.refreshSoftKeys();
        ws.refreshTitleAction();
    }

    // ---------------------------------------------------------------- actions

    function openLibrary() {
        layer = 'library';
        libPath = [];
        libSel = 0;
        render();
        ws.syncHistory();
        ensureLibrary(false).then(() => { if (layer === 'library') render(); });
    }

    // ---------------------------------------------------------------- Options

    /** Options...: which programs' playing Now Playing (and Today's Music item) may show. */
    function openOptions() {
        const A = window.wmMediaApps;
        optsDraft = new Set(A && A.hidden ? A.hidden() : []);
        layer = 'options';
        render();
        ws.syncHistory();
    }

    function renderOptions() {
        const box = page.querySelector('.wmp-opts');
        const A = window.wmMediaApps;
        const ui = window.wmSettings && window.wmSettings.ui;
        const choices = A && A.choices ? A.choices() : [];
        const esc = ws.escapeHtml;
        const rows = choices.map(([pkg, label]) => (ui ? ui.check('wmp-show', label, !optsDraft.has(pkg), `value="${esc(pkg)}"`)
            : `<label class="wm-check"><input type="checkbox" name="wmp-show" value="${esc(pkg)}"${optsDraft.has(pkg) ? '' : ' checked'}><span>${esc(label)}</span></label>`)).join('');
        box.innerHTML = `<div class="wm-form-sub">Now Playing</div>
            <p>When Melaton Media is not playing, Now Playing shows what these programs play:</p>
            ${choices.length ? `<div class="wmp-opts-list">${rows}</div>` : '<p class="wm-form-note">No programs have played anything yet.</p>'}
            <p class="wm-form-note">Clear video players and streaming apps to keep them off Now Playing and the Today screen's Music item.</p>`;
        box.querySelectorAll('input[name="wmp-show"]').forEach((c) => c.addEventListener('change', () => { if (c.checked) optsDraft.delete(c.value); else optsDraft.add(c.value); }));
    }

    function keepOptions() {
        const A = window.wmMediaApps;
        if (A && A.setHidden && optsDraft) A.setHidden([...optsDraft]);
        optsDraft = null;
        layer = 'skin';
        render();
    }

    function saveOptions() {
        keepOptions();
        ws.syncHistory();
    }

    function openQueue() {
        layer = 'queue';
        queueSel = Math.max(0, media.index);
        render();
        ws.syncHistory();
    }

    function libOpen(i) {
        const r = libRows()[i];
        if (!r) return;
        if (r.queue) { openQueue(); return; }
        if (r.ask) { askAccess(); return; }
        if (r.open) { libPath = r.open; libSel = 0; render(); ws.syncHistory(); return; }
        if (r.item) playFrom(i);
    }

    /** Play: the selected file (and what follows it in the list), or everything under the selected row. */
    function playFrom(i) {
        const rows = libRows();
        const r = rows[i];
        if (!r) return;
        if (r.item) {
            const files = rows.filter((x) => x.item).map((x) => x.item);
            const at = files.indexOf(r.item);
            media.queue = [];
            enqueue(files.slice(at).concat(files.slice(0, at)), true);
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
        ws.notify({ title: 'Melaton Media', icon: 'info', text: `${items.length === 1 ? items[0].name : `${items.length} items`} added to Now Playing.` });
    }

    async function openFile() {
        if (!window.wmFileDialogs || typeof window.wmFileDialogs.open !== 'function') {
            ws.notify({ title: 'Melaton Media', icon: 'info', text: 'Open a media file from File Explorer.' });
            return;
        }
        await window.wmFileDialogs.open({
            title: 'Open',
            appTitle: 'Melaton Media',
            typeLabel: 'Media files',
            accept: (i) => AUDIO.test(i.name || '') || VIDEO.test(i.name || ''),
            onPick: async (item, dir) => {
                const name = item.name || '';
                const path = `${String(dir || workspaceRoot()).replace(/\/+$/, '')}/${name}`;
                // the dialog closes first (back to this app), then the file plays
                setTimeout(() => enqueue([{ name: name.replace(/\.[^.]+$/, ''), file: name, path, fileId: item.targetKind === 'user-file' ? item.targetId || item.id : null, kind: VIDEO.test(name) ? 'video' : 'audio' }], true), 0);
                return true;
            }
        });
    }

    async function openUrl() {
        const v = await ws.messageBox({ title: 'Open URL', text: 'URL:', input: { value: 'http://' }, buttons: [{ text: 'ok', value: true }, { text: 'Cancel', value: false }] });
        if (!v || v === true) return;
        let url;
        try { url = new URL(String(v).trim()); } catch (_) { ws.notify({ title: 'Melaton Media', icon: 'error', text: 'That address is not valid.' }); return; }
        if (!/^https?:$/.test(url.protocol)) return;
        const name = decodeURIComponent(url.pathname.split('/').pop() || url.host);
        enqueue([{ name, url: url.href, kind: VIDEO.test(name) ? 'video' : 'audio' }], true);
    }

    function shuffleRepeat() {
        return [
            { label: 'Shuffle', checked: media.shuffle, action: () => { media.shuffle = !media.shuffle; } },
            { label: 'Repeat', checked: media.repeat, action: () => { media.repeat = !media.repeat; } }
        ];
    }

    function fullScreen() {
        const v = media.el;
        const it = current();
        if (!v || !it || it.kind !== 'video') return;
        try { (v.requestFullscreen || v.webkitRequestFullscreen).call(v); } catch (_) { /* not allowed */ }
    }

    function properties(it) {
        if (!it) return;
        const v = media.el;
        const d = it === current() && v && Number.isFinite(v.duration) ? fmtTime(v.duration) : it.duration ? fmtTime(it.duration) : '';
        const lines = [it.name];
        if (it.artist) lines.push(`Artist: ${it.artist}`);
        if (it.album && it.src === 'android') lines.push(`Album: ${it.album}${it.track ? ` (track ${it.track})` : ''}`);
        if (it.genre) lines.push(`Genre: ${it.genre}`);
        if (it.year) lines.push(`Year: ${it.year}`);
        if (d) lines.push(`Length: ${d}`);
        if (it.size) lines.push(`Size: ${it.size >= 1048576 ? `${(it.size / 1048576).toFixed(1)} MB` : `${Math.ceil(it.size / 1024)} KB`}`);
        lines.push(it.src === 'android' ? `${it.volume === 'external_primary' ? 'My Device' : 'Storage Card'}: ${it.path}` : it.path || it.url || '');
        ws.notify({ title: 'Properties', icon: 'info', text: lines.join('\n') });
    }

    function pressButton(k) {
        if ((k === 'play' || k === 'prev' || k === 'next') && androidMode() && androidCommand(k)) return;
        if (k === 'play') playPause();
        else if (k === 'prev') prev();
        else if (k === 'next') next(false);
        else if (k === 'volup') { media.volume = Math.min(100, media.volume + 10); applyVolume(); paintSkin(); }
        else if (k === 'voldown') { media.volume = Math.max(0, media.volume - 10); applyVolume(); paintSkin(); }
        else if (k === 'mute') { media.muted = !media.muted; applyVolume(); paintSkin(); }
        else if (k === 'full') fullScreen();
        else if (k === 'online') openLibrary();
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
    }

    function removeQueue() {
        if (!media.queue.length) return;
        const i = queueSel;
        media.queue.splice(i, 1);
        if (media.index === i) { stop(); if (media.el) media.el.removeAttribute('src'); media.index = -1; } else if (media.index > i) media.index -= 1;
        render();
    }

    function clearQueue() {
        stop();
        if (media.el) { media.el.removeAttribute('src'); media.el.load(); }
        media.queue = [];
        media.index = -1;
        render();
        tellAndroid();
    }

    // ---------------------------------------------------------------- the app

    function mount(p) {
        page = p;
        p.classList.add('wm-media');
        p.innerHTML = `
            <div class="wmp-np"></div>
            <div class="wmp-lib">
                <div class="wmp-lhead"></div>
                <div class="wmp-llist wm-pv-scroll" role="listbox"></div>
            </div>
            <div class="wmp-opts wm-pv-scroll"></div>
            <div class="wmp-queue">
                <div class="wmp-lhead"><span class="wmp-lsel is-static">${ws.art.img('wmp-playlist')}<span>Now Playing</span></span></div>
                <div class="wmp-qlist wm-pv-scroll" role="listbox"></div>
                <div class="wmp-qbar">
                    <button type="button" class="wmp-qtool" data-t="up" aria-label="Move Up">${ws.art.img('wmp-up')}</button>
                    <button type="button" class="wmp-qtool" data-t="down" aria-label="Move Down">${ws.art.img('wmp-down')}</button>
                    <button type="button" class="wmp-qtool" data-t="add" aria-label="Add">${ws.art.img('wmp-add')}</button>
                    <button type="button" class="wmp-qtool" data-t="remove" aria-label="Remove from Playlist">${ws.art.img('wmp-delete')}</button>
                    <button type="button" class="wmp-qtool" data-t="props" aria-label="Properties">${ws.art.img('wmp-properties')}</button>
                </div>
            </div>`;
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
            const b = t.closest('.wmp-btn');
            if (b) { if (!b.disabled) pressButton(b.dataset.b); return; }
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
            if (t.closest('.wmp-lback')) { ws.back(); return; }
            const sel = t.closest('.wmp-lsel:not(.is-static)');
            if (sel) { ws.dropdown(sel, sourceMenu(), 'left'); return; }
            const tool = t.closest('.wmp-qtool');
            if (tool) {
                const k = tool.dataset.t;
                if (k === 'up') moveQueue(-1);
                else if (k === 'down') moveQueue(1);
                else if (k === 'remove') removeQueue();
                else if (k === 'add') openLibrary();
                else if (k === 'props') properties(media.queue[queueSel]);
                return;
            }
            const row = t.closest('.wmp-lrow');
            if (!row) return;
            const i = Number(row.dataset.i);
            if (layer === 'library') {
                if (i === libSel) { libOpen(i); return; }
                libSel = i;
                renderLibrary();
                ws.refreshSoftKeys();
            } else if (layer === 'queue') {
                if (i === queueSel) { playIndex(i); layer = 'skin'; render(); ws.syncHistory(); return; }
                queueSel = i;
                renderQueue();
            }
        });
        try { new ResizeObserver(() => fitSkin()).observe(p); } catch (_) { window.addEventListener('resize', fitSkin); }
    }

    function register() {
        ws = window.wmShell;
        ws.registerApp({
            id: APP_ID,
            title: 'Melaton Media',
            startLabel: 'Melaton Media',
            icon: 'app-windows-media',
            inStart: 'programs',
            sip: true,
            mount,
            show() {
                // the first open with nothing to play starts in the Library, as the device's first run
                if (!media.queue.length && layer === 'skin' && !libs.has(currentSource().id) && !androidMode()) { openLibrary(); return; }
                render();
            },
            // Options has its own Done / Cancel soft keys: no corner button there
            titleKind: () => (layer === 'skin' ? 'close' : layer === 'options' ? null : 'ok'),
            historyDepth: () => (layer === 'skin' ? 0 : layer === 'queue' || layer === 'options' ? 1 : 1 + libPath.length),
            onBack() {
                // the back key keeps the page, as ok and back do on every WM settings page; only Cancel drops it
                if (layer === 'options') { keepOptions(); return true; }
                if (layer === 'library' && libPath.length) { libPath = libPath.slice(0, -1); libSel = 0; render(); return true; }
                if (layer !== 'skin') { layer = 'skin'; render(); return true; }
                return false;
            },
            softKeys() {
                if (layer === 'options') {
                    return {
                        left: { label: 'Done', action: saveOptions },
                        right: { label: 'Cancel', action: () => { optsDraft = null; layer = 'skin'; render(); ws.syncHistory(); } }
                    };
                }
                if (layer === 'skin') {
                    const it = current();
                    return {
                        left: { label: 'Now Playing', action: openQueue },
                        right: { label: 'Menu', menu: () => [
                            { label: 'Library...', action: openLibrary }, '-',
                            { label: 'Play/Pause', action: playPause, disabled: !media.queue.length },
                            { label: 'Stop', action: stop, disabled: !media.el || !media.el.getAttribute('src') },
                            { label: 'Shuffle/Repeat', submenu: shuffleRepeat() },
                            { label: 'Full Screen', action: fullScreen, disabled: !(it && it.kind === 'video') }, '-',
                            { label: 'Options...', action: openOptions, disabled: !window.wmMediaApps },
                            { label: 'Properties', action: () => properties(it), disabled: !it }, '-',
                            { label: 'About', action: () => ws.notify({ title: 'Melaton Media', icon: 'info', text: 'Melaton Media Player 10 Mobile\nCopyright (c) 2006 Xyridian Corporation. All rights reserved.' }) }
                        ] }
                    };
                }
                if (layer === 'queue') {
                    const has = media.queue.length > 0;
                    return {
                        left: { label: 'Play', action: () => { if (has) { playIndex(queueSel); layer = 'skin'; render(); ws.syncHistory(); } }, disabled: !has },
                        right: { label: 'Menu', menu: () => [
                            { label: 'Library...', action: openLibrary }, '-',
                            { label: 'Move Up', action: () => moveQueue(-1), disabled: !has || queueSel === 0 },
                            { label: 'Move Down', action: () => moveQueue(1), disabled: !has || queueSel >= media.queue.length - 1 },
                            { label: 'Remove from Playlist', action: removeQueue, disabled: !has },
                            { label: 'Shuffle/Repeat', submenu: shuffleRepeat() }, '-',
                            { label: 'Save Playlist...', disabled: true },
                            { label: 'Clear Now Playing', action: clearQueue, disabled: !has }, '-',
                            { label: 'Error Details', action: () => ws.notify({ title: 'Melaton Media', icon: 'error', text: media.error }), disabled: !media.error },
                            { label: 'Properties', action: () => properties(media.queue[queueSel]), disabled: !has }
                        ] }
                    };
                }
                const r = libRows()[libSel];
                const playable = rowItems(r).length > 0;
                return {
                    left: { label: 'Play', action: () => playFrom(libSel), disabled: !playable },
                    right: { label: 'Menu', menu: () => [
                        { label: 'Queue Up', action: queueUp, disabled: !playable },
                        { label: 'Delete from Library', disabled: true }, '-',
                        { label: 'Now Playing', action: openQueue },
                        { label: 'Library', submenu: sourceMenu() },
                        { label: 'Update Library...', action: () => ensureLibrary(true).then(render) },
                        { label: 'Open File...', action: openFile },
                        { label: 'Open URL...', action: openUrl }, '-',
                        { label: 'Properties', action: () => properties(r && r.item), disabled: !(r && r.item) }
                    ] }
                };
            }
        });
    }

    /** Play All Songs (the 6.5 Music panel): every song of the library from the first, in the background. */
    async function playAll() {
        const L = await ensureLibrary(false);
        if (!L.audio.length) return false;
        media.queue = [];
        media.index = -1;
        enqueue(L.audio, true);
        return true;
    }

    window.wmMedia = {
        enqueue: (items, play) => enqueue(items, play),
        state: () => ({ layer, libPath, queue: media.queue.length, index: media.index, status: media.status, orient }),
        // what plays, for the Music panel: null with nothing queued; artist = the tag (phone library) or the song's folder (server files)
        now: () => {
            const it = current();
            if (!it) return null;
            const v = media.el;
            return { title: it.name, artist: it.artist || (it.kind === 'audio' ? it.folder || '' : ''), art: it.kind === 'audio' ? it.art || '' : '', albumArt: it.kind === 'audio' ? it.albumArt || '' : '', playing: !!(v && !v.paused && !v.ended), status: media.status, index: media.index, count: media.queue.length };
        },
        playPause: () => playPause(),
        next: () => next(false),
        previous: () => prev(),
        playAll
    };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
