// MeletonFX Media Player: Windows Media Player 11 on the Vista desktop (Yozora #454).
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
        + '<span>Media Player</span>'
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
        + '<div class="wmp-tree">'
        + '<div class="wmp-tree-node is-open" data-node="playlists"><button type="button" class="wmp-tree-toggle" aria-label="Collapse"></button><button type="button" class="wmp-tree-item" data-nav="playlists"><img src="' + WMP_ART + '/nav-playlists.png" alt="" width="16" height="16"><span>Playlists</span></button></div>'
        + '<div class="wmp-tree-leaf"><button type="button" class="wmp-tree-item wmp-tree-create" data-nav="create-playlist"><img src="' + WMP_ART + '/nav-playlists.png" alt="" width="16" height="16"><span>Create Playlist</span></button></div>'
        + '<div class="wmp-tree-leaf"><button type="button" class="wmp-tree-item" data-nav="now-playing"><img src="' + WMP_ART + '/nav-now-playing.png" alt="" width="16" height="16"><span>Now Playing</span></button></div>'
        + '<div class="wmp-tree-node is-open" data-node="library"><button type="button" class="wmp-tree-toggle" aria-label="Collapse"></button><button type="button" class="wmp-tree-item" data-nav="library"><img src="' + WMP_ART + '/nav-library.png" alt="" width="16" height="16"><span>Library</span></button></div>'
        + '<div class="wmp-tree-leaf"><button type="button" class="wmp-tree-item" data-nav="recently-added"><img src="' + WMP_ART + '/nav-recently-added.png" alt="" width="16" height="16"><span>Recently Added</span></button></div>'
        + '<div class="wmp-tree-leaf"><button type="button" class="wmp-tree-item" data-nav="music"><img src="' + WMP_ART + '/nav-songs.png" alt="" width="16" height="16"><span>Music</span></button></div>'
        + '<div class="wmp-tree-leaf"><button type="button" class="wmp-tree-item" data-nav="video"><img src="' + WMP_ART + '/nav-video.png" alt="" width="16" height="16"><span>Video</span></button></div>'
        + '<div class="wmp-tree-leaf"><button type="button" class="wmp-tree-item" data-nav="all"><img src="' + WMP_ART + '/nav-album.png" alt="" width="16" height="16"><span>All Files</span></button></div>'
        + '</div>'
        + '</div>'
        + '<div class="wmp-list-host">'
        + '<div class="wmp-list-head"><span class="wmp-col-title">Title</span><span class="wmp-col-type">Type</span><span class="wmp-col-length">Length</span><span class="wmp-col-date">Date modified</span></div>'
        + '<div class="wmp-list" role="listbox"></div>'
        + '<p class="wmp-list-note hidden"></p>'
        + '</div>'
        + '</div>'
        + '</div>'
        // Rip / Burn / Sync / Online Stores
        + '<div class="wmp-view wmp-blank hidden" data-view="blank"><p></p></div>'
        + '</div>'
        // transport (the glass)
        + '<div class="wmp-transport">'
        + '<div class="wmp-seek" role="slider" aria-label="Seek" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0"><div class="wmp-seek-fill"></div><div class="wmp-seek-thumb"></div></div>'
        + '<div class="wmp-transport-row">'
        + '<div class="wmp-now-side">'
        + '<div class="wmp-now"><div class="wmp-now-thumb"><canvas width="36" height="24"></canvas><img src="' + WMP_ART + '/art-music.png" alt=""></div><span class="wmp-now-title"></span></div>'
        + '<span class="wmp-time">00:00</span>'
        + '</div>'
        + '<div class="wmp-pill">'
        + '<button type="button" class="wmp-tbtn wmp-shuffle" title="Turn Shuffle On" aria-pressed="false"></button>'
        + '<button type="button" class="wmp-tbtn wmp-repeat" title="Turn Repeat On" aria-pressed="false"></button>'
        + '<span class="wmp-pill-rule"></span>'
        + '<button type="button" class="wmp-tbtn wmp-stop" title="Stop" disabled></button>'
        + '<div class="wmp-group">'
        + '<button type="button" class="wmp-tbtn wmp-prev" title="Previous" disabled></button>'
        + '<button type="button" class="wmp-orbbtn wmp-play" title="Play" disabled><span class="wmp-orb-halo"></span><span class="wmp-orb-face"></span></button>'
        + '<button type="button" class="wmp-tbtn wmp-next" title="Next" disabled></button>'
        + '</div>'
        + '<button type="button" class="wmp-tbtn wmp-mute" title="Mute" aria-pressed="false"></button>'
        + '<div class="wmp-volume" role="slider" aria-label="Volume" aria-valuemin="0" aria-valuemax="100" aria-valuenow="100"><div class="wmp-volume-track"><div class="wmp-volume-fill"></div></div><div class="wmp-volume-thumb"></div></div>'
        + '</div>'
        + '<div class="wmp-stack">'
        + '<button type="button" class="wmp-fullscreen" title="View Full Screen" aria-label="View Full Screen"></button>'
        + '<button type="button" class="wmp-compact" title="Switch to Compact Mode" aria-label="Switch to Compact Mode"></button>'
        + '</div>'
        + '</div>'
        + '</div>'
        + '<input type="file" class="hidden wmp-file" multiple accept="audio/*,video/*,.mp3,.ogg,.wav,.aac,.m4a,.flac,.mp4,.webm">';
}

