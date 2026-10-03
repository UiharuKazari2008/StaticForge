// MeletonFX streamable music and video windows.
// public/scripts/comp/desktop-apps/mediaPlayers.js
//
// openModal, bringModalToFront, closeModal, restoreMinimizedModal, getOrCreateTaskbarItem:
//   public/scripts/comp/modalUtils.js
// vfsClient.listDirectory, getBasePath, downloadFile, downloadSystemFile:
//   public/scripts/comp/vfsClient.js
// GET /{vfsPathUuid}/fs/read returns raw bytes (no transcode):
//   modules/vfsFuseHttp.js

const DESKTOP_MEDIA_ASSIST = 'Playback assist is not in this slice.';

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

const desktopMediaPlayers = {
    audio: null,
    video: null
};

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

function desktopMediaIsStreamable(player, name, mime) {
    const row = findDesktopMediaRow(player.kind, name, mime);
    if (!row) return false;
    const clean = desktopMediaCleanMime(mime);
    const probe = clean && row.mimes.indexOf(clean) !== -1 ? clean : row.probe;
    return player.media.canPlayType(probe) !== '';
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

function setDesktopMediaStatus(player, text) {
    player.statusEl.textContent = text || '';
    if (text) player.statusEl.classList.remove('hidden');
    else player.statusEl.classList.add('hidden');
}

function setDesktopMediaVfsNote(player, text) {
    player.vfsNoteEl.textContent = text || '';
    if (text) player.vfsNoteEl.classList.remove('hidden');
    else player.vfsNoteEl.classList.add('hidden');
}

function syncDesktopMediaPlayIcon(player) {
    const icon = player.playBtn.querySelector('i');
    const playing = !player.media.paused && !player.media.ended;
    icon.className = playing ? 'fas fa-pause' : 'fas fa-play';
    player.playBtn.title = playing ? 'Pause' : 'Play';
}

function syncDesktopMediaClock(player) {
    const media = player.media;
    const duration = Number.isFinite(media.duration) ? media.duration : 0;
    player.seek.max = String(duration || 0);
    player.seek.disabled = !(duration > 0);
    if (!player.scrubbing) {
        const now = Number.isFinite(media.currentTime) ? media.currentTime : 0;
        player.seek.value = String(duration > 0 ? Math.min(now, duration) : 0);
    }
    const shown = player.scrubbing ? Number(player.seek.value) : media.currentTime;
    player.timeEl.textContent = desktopMediaClock(shown) + ' / ' + desktopMediaClock(duration);
    syncDesktopMediaRangeFill(player.seek);
}

function syncDesktopMediaRangeFill(input) {
    const min = Number(input.min);
    const max = Number(input.max);
    const val = Number(input.value);
    const span = max - min;
    const pct = span > 0 && Number.isFinite(val) ? ((val - min) / span) * 100 : 0;
    input.style.setProperty('--slider-fill', pct + '%');
}

function releaseDesktopMediaSource(player) {
    player.epoch += 1;
    player.clearEpoch = player.epoch;
    player.activeUrl = '';
    player.scrubbing = false;
    const previous = player.objectUrl;
    player.objectUrl = null;
    player.playBtn.disabled = true;
    player.media.pause();
    player.media.removeAttribute('src');
    player.media.load();
    if (previous) URL.revokeObjectURL(previous);
    syncDesktopMediaPlayIcon(player);
    syncDesktopMediaClock(player);
}

function assignDesktopMediaSource(player, url, label, isObjectUrl) {
    const previous = player.objectUrl;
    player.epoch += 1;
    player.clearEpoch = -1;
    player.activeUrl = url;
    player.media.dataset.mediaEpoch = String(player.epoch);
    player.objectUrl = isObjectUrl ? url : null;
    if (previous && previous !== url) URL.revokeObjectURL(previous);
    player.media.src = url;
    setDesktopMediaStatus(player, label || '');
    player.playBtn.disabled = false;
    syncDesktopMediaPlayIcon(player);
    syncDesktopMediaClock(player);
}

function showDesktopMediaAssist(player) {
    releaseDesktopMediaSource(player);
    setDesktopMediaStatus(player, DESKTOP_MEDIA_ASSIST);
}

function openDesktopMediaFile(player, file) {
    if (!file) return;
    if (!desktopMediaIsStreamable(player, file.name, file.type)) {
        showDesktopMediaAssist(player);
        return;
    }
    assignDesktopMediaSource(player, URL.createObjectURL(file), file.name, true);
}

function openDesktopMediaUrl(player) {
    const url = String(player.urlInput.value || '').trim();
    if (!url) return;
    const name = desktopMediaNameFromUrl(url);
    if (!desktopMediaIsStreamable(player, name, '')) {
        showDesktopMediaAssist(player);
        return;
    }
    assignDesktopMediaSource(player, url, name || url, false);
}

function toggleDesktopMediaPlayback(player) {
    const media = player.media;
    if (!media.getAttribute('src') && !media.currentSrc) return;
    if (media.paused || media.ended) {
        const pending = media.play();
        if (pending && pending.catch) {
            pending.catch((err) => {
                if (err && err.name === 'AbortError') return;
                setDesktopMediaStatus(player, 'Could not play this file.');
            });
        }
        return;
    }
    media.pause();
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

async function playDesktopVfsItem(player, item) {
    const name = item.name || '';
    const mime = item.mimeType || '';
    if (!desktopMediaIsStreamable(player, name, mime)) {
        showDesktopMediaAssist(player);
        return;
    }
    try {
        const url = await desktopMediaVfsUrl(player, item, name);
        if (!url) {
            setDesktopMediaStatus(player, 'Could not build a playable address for this file.');
            return;
        }
        assignDesktopMediaSource(player, url, name, false);
    } catch (err) {
        setDesktopMediaStatus(player, (err && err.message) || 'Could not open this file.');
    }
}

function renderDesktopMediaVfs(player, items) {
    player.vfsItems = items || [];
    player.vfsList.replaceChildren();
    if (!player.vfsItems.length) {
        setDesktopMediaVfsNote(player, 'This folder is empty.');
        return;
    }
    setDesktopMediaVfsNote(player, '');
    for (let i = 0; i < player.vfsItems.length; i++) {
        const item = player.vfsItems[i];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-secondary btn-small';
        btn.dataset.vfsIndex = String(i);
        btn.title = item.name || '';
        const icon = document.createElement('i');
        icon.className = desktopVfsItemIsFolder(item) ? 'fas fa-folder' : 'fas fa-file';
        const label = document.createElement('span');
        label.textContent = item.name || '';
        btn.appendChild(icon);
        btn.appendChild(label);
        player.vfsList.appendChild(btn);
    }
}

async function loadDesktopMediaVfs(player, path) {
    const next = path || '/';
    player.vfsToken += 1;
    const token = player.vfsToken;
    const keepList = player.vfsPath === next && player.vfsItems.length;
    player.vfsPath = next;
    player.vfsPathEl.textContent = next;
    if (!keepList) {
        player.vfsItems = [];
        player.vfsList.replaceChildren();
        setDesktopMediaVfsNote(player, 'Loading…');
    }
    try {
        // vfsClient.listDirectory: public/scripts/comp/vfsClient.js
        const result = await vfsClient.listDirectory(next, {
            offset: 0,
            limit: 400,
            sortField: 'name',
            sortDirection: 'asc',
            search: ''
        });
        if (token !== player.vfsToken) return;
        const listed = (result && result.path) || next;
        player.vfsPath = listed;
        player.vfsPathEl.textContent = listed;
        renderDesktopMediaVfs(player, (result && result.items) || []);
    } catch (err) {
        if (token !== player.vfsToken) return;
        player.vfsItems = [];
        player.vfsList.replaceChildren();
        setDesktopMediaVfsNote(player, (err && err.message) || 'Could not list this folder.');
    }
}

function desktopMediaBuildBody(kind) {
    const body = document.createElement('div');
    body.className = kind === 'video'
        ? 'modal-content dark'
        : 'modal-content dark modal-padding';

    const media = document.createElement(kind === 'video' ? 'video' : 'audio');
    media.preload = 'metadata';
    if (kind === 'video') media.playsInline = true;
    body.appendChild(media);

    const statusEl = document.createElement('p');
    statusEl.className = 'form-hint hidden';
    statusEl.dataset.mediaRole = 'status';
    body.appendChild(statusEl);

    const menuBtn = document.createElement('button');
    menuBtn.type = 'button';
    menuBtn.className = 'btn-secondary btn-small';
    menuBtn.title = 'Menu';
    const menuIcon = document.createElement('i');
    menuIcon.className = 'fas fa-bars';
    menuBtn.appendChild(menuIcon);

    const playBtn = document.createElement('button');
    playBtn.type = 'button';
    playBtn.className = 'btn-secondary btn-small';
    playBtn.title = 'Play';
    playBtn.disabled = true;
    const playIcon = document.createElement('i');
    playIcon.className = 'fas fa-play';
    playBtn.appendChild(playIcon);

    const seekWrap = document.createElement('div');
    seekWrap.className = 'slider-container';
    seekWrap.dataset.mediaRole = 'seek';
    const seek = document.createElement('input');
    seek.type = 'range';
    seek.className = 'slider-input';
    seek.min = '0';
    seek.max = '0';
    seek.step = '0.1';
    seek.value = '0';
    seek.disabled = true;
    seek.title = 'Seek';
    seekWrap.appendChild(seek);

    const timeEl = document.createElement('span');
    timeEl.className = 'slider-value';
    timeEl.dataset.mediaRole = 'time';
    timeEl.textContent = '0:00 / 0:00';

    const volumeWrap = document.createElement('div');
    volumeWrap.className = 'slider-container';
    volumeWrap.dataset.mediaRole = 'volume';
    const volume = document.createElement('input');
    volume.type = 'range';
    volume.className = 'slider-input';
    volume.min = '0';
    volume.max = '1';
    volume.step = '0.01';
    volume.value = '1';
    volume.title = 'Volume';
    volumeWrap.appendChild(volume);

    const transportRow = document.createElement('div');
    transportRow.className = 'form-row';
    transportRow.dataset.mediaRole = 'transport';
    transportRow.appendChild(menuBtn);
    transportRow.appendChild(playBtn);
    transportRow.appendChild(seekWrap);
    transportRow.appendChild(timeEl);
    transportRow.appendChild(volumeWrap);
    if (kind === 'video') {
        const transportClip = document.createElement('div');
        transportClip.dataset.mediaRole = 'transport-clip';
        transportClip.appendChild(transportRow);
        body.appendChild(transportClip);
    } else {
        body.appendChild(transportRow);
    }

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.className = 'hidden';
    fileInput.accept = kind === 'video'
        ? 'video/mp4,video/webm,video/ogg,.mp4,.webm,.ogg'
        : 'audio/mpeg,audio/ogg,audio/wav,audio/aac,audio/mp4,audio/flac,.mp3,.ogg,.wav,.aac,.m4a,.flac';
    body.appendChild(fileInput);

    return {
        body: body,
        media: media,
        statusEl: statusEl,
        menuBtn: menuBtn,
        fileInput: fileInput,
        playBtn: playBtn,
        seek: seek,
        timeEl: timeEl,
        volume: volume
    };
}

function desktopMediaBuildUrlBody() {
    const body = document.createElement('div');
    body.className = 'modal-content dark modal-padding';
    const urlGroup = document.createElement('div');
    urlGroup.className = 'button-group';
    urlGroup.dataset.mediaRole = 'source-url';
    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'form-control colored toolbar-input-segment';
    urlInput.placeholder = 'Streamable URL';
    urlInput.spellcheck = false;
    urlInput.autocomplete = 'off';
    const openUrlBtn = document.createElement('button');
    openUrlBtn.type = 'button';
    openUrlBtn.className = 'btn-secondary toolbar-input-segment';
    openUrlBtn.textContent = 'Open';
    urlGroup.appendChild(urlInput);
    urlGroup.appendChild(openUrlBtn);
    body.appendChild(urlGroup);
    return {
        body: body,
        urlInput: urlInput,
        openUrlBtn: openUrlBtn
    };
}

function desktopMediaBuildLibraryBody() {
    const body = document.createElement('div');
    body.className = 'modal-content dark modal-padding';
    body.dataset.mediaRole = 'vfs';
    const vfsRow = document.createElement('div');
    vfsRow.className = 'form-row';
    const vfsUp = document.createElement('button');
    vfsUp.type = 'button';
    vfsUp.className = 'btn-secondary btn-small';
    vfsUp.title = 'Up';
    const upIcon = document.createElement('i');
    upIcon.className = 'fas fa-arrow-up';
    vfsUp.appendChild(upIcon);
    const vfsPathEl = document.createElement('span');
    vfsPathEl.className = 'form-hint';
    vfsPathEl.dataset.mediaRole = 'vfs-path';
    vfsPathEl.textContent = '/';
    vfsRow.appendChild(vfsUp);
    vfsRow.appendChild(vfsPathEl);
    const vfsNoteEl = document.createElement('p');
    vfsNoteEl.className = 'form-hint hidden';
    const vfsList = document.createElement('div');
    vfsList.className = 'scrollable-content';
    vfsList.dataset.mediaRole = 'vfs-list';
    body.appendChild(vfsRow);
    body.appendChild(vfsNoteEl);
    body.appendChild(vfsList);
    return {
        body: body,
        vfsUp: vfsUp,
        vfsPathEl: vfsPathEl,
        vfsNoteEl: vfsNoteEl,
        vfsList: vfsList
    };
}

function desktopMediaMountTool(spec, body) {
    const modal = document.createElement('div');
    modal.id = spec.id;
    modal.className = 'modal hidden resizeable-window';
    modal.dataset.windowIdentifier = spec.identifier;
    modal.dataset.mediaTool = spec.tool;
    modal.innerHTML = ''
        + '<div class="modal-window-title">'
        + '<div class="modal-window-title-main">'
        + '<i class="' + spec.iconClass + '"></i>'
        + '<span>' + spec.title + '</span>'
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
    modal.appendChild(body);
    modal.querySelector('.close-btn').addEventListener('click', () => {
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    });
    document.body.appendChild(modal);
    return modal;
}

function desktopMediaShellSpec(kind) {
    if (kind === 'video') {
        return {
            id: 'desktopVideoPlayer',
            identifier: 'desktop-video-player',
            title: 'Video',
            iconClass: 'fas fa-film',
            minWidth: '480',
            minHeight: '360',
            width: '800',
            height: '560',
            maxWidth: '1400',
            maxHeight: '960'
        };
    }
    return {
        id: 'desktopMusicPlayer',
        identifier: 'desktop-music-player',
        title: 'Music',
        iconClass: 'fas fa-music',
        minWidth: '440',
        minHeight: '280',
        width: '560',
        height: '420',
        maxWidth: '900',
        maxHeight: '720'
    };
}

function createDesktopMediaPlayer(kind) {
    const spec = desktopMediaShellSpec(kind);
    const built = desktopMediaBuildBody(kind);
    const urlBuilt = desktopMediaBuildUrlBody();
    const libraryBuilt = desktopMediaBuildLibraryBody();
    const toolPrefix = kind === 'video' ? 'desktopVideo' : 'desktopMusic';
    const toolId = kind === 'video' ? 'desktop-video' : 'desktop-music';
    const urlModal = desktopMediaMountTool({
        id: toolPrefix + 'Url',
        identifier: toolId + '-url',
        title: 'Open URL',
        iconClass: 'fas fa-link',
        tool: 'url'
    }, urlBuilt.body);
    const libraryModal = desktopMediaMountTool({
        id: toolPrefix + 'Library',
        identifier: toolId + '-library',
        title: 'Library',
        iconClass: 'fas fa-folder-open',
        tool: 'library'
    }, libraryBuilt.body);
    const modal = document.createElement('div');
    modal.id = spec.id;
    modal.className = 'modal hidden resizeable-window';
    modal.dataset.windowIdentifier = spec.identifier;
    modal.dataset.windowMinWidth = spec.minWidth;
    modal.dataset.windowMinHeight = spec.minHeight;
    modal.dataset.windowDefaultWidth = spec.width;
    modal.dataset.windowDefaultHeight = spec.height;
    modal.dataset.windowMaxWidth = spec.maxWidth;
    modal.dataset.windowMaxHeight = spec.maxHeight;
    modal.innerHTML = ''
        + '<div class="modal-window-title">'
        + '<div class="modal-window-title-main">'
        + '<i class="' + spec.iconClass + '"></i>'
        + '<span>' + spec.title + '</span>'
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
    modal.appendChild(built.body);

    const player = {
        kind: kind,
        modal: modal,
        media: built.media,
        statusEl: built.statusEl,
        urlModal: urlModal,
        urlInput: urlBuilt.urlInput,
        libraryModal: libraryModal,
        fileInput: built.fileInput,
        playBtn: built.playBtn,
        seek: built.seek,
        timeEl: built.timeEl,
        volume: built.volume,
        vfsUp: libraryBuilt.vfsUp,
        vfsPathEl: libraryBuilt.vfsPathEl,
        vfsNoteEl: libraryBuilt.vfsNoteEl,
        vfsList: libraryBuilt.vfsList,
        vfsItems: [],
        vfsPath: '/',
        vfsToken: 0,
        epoch: 0,
        clearEpoch: 0,
        activeUrl: '',
        objectUrl: null,
        scrubbing: false
    };

    built.media.volume = 1;
    syncDesktopMediaRangeFill(built.seek);
    syncDesktopMediaRangeFill(built.volume);
    built.media.addEventListener('play', () => syncDesktopMediaPlayIcon(player));
    built.media.addEventListener('pause', () => syncDesktopMediaPlayIcon(player));
    built.media.addEventListener('ended', () => syncDesktopMediaPlayIcon(player));
    built.media.addEventListener('timeupdate', () => syncDesktopMediaClock(player));
    built.media.addEventListener('loadedmetadata', () => syncDesktopMediaClock(player));
    built.media.addEventListener('durationchange', () => syncDesktopMediaClock(player));
    built.media.addEventListener('error', () => {
        if (player.clearEpoch === player.epoch) return;
        if (!player.activeUrl || !player.media.getAttribute('src')) return;
        setDesktopMediaStatus(player, 'Could not play this file.');
    });
    if (kind === 'video') {
        built.media.addEventListener('click', () => toggleDesktopMediaPlayback(player));
    }

    built.playBtn.addEventListener('click', () => toggleDesktopMediaPlayback(player));
    built.seek.addEventListener('pointerdown', () => {
        player.scrubbing = true;
    });
    built.seek.addEventListener('input', () => {
        player.scrubbing = true;
        const t = Number(built.seek.value);
        if (Number.isFinite(player.media.duration)) player.media.currentTime = t;
        syncDesktopMediaClock(player);
    });
    built.seek.addEventListener('pointerup', () => {
        player.scrubbing = false;
        syncDesktopMediaClock(player);
    });
    built.seek.addEventListener('change', () => {
        player.scrubbing = false;
        syncDesktopMediaClock(player);
    });
    built.volume.addEventListener('input', () => {
        player.media.volume = Number(built.volume.value);
        syncDesktopMediaRangeFill(built.volume);
    });
    built.fileInput.addEventListener('change', () => {
        const file = built.fileInput.files && built.fileInput.files[0];
        built.fileInput.value = '';
        if (file) openDesktopMediaFile(player, file);
    });
    urlBuilt.openUrlBtn.addEventListener('click', () => {
        const url = String(urlBuilt.urlInput.value || '').trim();
        openDesktopMediaUrl(player);
        if (!url) return;
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(urlModal);
    });
    urlBuilt.urlInput.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const url = String(urlBuilt.urlInput.value || '').trim();
        openDesktopMediaUrl(player);
        if (!url) return;
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(urlModal);
    });
    libraryBuilt.vfsUp.addEventListener('click', () => {
        loadDesktopMediaVfs(player, parentDesktopVfsPath(player.vfsPath));
    });
    libraryBuilt.vfsList.addEventListener('click', (e) => {
        const btn = e.target.closest('button');
        if (!btn || !libraryBuilt.vfsList.contains(btn)) return;
        const item = player.vfsItems[Number(btn.dataset.vfsIndex)];
        if (!item) return;
        if (desktopVfsItemIsFolder(item)) {
            loadDesktopMediaVfs(player, desktopVfsFolderPath(player, item));
            return;
        }
        playDesktopVfsItem(player, item);
    });
    // contextMenu.attachClickMenuToElement: public/scripts/comp/contextMenu.js
    contextMenu.attachClickMenuToElement(built.menuBtn, {
        position: 'anchor',
        anchorAlign: 'start',
        sections: [
            {
                type: 'list',
                items: [
                    {
                        text: 'Open file',
                        icon: 'fas fa-folder-open',
                        action: 'desktop-media-open-file'
                    },
                    {
                        text: 'Open URL',
                        icon: 'fas fa-link',
                        action: 'desktop-media-open-url'
                    },
                    {
                        text: 'Browse library',
                        icon: 'fas fa-folder',
                        action: 'desktop-media-browse-library'
                    }
                ]
            }
        ],
        onAction: (action) => {
            if (action === 'desktop-media-open-file') built.fileInput.click();
            if (action === 'desktop-media-open-url') {
                showDesktopMediaModal(urlModal);
                setTimeout(() => urlBuilt.urlInput.focus(), 0);
            }
            if (action === 'desktop-media-browse-library') {
                showDesktopMediaModal(libraryModal);
                loadDesktopMediaVfs(player, player.vfsPath || '/');
            }
        }
    });

    modal.querySelector('.close-btn').addEventListener('click', () => {
        releaseDesktopMediaSource(player);
        setDesktopMediaStatus(player, '');
        // closeModal: public/scripts/comp/modalUtils.js
        closeModal(modal);
    });
    modal.addEventListener('animationend', (e) => {
        if (e.target !== modal || e.animationName !== 'modalSlideOut') return;
        releaseDesktopMediaSource(player);
    });

    document.body.appendChild(modal);
    return player;
}

function ensureDesktopMediaPlayer(kind) {
    if (desktopMediaPlayers[kind]) return desktopMediaPlayers[kind];
    const player = createDesktopMediaPlayer(kind);
    desktopMediaPlayers[kind] = player;
    return player;
}

function showDesktopMediaModal(modal) {
    if (modal.classList.contains('closing')) {
        // closeModal cleanup finishes on animation end or its fallback.
        setTimeout(() => {
            if (!modal.classList.contains('closing')) showDesktopMediaModal(modal);
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

function showDesktopMediaPlayer(player) {
    showDesktopMediaModal(player.modal);
}

function openDesktopMusicPlayer() {
    showDesktopMediaPlayer(ensureDesktopMediaPlayer('audio'));
}

function openDesktopVideoPlayer() {
    showDesktopMediaPlayer(ensureDesktopMediaPlayer('video'));
}
