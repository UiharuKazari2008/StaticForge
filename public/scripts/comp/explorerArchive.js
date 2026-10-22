/**
 * 7-Zip in Explorer (Yukimi 2026-10-22, Yozora #626): archives open as folders, and the 7-Zip
 * context menu, its dialogs and its progress window work on VFS files. The server side is
 * modules/vfsArchive.js (the host's 7z) behind the vfs_archive_* packets
 * (modules/ws/handlers/12-vfsArchiveHandler.js).
 *
 * Taken from 7-Zip 25.01 installed on the Vista VM (7zG.exe dialog templates, MS Shell Dlg 8 =
 * Tahoma 11 px, placed by dialog units like Taskbar Properties; captures in ~/.cache/vista-vm/7zip):
 *
 *   context menu   7-Zip ▸ Open archive, Extract files..., Extract Here, Extract to "name\",
 *                  Test archive, Add to archive..., Add to "name.7z", Add to "name.zip",
 *                  CRC SHA ▸ (7-zip.dll's menu, as the VM shows it for a file and a folder;
 *                  a name already taken becomes name_2.7z as 7-Zip picks it). The email
 *                  entries are left out (no mail client hand-off here).
 *   Extract        dialog 3400 (352 x 184): Extract to [path ▾] [...], [x] name\, Path mode,
 *                  Eliminate duplication of root folder, Overwrite mode, Password, Restore file
 *                  security (no ACLs in the VFS: greyed)
 *   Add to Archive dialog 4000 (416 x 336): Archive, format, level, method, dictionary, word,
 *                  solid block, threads, memory usage, volumes, parameters, update mode, path
 *                  mode, options, encryption. The "*" entries are 7-Zip's automatic values for the
 *                  level (read off the VM per level: 1 = 256 KB / 32 / 64 MB ... 9 = 256 MB / 64 /
 *                  16 GB); threads and memory are the server's, where 7-Zip runs.
 *   progress       dialog 97 (376 x 204): "12% Extracting \path\a.7z", elapsed / remaining,
 *                  files, sizes, speed, ratio, the current file, Background / Pause / Cancel
 *                  ("Are you sure you want to cancel?" Yes / No / Cancel); title gains "Paused"
 *                  and "Background" as on the VM. Errors and results (Test archive, CRC SHA) stay
 *                  in its list with Close.
 *   Enter password dialog 3800, Confirm File Replace dialog 3500 (Yes / Yes to All / Auto Rename
 *                  / No / No to All / Cancel).
 *
 * Inside an archive (path segment ~archive.<fileId>, vfsArchive.js) the items are read-only:
 * Open (pictures in the viewer, other files download), Extract files..., Download (one file as
 * itself, several packed into a .zip), Copy (a paste into a folder extracts there), and the
 * command bar's Extract all files as Vista's compressed folder has it.
 *
 * Icons: 7z.dll's archive icons and zipfldr.dll's compressed folder for .zip, ripped from the VM
 * (public/static_images/vista-7zip/, css/vista-7zip.css).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const ART = '/static_images/vista-7zip';
    const ICON16 = `${ART}/7zip-16.png`;
    const ICON32 = `${ART}/7zip-32.png`;
    const SEGMENT = '~archive.';
    const HISTORY_KEY = 'explorer7zipExtractHistory';

    // MS Shell Dlg 8 = Tahoma 8 pt: x * 6/4, y * 13/8 (taskbarProperties.js)
    const UX = 1.5;
    const UY = 1.625;

    const ARCHIVE_EXTS = new Set(['7z', 'zip', 'rar', 'tar', 'gz', 'tgz', 'gzip', 'bz2', 'bzip2', 'tbz', 'tbz2', 'xz', 'txz',
        'lzma', 'tlz', 'zst', 'tzst', 'z', 'taz', 'cab', 'iso', 'wim', 'swm', 'esd', 'arj', 'lzh', 'lha', 'cpio', 'rpm', 'deb',
        'dmg', 'xar', 'pkg', 'vhd', 'vhdx', 'squashfs', '001']);

    const PATH_MODES = [['full', 'Full pathnames'], ['none', 'No pathnames'], ['absolute', 'Absolute pathnames']];
    const OVERWRITE_MODES = [
        ['ask', 'Ask before overwrite'],
        ['overwrite', 'Overwrite without prompt'],
        ['skip', 'Skip existing files'],
        ['rename', 'Auto rename'],
        ['renameExisting', 'Auto rename existing files']
    ];
    const LEVELS = [[0, '0 - Store'], [1, '1 - Fastest'], [2, '2'], [3, '3 - Fast'], [4, '4'], [5, '5 - Normal'], [6, '6'], [7, '7 - Maximum'], [8, '8'], [9, '9 - Ultra']];
    const UPDATE_MODES = [['add', 'Add and replace files'], ['update', 'Update and add files'], ['fresh', 'Freshen existing files'], ['sync', 'Synchronize files']];
    const ADD_PATH_MODES = [['relative', 'Relative pathnames'], ['full', 'Full pathnames'], ['absolute', 'Absolute pathnames']];
    const METHODS = { '7z': ['LZMA2', 'LZMA', 'PPMd', 'BZip2'], zip: ['Deflate', 'Deflate64', 'BZip2', 'LZMA', 'PPMd'], xz: ['LZMA2'], bzip2: ['BZip2'], gzip: ['Deflate'] };
    const EXT_FOR_FORMAT = { '7z': '7z', zip: 'zip', tar: 'tar', wim: 'wim', gzip: 'gz', bzip2: 'bz2', xz: 'xz' };
    // 7-Zip's automatic LZMA2 values per level (7z), as the Add to Archive dialog shows them on the VM
    const AUTO_7Z = {
        1: { dict: 256 * 1024, word: 32, solid: '64m', mem: 13, dec: 3 },
        2: { dict: 1024 * 1024, word: 32, solid: '256m', mem: 40, dec: 3 },
        3: { dict: 4 * 1024 * 1024, word: 32, solid: '1g', mem: 132, dec: 6 },
        4: { dict: 16 * 1024 * 1024, word: 32, solid: '4g', mem: 206, dec: 18 },
        5: { dict: 32 * 1024 * 1024, word: 32, solid: '8g', mem: 378, dec: 34 },
        6: { dict: 64 * 1024 * 1024, word: 32, solid: '8g', mem: 700, dec: 66 },
        7: { dict: 128 * 1024 * 1024, word: 64, solid: '16g', mem: 1354, dec: 130 },
        8: { dict: 192 * 1024 * 1024, word: 64, solid: '16g', mem: 2040, dec: 194 },
        9: { dict: 256 * 1024 * 1024, word: 64, solid: '16g', mem: 2727, dec: 258 }
    };
    const MB = 1024 * 1024;
    const LZMA_DICTS = [64 * 1024, 256 * 1024, 1 * MB, 2 * MB, 3 * MB, 4 * MB, 6 * MB, 8 * MB, 12 * MB, 16 * MB, 24 * MB, 32 * MB, 48 * MB, 64 * MB, 96 * MB, 128 * MB, 192 * MB, 256 * MB, 384 * MB, 512 * MB, 768 * MB, 1024 * MB, 1536 * MB];
    const PPMD_DICTS = [1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 384, 512, 768, 1024].map((n) => n * MB);
    const BZIP2_DICTS = [100, 200, 300, 400, 500, 600, 700, 800, 900].map((n) => n * 1000);
    const LZMA_WORDS = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 273];
    const PPMD_WORDS = [2, 3, 4, 5, 6, 7, 8, 10, 12, 14, 16, 20, 24, 28, 32];
    const DEFLATE_WORDS = [8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256, 258];
    const SOLID = [['off', 'Non-solid'], ['1m', '1 MB'], ['2m', '2 MB'], ['4m', '4 MB'], ['8m', '8 MB'], ['16m', '16 MB'], ['32m', '32 MB'], ['64m', '64 MB'], ['128m', '128 MB'], ['256m', '256 MB'], ['512m', '512 MB'], ['1g', '1 GB'], ['2g', '2 GB'], ['4g', '4 GB'], ['8g', '8 GB'], ['16g', '16 GB'], ['32g', '32 GB'], ['64g', '64 GB'], ['on', 'Solid']];
    const VOLUMES = ['10M', '100M', '1000M', '650M - CD', '700M - CD', '4092M - FAT', '4480M - DVD', '8128M - DVD DL', '23040M - BD'];
    const HASHES = ['CRC-32', 'CRC-64', 'XXH64', 'SHA-1', 'SHA-256', 'BLAKE2sp', '*'];

    let caps = null;
    const runningOps = new Map();
    let progressListener = null;

    // ---- small helpers ------------------------------------------------------------------------

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function ws() {
        return root.wsClient || (typeof wsClient !== 'undefined' ? wsClient : null);
    }

    function send(type, data) {
        const client = ws();
        if (!client) return Promise.reject(new Error('Not connected'));
        return client.sendMessage(type, data);
    }

    function extOf(name) {
        const m = /\.([^./\\]+)$/.exec(String(name || '').toLowerCase());
        return m ? m[1] : '';
    }

    function isArchiveName(name) {
        return ARCHIVE_EXTS.has(extOf(name));
    }

    /** "sample" for sample.7z / sample.tar.gz, as 7-Zip names the folder and the new archive. */
    function stemOf(name) {
        const n = String(name || '');
        const m = /^(.*?)(\.tar)?\.[^.]+$/i.exec(n);
        return (m && m[1]) || n;
    }

    function isArchivePath(p) {
        return typeof p === 'string' && p.includes(`/${SEGMENT}`);
    }

    function splitArchivePath(p) {
        if (!isArchivePath(p)) return null;
        const parts = p.split('/').filter(Boolean);
        const at = parts.findIndex((s) => s.startsWith(SEGMENT));
        let inner;
        try { inner = parts.slice(at + 1).map(decodeURIComponent); } catch (_) { inner = parts.slice(at + 1); }
        return {
            parentPath: at === 0 ? '/' : `/${parts.slice(0, at).join('/')}`,
            archiveRoot: `/${parts.slice(0, at + 1).join('/')}`,
            fileId: parts[at].slice(SEGMENT.length),
            inner,
            base: inner.join('/')
        };
    }

    function archivePathFor(fileId, parentPath) {
        const base = String(parentPath || '/').replace(/\/+$/, '');
        return `${base}/${SEGMENT}${fileId}`;
    }

    function isEntry(item) {
        return !!item && item.targetKind === 'archive-entry';
    }

    /** An entry ref from the grid / clipboard: arc:<fileId>:<path> */
    function refEntry(ref) {
        const m = /^arc:([^:]+):(.*)$/.exec(String(ref && ref.id || ''));
        return m ? { fileId: m[1], path: m[2], name: ref.name } : null;
    }

    function isArchiveFileItem(item) {
        return !!item && item.targetKind === 'user-file' && !item.isUserFileLink && (item.archiveFormat || isArchiveName(item.name));
    }

    function isPackable(item) {
        return !!item && !item.isShortcut && !item.isUserFileLink
            && (item.targetKind === 'user-file' || item.targetKind === 'vfs-folder');
    }

    /** 7-Zip's size text in the progress window: B under 100000, then KB, MB... ("49999 KB", "826 MB"). */
    function progressSize(bytes) {
        let v = Math.max(0, Math.floor(Number(bytes) || 0));
        const units = ['B', 'KB', 'MB', 'GB', 'TB'];
        let i = 0;
        while (v >= 100000 && i < units.length - 1) { v = Math.floor(v / 1024); i += 1; }
        return `${v} ${units[i]}`;
    }

    function clock(ms) {
        const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
    }

    function sizeLabel(bytes) {
        const n = Number(bytes) || 0;
        if (n >= 1024 * MB && n % (1024 * MB) === 0) return `${n / (1024 * MB)} GB`;
        if (n >= MB) return `${Math.round(n / MB)} MB`;
        if (n >= 1024) return `${Math.round(n / 1024)} KB`;
        if (n >= 1000 && n % 1000 === 0) return `${n / 1000} KB`;
        return `${n} B`;
    }

    function backslashPath(display) {
        const p = String(display || '/').replace(/\//g, '\\');
        return p.endsWith('\\') ? p : `${p}\\`;
    }

    async function displayPathOf(vfsPath) {
        try {
            const stats = await (root.vfsClient ? root.vfsClient.getPathStats(vfsPath) : send('vfs_get_path_stats', { path: vfsPath }));
            const s = (stats && stats.stats) || stats;
            if (s && s.displayPath) return s.displayPath;
        } catch (_) { /* fall back */ }
        return vfsPath;
    }

    async function ensureStyles() {
        if (root.featureLoader && typeof root.featureLoader.loadFeature === 'function') {
            try { await root.featureLoader.loadFeature('seven_zip_dialogs'); } catch (_) { /* styles optional */ }
        }
    }

    function message(text, { title = '7-Zip', icon = 'fas fa-exclamation-triangle', owner = null } = {}) {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        const r = owner && owner.getBoundingClientRect ? owner.getBoundingClientRect() : null;
        const at = r ? { target: owner, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 } : null;
        return root.showConfirmationDialog(text, [{ text: 'OK', value: true, className: 'btn-standard primary' }], at, { title, icon, showCloseButton: true });
    }

    // ---- dialog building (taskbarProperties.js / personalizationDialogs.js) --------------------

    function dlu(x, y, w, h, inset = 0) {
        const left = Math.round(x * UX);
        const top = Math.round(y * UY);
        let s = `left:${left + inset}px;top:${top + inset}px;`;
        if (w !== undefined) s += `width:${Math.round((x + w) * UX) - left - 2 * inset}px;`;
        if (h !== undefined) s += `height:${Math.floor((y + h) * UY) - top - 2 * inset}px;`;
        return s;
    }

    function clientSize(w, h) {
        return `width:${Math.round(w * UX)}px;height:${Math.round(h * UY)}px;`;
    }

    function stat(x, y, w, h, body, cls = '') {
        return `<div class="tbp-ctl tbp-static ${cls}" style="${dlu(x, y, w, h)}">${body}</div>`;
    }

    function btn(x, y, w, h, label, action, { primary = false, disabled = false } = {}) {
        return `<button type="button" class="tbp-ctl tbp-button" style="${dlu(x, y, w, h, 1)}" data-action="${action}"${primary ? ' data-dialog-primary="1"' : ''}${disabled ? ' disabled' : ''}>${label}</button>`;
    }

    function chk(id, x, y, w, h, label, { checked = false, disabled = false } = {}) {
        const top = Math.round(y * UY);
        const height = Math.floor((y + h) * UY) - top;
        return `<div class="tbp-ctl tbp-check" style="${dlu(x, y, w, h)}padding-top:${Math.max(0, Math.floor((height - 13) / 2))}px;"><input type="checkbox" id="${id}"${checked ? ' checked' : ''}${disabled ? ' disabled' : ''}><label for="${id}"${disabled ? ' class="is-disabled"' : ''}><span>${label}</span></label></div>`;
    }

    function grp(x, y, w, h, label) {
        const left = Math.round(x * UX);
        const top = Math.round(y * UY);
        return `<div class="tbp-group" style="left:${left}px;top:${top}px;width:${Math.round((x + w) * UX) - left}px;height:${Math.round(h * UY) - 1}px;"><span class="tbp-group-label">${label}</span></div>`;
    }

    function options(list, value) {
        return list.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`).join('');
    }

    function sel(cls, x, y, w, list, value, label) {
        return `<select class="tbp-ctl tbp-select ${cls}" style="${dlu(x, y, w)}" aria-label="${esc(label)}">${options(list, value)}</select>`;
    }

    function edit(cls, x, y, w, h, { password = false, value = '', label = '' } = {}) {
        return `<input type="${password ? 'password' : 'text'}" class="tbp-ctl tbp-edit ${cls}" style="${dlu(x, y, w, h)}" value="${esc(value)}" aria-label="${esc(label)}" spellcheck="false" autocomplete="off">`;
    }

    /** CBS_DROPDOWN: an edit over a drop-down list's box; picking from the list fills the edit. */
    function ecombo(cls, x, y, w, list, value, label) {
        return `<div class="tbp-ctl sz-ecombo ${cls}" style="${dlu(x, y, w)}">
            <select class="tbp-select sz-ecombo-list" tabindex="-1" aria-hidden="true"><option value=""></option>${list.map((v) => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}</select>
            <input type="text" class="tbp-edit sz-ecombo-edit" value="${esc(value)}" aria-label="${esc(label)}" spellcheck="false" autocomplete="off">
        </div>`;
    }

    function wireEcombo(node) {
        const list = node.querySelector('.sz-ecombo-list');
        const editEl = node.querySelector('.sz-ecombo-edit');
        list.addEventListener('change', () => {
            if (list.value) {
                editEl.value = list.value;
                editEl.dispatchEvent(new Event('input', { bubbles: true }));
            }
            list.value = '';
            editEl.focus();
        });
        return editEl;
    }

    function makeWindow(id, title, { width, height, icon = null, taskbarIcon = ICON32, owner = null, resizable = false } = {}) {
        const old = doc.getElementById(id);
        if (old) old.remove();
        const modal = doc.createElement('div');
        modal.className = 'modal hidden tbp-window sz-window';
        modal.id = id;
        modal.dataset.windowIdentifier = id;
        modal.dataset.windowRestorePosition = 'false';
        modal.dataset.windowRestoreSize = 'false';
        modal.dataset.windowFixedSize = resizable ? 'false' : 'true';
        modal.dataset.vistaDialog = 'form';
        modal.dataset.windowClient = 'light';
        if (taskbarIcon) modal.dataset.taskbarIcon = taskbarIcon;
        if (!icon) modal.dataset.captionIcon = 'none';
        if (owner && owner.id && !icon) modal.dataset.iconOwnerId = owner.id;
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-label', title);
        modal.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main">${icon ? `<img class="icon-image" src="${icon}" width="16" height="16" alt="">` : ''}<span class="sz-title"></span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls"><button type="button" class="btn-danger close-btn btn-small" title="Close"><i class="fa-regular fa-xmark-large" aria-hidden="true"></i></button></div>
            <div class="modal-content win7 tbp-client sz-client" style="width:${width}px;height:${height}px;"></div>`;
        modal.querySelector('.sz-title').textContent = title;
        doc.body.appendChild(modal);
        return {
            modal,
            content: modal.querySelector('.sz-client'),
            close: modal.querySelector('.close-btn'),
            setTitle(t) {
                modal.querySelector('.sz-title').textContent = t;
                modal.setAttribute('aria-label', t);
            }
        };
    }

    function showWindow(modal, owner) {
        callGlobal('openModal', modal);
        modal.classList.remove('hidden');
        if (typeof root.bringModalToFront === 'function') root.bringModalToFront(modal);
        root.requestAnimationFrame(() => {
            const r = modal.getBoundingClientRect();
            let cx = root.innerWidth / 2;
            let cy = (root.innerHeight - 35) / 2;
            if (owner && owner.isConnected && !owner.classList.contains('hidden')) {
                const o = owner.getBoundingClientRect();
                cx = o.left + o.width / 2;
                cy = o.top + o.height / 2;
            }
            callGlobal('setModalOffsetsFromViewportTopLeft', modal,
                Math.max(0, Math.round(cx - r.width / 2)), Math.max(0, Math.round(cy - r.height / 2)));
            const first = modal.querySelector('[data-autofocus]') || modal.querySelector('input:not([disabled]):not([tabindex="-1"]), select:not([disabled]):not([tabindex="-1"])');
            if (first) first.focus();
        });
    }

    function closeWindow(modal) {
        if (!modal) return;
        try { callGlobal('closeModal', modal); } catch (_) { /* window manager gone */ }
        setTimeout(() => { if (modal.parentNode) modal.parentNode.removeChild(modal); }, 400);
    }

    /** OK / Cancel / Escape / Enter for a form dialog; resolves what onOk returns, or null. */
    function runDialog(win, owner, { onOk, onAction }) {
        return new Promise((resolve) => {
            let done = false;
            const finish = (value) => {
                if (done) return;
                done = true;
                closeWindow(win.modal);
                resolve(value);
            };
            const ok = async () => {
                const value = await onOk();
                if (value !== undefined && value !== false) finish(value);
            };
            win.close.addEventListener('click', () => finish(null));
            win.content.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-action]');
                if (!b || b.disabled) return;
                const a = b.dataset.action;
                if (a === 'ok') void ok();
                else if (a === 'cancel') finish(null);
                else if (onAction) onAction(a, b, finish);
            });
            win.modal.addEventListener('keydown', (ev) => {
                if (ev.key === 'Escape') {
                    ev.preventDefault();
                    ev.stopPropagation();
                    finish(null);
                } else if (ev.key === 'Enter' && !ev.target.matches('button, select, textarea')) {
                    ev.preventDefault();
                    void ok();
                }
            });
            showWindow(win.modal, owner);
        });
    }

    // ---- Enter password (dialog 3800) ----------------------------------------------------------

    async function askPassword(owner, { wrong = false, name = '' } = {}) {
        await ensureStyles();
        if (wrong) await message(`Wrong password${name ? ` : ${name}` : ''}`, { title: '7-Zip', icon: 'fas fa-times-circle', owner });
        const win = makeWindow('sevenZipPasswordDialog', 'Enter password', { ...sizeOf(216, 88), owner });
        win.content.innerHTML = `
            ${stat(8, 8, 200, 8, '<u>E</u>nter password:')}
            ${edit('sz-pw', 8, 20, 200, 14, { password: true, label: 'Enter password' })}
            ${chk('szPwShow', 8, 42, 200, 10, '<u>S</u>how password')}
            ${btn(72, 64, 64, 16, 'OK', 'ok', { primary: true })}
            ${btn(144, 64, 64, 16, 'Cancel', 'cancel')}`;
        const pw = win.content.querySelector('.sz-pw');
        pw.dataset.autofocus = '1';
        win.content.querySelector('#szPwShow').addEventListener('change', (ev) => { pw.type = ev.target.checked ? 'text' : 'password'; });
        return runDialog(win, owner, { onOk: () => pw.value });
    }

    function sizeOf(w, h) {
        return { width: Math.round(w * UX), height: Math.round(h * UY) };
    }

    // ---- Confirm File Replace (dialog 3500) ----------------------------------------------------

    function fileIcon32(name) {
        const ext = extOf(name);
        if (/^(png|jpe?g|gif|webp|bmp|avif|tiff?)$/.test(ext)) return '/static_images/vista-icons/explorer/image-32.png';
        if (/^(txt|md|log|ini|csv|json|xml)$/.test(ext)) return '/static_images/vista-icons/explorer/text-32.png';
        return '/static_images/vista-icons/explorer/file-32.png';
    }

    function fileFacts(name, info) {
        const when = info && info.modifiedAt ? new Date(info.modifiedAt * 1000) : null;
        const date = when ? `${when.toLocaleDateString('en-US')} ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : '';
        return `${esc(name)}<br>${Number(info && info.size || 0).toLocaleString('en-US')} bytes${date ? `<br>modified on ${esc(date)}` : ''}`;
    }

    async function askReplace(owner, q) {
        await ensureStyles();
        const win = makeWindow('sevenZipReplaceDialog', 'Confirm File Replace', { ...sizeOf(356, 216), owner });
        win.content.innerHTML = `
            ${stat(8, 7, 340, 8, 'Destination folder already contains processed file.')}
            ${stat(8, 28, 340, 8, 'Would you like to replace the existing file')}
            <img class="tbp-ctl" src="${fileIcon32(q.name)}" style="${dlu(8, 44, 24, 24)}width:32px;height:32px;" alt="">
            ${stat(40, 44, 308, 50, fileFacts(q.name, q.existing))}
            ${stat(8, 98, 340, 8, 'with this one?')}
            <img class="tbp-ctl" src="${fileIcon32(q.name)}" style="${dlu(8, 114, 24, 24)}width:32px;height:32px;" alt="">
            ${stat(40, 114, 308, 50, fileFacts(q.name, q.incoming))}
            ${btn(100, 168, 64, 16, '<u>Y</u>es', 'yes', { primary: true })}
            ${btn(172, 168, 64, 16, 'Yes to <u>A</u>ll', 'yesAll')}
            ${btn(244, 168, 104, 16, 'A<u>u</u>to Rename', 'rename')}
            ${btn(100, 192, 64, 16, '<u>N</u>o', 'no')}
            ${btn(172, 192, 64, 16, 'No to A<u>l</u>l', 'noAll')}
            ${btn(284, 192, 64, 16, '<u>C</u>ancel', 'cancel')}`;
        const answer = await runDialog(win, owner, {
            onOk: () => 'yes',
            onAction: (a, b, finish) => finish(a)
        });
        return answer || 'cancel';
    }

    // ---- Browse For Folder (SHBrowseForFolder, as 7-Zip's "..." opens it) ----------------------

    function folderNavPath(item, parent) {
        if (item.navPath) return item.navPath;
        if (item.targetKind === 'workspace') return `/Workspaces/${item.targetId}`;
        const id = item.targetId || item.id;
        const base = String(parent || '/').replace(/\/+$/, '');
        return `${base}/${id}`;
    }

    function browseFolder(owner, text) {
        return new Promise((resolve) => {
            const win = makeWindow('sevenZipBrowseDialog', 'Browse For Folder', { width: 318, height: 350, owner });
            win.content.innerHTML = `
                <div class="sz-bf-text">${esc(text)}</div>
                <div class="sz-bf-tree" tabindex="0" aria-label="Folders"></div>
                <div class="sz-bf-buttons">
                    <button type="button" class="tbp-button" data-action="bf-ok" data-dialog-primary="1" disabled>OK</button>
                    <button type="button" class="tbp-button" data-action="bf-cancel">Cancel</button>
                </div>`;
            const tree = win.content.querySelector('.sz-bf-tree');
            let picked = null;
            const finish = (value) => { closeWindow(win.modal); resolve(value); };
            const node = (p, name, depth) => `<div class="sz-bf-node" data-path="${esc(p)}"><div class="sz-bf-row" style="padding-left:${2 + depth * 16}px"><span class="sz-bf-twisty"></span><span class="sz-bf-icon"></span><span class="sz-bf-name">${esc(name)}</span></div><div class="sz-bf-kids" hidden></div></div>`;
            const expand = async (n) => {
                const kids = n.querySelector(':scope > .sz-bf-kids');
                if (n.classList.toggle('is-open') === false) { kids.hidden = true; return; }
                kids.hidden = false;
                if (kids.dataset.loaded) return;
                kids.dataset.loaded = '1';
                let res = null;
                try { res = await root.vfsClient.listDirectory(n.dataset.path, { offset: 0, limit: 500 }); } catch (_) { res = null; }
                const depth = n.dataset.path === '/' ? 1 : n.dataset.path.split('/').filter(Boolean).length + 1;
                const folders = ((res && res.items) || []).filter((i) => (i.kind === 'folder' || i.targetKind === 'vfs-folder' || i.targetKind === 'workspace' || i.targetKind === 'system-folder') && i.targetKind !== 'archive-entry');
                kids.innerHTML = folders.map((f) => node(folderNavPath(f, n.dataset.path), f.name, depth)).join('');
                if (!folders.length) n.classList.add('is-leaf');
            };
            tree.innerHTML = node('/', 'Computer', 0);
            tree.addEventListener('click', (ev) => {
                const row = ev.target.closest('.sz-bf-row');
                if (!row) return;
                const n = row.parentElement;
                tree.querySelectorAll('.sz-bf-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
                row.classList.add('is-selected');
                picked = n.dataset.path;
                win.content.querySelector('[data-action="bf-ok"]').disabled = false;
                if (ev.target.closest('.sz-bf-twisty') || ev.detail === 2) void expand(n);
            });
            win.content.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-action]');
                if (!b || b.disabled) return;
                finish(b.dataset.action === 'bf-ok' ? picked : null);
            });
            win.close.addEventListener('click', () => finish(null));
            win.modal.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); finish(null); } });
            showWindow(win.modal, owner);
            void expand(tree.querySelector('.sz-bf-node'));
        });
    }

    // ---- the progress window (dialog 97) -------------------------------------------------------

    function ensureProgressListener() {
        const client = ws();
        if (progressListener || !client || typeof client.on !== 'function') return;
        progressListener = (msg) => {
            const data = msg && msg.data;
            const op = data && runningOps.get(data.opId);
            if (op) op.update(data);
            else if (data && data.opId) pendingEvents.set(data.opId, data);
        };
        client.on('vfs_archive_progress', progressListener);
    }
    // events that arrive before the start request answers
    const pendingEvents = new Map();

    const VERBS = { extract: 'Extracting', create: 'Compressing', test: 'Testing', hash: 'Checksum calculation', pack: 'Extracting' };

    /**
     * Run one server operation under 7-Zip's progress window. Resolves { state, result, messages }.
     */
    async function runOperation(type, params, { kind, label, owner }) {
        await ensureStyles();
        ensureProgressListener();
        const verb = VERBS[kind] || 'Working';
        const win = makeWindow(`sevenZipProgress${Date.now()}`, `0% ${verb} ${label}`, { ...sizeOf(376, 204), icon: ICON16, taskbarIcon: ICON32, resizable: false });
        win.modal.classList.add('sz-progress-window');
        const c = win.content;
        c.innerHTML = `
            ${stat(8, 8, 90, 8, 'Elapsed time:')}
            ${stat(8, 19, 90, 8, 'Remaining time:')}
            ${stat(8, 30, 90, 8, 'Files:')}
            ${stat(8, 52, 90, 8, 'Errors:', 'sz-errors-label')}
            ${stat(206, 8, 90, 8, 'Total size:')}
            ${stat(206, 19, 90, 8, 'Speed:')}
            ${stat(206, 30, 90, 8, 'Processed:')}
            ${stat(206, 41, 90, 8, 'Compressed size:', 'sz-packed-label')}
            ${stat(206, 52, 90, 8, 'Compression ratio:', 'sz-ratio-label')}
            ${stat(98, 8, 72, 8, '', 'sz-v sz-elapsed')}
            ${stat(98, 19, 72, 8, '', 'sz-v sz-remaining')}
            ${stat(98, 30, 72, 8, '', 'sz-v sz-files')}
            ${stat(98, 41, 72, 8, '', 'sz-v sz-files-total')}
            ${stat(98, 52, 72, 8, '', 'sz-v sz-errors')}
            ${stat(296, 8, 72, 8, '', 'sz-v sz-total')}
            ${stat(296, 19, 72, 8, '', 'sz-v sz-speed')}
            ${stat(296, 30, 72, 8, '', 'sz-v sz-processed')}
            ${stat(296, 41, 72, 8, '', 'sz-v sz-packed')}
            ${stat(296, 52, 72, 8, '', 'sz-v sz-ratio')}
            ${stat(8, 64, 360, 8, '', 'sz-status')}
            ${stat(8, 76, 360, 24, '', 'sz-current')}
            <div class="tbp-ctl sz-progress" style="${dlu(8, 100, 360, 16)}" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div class="sz-progress-fill"></div></div>
            <div class="tbp-ctl sz-list" style="${dlu(8, 124, 360, 48)}" hidden></div>
            ${btn(112, 180, 80, 16, '<u>B</u>ackground', 'background', { primary: true })}
            ${btn(200, 180, 80, 16, '<u>P</u>ause', 'pause')}
            ${btn(288, 180, 80, 16, 'Cancel', 'cancel')}`;
        const $ = (s) => c.querySelector(s);
        $('.sz-errors-label').hidden = true;
        if (kind !== 'create') { $('.sz-packed-label').hidden = kind === 'hash'; $('.sz-ratio-label').hidden = kind === 'hash'; }
        const state = { paused: false, background: false, finished: false, last: null, opId: null, askOpen: false, cancelAsked: false };
        let resolveDone;
        const done = new Promise((r) => { resolveDone = r; });
        const control = (action, answer) => state.opId && send('vfs_archive_control', { opId: state.opId, action, answer }).catch(() => {});

        const render = (d) => {
            state.last = d;
            const total = Number(d.total) || 0;
            const processed = Number(d.processed) || 0;
            const pct = total > 0 ? Math.min(100, Math.floor((processed * 100) / total)) : (d.state === 'done' ? 100 : 0);
            const elapsed = Number(d.elapsedMs) || 0;
            const parts = [];
            if (d.paused) parts.push('Paused');
            parts.push(`${pct}%`);
            if (d.background) parts.push('Background');
            parts.push(verb, label);
            win.setTitle(d.state && d.state !== 'running' ? `${verb} ${label}` : parts.join(' '));
            $('.sz-elapsed').textContent = clock(elapsed);
            $('.sz-remaining').textContent = processed > 0 && total > processed ? clock((elapsed * (total - processed)) / processed) : (total && processed >= total ? clock(0) : '');
            $('.sz-files').textContent = String(d.files || 0);
            $('.sz-files-total').textContent = d.filesTotal ? `/ ${d.filesTotal}` : '';
            $('.sz-total').textContent = total ? progressSize(total) : '';
            $('.sz-speed').textContent = elapsed > 500 && processed ? `${progressSize((processed * 1000) / elapsed)}/s` : '';
            $('.sz-processed').textContent = progressSize(processed);
            if (kind === 'create') {
                $('.sz-packed').textContent = d.packed ? progressSize(d.packed) : '';
                $('.sz-ratio').textContent = d.packed && processed ? `${Math.round((d.packed * 100) / processed)}%` : '';
            } else if (kind !== 'hash') {
                $('.sz-packed').textContent = d.packedTotal ? progressSize(d.packedTotal) : '';
            }
            const errors = Number(d.errors) || 0;
            $('.sz-errors-label').hidden = !errors;
            $('.sz-errors').textContent = errors ? String(errors) : '';
            $('.sz-status').textContent = d.status || '';
            $('.sz-current').textContent = d.current || '';
            const fill = $('.sz-progress-fill');
            fill.style.width = `${pct}%`;
            $('.sz-progress').setAttribute('aria-valuenow', String(pct));
            const list = $('.sz-list');
            const msgs = Array.isArray(d.messages) ? d.messages : [];
            list.hidden = !msgs.length;
            if (msgs.length && list.childElementCount !== msgs.length) {
                list.innerHTML = msgs.map((m) => `<div class="sz-list-row">${esc(m) || '&nbsp;'}</div>`).join('');
            }
            $('[data-action="pause"]').innerHTML = d.paused ? '<u>C</u>ontinue' : '<u>P</u>ause';
            $('[data-action="background"]').innerHTML = d.background ? '<u>F</u>oreground' : '<u>B</u>ackground';
        };

        const finishUi = (d) => {
            state.finished = true;
            const keep = (d.messages && d.messages.length) || d.state === 'error';
            if (!keep) {
                closeWindow(win.modal);
            } else {
                $('[data-action="background"]').hidden = true;
                $('[data-action="pause"]').hidden = true;
                const cancel = $('[data-action="cancel"]');
                cancel.textContent = 'Close';
                cancel.dataset.action = 'close';
                cancel.focus();
                if (root.desktopSounds && d.state === 'error') root.desktopSounds.play('error');
            }
            runningOps.delete(state.opId);
            resolveDone({ state: d.state, result: d.result || null, messages: d.messages || [], code: d.code || null });
        };

        const op = {
            async update(d) {
                if (state.finished) return;
                render(d);
                if (d.ask && !state.askOpen) {
                    state.askOpen = true;
                    const answer = await askReplace(win.modal, d.ask);
                    state.askOpen = false;
                    control('answer', answer);
                }
                if (d.state && d.state !== 'running') finishUi(d);
            }
        };

        const askCancel = async () => {
            if (state.cancelAsked) return;
            state.cancelAsked = true;
            const r = win.modal.getBoundingClientRect();
            const answer = typeof root.showConfirmationDialog === 'function'
                ? await root.showConfirmationDialog('Are you sure you want to cancel?', [
                    { text: 'Yes', value: 'yes', className: 'btn-standard primary' },
                    { text: 'No', value: 'no', className: 'btn-standard' },
                    { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
                ], { target: win.modal, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }, { title: verb, icon: 'fas fa-question-circle', showCloseButton: true })
                : 'yes';
            state.cancelAsked = false;
            if (answer === 'yes' && !state.finished) control('cancel');
        };

        c.addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-action]');
            if (!b || b.disabled) return;
            const a = b.dataset.action;
            if (a === 'close') { closeWindow(win.modal); return; }
            if (state.finished) return;
            if (a === 'cancel') void askCancel();
            else if (a === 'pause') control(state.last && state.last.paused ? 'resume' : 'pause');
            else if (a === 'background') control(state.last && state.last.background ? 'foreground' : 'background');
        });
        win.close.addEventListener('click', () => {
            if (state.finished) closeWindow(win.modal);
            else void askCancel();
        });
        win.modal.addEventListener('keydown', (ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                if (state.finished) closeWindow(win.modal);
                else void askCancel();
            }
        });
        render({ state: 'running', total: 0, processed: 0, files: 0, status: '', current: '', elapsedMs: 0, messages: [] });
        showWindow(win.modal, owner);

        let started;
        try {
            started = await send(type, params);
        } catch (err) {
            render({ state: 'error', messages: [err.message || String(err)], errors: 1, status: '', total: 0, processed: 0 });
            finishUi({ state: 'error', messages: [err.message || String(err)] });
            return done;
        }
        state.opId = started && started.opId;
        runningOps.set(state.opId, op);
        const early = pendingEvents.get(state.opId);
        if (early) { pendingEvents.delete(state.opId); void op.update(early); }
        return done;
    }

    // ---- Extract (dialog 3400) -----------------------------------------------------------------

    function readHistory() {
        try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]').filter((h) => h && h.path && h.label).slice(0, 10); } catch (_) { return []; }
    }

    function pushHistory(entry) {
        try {
            const list = [entry, ...readHistory().filter((h) => h.path !== entry.path)].slice(0, 10);
            localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
        } catch (_) { /* private mode */ }
    }

    /**
     * The Extract dialog. archive: { fileId, name, label (display path) }; defaults.targetPath (VFS),
     * entries / base for a selection. Resolves the vfs_archive_extract payload, or null.
     */
    async function extractDialog(owner, archive, defaults) {
        await ensureStyles();
        const target = defaults.targetPath;
        const targetLabel = backslashPath(await displayPathOf(target));
        const history = readHistory();
        const win = makeWindow('sevenZipExtractDialog', `Extract : ${archive.label}`, { ...sizeOf(352, 184), icon: ICON16, owner });
        const stem = stemOf(archive.name);
        win.content.innerHTML = `
            ${stat(8, 8, 336, 8, 'E<u>x</u>tract to:')}
            ${ecombo('sz-ex-to', 8, 20, 304, history.map((h) => h.label).filter((l) => l !== targetLabel), targetLabel, 'Extract to')}
            ${btn(324, 18, 20, 16, '...', 'browse')}
            <div class="tbp-ctl tbp-check sz-ex-subcheck" style="${dlu(8, 42, 12, 10)}"><input type="checkbox" id="szExSub"${defaults.subfolder !== false ? ' checked' : ''} aria-label="Extract into a subfolder"><label for="szExSub"><span></span></label></div>
            ${edit('sz-ex-sub', 22, 40, 146, 14, { value: `${stem}\\`, label: 'Subfolder' })}
            ${stat(8, 60, 160, 8, 'Path mode:')}
            ${sel('sz-ex-pathmode', 8, 72, 160, PATH_MODES, 'full', 'Path mode')}
            ${chk('szExElim', 8, 92, 160, 10, 'Eliminate duplication of root folder')}
            ${stat(8, 112, 160, 8, 'Overwrite mode:')}
            ${sel('sz-ex-overwrite', 8, 124, 160, OVERWRITE_MODES, defaults.overwrite || 'ask', 'Overwrite mode')}
            ${grp(188, 44, 156, 56, 'Password')}
            ${edit('sz-ex-pw', 196, 58, 140, 14, { password: true, label: 'Password' })}
            ${chk('szExShow', 196, 80, 140, 10, 'Show Password')}
            ${chk('szExSec', 188, 112, 156, 10, 'Restore file security', { disabled: true })}
            ${btn(136, 160, 64, 16, 'OK', 'ok', { primary: true })}
            ${btn(208, 160, 64, 16, 'Cancel', 'cancel')}
            ${btn(280, 160, 64, 16, 'Help', 'help')}`;
        const q = (s) => win.content.querySelector(s);
        const toEdit = wireEcombo(q('.sz-ex-to'));
        toEdit.dataset.autofocus = '1';
        let targetPath = target;
        let typed = false;
        toEdit.addEventListener('input', () => {
            typed = true;
            const hit = history.find((h) => h.label === toEdit.value);
            if (hit) { targetPath = hit.path; typed = false; }
        });
        const sub = q('.sz-ex-sub');
        const subCheck = q('#szExSub');
        const syncSub = () => { sub.disabled = !subCheck.checked; };
        subCheck.addEventListener('change', syncSub);
        syncSub();
        const pw = q('.sz-ex-pw');
        q('#szExShow').addEventListener('change', (ev) => { pw.type = ev.target.checked ? 'text' : 'password'; });
        if (archive.needsPassword === false) pw.placeholder = '';
        toEdit.select();
        return runDialog(win, owner, {
            onAction: async (a) => {
                if (a === 'browse') {
                    const picked = await browseFolder(win.modal, 'Specify a location for extracted files.');
                    if (picked) {
                        targetPath = picked;
                        typed = false;
                        toEdit.value = backslashPath(await displayPathOf(picked));
                    }
                } else if (a === 'help') {
                    callGlobal('openWebUrl', 'https://www.7-zip.org/faq.html');
                }
            },
            onOk: async () => {
                let path = targetPath;
                if (typed) {
                    const raw = toEdit.value.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
                    try {
                        path = await root.vfsClient.resolvePath(raw.startsWith('/') ? raw : `/${raw}`);
                    } catch (err) {
                        await message(err.message || 'The path does not exist.', { owner: win.modal, icon: 'fas fa-times-circle' });
                        return false;
                    }
                }
                pushHistory({ path, label: backslashPath(await displayPathOf(path)) });
                return {
                    fileId: archive.fileId,
                    entries: defaults.entries || null,
                    base: defaults.base || '',
                    targetPath: path,
                    subfolder: subCheck.checked ? sub.value.replace(/[\\/]+$/, '').trim() : '',
                    pathMode: q('.sz-ex-pathmode').value,
                    eliminateRoot: q('#szExElim').checked,
                    overwrite: q('.sz-ex-overwrite').value,
                    password: pw.value || undefined
                };
            }
        });
    }

    // ---- Add to Archive (dialog 4000) ----------------------------------------------------------

    async function loadCaps() {
        if (caps) return caps;
        try {
            caps = await send('vfs_archive_caps', {});
        } catch (_) {
            caps = { cpus: (root.navigator && root.navigator.hardwareConcurrency) || 2, totalMem: 4096 * MB };
        }
        return caps;
    }

    function formatsFor(single) {
        return single
            ? [['7z', '7z'], ['bzip2', 'bzip2'], ['gzip', 'gzip'], ['tar', 'tar'], ['wim', 'wim'], ['xz', 'xz'], ['zip', 'zip']]
            : [['7z', '7z'], ['tar', 'tar'], ['wim', 'wim'], ['zip', 'zip']];
    }

    async function addDialog(owner, { items, sourcePath, defaultName, single }) {
        await ensureStyles();
        const c0 = await loadCaps();
        const cpus = Math.max(1, Number(c0.cpus) || 1);
        const totalMb = Math.round((Number(c0.totalMem) || 0) / MB);
        const dirLabel = backslashPath(await displayPathOf(sourcePath));
        const win = makeWindow('sevenZipAddDialog', 'Add to Archive', { ...sizeOf(416, 336), owner });
        win.content.innerHTML = `
            ${stat(48, 8, 360, 8, esc(dirLabel), 'sz-add-dir')}
            ${stat(8, 12, 40, 8, '<u>A</u>rchive:')}
            ${ecombo('sz-add-name', 48, 18, 328, [], defaultName, 'Archive')}
            ${btn(388, 16, 20, 16, '...', 'browse')}
            ${stat(8, 41, 104, 8, 'Archive <u>f</u>ormat:')}
            ${sel('sz-add-format', 112, 39, 88, formatsFor(single), '7z', 'Archive format')}
            ${stat(8, 62, 104, 8, 'Compression <u>l</u>evel:')}
            ${sel('sz-add-level', 112, 60, 88, LEVELS, 5, 'Compression level')}
            ${stat(8, 83, 104, 8, 'Compression <u>m</u>ethod:')}
            ${sel('sz-add-method', 112, 81, 88, [], '', 'Compression method')}
            ${stat(8, 104, 104, 8, '<u>D</u>ictionary size:')}
            ${sel('sz-add-dict', 112, 102, 88, [], '', 'Dictionary size')}
            ${stat(8, 125, 104, 8, '<u>W</u>ord size:')}
            ${sel('sz-add-word', 112, 123, 88, [], '', 'Word size')}
            ${stat(8, 146, 104, 8, '<u>S</u>olid Block size:')}
            ${sel('sz-add-solid', 112, 144, 88, [], '', 'Solid Block size')}
            ${stat(8, 167, 104, 8, 'Number of CPU <u>t</u>hreads:')}
            ${sel('sz-add-threads', 112, 165, 53, [], '', 'Number of CPU threads')}
            ${stat(175, 167, 25, 8, `/ ${cpus}`, 'sz-right')}
            ${stat(8, 184, 140, 8, 'Memory usage for Compressing:')}
            ${sel('sz-add-mem', 148, 188, 52, [['', '* 80%'], ...[10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((p) => [String(p), `${p}%`])], '', 'Memory usage for Compressing')}
            ${stat(8, 194, 140, 8, '', 'sz-add-memtext')}
            ${stat(8, 208, 140, 8, 'Memory usage for Decompressing:')}
            ${stat(148, 208, 52, 8, '', 'sz-right sz-add-dectext')}
            ${stat(8, 225, 192, 8, 'Split to <u>v</u>olumes, bytes:')}
            ${ecombo('sz-add-volumes', 8, 237, 192, VOLUMES, '', 'Split to volumes, bytes')}
            ${stat(8, 256, 192, 8, 'Parameters:')}
            ${edit('sz-add-params', 8, 268, 192, 14, { label: 'Parameters' })}
            ${btn(8, 292, 64, 16, 'Options', 'options', { disabled: true })}
            ${stat(224, 41, 80, 8, '<u>U</u>pdate mode:')}
            ${sel('sz-add-update', 308, 39, 100, UPDATE_MODES, 'add', 'Update mode')}
            ${stat(224, 61, 80, 8, 'Path mode:')}
            ${sel('sz-add-pathmode', 308, 59, 100, ADD_PATH_MODES, 'relative', 'Path mode')}
            ${grp(224, 80, 184, 64, 'Options')}
            ${chk('szAddSfx', 232, 94, 168, 10, 'Create SF<u>X</u> archive', { disabled: true })}
            ${chk('szAddShared', 232, 110, 168, 10, 'Compress shared files', { disabled: true })}
            ${chk('szAddDelete', 232, 126, 168, 10, 'Delete files after compression')}
            ${grp(224, 152, 184, 128, 'Encryption')}
            ${stat(232, 166, 168, 8, 'Enter <u>p</u>assword:', 'sz-enc')}
            ${edit('sz-add-pw', 232, 178, 168, 14, { password: true, label: 'Enter password' })}
            ${stat(232, 198, 168, 8, 'Reenter password:', 'sz-enc sz-enc-re')}
            ${edit('sz-add-pw2', 232, 210, 168, 14, { password: true, label: 'Reenter password' })}
            ${chk('szAddShow', 232, 231, 168, 10, 'Show Password')}
            ${stat(232, 247, 100, 8, '<u>E</u>ncryption method:', 'sz-enc')}
            ${sel('sz-add-encmethod', 332, 245, 68, [['AES-256', 'AES-256']], 'AES-256', 'Encryption method')}
            ${chk('szAddNames', 232, 263, 168, 10, 'Encrypt file <u>n</u>ames')}
            ${btn(200, 312, 64, 16, 'OK', 'ok', { primary: true })}
            ${btn(272, 312, 64, 16, 'Cancel', 'cancel')}
            ${btn(344, 312, 64, 16, 'Help', 'help')}`;
        const q = (s) => win.content.querySelector(s);
        const nameEdit = wireEcombo(q('.sz-add-name'));
        nameEdit.dataset.autofocus = '1';
        const volEdit = wireEcombo(q('.sz-add-volumes'));
        const f = { format: q('.sz-add-format'), level: q('.sz-add-level'), method: q('.sz-add-method'), dict: q('.sz-add-dict'), word: q('.sz-add-word'), solid: q('.sz-add-solid'), threads: q('.sz-add-threads'), mem: q('.sz-add-mem') };
        let targetPath = sourcePath;

        const fill = (node, list, keep) => {
            const prev = keep ? node.value : '';
            node.innerHTML = options(list, '');
            if (keep && [...node.options].some((o) => o.value === prev)) node.value = prev;
            node.disabled = list.length <= 1 && !(list[0] && list[0][0] === '');
            if (!list.length) node.disabled = true;
        };

        const sync = (changed) => {
            const fmt = f.format.value;
            const level = Number(f.level.value);
            // the name follows the format's extension, as 7-Zip renames it
            if (changed === 'format') {
                const ext = EXT_FOR_FORMAT[fmt];
                const base = nameEdit.value.replace(/\.(7z|zip|tar|wim|gz|bz2|xz)$/i, '');
                nameEdit.value = `${base}.${ext}`;
                if (fmt === 'tar' || fmt === 'wim') f.level.innerHTML = options([[0, '0 - Store']], 0);
                else if (f.level.options.length < 10) f.level.innerHTML = options(LEVELS, 5);
            }
            const store = Number(f.level.value) === 0;
            const methods = METHODS[fmt] || [];
            if (changed === 'format' || changed === 'init') {
                fill(f.method, methods.length ? [['', `* ${methods[0]}`], ...methods.map((m) => [m, m])] : []);
            }
            const method = f.method.value || methods[0] || '';
            const auto = AUTO_7Z[level] || AUTO_7Z[5];
            let dicts = [];
            let autoDict = auto.dict;
            if (/^LZMA/.test(method)) dicts = LZMA_DICTS;
            else if (method === 'PPMd') { dicts = PPMD_DICTS; autoDict = Math.min(level >= 9 ? 192 * MB : level >= 7 ? 64 * MB : 16 * MB, 1024 * MB); }
            else if (method === 'BZip2') { dicts = BZIP2_DICTS; autoDict = 900000; }
            else if (method === 'Deflate') { dicts = [32 * 1024]; autoDict = 32 * 1024; }
            else if (method === 'Deflate64') { dicts = [64 * 1024]; autoDict = 64 * 1024; }
            if (changed !== 'dict' && changed !== 'word' && changed !== 'solid' && changed !== 'threads' && changed !== 'mem') {
                fill(f.dict, store || !dicts.length ? [] : [['', `* ${sizeLabel(autoDict)}`], ...dicts.map((d) => [String(d), sizeLabel(d)])]);
                let words = [];
                let autoWord = auto.word;
                if (/^LZMA/.test(method)) words = LZMA_WORDS;
                else if (method === 'PPMd') { words = PPMD_WORDS; autoWord = level >= 9 ? 32 : level >= 7 ? 16 : 6; }
                else if (/^Deflate/.test(method)) { words = DEFLATE_WORDS; autoWord = level >= 9 ? 128 : level >= 7 ? 64 : 32; }
                fill(f.word, store || !words.length ? [] : [['', `* ${autoWord}`], ...words.map((w) => [String(w), String(w)])]);
                const solidAuto = SOLID.find(([v]) => v === auto.solid);
                fill(f.solid, fmt !== '7z' || store ? [] : [['', `* ${solidAuto ? solidAuto[1] : '8 GB'}`], ...SOLID]);
                const threadList = [['', `* ${cpus}`]];
                for (let i = 1; i <= cpus * 2; i++) threadList.push([String(i), String(i)]);
                fill(f.threads, fmt === 'tar' || fmt === 'wim' ? [] : threadList, true);
            }
            // memory: LZMA2 per level as 7-Zip shows it; a chosen dictionary ~10.6x itself
            const dict = Number(f.dict.value) || autoDict;
            let memMb = store ? 1 : (f.dict.value ? Math.round((dict * 10.6) / MB) + 34 : auto.mem);
            let decMb = store ? 1 : (f.dict.value ? Math.round(dict / MB) + 2 : auto.dec);
            if (!/^LZMA/.test(method) && !store) { memMb = Math.max(1, Math.round(dict / MB) * 2 + 4); decMb = Math.max(1, Math.round(dict / MB) + 1); }
            const limit = Math.round(totalMb * (Number(f.mem.value || 80) / 100));
            q('.sz-add-memtext').textContent = `${memMb} MB / ${limit} MB / ${totalMb} MB`;
            q('.sz-add-dectext').textContent = `${decMb} MB`;
            // encryption: 7z (AES-256, file names too) and zip (ZipCrypto or AES-256) only
            const encOk = fmt === '7z' || fmt === 'zip';
            q('.sz-add-pw').disabled = !encOk;
            q('.sz-add-pw2').disabled = !encOk || q('#szAddShow').checked;
            q('#szAddShow').disabled = !encOk;
            win.content.querySelectorAll('.sz-enc').forEach((n) => n.classList.toggle('is-disabled', !encOk));
            q('.sz-enc-re').classList.toggle('is-disabled', !encOk || q('#szAddShow').checked);
            if (changed === 'format' || changed === 'init') {
                q('.sz-add-encmethod').innerHTML = options(fmt === 'zip' ? [['ZipCrypto', 'ZipCrypto'], ['AES-256', 'AES-256']] : [['AES-256', 'AES-256']], fmt === 'zip' ? 'ZipCrypto' : 'AES-256');
            }
            q('.sz-add-encmethod').disabled = !encOk;
            q('#szAddNames').disabled = fmt !== '7z';
            q('#szAddNames').nextElementSibling.classList.toggle('is-disabled', fmt !== '7z');
        };
        f.format.addEventListener('change', () => sync('format'));
        f.level.addEventListener('change', () => sync('level'));
        f.method.addEventListener('change', () => sync('method'));
        f.dict.addEventListener('change', () => sync('dict'));
        f.mem.addEventListener('change', () => sync('mem'));
        q('#szAddShow').addEventListener('change', (ev) => {
            q('.sz-add-pw').type = ev.target.checked ? 'text' : 'password';
            sync('show');
        });
        sync('init');
        nameEdit.focus();
        nameEdit.setSelectionRange(0, Math.max(0, nameEdit.value.lastIndexOf('.')));

        return runDialog(win, owner, {
            onAction: async (a) => {
                if (a === 'browse') {
                    const picked = await browseFolder(win.modal, 'Specify where the archive is saved.');
                    if (picked) {
                        targetPath = picked;
                        q('.sz-add-dir').textContent = backslashPath(await displayPathOf(picked));
                    }
                } else if (a === 'help') {
                    callGlobal('openWebUrl', 'https://www.7-zip.org/faq.html');
                }
            },
            onOk: async () => {
                const name = nameEdit.value.trim();
                if (!name || /[\\/]/.test(name)) {
                    await message('Specify an archive name.', { owner: win.modal });
                    return false;
                }
                const pw = q('.sz-add-pw').value;
                if (pw && !q('#szAddShow').checked && pw !== q('.sz-add-pw2').value) {
                    await message('Passwords do not match', { owner: win.modal });
                    return false;
                }
                return {
                    items,
                    sourcePath,
                    targetPath,
                    archiveName: name,
                    format: f.format.value,
                    level: Number(f.level.value),
                    method: f.method.value || undefined,
                    dictionary: Number(f.dict.value) || undefined,
                    wordSize: Number(f.word.value) || undefined,
                    solid: f.solid.value || undefined,
                    threads: Number(f.threads.value) || undefined,
                    memoryPercent: f.mem.value || undefined,
                    volumes: volEdit.value.trim() || undefined,
                    parameters: q('.sz-add-params').value.trim() || undefined,
                    updateMode: q('.sz-add-update').value,
                    pathMode: q('.sz-add-pathmode').value,
                    deleteAfter: q('#szAddDelete').checked,
                    password: pw || undefined,
                    encryptionMethod: q('.sz-add-encmethod').value,
                    encryptNames: q('#szAddNames').checked
                };
            }
        });
    }

    // ---- operations from Explorer --------------------------------------------------------------

    function explorerOwner(explorer) {
        return (explorer && explorer.modal) || doc.getElementById('explorerModal');
    }

    function selection(explorer, item) {
        const sel = (explorer && explorer.grid && explorer.grid.getSelectedItems()) || [];
        if (item && !sel.some((s) => s.id === item.id)) return [item];
        return sel.length ? sel : (item ? [item] : []);
    }

    function itemRef(explorer, i) {
        return explorer && typeof explorer._itemRefs === 'function'
            ? explorer._itemRefs([i])[0]
            : { id: i.id, name: i.name, kind: i.kind, targetKind: i.targetKind, targetId: i.targetId, workspaceId: i.workspaceId };
    }

    function uniqueName(explorer, name) {
        const taken = new Set(((explorer && explorer.items) || []).map((i) => String(i.name || '').toLowerCase()));
        if (!taken.has(name.toLowerCase())) return name;
        const dot = name.lastIndexOf('.');
        const stem = name.slice(0, dot);
        const ext = name.slice(dot);
        for (let i = 2; i < 10000; i++) {
            const next = `${stem}_${i}${ext}`;
            if (!taken.has(next.toLowerCase())) return next;
        }
        return name;
    }

    /**
     * Opening an archive: ask for its password when 7-Zip needs one. contents: the files are about
     * to be read (extract, open, download), so encrypted entries need the password too, as 7-Zip asks
     * before it extracts them; browsing a zip with readable names does not. Resolves the summary or null.
     */
    async function unlock(fileId, owner, name, contents = true) {
        let res = await send('vfs_archive_describe', { fileId });
        let tries = 0;
        const locked = (r) => r && (r.needsPassword || (contents && r.archive && r.archive.encrypted && !r.archive.unlocked));
        while (locked(res) && tries < 5) {
            const pw = await askPassword(owner, { wrong: tries > 0 || res.wrongPassword, name: res.name || name });
            if (pw == null) return null;
            res = await send('vfs_archive_describe', { fileId, password: pw });
            tries += 1;
        }
        return res && res.archive ? res.archive : null;
    }

    async function labelFor(fileId, parentPath, name) {
        return `${backslashPath(await displayPathOf(parentPath))}${name}`;
    }

    async function refreshAfter(explorer) {
        if (explorer && typeof explorer.softRefresh === 'function') {
            try { await explorer.softRefresh(); } catch (_) { /* window closed */ }
        }
    }

    /** Extract files... / Extract Here / Extract to "name\" for archives in the current folder. */
    async function extractArchives(explorer, archives, mode) {
        const owner = explorerOwner(explorer);
        const parentPath = explorer.currentPath;
        for (const a of archives) {
            const summary = await unlock(a.targetId, owner, a.name);
            if (!summary) return;
            const label = await labelFor(a.targetId, parentPath, a.name);
            let payload;
            if (mode === 'dialog') {
                payload = await extractDialog(owner, { fileId: a.targetId, name: a.name, label }, { targetPath: parentPath });
                if (!payload) return;
            } else {
                payload = {
                    fileId: a.targetId,
                    targetPath: parentPath,
                    subfolder: mode === 'here' ? '' : stemOf(a.name),
                    eliminateRoot: mode !== 'here',
                    overwrite: 'ask'
                };
            }
            await runOperation('vfs_archive_extract', payload, { kind: 'extract', label, owner });
            await refreshAfter(explorer);
        }
    }

    async function testArchives(explorer, archives, entries) {
        const owner = explorerOwner(explorer);
        for (const a of archives) {
            const summary = await unlock(a.fileId, owner, a.name);
            if (!summary) return;
            await runOperation('vfs_archive_test', { fileId: a.fileId, entries: entries || null }, { kind: 'test', label: a.label, owner });
        }
    }

    async function addToArchive(explorer, items, quick) {
        const owner = explorerOwner(explorer);
        const packable = items.filter(isPackable);
        if (!packable.length) return;
        const single = packable.length === 1 && packable[0].targetKind === 'user-file';
        const base = packable.length === 1
            ? (packable[0].targetKind === 'vfs-folder' ? packable[0].name : stemOf(packable[0].name))
            : ((explorer.vista && explorer._pathStats && explorer._pathStats.displayName) || (explorer._pathStats && explorer._pathStats.displayName) || 'Archive');
        const refs = packable.map((i) => itemRef(explorer, i));
        let payload;
        if (quick) {
            const name = uniqueName(explorer, `${base}.${quick}`);
            payload = { items: refs, sourcePath: explorer.currentPath, archiveName: name, format: quick, level: 5, updateMode: 'add' };
        } else {
            payload = await addDialog(owner, { items: refs, sourcePath: explorer.currentPath, defaultName: `${base}.7z`, single });
            if (!payload) return;
        }
        const label = `${backslashPath(await displayPathOf(payload.targetPath || explorer.currentPath))}${payload.archiveName}`;
        await runOperation('vfs_archive_create', payload, { kind: 'create', label, owner });
        await refreshAfter(explorer);
    }

    async function checksum(explorer, items, method) {
        const owner = explorerOwner(explorer);
        const packable = items.filter(isPackable);
        if (!packable.length) return;
        await runOperation('vfs_archive_hash', { items: packable.map((i) => itemRef(explorer, i)), method }, {
            kind: 'hash',
            label: packable.length === 1 ? packable[0].name : `${packable.length} items`,
            owner
        });
    }

    /** Inside an archive: the archive this folder belongs to, for labels and requests. */
    async function currentArchive(explorer) {
        const loc = splitArchivePath(explorer.currentPath);
        if (!loc) return null;
        const stats = explorer._pathStats;
        const name = (stats && stats.archive && stats.archive.name) || 'archive';
        return { ...loc, name, label: await labelFor(loc.fileId, loc.parentPath, name) };
    }

    async function extractEntries(explorer, entries, opts = {}) {
        const owner = explorerOwner(explorer);
        const arc = opts.archive || await currentArchive(explorer);
        if (!arc) return;
        const summary = await unlock(arc.fileId, owner, arc.name);
        if (!summary) return;
        let payload;
        if (opts.targetPath) {
            payload = { fileId: arc.fileId, entries: entries.map((e) => e.path), base: opts.base != null ? opts.base : arc.base, targetPath: opts.targetPath, overwrite: 'ask' };
        } else {
            payload = await extractDialog(owner, { fileId: arc.fileId, name: arc.name, label: arc.label }, {
                targetPath: arc.parentPath,
                entries: entries.length ? entries.map((e) => e.path) : null,
                base: entries.length ? arc.base : '',
                subfolder: !entries.length
            });
            if (!payload) return;
        }
        await runOperation('vfs_archive_extract', payload, { kind: 'extract', label: arc.label, owner });
        if (explorer && explorer.currentPath === payload.targetPath) await refreshAfter(explorer);
    }

    function clickDownload(url, name) {
        const a = doc.createElement('a');
        a.href = url;
        a.download = name || '';
        doc.body.appendChild(a);
        a.click();
        a.remove();
    }

    /** Extract and download: one file streams as itself, several (or a folder) come as one .zip. */
    async function downloadEntries(explorer, items) {
        const owner = explorerOwner(explorer);
        const arc = await currentArchive(explorer);
        if (!arc || !items.length) return;
        const summary = await unlock(arc.fileId, owner, arc.name);
        if (!summary) return;
        if (items.length === 1 && items[0].kind !== 'folder' && items[0].downloadUrl) {
            clickDownload(items[0].downloadUrl, items[0].name);
            return;
        }
        const r = await runOperation('vfs_archive_pack', {
            fileId: arc.fileId,
            entries: items.map((i) => i.archiveEntryPath || i.targetId),
            base: arc.base
        }, { kind: 'pack', label: arc.label, owner });
        if (r.state === 'done' && r.result && r.result.downloadUrl) clickDownload(r.result.downloadUrl, r.result.name);
    }

    /** Open on an entry: pictures in the viewer, a nested archive or anything else downloads. */
    async function openEntry(explorer, item) {
        if (!item || item.kind === 'folder') return;
        const owner = explorerOwner(explorer);
        const arc = await currentArchive(explorer);
        if (arc && item.encrypted) {
            const summary = await unlock(arc.fileId, owner, arc.name);
            if (!summary) return;
        }
        if ((item.mimeType || '').startsWith('image/') && typeof root.openImageInViewer === 'function') {
            root.openImageInViewer(item.viewUrl, item.name, {});
            return;
        }
        if ((item.mimeType || '').startsWith('text/') || item.mimeType === 'application/pdf') {
            root.open(item.viewUrl, '_blank', 'noopener');
            return;
        }
        clickDownload(item.downloadUrl, item.name);
    }

    /** Double-click on an archive file: into it as a folder (7-Zip's Open archive). */
    async function openArchive(explorer, item) {
        const summary = await unlock(item.targetId, explorerOwner(explorer), item.name, false);
        if (!summary) return false;
        await explorer.navigateTo(archivePathFor(item.targetId, explorer.currentPath));
        return true;
    }

    // ---- menus ---------------------------------------------------------------------------------

    function hashSubmenu() {
        return HASHES.map((h) => ({ text: h, action: `explorer-7z-hash:${h}` }));
    }

    /**
     * The 7-Zip entry for Explorer's context menu (files and folders outside archives), or null.
     */
    function contextMenuEntry(explorer, item) {
        if (!item || isEntry(item) || item.isTrashItem) return null;
        if (isArchivePath(explorer && explorer.currentPath)) return null;
        const sel = selection(explorer, item);
        if (!sel.length || !sel.every((i) => isPackable(i))) return null;
        const archives = sel.filter(isArchiveFileItem);
        const allArchives = archives.length === sel.length;
        const sub = [];
        if (allArchives) {
            if (archives.length === 1) sub.push({ text: 'Open archive', action: 'explorer-7z-open' });
            sub.push({ text: 'Extract files...', action: 'explorer-7z-extract' });
            sub.push({ text: 'Extract Here', action: 'explorer-7z-extract-here' });
            sub.push({ text: archives.length === 1 ? `Extract to "${stemOf(archives[0].name)}\\"` : 'Extract to "*\\"', action: 'explorer-7z-extract-to' });
            sub.push({ text: 'Test archive', action: 'explorer-7z-test' });
        }
        const base = sel.length === 1
            ? (sel[0].targetKind === 'vfs-folder' ? sel[0].name : stemOf(sel[0].name))
            : ((explorer && explorer._pathStats && explorer._pathStats.displayName) || 'Archive');
        sub.push({ text: 'Add to archive...', action: 'explorer-7z-add' });
        sub.push({ text: `Add to "${uniqueName(explorer, `${base}.7z`)}"`, action: 'explorer-7z-add-7z' });
        sub.push({ text: `Add to "${uniqueName(explorer, `${base}.zip`)}"`, action: 'explorer-7z-add-zip' });
        sub.push({ text: 'CRC SHA', submenu: hashSubmenu() });
        return { text: '7-Zip', submenu: sub, hidden: () => !!(explorer && explorer._isReadOnlyUser && explorer._isReadOnlyUser()) };
    }

    /** The whole menu for items inside an archive. */
    function entryMenuSections(explorer, item) {
        const sel = selection(explorer, item);
        const single = sel.length === 1;
        const items = [];
        if (single) items.push({ icon: item.kind === 'folder' ? 'fas fa-folder-open' : 'fas fa-external-link', text: 'Open', action: 'explorer-7z-entry-open' });
        items.push({ icon: 'fas fa-file-export', text: 'Extract files...', action: 'explorer-7z-entry-extract' });
        items.push({ icon: 'fas fa-download', text: 'Download', action: 'explorer-7z-entry-download' });
        items.push({ separator: true });
        items.push({ icon: 'fas fa-copy', text: 'Copy', action: 'explorer-7z-entry-copy' });
        items.push({ separator: true });
        items.push({ text: 'Test archive', action: 'explorer-7z-entry-test' });
        return [{ type: 'list', items }];
    }

    function emptyMenuSections() {
        return [{
            type: 'list',
            items: [
                { icon: 'fas fa-file-export', text: 'Extract all files...', action: 'explorer-7z-extract-all' },
                { icon: 'fas fa-download', text: 'Download all', action: 'explorer-7z-download-all' },
                { separator: true },
                { text: 'Test archive', action: 'explorer-7z-test-all' }
            ]
        }];
    }

    async function handleAction(action, item, explorer) {
        const sel = selection(explorer, item);
        try {
            if (action.startsWith('explorer-7z-hash:')) {
                await checksum(explorer, sel, action.slice('explorer-7z-hash:'.length));
                return true;
            }
            switch (action) {
                case 'explorer-7z-open':
                    if (item) await openArchive(explorer, item);
                    return true;
                case 'explorer-7z-extract':
                    await extractArchives(explorer, sel.filter(isArchiveFileItem), 'dialog');
                    return true;
                case 'explorer-7z-extract-here':
                    await extractArchives(explorer, sel.filter(isArchiveFileItem), 'here');
                    return true;
                case 'explorer-7z-extract-to':
                    await extractArchives(explorer, sel.filter(isArchiveFileItem), 'to');
                    return true;
                case 'explorer-7z-test': {
                    const list = [];
                    for (const a of sel.filter(isArchiveFileItem)) list.push({ fileId: a.targetId, name: a.name, label: await labelFor(a.targetId, explorer.currentPath, a.name) });
                    await testArchives(explorer, list);
                    return true;
                }
                case 'explorer-7z-add':
                    await addToArchive(explorer, sel, null);
                    return true;
                case 'explorer-7z-add-7z':
                    await addToArchive(explorer, sel, '7z');
                    return true;
                case 'explorer-7z-add-zip':
                    await addToArchive(explorer, sel, 'zip');
                    return true;
                case 'explorer-7z-entry-open':
                    if (item && item.kind === 'folder' && item.navPath) await explorer.navigateTo(item.navPath);
                    else if (item) await openEntry(explorer, item);
                    return true;
                case 'explorer-7z-entry-extract':
                    await extractEntries(explorer, sel.filter(isEntry).map((i) => ({ path: i.archiveEntryPath || i.targetId })));
                    return true;
                case 'explorer-7z-entry-download':
                    await downloadEntries(explorer, sel.filter(isEntry));
                    return true;
                case 'explorer-7z-entry-copy':
                    copyEntries(explorer, sel.filter(isEntry));
                    return true;
                case 'explorer-7z-entry-test': {
                    const arc = await currentArchive(explorer);
                    if (arc) await testArchives(explorer, [arc], sel.filter(isEntry).map((i) => i.archiveEntryPath || i.targetId));
                    return true;
                }
                case 'explorer-7z-extract-all':
                    await extractEntries(explorer, []);
                    return true;
                case 'explorer-7z-download-all': {
                    const arc = await currentArchive(explorer);
                    if (arc) await downloadEntries(explorer, (explorer.items || []).filter(isEntry));
                    return true;
                }
                case 'explorer-7z-test-all': {
                    const arc = await currentArchive(explorer);
                    if (arc) await testArchives(explorer, [arc]);
                    return true;
                }
                default:
                    return false;
            }
        } catch (err) {
            await message(err.message || String(err), { owner: explorerOwner(explorer), icon: 'fas fa-times-circle' });
            return true;
        }
    }

    // ---- clipboard: a copy inside an archive pastes as an extraction ---------------------------

    function copyEntries(explorer, items) {
        if (!explorer || !items.length) return;
        const loc = splitArchivePath(explorer.currentPath);
        explorer.clipboard = {
            operation: 'copy',
            items: items.map((i) => ({ id: i.id, name: i.name, kind: i.kind, targetKind: 'archive-entry', targetId: i.targetId })),
            sourcePath: explorer.currentPath,
            archive: loc ? { fileId: loc.fileId, base: loc.base, parentPath: loc.parentPath, archiveRoot: loc.archiveRoot } : null
        };
        if (typeof explorer.updateToolbarState === 'function') explorer.updateToolbarState();
    }

    function isEntryRefs(refs) {
        return Array.isArray(refs) && refs.length > 0 && refs.every((r) => r && r.targetKind === 'archive-entry');
    }

    /** A paste or drop of archive entries into a folder: extract them there. */
    async function deliverEntries(explorer, refs, navPath, sourcePath) {
        if (isArchivePath(navPath)) {
            await message('Cannot copy files into a compressed folder. Extract its files first.', { owner: explorerOwner(explorer) });
            return false;
        }
        const first = refEntry(refs[0]);
        if (!first) return false;
        const src = splitArchivePath(sourcePath || '') || { base: '', parentPath: '/' };
        const name = (explorer._pathStats && explorer._pathStats.archive && explorer._pathStats.archive.name) || 'archive';
        const arc = {
            fileId: first.fileId,
            base: src.base,
            parentPath: src.parentPath,
            name,
            label: await labelFor(first.fileId, src.parentPath, name)
        };
        await extractEntries(explorer, refs.map(refEntry).filter(Boolean), { archive: arc, targetPath: navPath, base: src.base });
        return true;
    }

    // ---- command bar ---------------------------------------------------------------------------

    /** Inside an archive: Extract all files shows, Upload goes (explorerApplet updateToolbarState). */
    function syncCommands(explorer) {
        if (!doc) return;
        const inside = isArchivePath(explorer && explorer.currentPath);
        const cmd = doc.getElementById('explorerExtractAllCmd');
        if (cmd) {
            cmd.classList.toggle('hidden', !inside);
            if (!cmd.dataset.szWired) {
                cmd.dataset.szWired = '1';
                cmd.addEventListener('click', () => {
                    const app = root.explorerApplet || explorer;
                    if (app) void handleAction('explorer-7z-extract-all', null, app);
                });
            }
        }
        const upload = doc.getElementById('explorerUploadCmd');
        if (upload && inside) upload.classList.add('hidden');
    }

    const api = {
        SEGMENT,
        isArchivePath,
        splitArchivePath,
        archivePathFor,
        isArchiveName,
        isArchiveFileItem,
        isEntry,
        isEntryRefs,
        contextMenuEntry,
        entryMenuSections,
        emptyMenuSections,
        handleAction,
        openArchive,
        openEntry,
        downloadEntries,
        deliverEntries,
        copyEntries,
        syncCommands,
        runOperation,
        _test: { stemOf, progressSize, clock, uniqueName, refEntry, dlu, sizeLabel, backslashPath, formatsFor }
    };
    root.explorerArchive = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
