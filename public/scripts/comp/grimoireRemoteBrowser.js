/**
 * Embedded web view for Grimoire.
 * The iframe loads the remote browser service (services/grimoire-browser),
 * which may be another host. The target site is rendered in Chromium there.
 */

let grimoireRemoteBrowserMessagesBound = false;
let grimoireAudioShell = null;
let grimoireAudioFocused = false;
let grimoireAudioVolume = null;
let grimoireAudioLive = false;

// Audio plays in one Alchemy window, the last one clicked or opened (services/grimoire-browser/viewer.html setAudio).
// Background play keeps it going when another window is focused or the app is hidden; disabled ends every stream.
function grimoireAudioVolumeNow() {
    if (grimoireAudioVolume !== null) return grimoireAudioVolume;
    const settings = grimoireAlchemySettings || {};
    return settings.audioVolume !== undefined ? settings.audioVolume : 100;
}

function grimoireAudioState(shell) {
    const settings = grimoireAlchemySettings || {};
    const on = shell === grimoireAudioShell && settings.audioEnabled !== false
        && (settings.audioBackground === true || (grimoireAudioFocused && !document.hidden));
    // the desktop's volume scales Alchemy too: the iframe's audio escapes tabVolume.js's own hooks
    const master = window.tabVolume && typeof window.tabVolume.masterGain === 'function' ? window.tabVolume.masterGain() : 1;
    return { type: 'grimoire-browser-audio', on, volume: (grimoireAudioVolumeNow() / 100) * master };
}

function grimoireSyncAudio() {
    let live = false;
    grimoireRemoteShells().forEach((shell) => {
        const frame = grimoireRemoteFrame(shell);
        if (!frame || !shell._grimoireRemoteSessionId) return;
        live = true;
        if (frame.contentWindow) frame.contentWindow.postMessage(grimoireAudioState(shell), '*');
    });
    grimoireAudioLive = live;
    // Alchemy's audio is a column in the volume flyout and a section of its menu (tabVolume.js, #628)
    grimoireRegisterVolumeSource();
    if (window.tabVolume) window.tabVolume.refresh();
}

/** Alchemy in the desktop's volume flyout and the volume icon's menu (tabVolume.js registerSource, #628). */
function grimoireRegisterVolumeSource() {
    if (grimoireRegisterVolumeSource.done || !window.tabVolume) return;
    grimoireRegisterVolumeSource.done = true;
    const saveFailed = () => showGlassToast('error', null, 'Could not save Alchemy settings', false, 4000);
    const settings = () => grimoireAlchemySettings || {};
    window.tabVolume.registerSource({
        id: 'alchemy',
        label: 'Alchemy',
        icon: typeof resolveAppIconPath === 'function' ? resolveAppIconPath('alchemy.png', 16) : '/static_images/app_icons/alchemy.png',
        isActive: () => grimoireAudioLive,
        getVolume: () => grimoireAudioVolumeNow(),
        isMuted: () => settings().audioEnabled === false,
        setVolume: (value, final) => {
            grimoireAudioVolume = value;
            if (value > 0 && settings().audioEnabled === false) {
                grimoireSaveAlchemySettings({ audioEnabled: true }).then(grimoireSyncAudio).catch(saveFailed);
            }
            grimoireSyncAudio();
            if (final) {
                grimoireSaveAlchemySettings({ audioVolume: value }).then(() => { grimoireAudioVolume = null; }).catch(saveFailed);
            }
        },
        setMuted: (mute) => grimoireSaveAlchemySettings({ audioEnabled: !mute }).then(grimoireSyncAudio).catch(saveFailed),
        menuItems: () => [
            { text: 'Play audio', icon: 'fas fa-volume-high', action: 'audioEnabled', showIndicator: true, checked: settings().audioEnabled !== false },
            { text: 'Play in background', icon: 'fas fa-moon', action: 'audioBackground', showIndicator: true, checked: settings().audioBackground === true }
        ],
        onMenuAction: (action, item) => {
            if (action !== 'audioEnabled' && action !== 'audioBackground') return;
            grimoireSaveAlchemySettings({ [action]: !(item && item.checked) }).then(grimoireSyncAudio).catch(saveFailed);
        }
    });
    window.tabVolume.onChange(() => grimoireSyncAudio());
}

function grimoireSetAudioShell(shell) {
    grimoireAudioShell = shell;
    grimoireAudioFocused = true;
    grimoireSyncAudio();
}

function grimoireAudioFollowPointer(ev) {
    const modal = ev.target && ev.target.closest && ev.target.closest('.modal');
    let pick = null;
    const shells = modal ? grimoireRemoteShells() : [];
    for (let i = 0; i < shells.length; i++) {
        const area = shells[i]._grimoireRemoteSessionId && shells[i].displayArea;
        if (!area || !modal.contains(area)) continue;
        if (area.contains(ev.target)) {
            pick = shells[i];
            break;
        }
        if (!pick) pick = shells[i];
    }
    if (pick) {
        grimoireSetAudioShell(pick);
        return;
    }
    // Activation lands after the click, so read the active window then (mainActiveWindowId: public/scripts/comp/modalUtils.js).
    setTimeout(() => {
        const active = mainActiveWindowId && document.getElementById(mainActiveWindowId);
        const focused = !!(active && grimoireAudioShell && grimoireAudioShell.displayArea && active.contains(grimoireAudioShell.displayArea));
        if (focused === grimoireAudioFocused) return;
        grimoireAudioFocused = focused;
        grimoireSyncAudio();
    }, 0);
}

// Web pages show as Alchemy. The taskbar copies the title bar's span and icon: modalUtils.js updateTaskbarWindows
// title: string sets the span, null restores the Grimoire title, undefined leaves it.
function grimoireSyncAlchemyIdentity(modal, web, title) {
    const main = modal && modal.querySelector('.modal-window-title-main');
    if (!main) return;
    const icon = main.querySelector('i');
    const img = main.querySelector('img.icon-image');
    const span = main.querySelector('span');
    if (!main.dataset.grimoireIcon) {
        main.dataset.grimoireIcon = icon.className;
        main.dataset.grimoireImage = img.getAttribute('src');
        main.dataset.grimoireTitle = span.textContent;
    }
    const swap = (modal.dataset.alchemy === '1') !== web;
    if (swap) {
        modal.dataset.alchemy = web ? '1' : '';
        icon.className = web ? 'fas fa-atom icon-fa' : main.dataset.grimoireIcon;
        // resolveAppIconPath: public/scripts/comp/modalUtils.js
        img.src = web ? resolveAppIconPath('alchemy.png', 64) : main.dataset.grimoireImage;
    }
    const nextTitle = title === null ? main.dataset.grimoireTitle : title;
    const rename = typeof nextTitle === 'string' && span.textContent !== nextTitle;
    if (rename) span.textContent = nextTitle;
    // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js
    if (swap || rename) debouncedUpdateTaskbarWindows();
}

function grimoireNormalizeWebUrl(url) {
    const raw = String(url || '').trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'chrome:' && parsed.protocol !== 'chrome-extension:') return '';
        if (!parsed.hostname) return '';
        return parsed.href;
    } catch (e) {
        return '';
    }
}

