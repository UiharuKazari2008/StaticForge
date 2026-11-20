// Melaton Media Player: Windows Media Player 11 on the Vista desktop (Yozora #454).
// public/scripts/comp/desktop-apps/mediaPlayer.js
//
// One window replaces the Music and Video players, built 1:1 after Windows Media Player 11
// on the Vista VM (wmplayer.exe, art ripped from wmploc.dll into static_images/vista-wmp/):
//
//   tab strip     navigation orbs, then Now Playing / Library / Rip / Burn / Sync / Online
//                 Stores; the small arrow under a tab opens its menu
//   Now Playing   the stage (video, or album art for music) and the List Pane on the right
//                 (art, rating, title; "Now Playing" with the clear-list X; the playlist)
//   Library       category (Music / Video), breadcrumb and search row, navigation tree
//                 (Playlists / Library), Explorer-style Details list over the VFS
//   transport     the frame glass extended into the client (--window-frame-bottom): seek
//                 line, now-playing thumbnail and
//                 title, elapsed time, the blue pill (shuffle, repeat, stop, previous,
//                 play / pause orb, next, mute, volume), full-screen and compact buttons
//
// Playback stays the browser's: streamable files, URLs and VFS items in one playlist.
// Keyboard: WMP's (Ctrl+P play/pause, Ctrl+S stop, Ctrl+B / Ctrl+F previous / next,
// Ctrl+H shuffle, Ctrl+T repeat, Ctrl+O open, Ctrl+U open URL, F7 mute, F8 / F9 volume,
// Alt+Enter full screen). Styles: public/css/desktop-apps/mediaPlayer.css.
//
// openModal, bringModalToFront, closeModal, restoreMinimizedModal, getOrCreateTaskbarItem:
//   public/scripts/comp/modalUtils.js
// vfsClient.listDirectory, getBasePath, downloadFile, downloadSystemFile:
//   public/scripts/comp/vfsClient.js
// GET /{vfsPathUuid}/fs/read returns raw bytes (no transcode):
//   modules/vfsFuseHttp.js
// contextMenu.attachClickMenuToElement / attachToElement: public/scripts/comp/contextMenu.js

const DESKTOP_MEDIA_ASSIST = 'Media Player cannot play the file. The Player might not support the file type or might not support the codec that was used to compress the file.';

const DESKTOP_AUDIO_STREAMS = [
    { ext: 'mp3', probe: 'audio/mpeg', mimes: ['audio/mpeg', 'audio/mp3'] },
    { ext: 'ogg', probe: 'audio/ogg', mimes: ['audio/ogg', 'application/ogg'] },
    { ext: 'wav', probe: 'audio/wav', mimes: ['audio/wav', 'audio/wave', 'audio/x-wav'] },
    { ext: 'aac', probe: 'audio/aac', mimes: ['audio/aac', 'audio/x-aac'] },
    { ext: 'm4a', probe: 'audio/mp4', mimes: ['audio/mp4', 'audio/x-m4a', 'audio/m4a'] },
    { ext: 'flac', probe: 'audio/flac', mimes: ['audio/flac', 'audio/x-flac'] }
];

const DESKTOP_VIDEO_STREAMS = [
    { ext: 'mp4', probe: 'video/mp4', mimes: ['video/mp4'] },
    { ext: 'webm', probe: 'video/webm', mimes: ['video/webm'] },
    { ext: 'ogg', probe: 'video/ogg', mimes: ['video/ogg'] }
];