// ---- the Open URL dialog (WMP's: File > Open URL, Ctrl+U) ----

function mediaPlayerBuildUrlDialog(player) {
    const modal = document.createElement('div');
    modal.id = 'desktopMediaPlayerUrl';
    modal.className = 'modal hidden wmp-url-dialog';
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
            kind: mediaPlayerKindFor(entry.name || desktopMediaNameFromUrl(entry.url), entry.mime || (entry.file && entry.file.type) || '')
        });
    });
    mediaPlayerRenderPlaylist(player);
    mediaPlayerSyncTransport(player);
    if (play && player.items.length > first) mediaPlayerPlayIndex(player, first);
}

function mediaPlayerReleaseSource(player) {
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
    media.src = url;
    mediaPlayerSyncNow(player);
    mediaPlayerSyncTransport(player);
    if (!(options && options.paused)) {
        const pending = media.play();
        if (pending && pending.catch) pending.catch((err) => {
            if (err && err.name === 'AbortError') return;
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
    if (!media.getAttribute('src')) {
        if (player.items.length) mediaPlayerPlayIndex(player, player.index >= 0 ? player.index : 0);
        return;
    }
    if (media.paused || media.ended) {
        const pending = media.play();
        if (pending && pending.catch) pending.catch((err) => {
            if (err && err.name === 'AbortError') return;
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
    player.el.nowTitle.textContent = title;
    player.el.nowTitle.title = item ? item.name : '';
    const art = item && item.kind === 'video' ? 'art-video' : 'art-music';
    player.el.stageArt.src = WMP_ART + '/' + art + '.png';
    player.el.listpaneIcon.src = WMP_ART + '/' + art + '.png';
    player.el.nowIcon.src = WMP_ART + '/' + art + '.png';
    player.el.listpane.classList.toggle('has-item', !!item);
    player.el.now.classList.toggle('has-item', !!item);
}

function mediaPlayerSyncTransport(player) {
    const media = player.el.media;
    const el = player.el;
    const hasSource = !!media.getAttribute('src');
    const playing = hasSource && !media.paused && !media.ended;
    const n = player.items.length;
    el.play.disabled = !n && !hasSource;
    el.play.classList.toggle('is-playing', playing);
    el.play.title = playing ? 'Pause' : 'Play';
    el.stop.disabled = !hasSource;
    el.prev.disabled = !n || mediaPlayerNextIndex(player, -1) === -1;
    el.next.disabled = !n || mediaPlayerNextIndex(player, 1) === -1;
    el.shuffle.setAttribute('aria-pressed', String(player.shuffle));
    el.shuffle.title = player.shuffle ? 'Turn Shuffle Off' : 'Turn Shuffle On';
    el.repeat.setAttribute('aria-pressed', String(player.repeat));
    el.repeat.title = player.repeat ? 'Turn Repeat Off' : 'Turn Repeat On';
    const level = media.muted || media.volume === 0 ? 'mute' : media.volume < 0.34 ? 'low' : media.volume < 0.67 ? 'mid' : 'high';
    el.mute.dataset.level = level;
    el.mute.setAttribute('aria-pressed', String(media.muted));
    el.mute.title = media.muted ? 'Sound' : 'Mute';
    const volumePct = Math.round(media.volume * 100);
    el.volume.style.setProperty('--wmp-volume', volumePct + '%');
    el.volume.style.setProperty('--wmp-volume-frac', String(media.volume));
    el.volume.setAttribute('aria-valuenow', String(volumePct));
    mediaPlayerSyncClock(player);
}

function mediaPlayerSyncClock(player) {
    const media = player.el.media;
    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    const now = player.scrubbing ? player.scrubTime : (Number.isFinite(media.currentTime) ? media.currentTime : 0);
    const pct = duration > 0 ? Math.min(100, (now / duration) * 100) : 0;
    player.el.seek.style.setProperty('--wmp-seek', pct + '%');
    player.el.seek.setAttribute('aria-valuemax', String(Math.round(duration)));
    player.el.seek.setAttribute('aria-valuenow', String(Math.round(now)));
    player.el.seek.classList.toggle('is-ready', duration > 0);
    const shown = desktopMediaClock(now);
    player.el.time.textContent = shown.length < 5 ? '0' + shown : shown;
}

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
    if (id === 'library' && !player.library.loaded) mediaPlayerLoadFolder(player, player.library.path);
    if (record !== false) mediaPlayerRecord(player);
}

function mediaPlayerRecord(player) {
    const entry = { view: player.view, path: player.library.path, mode: player.library.mode };
    const last = player.history[player.historyIndex];
    if (last && last.view === entry.view && last.path === entry.path && last.mode === entry.mode) return;
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
    player.library.mode = entry.mode;
    if (entry.view === 'library') {
        if (entry.mode === 'folder') mediaPlayerLoadFolder(player, entry.path, false);
        else mediaPlayerRenderLibrary(player);
    }
    mediaPlayerShowView(player, entry.view, false);
    mediaPlayerSyncOrbs(player);
}

// ---- Library ----

function mediaPlayerLibraryAccepts(player, item) {
    if (desktopVfsItemIsFolder(item)) return true;
    const kind = mediaPlayerKindFor(item.name, item.mimeType);
    if (player.library.category === 'music') return kind === 'audio';
    if (player.library.category === 'video') return kind === 'video';
    return !!kind;
}

function mediaPlayerSetCategory(player, category) {
    player.library.category = category;
    const icon = category === 'video' ? 'nav-video' : category === 'music' ? 'nav-music' : 'nav-album';
    player.el.categoryIcon.src = WMP_ART + '/' + icon + '.png';
    player.el.navItems.forEach((btn) => btn.classList.toggle('is-current', btn.dataset.nav === (player.library.mode === 'folder' ? category : player.library.mode)));
    mediaPlayerRenderLibrary(player);
}

async function mediaPlayerLoadFolder(player, path, record) {
    const lib = player.library;
    const next = path || '/';
    lib.token += 1;
    const token = lib.token;
    lib.mode = 'folder';
    lib.path = next;
    lib.loaded = true;
    mediaPlayerRenderCrumbs(player);
    player.el.listNote.textContent = 'Loading...';
    player.el.listNote.classList.remove('hidden');
    try {
        // vfsClient.listDirectory: public/scripts/comp/vfsClient.js
        const result = await vfsClient.listDirectory(next, {
            offset: 0,
            limit: 400,
            sortField: 'name',
            sortDirection: 'asc',
            search: ''
        });
        if (token !== lib.token) return;
        lib.path = (result && result.path) || next;
        lib.items = (result && result.items) || [];
        mediaPlayerRenderCrumbs(player);
        mediaPlayerRenderLibrary(player);
        if (record !== false) mediaPlayerRecord(player);
    } catch (err) {
        if (token !== lib.token) return;
        lib.items = [];
        player.el.list.innerHTML = '';
        player.el.listNote.textContent = (err && err.message) || 'Media Player cannot list this folder.';
        player.el.listNote.classList.remove('hidden');
    }
}

function mediaPlayerRenderCrumbs(player) {
    const lib = player.library;
    const parts = String(lib.path || '/').split('/').filter(Boolean);
    const crumbs = [{ label: 'Library', path: '/' }];
    parts.forEach((part, i) => crumbs.push({ label: part, path: '/' + parts.slice(0, i + 1).join('/') }));
    if (lib.mode === 'now-playing') crumbs.push({ label: 'Now Playing', path: '' });
    player.el.crumbs.innerHTML = crumbs.map((c) => '<span class="wmp-crumb-sep" aria-hidden="true"></span><button type="button" class="wmp-crumb" data-path="' + mediaPlayerEsc(c.path) + '">' + mediaPlayerEsc(c.label) + '</button>').join('');
}

function mediaPlayerRenderLibrary(player) {
    const lib = player.library;
    const filter = String(player.el.search.value || '').trim().toLowerCase();
    let rows;
    if (lib.mode === 'now-playing') {
        rows = player.items.map((item, i) => ({
            key: 'np:' + item.id, name: item.name, icon: item.kind === 'video' ? 'nav-video' : 'nav-songs',
            type: mediaPlayerTypeName(item), length: '', date: '', current: i === player.index
        }));
    } else {
        rows = lib.items.filter((item) => mediaPlayerLibraryAccepts(player, item)).map((item, i) => ({
            key: 'vfs:' + i, name: item.name || '', folder: desktopVfsItemIsFolder(item),
            icon: desktopVfsItemIsFolder(item) ? 'nav-library' : (mediaPlayerKindFor(item.name, item.mimeType) === 'video' ? 'nav-video' : 'nav-songs'),
            type: mediaPlayerTypeName(item), length: '', date: mediaPlayerDate(item.modifiedAt)
        }));
    }
    if (filter) rows = rows.filter((r) => r.name.toLowerCase().indexOf(filter) !== -1);
    player.el.list.innerHTML = rows.map((r) => ''
        + '<div class="wmp-row' + (r.current ? ' is-current' : '') + (r.folder ? ' is-folder' : '') + '" role="option" data-key="' + r.key + '" tabindex="-1">'
        + '<span class="wmp-col-title"><img src="' + WMP_ART + '/' + r.icon + '.png" alt="" width="16" height="16">' + mediaPlayerEsc(r.folder ? r.name : mediaPlayerTitle(r.name)) + '</span>'
        + '<span class="wmp-col-type">' + mediaPlayerEsc(r.type) + '</span>'
        + '<span class="wmp-col-length">' + mediaPlayerEsc(r.length) + '</span>'
        + '<span class="wmp-col-date">' + mediaPlayerEsc(r.date) + '</span>'
        + '</div>').join('');
    const empty = !rows.length;
    player.el.listNote.textContent = empty
        ? (lib.mode === 'now-playing' ? 'There are no items in the Now Playing list.' : (filter ? 'No items match your search.' : 'There are no items in this view.'))
        : '';
    player.el.listNote.classList.toggle('hidden', !empty);
}

function mediaPlayerNav(player, nav) {
    const lib = player.library;
    player.el.navItems.forEach((btn) => btn.classList.toggle('is-current', btn.dataset.nav === nav));
    if (nav === 'now-playing' || nav === 'playlists' || nav === 'create-playlist') {
        lib.mode = 'now-playing';
        mediaPlayerRenderCrumbs(player);
        mediaPlayerRenderLibrary(player);
        mediaPlayerRecord(player);
        return;
    }
    if (nav === 'music' || nav === 'video' || nav === 'all') lib.category = nav;
    if (nav === 'recently-added' || nav === 'library') lib.category = 'all';
    const icon = lib.category === 'video' ? 'nav-video' : lib.category === 'music' ? 'nav-music' : 'nav-album';
    player.el.categoryIcon.src = WMP_ART + '/' + icon + '.png';
    if (lib.mode !== 'folder' || !lib.loaded) {
        mediaPlayerLoadFolder(player, lib.path);
        return;
    }
    mediaPlayerRenderCrumbs(player);
    mediaPlayerRenderLibrary(player);
    mediaPlayerRecord(player);
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
    const item = player.library.items[Number(key.slice(4))];
    if (!item) return;
    if (desktopVfsItemIsFolder(item)) {
        mediaPlayerLoadFolder(player, desktopVfsFolderPath({ vfsPath: player.library.path }, item));
        return;
    }
    mediaPlayerOpenVfsItem(player, item, player.library.path);
}

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
            { text: 'All Files', action: 'category:all', indicatorStyle: 'dot', checked: player.library.category === 'all' },
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
    else if (action === 'refresh') mediaPlayerLoadFolder(player, player.library.path, false);
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
                    { text: 'All Files', action: 'category:all', icon: 'fas fa-folder', indicatorStyle: 'dot', checked: player.library.category === 'all' }
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

function mediaPlayerSetCompact(player, on) {
    player.compact = !!on;
    player.modal.classList.toggle('wmp-compact', player.compact);
    player.el.compact.title = player.compact ? 'Switch to Full Mode' : 'Switch to Compact Mode';
    if (player.compact) mediaPlayerShowView(player, 'now-playing', false);
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
        player.scrubTime = mediaPlayerSliderValue(seek, e.clientX) * media.duration;
        mediaPlayerSyncClock(player);
    });
    seek.addEventListener('pointermove', (e) => {
        if (!player.scrubbing) return;
        player.scrubTime = mediaPlayerSliderValue(seek, e.clientX) * media.duration;
        mediaPlayerSyncClock(player);
    });
    const endScrub = (e) => {
        if (!player.scrubbing) return;
        player.scrubbing = false;
        try {
            media.currentTime = mediaPlayerSliderValue(seek, e.clientX) * media.duration;
        } catch (err) { /* not seekable */ }
        mediaPlayerSyncClock(player);
    };
    seek.addEventListener('pointerup', endScrub);
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

    const volume = player.el.volume;
    const track = volume.querySelector('.wmp-volume-track');
    let volDrag = false;
    volume.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        volume.setPointerCapture(e.pointerId);
        volDrag = true;
        mediaPlayerSetVolume(player, mediaPlayerSliderValue(track, e.clientX));
    });
    volume.addEventListener('pointermove', (e) => {
        if (volDrag) mediaPlayerSetVolume(player, mediaPlayerSliderValue(track, e.clientX));
    });
    const endVol = () => { volDrag = false; };
    volume.addEventListener('pointerup', endVol);
    volume.addEventListener('pointercancel', endVol);
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
        if (key === '1' || key === '2') {
            e.preventDefault();
            mediaPlayerSetCompact(player, key === '2');
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
    modal.dataset.windowMinWidth = '640';
    modal.dataset.windowMinHeight = '420';
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
        navItems: Array.from(content.querySelectorAll('.wmp-tree-item')),
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
        volume: q('.wmp-volume'),
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
        library: { path: '/', items: [], category: 'music', mode: 'folder', loaded: false, token: 0 },
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
    media.addEventListener('timeupdate', () => mediaPlayerSyncClock(player));
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
    el.prev.addEventListener('click', () => mediaPlayerStep(player, -1));
    el.next.addEventListener('click', () => mediaPlayerStep(player, 1));
    el.shuffle.addEventListener('click', () => mediaPlayerSetShuffle(player, !player.shuffle));
    el.repeat.addEventListener('click', () => mediaPlayerSetRepeat(player, !player.repeat));
    el.mute.addEventListener('click', () => {
        media.muted = !media.muted;
        mediaPlayerSyncTransport(player);
    });
    el.fullscreen.addEventListener('click', () => mediaPlayerFullScreen(player));
    el.compact.addEventListener('click', () => mediaPlayerSetCompact(player, !player.compact));
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
        if (!crumb || !crumb.dataset.path) return;
        mediaPlayerLoadFolder(player, crumb.dataset.path);
        el.navItems.forEach((btn) => btn.classList.toggle('is-current', btn.dataset.nav === player.library.category));
    });
    el.search.addEventListener('input', () => mediaPlayerRenderLibrary(player));
    el.tree.addEventListener('click', (e) => {
        const toggle = e.target.closest('.wmp-tree-toggle');
        if (toggle) {
            const node = toggle.closest('.wmp-tree-node');
            node.classList.toggle('is-open');
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
    mediaPlayerRenderCrumbs(player);
    el.navItems.forEach((btn) => btn.classList.toggle('is-current', btn.dataset.nav === 'music'));
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
        mediaPlayerTypeName, mediaPlayerNextIndex, mediaPlayerMenuItems, mediaPlayerLibraryAccepts,
        mediaPlayerBodyHtml, findDesktopMediaRow, desktopMediaClock, desktopMediaNameFromUrl
    };
}