function grimoireBareWebUrl(url) {
    const raw = String(url || '').trim();
    if (!raw || /\s/.test(raw) || /[\\]/.test(raw)) return '';
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
    // resolveDsap: public/scripts/comp/dsapRegistry.js
    if (resolveDsap(raw)) return '';
    const hostLike = /^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(raw)
        || /^(?:\d{1,3}\.){3}\d{1,3}(?::\d{2,5})?(?:[/?#]\S*)?$/i.test(raw);
    if (!hostLike) return '';
    return grimoireNormalizeWebUrl('https://' + raw);
}

const GRIMOIRE_COMMON_TLDS = new Set(['com', 'net', 'org', 'jp', 'io', 'dev', 'app', 'ai', 'co', 'me', 'gg', 'tv', 'moe', 'xyz', 'info', 'edu', 'gov', 'uk', 'us', 'de', 'fr', 'ca', 'au', 'kr', 'cn', 'ru', 'eu', 'be', 'nl', 'it', 'es', 'cc', 'to', 'fm', 'ly', 'sh', 'site', 'blog']);

// Bare host text from the address bar: common endings open directly, anything else asks (a tag can contain a dot).
// Resolves the web URL, '' for a wiki search, or null when dismissed.
async function grimoireResolveBareWebUrl(bareUrl, anchor) {
    const host = new URL(bareUrl).hostname;
    if (/^[\d.]+$/.test(host) || GRIMOIRE_COMMON_TLDS.has(host.split('.').pop())) return bareUrl;
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
    const choice = await showConfirmationDialog('Open ' + host + ' or search the wiki?', [
        { text: 'Go to site', value: 'web', icon: 'fas fa-atom', className: 'btn-standard primary' },
        { text: 'Search wiki', value: 'search', icon: 'fas fa-search', className: 'btn-standard' }
    ], anchor ? { target: anchor } : null, { title: 'Alchemy', icon: 'fas fa-atom' });
    if (choice === 'web') return bareUrl;
    return choice === 'search' ? '' : null;
}

function grimoireSiteLabel(raw) {
    const web = grimoireNormalizeWebUrl(raw) || grimoireBareWebUrl(raw);
    if (web) {
        try {
            return new URL(web).hostname.replace(/^www\./i, '');
        } catch (e) {}
    }
    const stripped = String(raw || '').trim().replace(/^(edtx|rdf|dsap):\/\//i, '');
    const query = stripped.match(/[?&]q=([^&#]+)/i);
    if (query) {
        try { return decodeURIComponent(query[1].replace(/\+/g, ' ')); } catch (e) { return query[1]; }
    }
    const parts = stripped.split('/').filter(Boolean);
    if (!parts.length) return stripped;
    try { return decodeURIComponent(parts[parts.length - 1]).replace(/_/g, ' '); } catch (e) { return parts[parts.length - 1]; }
}

function grimoireRemoteFrame(shell) {
    if (!shell || !shell.displayArea) return null;
    return shell.displayArea.querySelector('iframe');
}

function grimoireWebMode(url) {
    if (/^chrome(-extension)?:/i.test(url)) return 'chrome';
    if (/^https:/i.test(url)) return 'https';
    return 'http';
}

// Every full Grimoire window (#615; grimoireAllWindows: public/scripts/comp/tagWikiSearchModal.js).
function grimoireFullWindows() {
    if (typeof grimoireAllWindows === 'function') return grimoireAllWindows();
    return tagWikiSearchModal ? [tagWikiSearchModal] : [];
}

// The full Grimoire window that holds a shell (grimoireWindowOf: public/scripts/comp/tagWikiSearchModal.js).
function grimoireHostOf(shell) {
    if (typeof grimoireWindowOf === 'function') return grimoireWindowOf(shell);
    return tagWikiSearchModal;
}

// The Grimoire window with the keyboard: the one holding the focus, else the active window (mainActiveWindowId:
// public/scripts/comp/modalUtils.js) when it is a Grimoire window.
function grimoireFocusWindow() {
    const node = document.activeElement;
    let modal = node && node.closest ? node.closest('.modal') : null;
    if (!modal && mainActiveWindowId) modal = document.getElementById(mainActiveWindowId);
    return modal ? grimoireFullWindows().find((win) => win.modal === modal) || null : null;
}

function grimoireRemoteShells() {
    const shells = [];
    grimoireFullWindows().forEach((host) => {
        shells.push(host);
        if (host.rightPane) shells.push(host.rightPane);
        // tabs in the background keep their frames (grimoireTabs.js)
        if (host.tabs) host.tabs.backgroundShells().forEach((shell) => shells.push(shell));
    });
    // wikiWindowManager: public/scripts/comp/tagWikiSearchModal.js
    if (wikiWindowManager && wikiWindowManager.windows) {
        wikiWindowManager.windows.forEach((win) => shells.push(win));
    }
    return shells;
}

function grimoireRemoteFromMessage(event) {
    const shells = grimoireRemoteShells();
    for (let i = 0; i < shells.length; i++) {
        const frame = grimoireRemoteFrame(shells[i]);
        if (frame && event.source === frame.contentWindow) {
            const shell = shells[i];
            const standalone = !!(shell.modal && shell.modal.classList.contains('wiki-page-viewer-modal'));
            // host: the full window that holds the frame (#615); tab: set when it is in one of its background tabs (grimoireTabs.js)
            const host = standalone ? shell : grimoireHostOf(shell);
            if (!host) return null;
            const tab = !standalone && host.tabs ? host.tabs.backgroundTabOf(shell) : null;
            return { host, shell, frame, tab };
        }
    }
    return null;
}

function grimoireRemoteFileUrl(shell, kind, extra) {
    const id = shell && shell._grimoireRemoteSessionId;
    const query = shell && shell._grimoireRemoteViewQuery;
    if (!id || !query) return '';
    if (kind === 'resource') {
        return '/api/grimoire-browser/sessions/' + encodeURIComponent(id) + '/resource?' + query + '&url=' + encodeURIComponent(extra || '');
    }
    return '/api/grimoire-browser/sessions/' + encodeURIComponent(id) + '/downloads/' + encodeURIComponent(extra || '') + '?' + query;
}

function grimoireSaveUrl(url, filename) {
    if (!url) return;
    const link = document.createElement('a');
    link.href = url;
    link.download = filename || '';
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

// Download guid -> progress toast id, while the remote page is still downloading (off the desktop: no dialog).
const grimoireDownloadToasts = new Map();

// Download guid -> its own Vista copy dialog (fileOperationProgress.js), from the first bytes to
// Download complete (Open / Open Folder / Close): { op, frame, id, cancelled, controller }
const grimoireDownloads = new Map();

function grimoireDownloadDialogs() {
    return typeof fileOperationProgress !== 'undefined' && fileOperationProgress.available();
}

/** "<b>example.com</b> (https://example.com/file.zip)": the site a download comes from. */
function grimoireDownloadSource(url) {
    try {
        const parsed = new URL(url);
        return { name: parsed.hostname || parsed.href, path: parsed.href };
    } catch (e) {
        return null;
    }
}

/** The active workspace's Downloads (grimoireBrowserBridge.js /save makes it on first use). */
function grimoireDownloadsPlace() {
    // activeWorkspace, workspaces: public/scripts/comp/workspaceUtils.js
    const ws = typeof workspaces !== 'undefined' && workspaces ? workspaces[activeWorkspace] : null;
    return { name: 'Downloads', path: '/Workspaces/' + ((ws && ws.name) || activeWorkspace) + '/Downloads' };
}

/**
 * The dialog for one download, begun at its first word (progress, or the file itself when it was
 * quick); null off the desktop. id '' (a context-menu save) is not kept: nothing else reports on it.
 */
function grimoireDownloadEntry(frame, data, sourceUrl) {
    const id = String(data.id || '');
    let entry = id ? grimoireDownloads.get(id) : null;
    if (entry || !grimoireDownloadDialogs()) return entry || null;
    entry = { frame, id, cancelled: false, controller: null, op: null };
    entry.op = fileOperationProgress.begin({
        op: 'copy',
        // Vista's copy dialog, its header saying what it does
        verb: 'Downloading',
        items: [{ name: data.filename || 'download', size: data.total || 0 }],
        from: grimoireDownloadSource(sourceUrl),
        to: grimoireDownloadsPlace(),
        // Cancel stops the remote browser's download (services/grimoire-browser download-cancel)
        // or the save behind it, and the dialog goes
        onCancel: () => {
            entry.cancelled = true;
            if (entry.controller) entry.controller.abort();
            if (entry.id && entry.frame && entry.frame.contentWindow) {
                entry.frame.contentWindow.postMessage({ type: 'grimoire-browser-download-cancel', id: entry.id }, '*');
            }
            entry.op.finish();
        }
    });
    if (id) grimoireDownloads.set(id, entry);
    return entry;
}

/**
 * The running download a finished file belongs to when it came under another id (the remote
 * browser's folder watch can report it before the download's own completion, which then never
 * comes): the one of that name in this frame, else the frame's only one.
 */
function grimoireRunningDownload(frame, filename) {
    const mine = Array.from(grimoireDownloads.values()).filter((e) => e.frame === frame && !e.cancelled);
    return mine.find((e) => e.op.items[0] && e.op.items[0].name === filename) || (mine.length === 1 ? mine[0] : null);
}

// showGlassToast, updateGlassToastProgress, updateGlassToastMessage, removeGlassToast: public/scripts/comp/toastManager.js
// formatBytes: public/scripts/comp/systemTrayManager.js
function grimoireShowDownloadProgress(found, data) {
    if (data.canceled) {
        // the page (or Cancel) stopped it
        const entry = grimoireDownloads.get(data.id);
        grimoireDownloads.delete(data.id);
        if (entry) entry.op.finish();
        const canceledToast = grimoireDownloadToasts.get(data.id);
        if (canceledToast) removeGlassToast(canceledToast);
        grimoireDownloadToasts.delete(data.id);
        return;
    }
    const entry = grimoireDownloadEntry(found.frame, data, found.shell._grimoireRemoteUrl);
    if (entry) {
        if (!entry.cancelled) entry.op.progress(data.received, data.total);
        return;
    }
    let toastId = grimoireDownloadToasts.get(data.id);
    const text = 'Downloading ' + data.filename + ' - ' + formatBytes(data.received) + (data.total ? ' of ' + formatBytes(data.total) : '');
    if (!toastId) {
        toastId = showGlassToast('info', null, text, true, false, '<i class="fas fa-download"></i>');
        grimoireDownloadToasts.set(data.id, toastId);
    } else {
        updateGlassToastMessage(toastId, text);
    }
    if (data.total) updateGlassToastProgress(toastId, (data.received / data.total) * 100);
}

// Fade the address fill out, then snap it back to 0 with no transition (vista-explorer.css .vista-load-reset).
function grimoireFinishAddressLoad(host, bar) {
    host._grimoireLoadFillTimer = setTimeout(() => {
        bar.removeAttribute('data-alchemy-loading');
        host._grimoireLoadFillTimer = setTimeout(() => {
            bar.classList.add('vista-load-reset');
            bar.style.setProperty('--alchemy-load', '0%');
            void bar.offsetWidth; // flush with no transition before the class goes
            setTimeout(() => bar.classList.remove('vista-load-reset'), 50);
        }, 400);
    }, 350);
}

// Address bar glass fill (grimoire-browser.css #grimoireAddressBar::before); only the main Grimoire window has the bar.
function grimoireShowLoadProgress(found, value) {
    const host = found.host;
    const bar = host.addressBar;
    const active = host.activePane && host.activePane !== host ? host.activePane : host;
    if (!bar || found.shell !== active) return;
    bar.style.setProperty('--alchemy-load', Math.round(Math.min(1, value) * 100) + '%');
    clearTimeout(host._grimoireLoadFillTimer);
    if (value < 1) {
        bar.setAttribute('data-alchemy-loading', '');
        return;
    }
    grimoireFinishAddressLoad(host, bar);
}

// Wiki pages have no byte progress. Hold the same fill at 50% until the page arrives.
// Returns a function that completes the bar. No-op when this shell is not the active Grimoire window.
function grimoireBeginWikiLoad(shell) {
    const host = grimoireHostOf(shell);
    if (!host || !host.addressBar || !shell) return function () {};
    if (host.modal && host.modal.dataset.alchemy === '1') return function () {};
    const active = host.activePane && host.activePane !== host ? host.activePane : host;
    if (shell !== active) return function () {};
    const bar = host.addressBar;
    host._wikiLoadHold = (host._wikiLoadHold || 0) + 1;
    clearTimeout(host._grimoireLoadFillTimer);
    bar.style.setProperty('--alchemy-load', '50%');
    bar.setAttribute('data-alchemy-loading', '');
    let done = false;
    return function () {
        if (done) return;
        done = true;
        host._wikiLoadHold = Math.max(0, (host._wikiLoadHold || 1) - 1);
        if (host._wikiLoadHold > 0) return;
        bar.style.setProperty('--alchemy-load', '100%');
        bar.setAttribute('data-alchemy-loading', '');
        grimoireFinishAddressLoad(host, bar);
    };
}

// Download complete: Open opens the file as Explorer's double-click does, Open Folder shows it selected.
// openExplorerApplet / featureLoader: public/scripts/comp/featureLoader.js; initializeExplorerApplet: explorerApplet.js
async function grimoireOpenDownload(info, how) {
    try {
        await featureLoader.loadFeature('explorer');
        const explorer = initializeExplorerApplet();
        if (!explorer) return;
        if (how === 'folder') await explorer.showFileInFolder(info.path, info.fileId);
        else await explorer.openFileInFolder(info.path, info.fileId);
    } catch (e) {
        console.error('Alchemy download:', e);
    }
}

// Saves into the active workspace's VFS Downloads folder (grimoireBrowserBridge.js /save), not the browser's downloads.
// entry: the download's dialog (grimoireDownloadEntry), which follows the save, asks Try Again on a
// failure and ends at Download complete; without one (off the desktop) the toasts speak.
async function grimoireSaveToDownloads(shell, ref, filename, progressToastId, entry) {
    const id = shell && shell._grimoireRemoteSessionId;
    if (!id) {
        if (entry) entry.op.finish();
        return;
    }
    const save = async () => {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        if (entry) entry.controller = controller;
        const res = await fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(id) + '/save?' + shell._grimoireRemoteViewQuery, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            signal: controller ? controller.signal : undefined,
            // activeWorkspace: public/scripts/comp/workspaceUtils.js (currentWorkspace is only set by one boot path)
            body: JSON.stringify(Object.assign({ filename, workspaceId: activeWorkspace }, ref))
        });
        const info = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(info.error || 'save failed');
        return info;
    };
    if (entry) {
        const op = entry.op;
        if (entry.cancelled) return;
        const r = await op.attempt({ name: filename }, save);
        if (!r.ok || entry.cancelled || op.cancelled) {
            op.finish();
            return;
        }
        const info = r.value;
        const size = Number(info.size) || op.totalBytes;
        op.progress(size, size);
        const source = op.from;
        const took = fileOperationProgress.formatElapsed((Date.now() - op.started) / 1000);
        const answer = await op.complete({
            header: 'Download complete',
            lines: [
                source ? [{ b: info.name || filename }, ' from ', source.name] : [{ b: info.name || filename }],
                ['Downloaded ' + (size ? fileOperationProgress.formatBytes(size) + ' ' : '') + 'in ' + took + ' to ', { b: 'Downloads' }]
            ],
            buttons: [
                { text: 'Open', value: 'open', primary: true },
                { text: 'Open Folder', value: 'folder' },
                { text: 'Close', value: 'close' }
            ]
        });
        if (answer === 'open' || answer === 'folder') grimoireOpenDownload(info, answer);
        return;
    }
    if (!progressToastId) progressToastId = showGlassToast('info', null, 'Saving ' + filename + ' to Downloads', false, false, '<i class="fas fa-download"></i>');
    try {
        const info = await save();
        removeGlassToast(progressToastId);
        // openExplorerApplet: public/scripts/comp/featureLoader.js
        showGlassToast('success', null, info.name + ' saved to Downloads', false, 5000, '<i class="fas fa-download"></i>', [
            { text: 'Show', onClick: () => openExplorerApplet(info.path) }
        ]);
    } catch (e) {
        removeGlassToast(progressToastId);
        showGlassToast('error', null, 'Download failed: ' + e.message, false, 5000);
    }
}

async function grimoireCopyText(text) {
    const value = String(text || '');
    if (!value) return;
    try {
        await navigator.clipboard.writeText(value);
        return;
    } catch (e) {}
    // Plain http has no async Clipboard API; the textarea takes focus for a moment, so hand it back (the Alchemy frame).
    const before = document.activeElement;
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
    if (before && before !== document.body && typeof before.focus === 'function') before.focus();
}

// Alchemy hides Chromium's scrollbars (server.js watchScroll); the desktop draws them instead. Each bar is a thin
// native scroller beside the frame whose extent mirrors the page, so the Vista scrollbar (vista-scrollbars.css)
// paints it with its own arrows, track paging, thumb drag and wheel; its scroll position goes back to the page
// as scroll-to. The frame gives the bar its 17 px, so the remote page lays out narrower, as in a real browser.
function grimoireScrollState(data) {
    const num = (v) => Number(v) || 0;
    return { y: num(data.y), height: num(data.height), view: num(data.view), x: num(data.x), width: num(data.width), viewWidth: num(data.viewWidth) };
}

function grimoireRemoteScrollbars(found) {
    const area = found.shell.displayArea;
    const existing = area.querySelector(':scope > .alchemy-scrollbar-v');
    if (existing) return { v: existing, h: area.querySelector(':scope > .alchemy-scrollbar-h') };
    const shell = found.shell;
    const make = (axis) => {
        const bar = document.createElement('div');
        bar.className = 'alchemy-scrollbar alchemy-scrollbar-' + axis + ' hidden';
        const extent = document.createElement('div');
        extent.className = 'alchemy-scrollbar-extent';
        bar.appendChild(extent);
        area.appendChild(bar);
        return bar;
    };
    const v = make('v');
    const h = make('h');
    const corner = document.createElement('div');
    corner.className = 'alchemy-scrollbar-corner';
    area.appendChild(corner);
    let raf = 0;
    let want = null;
    const send = () => {
        raf = 0;
        const frame = grimoireRemoteFrame(shell);
        if (frame && frame.contentWindow && want) frame.contentWindow.postMessage(Object.assign({ type: 'grimoire-browser-scroll-to' }, want), location.origin);
        want = null;
    };
    const onScroll = (bar, vertical) => () => {
        const state = shell._alchemyScroll;
        const synced = bar._syncedTo;
        bar._syncedTo = null;
        // the page's own report moved the bar: nothing to send back
        if (!state || (synced != null && Math.abs((vertical ? bar.scrollTop : bar.scrollLeft) - synced) < 1)) return;
        const range = vertical ? bar.scrollHeight - bar.clientHeight : bar.scrollWidth - bar.clientWidth;
        const max = vertical ? state.height - state.view : state.width - state.viewWidth;
        if (range <= 0 || max <= 0) return;
        const pos = Math.round((vertical ? bar.scrollTop : bar.scrollLeft) / range * max);
        if (vertical) state.y = pos;
        else state.x = pos;
        bar._localUntil = performance.now() + 300;
        want = { y: state.y, x: state.x };
        if (!raf) raf = requestAnimationFrame(send);
    };
    [[v, true], [h, false]].forEach(([bar, vertical]) => {
        bar.addEventListener('scroll', onScroll(bar, vertical), { passive: true });
        // while the thumb is held, the page's reports trail the pointer: keep the bar where the user put it
        bar.addEventListener('pointerdown', () => {
            bar._held = true;
            const release = () => {
                bar._held = false;
                bar._localUntil = performance.now() + 300;
                window.removeEventListener('pointerup', release, true);
                window.removeEventListener('pointercancel', release, true);
            };
            window.addEventListener('pointerup', release, true);
            window.addEventListener('pointercancel', release, true);
        });
    });
    return { v, h };
}

function grimoirePlaceScrollbar(bar, vertical, pos, max, size, view) {
    const extent = bar.firstElementChild;
    const ratio = view > 0 ? size / view : 1;
    if (vertical) extent.style.height = (ratio * 100) + '%';
    else extent.style.width = (ratio * 100) + '%';
    if (bar._held || performance.now() < (bar._localUntil || 0)) return;
    const range = vertical ? bar.scrollHeight - bar.clientHeight : bar.scrollWidth - bar.clientWidth;
    const target = max > 0 && range > 0 ? Math.round(Math.max(0, Math.min(1, pos / max)) * range) : 0;
    if (Math.abs((vertical ? bar.scrollTop : bar.scrollLeft) - target) < 1) return;
    bar._syncedTo = target;
    if (vertical) bar.scrollTop = target;
    else bar.scrollLeft = target;
}

function grimoireUpdateRemoteScrollbar(found, data) {
    const shell = found.shell;
    const state = grimoireScrollState(data);
    const area = shell.displayArea;
    // a report that arrives after the page left Alchemy (grimoireCloseRemoteBrowser) puts no bars on a Grimoire page
    if (!area || !grimoireRemoteFrame(shell)) return;
    shell._alchemyScroll = state;
    const bars = grimoireRemoteScrollbars(found);
    const needV = state.height > state.view + 1;
    const needH = state.width > state.viewWidth + 1;
    bars.v.classList.toggle('hidden', !needV);
    bars.h.classList.toggle('hidden', !needH);
    if (needV) grimoirePlaceScrollbar(bars.v, true, state.y, state.height - state.view, state.height, state.view);
    if (needH) grimoirePlaceScrollbar(bars.h, false, state.x, state.width - state.viewWidth, state.width, state.viewWidth);
}

// Back / Forward the viewer sent to Chromium: when the page lands on the neighbouring Grimoire entry, step to it
// instead of adding a new one, so the toolbar arrows stay in step with the remote history.
function grimoireFollowRemoteHistory(shell, url) {
    const dir = shell._alchemyHistoryDir;
    if (!dir || Date.now() - (shell._alchemyHistoryAt || 0) > 15000) return false;
    const neighbour = shell.history && shell.history[shell.historyIndex + dir];
    if (!neighbour || neighbour.type !== 'web' || neighbour.url !== url) return false;
    shell._alchemyHistoryDir = 0;
    shell.historyIndex += dir;
    return true;
}

function grimoireBlobToPng(blob) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(blob);
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || 1;
            canvas.height = img.naturalHeight || 1;
            canvas.getContext('2d').drawImage(img, 0, 0);
            canvas.toBlob((out) => {
                URL.revokeObjectURL(objectUrl);
                if (out) resolve(out);
                else reject(new Error('png'));
            }, 'image/png');
        };
        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('image'));
        };
        img.src = objectUrl;
    });
}