function desktopMediaExtension(name) {
    const clean = String(name || '').split(/[?#]/)[0];
    const slash = Math.max(clean.lastIndexOf('/'), clean.lastIndexOf('\\'));
    const base = slash >= 0 ? clean.slice(slash + 1) : clean;
    const dot = base.lastIndexOf('.');
    if (dot <= 0 || dot === base.length - 1) return '';
    return base.slice(dot + 1).toLowerCase();
}

function desktopMediaCleanMime(mime) {
    return String(mime || '').split(';')[0].trim().toLowerCase();
}

function findDesktopMediaRow(kind, name, mime) {
    const table = kind === 'video' ? DESKTOP_VIDEO_STREAMS : DESKTOP_AUDIO_STREAMS;
    const ext = desktopMediaExtension(name);
    const clean = desktopMediaCleanMime(mime);
    if (clean) {
        for (let i = 0; i < table.length; i++) {
            if (table[i].mimes.indexOf(clean) !== -1) return table[i];
        }
        if (clean.indexOf('audio/') === 0 || clean.indexOf('video/') === 0) return null;
    }
    for (let i = 0; i < table.length; i++) {
        if (table[i].ext === ext) return table[i];
    }
    return null;
}

function desktopMediaNameFromUrl(url) {
    let parsed;
    try {
        parsed = new URL(url, location.href);
    } catch (err) {
        return '';
    }
    const parts = parsed.pathname.split('/').filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : '';
    try {
        return decodeURIComponent(last);
    } catch (err) {
        return last;
    }
}

function desktopMediaClock(seconds) {
    const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
    const hours = Math.floor(safe / 3600);
    const minutes = Math.floor((safe % 3600) / 60);
    const secs = safe % 60;
    const ss = secs < 10 ? '0' + secs : String(secs);
    if (hours > 0) {
        const mm = minutes < 10 ? '0' + minutes : String(minutes);
        return hours + ':' + mm + ':' + ss;
    }
    return minutes + ':' + ss;
}

function joinDesktopVfsPath(dir, name) {
    const base = !dir || dir === '/' ? '' : String(dir).replace(/\/+$/, '');
    return base + '/' + name;
}

function parentDesktopVfsPath(path) {
    const parts = String(path || '/').split('/').filter(Boolean);
    if (!parts.length) return '/';
    parts.pop();
    return parts.length ? '/' + parts.join('/') : '/';
}

function desktopVfsItemIsFolder(item) {
    return item.kind === 'folder' || item.kind === 'dir';
}

function desktopVfsFolderPath(player, item) {
    if (item.navPath) return item.navPath;
    return joinDesktopVfsPath(player.vfsPath, item.name || '');
}

async function desktopMediaVfsUrl(player, item, name) {
    // vfsClient: public/scripts/comp/vfsClient.js
    const base = vfsClient.getBasePath();
    if (base) {
        return base + '/fs/read?path=' + encodeURIComponent(joinDesktopVfsPath(player.vfsPath, name));
    }
    if (item.targetKind === 'user-file' && item.targetId) {
        const resp = await vfsClient.downloadFile(item.targetId);
        return resp && resp.downloadUrl ? resp.downloadUrl : '';
    }
    if (item.systemFileKey) {
        const resp = await vfsClient.downloadSystemFile(item.systemFileKey);
        return resp && resp.downloadUrl ? resp.downloadUrl : '';
    }
    return '';
}


// ---------------------------------------------------------------------------------------
// The player (one window; the helpers above are shared with the old Music / Video slices)
// ---------------------------------------------------------------------------------------

const WMP_ART = '/static_images/vista-wmp';

const WMP_TABS = [
    { id: 'now-playing', label: 'Now Playing' },
    { id: 'library', label: 'Library' },
    { id: 'rip', label: 'Rip' },
    { id: 'burn', label: 'Burn' },
    { id: 'sync', label: 'Sync' },
    { id: 'online-stores', label: 'Online Stores' }
];

// WMP's own words on the tabs this desktop has no hardware for
const WMP_BLANK_PAGES = {
    rip: 'Insert an audio CD into the drive to rip it.',
    burn: 'To burn a disc, insert a blank CD or DVD into the drive.',
    sync: 'Connect a device to this computer to sync.',
    'online-stores': 'No online stores are available.'
};

// Vista's type names for the Library's Type column (HKCR friendly names)
const WMP_TYPE_NAMES = {
    mp3: 'MP3 Format Sound', wav: 'Wave Sound', ogg: 'OGG File', aac: 'AAC File', m4a: 'MPEG-4 Audio',
    flac: 'FLAC Audio', mp4: 'MP4 Video', webm: 'WebM Video', mov: 'QuickTime Movie',
    wma: 'Windows Media Audio file', wmv: 'Windows Media Video file', avi: 'Video Clip', mkv: 'Matroska Video'
};

let desktopMediaPlayer = null;

function mediaPlayerEsc(text) {
    return String(text == null ? '' : text)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** 'video' / 'audio' from the stream tables, '' when neither knows the file. */
function mediaPlayerKindFor(name, mime) {
    if (findDesktopMediaRow('video', name, mime)) return 'video';
    if (findDesktopMediaRow('audio', name, mime)) return 'audio';
    return '';
}

function mediaPlayerCanPlay(media, name, mime) {
    const kind = mediaPlayerKindFor(name, mime);
    if (!kind) return false;
    const row = findDesktopMediaRow(kind, name, mime);
    const clean = desktopMediaCleanMime(mime);
    const probe = clean && row.mimes.indexOf(clean) !== -1 ? clean : row.probe;
    return media.canPlayType(probe) !== '';
}

function mediaPlayerTitle(name) {
    const base = String(name || '');
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(0, dot) : base;
}

function mediaPlayerTypeName(item) {
    const ext = desktopMediaExtension(item.name);
    if (desktopVfsItemIsFolder(item)) return 'File Folder';
    if (ext && WMP_TYPE_NAMES[ext]) return WMP_TYPE_NAMES[ext];
    return ext ? ext.toUpperCase() + ' File' : 'File';
}

/** 11/2/2006 8:24 AM */
function mediaPlayerDate(value) {
    if (!value) return '';
    const d = new Date(typeof value === 'number' && value < 1e12 ? value * 1000 : value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

// ---- markup ----

function mediaPlayerCaptionHtml() {
    return ''
        + '<div class="modal-window-title">'
        + '<div class="modal-window-title-main">'
        + '<i class="fas fa-play icon-fa"></i>'
        + '<img src="/static_images/app_icons/24/media_player.webp" srcset="/static_images/app_icons/24/media_player.webp 1x, /static_images/app_icons/48/media_player.webp 2x" alt="" class="icon-image">'
        + '<span>' + mediaPlayerBar.CAPTION + '</span>'
        + '</div>'
        + '</div>'
        + '<div class="modal-focus-overlay"></div>'
        + '<div class="modal-window-controls">'
        + '<button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize">'
        + '<i class="fa-regular fa-window-minimize"></i>'
        + '</button>'
        + '<button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize">'
        + '<i class="fa-regular fa-window-maximize"></i>'
        + '</button>'
        + '<button type="button" class="btn-danger close-btn btn-small" title="Close">'
        + '<i class="fa-regular fa-xmark-large"></i>'
        + '</button>'
        + '</div>';
}

function mediaPlayerStars() {
    let html = '';
    for (let i = 0; i < 5; i++) html += '<img src="' + WMP_ART + '/star.png" alt="" width="14" height="14">';
    return html;
}

function mediaPlayerBodyHtml() {
    const tabs = WMP_TABS.map((t) => ''
        + '<div class="wmp-tab" data-tab="' + t.id + '" role="tab" aria-selected="false">'
        + '<button type="button" class="wmp-tab-label">' + t.label + '</button>'
        + '<button type="button" class="wmp-tab-menu" title="' + t.label + ' options" aria-label="' + t.label + ' options"></button>'
        + '</div>').join('');
    return ''
        + '<div class="wmp-tabstrip" role="tablist">'
        + '<div class="wmp-orbs">'
        + '<button type="button" class="wmp-orb wmp-orb-back" title="Back" aria-label="Back" disabled></button>'
        + '<button type="button" class="wmp-orb wmp-orb-forward" title="Forward" aria-label="Forward" disabled></button>'
        + '</div>'
        + '<div class="wmp-tabs">' + tabs + '</div>'
        + '</div>'
        + '<div class="wmp-page">'
        // Now Playing
        + '<div class="wmp-view wmp-now-playing" data-view="now-playing">'
        + '<div class="wmp-stage" data-kind="">'
        + '<video preload="metadata" playsinline></video>'
        + '<img class="wmp-stage-art" src="' + WMP_ART + '/art-music.png" alt="">'
        + '<p class="wmp-stage-status hidden"></p>'
        + '</div>'
        + '<div class="wmp-listpane">'
        + '<button type="button" class="wmp-listpane-arrow" title="Hide List Pane" aria-label="Hide List Pane"></button>'
        + '<div class="wmp-listpane-art"><canvas class="wmp-listpane-frame" width="96" height="64"></canvas><img class="wmp-listpane-icon" src="' + WMP_ART + '/art-music.png" alt=""></div>'
        + '<div class="wmp-listpane-stars">' + mediaPlayerStars() + '</div>'
        + '<button type="button" class="wmp-listpane-title"></button>'
        + '<div class="wmp-listpane-head">'
        + '<button type="button" class="wmp-listpane-name">Now Playing</button>'
        + '<button type="button" class="wmp-listpane-clear" title="Clear List" aria-label="Clear List"></button>'
        + '</div>'
        + '<div class="wmp-playlist" role="listbox"></div>'
        + '</div>'
        + '</div>'
        // Library
        + '<div class="wmp-view wmp-library hidden" data-view="library">'
        + '<div class="wmp-addr">'
        + '<button type="button" class="wmp-category" title="Select a category"><img src="' + WMP_ART + '/nav-music.png" alt="" width="16" height="16"></button>'
        + '<div class="wmp-crumbs"></div>'
        + '<div class="wmp-addr-right">'
        + '<button type="button" class="wmp-viewbtn wmp-view-layout" title="Layout Options"></button>'
        + '<button type="button" class="wmp-viewbtn wmp-view-options" title="View Options"></button>'
        + '<div class="wmp-search"><input type="search" placeholder="Search" spellcheck="false" autocomplete="off"><span class="wmp-search-glyph"></span></div>'
        + '<button type="button" class="wmp-listpane-arrow wmp-addr-arrow" title="Now Playing" aria-label="Now Playing"></button>'
        + '</div>'
        + '</div>'
        + '<div class="wmp-library-body">'
        + '<div class="wmp-nav">'
        // the navigation tree: Playlists, Library (its views) and the other libraries (mediaPlayerRenderTree)
        + '<div class="wmp-tree" role="tree"></div>'
        + '</div>'
        + '<div class="wmp-list-host">'
        + '<div class="wmp-list-head"></div>'
        + '<div class="wmp-list" role="listbox"></div>'
        + '<p class="wmp-list-note hidden"></p>'
        + '</div>'
        + '</div>'
        + '</div>'
        // Rip / Burn / Sync / Online Stores
        + '<div class="wmp-view wmp-blank hidden" data-view="blank"><p></p></div>'
        + '</div>'
        // transport (the glass): WMP 11's full-mode bar, laid out in css/desktop-apps/mediaPlayer.css; tooltips as the VM's
        + '<div class="wmp-transport">'
        + '<div class="wmp-seek" title="Seek" role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div class="wmp-seek-fill"></div><div class="wmp-seek-tip"></div><div class="wmp-seek-thumb"></div></div>'
        // the thumbnail, then the title and the elapsed time on one line (a click on the time shows "elapsed / length",
        // the VM's toggle; the title gives way to it)
        + '<div class="wmp-now"><div class="wmp-now-thumb" role="button" tabindex="0" aria-label="Now Playing"><canvas width="33" height="22"></canvas><img src="' + WMP_ART + '/art-music.png" alt=""></div>'
        + '<div class="wmp-nowline"><span class="wmp-now-title"></span><span class="wmp-time" role="button" tabindex="0"></span></div></div>'
        + '<div class="wmp-pill">'
        + '<button type="button" class="wmp-tbtn wmp-shuffle" title="Turn shuffle on" aria-pressed="false"></button>'
        + '<button type="button" class="wmp-tbtn wmp-repeat" title="Turn repeat on" aria-pressed="false"></button>'
        + '<div class="wmp-group">'
        + '<button type="button" class="wmp-tbtn wmp-stop" title="Stop" disabled></button>'
        + '<button type="button" class="wmp-prev" title="Previous (press and hold to rewind)" disabled></button>'
        + '<button type="button" class="wmp-play" title="Play"><span class="wmp-orb-halo"></span></button>'
        + '<button type="button" class="wmp-next" title="Press and hold to fast-forward" disabled></button>'
        + '</div>'
        + '<button type="button" class="wmp-tbtn wmp-mute" title="Mute" aria-pressed="false"></button>'
        // the narrow pill's split button: the speaker mutes, the arrow opens the volume pop-up (wmploc 4616)
        + '<button type="button" class="wmp-volarrow" title="Volume" aria-label="Volume" aria-haspopup="true" aria-expanded="false"></button>'
        + '<div class="wmp-volume" title="Volume" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="wmp-volume-track"></div><div class="wmp-volume-fill"></div><div class="wmp-volume-thumb"></div></div>'
        + '</div>'
        + '<div class="wmp-volpop hidden"><div class="wmp-volume" title="Volume" role="slider" tabindex="0" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="wmp-volume-track"></div><div class="wmp-volume-fill"></div><div class="wmp-volume-thumb"></div></div></div>'
        + '<div class="wmp-stack">'
        + '<button type="button" class="wmp-fullscreen" title="View full screen" aria-label="View full screen" disabled></button>'
        // the VM shows no tooltip on this one
        + '<button type="button" class="wmp-compact" aria-label="Switch to compact mode"></button>'
        + '</div>'
        + '</div>'
        + '<input type="file" class="hidden wmp-file" multiple accept="audio/*,video/*,.mp3,.ogg,.wav,.aac,.m4a,.flac,.mp4,.webm">';
}

// ---- the Open URL dialog (WMP's: File > Open URL, Ctrl+U) ----

function mediaPlayerBuildUrlDialog(player) {
    const modal = document.createElement('div');
    modal.id = 'desktopMediaPlayerUrl';
    modal.className = 'modal hidden wmp-url-dialog';
    // ensureModalApplicationIcon (modalUtils.js): the caption and taskbar show Media Player's icon
    if (player.modal && player.modal.id) modal.dataset.iconOwnerId = player.modal.id;
    modal.dataset.windowIdentifier = 'desktop-media-player-url';
    modal.dataset.windowClient = 'light';
    modal.innerHTML = ''
        + '<div class="modal-window-title">'
        + '<div class="modal-window-title-main">'
        + '<i class="fas fa-link icon-fa"></i>'
        + '<span>Open URL</span>'
        + '</div>'
        + '</div>'
        + '<div class="modal-focus-overlay"></div>'
        + '<div class="modal-window-controls">'
        + '<button type="button" class="btn-danger close-btn btn-small" title="Close">'
        + '<i class="fa-regular fa-xmark-large"></i>'
        + '</button>'
        + '</div>'
        + '<div class="modal-content win7">'
        + '<p class="wmp-url-text">Enter the URL or path to a media file on the Internet, your computer, or your network that you want the Player to open.</p>'
        + '<label class="wmp-url-label">Open: <input type="url" class="wmp-url-input" spellcheck="false" autocomplete="off"></label>'
        + '<div class="wmp-url-buttons">'
        + '<button type="button" class="btn-primary wmp-url-ok">OK</button>'
        + '<button type="button" class="btn-secondary wmp-url-cancel">Cancel</button>'
        + '</div>'
        + '</div>';
    const input = modal.querySelector('.wmp-url-input');
    const submit = () => {
        const url = String(input.value || '').trim();
        if (!url) return;
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
        mediaPlayerOpenUrl(player, url);
    };
    modal.querySelector('.wmp-url-ok').addEventListener('click', submit);
    modal.querySelector('.wmp-url-cancel').addEventListener('click', () => closeModal(modal));
    modal.querySelector('.close-btn').addEventListener('click', () => closeModal(modal));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        } else if (e.key === 'Escape') {
            e.preventDefault();
            closeModal(modal);
        }
    });
    document.body.appendChild(modal);
    return { modal: modal, input: input };
}

// ---- playlist ----

function mediaPlayerCurrent(player) {
    return player.index >= 0 && player.index < player.items.length ? player.items[player.index] : null;
}

function mediaPlayerStatus(player, text) {
    player.el.status.textContent = text || '';
    player.el.status.classList.toggle('hidden', !text);
}

/** Add entries ({ name, url?, mime?, file?, vfs? }) to Now Playing; play the first new one. */
function mediaPlayerAdd(player, entries, play) {
    const first = player.items.length;
    entries.forEach((entry) => {
        player.items.push({
            id: ++player.seq,
            name: entry.name || desktopMediaNameFromUrl(entry.url) || 'Unknown',
            url: entry.url || '',
            mime: entry.mime || (entry.file && entry.file.type) || '',
            file: entry.file || null,
            vfs: entry.vfs || null,
            art: entry.art || '',
            title: entry.title || '',
            artist: entry.artist || '',
            album: entry.album || '',
            composer: entry.composer || '',
            size: entry.size || 0,
            kind: mediaPlayerKindFor(entry.name || desktopMediaNameFromUrl(entry.url), entry.mime || (entry.file && entry.file.type) || '')
        });
    });
    mediaPlayerRenderPlaylist(player);
    mediaPlayerSyncTransport(player);
    if (play && player.items.length > first) mediaPlayerPlayIndex(player, first);
}

function mediaPlayerReleaseSource(player) {
    if (player.stopSeeking) player.stopSeeking();
    player.changing = false;
    player.epoch += 1;
    player.clearEpoch = player.epoch;
    const media = player.el.media;
    media.pause();
    media.removeAttribute('src');
    media.load();
    if (player.objectUrl) {
        URL.revokeObjectURL(player.objectUrl);
        player.objectUrl = null;
    }
    player.el.stage.dataset.kind = '';
    mediaPlayerPaintFrame(player, false);
}

async function mediaPlayerResolveUrl(player, item) {
    if (item.file) {
        if (!item.objectUrl) item.objectUrl = URL.createObjectURL(item.file);
        return item.objectUrl;
    }
    if (item.vfs) {
        return desktopMediaVfsUrl({ vfsPath: item.vfs.dir }, item.vfs.item, item.name);
    }
    return item.url;
}

async function mediaPlayerPlayIndex(player, index, options) {
    const item = player.items[index];
    if (!item) return;
    const media = player.el.media;
    player.index = index;
    mediaPlayerRenderPlaylist(player);
    mediaPlayerStatus(player, '');
    if (!mediaPlayerCanPlay(media, item.name, item.mime)) {
        mediaPlayerReleaseSource(player);
        mediaPlayerStatus(player, DESKTOP_MEDIA_ASSIST);
        mediaPlayerSyncTransport(player);
        mediaPlayerSyncNow(player);
        return;
    }
    let url = '';
    try {
        url = await mediaPlayerResolveUrl(player, item);
    } catch (err) {
        mediaPlayerStatus(player, (err && err.message) || 'Media Player cannot open this file.');
        return;
    }
    if (player.index !== index) return;
    if (!url) {
        mediaPlayerStatus(player, 'Media Player cannot build a playable address for this file.');
        return;
    }
    player.epoch += 1;
    player.clearEpoch = -1;
    player.el.stage.dataset.kind = item.kind;
    mediaPlayerPaintFrame(player, false);
    player.stopped = false;
    player.changing = true;
    player.nowLine = 0;
    media.src = url;
    mediaPlayerSyncNow(player);
    mediaPlayerSyncTransport(player);
    if (!(options && options.paused)) {
        const pending = media.play();
        if (pending && pending.catch) pending.catch((err) => {
            // AbortError: a newer source; NotAllowedError: the browser wants a click first (the file stays open, paused)
            if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) { mediaPlayerSyncTransport(player); return; }
            mediaPlayerStatus(player, 'Media Player cannot play the file.');
        });
    }
}

function mediaPlayerNextIndex(player, step) {
    const n = player.items.length;
    if (!n) return -1;
    if (player.shuffle && n > 1) {
        let pick = player.index;
        while (pick === player.index) pick = Math.floor(Math.random() * n);
        return pick;
    }
    const next = player.index + step;
    if (next >= 0 && next < n) return next;
    if (player.repeat) return (next + n) % n;
    return -1;
}

function mediaPlayerStep(player, step) {
    const next = mediaPlayerNextIndex(player, step);
    if (next === -1) return false;
    mediaPlayerPlayIndex(player, next);
    return true;
}

function mediaPlayerToggle(player) {
    const media = player.el.media;
    if (player.seeking) {
        // play ends a rewind / fast-forward at normal speed
        player.stopSeeking();
        if (media.paused) media.play().catch(() => {});
        return;
    }
    if (!media.getAttribute('src')) {
        if (player.items.length) mediaPlayerPlayIndex(player, player.index >= 0 ? player.index : 0);
        // nothing in Now Playing: WMP 11 plays what the Library shows
        else mediaPlayerLibrary.playShown(player);
        return;
    }
    if (media.paused || media.ended) {
        const pending = media.play();
        if (pending && pending.catch) pending.catch((err) => {
            // AbortError: a newer source; NotAllowedError: the browser wants a click first (the file stays open, paused)
            if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) { mediaPlayerSyncTransport(player); return; }
            mediaPlayerStatus(player, 'Media Player cannot play the file.');
        });
        return;
    }
    media.pause();
}

function mediaPlayerStop(player) {
    const media = player.el.media;
    if (!media.getAttribute('src')) return;
    media.pause();
    try {
        media.currentTime = 0;
    } catch (err) { /* not seekable yet */ }
    player.stopped = true;
    mediaPlayerSyncTransport(player);
}

function mediaPlayerClear(player) {
    mediaPlayerReleaseSource(player);
    player.items.forEach((item) => {
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
    });
    player.items = [];
    player.index = -1;
    mediaPlayerStatus(player, '');
    mediaPlayerRenderPlaylist(player);
    mediaPlayerSyncNow(player);
    mediaPlayerSyncTransport(player);
    if (player.library.mode === 'now-playing') mediaPlayerRenderLibrary(player);
}

function mediaPlayerRemove(player, id) {
    const at = player.items.findIndex((item) => item.id === id);
    if (at === -1) return;
    const wasCurrent = at === player.index;
    const removed = player.items.splice(at, 1)[0];
    if (removed.objectUrl && !wasCurrent) URL.revokeObjectURL(removed.objectUrl);
    if (wasCurrent) {
        mediaPlayerReleaseSource(player);
        if (removed.objectUrl) URL.revokeObjectURL(removed.objectUrl);
        player.index = -1;
        mediaPlayerSyncNow(player);
    } else if (at < player.index) {
        player.index -= 1;
    }
    mediaPlayerRenderPlaylist(player);
    mediaPlayerSyncTransport(player);
    if (player.library.mode === 'now-playing') mediaPlayerRenderLibrary(player);
}

