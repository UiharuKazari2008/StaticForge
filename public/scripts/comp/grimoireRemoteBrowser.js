/**
 * Embedded web view for Grimoire.
 * The iframe loads the remote browser service (services/grimoire-browser),
 * which may be another host. The target site is rendered in Chromium there.
 */

let grimoireRemoteBrowserMessagesBound = false;
let grimoireAudioShell = null;
let grimoireAudioFocused = false;
let grimoireAudioVolume = null;

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
    return { type: 'grimoire-browser-audio', on, volume: grimoireAudioVolumeNow() / 100 };
}

function grimoireSyncAudio() {
    let live = false;
    grimoireRemoteShells().forEach((shell) => {
        const frame = grimoireRemoteFrame(shell);
        if (!frame || !shell._grimoireRemoteSessionId) return;
        live = true;
        if (frame.contentWindow) frame.contentWindow.postMessage(grimoireAudioState(shell), '*');
    });
    const icon = document.getElementById('alchemyAudioTrayIcon');
    if (!icon) return;
    icon.classList.toggle('hidden', !live);
    const volume = grimoireAudioVolumeNow();
    const glyph = (grimoireAlchemySettings || {}).audioEnabled === false || volume === 0 ? 'fa-volume-xmark' : (volume < 50 ? 'fa-volume-low' : 'fa-volume-high');
    icon.firstElementChild.className = 'fas ' + glyph;
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

function grimoireShowAudioMenu(ev) {
    const icon = document.getElementById('alchemyAudioTrayIcon');
    if (!icon) return;
    grimoireLoadAlchemySettings().then((settings) => {
        contextMenu.attachToElement(icon, {
            sections: [
                {
                    type: 'custom',
                    title: 'Alchemy audio',
                    content: () => {
                        const row = document.createElement('div');
                        row.className = 'menu-item-row';
                        row.style.cssText = 'gap: var(--spacing-sm); padding: var(--spacing-xs) 10px;';
                        row.innerHTML = '<i class="fas fa-volume-high"></i>';
                        const slider = document.createElement('input');
                        slider.type = 'range';
                        slider.className = 'slider-input';
                        slider.style.flex = '1';
                        slider.min = '0';
                        slider.max = '100';
                        slider.step = '1';
                        slider.value = String(settings.audioVolume !== undefined ? settings.audioVolume : 100);
                        slider.addEventListener('input', () => {
                            grimoireAudioVolume = Number(slider.value);
                            grimoireSyncAudio();
                        });
                        slider.addEventListener('change', () => {
                            grimoireSaveAlchemySettings({ audioVolume: Number(slider.value) }).then(() => {
                                grimoireAudioVolume = null;
                            }).catch(() => {
                                showGlassToast('error', null, 'Could not save Alchemy settings', false, 4000);
                            });
                        });
                        row.appendChild(slider);
                        return row;
                    }
                },
                {
                    type: 'list',
                    items: [
                        { text: 'Play audio', icon: 'fas fa-volume-high', action: 'audioEnabled', showIndicator: true, checked: settings.audioEnabled !== false },
                        { text: 'Play in background', icon: 'fas fa-moon', action: 'audioBackground', showIndicator: true, checked: settings.audioBackground === true }
                    ]
                }
            ],
            onAction: (action, target, item) => {
                grimoireSaveAlchemySettings({ [action]: !item.checked }).then(grimoireSyncAudio).catch(() => {
                    showGlassToast('error', null, 'Could not save Alchemy settings', false, 4000);
                });
            }
        });
        contextMenu.showMenu(ev, icon);
    });
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

function grimoireRemoteShells() {
    const host = tagWikiSearchModal;
    const shells = [];
    if (host) {
        shells.push(host);
        if (host.rightPane) shells.push(host.rightPane);
    }
    // wikiWindowManager: public/scripts/comp/tagWikiSearchModal.js
    if (wikiWindowManager && wikiWindowManager.windows) {
        wikiWindowManager.windows.forEach((win) => shells.push(win));
    }
    return shells;
}

function grimoireRemoteFromMessage(event) {
    const host = tagWikiSearchModal;
    if (!host) return null;
    const shells = grimoireRemoteShells();
    for (let i = 0; i < shells.length; i++) {
        const frame = grimoireRemoteFrame(shells[i]);
        if (frame && event.source === frame.contentWindow) {
            const shell = shells[i];
            const standalone = !!(shell.modal && shell.modal.classList.contains('wiki-page-viewer-modal'));
            return { host: standalone ? shell : host, shell, frame };
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

// Download guid -> progress toast id, while the remote page is still downloading.
const grimoireDownloadToasts = new Map();

// showGlassToast, updateGlassToastProgress, updateGlassToastMessage, removeGlassToast: public/scripts/comp/toastManager.js
// formatBytes: public/scripts/comp/systemTrayManager.js
function grimoireShowDownloadProgress(data) {
    let toastId = grimoireDownloadToasts.get(data.id);
    if (data.canceled) {
        if (toastId) removeGlassToast(toastId);
        grimoireDownloadToasts.delete(data.id);
        return;
    }
    const text = 'Downloading ' + data.filename + ' - ' + formatBytes(data.received) + (data.total ? ' of ' + formatBytes(data.total) : '');
    if (!toastId) {
        toastId = showGlassToast('info', null, text, true, false, '<i class="fas fa-download"></i>');
        grimoireDownloadToasts.set(data.id, toastId);
    } else {
        updateGlassToastMessage(toastId, text);
    }
    if (data.total) updateGlassToastProgress(toastId, (data.received / data.total) * 100);
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
    host._grimoireLoadFillTimer = setTimeout(() => bar.removeAttribute('data-alchemy-loading'), 350);
}

// Saves into the active workspace's VFS Downloads folder (grimoireBrowserBridge.js /save), not the browser's downloads.
async function grimoireSaveToDownloads(shell, ref, filename, progressToastId) {
    const id = shell && shell._grimoireRemoteSessionId;
    if (!id) return;
    if (!progressToastId) progressToastId = showGlassToast('info', null, 'Saving ' + filename + ' to Downloads', false, false, '<i class="fas fa-download"></i>');
    try {
        const res = await fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(id) + '/save?' + shell._grimoireRemoteViewQuery, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(Object.assign({ filename, workspaceId: currentWorkspace }, ref))
        });
        const info = await res.json().catch(() => ({}));
        removeGlassToast(progressToastId);
        if (!res.ok) throw new Error(info.error || 'save failed');
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
    const area = document.createElement('textarea');
    area.value = value;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    area.remove();
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

function grimoireShellWebUrl(shell) {
    const top = shell && shell.history && shell.history[shell.historyIndex];
    return top && top.type === 'web' ? top.url : '';
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
        grimoireOpenStandaloneWindow(data.href || grimoireShellWebUrl(shell));
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
        grimoireSaveToDownloads(shell, { url: data.src }, name);
        return;
    }
    if (action === 'download-link') {
        let name = 'download';
        try { name = new URL(data.href).pathname.split('/').pop() || name; } catch (e) {}
        grimoireSaveToDownloads(shell, { url: data.href }, name);
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
        shell.addToHistory({ type: 'web', url: data.url, title: data.title || data.url });
        if (host.updateNavigationButtons) host.updateNavigationButtons();
    }
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
        if (data.type === 'grimoire-browser-navigating' || data.type === 'grimoire-browser-location' || data.type === 'grimoire-browser-navigation-failed') {
            grimoireApplyRemoteLocation(found, data);
            return;
        }
        if (data.type === 'grimoire-browser-clipboard') {
            grimoireCopyText(data.text || '');
            return;
        }
        if (data.type === 'grimoire-browser-paste-request' && found.frame.contentWindow) {
            navigator.clipboard.readText().then((text) => {
                found.frame.contentWindow.postMessage({ type: 'grimoire-browser-paste', text: text || '' }, '*');
            }).catch(() => {});
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
            grimoireShowDownloadProgress(data);
            return;
        }
        if (data.type === 'grimoire-browser-download') {
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
            grimoireOpenStandaloneWindow(data.url, data.sessionId && data.viewerToken ? {
                tab: !!data.tab,
                sessionId: data.sessionId,
                viewUrl: '/api/grimoire-browser/view/' + encodeURIComponent(data.sessionId) + '?t=' + encodeURIComponent(data.viewerToken)
            } : null);
            return;
        }
        if (data.type === 'grimoire-browser-closed') {
            found.shell._grimoireRemoteSessionId = '';
            // WikiWindowInstance.close: public/scripts/comp/tagWikiSearchModal.js (popups are always standalone windows)
            if (found.shell.manager) found.shell.close();
            return;
        }
        if (data.type === 'grimoire-browser-dialog' && data.id && found.shell._grimoireDialogId !== data.id) {
            found.shell._grimoireDialogId = data.id;
            grimoireShowRemoteDialog(found, data);
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
    const audioIcon = document.getElementById('alchemyAudioTrayIcon');
    if (audioIcon) audioIcon.addEventListener('click', grimoireShowAudioMenu);
    grimoireLoadAlchemySettings().then(grimoireSyncAudio).catch(() => {});
}

function grimoireAddressFieldFocused() {
    // tagWikiSearchModal: public/scripts/comp/tagWikiSearchModal.js
    const host = tagWikiSearchModal;
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
    // tagWikiSearchModal: public/scripts/comp/tagWikiSearchModal.js
    const host = tagWikiSearchModal;
    if (!host) return;
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

async function grimoireShowSiteMenu(ev) {
    // tagWikiSearchModal / contextMenu: public/scripts/comp/tagWikiSearchModal.js, contextMenu.js
    const host = tagWikiSearchModal;
    const button = document.getElementById('grimoireAddressSiteBtn');
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
    const [settings, extensionList] = await Promise.all([grimoireLoadAlchemySettings(), grimoireLoadAlchemyExtensions()]);
    const bookmarks = settings.bookmarks || [];
    const bookmarked = pageUrl && bookmarks.some((row) => row.url === pageUrl);

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
    if (pageUrl) {
        items.push(bookmarked
            ? { text: 'Remove bookmark', icon: 'fas fa-bookmark-slash', action: 'bookmark-remove' }
            : { text: 'Bookmark this page', icon: 'far fa-bookmark', action: 'bookmark-add' });
    }
    items.push({
        text: 'Extensions',
        icon: 'fas fa-puzzle-piece',
        submenu: extensionList.length
            ? extensionList.map((ext) => ({ text: ext.name, action: 'extension', extensionPopup: ext.popup }))
            : [{ text: 'No extensions', disabled: true }]
    });
    items.push({ separator: true });
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
            if (action === 'bookmark-add' || action === 'bookmark-remove') {
                const top = shell.history[shell.historyIndex];
                const next = action === 'bookmark-add'
                    ? [{ url: pageUrl, title: (top && top.title) || pageUrl }].concat(bookmarks)
                    : bookmarks.filter((row) => row.url !== pageUrl);
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
    const bar = tagWikiSearchModal && tagWikiSearchModal.addressBar;
    if (bar) bar.removeAttribute('data-alchemy-loading');
    const frame = grimoireRemoteFrame(shell);
    if (frame) frame.remove();
    grimoireSyncAudio();
    if (!id) return;
    fetch('/api/grimoire-browser/sessions/' + encodeURIComponent(id), {
        method: 'DELETE',
        credentials: 'same-origin',
        keepalive: true
    }).catch(() => {});
}

function grimoireRemoteBrowserReload(shell) {
    const frame = grimoireRemoteFrame(shell);
    if (!frame || !frame.contentWindow || !shell._grimoireRemoteSessionId) return false;
    const host = tagWikiSearchModal;
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
        const host = shell.modal && shell.modal.classList.contains('wiki-page-viewer-modal') ? shell : tagWikiSearchModal;
        if (again) grimoireOpenRemoteBrowser(shell, again, { host: host || shell, skipHistory: true });
    });
    home.addEventListener('click', () => {
        // goHome: public/scripts/comp/tagWikiSearchModal.js
        shell.goHome();
    });
}

// popup: true for a small window with a new session (extension popup), or { sessionId, viewUrl, tab } to stream a page that is already open (server adoptPopup; tab = an extension's own page, normal size).
function grimoireOpenStandaloneWindow(url, popup) {
    const webUrl = grimoireNormalizeWebUrl(url);
    const session = popup && popup.sessionId ? popup : null;
    // wikiWindowManager: public/scripts/comp/tagWikiSearchModal.js
    if ((!webUrl && !session) || !wikiWindowManager) return;
    const label = webUrl || 'Alchemy';
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
        let response;
        try {
            response = await fetch('/api/grimoire-browser/sessions', {
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
    shell.displayArea.appendChild(frame);
    grimoireSetAudioShell(shell);

    if (!opts.skipHistory && webUrl) {
        shell.addToHistory({ type: 'web', url: webUrl, title: webUrl });
    }
    shell.blank = false;
    host.updateNavigationButtons();
}