async function grimoireCopyImage(url) {
    const res = await fetch(url, { credentials: 'same-origin' });
    if (!res.ok) return;
    let blob = await res.blob();
    if (blob.type !== 'image/png') blob = await grimoireBlobToPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

/** The page playing Alchemy's audio (grimoireTabs.js keeps it from being suspended, #628). */
function grimoireIsAudioShell(shell) {
    return !!shell && shell === grimoireAudioShell;
}

function grimoireShellWebUrl(shell) {
    const top = shell && shell.history && shell.history[shell.historyIndex];
    return top && top.type === 'web' ? top.url : '';
}

/**
 * What a bookmark keeps for the page on show (Yozora #628): a web page's address, or a Grimoire
 * page's own address (tag wiki, docs, Apocrypha, search: edtx:// rdf:// dsap://), which
 * host.navigate opens again.
 */
function grimoireShellBookmarkUrl(shell, host) {
    const web = grimoireShellWebUrl(shell);
    if (web) return web;
    const a = host && host.currentAddress;
    let url = (a && a.fullUrl) || '';
    if (!url && host && typeof host._getDerivedDisplayUrlForPane === 'function') url = host._getDerivedDisplayUrlForPane(shell);
    return /^(edtx|rdf|dsap):\/\/\S+$/i.test(url || '') ? url : '';
}

/** A bookmark's title: the page's own, a wiki page's tag, a search's words. */
function grimoireShellBookmarkTitle(shell, url) {
    const top = shell && shell.history && shell.history[shell.historyIndex];
    if (top && !top.title && top.tag) return String(top.tag).replace(/_/g, ' ');
    const raw = top && (top.title || (top.query ? `Search: ${top.query}` : '') || top.name);
    return String(raw || url);
}

async function grimoireAddRemotePageToDesktop(shell) {
    const id = shell._grimoireRemoteSessionId;
    if (!id) return;
    const res = await fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(id) + '/page-icon?' + shell._grimoireRemoteViewQuery, { credentials: 'same-origin' });
    const info = res.ok ? await res.json() : {};
    const url = grimoireNormalizeWebUrl(info.url) || grimoireShellWebUrl(shell);
    if (!url) {
        showGlassToast('error', null, 'Could not read the page address', false, 4000);
        return;
    }
    // desktopShortcuts: public/scripts/comp/desktopShortcuts.js
    await desktopShortcuts.addShortcut({
        name: info.title || grimoireSiteLabel(url),
        type: 'web-page',
        data: { url, title: info.title || '', icon: info.icon || '' }
    });
    showGlassToast('success', null, 'Page added to desktop', false, 3000, '<i class="fas fa-arrow-down-left"></i>');
}