// ---- opening things ----

function mediaPlayerOpenFiles(player, files) {
    const list = Array.from(files || []).filter(Boolean);
    if (!list.length) return;
    mediaPlayerAdd(player, list.map((file) => ({ name: file.name, mime: file.type, file: file })), true);
    mediaPlayerShowView(player, 'now-playing');
}

function mediaPlayerOpenUrl(player, url, label) {
    const clean = String(url || '').trim();
    if (!clean) return;
    mediaPlayerAdd(player, [{ name: label || desktopMediaNameFromUrl(clean) || clean, url: clean }], true);
    mediaPlayerShowView(player, 'now-playing');
}

function mediaPlayerOpenVfsItem(player, item, dir) {
    mediaPlayerAdd(player, [{ name: item.name || '', mime: item.mimeType || '', vfs: { item: item, dir: dir } }], true);
    mediaPlayerShowView(player, 'now-playing');
}

// ---- Now Playing ----

function mediaPlayerRenderPlaylist(player) {
    const host = player.el.playlist;
    host.innerHTML = player.items.map((item, i) => ''
        + '<button type="button" class="wmp-playlist-item' + (i === player.index ? ' is-current' : '') + '" role="option" data-id="' + item.id + '" aria-selected="' + (i === player.index) + '" title="' + mediaPlayerEsc(item.name) + '">'
        + '<span class="wmp-playlist-mark"></span><span class="wmp-playlist-name">' + mediaPlayerEsc(mediaPlayerTitle(item.name)) + '</span>'
        + '</button>').join('');
}

