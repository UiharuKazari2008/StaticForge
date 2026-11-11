/**
 * Sequenzia as a network drive in Cartograph (Yozora #749). The server mounts it in the VFS at
 * /~sequenzia (modules/vfsSequenzia.js), so listing, sorting, paging, the address bar and Back/Up
 * are the VFS's own. This file is the part the applet branches to for its items:
 *
 *   folders   targetKind 'sequenzia-folder', navPath: opened by the applet as any folder
 *   files     targetKind 'sequenzia-entry', downloadUrl / viewUrl / previewUrl
 *
 * Open: pictures in the viewer, video / audio / text / PDF in a tab from viewUrl (bytes with
 * Range, so video seeks), anything else downloads. The drive is read-only for now, so the menus
 * are Open and Download. Computer shows the drive under Network Location
 * (explorerComputerView.js networkDrives): imageres.dll 27, or 25 while Sequenzia cannot be reached.
 */
(function (root) {
    'use strict';

    const ROOT = '/~sequenzia';
    const KEY = 'net:sequenzia';
    const ACTION = 'explorer-seq-';
    const STATUS_TTL_MS = 60 * 1000;
    const doc = root.document;

    const VFS = () => (typeof vfsClient !== 'undefined' ? vfsClient : root.vfsClient);

    let status = null;
    let statusAt = 0;
    let pending = null;

    function isPath(path) {
        const p = String(path || '');
        return p === ROOT || p.startsWith(`${ROOT}/`);
    }

    function isEntry(item) {
        return !!item && item.targetKind === 'sequenzia-entry';
    }

    function isItem(item) {
        return !!item && (item.targetKind === 'sequenzia-entry' || item.targetKind === 'sequenzia-folder');
    }

    /** The drive's state from the server: { configured, online, name, user, error }. Cached a minute. */
    function refreshStatus(force) {
        if (!force && status && Date.now() - statusAt < STATUS_TTL_MS) return Promise.resolve(status);
        if (pending) return pending;
        const client = VFS();
        const uuid = client && client.ensureVfsPathUuid ? client.ensureVfsPathUuid() : null;
        if (!uuid || typeof root.fetch !== 'function') return Promise.resolve(status);
        pending = root.fetch(`/${uuid}/sequenzia/status`, { credentials: 'same-origin' })
            .then((r) => (r.ok ? r.json() : null))
            .then((data) => {
                status = data && data.success ? data.status : { configured: false, online: false };
                statusAt = Date.now();
                return status;
            })
            .catch(() => status)
            .finally(() => { pending = null; });
        return pending;
    }

    /** Computer's Network Location tiles: nothing unless this server has Sequenzia set up. */
    function computerDrives() {
        if (!status || !status.configured) return [];
        return [{
            key: KEY,
            // as Vista names a mapped drive: share (\\server) (Z:)
            name: 'Sequenzia (\\\\Kanmi) (Z:)',
            path: ROOT,
            online: !!status.online,
            icon: status.online ? 'drive-network' : 'drive-network-off',
            user: status.user || '',
            line: status.online ? '' : 'Disconnected Network Drive',
            error: status.error || ''
        }];
    }

    function clickDownload(url, name) {
        const a = doc.createElement('a');
        a.href = url;
        a.download = name || '';
        doc.body.appendChild(a);
        a.click();
        a.remove();
    }

    function selection(explorer, item) {
        const sel = (explorer && explorer.grid && explorer.grid.getSelectedItems()) || [];
        if (item && !sel.some((s) => s.id === item.id)) return [item];
        return sel.length ? sel : (item ? [item] : []);
    }

    async function openEntry(explorer, item) {
        if (!isEntry(item)) return;
        const mime = item.mimeType || '';
        if (mime.startsWith('image/') && typeof root.openImageInViewer === 'function') {
            root.openImageInViewer(item.viewUrl, item.name, {});
            return;
        }
        if (mime.startsWith('video/') || mime.startsWith('audio/') || mime.startsWith('text/') || mime === 'application/pdf' || mime === 'application/json') {
            root.open(item.viewUrl, '_blank', 'noopener');
            return;
        }
        clickDownload(item.downloadUrl, item.name);
    }

    function download(items) {
        (items || []).filter(isEntry).forEach((item, i) => {
            // a short gap between files: browsers drop downloads started in the same tick
            root.setTimeout(() => clickDownload(item.downloadUrl, item.name), i * 250);
        });
    }

    /** The whole context menu for items on the drive (read-only: no Cut, Delete or Rename). */
    function entryMenuSections(explorer, item) {
        const sel = selection(explorer, item);
        const items = [];
        if (sel.length === 1) items.push({ icon: item.kind === 'folder' ? 'fas fa-folder-open' : 'fas fa-external-link', text: 'Open', action: `${ACTION}open` });
        if (sel.some(isEntry)) items.push({ icon: 'fas fa-download', text: 'Download', action: `${ACTION}download` });
        return [{ type: 'list', items }];
    }

    function emptyMenuSections() {
        return [{ type: 'list', items: [{ text: 'Refresh', action: `${ACTION}refresh` }] }];
    }

    async function handleAction(action, item, explorer) {
        const sel = selection(explorer, item);
        switch (action) {
            case `${ACTION}open`:
                if (item && item.kind === 'folder' && item.navPath) await explorer.navigateTo(item.navPath);
                else if (item) await openEntry(explorer, item);
                break;
            case `${ACTION}download`:
                download(sel);
                break;
            case `${ACTION}refresh`:
                if (explorer && typeof explorer.softRefresh === 'function') await explorer.softRefresh();
                break;
            default:
                break;
        }
    }

    root.explorerSequenzia = {
        ROOT,
        KEY,
        isPath,
        isEntry,
        isItem,
        refreshStatus,
        computerDrives,
        openEntry,
        download,
        entryMenuSections,
        emptyMenuSections,
        handleAction
    };
})(typeof window !== 'undefined' ? window : globalThis);