function grimoireRemoteMenuAction(found, action, data) {
    const shell = found.shell;
    if (action === 'back') {
        shell.goBack();
        return;
    }
    if (action === 'forward') {
        shell.goForward();
        return;
    }
    if (action === 'reload') {
        grimoireRemoteBrowserReload(shell);
        return;
    }
    if (action === 'copy-url') {
        grimoireCopyText(grimoireShellWebUrl(shell));
        return;
    }
    if (action === 'copy-text') {
        grimoireCopyText(data.text);
        return;
    }
    if (action === 'paste') {
        navigator.clipboard.readText().then((text) => {
            if (text && found.frame.contentWindow) found.frame.contentWindow.postMessage({ type: 'grimoire-browser-paste', text }, '*');
        }).catch(() => {});
        return;
    }
    if (action === 'open-window') {
        const target = data.href || grimoireShellWebUrl(shell);
        // from a full Grimoire window with the tab strip: another full window (#615); else a standalone Alchemy window
        if (found.host.tabs && found.host.tabs.available()) TagWikiSearchModal.openNewWindow({ url: target });
        else grimoireOpenStandaloneWindow(target);
        return;
    }
    if (action === 'open-tab') {
        if (!grimoireOpenTab(found, data.href)) grimoireOpenStandaloneWindow(data.href);
        return;
    }
    if (action === 'add-to-desktop') {
        grimoireAddRemotePageToDesktop(shell).catch(() => {
            showGlassToast('error', null, 'Failed to add shortcut', false, 4000);
        });
        return;
    }
    if (action === 'copy-link') {
        grimoireCopyText(data.href);
        return;
    }
    if (action === 'open-link') {
        const next = grimoireNormalizeWebUrl(data.href);
        if (next && found.frame.contentWindow) {
            // desktopSounds.play: public/scripts/comp/desktopSounds.js
            desktopSounds.play('navigate');
            found.frame.contentWindow.postMessage({ type: 'grimoire-browser-navigate', url: next }, '*');
        }
        return;
    }
    if (action === 'copy-image') {
        const url = grimoireRemoteFileUrl(shell, 'resource', data.src);
        grimoireCopyImage(url).catch(() => grimoireSaveUrl(url, data.alt || 'image'));
        return;
    }
    if (action === 'save-image') {
        let name = data.alt || 'image';
        try { name = new URL(data.src).pathname.split('/').pop() || name; } catch (e) {}
        grimoireSaveToDownloads(shell, { url: data.src }, name, null, grimoireDownloadEntry(null, { filename: name }, data.src));
        return;
    }
    if (action === 'download-link') {
        let name = 'download';
        try { name = new URL(data.href).pathname.split('/').pop() || name; } catch (e) {}
        grimoireSaveToDownloads(shell, { url: data.href }, name, null, grimoireDownloadEntry(null, { filename: name }, data.href));
    }
}

function grimoireShowRemoteMenu(found, data) {
    const frame = found.frame;
    const rect = frame.getBoundingClientRect();
    const selection = data.selection || '';
    const text = selection || data.text || '';
    const href = data.href || '';
    const src = data.src || '';
    const shell = found.shell;
    const pageUrl = grimoireShellWebUrl(shell);
    const icons = [
        { icon: 'fas fa-arrow-left', tooltip: 'Back', action: 'back', disabled: shell.historyIndex <= 0 },
        { icon: 'fas fa-arrow-right', tooltip: 'Forward', action: 'forward', disabled: shell.historyIndex >= shell.history.length - 1 },
        { icon: 'fas fa-rotate-right', tooltip: 'Reload', action: 'reload' },
        { icon: 'fas fa-copy', tooltip: 'Copy text', action: 'copy-text', disabled: !text },
        { icon: 'fas fa-link', tooltip: 'Copy URL', action: 'copy-url', disabled: !pageUrl },
        { icon: 'fas fa-window-restore', tooltip: href ? 'Open link in new window' : 'Open in new window', action: 'open-window' }
    ];
    const items = [];
    if (data.editable) items.push({ text: 'Paste', icon: 'fas fa-paste', action: 'paste' });
    if (href) {
        items.push({ text: 'Copy link', icon: 'fas fa-link', action: 'copy-link' });
        items.push({ text: 'Open link', icon: 'fas fa-external-link-alt', action: 'open-link' });
        // IE7's Open in New Tab has no icon
        if (found.host.tabs && found.host.tabs.available()) items.push({ text: 'Open link in new tab', action: 'open-tab' });
        if (!src) items.push({ text: 'Download', icon: 'fas fa-download', action: 'download-link' });
    }
    if (src) {
        items.push({ text: 'Copy image', icon: 'fas fa-image', action: 'copy-image' });
        items.push({ text: 'Save image', icon: 'fas fa-download', action: 'save-image' });
    }
    if (items.length) items.push({ separator: true });
    items.push({ text: 'Add to Desktop', icon: 'fas fa-arrow-down-left', action: 'add-to-desktop' });
    // contextMenu: public/scripts/comp/contextMenu.js
    contextMenu.attachToElement(frame, {
        sections: [{ type: 'icons', position: 'outer', icons }, { type: 'list', items }],
        onAction: (action) => grimoireRemoteMenuAction(found, action, {
            text,
            href,
            src,
            alt: data.alt || ''
        })
    });
    contextMenu.showMenu({
        clientX: rect.left + (Number(data.clientX) || 0),
        clientY: rect.top + (Number(data.clientY) || 0),
        preventDefault() {},
        stopPropagation() {}
    }, frame);
}

// A page <select> (services/grimoire-browser/server.js watchSelects) opens as a Dreamscape menu under the field.
function grimoireShowRemoteSelect(found, data) {
    const frame = found.frame;
    const rect = frame.getBoundingClientRect();
    const items = [];
    let group = '';
    data.options.forEach((option, index) => {
        if (option.group && option.group !== group) items.push({ text: option.group, disabled: true });
        group = option.group || '';
        items.push({ text: option.label || ' ', checked: index === data.selected, disabled: !!option.disabled, action: 'select-pick', selectIndex: index });
    });
    // contextMenu: public/scripts/comp/contextMenu.js
    contextMenu.attachToElement(frame, {
        sections: [{ type: 'list', items }],
        onAction: (action, target, item) => {
            if (action === 'select-pick' && item && frame.contentWindow) frame.contentWindow.postMessage({ type: 'grimoire-browser-select-pick', index: item.selectIndex }, '*');
        }
    });
    contextMenu.showMenu({
        clientX: rect.left + (Number(data.clientX) || 0),
        clientY: rect.top + (Number(data.clientY) || 0),
        preventDefault() {},
        stopPropagation() {}
    }, frame);
}

function grimoireStartNavigationSpinner(host, url, force) {
    if (!host || !host.setNavigationLoading) return;
    const key = url || '';
    if (!force && host._grimoireSpinDone && host._grimoireSpinUrl === key) return;
    if (!force && host._grimoireNavSpinnerTimer && host._grimoireSpinUrl === key) {
        host.setNavigationLoading(true);
        return;
    }
    host._grimoireSpinDone = false;
    host._grimoireSpinUrl = key;
    host.setNavigationLoading(true);
    clearTimeout(host._grimoireNavSpinnerTimer);
    host._grimoireNavSpinnerTimer = setTimeout(() => {
        host._grimoireNavSpinnerTimer = 0;
        host._grimoireSpinDone = true;
        if (host.finishGrimoireNavigationLoading) host.finishGrimoireNavigationLoading();
    }, 4500);
}

function grimoireStopNavigationSpinner(host) {
    if (!host) return;
    host._grimoireSpinDone = false;
    host._grimoireSpinUrl = '';
    clearTimeout(host._grimoireNavSpinnerTimer);
    host._grimoireNavSpinnerTimer = 0;
    if (host.finishGrimoireNavigationLoading) host.finishGrimoireNavigationLoading();
}

function grimoireApplyRemoteLocation(found, data) {
    const host = found.host;
    const shell = found.shell;
    const active = host.activePane && host.activePane !== host ? host.activePane : host;
    const forActive = shell === active;
    if (data.type === 'grimoire-browser-navigation-failed') {
        if (forActive) grimoireStopNavigationSpinner(host);
        return;
    }
    shell._grimoireRemoteTitle = data.title || '';
    // the page a download comes from (its dialog's "from")
    if (data.url) shell._grimoireRemoteUrl = data.url;
    // Recent Items (public/scripts/comp/recentItems.js): the page this browser session is on now (one entry per session)
    if (!data.navigating && data.url && window.recentItems) window.recentItems.notePage(shell, { type: 'web', url: data.url, title: data.title });
    grimoireTitleWebEntry(shell, data);
    if (data.url && host.setAddress) {
        const force = host.activePane !== host;
        host.setAddress({ displayUrl: data.url, mode: grimoireWebMode(data.url) }, { force: force });
    }
    if (!forActive) return;
    if (data.navigating) {
        grimoireStartNavigationSpinner(host, data.url, false);
        return;
    }
    grimoireStopNavigationSpinner(host);
    const top = shell.history && shell.history[shell.historyIndex];
    if (data.url && shell.addToHistory && (!top || top.type !== 'web' || top.url !== data.url)) {
        if (!grimoireFollowRemoteHistory(shell, data.url)) shell.addToHistory({ type: 'web', url: data.url, title: data.title || data.url });
        if (host.updateNavigationButtons) host.updateNavigationButtons();
    }
    // the tab strip shows the new title (grimoireTabs.js -> grimoireIeChrome.js)
    if (host.tabs) host.tabs.emit();
}