/** The List Pane's thumbnail and the transport's: a frame of the video, or the music note. */
function mediaPlayerPaintFrame(player, fromVideo) {
    const media = player.el.media;
    const targets = [player.el.frame, player.el.nowCanvas];
    targets.forEach((canvas) => {
        const ctx = canvas.getContext('2d');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (!fromVideo || !media.videoWidth) return;
        const scale = Math.max(canvas.width / media.videoWidth, canvas.height / media.videoHeight);
        const w = media.videoWidth * scale;
        const h = media.videoHeight * scale;
        try {
            ctx.drawImage(media, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
        } catch (err) { /* cross-origin frame */ }
    });
    player.el.listpaneArt.classList.toggle('has-frame', !!fromVideo && !!media.videoWidth);
    player.el.nowThumb.classList.toggle('has-frame', !!fromVideo && !!media.videoWidth);
}

function mediaPlayerSyncNow(player) {
    const item = mediaPlayerCurrent(player);
    const title = item ? mediaPlayerTitle(item.name) : '';
    player.el.listpaneTitle.textContent = title;
    player.el.listpaneTitle.title = item ? item.name : '';
    const art = item && item.kind === 'video' ? 'art-video' : 'art-music';
    // a library song shows its album art (WMP 11's List Pane and the transport's thumbnail), anything else WMP's note
    const cover = item && item.kind !== 'video' && item.art ? item.art : '';
    const fallback = WMP_ART + '/' + art + '.png';
    [player.el.stageArt, player.el.listpaneIcon, player.el.nowIcon].forEach((img) => {
        img.onerror = () => { img.onerror = null; img.src = fallback; img.classList.remove('is-cover'); };
        img.src = cover || fallback;
        img.classList.toggle('is-cover', !!cover);
    });
    player.el.listpane.classList.toggle('has-item', !!item);
    mediaPlayerBar.syncNowLine(player);
}

function mediaPlayerSyncTransport(player) {
    const media = player.el.media;
    const el = player.el;
    const hasSource = !!media.getAttribute('src');
    const playing = hasSource && !media.paused && !media.ended;
    const n = player.items.length;
    const item = mediaPlayerCurrent(player);
    const video = !!(item && item.kind === 'video' && hasSource);
    // WMP 11 keeps play enabled with nothing loaded (it plays the Library's view); stop only while a file is open
    el.play.classList.toggle('is-playing', playing && !player.seeking);
    el.play.title = playing ? 'Pause' : 'Play';
    el.stop.disabled = !hasSource || player.stopped;
    el.prev.disabled = !n || (!video && mediaPlayerNextIndex(player, -1) === -1);
    // Next stays enabled while anything is listed (on the last item it ends playback, as WMP 11 does)
    el.next.disabled = !n;
    el.prev.title = video ? 'Rewind' : 'Previous (press and hold to rewind)';
    el.next.title = video ? 'Fast forward' : 'Press and hold to fast-forward';
    el.transport.classList.toggle('is-video', video);
    el.fullscreen.disabled = !video;
    el.shuffle.setAttribute('aria-pressed', String(player.shuffle));
    el.shuffle.title = player.shuffle ? 'Turn shuffle off' : 'Turn shuffle on';
    el.repeat.setAttribute('aria-pressed', String(player.repeat));
    el.repeat.title = player.repeat ? 'Turn repeat off' : 'Turn repeat on';
    const level = media.muted ? 'mute' : media.volume === 0 ? 'zero' : media.volume < 0.34 ? 'low' : media.volume < 0.67 ? 'mid' : 'high';
    el.mute.dataset.level = level;
    el.mute.setAttribute('aria-pressed', String(media.muted));
    el.mute.title = media.muted ? 'Sound' : 'Mute';
    const volumePct = Math.round(media.volume * 100);
    el.transport.style.setProperty('--wmp-volume-frac', String(media.volume));
    el.volumes.forEach((v) => v.setAttribute('aria-valuenow', String(volumePct)));
    mediaPlayerBar.syncNowLine(player);
    mediaPlayerSyncClock(player);
}

function mediaPlayerSyncClock(player) {
    const media = player.el.media;
    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    const now = player.scrubbing ? player.scrubTime : (Number.isFinite(media.currentTime) ? media.currentTime : 0);
    const frac = duration > 0 ? Math.min(1, now / duration) : 0;
    const seek = player.el.seek;
    seek.style.setProperty('--wmp-seek-frac', frac.toFixed(5));
    seek.setAttribute('aria-valuemax', String(Math.round(duration)));
    seek.setAttribute('aria-valuenow', String(Math.round(now)));
    // stopped (or nothing open): the bare groove, as the VM shows it
    const open = !!media.getAttribute('src') && !player.stopped;
    seek.classList.toggle('is-ready', open && duration > 0);
    seek.classList.toggle('is-scrubbing', !!player.scrubbing);
    // the elapsed time as WMP 11 writes it (00:01, 1:02:05), only while a file is open
    let text = '';
    if (open && media.currentSrc && !player.changing) {
        const pad = (t) => { const c = desktopMediaClock(t); return c.length < 5 ? '0' + c : c; };
        text = pad(now);
        if (player.timeTotal && duration > 0) text += ' / ' + pad(duration);
    }
    if (player.el.time.textContent !== text) player.el.time.textContent = text;
}

// The bar's own helpers (#956), one namespace (app-scope): the rotating now-playing line, press-and-hold
// previous / next, the seek groove's value.
const mediaPlayerBar = (function () {
    const CAPTION = 'Melaton Media Player';

    /** The title beside the thumbnail: "Media changing..." while a file opens, then its title, artist, composer and
        album in turn (3.25 s each on the VM) while it plays; nothing when stopped. */
    function mediaPlayerNowLines(item) {
        if (!item) return [];
        const lines = [item.title || mediaPlayerTitle(item.name)];
        if (item.kind !== 'video') {
            if (item.artist) lines.push(item.artist);
            if (item.composer) lines.push(item.composer + ' [Composer]');
            if (item.album) lines.push(item.album);
        }
        return lines.filter(Boolean);
    }

    function mediaPlayerSyncNowLine(player) {
        const media = player.el.media;
        const item = mediaPlayerCurrent(player);
        const open = !!item && !!media.getAttribute('src') && !player.stopped;
        const lines = open ? mediaPlayerNowLines(item) : [];
        let text = '';
        if (open && player.changing) text = 'Media changing...';
        else if (lines.length) text = lines[(player.nowLine || 0) % lines.length];
        if (player.el.nowTitle.textContent !== text) player.el.nowTitle.textContent = text;
        // folded (compact mode), the caption carries the line instead of the program's name, as on the VM
        const caption = player.compact && text ? text : CAPTION;
        if (player.el.caption.textContent !== caption) player.el.caption.textContent = caption;
        player.el.now.classList.toggle('has-item', open && !player.changing);
        // the thumbnail's tooltip: the bit rate it plays at (the file's size over its length)
        const size = item && (item.size || (item.file && item.file.size)) || 0;
        const kbps = open && size && media.duration > 0 && Number.isFinite(media.duration) ? Math.round(size * 8 / media.duration / 1000) : 0;
        player.el.nowThumb.title = kbps ? 'Playing at ' + kbps + ' Kbps' : '';
        // rotate only while it plays and the window is shown (no timer otherwise: phone-power-client)
        const rotate = open && !player.changing && lines.length > 1 && !media.paused && !document.hidden;
        if (rotate && !player.nowTimer) {
            player.nowTimer = setTimeout(function tick() {
                player.nowTimer = 0;
                player.nowLine = (player.nowLine || 0) + 1;
                mediaPlayerSyncNowLine(player);
            }, 3250);
        } else if (!rotate && player.nowTimer) {
            clearTimeout(player.nowTimer);
            player.nowTimer = 0;
        }
    }

    /** Press and hold previous / next: rewind / fast-forward while held (the orb shows play meanwhile); a click steps.
        A video's buttons are Rewind / Fast forward themselves. */
    function mediaPlayerWireSeekButtons(player) {
        const media = player.el.media;
        const stopSeeking = () => {
            if (!player.seeking) return;
            const btn = player.seeking.btn;
            clearInterval(player.seeking.timer);
            media.playbackRate = 1;
            btn.classList.remove('is-seeking');
            player.seeking = null;
            mediaPlayerSyncTransport(player);
        };
        const startSeeking = (btn, dir) => {
            if (!media.getAttribute('src') || !Number.isFinite(media.duration)) return false;
            btn.classList.add('is-seeking');
            // fast-forward plays at 5x; rewind steps back (browsers cannot play backwards)
            if (dir > 0) {
                media.playbackRate = 5;
                if (media.paused) media.play().catch(() => {});
            }
            player.seeking = {
                btn, dir,
                timer: dir < 0 ? setInterval(() => {
                    // a hidden window does not rewind on its own (phone-power-client)
                    if (document.hidden) { stopSeeking(); return; }
                    try { media.currentTime = Math.max(0, media.currentTime - 1.5); } catch (err) { /* not seekable */ }
                }, 250) : 0
            };
            mediaPlayerSyncTransport(player);
            return true;
        };
        [[player.el.prev, -1], [player.el.next, 1]].forEach(([btn, dir]) => {
            let hold = 0;
            let held = false;
            btn.addEventListener('pointerdown', (e) => {
                if (e.button !== 0 || btn.disabled) return;
                held = false;
                const video = player.el.transport.classList.contains('is-video');
                if (video) return;
                hold = setTimeout(() => { hold = 0; held = startSeeking(btn, dir); }, 400);
            });
            const release = () => {
                if (hold) { clearTimeout(hold); hold = 0; }
                if (player.seeking && player.seeking.btn === btn && !player.el.transport.classList.contains('is-video')) stopSeeking();
            };
            btn.addEventListener('pointerup', release);
            btn.addEventListener('pointerleave', release);
            btn.addEventListener('pointercancel', release);
            btn.addEventListener('click', () => {
                if (held) { held = false; return; }
                if (player.el.transport.classList.contains('is-video')) {
                    // a video: Rewind / Fast forward toggle; play returns to normal speed
                    if (player.seeking && player.seeking.btn === btn) stopSeeking();
                    else { stopSeeking(); startSeeking(btn, dir); }
                    return;
                }
                if (!mediaPlayerStep(player, dir) && dir > 0) mediaPlayerStop(player);
            });
        });
        media.addEventListener('pause', () => { if (player.seeking && player.seeking.dir > 0) stopSeeking(); });
        player.stopSeeking = stopSeeking;
    }

    /** The seek groove's value: its thumb (17px) travels from 7px in to 7px short of the far end. */
    function mediaPlayerSeekValue(seek, clientX) {
        const rect = seek.getBoundingClientRect();
        if (rect.width <= 31) return 0;
        return Math.max(0, Math.min(1, (clientX - rect.left - 15.5) / (rect.width - 31)));
    }

    function mediaPlayerSyncCompact(player, height) {
        const folded = (height || player.modal.getBoundingClientRect().height) <= 96 + 0.5;
        if (folded === player.compact) return;
        player.compact = folded;
        player.modal.classList.toggle('wmp-collapsed', folded);
        if (folded) mediaPlayerSetVolumePopup(player, false);
        mediaPlayerBar.syncNowLine(player);
    }

    /** The narrow pill's volume pop-up (wmploc 4616 under the split button's arrow). */
    function mediaPlayerSetVolumePopup(player, open) {
        const pop = player.el.volpop;
        if (open === !pop.classList.contains('hidden')) return;
        pop.classList.toggle('hidden', !open);
        player.el.volarrow.setAttribute('aria-expanded', String(open));
        player.el.volarrow.classList.toggle('is-open', open);
        if (open) {
            // any press outside the pop-up closes it (the listener lives only while it is open)
            player.volpopClose = (e) => {
                if (pop.contains(e.target) || player.el.volarrow.contains(e.target)) return;
                mediaPlayerSetVolumePopup(player, false);
            };
            document.addEventListener('pointerdown', player.volpopClose, { capture: true, signal: mediaPlayerLibrary.signal });
        } else if (player.volpopClose) {
            document.removeEventListener('pointerdown', player.volpopClose, { capture: true });
            player.volpopClose = null;
        }
    }

    /** The focus rectangle's dots stay on the window's checkerboard (x + y odd from its corner), wherever the box sits. */
    function mediaPlayerSyncFocus(player, el) {
        const box = getComputedStyle(el, '::before');
        if (box.content === 'none') return;
        const m = player.modal.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        const x = Math.round(r.left + el.clientLeft + (parseFloat(box.left) || 0) - m.left);
        const y = Math.round(r.top + el.clientTop + (parseFloat(box.top) || 0) - m.top);
        const w = Math.round(parseFloat(box.width) || 0);
        const h = Math.round(parseFloat(box.height) || 0);
        const p = (x + y) & 1;
        el.style.setProperty('--wmp-focus-t', p ? '1px' : '0px');
        el.style.setProperty('--wmp-focus-b', (p + h - 1) & 1 ? '1px' : '0px');
        el.style.setProperty('--wmp-focus-r', (p + w - 1) & 1 ? '1px' : '0px');
    }

    return {
        nowLines: mediaPlayerNowLines, syncNowLine: mediaPlayerSyncNowLine, wireSeekButtons: mediaPlayerWireSeekButtons, seekValue: mediaPlayerSeekValue,
        // WMP 11's window limits on the VM: 374 wide at least; under 201 high it folds to the transport (96)
        syncCompact: mediaPlayerSyncCompact, setVolumePopup: mediaPlayerSetVolumePopup, syncFocus: mediaPlayerSyncFocus,
        MIN_WIDTH: 374, FOLDED_HEIGHT: 96, UNFOLD_MIN: 201, CAPTION
    };
})();

// ---- views and history ----

function mediaPlayerShowView(player, view, record) {
    const id = WMP_TABS.some((t) => t.id === view) ? view : 'now-playing';
    player.view = id;
    player.el.tabs.forEach((tab) => {
        const on = tab.dataset.tab === id;
        tab.classList.toggle('is-active', on);
        tab.setAttribute('aria-selected', String(on));
    });
    player.el.views.forEach((v) => {
        const key = v.dataset.view;
        const show = key === id || (key === 'blank' && WMP_BLANK_PAGES[id]);
        v.classList.toggle('hidden', !show);
    });
    if (WMP_BLANK_PAGES[id]) player.el.blankText.textContent = WMP_BLANK_PAGES[id];
    player.modal.dataset.wmpView = id;
    if (id === 'library') mediaPlayerRenderLibrary(player);
    if (record !== false) mediaPlayerRecord(player);
}

function mediaPlayerRecord(player) {
    const lib = player.library;
    const entry = { view: player.view, mode: lib.mode, source: lib.source, category: lib.category, lview: lib.view, filter: lib.filter };
    const sig = (e) => [e.view, e.mode, e.source, e.category, e.lview, e.filter ? e.filter.field + ':' + e.filter.value : ''].join('|');
    const last = player.history[player.historyIndex];
    if (last && sig(last) === sig(entry)) return;
    player.history = player.history.slice(0, player.historyIndex + 1);
    player.history.push(entry);
    player.historyIndex = player.history.length - 1;
    mediaPlayerSyncOrbs(player);
}

function mediaPlayerSyncOrbs(player) {
    player.el.back.disabled = player.historyIndex <= 0;
    player.el.forward.disabled = player.historyIndex >= player.history.length - 1;
}

function mediaPlayerGo(player, step) {
    const to = player.historyIndex + step;
    if (to < 0 || to >= player.history.length) return;
    player.historyIndex = to;
    const entry = player.history[to];
    const lib = player.library;
    lib.mode = entry.mode;
    if (entry.source) lib.source = entry.source;
    if (entry.lview) lib.view = entry.lview;
    lib.filter = entry.filter || null;
    if (entry.category && entry.category !== lib.category) { lib.category = entry.category; mediaPlayerLibrary.renderTree(player); }
    if (entry.view === 'library') mediaPlayerRenderLibrary(player);
    mediaPlayerShowView(player, entry.view, false);
    mediaPlayerSyncOrbs(player);
}

// ---- Library ----

// ---- Library (Yozora #956): WMP 11's music and video library ----
//
// Sources: 'local' = this computer's library, the server's (modules/mediaLibrary.js: the VFS's music and video with
// their tags, media_library_get; files and art at <vfs>/media/file|art); 'phone' = the phone this window runs from
// (the Android app's MediaStore, window.AndroidMediaLibrary, as Melaton Media reads it) as one of WMP's other
// libraries. Views (WMP 11's, measured on the VM): Music - Recently Added, Artist, Album, Songs, Genre, Year, Rating;
// Video - All Video, Actors, Genre, Year, Rating. Ratings are kept in this browser (localStorage wmpRatings).

// One namespace (app-scope: no page globals of its own); the six names the rest of the file used before stay as
// thin functions.
const mediaPlayerLibrary = (function () {
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)
    const WMP_MUSIC_VIEWS = [
        { id: 'recent', label: 'Recently Added', icon: 'nav-recently-added' },
        { id: 'artist', label: 'Artist', icon: 'nav-artist' },
        { id: 'album', label: 'Album', icon: 'nav-album' },
        { id: 'songs', label: 'Songs', icon: 'nav-songs' },
        { id: 'genre', label: 'Genre', icon: 'nav-genre' },
        { id: 'year', label: 'Year', icon: 'nav-year' },
        { id: 'rating', label: 'Rating', icon: 'nav-rating' }
    ];
    const WMP_VIDEO_VIEWS = [
        { id: 'all', label: 'All Video', icon: 'nav-video' },
        { id: 'artist', label: 'Actors', icon: 'nav-artist' },
        { id: 'genre', label: 'Genre', icon: 'nav-genre' },
        { id: 'year', label: 'Year', icon: 'nav-year' },
        { id: 'rating', label: 'Rating', icon: 'nav-rating' }
    ];
    const WMP_RECENT_DAYS = 30;
    const WMP_RATINGS_KEY = 'wmpRatings';

    function mediaPlayerRatings() {
        if (!mediaPlayerRatings.cache) {
            try { mediaPlayerRatings.cache = JSON.parse(localStorage.getItem(WMP_RATINGS_KEY) || '{}') || {}; } catch (_) { mediaPlayerRatings.cache = {}; }
        }
        return mediaPlayerRatings.cache;
    }
    function mediaPlayerRatingOf(t) { return Number(mediaPlayerRatings()[t.key]) || 0; }
    function mediaPlayerSetRating(t, n) {
        const r = mediaPlayerRatings();
        if (n > 0) r[t.key] = n; else delete r[t.key];
        try { localStorage.setItem(WMP_RATINGS_KEY, JSON.stringify(r)); } catch (_) { /* private mode */ }
    }

    /** WMP's stars: five 14px stars, gold up to the rating (empty outlines above). */
    function mediaPlayerStarsHtml(n, key) {
        let h = '<span class="wmp-stars"' + (key ? ' data-rate="' + mediaPlayerEsc(key) + '"' : '') + '>';
        for (let i = 1; i <= 5; i++) h += '<span class="wmp-star' + (i <= n ? ' is-on' : '') + '" data-star="' + i + '"></span>';
        return h + '</span>';
    }

    function mediaPlayerLength(sec) {
        const s = Math.max(0, Math.round(Number(sec) || 0));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const r = s % 60;
        return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(r).padStart(2, '0') : m + ':' + String(r).padStart(2, '0');
    }
    const mediaPlayerMinutes = (sec) => { const m = Math.round((Number(sec) || 0) / 60); return m + (m === 1 ? ' minute' : ' minutes'); };

    /** The name the phone goes by (Mobile Device Center's), for its library in the tree. */
    function mediaPlayerPhoneName() {
        try {
            const H = window.AndroidHome;
            const c = H && typeof H.getContinuity === 'function' ? JSON.parse(H.getContinuity()) : null;
            const id = c && c.deviceId ? String(c.deviceId).toLowerCase() : '';
            const as = window.activeSync && typeof window.activeSync.state === 'function' ? window.activeSync.state() : null;
            const dev = id && as ? (as.devices || []).find((d) => String(d.deviceId).toLowerCase() === id) : null;
            if (dev && dev.name) return String(dev.name);
            const hw = window.melatonDeviceIdentity && typeof window.melatonDeviceIdentity.hardware === 'function' ? window.melatonDeviceIdentity.hardware() : null;
            if (hw && hw.device && (hw.device.marketName || hw.device.model)) return String(hw.device.marketName || hw.device.model);
        } catch (_) { /* below */ }
        return 'Phone';
    }

    function mediaPlayerHasPhone() {
        return !!(window.AndroidMediaLibrary && typeof window.AndroidMediaLibrary.baseUrl === 'function');
    }

    /** One source's tracks: { audio, video, error, needsAccess }. Each track: key, title, artist, album, ... url, art. */
    async function mediaPlayerFetchSource(source) {
        if (source === 'phone') {
            const L = window.AndroidMediaLibrary;
            let acc = {};
            try { acc = JSON.parse(L.access() || '{}'); } catch (_) { acc = {}; }
            if (!acc.granted) return { audio: [], video: [], needsAccess: true };
            let vols = [];
            try { vols = JSON.parse(L.volumes() || '[]'); } catch (_) { vols = []; }
            const base = L.baseUrl();
            const audio = [];
            const video = [];
            for (const v of vols) {
                const volume = typeof v === 'string' ? v : (v && (v.id || v.name));
                if (!volume) continue;
                const vol = encodeURIComponent(volume);
                let d = null;
                try { const r = await fetch(base + '/library/' + vol, { cache: 'no-store' }); d = r.ok ? await r.json() : null; } catch (_) { d = null; }
                if (!d) continue;
                (d.songs || []).forEach((x) => audio.push({
                    key: 'phone:' + volume + ':' + x.id, kind: 'audio', title: x.title || 'Unknown', artist: x.artist || '', albumArtist: x.albumArtist || '',
                    album: x.album || '', genre: x.genre || '', year: x.year || 0, track: x.track || 0, disc: x.disc || 0, composer: x.composer || '',
                    duration: (x.duration || 0) / 1000, added: (x.dateAdded || 0) * 1000, mime: x.mime || 'audio/mpeg', name: x.title || 'Unknown',
                    url: base + '/audio/' + vol + '/' + x.id, art: x.albumId ? base + '/album/' + vol + '/' + x.albumId + '?px=200' : ''
                }));
                (d.videos || []).forEach((x) => video.push({
                    key: 'phone:' + volume + ':v' + x.id, kind: 'video', title: x.title || 'Video', artist: x.artist || '', album: x.folder || '', genre: '', year: 0,
                    duration: (x.duration || 0) / 1000, added: (x.dateAdded || 0) * 1000, mime: x.mime || 'video/mp4', name: x.title || 'Video',
                    url: base + '/video/' + vol + '/' + x.id, art: base + '/video/' + vol + '/' + x.id + '?thumb=240'
                }));
            }
            return { audio, video };
        }
        // vfsClient.getBasePath: public/scripts/comp/vfsClient.js (the VFS's HTTP prefix, where the library's files are)
        const base = typeof vfsClient !== 'undefined' && vfsClient.getBasePath ? vfsClient.getBasePath() : '';
        const r = await window.wsClient.sendMessage('media_library_get', {});
        const d = (r && r.data) || r || {};
        const map = (x) => ({
            key: 'local:' + x.hash, kind: '', title: x.title || mediaPlayerTitle(x.name), artist: x.artist || '', albumArtist: x.albumArtist || '',
            album: x.album || '', genre: x.genre || '', year: x.year || 0, track: x.track || 0, disc: x.disc || 0, composer: x.composer || '',
            duration: x.duration || 0, added: x.added || 0, mime: x.mime || '', name: x.name || '', size: x.size || 0,
            url: base ? base + '/media/file/' + encodeURIComponent(x.id) : '', art: x.art && base ? base + '/media/art/' + x.hash : ''
        });
        return {
            audio: (d.audio || []).map((x) => Object.assign(map(x), { kind: 'audio' })),
            video: (d.video || []).map((x) => Object.assign(map(x), { kind: 'video' }))
        };
    }

    async function mediaPlayerLoadLibrary(player, force) {
        const lib = player.library;
        const src = lib.source;
        if (!force && lib.data[src] && !lib.data[src].stale) { mediaPlayerRenderLibrary(player); return; }
        lib.token += 1;
        const token = lib.token;
        player.el.list.innerHTML = '';
        player.el.listNote.textContent = 'Loading...';
        player.el.listNote.classList.remove('hidden');
        try {
            const data = await mediaPlayerFetchSource(src);
            if (token !== lib.token) return;
            lib.data[src] = data;
        } catch (err) {
            if (token !== lib.token) return;
            lib.data[src] = { audio: [], video: [], stale: true, error: (err && err.message) || 'Media Player cannot read the library.' }; // read again on the next visit
        }
        lib.loaded = true;
        mediaPlayerRenderLibrary(player);
    }
    // the old name (menus: Refresh)
    function mediaPlayerLoadFolder(player) { return mediaPlayerLoadLibrary(player, true); }

    function mediaPlayerViews(category) { return category === 'video' ? WMP_VIDEO_VIEWS : WMP_MUSIC_VIEWS; }

    /** The tree: Playlists (Create Playlist, Now Playing), Library and its views, then the other libraries. */
    function mediaPlayerRenderTree(player) {
        const lib = player.library;
        const views = mediaPlayerViews(lib.category);
        const leaf = (nav, icon, label, extra) => '<div class="wmp-tree-leaf' + (extra || '') + '"><button type="button" class="wmp-tree-item' + (nav === 'create-playlist' ? ' wmp-tree-create' : '') + '" data-nav="' + nav + '"><img src="' + WMP_ART + '/' + icon + '.png" alt="" width="16" height="16"><span>' + mediaPlayerEsc(label) + '</span></button></div>';
        const node = (id, nav, icon, label, open) => '<div class="wmp-tree-node' + (open ? ' is-open' : '') + '" data-node="' + id + '"><button type="button" class="wmp-tree-toggle" aria-label="' + (open ? 'Collapse' : 'Expand') + '"></button><button type="button" class="wmp-tree-item" data-nav="' + nav + '"><img src="' + WMP_ART + '/' + icon + '.png" alt="" width="16" height="16"><span>' + mediaPlayerEsc(label) + '</span></button></div>';
        const open = lib.open || (lib.open = { playlists: true, local: true, phone: false });
        let h = node('playlists', 'playlists', 'nav-playlists', 'Playlists', open.playlists);
        const hid = (on) => (on ? '' : ' hidden');
        h += leaf('create-playlist', 'nav-create-playlist', 'Create Playlist', hid(open.playlists));
        h += node('local', 'src:local:' + views[0].id, lib.category === 'video' ? 'nav-video' : 'nav-library', 'Library', open.local);
        views.forEach((v) => { h += leaf('src:local:' + v.id, v.icon, v.label, hid(open.local)); });
        if (mediaPlayerHasPhone()) {
            h += node('phone', 'src:phone:' + views[0].id, 'nav-other-library', mediaPlayerPhoneName(), open.phone);
            views.forEach((v) => { h += leaf('src:phone:' + v.id, v.icon, v.label, hid(open.phone)); });
        }
        player.el.tree.innerHTML = h;
        player.el.navItems = Array.from(player.el.tree.querySelectorAll('.wmp-tree-item'));
        mediaPlayerMarkTree(player);
    }

    function mediaPlayerMarkTree(player) {
        const lib = player.library;
        const cur = lib.mode === 'now-playing' ? 'now-playing' : 'src:' + lib.source + ':' + lib.view;
        player.el.navItems.forEach((btn) => btn.classList.toggle('is-current', btn.dataset.nav === cur && !lib.filter));
    }

    function mediaPlayerSetCategory(player, category) {
        const lib = player.library;
        lib.category = category === 'video' ? 'video' : 'music';
        lib.view = mediaPlayerViews(lib.category)[lib.category === 'video' ? 0 : 3].id;
        lib.filter = null;
        player.el.categoryIcon.src = WMP_ART + '/' + (lib.category === 'video' ? 'nav-video' : 'nav-music') + '.png';
        mediaPlayerRenderTree(player);
        mediaPlayerRenderLibrary(player);
        mediaPlayerRecord(player);
    }

    function mediaPlayerRenderCrumbs(player) {
        const lib = player.library;
        const views = mediaPlayerViews(lib.category);
        const view = views.find((v) => v.id === lib.view) || views[0];
        const crumbs = [{ label: lib.category === 'video' ? 'Video' : 'Music', nav: 'category' }];
        if (lib.mode === 'now-playing') crumbs.push({ label: 'Now Playing', nav: '' });
        else {
            crumbs.push({ label: lib.source === 'phone' ? mediaPlayerPhoneName() : 'Library', nav: 'src:' + lib.source + ':' + views[0].id });
            crumbs.push({ label: lib.filter ? lib.filter.from : view.label, nav: 'src:' + lib.source + ':' + (lib.filter ? lib.filter.fromView : view.id) });
            if (lib.filter) crumbs.push({ label: lib.filter.label || 'Unknown', nav: '' });
        }
        player.el.crumbs.innerHTML = crumbs.map((c) => '<span class="wmp-crumb-sep" aria-hidden="true"></span><button type="button" class="wmp-crumb" data-nav="' + mediaPlayerEsc(c.nav) + '">' + mediaPlayerEsc(c.label) + '</button>').join('');
    }

    /** The tracks the view shows, searched and (drilled into a stack) filtered. */
    function mediaPlayerTracks(player) {
        const lib = player.library;
        const d = lib.data[lib.source] || { audio: [], video: [] };
        let list = (lib.category === 'video' ? d.video : d.audio) || [];
        if (lib.view === 'recent') {
            const since = Date.now() - WMP_RECENT_DAYS * 86400000;
            list = list.filter((t) => t.added >= since);
        }
        if (lib.filter) list = list.filter((t) => String(mediaPlayerGroupKey(t, lib.filter.field)) === String(lib.filter.value));
        const q = String(player.el.search.value || '').trim().toLowerCase();
        if (q) list = list.filter((t) => [t.title, t.artist, t.albumArtist, t.album, t.genre, t.composer].some((v) => String(v || '').toLowerCase().indexOf(q) !== -1));
        return list;
    }

    function mediaPlayerGroupKey(t, field) {
        if (field === 'artist') return t.albumArtist || t.artist || 'Unknown Artist';
        if (field === 'album') return (t.album || 'Unknown Album') + '\u0001' + (t.albumArtist || t.artist || '');
        if (field === 'genre') return t.genre || 'Unknown Genre';
        if (field === 'year') return t.year || 'Unknown Year';
        if (field === 'rating') return mediaPlayerRatingOf(t);
        return '';
    }

    /** Stacks / tiles: one per album, artist, genre, year or rating. */
    function mediaPlayerGroups(tracks, field) {
        const map = new Map();
        tracks.forEach((t) => {
            const k = mediaPlayerGroupKey(t, field);
            let g = map.get(k);
            if (!g) { g = { key: k, tracks: [], art: '', duration: 0 }; map.set(k, g); }
            g.tracks.push(t);
            g.duration += t.duration || 0;
            if (!g.art && t.art) g.art = t.art;
        });
        const out = Array.from(map.values());
        out.forEach((g) => {
            const first = g.tracks[0];
            if (field === 'album') { g.label = first.album || 'Unknown Album'; g.sub = first.albumArtist || first.artist || 'Unknown Artist'; }
            else if (field === 'rating') g.label = g.key ? g.key + (g.key === 1 ? ' Star' : ' Stars') : 'Unrated';
            else g.label = String(g.key);
            const rated = g.tracks.map(mediaPlayerRatingOf).filter(Boolean);
            g.rating = rated.length ? Math.round(rated.reduce((a, b) => a + b, 0) / rated.length) : 0;
        });
        if (field === 'year') out.sort((a, b) => (Number(b.key) || 0) - (Number(a.key) || 0));
        // the VM lists My Ratings as Unrated, then 1 Star up
        else if (field === 'rating') out.sort((a, b) => (Number(a.key) || 0) - (Number(b.key) || 0));
        // WMP files "The Best of Beethoven" under B: a leading article does not count (as on the VM)
        else out.sort((a, b) => mediaPlayerSortName(a.label).localeCompare(mediaPlayerSortName(b.label)));
        return out;
    }

    /** The name WMP sorts by: without a leading "The", "A" or "An". */
    function mediaPlayerSortName(s) { return String(s || '').replace(/^(the|an?)\s+/i, ''); }

    const WMP_HEADS = {
        songs: ['Album', '', 'Title', 'Length', 'Rating', 'Contributing Artist', 'Composer'],
        album: ['Album', 'Album Artist', 'Genre', 'Release Year', 'Count', 'Length', 'Rating'],
        artist: ['Album Artist', 'Count', 'Length', 'Rating'],
        genre: ['Genre', 'Count', 'Length', 'Rating'],
        year: ['Release Year', 'Count', 'Length', 'Rating'],
        rating: ['Title'],
        video: ['Title', 'Length', 'Rating', 'Actors', 'Genre', 'Release Year']
    };

    function mediaPlayerArtHtml(art, kind, cls) {
        const fallback = WMP_ART + '/' + (kind === 'video' ? 'art-video' : 'art-music') + '.png';
        return '<span class="' + cls + '"><img src="' + mediaPlayerEsc(art || fallback) + '" alt="" draggable="false" loading="lazy" onerror="this.onerror=null;this.src=\'' + fallback + '\'"></span>';
    }

    function mediaPlayerRenderLibrary(player) {
        const lib = player.library;
        const el = player.el;
        mediaPlayerRenderCrumbs(player);
        mediaPlayerMarkTree(player);
        el.list.dataset.layout = '';
        if (lib.mode === 'now-playing') {
            el.listHead.innerHTML = '<span>Title</span><span>Length</span>';
            el.list.dataset.layout = 'details';
            lib.rows = [];
            el.list.innerHTML = player.items.map((item, i) => '<div class="wmp-row wmp-np-row' + (i === player.index ? ' is-current' : '') + '" role="option" data-key="np:' + item.id + '" tabindex="-1"><span>' + mediaPlayerEsc(item.name) + '</span><span></span></div>').join('');
            el.listNote.textContent = player.items.length ? '' : 'There are no items in the Now Playing list.';
            el.listNote.classList.toggle('hidden', !!player.items.length);
            return;
        }
        const d = lib.data[lib.source];
        if (!d) { void mediaPlayerLoadLibrary(player); return; }
        const tracks = mediaPlayerTracks(player);
        const viewId = lib.filter ? 'songs' : lib.view;
        const kindWord = lib.category === 'video' ? 'Video' : 'Music';
        let html = '';
        let head;
        lib.rows = [];
        lib.groups = [];
        if (lib.category === 'video' && (viewId === 'all' || viewId === 'songs')) {
            head = WMP_HEADS.video;
            el.list.dataset.layout = 'tiles-video';
            lib.rows = tracks.slice().sort((a, b) => mediaPlayerSortName(a.title).localeCompare(mediaPlayerSortName(b.title)));
            html = '<div class="wmp-tiles">' + lib.rows.map((t, i) => '<div class="wmp-tile wmp-row" role="option" tabindex="-1" data-key="t:' + i + '">'
                + mediaPlayerArtHtml(t.art, 'video', 'wmp-tile-art is-video')
                + '<span class="wmp-tile-name">' + mediaPlayerEsc(t.title) + '</span><span class="wmp-tile-sub">' + mediaPlayerEsc(mediaPlayerLength(t.duration)) + '</span></div>').join('') + '</div>';
        } else if (viewId === 'songs' || viewId === 'recent') {
            head = WMP_HEADS.songs;
            el.list.dataset.layout = 'songs';
            // grouped by album artist, then album (WMP 11's Songs view): the art and the album's facts at the left
            const albums = mediaPlayerGroups(tracks, 'album');
            albums.sort((a, b) => String(a.sub).localeCompare(String(b.sub)) || String(a.label).localeCompare(String(b.label)));
            let lastArtist = null;
            albums.forEach((g) => {
                g.tracks.sort((a, b) => (a.disc - b.disc) || (a.track - b.track) || a.title.localeCompare(b.title));
                if (g.sub !== lastArtist) { html += '<div class="wmp-group-head"><span>' + mediaPlayerEsc(g.sub) + '</span></div>'; lastArtist = g.sub; }
                const first = g.tracks[0];
                html += '<div class="wmp-album-block">'
                    + '<div class="wmp-album-side">' + mediaPlayerArtHtml(g.art, 'audio', 'wmp-album-art')
                    + '<div class="wmp-album-facts"><span>' + mediaPlayerEsc(g.label) + '</span><span>' + mediaPlayerEsc(g.sub) + '</span><span>' + mediaPlayerEsc(first.genre || '') + '</span><span>' + (first.year || '') + '</span></div></div>'
                    + '<div class="wmp-album-rows">' + g.tracks.map((t) => {
                        const i = lib.rows.push(t) - 1;
                        return '<div class="wmp-row wmp-song" role="option" tabindex="-1" data-key="t:' + i + '">'
                            + '<span class="wmp-c-track">' + (t.track || '') + '</span>'
                            + '<span class="wmp-c-title">' + mediaPlayerEsc(t.title) + '</span>'
                            + '<span class="wmp-c-length">' + mediaPlayerLength(t.duration) + '</span>'
                            + '<span class="wmp-c-rating">' + mediaPlayerStarsHtml(mediaPlayerRatingOf(t), t.key) + '</span>'
                            + '<span class="wmp-c-artist">' + mediaPlayerEsc(t.artist) + '</span>'
                            + '<span class="wmp-c-composer">' + mediaPlayerEsc(t.composer) + '</span></div>';
                    }).join('') + '</div></div>';
            });
        } else {
            // Album tiles; Artist / Genre / Year / Rating stacks (art, name, count, length, stars)
            const field = viewId === 'album' ? 'album' : viewId;
            head = WMP_HEADS[field] || WMP_HEADS.genre;
            el.list.dataset.layout = field === 'album' ? 'tiles' : field === 'rating' ? 'ratings' : 'stacks';
            lib.groups = mediaPlayerGroups(tracks, field);
            const tile = (g, i) => {
                if (field === 'rating') {
                    // Rating on the VM: a large star over the rating's name, nothing else
                    return '<div class="wmp-tile wmp-row is-rating" role="option" tabindex="-1" data-key="g:' + i + '">'
                        + '<img class="wmp-rating-star" src="' + WMP_ART + '/rating-star.png" alt="" width="30" height="29" draggable="false"><span class="wmp-tile-name">' + mediaPlayerEsc(g.label) + '</span></div>';
                }
                const count = g.tracks.length;
                // the VM's Artist stacks count the songs; Genre and Year stacks give only the length
                const countLine = field === 'artist' ? '<span class="wmp-tile-sub">' + count + (lib.category === 'video' ? (count === 1 ? ' Video' : ' Videos') : (count === 1 ? ' Song' : ' Songs')) + '</span>' : '';
                const lines = field === 'album'
                    ? '<span class="wmp-tile-name">' + mediaPlayerEsc(g.label) + '</span><span class="wmp-tile-sub">' + mediaPlayerEsc(g.sub) + '</span>'
                    : '<span class="wmp-tile-name">' + mediaPlayerEsc(g.label) + '</span>' + countLine + '<span class="wmp-tile-sub">' + mediaPlayerMinutes(g.duration) + '</span>' + mediaPlayerStarsHtml(g.rating);
                return '<div class="wmp-tile wmp-row' + (field === 'album' ? '' : ' is-stack') + '" role="option" tabindex="-1" data-key="g:' + i + '">'
                    + mediaPlayerArtHtml(g.art, lib.category === 'video' ? 'video' : 'audio', 'wmp-tile-art') + '<span class="wmp-tile-text">' + lines + '</span></div>';
            };
            // Year is filed under its decade ("2000s", "1990s") and Rating under "My Ratings", each with a group line
            const sectionOf = field === 'year' ? (g) => (Number(g.key) ? Math.floor(Number(g.key) / 10) * 10 + 's' : 'Unknown')
                : field === 'rating' ? () => 'My Ratings' : null;
            if (sectionOf) {
                let last = null;
                lib.groups.forEach((g, i) => {
                    const sec = sectionOf(g);
                    if (sec !== last) { html += (last === null ? '' : '</div>') + '<div class="wmp-group-head"><span>' + mediaPlayerEsc(sec) + '</span></div><div class="wmp-tiles">'; last = sec; }
                    html += tile(g, i);
                });
                if (last !== null) html += '</div>';
            } else html = '<div class="wmp-tiles">' + lib.groups.map(tile).join('') + '</div>';
        }
        el.listHead.innerHTML = head.map((h) => '<span>' + mediaPlayerEsc(h) + '</span>').join('');
        el.listHead.dataset.layout = el.list.dataset.layout;
        el.list.innerHTML = html;
        const empty = !(lib.rows.length || lib.groups.length);
        let note = '';
        if (empty) {
            if (d.error) note = d.error;
            else if (d.needsAccess) note = 'Allow Melaton to read your music and videos on your phone to see its library.';
            else if (String(el.search.value || '').trim()) note = 'No items match your search.';
            else if (viewId === 'recent') note = 'There are no recently added items in ' + kindWord + '.';
            else note = 'There are no items in ' + kindWord + '.';
        }
        el.listNote.textContent = note;
        el.listNote.classList.toggle('hidden', !note);
    }

    function mediaPlayerNav(player, nav) {
        const lib = player.library;
        if (!nav) return;
        if (nav === 'now-playing' || nav === 'playlists' || nav === 'create-playlist') {
            lib.mode = 'now-playing';
            mediaPlayerRenderLibrary(player);
            mediaPlayerRecord(player);
            return;
        }
        if (nav === 'category') return;
        const m = /^src:(local|phone):(.+)$/.exec(nav);
        if (!m) return;
        lib.mode = 'library';
        lib.source = m[1];
        lib.view = m[2];
        lib.filter = null;
        mediaPlayerRenderLibrary(player);
        mediaPlayerRecord(player);
    }

    /** The tracks to play from what was activated: a song plays its view from there, a tile or stack all of its songs. */
    function mediaPlayerTracksFor(player, key) {
        const lib = player.library;
        if (key.indexOf('t:') === 0) {
            const i = Number(key.slice(2));
            return lib.rows.slice(i).concat(lib.rows.slice(0, i));
        }
        const g = lib.groups[Number(key.slice(2))];
        if (!g) return [];
        return g.tracks.slice().sort((a, b) => (a.album || '').localeCompare(b.album || '') || (a.disc - b.disc) || (a.track - b.track));
    }

    /** Play with an empty Now Playing list: the tracks the Library shows (its rows, or every group's tracks). */
    function mediaPlayerPlayShown(player) {
        const lib = player.library;
        let tracks = (lib.rows || []).filter((t) => t && t.url);
        if (!tracks.length) tracks = (lib.groups || []).reduce((all, g) => all.concat((g && g.tracks) || []), []);
        if (tracks.length) mediaPlayerPlayTracks(player, tracks, false);
    }

    function mediaPlayerPlayTracks(player, tracks, add) {
        const entries = tracks.filter((t) => t.url).map((t) => ({ name: t.title, title: t.title, url: t.url, mime: t.mime, art: t.art, artist: t.artist, album: t.album, composer: t.composer, size: t.size }));
        if (!entries.length) return;
        if (!add) mediaPlayerClear(player);
        mediaPlayerAdd(player, entries, !add);
    }

    function mediaPlayerActivateRow(player, key) {
        if (key.indexOf('np:') === 0) {
            const id = Number(key.slice(3));
            const at = player.items.findIndex((item) => item.id === id);
            if (at !== -1) {
                mediaPlayerPlayIndex(player, at);
                mediaPlayerShowView(player, 'now-playing');
            }
            return;
        }
        const lib = player.library;
        if (key.indexOf('g:') === 0) {
            const g = lib.groups[Number(key.slice(2))];
            if (!g) return;
            const viewId = lib.view;
            // a stack opens (WMP 11: double-click a stack); an album tile plays
            if (viewId !== 'album') {
                const views = mediaPlayerViews(lib.category);
                lib.filter = { field: viewId, value: g.key, label: g.label, from: (views.find((v) => v.id === viewId) || views[0]).label, fromView: viewId };
                mediaPlayerRenderLibrary(player);
                mediaPlayerRecord(player);
                return;
            }
        }
        mediaPlayerPlayTracks(player, mediaPlayerTracksFor(player, key), false);
    }

    return {
        signal: appScopeSignal, loadLibrary: mediaPlayerLoadLibrary, renderTree: mediaPlayerRenderTree, setRating: mediaPlayerSetRating,
        ratingOf: mediaPlayerRatingOf, groups: mediaPlayerGroups, length: mediaPlayerLength, setCategory: mediaPlayerSetCategory,
        renderCrumbs: mediaPlayerRenderCrumbs, renderLibrary: mediaPlayerRenderLibrary, nav: mediaPlayerNav,
        activateRow: mediaPlayerActivateRow, loadFolder: mediaPlayerLoadFolder, playShown: mediaPlayerPlayShown
    };
})();
function mediaPlayerSetCategory(player, category) { return mediaPlayerLibrary.setCategory(player, category); }
function mediaPlayerLoadFolder(player) { return mediaPlayerLibrary.loadFolder(player); }
function mediaPlayerRenderCrumbs(player) { return mediaPlayerLibrary.renderCrumbs(player); }
function mediaPlayerRenderLibrary(player) { return mediaPlayerLibrary.renderLibrary(player); }
function mediaPlayerNav(player, nav) { return mediaPlayerLibrary.nav(player, nav); }
function mediaPlayerActivateRow(player, key) { return mediaPlayerLibrary.activateRow(player, key); }

