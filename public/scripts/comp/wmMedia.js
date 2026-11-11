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
    let layer = 'skin'; // 'skin' | 'library' | 'queue'
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
        v.addEventListener('durationchange', paintTime);
        v.addEventListener('play', () => { media.status = 'Playing'; paintSkin(); });
        v.addEventListener('pause', () => { if (!v.ended) media.status = 'Paused'; paintSkin(); });
        v.addEventListener('waiting', () => { media.status = 'Buffering...'; paintSkin(); });
        v.addEventListener('playing', () => { media.status = 'Playing'; paintSkin(); });
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

    // ---------------------------------------------------------------- the library (VFS scan)

    let lib = null; // { audio: [], video: [] }
    let scanning = null;

    function workspaceRoot() {
        let w = 'Default';
        try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) w = activeWorkspace; } catch (_) { /* none */ } // eslint-disable-line no-undef
        return `/Workspaces/${w}`;
    }

    async function scan() {
        const V = (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; // eslint-disable-line no-undef
        if (!V) throw new Error('Files are not available.');
        const out = { audio: [], video: [] };
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
                out[kind].push({ name: name.replace(/\.[^.]+$/, ''), file: name, path: `${dir.replace(/\/+$/, '')}/${name}`, fileId: i.targetKind === 'user-file' ? i.targetId || i.id : null, folder, kind });
            }
        }
        const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
        out.audio.sort((a, b) => coll.compare(a.name, b.name));
        out.video.sort((a, b) => coll.compare(a.name, b.name));
        return out;
    }

    function ensureLibrary(force) {
        if (lib && !force) return Promise.resolve(lib);
        if (scanning) return scanning;
        scanning = ws.busy(scan(), { paint: true, timeout: 60000 }).then((r) => { lib = r; return r; }).catch((err) => {
            ws.notify({ title: 'Melaton Media', icon: 'error', text: (err && err.message) || 'The library could not be updated.' });
            lib = lib || { audio: [], video: [] };
            return lib;
        }).finally(() => { scanning = null; });
        return scanning;
    }

    /** The rows of the open Library level: { label, icon, open?, item?, items? }. */
    function libRows() {
        const [cat, sub, arg] = libPath;
        const L = lib || { audio: [], video: [] };
        const file = (it) => ({ label: it.name, icon: it.kind === 'video' ? 'wmp-video' : 'wmp-music', item: it });
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
        if (cat === 'music' && (sub === 'artist' || sub === 'genre')) {
            if (!arg) return L.audio.length ? [{ label: sub === 'artist' ? 'Unknown Artist' : 'Unknown Genre', icon: sub === 'artist' ? 'wmp-artist' : 'wmp-genre', open: ['music', sub, 'unknown'], items: L.audio }] : [];
            return L.audio.map(file);
        }
        if (cat === 'music' && sub === 'album') {
            if (!arg) {
                const folders = [...new Set(L.audio.map((a) => a.folder))];
                return folders.map((f) => ({ label: f, icon: 'wmp-disc', open: ['music', 'album', f], items: L.audio.filter((a) => a.folder === f) }));
            }
            return L.audio.filter((a) => a.folder === arg).map(file);
        }
        if (cat === 'video') return L.video.map(file);
        return [];
    }

    function libTitle() {
        const [cat, sub, arg] = libPath;
        if (!cat) return { label: 'Library', icon: 'wmp-search' };
        if (cat === 'music') {
            if (!sub) return { label: 'My Music', icon: 'wmp-music' };
            if (sub === 'all') return { label: 'All Music', icon: 'wmp-music' };
            if (sub === 'album') return { label: arg || 'Album', icon: 'wmp-disc' };
            if (sub === 'artist') return { label: arg ? 'Unknown Artist' : 'Artist', icon: 'wmp-artist' };
            return { label: arg ? 'Unknown Genre' : 'Genre', icon: 'wmp-genre' };
        }
        if (cat === 'video') return { label: 'My Videos', icon: 'wmp-video' };
        if (cat === 'tv') return { label: 'My TV', icon: 'wmp-tv' };
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

    function skinHtml() {
        const L = LAYOUT[orient];
        const btn = (k) => {
            const b = L.buttons[k];
            return `<button type="button" class="wmp-btn" data-b="${k}" style="${box(b)};--px:${u(-b[4])};--px2:${u(-(b[5] || b[4]))};--px3:${u(-(b[6] || b[4]))}" aria-label="${k}"></button>`;
        };
        return `<div class="wmp-skin is-${orient}" style="width:${u(L.size[0])};height:${u(L.size[1])};--bg:image-set(url('${SKIN}${L.bg}.png') 1x, url('${SKIN}${L.bg}@2x.png') 2x);--pushed:image-set(url('${SKIN}${L.pushed}.png') 1x, url('${SKIN}${L.pushed}@2x.png') 2x);--pw:${u(PUSHED_W[orient][0])};--ph:${u(PUSHED_W[orient][1])};--disabled:image-set(url('${SKIN}${L.disabled}.png') 1x, url('${SKIN}${L.disabled}@2x.png') 2x);--dw:${u(DISABLED_W[orient][0])};--dh:${u(DISABLED_W[orient][1])}">
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
        host.style.setProperty('--wmp-u', `${unit}px`);
        if (o !== orient || !host.querySelector('.wmp-skin')) {
            orient = o;
            host.innerHTML = skinHtml();
            paintSkin();
        }
    }

    function current() { return media.queue[media.index] || null; }

    function paintSkin() {
        if (!page) return;
        const skin = page.querySelector('.wmp-skin');
        if (!skin) return;
        const it = current();
        const v = media.el;
        skin.querySelector('.wmp-marquee').textContent = it ? it.name : '';
        skin.querySelector('.wmp-status').textContent = it ? media.status : '';
        const art = skin.querySelector('.wmp-art');
        // video plays in the album-art rectangle; music shows nothing there (no art is read)
        if (v && it && it.kind === 'video') { if (v.parentNode !== art) art.appendChild(v); } else if (v && v.parentNode) v.remove();
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

    function paintTime() {
        if (!page) return;
        const skin = page.querySelector('.wmp-skin');
        if (!skin) return;
        const v = media.el;
        const t = v ? v.currentTime : 0;
        const d = v && Number.isFinite(v.duration) ? v.duration : 0;
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
        if (layer === 'skin') { fitSkin(); paintSkin(); } else if (layer === 'library') renderLibrary(); else renderQueue();
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
        const d = it === current() && v && Number.isFinite(v.duration) ? fmtTime(v.duration) : '';
        ws.notify({ title: 'Properties', icon: 'info', text: `${it.name}\n${it.path || it.url || ''}${d ? `\nLength: ${d}` : ''}` });
    }

    function pressButton(k) {
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
            if (seek && media.el && Number.isFinite(media.el.duration)) {
                const r = seek.getBoundingClientRect();
                media.el.currentTime = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * media.el.duration;
                return;
            }
            if (t.closest('.wmp-lback')) { ws.back(); return; }
            const sel = t.closest('.wmp-lsel:not(.is-static)');
            if (sel) { ws.dropdown(sel, [{ label: 'My Device', radio: true, action: () => { libPath = []; render(); } }], 'left'); return; }
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
                if (!media.queue.length && layer === 'skin' && !lib) { openLibrary(); return; }
                render();
            },
            titleKind: () => (layer === 'skin' ? 'close' : 'ok'),
            historyDepth: () => (layer === 'skin' ? 0 : layer === 'queue' ? 1 : 1 + libPath.length),
            onBack() {
                if (layer === 'library' && libPath.length) { libPath = libPath.slice(0, -1); libSel = 0; render(); return true; }
                if (layer !== 'skin') { layer = 'skin'; render(); return true; }
                return false;
            },
            softKeys() {
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
                            { label: 'Options...', disabled: true },
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
                        { label: 'Library', submenu: [{ label: 'My Device', radio: true, action: () => { libPath = []; render(); } }] },
                        { label: 'Update Library...', action: () => ensureLibrary(true).then(render) },
                        { label: 'Open File...', action: openFile },
                        { label: 'Open URL...', action: openUrl }, '-',
                        { label: 'Properties', action: () => properties(r && r.item), disabled: !(r && r.item) }
                    ] }
                };
            }
        });
    }

    window.wmMedia = { enqueue: (items, play) => enqueue(items, play), state: () => ({ layer, libPath, queue: media.queue.length, index: media.index, status: media.status, orient }) };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