// The page's title arrives after its address: the history entry (and so the tab, Recent Pages and the back menu) follows it.
function grimoireTitleWebEntry(shell, data) {
    const top = shell.history && shell.history[shell.historyIndex];
    if (!data.navigating && data.title && top && top.type === 'web' && top.url === data.url) top.title = data.title;
}

function grimoirePushWebEntry(shell, entry) {
    // addToHistory: public/scripts/comp/tagWikiSearchModal.js; a background tab's state object has none
    if (typeof shell.addToHistory === 'function') {
        shell.addToHistory(entry);
        return;
    }
    shell.history = (shell.history || []).slice(0, (shell.historyIndex || 0) + 1);
    shell.history.push(entry);
    shell.historyIndex = shell.history.length - 1;
    // capTagWikiHistoryEntries: public/scripts/comp/tagWikiSearchModal.js
    const capped = capTagWikiHistoryEntries(shell.history, shell.historyIndex);
    shell.history = capped.history;
    shell.historyIndex = capped.historyIndex;
}

// A frame in a background tab (grimoireTabs.js): its address, title, history and loading ring go to that tab only.
// Downloads and popups fall through to the usual handling; a page dialog brings its tab forward; anything that
// needs the page on screen waits for the tab. Returns true when the message was handled here.
function grimoireBackgroundRemoteMessage(found, data) {
    const tabs = found.host.tabs;
    const tab = found.tab;
    const shell = found.shell;
    const type = data.type;
    if (type === 'grimoire-browser-download-progress' || type === 'grimoire-browser-download' || type === 'grimoire-browser-popup') return false;
    if (type === 'grimoire-browser-navigating' || type === 'grimoire-browser-location' || type === 'grimoire-browser-navigation-failed') {
        const shown = tabs.paneOf(tab) === shell;
        if (type === 'grimoire-browser-navigation-failed' || !data.navigating) {
            if (shown) tab.loading = false;
        } else if (shown) {
            tab.loading = true;
        }
        if (type !== 'grimoire-browser-navigation-failed') {
            shell._grimoireRemoteTitle = data.title || '';
            if (!data.navigating && data.url && window.recentItems) window.recentItems.notePage(shell, { type: 'web', url: data.url, title: data.title });
            if (data.url) {
                const mode = grimoireWebMode(data.url);
                shell.currentAddress = { fullUrl: data.url, displayPath: data.url, mode };
                shell._currentAddress = { displayUrl: data.url, fullUrl: data.url, mode };
            }
            const top = shell.history && shell.history[shell.historyIndex];
            if (!data.navigating && data.url && (!top || top.type !== 'web' || top.url !== data.url)) {
                if (!grimoireFollowRemoteHistory(shell, data.url)) grimoirePushWebEntry(shell, { type: 'web', url: data.url, title: data.title || data.url });
            }
            grimoireTitleWebEntry(shell, data);
        }
        tabs.emit();
        return true;
    }
    if (type === 'grimoire-browser-scroll') {
        shell._alchemyScroll = grimoireScrollState(data);
        return true;
    }
    if (type === 'grimoire-browser-history-intent') {
        shell._alchemyHistoryDir = data.dir === 1 ? 1 : -1;
        shell._alchemyHistoryAt = Date.now();
        return true;
    }
    if (type === 'grimoire-browser-feeds') {
        // the same list grimoireIeChrome.js frameMessage keeps for the tab on show
        shell._grimoireIeFeeds = (Array.isArray(data.feeds) ? data.feeds : [])
            .filter((feed) => feed && /^https?:\/\//i.test(feed.href || ''))
            .map((feed) => ({ href: String(feed.href), title: String(feed.title || '') }));
        return true;
    }
    if (type === 'grimoire-browser-ready') {
        shell._grimoireIeFeeds = [];
        shell._grimoireIeZoomSent = false;
        grimoireSyncAudio();
        return true;
    }
    if (type === 'grimoire-browser-status') {
        tabs.holdStatus(tab, shell, data.state || 'failed', data.url || '');
        return true;
    }
    if (type === 'grimoire-browser-reopen') {
        // the browser restarted: the session is gone, and the page reconnects when its tab is shown (grimoireTabs.js resume)
        grimoireCloseRemoteBrowser(shell);
        tabs.emit();
        return true;
    }
    if (type === 'grimoire-browser-closed') {
        shell._grimoireRemoteSessionId = '';
        if (shell === tab.state) tabs.close(tab);
        return true;
    }
    if (type === 'grimoire-browser-dialog' && data.id && shell._grimoireDialogId !== data.id) {
        // IE brings a tab with a page dialog forward; the page's state moves into the window with it
        const side = tabs.sideOf(tab, shell);
        tabs.activate(tab);
        const host = found.host;
        const live = side === 'right' && host.rightPane ? host.rightPane : host;
        live._grimoireDialogId = data.id;
        grimoireShowRemoteDialog({ host, shell: live, frame: found.frame }, data);
        return true;
    }
    // menus, selects, focus, clipboard, progress, print: they come from a page on screen
    return true;
}

// ---- tabs (grimoireTabs.js) ----

// Ctrl+T new tab, Ctrl+W / Ctrl+F4 close it, Ctrl+Tab / Ctrl+Shift+Tab next / previous, Ctrl+Q Quick Tabs,
// Ctrl+N a new window (IE7's keys).
function grimoireTabShortcut(ev) {
    const mod = (ev.ctrlKey || ev.metaKey) && !ev.altKey;
    if (!mod) return '';
    if (ev.key === 'Tab') return ev.shiftKey ? 'prev-tab' : 'next-tab';
    if (ev.shiftKey) return '';
    if (ev.key === 't' || ev.key === 'T') return 'new-tab';
    if (ev.key === 'w' || ev.key === 'W' || ev.key === 'F4') return 'close-tab';
    if (ev.key === 'q' || ev.key === 'Q') return 'quick-tabs';
    if (ev.key === 'n' || ev.key === 'N') return 'new-window';
    return '';
}

// win: the window the keys came from (its frame's window, or the focused one)
function grimoireRunTabCommand(command, win) {
    const host = win || grimoireFocusWindow() || (typeof grimoireActiveWindow === 'function' ? grimoireActiveWindow() : tagWikiSearchModal);
    const tabs = host && host.tabs;
    if (!tabs || !tabs.available()) return false;
    if (command === 'new-window') {
        // tagWikiSearchModal.js openPageInNewWindow (#615)
        host.openPageInNewWindow();
        return true;
    }
    if (command === 'quick-tabs') {
        if (host.ieChrome) host.ieChrome.toggleQuickTabs();
        return true;
    }
    // grimoireIeChrome.js: a tab command leaves Quick Tabs
    if (host.ieChrome) host.ieChrome.toggleQuickTabs(false);
    if (command === 'new-tab') tabs.open();
    else if (command === 'close-tab') tabs.close();
    else if (command === 'next-tab') tabs.step(1);
    else if (command === 'prev-tab') tabs.step(-1);
    else return false;
    return true;
}

// A page's new tab or window opens as a tab in its Grimoire window, next to the tab it came from.
// From a standalone Alchemy window, or without the tab strip, it is a window as before (grimoireOpenStandaloneWindow).
function grimoireOpenTab(found, url, session) {
    const host = found ? found.host : grimoireActiveWindow();
    const tabs = host && host.tabs;
    if (!tabs || !tabs.available()) return false;
    tabs.open({ url, session, afterActive: true });
    return true;
}

// The Alchemy audio player follows its page when a tab switch moves the page between the window and a tab's state.
function grimoireRetargetAudio(from, to) {
    if (!from || grimoireAudioShell !== from) return;
    grimoireAudioShell = to || null;
    grimoireSyncAudio();
}

// Remote pages pick their own dialog text, so it is always escaped before the dialog renders it.
function grimoireDialogHtml(text) {
    // escapeHtml: public/scripts/comp/utilities.js
    return '<div>' + escapeHtml(text).replace(/\n/g, '<br>') + '</div>';
}

// The shared dialog is hidden by the previous close animation if reopened before it ends (closeMainModal caps it at 600ms).
async function grimoireDialogIdle() {
    // isConfirmationDialogActive: public/scripts/comp/confirmationDialog.js
    for (let i = 0; i < 10 && isConfirmationDialogActive(); i++) await new Promise((resolve) => setTimeout(resolve, 100));
}

/**
 * An upload field on the page (Yozora #628): IE7's "Choose File to Upload", here the desktop's Open
 * dialog over the VFS (studioSession.js studioOpenFolderDialog with a host), with Select on Client
 * for files from this computer. The files go to the remote browser (grimoireBrowserBridge.js
 * file-chooser routes) and the page's input gets them; Cancel leaves the input empty.
 */
async function grimoireShowFileChooser(found, data) {
    const shell = found.shell;
    const sessionId = shell._grimoireRemoteSessionId;
    const query = shell._grimoireRemoteViewQuery || '';
    if (!sessionId) return;
    const base = '/api/grimoire-browser/sessions/' + encodeURIComponent(sessionId) + '/file-chooser/' + encodeURIComponent(data.id);
    const reply = (cancel) => {
        if (found.frame && found.frame.contentWindow) {
            found.frame.contentWindow.postMessage({ type: 'grimoire-browser-file-chooser-reply', id: data.id, cancel: !!cancel }, location.origin);
        }
    };
    const fail = (err) => {
        reply(true);
        showGlassToast('error', null, (err && err.message) || 'Could not upload the file', false, 5000);
    };
    const refOf = (item) => {
        if (!item || item.kind === 'folder') return null;
        if (item.targetKind === 'user-file' && !item.isUserFileLink) return { kind: 'file', id: item.targetId };
        if (item.targetKind === 'image' || item.targetKind === 'scrap') return { kind: 'image', filename: item.previewImageFilename || item.targetId };
        if (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) return { kind: 'image', filename: item.shortcutData.filename };
        return null;
    };
    const sendItems = async (items) => {
        const refs = (data.multiple ? items : items.slice(0, 1)).map(refOf).filter(Boolean);
        if (!refs.length) { reply(true); return; }
        try {
            const res = await fetch(base + '/vfs?' + query, {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ items: refs })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not upload the file');
            reply(false);
        } catch (err) {
            fail(err);
        }
    };
    const host = {
        title: 'Choose File to Upload',
        typeLabel: data.accept ? `Files (${data.accept})` : 'All Files (*.*)',
        acceptItem: (item) => !!refOf(item),
        rejectMessage: 'Choose a file',
        onOpen: (item) => sendItems([item]),
        onOpenMany: data.multiple ? (items) => sendItems(items) : null,
        onCancel: () => reply(true),
        extraButton: {
            label: 'Select on <u>C</u>lient',
            onClick: () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.multiple = !!data.multiple;
                if (data.accept) input.accept = data.accept;
                input.addEventListener('change', async () => {
                    const files = [...(input.files || [])];
                    if (!files.length) return;
                    host._settled = true;
                    const modal = document.getElementById('studioSaveFolderModal');
                    if (modal) closeModal(modal);
                    try {
                        for (const file of (data.multiple ? files : files.slice(0, 1))) {
                            const res = await fetch(base + '/upload?' + query + '&name=' + encodeURIComponent(file.name), {
                                method: 'POST',
                                credentials: 'same-origin',
                                headers: { 'Content-Type': 'application/octet-stream' },
                                body: file
                            });
                            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not upload ' + file.name);
                        }
                        reply(false);
                    } catch (err) {
                        fail(err);
                    }
                }, { once: true });
                input.click();
            }
        }
    };
    if (!host.onOpenMany) delete host.onOpenMany;
    // studioOpenFolderDialog: public/scripts/comp/studioSession.js (the Vista common file dialog)
    if (typeof studioOpenFolderDialog !== 'function') {
        host.extraButton.onClick();
        return;
    }
    const ws = typeof activeWorkspace !== 'undefined' && activeWorkspace ? activeWorkspace : '';
    await studioOpenFolderDialog('open-vfs', { host, startPath: ws ? `/Workspaces/${ws}` : '/' });
}