// ---- menus ----

function mediaPlayerMenuItems(player, tab) {
    const open = [
        { text: 'Open File...', icon: 'fas fa-folder-open', action: 'open-file' },
        { text: 'Open URL...', icon: 'fas fa-link', action: 'open-url' }
    ];
    if (tab === 'now-playing') {
        return [
            { text: 'Show List Pane', action: 'toggle-listpane', indicatorStyle: 'dot', checked: player.listPane },
            { separator: true },
            { text: 'Shuffle', action: 'shuffle', indicatorStyle: 'dot', checked: player.shuffle },
            { text: 'Repeat', action: 'repeat', indicatorStyle: 'dot', checked: player.repeat },
            { separator: true }
        ].concat(open, [
            { separator: true },
            { text: 'Clear Now Playing List', icon: 'fas fa-xmark', action: 'clear', disabled: !player.items.length },
            { text: 'View Full Screen', icon: 'fas fa-expand', action: 'fullscreen', disabled: !player.items.length }
        ]);
    }
    if (tab === 'library') {
        return [
            { text: 'Music', action: 'category:music', indicatorStyle: 'dot', checked: player.library.category === 'music' },
            { text: 'Video', action: 'category:video', indicatorStyle: 'dot', checked: player.library.category === 'video' },
            { separator: true }
        ].concat(open, [{ separator: true }, { text: 'Refresh', icon: 'fas fa-sync', action: 'refresh' }]);
    }
    return null;
}

