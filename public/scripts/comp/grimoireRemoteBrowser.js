/**
 * Embedded web view for Grimoire.
 * The iframe loads the remote browser service (services/grimoire-browser),
 * which may be another host. The target site is rendered in Chromium there.
 */

let grimoireRemoteBrowserMessagesBound = false;

function grimoireNormalizeWebUrl(url) {
    const raw = String(url || '').trim();
    if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
    try {
        const parsed = new URL(raw);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && parsed.protocol !== 'chrome:') return '';
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
    if (/^chrome:/i.test(url)) return 'chrome';
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

function grimoireRemoteMenuAction(found, action, data) {
    const shell = found.shell;
    if (action === 'copy-text') {
        grimoireCopyText(data.text);
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
        grimoireSaveUrl(grimoireRemoteFileUrl(shell, 'resource', data.src), data.alt || 'image');
        return;
    }
    if (action === 'download-link') {
        let name = 'download';
        try { name = new URL(data.href).pathname.split('/').pop() || name; } catch (e) {}
        grimoireSaveUrl(grimoireRemoteFileUrl(shell, 'resource', data.href), name);
    }
}

function grimoireShowRemoteMenu(found, data) {
    const frame = found.frame;
    const rect = frame.getBoundingClientRect();
    const selection = data.selection || '';
    const text = selection || data.text || '';
    const href = data.href || '';
    const src = data.src || '';
    const items = [];
    if (text) items.push({ text: 'Copy', icon: 'fas fa-copy', action: 'copy-text' });
    if (href) {
        items.push({ text: 'Copy link', icon: 'fas fa-link', action: 'copy-link' });
        items.push({ text: 'Open link', icon: 'fas fa-external-link-alt', action: 'open-link' });
        if (!src) items.push({ text: 'Download', icon: 'fas fa-download', action: 'download-link' });
    }
    if (src) {
        items.push({ text: 'Copy image', icon: 'fas fa-image', action: 'copy-image' });
        items.push({ text: 'Save image', icon: 'fas fa-download', action: 'save-image' });
    }
    if (!items.length) return;
    // contextMenu: public/scripts/comp/contextMenu.js
    contextMenu.attachToElement(frame, {
        sections: [{ type: 'list', items }],
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
        if (data.type === 'grimoire-browser-focus') {
            if (found.host.exitAddressEdit) found.host.exitAddressEdit();
            return;
        }
        if (data.type === 'grimoire-browser-download') {
            grimoireSaveUrl(grimoireRemoteFileUrl(found.shell, 'download', data.id || ''), data.filename || 'download');
            return;
        }
        if (data.type === 'grimoire-browser-popup') {
            grimoireOpenStandaloneWindow(data.url);
            return;
        }
        if (data.type === 'grimoire-browser-status') {
            grimoireStopNavigationSpinner(found.host);
            grimoireShowRemoteTabPage(found.shell, data.state || 'failed', data.url || '');
            return;
        }
        if (data.type === 'grimoire-browser-reopen') {
            const again = grimoireNormalizeWebUrl(data.url || '');
            if (again) grimoireOpenRemoteBrowser(found.shell, again, { host: found.host, skipHistory: true });
        }
    });
    addEventListener('keydown', grimoireForwardRemoteKey, true);
    addEventListener('keyup', grimoireForwardRemoteKey, true);
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

function grimoireShowSiteMenu(ev) {
    // tagWikiSearchModal / contextMenu: public/scripts/comp/tagWikiSearchModal.js, contextMenu.js
    const host = tagWikiSearchModal;
    const button = document.getElementById('grimoireAddressSiteBtn');
    if (!host || !button || !contextMenu) return;
    const editing = host.addressBar && host.addressBar.classList.contains('edit-active');
    const raw = editing && host.searchInput
        ? host.searchInput.value
        : ((host.currentAddress && host.currentAddress.fullUrl) || '');
    const web = grimoireNormalizeWebUrl(raw) || grimoireBareWebUrl(raw);
    const hostName = grimoireSiteLabel(raw);
    const wikiTerm = hostName ? hostName.split('.')[0] : String(raw || '').trim();
    const items = [];
    if (web) items.push({ text: 'Open in browser', icon: 'fas fa-globe', action: 'browser' });
    if (wikiTerm) {
        items.push({ text: 'Open wiki page', icon: 'fas fa-book', action: 'wiki' });
        items.push({ text: 'Search wiki', icon: 'fas fa-search', action: 'search' });
    }
    if (!items.length) return;
    contextMenu.attachToElement(button, {
        sections: [{ type: 'list', items }],
        onAction: (action) => {
            if (action === 'browser' && web) {
                host.navigate(web);
                return;
            }
            const shell = host.activePane && host.activePane !== host ? host.activePane : host;
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
    const frame = grimoireRemoteFrame(shell);
    if (frame) frame.remove();
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
    iconMark.className = 'fas fa-globe';
    icon.appendChild(iconMark);
    const title = document.createElement('h2');
    title.className = 'grimoire-nav-error-title';
    const hung = state === 'unresponsive';
    const unavailable = state === 'unavailable';
    title.textContent = hung
        ? "This page isn't responding"
        : (unavailable ? 'Web browser unavailable' : 'This page has failed');
    const urlEl = document.createElement('p');
    urlEl.className = 'grimoire-nav-error-url';
    urlEl.textContent = url || '';
    const detail = document.createElement('p');
    detail.className = 'grimoire-nav-error-detail';
    detail.textContent = hung
        ? 'The remote tab has stopped answering. You can wait, or reload it.'
        : (unavailable
            ? 'Grimoire could not open the remote browser service. Check that it is running and Dreamscape is pointed at it.'
            : 'The remote browser tab is no longer running.');
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

function grimoireOpenStandaloneWindow(url) {
    const webUrl = grimoireNormalizeWebUrl(url);
    // wikiWindowManager: public/scripts/comp/tagWikiSearchModal.js
    if (!webUrl || !wikiWindowManager) return;
    const win = wikiWindowManager.createWindow(null, { title: webUrl, name: webUrl });
    if (!win) return;
    grimoireOpenRemoteBrowser(win, webUrl, { host: win });
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
    if (!shell || !shell.displayArea || !webUrl) return;

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

    let response;
    try {
        response = await fetch('/api/grimoire-browser/sessions', {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                url: webUrl,
                width: Math.max(320, shell.displayArea.clientWidth || 1280),
                height: Math.max(240, shell.displayArea.clientHeight || 800)
            })
        });
    } catch (e) {
        grimoireShowBrowserUnavailable(host, shell, webUrl);
        return;
    }

    let payload = {};
    try { payload = await response.json(); } catch (e) { payload = {}; }
    if (!response.ok || !payload.viewUrl) {
        grimoireShowBrowserUnavailable(host, shell, webUrl);
        return;
    }

    shell._grimoireRemoteSessionId = payload.sessionId || '';
    shell._grimoireRemoteViewQuery = String(payload.viewUrl || '').split('?')[1] || '';
    shell.displayArea.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.src = payload.viewUrl;
    frame.setAttribute('title', 'Web');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    shell.displayArea.appendChild(frame);

    if (!opts.skipHistory) {
        shell.addToHistory({ type: 'web', url: webUrl, title: webUrl });
    }
    shell.blank = false;
    host.updateNavigationButtons();
}