async function grimoireShowRemoteDialog(found, data) {
    // showConfirmationDialog / showInputDialog: public/scripts/comp/confirmationDialog.js
    const config = { title: 'Alchemy', icon: 'fas fa-atom' };
    const reply = { type: 'grimoire-browser-dialog-reply', id: data.id, accept: false };
    const message = grimoireDialogHtml(data.message || '');
    await grimoireDialogIdle();
    if (data.kind === 'prompt') {
        const text = await showInputDialog(message, data.defaultValue || '', '', null, null, config);
        reply.accept = text !== null;
        reply.text = text || '';
    } else if (data.kind === 'auth') {
        const label = grimoireDialogHtml('Sign in to ' + (data.message || '') + (data.realm ? ' (' + data.realm + ')' : ''));
        const username = await showInputDialog(label, '', 'Username', null, null, config);
        if (username !== null) await grimoireDialogIdle();
        const password = username === null ? null : await showInputDialog(label, '', 'Password', null, null, Object.assign({ inputType: 'password' }, config));
        reply.accept = password !== null;
        reply.username = username || '';
        reply.password = password || '';
    } else if (data.kind === 'alert') {
        await showConfirmationDialog(message, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, config);
        reply.accept = true;
    } else {
        const leave = data.kind === 'beforeunload';
        const text = leave && !data.message ? grimoireDialogHtml('Leave this page? Changes you made may not be saved.') : message;
        const choice = await showConfirmationDialog(text, [
            { text: leave ? 'Leave' : 'OK', value: true, className: 'btn-standard primary' },
            { text: leave ? 'Stay' : 'Cancel', value: false, className: 'btn-standard' }
        ], null, config);
        reply.accept = choice === true;
    }
    if (found.frame.contentWindow) found.frame.contentWindow.postMessage(reply, location.origin);
}

function grimoireBindRemoteBrowserMessages() {
    if (grimoireRemoteBrowserMessagesBound) return;
    grimoireRemoteBrowserMessagesBound = true;
    addEventListener('message', (event) => {
        const data = event.data;
        if (!data || typeof data.type !== 'string') return;
        const found = grimoireRemoteFromMessage(event);
        if (!found) return;
        if (found.tab && grimoireBackgroundRemoteMessage(found, data)) return;
        // the viewer has focus, so the tab keys reach it instead of the window (services/grimoire-browser/viewer.html)
        if (data.type === 'grimoire-browser-shortcut') {
            if (found.host.tabs) grimoireRunTabCommand(data.command, found.host);
            return;
        }
        if (data.type === 'grimoire-browser-navigating' || data.type === 'grimoire-browser-location' || data.type === 'grimoire-browser-navigation-failed') {
            grimoireApplyRemoteLocation(found, data);
            return;
        }
        if (data.type === 'grimoire-browser-clipboard') {
            grimoireCopyText(data.text || '');
            return;
        }
        if (data.type === 'grimoire-browser-paste-request' && found.frame.contentWindow) {
            if (!navigator.clipboard || !navigator.clipboard.readText) {
                showGlassToast('info', null, 'Paste with Ctrl+V: this connection cannot read the clipboard', false, 4000);
                return;
            }
            navigator.clipboard.readText().then((text) => {
                found.frame.contentWindow.postMessage({ type: 'grimoire-browser-paste', text: text || '' }, '*');
            }).catch(() => {});
            return;
        }
        if (data.type === 'grimoire-browser-scroll') {
            grimoireUpdateRemoteScrollbar(found, data);
            return;
        }
        if (data.type === 'grimoire-browser-history-intent') {
            found.shell._alchemyHistoryDir = data.dir === 1 ? 1 : -1;
            found.shell._alchemyHistoryAt = Date.now();
            return;
        }
        // Chromium has no further history that way: the Grimoire window steps instead (a wiki page before the site).
        if (data.type === 'grimoire-browser-history-end') {
            found.shell._alchemyHistoryDir = 0;
            if (data.dir === 1) found.shell.goForward();
            else found.shell.goBack();
            if (found.host.updateNavigationButtons) found.host.updateNavigationButtons();
            return;
        }
        if (data.type === 'grimoire-browser-menu') {
            grimoireShowRemoteMenu(found, data);
            return;
        }
        if (data.type === 'grimoire-browser-select' && Array.isArray(data.options)) {
            grimoireShowRemoteSelect(found, data);
            return;
        }
        if (data.type === 'grimoire-browser-focus') {
            if (found.host.exitAddressEdit) found.host.exitAddressEdit();
            grimoireSetAudioShell(found.shell);
            return;
        }
        if (data.type === 'grimoire-browser-ready') {
            grimoireSyncAudio();
            return;
        }
        if (data.type === 'grimoire-browser-download-progress') {
            grimoireShowDownloadProgress(found, data);
            return;
        }
        if (data.type === 'grimoire-browser-download') {
            // the file is whole in the remote browser: its dialog (begun now if it came too quick
            // for progress) follows the save into Downloads; a cancelled one is not saved
            const entry = grimoireDownloads.get(data.id) || grimoireRunningDownload(found.frame, data.filename)
                || grimoireDownloadEntry(found.frame, data, found.shell._grimoireRemoteUrl);
            if (entry) grimoireDownloads.delete(entry.id);
            grimoireDownloads.delete(data.id);
            if (entry) {
                if (!entry.cancelled) grimoireSaveToDownloads(found.shell, { download: data.id || '' }, data.filename || 'download', null, entry);
                return;
            }
            const toastId = grimoireDownloadToasts.get(data.id);
            grimoireDownloadToasts.delete(data.id);
            if (toastId) {
                updateGlassToastProgress(toastId, 100);
                updateGlassToastMessage(toastId, 'Saving ' + (data.filename || 'download') + ' to Downloads');
            }
            grimoireSaveToDownloads(found.shell, { download: data.id || '' }, data.filename || 'download', toastId);
            return;
        }
        if (data.type === 'grimoire-browser-progress') {
            grimoireShowLoadProgress(found, data.value);
            return;
        }
        if (data.type === 'grimoire-browser-popup') {
            const session = data.sessionId && data.viewerToken ? {
                tab: !!data.tab,
                sessionId: data.sessionId,
                viewUrl: '/api/grimoire-browser/view/' + encodeURIComponent(data.sessionId) + '?t=' + encodeURIComponent(data.viewerToken)
            } : null;
            // target=_blank and an extension's own page open a tab; a sign-in popup that keeps window.opener stays a small window
            if ((!session || session.tab) && grimoireOpenTab(found, data.url, session)) return;
            grimoireOpenStandaloneWindow(data.url, session);
            return;
        }
        if (data.type === 'grimoire-browser-closed') {
            found.shell._grimoireRemoteSessionId = '';
            // WikiWindowInstance.close: public/scripts/comp/tagWikiSearchModal.js (popups are always standalone windows)
            if (found.shell.manager) found.shell.close();
            // a tab whose page closed itself goes, unless it is the window's last
            else if (found.shell === found.host && found.host.tabs && found.host.tabs.count() > 1) found.host.tabs.close();
            return;
        }
        if (data.type === 'grimoire-browser-dialog' && data.id && found.shell._grimoireDialogId !== data.id) {
            found.shell._grimoireDialogId = data.id;
            grimoireShowRemoteDialog(found, data);
            return;
        }
        if (data.type === 'grimoire-browser-file-chooser' && data.id && found.shell._grimoireFileChooserId !== data.id) {
            found.shell._grimoireFileChooserId = data.id;
            grimoireShowFileChooser(found, data);
            return;
        }
        if (data.type === 'grimoire-browser-status') {
            grimoireStopNavigationSpinner(found.host);
            grimoireShowRemoteTabPage(found.shell, data.state || 'failed', data.url || '');
            return;
        }
        if (data.type === 'grimoire-browser-reopen') {
            const again = grimoireNormalizeWebUrl(data.url || '');
            if (!again) return;
            grimoireCloseRemoteBrowser(found.shell);
            grimoireOpenRemoteBrowser(found.shell, again, { host: found.host, skipHistory: true });
        }
    });
    addEventListener('keydown', grimoireForwardRemoteKey, true);
    addEventListener('keyup', grimoireForwardRemoteKey, true);
    addEventListener('click', grimoireAudioFollowPointer, true);
    document.addEventListener('visibilitychange', grimoireSyncAudio);
    grimoireLoadAlchemySettings().then(grimoireSyncAudio).catch(() => {});
}

function grimoireAddressFieldFocused() {
    const host = grimoireFocusWindow();
    const bar = host && host.addressBar;
    if (!bar || !bar.classList.contains('edit-active')) return false;
    const node = document.activeElement;
    if (!node || !node.closest) return false;
    const tag = node.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (node.isContentEditable) return true;
    if (node.closest('.address-edit-layer')) return true;
    return false;
}