function mediaPlayerRunAction(player, action) {
    if (action === 'open-file') player.el.file.click();
    else if (action === 'open-url') mediaPlayerShowUrlDialog(player);
    else if (action === 'toggle-listpane') mediaPlayerSetListPane(player, !player.listPane);
    else if (action === 'shuffle') mediaPlayerSetShuffle(player, !player.shuffle);
    else if (action === 'repeat') mediaPlayerSetRepeat(player, !player.repeat);
    else if (action === 'clear') mediaPlayerClear(player);
    else if (action === 'fullscreen') mediaPlayerFullScreen(player);
    else if (action === 'play-pause') mediaPlayerToggle(player);
    else if (action === 'stop') mediaPlayerStop(player);
    else if (action === 'previous') mediaPlayerStep(player, -1);
    else if (action === 'next') mediaPlayerStep(player, 1);
    else if (action === 'refresh') mediaPlayerLibrary.loadLibrary(player, true);
    else if (action.indexOf('category:') === 0) mediaPlayerSetCategory(player, action.slice(9));
    else if (action.indexOf('remove:') === 0) mediaPlayerRemove(player, Number(action.slice(7)));
}

function mediaPlayerAttachMenus(player) {
    const cm = typeof contextMenu !== 'undefined' ? contextMenu : null;
    if (!cm) return;
    player.el.tabs.forEach((tab) => {
        const btn = tab.querySelector('.wmp-tab-menu');
        const id = tab.dataset.tab;
        if (!mediaPlayerMenuItems(player, id)) {
            btn.classList.add('hidden');
            return;
        }
        const attach = () => {
            cm.detachClickMenuFromElement(btn);
            // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
            cm.attachClickMenuToElement(btn, {
                position: 'anchor',
                anchorAlign: 'start',
                anchorElement: () => tab,
                sections: [{ type: 'list', items: mediaPlayerMenuItems(player, id) }],
                onAction: (action) => mediaPlayerRunAction(player, action)
            });
        };
        btn.addEventListener('pointerdown', attach, true);
        btn.addEventListener('focus', attach);
        attach();
    });
    const stageMenu = () => {
        cm.detachClickMenuFromElement(player.el.stage);
        // contextMenu.attachToElement (right click): public/scripts/comp/contextMenu.js
        cm.attachToElement(player.el.stage, {
            sections: [{
                type: 'list',
                items: [
                    { text: player.el.media.paused ? 'Play' : 'Pause', icon: player.el.media.paused ? 'fas fa-play' : 'fas fa-pause', action: 'play-pause', disabled: !player.items.length },
                    { text: 'Stop', icon: 'fas fa-stop', action: 'stop', disabled: !player.el.media.getAttribute('src') },
                    { separator: true },
                    { text: 'Shuffle', action: 'shuffle', indicatorStyle: 'dot', checked: player.shuffle },
                    { text: 'Repeat', action: 'repeat', indicatorStyle: 'dot', checked: player.repeat },
                    { separator: true },
                    { text: 'Full Screen', icon: 'fas fa-expand', action: 'fullscreen', disabled: !player.items.length },
                    { text: 'Show List Pane', action: 'toggle-listpane', indicatorStyle: 'dot', checked: player.listPane },
                    { separator: true },
                    { text: 'Open File...', icon: 'fas fa-folder-open', action: 'open-file' },
                    { text: 'Open URL...', icon: 'fas fa-link', action: 'open-url' }
                ]
            }],
            onAction: (action) => mediaPlayerRunAction(player, action)
        });
    };
    player.el.stage.addEventListener('pointerdown', (e) => {
        if (e.button === 2) stageMenu();
    }, true);
    stageMenu();
    const headMenu = () => {
        cm.detachClickMenuFromElement(player.el.listpaneName);
        cm.attachClickMenuToElement(player.el.listpaneName, {
            position: 'anchor',
            anchorAlign: 'start',
            sections: [{
                type: 'list',
                items: [
                    { text: 'Shuffle', action: 'shuffle', indicatorStyle: 'dot', checked: player.shuffle },
                    { text: 'Repeat', action: 'repeat', indicatorStyle: 'dot', checked: player.repeat },
                    { separator: true },
                    { text: 'Clear List', icon: 'fas fa-xmark', action: 'clear', disabled: !player.items.length }
                ]
            }],
            onAction: (action) => mediaPlayerRunAction(player, action)
        });
    };
    player.el.listpaneName.addEventListener('pointerdown', headMenu, true);
    player.el.listpaneName.addEventListener('focus', headMenu);
    headMenu();
    const itemMenu = (e) => {
        const btn = e.target.closest('.wmp-playlist-item');
        if (!btn) return;
        cm.detachClickMenuFromElement(btn);
        cm.attachToElement(btn, {
            sections: [{
                type: 'list',
                items: [
                    { text: 'Play', icon: 'fas fa-play', action: 'play:' + btn.dataset.id },
                    { text: 'Remove from List', icon: 'fas fa-xmark', action: 'remove:' + btn.dataset.id }
                ]
            }],
            onAction: (action) => {
                if (action.indexOf('play:') === 0) {
                    const at = player.items.findIndex((item) => item.id === Number(action.slice(5)));
                    if (at !== -1) mediaPlayerPlayIndex(player, at);
                    return;
                }
                mediaPlayerRunAction(player, action);
            }
        });
    };
    player.el.playlist.addEventListener('pointerdown', (e) => {
        if (e.button === 2) itemMenu(e);
    }, true);
    const categoryMenu = () => {
        cm.detachClickMenuFromElement(player.el.category);
        cm.attachClickMenuToElement(player.el.category, {
            position: 'anchor',
            anchorAlign: 'start',
            sections: [{
                type: 'list',
                items: [
                    { text: 'Music', action: 'category:music', icon: 'fas fa-music', indicatorStyle: 'dot', checked: player.library.category === 'music' },
                    { text: 'Video', action: 'category:video', icon: 'fas fa-film', indicatorStyle: 'dot', checked: player.library.category === 'video' },

                ]
            }],
            onAction: (action) => mediaPlayerRunAction(player, action)
        });
    };
    player.el.category.addEventListener('pointerdown', categoryMenu, true);
    player.el.category.addEventListener('focus', categoryMenu);
    categoryMenu();
}

// ---- toggles ----

function mediaPlayerSetListPane(player, on) {
    player.listPane = !!on;
    player.modal.classList.toggle('wmp-no-listpane', !player.listPane);
    player.el.listpaneArrow.title = player.listPane ? 'Hide List Pane' : 'Show List Pane';
}

function mediaPlayerSetShuffle(player, on) {
    player.shuffle = !!on;
    mediaPlayerSyncTransport(player);
}

function mediaPlayerSetRepeat(player, on) {
    player.repeat = !!on;
    mediaPlayerSyncTransport(player);
}

/** Compact mode, as WMP 11 has it: the window folds to its transport (96px: caption, the 60px bar, the frame) and
    back. Any resize below 201px folds it the same way (the VM snaps there), so the folded state follows the height;
    the button and Ctrl+1 switch between the folded window and the last unfolded size. */
function mediaPlayerSetCompact(player, on) {
    const modal = player.modal;
    const rect = modal.getBoundingClientRect();
    if (on) {
        if (rect.height > mediaPlayerBar.FOLDED_HEIGHT) player.fullRect = { width: rect.width, height: rect.height };
        modal.style.width = Math.max(mediaPlayerBar.MIN_WIDTH, player.compactWidth || mediaPlayerBar.MIN_WIDTH) + 'px';
        modal.style.height = mediaPlayerBar.FOLDED_HEIGHT + 'px';
    } else {
        if (rect.height <= mediaPlayerBar.FOLDED_HEIGHT) player.compactWidth = rect.width;
        const full = player.fullRect || { width: Number(modal.dataset.windowDefaultWidth), height: Number(modal.dataset.windowDefaultHeight) };
        modal.style.width = full.width + 'px';
        modal.style.height = full.height + 'px';
    }
    mediaPlayerBar.syncCompact(player);
}

function mediaPlayerFullScreen(player) {
    const stage = player.el.stage;
    if (document.fullscreenElement === stage) {
        document.exitFullscreen().catch(() => {});
        return;
    }
    if (!player.items.length || !stage.requestFullscreen) return;
    mediaPlayerShowView(player, 'now-playing', false);
    stage.requestFullscreen().catch(() => {});
}

function mediaPlayerSetVolume(player, value) {
    const media = player.el.media;
    media.volume = Math.max(0, Math.min(1, value));
    if (media.volume > 0 && media.muted) media.muted = false;
    mediaPlayerSyncTransport(player);
}

function mediaPlayerShowUrlDialog(player) {
    const dlg = player.urlDialog;
    dlg.input.value = '';
    mediaPlayerShowModal(dlg.modal);
    setTimeout(() => dlg.input.focus(), 0);
}

// ---- sliders ----

function mediaPlayerSliderValue(track, clientX) {
    const rect = track.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
}

function mediaPlayerWireSliders(player) {
    const media = player.el.media;
    const seek = player.el.seek;
    seek.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !Number.isFinite(media.duration) || !media.duration) return;
        e.preventDefault();
        seek.setPointerCapture(e.pointerId);
        player.scrubbing = true;
        player.scrubTime = mediaPlayerBar.seekValue(seek, e.clientX) * media.duration;
        mediaPlayerSyncClock(player);
    });
    seek.addEventListener('pointermove', (e) => {
        if (!player.scrubbing) return;
        player.scrubTime = mediaPlayerBar.seekValue(seek, e.clientX) * media.duration;
        mediaPlayerSyncClock(player);
    });
    const endScrub = (e) => {
        if (!player.scrubbing) return;
        player.scrubbing = false;
        try {
            media.currentTime = mediaPlayerBar.seekValue(seek, e.clientX) * media.duration;
        } catch (err) { /* not seekable */ }
        mediaPlayerSyncClock(player);
    };
    seek.addEventListener('pointerup', endScrub);
    seek.addEventListener('lostpointercapture', () => {
        if (!player.scrubbing) return;
        player.scrubbing = false;
        mediaPlayerSyncClock(player);
    });
    seek.addEventListener('pointercancel', () => {
        player.scrubbing = false;
        mediaPlayerSyncClock(player);
    });
    seek.addEventListener('keydown', (e) => {
        if (!Number.isFinite(media.duration)) return;
        const step = e.key === 'ArrowRight' ? 5 : e.key === 'ArrowLeft' ? -5 : 0;
        if (!step) return;
        e.preventDefault();
        media.currentTime = Math.max(0, Math.min(media.duration, media.currentTime + step));
    });

    player.el.volumes.forEach((volume) => {
        const track = volume.querySelector('.wmp-volume-track');
        let volDrag = false;
        volume.addEventListener('pointerdown', (e) => {
            if (e.button !== 0) return;
            e.preventDefault();
            volume.setPointerCapture(e.pointerId);
            volDrag = true;
            volume.classList.add('is-dragging');
            mediaPlayerSetVolume(player, mediaPlayerSliderValue(track, e.clientX));
        });
        volume.addEventListener('pointermove', (e) => {
            if (volDrag) mediaPlayerSetVolume(player, mediaPlayerSliderValue(track, e.clientX));
        });
        const endVol = () => { volDrag = false; volume.classList.remove('is-dragging'); };
        volume.addEventListener('pointerup', endVol);
        volume.addEventListener('pointercancel', endVol);
        // a release the window never saw (another window took the pointer) must not leave the thumb pressed
        volume.addEventListener('lostpointercapture', endVol);
        volume.addEventListener('keydown', (e) => {
            const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? 0.05 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -0.05 : 0;
            if (!step) return;
            e.preventDefault();
            mediaPlayerSetVolume(player, media.volume + step);
        });
        volume.addEventListener('wheel', (e) => {
            e.preventDefault();
            mediaPlayerSetVolume(player, media.volume + (e.deltaY < 0 ? 0.05 : -0.05));
        }, { passive: false });
    });
}

// ---- keyboard (WMP's shortcuts, while the window has focus) ----

function mediaPlayerKeydown(player, e) {
    const target = e.target;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
    if (e.ctrlKey && !e.altKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        const map = { p: 'play-pause', s: 'stop', b: 'previous', f: 'next', h: 'shuffle', t: 'repeat', o: 'open-file', u: 'open-url' };
        if (map[key]) {
            e.preventDefault();
            mediaPlayerRunAction(player, map[key]);
            return;
        }
        // Ctrl+1: full mode (unfolds a compact window). Ctrl+2 is WMP 11's skin mode (the Corporate skin), not built.
        if (key === '1') {
            e.preventDefault();
            if (player.compact) mediaPlayerSetCompact(player, false);
            return;
        }
        return;
    }
    if (e.altKey && e.key === 'Enter') {
        e.preventDefault();
        mediaPlayerFullScreen(player);
        return;
    }
    if (e.key === 'F7') {
        e.preventDefault();
        player.el.media.muted = !player.el.media.muted;
        mediaPlayerSyncTransport(player);
    } else if (e.key === 'F8') {
        e.preventDefault();
        mediaPlayerSetVolume(player, player.el.media.volume - 0.05);
    } else if (e.key === 'F9') {
        e.preventDefault();
        mediaPlayerSetVolume(player, player.el.media.volume + 0.05);
    } else if (e.key === ' ' && !typing) {
        e.preventDefault();
        mediaPlayerToggle(player);
    }
}

// ---- build ----