function grimoireForwardRemoteKey(ev) {
    if (ev.defaultPrevented || grimoireAddressFieldFocused()) return;
    // keys go to the Alchemy page of the Grimoire window that has them (#615)
    const host = grimoireFocusWindow();
    if (!host) return;
    // the tab keys belong to the window (tagWikiSearchModal.js _handleGrimoireKeydown)
    if (grimoireTabShortcut(ev) && host.tabs && host.tabs.available()) return;
    const shell = host.activePane && host.activePane !== host ? host.activePane : host;
    const frame = grimoireRemoteFrame(shell);
    if (!frame || !frame.contentWindow || !shell._grimoireRemoteSessionId) return;
    const active = document.activeElement;
    const area = shell.displayArea;
    const addressStuck = !!(host.searchInput && active === host.searchInput);
    const inBrowser = addressStuck || active === frame || active === document.body || active === document.documentElement
        || (area && (active === area || area.contains(active)));
    if (!inBrowser) return;
    if (addressStuck) host.searchInput.blur();
    const text = ev.type === 'keydown' && !ev.ctrlKey && !ev.metaKey && !ev.altKey && ev.key && ev.key.length === 1 ? ev.key : '';
    ev.preventDefault();
    frame.contentWindow.postMessage({
        type: 'grimoire-browser-key',
        kind: ev.type === 'keyup' ? 'up' : 'down',
        key: ev.key || '',
        code: ev.code || '',
        text,
        shift: !!ev.shiftKey,
        ctrl: !!(ev.ctrlKey || ev.metaKey),
        alt: !!ev.altKey
    }, '*');
}

const ALCHEMY_SETTING_CHOICES = {
    jpegQuality: [40, 55, 70, 85],
    minFps: [5, 10, 15, 20],
    maxFps: [15, 24, 30, 45, 60],
    regionQuality: [{ value: 40, label: 'Low' }, { value: 60, label: 'Medium' }, { value: 78, label: 'High' }]
};

// userGlobalSettings.alchemy (modules/grimoireBrowserBridge.js normalizeAlchemySettings)
let grimoireAlchemySettings = null;

async function grimoireLoadAlchemySettings() {
    if (grimoireAlchemySettings) return grimoireAlchemySettings;
    // wsClient: public/scripts/websocket.js
    const data = await wsClient.getUserGlobalSettings();
    grimoireAlchemySettings = (data && data.settings && data.settings.alchemy) || { bookmarks: [] };
    return grimoireAlchemySettings;
}

async function grimoireSaveAlchemySettings(patch) {
    const data = await wsClient.updateUserGlobalSettings({ alchemy: patch });
    if (data && data.settings && data.settings.alchemy) grimoireAlchemySettings = data.settings.alchemy;
    return grimoireAlchemySettings;
}

// GET /api/grimoire-browser/extensions (modules/grimoireBrowserBridge.js); the list only changes when Alchemy restarts.
let grimoireAlchemyExtensions = null;

async function grimoireLoadAlchemyExtensions() {
    if (grimoireAlchemyExtensions) return grimoireAlchemyExtensions;
    const res = await fetch('/api/grimoire-browser/extensions', { credentials: 'same-origin' }).catch(() => null);
    if (!res || !res.ok) return [];
    const data = await res.json().catch(() => ({}));
    grimoireAlchemyExtensions = (data.extensions || []).filter((ext) => ext.popup);
    return grimoireAlchemyExtensions;
}

async function grimoireApplyAlchemySetting(key, value) {
    const saved = await grimoireSaveAlchemySettings({ [key]: value });
    grimoireRemoteShells().forEach((shell) => {
        const frame = grimoireRemoteFrame(shell);
        if (frame && frame.contentWindow && shell._grimoireRemoteSessionId) {
            frame.contentWindow.postMessage({ type: 'grimoire-browser-settings', settings: saved }, '*');
        }
    });
}

function grimoireAlchemyChoiceItems(key, current) {
    return ALCHEMY_SETTING_CHOICES[key].map((choice) => {
        const value = typeof choice === 'object' ? choice.value : choice;
        return {
            text: typeof choice === 'object' ? choice.label : String(value),
            action: 'setting',
            settingKey: key,
            settingValue: value,
            showIndicator: true,
            indicatorStyle: 'dot',
            checked: current === value
        };
    });
}

function grimoireAlchemyChoiceLabel(key, current) {
    const match = ALCHEMY_SETTING_CHOICES[key].find((choice) => (typeof choice === 'object' ? choice.value : choice) === current);
    return match && typeof match === 'object' ? match.label : String(current);
}

function grimoireOnlineWikiUrls(tagName) {
    const tag = encodeURIComponent(String(tagName || '').trim().toLowerCase().replace(/\s+/g, '_'));
    return {
        danbooru: 'https://danbooru.donmai.us/wiki_pages/' + tag,
        e621: 'https://e621.net/wiki_pages/show_or_new?title=' + tag
    };
}

// win: the Grimoire window whose Tools button was clicked (#615)
async function grimoireShowSiteMenu(ev, win) {
    // tagWikiSearchModal / contextMenu: public/scripts/comp/tagWikiSearchModal.js, contextMenu.js
    const host = win || grimoireFocusWindow() || tagWikiSearchModal;
    const button = host && host.part ? host.part('grimoireAddressSiteBtn') : null;
    if (!host || !button || !contextMenu) return;
    const shell = host.activePane && host.activePane !== host ? host.activePane : host;
    const editing = host.addressBar && host.addressBar.classList.contains('edit-active');
    const raw = editing && host.searchInput
        ? host.searchInput.value
        : ((host.currentAddress && host.currentAddress.fullUrl) || '');
    const web = grimoireNormalizeWebUrl(raw) || grimoireBareWebUrl(raw);
    const hostName = grimoireSiteLabel(raw);
    const wikiTerm = hostName ? hostName.split('.')[0] : String(raw || '').trim();
    const pageUrl = grimoireShellWebUrl(shell);
    const markUrl = grimoireShellBookmarkUrl(shell, host);
    const [settings, extensionList] = await Promise.all([grimoireLoadAlchemySettings(), grimoireLoadAlchemyExtensions()]);
    const bookmarks = settings.bookmarks || [];
    const bookmarked = markUrl && bookmarks.some((row) => row.url === markUrl);

    const items = [];
    if (web && web !== pageUrl) items.push({ text: 'Open in Alchemy', icon: 'fas fa-globe', action: 'browser' });
    if (wikiTerm) {
        items.push({ text: 'Open wiki page', icon: 'fas fa-book', action: 'wiki' });
        items.push({ text: 'Search wiki', icon: 'fas fa-search', action: 'search' });
    }
    if (items.length) items.push({ separator: true });
    items.push({
        text: 'Bookmarks',
        icon: 'fas fa-bookmark',
        submenu: bookmarks.length
            ? bookmarks.map((row) => ({ text: row.title || row.url, subtext: grimoireSiteLabel(row.url), action: 'bookmark-open', bookmarkUrl: row.url }))
            : [{ text: 'No bookmarks', disabled: true }]
    });
    if (markUrl) {
        items.push(bookmarked
            ? { text: 'Remove bookmark', icon: 'fas fa-bookmark-slash', action: 'bookmark-remove' }
            : { text: 'Bookmark this page', icon: 'far fa-bookmark', action: 'bookmark-add' });
    }
    // History: every page visited, by day (grimoireCoreDomains.js en.grimoire.jp/history, #628)
    items.push({ text: 'History', icon: 'fas fa-clock-rotate-left', action: 'history' });
    items.push({
        text: 'Extensions',
        icon: 'fas fa-puzzle-piece',
        submenu: extensionList.length
            ? extensionList.map((ext) => ({ text: ext.name, action: 'extension', extensionPopup: ext.popup }))
            : [{ text: 'No extensions', disabled: true }]
    });
    items.push({ separator: true });
    // IE7's Tools > Internet Options: Control Panel's Internet Properties (cplDialogs2.js, cplInternetOptions.js)
    items.push({ text: 'Internet Options', icon: 'fas fa-globe', action: 'internet-options' });
    items.push({ text: 'Settings', icon: 'fas fa-gear', action: 'chrome-settings' });
    items.push({ text: 'JPEG quality', icon: 'fas fa-image', valueDisplay: String(settings.jpegQuality), submenu: grimoireAlchemyChoiceItems('jpegQuality', settings.jpegQuality) });
    items.push({ text: 'Min FPS', icon: 'fas fa-gauge-low', valueDisplay: String(settings.minFps), submenu: grimoireAlchemyChoiceItems('minFps', settings.minFps) });
    items.push({ text: 'Max FPS', icon: 'fas fa-gauge-high', valueDisplay: String(settings.maxFps), submenu: grimoireAlchemyChoiceItems('maxFps', settings.maxFps) });
    items.push({ text: 'Compression', icon: 'fas fa-file-zipper', valueDisplay: grimoireAlchemyChoiceLabel('regionQuality', settings.regionQuality), submenu: grimoireAlchemyChoiceItems('regionQuality', settings.regionQuality) });
    items.push({ text: 'Restart browser', icon: 'fas fa-rotate-right', action: 'restart' });

    contextMenu.attachToElement(button, {
        sections: [{ type: 'list', items }],
        onAction: (action, target, item) => {
            if (action === 'browser' && web) {
                host.navigate(web);
                return;
            }
            if (action === 'bookmark-open') {
                host.navigate(item.bookmarkUrl);
                return;
            }
            if (action === 'internet-options') {
                Promise.resolve(window.featureLoader ? featureLoader.loadFeature('control_panel') : null)
                    .then(() => { if (window.cplDialogs) window.cplDialogs.open('internet-options', null, host.modal || null); })
                    .catch(() => showGlassToast('error', null, 'Internet Options could not open', false, 4000));
                return;
            }
            if (action === 'chrome-settings') {
                host.navigate('chrome://settings');
                return;
            }
            if (action === 'extension') {
                grimoireOpenStandaloneWindow(item.extensionPopup, true);
                return;
            }
            if (action === 'setting') {
                grimoireApplyAlchemySetting(item.settingKey, item.settingValue).catch(() => {
                    showGlassToast('error', null, 'Could not save Alchemy settings', false, 4000);
                });
                return;
            }
            if (action === 'history') {
                host.navigate(window.GRIMOIRE_HISTORY_URL || 'dsap://history.grimoire.jp');
                return;
            }
            if (action === 'bookmark-add' || action === 'bookmark-remove') {
                const next = action === 'bookmark-add'
                    ? [{ url: markUrl, title: grimoireShellBookmarkTitle(shell, markUrl) }].concat(bookmarks)
                    : bookmarks.filter((row) => row.url !== markUrl);
                grimoireSaveAlchemySettings({ bookmarks: next }).catch(() => {
                    showGlassToast('error', null, 'Could not save bookmarks', false, 4000);
                });
                return;
            }
            if (action === 'restart') {
                grimoireAlchemyExtensions = null;
                fetch('/api/grimoire-browser/restart', { method: 'POST', credentials: 'same-origin' }).then((res) => {
                    if (!res.ok) throw new Error('restart');
                }).catch(() => {
                    showGlassToast('error', null, 'Alchemy could not restart', false, 4000);
                });
                return;
            }
            grimoireCloseRemoteBrowser(shell);
            if (action === 'wiki') {
                host.getTagWikiPageDirectly(wikiTerm.replace(/-/g, ' '));
                return;
            }
            if (action === 'search') {
                host.navigate('edtx://en.grimoire.jp/search?q=' + encodeURIComponent(hostName || wikiTerm));
            }
        }
    });
    contextMenu.showMenu(ev, button);
}