function createDesktopMediaPlayer() {
    const modal = document.createElement('div');
    modal.id = 'desktopMediaPlayer';
    modal.className = 'modal hidden resizeable-window wmp';
    modal.dataset.windowIdentifier = 'desktop-media-player';
    modal.dataset.windowClient = 'light';
    // WMP 11's smallest window: 374 wide, and 96 high folded (anything under 201 folds)
    modal.dataset.windowMinWidth = String(mediaPlayerBar.MIN_WIDTH);
    modal.dataset.windowMinHeight = String(mediaPlayerBar.FOLDED_HEIGHT);
    modal.dataset.windowDefaultWidth = '1000';
    modal.dataset.windowDefaultHeight = '706';
    modal.dataset.windowMaxWidth = '2400';
    modal.dataset.windowMaxHeight = '1600';
    modal.innerHTML = mediaPlayerCaptionHtml();
    const content = document.createElement('div');
    content.className = 'modal-content wmp-content';
    content.innerHTML = mediaPlayerBodyHtml();
    modal.appendChild(content);

    const q = (sel) => content.querySelector(sel);
    const el = {
        tabstrip: q('.wmp-tabstrip'),
        tabs: Array.from(content.querySelectorAll('.wmp-tab')),
        views: Array.from(content.querySelectorAll('.wmp-view')),
        back: q('.wmp-orb-back'),
        forward: q('.wmp-orb-forward'),
        stage: q('.wmp-stage'),
        media: q('.wmp-stage video'),
        stageArt: q('.wmp-stage-art'),
        status: q('.wmp-stage-status'),
        listpane: q('.wmp-listpane'),
        listpaneArrow: q('.wmp-listpane .wmp-listpane-arrow'),
        listpaneArt: q('.wmp-listpane-art'),
        frame: q('.wmp-listpane-frame'),
        listpaneIcon: q('.wmp-listpane-icon'),
        listpaneTitle: q('.wmp-listpane-title'),
        listpaneName: q('.wmp-listpane-name'),
        listpaneClear: q('.wmp-listpane-clear'),
        playlist: q('.wmp-playlist'),
        category: q('.wmp-category'),
        categoryIcon: q('.wmp-category img'),
        crumbs: q('.wmp-crumbs'),
        search: q('.wmp-search input'),
        addrArrow: q('.wmp-addr-arrow'),
        navItems: [],
        listHead: q('.wmp-list-head'),
        tree: q('.wmp-tree'),
        list: q('.wmp-list'),
        listNote: q('.wmp-list-note'),
        blankText: q('.wmp-blank p'),
        transport: q('.wmp-transport'),
        seek: q('.wmp-seek'),
        now: q('.wmp-now'),
        nowThumb: q('.wmp-now-thumb'),
        nowCanvas: q('.wmp-now-thumb canvas'),
        nowIcon: q('.wmp-now-thumb img'),
        nowTitle: q('.wmp-now-title'),
        time: q('.wmp-time'),
        shuffle: q('.wmp-shuffle'),
        repeat: q('.wmp-repeat'),
        stop: q('.wmp-stop'),
        prev: q('.wmp-prev'),
        play: q('.wmp-play'),
        next: q('.wmp-next'),
        mute: q('.wmp-mute'),
        volume: q('.wmp-pill .wmp-volume'),
        volumes: Array.from(content.querySelectorAll('.wmp-volume')),
        volarrow: q('.wmp-volarrow'),
        caption: modal.querySelector('.modal-window-title span'),
        volpop: q('.wmp-volpop'),
        fullscreen: q('.wmp-fullscreen'),
        compact: q('.wmp-compact'),
        file: q('.wmp-file')
    };

    const player = {
        modal: modal,
        content: content,
        el: el,
        items: [],
        index: -1,
        seq: 0,
        shuffle: false,
        repeat: false,
        listPane: true,
        compact: false,
        view: 'now-playing',
        history: [],
        historyIndex: -1,
        library: { source: 'local', category: 'music', view: 'songs', mode: 'library', filter: null, data: {}, rows: [], groups: [], loaded: false, token: 0 },
        epoch: 0,
        clearEpoch: 0,
        objectUrl: null,
        scrubbing: false,
        scrubTime: 0,
        stopped: false
    };
    player.urlDialog = mediaPlayerBuildUrlDialog(player);

    const media = el.media;
    media.volume = 1;
    media.addEventListener('play', () => { player.stopped = false; mediaPlayerSyncTransport(player); });
    media.addEventListener('pause', () => mediaPlayerSyncTransport(player));
    media.addEventListener('ended', () => {
        if (!mediaPlayerStep(player, 1)) mediaPlayerSyncTransport(player);
    });
    media.addEventListener('timeupdate', () => {
        mediaPlayerSyncClock(player);
        if (!player.nowTimer) mediaPlayerBar.syncNowLine(player);
    });
    // "Media changing..." until the first frame
    media.addEventListener('loadeddata', () => {
        if (!player.changing) return;
        player.changing = false;
        mediaPlayerSyncTransport(player);
    });
    media.addEventListener('loadedmetadata', () => mediaPlayerSyncTransport(player));
    media.addEventListener('durationchange', () => mediaPlayerSyncClock(player));
    media.addEventListener('loadeddata', () => mediaPlayerPaintFrame(player, true));
    media.addEventListener('seeked', () => {
        if (!player.scrubbing) mediaPlayerPaintFrame(player, true);
    });
    media.addEventListener('volumechange', () => mediaPlayerSyncTransport(player));
    media.addEventListener('error', () => {
        if (player.clearEpoch === player.epoch) return;
        if (!media.getAttribute('src')) return;
        player.changing = false;
        mediaPlayerStatus(player, DESKTOP_MEDIA_ASSIST);
        mediaPlayerSyncTransport(player);
    });
    media.addEventListener('click', () => mediaPlayerToggle(player));
    media.addEventListener('dblclick', () => mediaPlayerFullScreen(player));

    el.tabs.forEach((tab) => {
        tab.querySelector('.wmp-tab-label').addEventListener('click', () => mediaPlayerShowView(player, tab.dataset.tab));
    });
    el.back.addEventListener('click', () => mediaPlayerGo(player, -1));
    el.forward.addEventListener('click', () => mediaPlayerGo(player, 1));

    el.play.addEventListener('click', () => mediaPlayerToggle(player));
    el.stop.addEventListener('click', () => mediaPlayerStop(player));
    mediaPlayerBar.wireSeekButtons(player);
    el.shuffle.addEventListener('click', () => mediaPlayerSetShuffle(player, !player.shuffle));
    el.repeat.addEventListener('click', () => mediaPlayerSetRepeat(player, !player.repeat));
    el.mute.addEventListener('click', () => {
        media.muted = !media.muted;
        mediaPlayerSyncTransport(player);
    });
    el.fullscreen.addEventListener('click', () => mediaPlayerFullScreen(player));
    el.compact.addEventListener('click', () => mediaPlayerSetCompact(player, !player.compact));
    el.volarrow.addEventListener('click', () => mediaPlayerBar.setVolumePopup(player, el.volpop.classList.contains('hidden')));
    el.volpop.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        mediaPlayerBar.setVolumePopup(player, false);
        el.volarrow.focus();
    });
    el.time.addEventListener('click', () => { player.timeTotal = !player.timeTotal; mediaPlayerSyncClock(player); });
    el.transport.addEventListener('focusin', (e) => mediaPlayerBar.syncFocus(player, e.target));
    el.nowThumb.addEventListener('click', () => mediaPlayerShowView(player, 'now-playing'));
    [el.time, el.nowThumb].forEach((node) => node.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        node.click();
    }));
    // the fold follows the window's height (a resize below 201px snaps to the folded 96px, as on the VM)
    modal.windowResizeConstrain = (width, height) => ({ width, height: height < mediaPlayerBar.UNFOLD_MIN ? mediaPlayerBar.FOLDED_HEIGHT : height });
    new ResizeObserver((entries) => mediaPlayerBar.syncCompact(player, entries[0] && entries[0].borderBoxSize && entries[0].borderBoxSize[0] ? entries[0].borderBoxSize[0].blockSize : 0)).observe(modal);
    el.listpaneArrow.addEventListener('click', () => mediaPlayerSetListPane(player, !player.listPane));
    el.listpaneClear.addEventListener('click', () => mediaPlayerClear(player));
    el.listpaneTitle.addEventListener('click', () => {
        if (player.index >= 0) mediaPlayerPlayIndex(player, player.index);
    });
    el.playlist.addEventListener('dblclick', (e) => {
        const btn = e.target.closest('.wmp-playlist-item');
        if (!btn) return;
        const at = player.items.findIndex((item) => item.id === Number(btn.dataset.id));
        if (at !== -1) mediaPlayerPlayIndex(player, at);
    });
    el.playlist.addEventListener('click', (e) => {
        const btn = e.target.closest('.wmp-playlist-item');
        if (!btn) return;
        el.playlist.querySelectorAll('.is-selected').forEach((b) => b.classList.remove('is-selected'));
        btn.classList.add('is-selected');
    });
    el.playlist.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const btn = e.target.closest('.wmp-playlist-item');
        if (!btn) return;
        const at = player.items.findIndex((item) => item.id === Number(btn.dataset.id));
        if (at !== -1) mediaPlayerPlayIndex(player, at);
    });

    el.addrArrow.addEventListener('click', () => mediaPlayerShowView(player, 'now-playing'));
    el.crumbs.addEventListener('click', (e) => {
        const crumb = e.target.closest('.wmp-crumb');
        if (!crumb || !crumb.dataset.nav) return;
        if (crumb.dataset.nav === 'category') { el.category.focus(); return; }
        mediaPlayerNav(player, crumb.dataset.nav);
    });
    el.search.addEventListener('input', () => mediaPlayerRenderLibrary(player));
    el.tree.addEventListener('click', (e) => {
        const toggle = e.target.closest('.wmp-tree-toggle');
        if (toggle) {
            const node = toggle.closest('.wmp-tree-node');
            node.classList.toggle('is-open');
            const lib = player.library;
            if (lib.open && node.dataset.node) lib.open[node.dataset.node] = node.classList.contains('is-open');
            let leaf = node.nextElementSibling;
            while (leaf && leaf.classList.contains('wmp-tree-leaf')) {
                leaf.classList.toggle('hidden', !node.classList.contains('is-open'));
                leaf = leaf.nextElementSibling;
            }
            return;
        }
        const item = e.target.closest('.wmp-tree-item');
        if (item) mediaPlayerNav(player, item.dataset.nav);
    });
    el.list.addEventListener('click', (e) => {
        // a star in a song's Rating column rates it (clicking its own rating again clears it, as in WMP)
        const star = e.target.closest('.wmp-stars[data-rate] .wmp-star');
        if (star) {
            const key = star.parentElement.dataset.rate;
            const t = (player.library.rows || []).find((x) => x.key === key);
            if (t) {
                const n = Number(star.dataset.star) || 0;
                mediaPlayerLibrary.setRating(t, mediaPlayerLibrary.ratingOf(t) === n ? 0 : n);
                mediaPlayerRenderLibrary(player);
            }
            return;
        }
        const row = e.target.closest('.wmp-row');
        if (!row) return;
        el.list.querySelectorAll('.is-selected').forEach((r) => r.classList.remove('is-selected'));
        row.classList.add('is-selected');
    });
    el.list.addEventListener('dblclick', (e) => {
        const row = e.target.closest('.wmp-row');
        if (row) mediaPlayerActivateRow(player, row.dataset.key);
    });
    el.list.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const row = e.target.closest('.wmp-row');
        if (row) mediaPlayerActivateRow(player, row.dataset.key);
    });
    el.file.addEventListener('change', () => {
        const files = Array.from(el.file.files || []);
        el.file.value = '';
        mediaPlayerOpenFiles(player, files);
    });
    content.addEventListener('dragover', (e) => {
        if (e.dataTransfer && Array.from(e.dataTransfer.types).indexOf('Files') !== -1) e.preventDefault();
    });
    content.addEventListener('drop', (e) => {
        if (!e.dataTransfer || !e.dataTransfer.files || !e.dataTransfer.files.length) return;
        e.preventDefault();
        mediaPlayerOpenFiles(player, e.dataTransfer.files);
    });
    modal.addEventListener('keydown', (e) => mediaPlayerKeydown(player, e));
    document.addEventListener('fullscreenchange', () => {
        el.stage.classList.toggle('is-fullscreen', document.fullscreenElement === el.stage);
    });

    mediaPlayerWireSliders(player);
    mediaPlayerAttachMenus(player);

    modal.querySelector('.close-btn').addEventListener('click', () => {
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    });
    modal.addEventListener('animationend', (e) => {
        if (e.target !== modal || e.animationName !== 'modalSlideOut') return;
        mediaPlayerClear(player);
        if (document.fullscreenElement === el.stage) document.exitFullscreen().catch(() => {});
    });

    mediaPlayerSetListPane(player, true);
    mediaPlayerSyncNow(player);
    mediaPlayerSyncTransport(player);
    mediaPlayerLibrary.renderTree(player);
    mediaPlayerRenderCrumbs(player);
    // the server's library changed (a file added or removed in the VFS, modules/mediaLibrary.js): read again when seen
    if (window.wsClient && typeof window.wsClient.on === 'function') {
        window.wsClient.on('media_library_changed', () => {
            const d = player.library.data.local;
            if (d) d.stale = true;
            if (player.view === 'library' && player.library.source === 'local' && !modal.classList.contains('hidden')) void mediaPlayerLibrary.loadLibrary(player, true);
        }, { signal: mediaPlayerLibrary.signal });
    }
    mediaPlayerShowView(player, 'now-playing');
    document.body.appendChild(modal);
    return player;
}

function ensureDesktopMediaPlayer() {
    if (!desktopMediaPlayer) desktopMediaPlayer = createDesktopMediaPlayer();
    return desktopMediaPlayer;
}

function mediaPlayerShowModal(modal) {
    if (modal.classList.contains('closing')) {
        // closeModal cleanup finishes on animation end or its fallback.
        setTimeout(() => {
            if (!modal.classList.contains('closing')) mediaPlayerShowModal(modal);
        }, 650);
        return;
    }
    const onScreen = !modal.classList.contains('hidden') && !modal.classList.contains('hidden-alt');
    if (onScreen) {
        if (modal.classList.contains('minimised')) {
            // restoreMinimizedModal, getOrCreateTaskbarItem: public/scripts/comp/modalUtils.js
            restoreMinimizedModal(modal, getOrCreateTaskbarItem(modal));
        }
        // bringModalToFront: public/scripts/comp/modalUtils.js
        bringModalToFront(modal);
        return;
    }
    // openModal: public/scripts/comp/modalUtils.js
    openModal(modal);
    bringModalToFront(modal);
}

// ---- entry points ----

/** Open the Media Player; { view: 'library' } lands on the Library tab. */
function openDesktopMediaPlayer(options) {
    const player = ensureDesktopMediaPlayer();
    mediaPlayerShowModal(player.modal);
    if (options && options.view) mediaPlayerShowView(player, options.view);
    return player;
}

// The old launchers (Music, Video) and Run aliases land on the one player.
function openDesktopMusicPlayer() {
    return openDesktopMediaPlayer();
}

function openDesktopVideoPlayer() {
    return openDesktopMediaPlayer();
}

// Open a media URL (e.g. an eMotion WebM/MP4 result from the gallery) and play it.
// Used by the gallery / image viewer "Open in Media Player" actions (galleryActions.js, emotion.js).
function openDesktopMediaPlayerUrl(url, label) {
    const player = openDesktopMediaPlayer();
    if (url) mediaPlayerOpenUrl(player, url, label);
    return player;
}
const openDesktopVideoPlayerUrl = openDesktopMediaPlayerUrl;
window.openDesktopMediaPlayer = openDesktopMediaPlayer;
window.openDesktopMediaPlayerUrl = openDesktopMediaPlayerUrl;
window.openDesktopVideoPlayerUrl = openDesktopVideoPlayerUrl;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        WMP_TABS, WMP_BLANK_PAGES, WMP_TYPE_NAMES, mediaPlayerKindFor, mediaPlayerCanPlay, mediaPlayerTitle,
        mediaPlayerTypeName, mediaPlayerNextIndex, mediaPlayerMenuItems, mediaPlayerLibrary,
        mediaPlayerBodyHtml, findDesktopMediaRow, desktopMediaClock, desktopMediaNameFromUrl, mediaPlayerNowLines: mediaPlayerBar.nowLines
    };
}