function grimoireCloseRemoteBrowser(shell) {
    if (!shell) return;
    const id = shell._grimoireRemoteSessionId;
    shell._grimoireRemoteSessionId = '';
    shell._grimoireRemoteViewQuery = '';
    if (grimoireAudioShell === shell) grimoireAudioShell = null;
    // the load fill of the window showing this page (#615)
    const owner = grimoireHostOf(shell);
    const bar = owner && (owner === shell || owner.activePane === shell) ? owner.addressBar : null;
    if (bar) bar.removeAttribute('data-alchemy-loading');
    const frame = grimoireRemoteFrame(shell);
    if (frame) frame.remove();
    if (shell.displayArea) shell.displayArea.querySelectorAll(':scope > :is(.alchemy-scrollbar, .alchemy-scrollbar-corner)').forEach((el) => el.remove());
    shell._alchemyScroll = null;
    grimoireSyncAudio();
    if (!id) return Promise.resolve();
    // resolves once the service has let the session go (grimoireTabs.js freeSession waits for it)
    return fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true
    }).catch(() => {});
}

function grimoireRemoteBrowserReload(shell) {
    const frame = grimoireRemoteFrame(shell);
    if (!frame || !frame.contentWindow || !shell._grimoireRemoteSessionId) return false;
    const host = grimoireHostOf(shell);
    if (host) grimoireStartNavigationSpinner(host, shell && shell.history && shell.history[shell.historyIndex] && shell.history[shell.historyIndex].url, true);
    frame.contentWindow.postMessage({ type: 'grimoire-browser-reload' }, '*');
    return true;
}

function grimoireShowRemoteTabPage(shell, state, url) {
    const area = shell && shell.displayArea;
    if (!area) return;
    const frame = grimoireRemoteFrame(shell);
    const existing = area.querySelector(':scope > .grimoire-nav-error');
    if (state === 'ok') {
        if (existing) existing.remove();
        if (frame) frame.hidden = false;
        return;
    }
    if (frame) frame.hidden = true;
    const page = existing || document.createElement('div');
    page.className = 'grimoire-nav-error';
    page.replaceChildren();
    const icon = document.createElement('div');
    icon.className = 'grimoire-nav-error-icon';
    const iconMark = document.createElement('i');
    iconMark.className = 'fas fa-atom';
    icon.appendChild(iconMark);
    const title = document.createElement('h2');
    title.className = 'grimoire-nav-error-title';
    const hung = state === 'unresponsive';
    const unavailable = state === 'unavailable';
    title.textContent = hung
        ? "This page isn't responding"
        : (unavailable ? 'Alchemy unavailable' : 'This page has failed');
    const urlEl = document.createElement('p');
    urlEl.className = 'grimoire-nav-error-url';
    urlEl.textContent = url || '';
    const detail = document.createElement('p');
    detail.className = 'grimoire-nav-error-detail';
    detail.textContent = hung
        ? 'Alchemy is waiting on this page. You can wait, or reload it.'
        : (unavailable
            ? 'Alchemy is not available right now. Try again in a moment.'
            : 'Alchemy could not keep this page open. Reload to try again.');
    const actions = document.createElement('div');
    actions.className = 'grimoire-nav-error-actions';
    const reload = document.createElement('button');
    reload.type = 'button';
    reload.className = 'btn-secondary btn-small';
    const reloadMark = document.createElement('i');
    reloadMark.className = 'fas fa-rotate-right';
    reload.appendChild(reloadMark);
    reload.appendChild(document.createTextNode(' Reload'));
    const home = document.createElement('button');
    home.type = 'button';
    home.className = 'btn-secondary btn-small';
    const homeMark = document.createElement('i');
    homeMark.className = 'fas fa-home';
    home.appendChild(homeMark);
    home.appendChild(document.createTextNode(' Home'));
    actions.appendChild(reload);
    actions.appendChild(home);
    page.append(icon, title, urlEl, detail, actions);
    if (!existing) area.appendChild(page);
    reload.addEventListener('click', () => {
        const live = grimoireRemoteFrame(shell);
        if (hung && live && live.contentWindow && shell._grimoireRemoteSessionId) {
            grimoireShowRemoteTabPage(shell, 'ok');
            live.contentWindow.postMessage({ type: 'grimoire-browser-reload' }, '*');
            return;
        }
        const again = grimoireNormalizeWebUrl(url);
        const host = shell.modal && shell.modal.classList.contains('wiki-page-viewer-modal') ? shell : grimoireHostOf(shell);
        if (again) grimoireOpenRemoteBrowser(shell, again, { host: host || shell, skipHistory: true });
    });
    home.addEventListener('click', () => {
        // goHome: public/scripts/comp/tagWikiSearchModal.js
        shell.goHome();
    });
}

// popup: true for a small window with a new session (extension popup), or { sessionId, viewUrl, tab } to stream a page that is already open (server adoptPopup; tab = an extension's own page, normal size).
/** Same as Alchemy context menu "Open in new window" (open-window). */
function grimoireOpenCurrentPageInNewWindow(shell) {
    const url = grimoireShellWebUrl(shell);
    if (!url) return false;
    grimoireOpenStandaloneWindow(url);
    return true;
}

function grimoireOpenStandaloneWindow(url, popup, windowTitle) {
    const webUrl = grimoireNormalizeWebUrl(url);
    const session = popup && popup.sessionId ? popup : null;
    // wikiWindowManager: public/scripts/comp/tagWikiSearchModal.js
    if ((!webUrl && !session) || !wikiWindowManager) return;
    const label = (typeof windowTitle === 'string' && windowTitle.trim()) ? windowTitle.trim() : (webUrl || 'Alchemy');
    const small = !!popup && !popup.tab;
    const win = wikiWindowManager.createWindow(null, { title: label, name: small ? 'alchemy-popup' : label }, null,
        small ? { alchemyPopup: '1', windowMinWidth: '360', windowMinHeight: '420' } : null);
    if (!win) return;
    grimoireOpenRemoteBrowser(win, webUrl, { host: win, session, popup: !!popup });
}

function grimoireShowBrowserUnavailable(host, shell, url) {
    host.setAddress({ displayUrl: url, mode: grimoireWebMode(url) }, { force: true });
    // showGrimoireNavigateErrorPage: public/scripts/comp/tagWikiSearchModal.js
    shell.showGrimoireNavigateErrorPage({
        url,
        kind: 'browser_unavailable',
        protocol: 'https',
        skipHistory: true,
        skipLoadingDelay: true
    });
    // finishGrimoireNavigationLoading: public/scripts/comp/tagWikiSearchModal.js
    host.finishGrimoireNavigationLoading();
}

async function grimoireOpenRemoteBrowser(shell, url, options) {
    const opts = options || {};
    const host = opts.host || shell;
    const webUrl = grimoireNormalizeWebUrl(url);
    if (!shell || !shell.displayArea || (!webUrl && !opts.session)) return;

    grimoireBindRemoteBrowserMessages();
    // exitAddressEdit / setNavigationLoading: public/scripts/comp/tagWikiSearchModal.js
    host.exitAddressEdit();
    grimoireStartNavigationSpinner(host, webUrl, true);
    host.setAddress({ displayUrl: webUrl, mode: grimoireWebMode(webUrl) }, { force: shell !== host });

    // deactivateDsapOnShell: public/scripts/comp/dsapRegistry.js
    deactivateDsapOnShell(shell);
    host._searchPageMode = false;
    if (host.searchBody) host.searchBody.classList.remove('search-page-view');

    const existing = grimoireRemoteFrame(shell);
    if (existing && existing.contentWindow && shell._grimoireRemoteSessionId) {
        existing.contentWindow.postMessage({ type: 'grimoire-browser-navigate', url: webUrl }, '*');
        if (!opts.skipHistory) {
            shell.addToHistory({ type: 'web', url: webUrl, title: webUrl });
        }
        host.updateNavigationButtons();
        return;
    }

    grimoireCloseRemoteBrowser(shell);

    let payload = opts.session;
    if (!payload) {
        const create = () => fetch('/api/grimoire-browser/sessions', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webUrl,
                width: Math.max(320, shell.displayArea.clientWidth || 1280),
                height: Math.max(240, shell.displayArea.clientHeight || 800),
                popup: !!opts.popup
            })
        });
        let response;
        try {
            response = await create();
            // the service's session cap: a background tab gives its session up (grimoireTabs.js freeSession),
            // the window used longest ago first (#615)
            if (response.status === 429 && !opts.popup) {
                const windows = grimoireFullWindows().filter((win) => win.tabs).sort((a, b) => (a.lastActive || 0) - (b.lastActive || 0));
                for (const win of windows) {
                    if (await win.tabs.freeSession()) {
                        response = await create();
                        break;
                    }
                }
            }
        } catch (e) {
            grimoireShowBrowserUnavailable(host, shell, webUrl);
            return;
        }
        try { payload = await response.json(); } catch (e) { payload = {}; }
        if (!response.ok || !payload.viewUrl) {
            grimoireShowBrowserUnavailable(host, shell, webUrl);
            return;
        }
    }

    shell._grimoireRemoteSessionId = payload.sessionId || '';
    shell._grimoireRemoteViewQuery = String(payload.viewUrl || '').split('?')[1] || '';
    shell.displayArea.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.src = payload.viewUrl;
    frame.setAttribute('title', 'Web');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', 'autoplay; clipboard-read; clipboard-write');
    shell.displayArea.appendChild(frame);
    grimoireSetAudioShell(shell);

    if (!opts.skipHistory && webUrl) {
        shell.addToHistory({ type: 'web', url: webUrl, title: webUrl });
    }
    shell.blank = false;
    host.updateNavigationButtons();
}
