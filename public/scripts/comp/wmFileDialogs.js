/**
 * Melaton Mobile: Windows Mobile 6.1's own Open and Save As dialogs (Yozora #709).
 *
 * The desktop asks for a file with Vista's common file dialog (studioSession.js
 * studioOpenFolderDialog, #studioSaveFolderModal). On a phone that window either stayed hidden (the
 * shell hides desktop windows) or, inside Studio, was squeezed into a tool page as broken Vista
 * fragments. Here every studioOpenFolderDialog call on a phone shows WM's dialogs instead, over the
 * same VFS, and answers the caller's host the desktop's way (host.onSave / onOpen / onCancel,
 * acceptItem / acceptType, typeLabel, suggestName, extraButton), so the program's own code saves
 * and opens. Measured on the Device Emulator (VGA, 2x halved; ~/.cache/wm61/ref-fd):
 *
 *   Save As   (Word Mobile Menu > File > Save As...) the program's title bar without X / ok; a
 *             23 px header "Save As" in the highlight colour over a 1 px black rule; label | box
 *             rows 30 px apart from y 12: Name (edit), Folder (None + the folders), Type, Location
 *             (Main memory / Storage Card: here the workspaces), then Save and Cancel push buttons
 *             66 x 23 at the right, 7 apart. No soft keys (the input panel button only).
 *   Open      (commdlg GetOpenFileName) a black bold "Open" header; Folder (All Folders + the
 *             folders) with Cancel at its right, Type; a list with a column header (Name ^, Folder,
 *             Date, Size: a tap sorts, again reverses) and 18 px rows; a tap on a file opens it.
 *             "All Folders" lists the files of every folder (two levels deep) in one list.
 *
 * Files from the phone itself (<input type=file>) stay the browser's picker: "Browse device..."
 * (Menu) where the caller can take them (the host's extraButton, the Director's attachments).
 *
 * Also routed here on phones: Studio's name dialogs (openStudioSaveNameDialog: Save Preset, Save
 * to Desktop, the session name, Open Preset), the Director's Attach File (its file input's click),
 * Internet Explorer's upload fields (wmBrowser.js via window.wmFileDialogs.open).
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Styles: wm-file-dialogs.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'wm-file';
    const ART = '/static_images/wm61/';
    const LIST_LIMIT = 500;
    const MAX_FOLDERS = 24; // listings for "All Folders" / the Folder list
    const SORT_KEY = 'wmFileDialogSort';
    const BAD_NAME = /[\\/:*?"<>|]/;
    const root = document.documentElement;
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    let ws = null; // window.wmShell
    let page = null;
    let dlg = null; // the dialog on screen (one at a time)
    let token = 0;

    const isCurrent = () => !!(ws && ws.current === APP_ID);

    function activeWs() {
        try {
            // workspaceUtils.js: a top-level let, not on window
            // eslint-disable-next-line no-undef
            if (typeof activeWorkspace !== 'undefined' && activeWorkspace) return activeWorkspace;
        } catch (_) { /* not loaded */ }
        return 'default';
    }

    /** The workspaces as locations: [{ id, name }], the active one first. */
    function locations() {
        let list = [];
        try {
            // eslint-disable-next-line no-undef
            if (typeof workspaces !== 'undefined' && workspaces) list = Object.values(workspaces).filter((w) => w && w.id).sort((a, b) => (a.sort || 0) - (b.sort || 0));
        } catch (_) { list = []; }
        const out = list.map((w) => ({ id: w.id, name: w.name || w.id }));
        const cur = activeWs();
        if (!out.some((l) => l.id === cur)) out.unshift({ id: cur, name: cur });
        out.sort((a, b) => (a.id === cur ? -1 : b.id === cur ? 1 : 0));
        return out;
    }

    const wsRoot = (id) => `/Workspaces/${id}`;
    const isFolder = (i) => !!(i && (i.kind === 'folder' || i.targetKind === 'vfs-folder' || i.targetKind === 'system-folder' || i.targetKind === 'workspace'));

    /** A folder item's path (studioSession.js studioSaveFolderNavPath where it is loaded). */
    function folderPath(i, base) {
        if (!i) return null;
        if (i.navPath) return i.navPath;
        /* global studioSaveFolderNavPath */
        if (typeof studioSaveFolderNavPath === 'function') { try { return studioSaveFolderNavPath(i, base); } catch (_) { /* below */ } }
        if (i.targetKind === 'system-folder' && i.workspaceId && i.name) return `/Workspaces/${i.workspaceId}/${i.name}`;
        const id = i.targetId || i.id;
        if (!id) return null;
        if (i.workspaceId) return `/Workspaces/${i.workspaceId}/${id}`;
        return `${String(base || '/').replace(/\/+$/, '')}/${id}`;
    }

    // ---------------------------------------------------------------- formats

    /** The Open list's date: M/D h:mm (as the dialog shows it). */
    function fmtDate(t) {
        let n = Number(t);
        if (!n) n = Date.parse(t || '') || 0;
        if (!n) return '';
        if (n < 1e12) n *= 1000;
        const d = new Date(n);
        return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours() % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

    function fmtSize(b) {
        const n = Number(b);
        if (!Number.isFinite(n) || n <= 0) return '';
        if (n < 1024) return `${n}b`;
        const units = ['k', 'M', 'G'];
        let v = n / 1024;
        let u = 0;
        while (v >= 1000 && u < units.length - 1) { v /= 1024; u++; }
        return `${v < 10 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)}${units[u]}`;
    }

    function iconOf(i) {
        if (i.phoneFile) return /^image\//.test(i.mimeType || '') ? 'app-pictures' : 'fe-file';
        if (i.targetKind === 'image' || i.targetKind === 'scrap' || i.shortcutType === 'image' || /^image\//.test(i.mimeType || '')) return 'app-pictures';
        if (i.targetKind === 'note') return 'app-notes';
        if (i.shortcutType === 'request' || i.shortcutType === 'preset') return 'app-studio';
        return 'fe-file';
    }

    function icon(name) {
        const set = ws && ws.art && ws.art.srcset ? ws.art.srcset(name) : `${ART}${name}.png 1x, ${ART}${name}@2x.png 2x`;
        return `<img src="${ART}${name}.png" srcset="${esc(set)}" alt="" draggable="false">`;
    }

    // ---------------------------------------------------------------- listing

    async function list(path) {
        /* global vfsClient */
        if (typeof vfsClient === 'undefined' || !vfsClient) throw new Error('The file system is not available.');
        const res = await vfsClient.listDirectory(path, { offset: 0, limit: LIST_LIMIT, sortField: 'name', sortDirection: 'asc', search: '' });
        return ((res && res.items) || []).filter((i) => !String(i.name || '').startsWith('.'));
    }

    /**
     * The folders of a location (two levels; the first level only for Save As) and, for "All
     * Folders", the files of each: { folders: [{ path, label }], files: [{ item, path, label }] }.
     */
    async function survey(rootPath, depth, withFiles) {
        const folders = [];
        const files = [];
        let level = [{ path: rootPath, label: '' }];
        let listed = 0;
        for (let d = 0; d <= depth && level.length; d++) {
            const batch = level.slice(0, Math.max(0, MAX_FOLDERS - listed));
            listed += batch.length;
            const results = await Promise.all(batch.map((f) => list(f.path).then((items) => ({ f, items }), () => ({ f, items: [] }))));
            const next = [];
            for (const { f, items } of results) {
                for (const i of items) {
                    if (isFolder(i)) {
                        // not places to keep files: the workspaces themselves, System, the Trash
                        if (i.targetKind === 'workspace' || ['@system', '@workspaces', '@trash'].includes(i.targetId)) continue;
                        const p = folderPath(i, f.path);
                        if (!p) continue;
                        const sub = { path: p, label: f.label ? `${f.label}\\${i.name}` : i.name };
                        if (d < depth || !withFiles) folders.push(sub);
                        if (d < depth) next.push(sub);
                    } else if (withFiles) {
                        files.push({ item: i, path: f.path, label: f.label });
                    }
                }
            }
            level = next;
            if (!withFiles && d >= depth - 1) break;
        }
        // a folder's subfolders follow it (Desktop, Desktop\Test, Downloads ...)
        folders.sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: 'base' }));
        return { folders, files };
    }

    // ---------------------------------------------------------------- the dialog

    /**
     * opts: { kind: 'open' | 'save', title, appTitle, typeLabel, startPath, accept(item) -> bool,
     *   sameType(item) -> bool (Save As: what a name overwrites), suggestName() -> string,
     *   onPick(item, folderPath) -> Promise<false keeps it open>, onSave({ path, name, workspaceId,
     *   items }) -> Promise<truthy closes>, onCancel(), extra: [{ label, action }] (Menu),
     *   phone: true = the phone's own volumes as locations too (files read through the bridge) }
     * Resolves when the dialog is on screen.
     */
    function show(opts) {
        if (!ws) return Promise.resolve(false);
        if (dlg) settle(dlg, 'cancel', true);
        const prev = ws.current && ws.current !== APP_ID ? ws.listApps().find((a) => a.id === ws.current) : null;
        let sort = { field: 'name', dir: 'asc' };
        try { const s = JSON.parse(localStorage.getItem(SORT_KEY) || 'null'); if (s && s.field) sort = s; } catch (_) { /* default */ }
        const start = String(opts.startPath || '');
        const m = /^\/Workspaces\/([^/]+)(\/.*)?$/.exec(start);
        const loc = m ? m[1] : activeWs();
        dlg = {
            opts,
            kind: opts.kind === 'save' ? 'save' : 'open',
            appTitle: opts.appTitle || (prev && (prev.title || prev.id)) || 'Melaton Mobile',
            location: loc,
            // Save As: the start folder ('' = None, the location itself); Open: '' = All Folders
            folder: m && m[2] && m[2] !== '/' ? start.replace(/\/+$/, '') : '',
            folders: [],
            startLabel: '',
            files: [],
            loading: true,
            error: '',
            sort,
            selected: null,
            name: opts.kind === 'save' && typeof opts.suggestName === 'function' ? String(opts.suggestName() || '') : '',
            busy: false,
            done: false
        };
        if (!isCurrent()) ws.open(APP_ID);
        render();
        // the name is not focused: WM leaves the input panel down until the box is tapped
        void load(dlg, { first: true });
        return Promise.resolve(true);
    }

    /** Ends the dialog once: 'done' (the caller has its answer) or 'cancel' (onCancel). */
    function settle(d, how, stay) {
        if (!d || d.done) return;
        d.done = true;
        if (dlg === d) dlg = null;
        if (how === 'cancel' && typeof d.opts.onCancel === 'function') {
            try { d.opts.onCancel(); } catch (err) { console.warn('[wmFileDialogs] cancel', err); }
        }
        // stay: another dialog replaces it, or the shell is already leaving this page
        if (!stay && isCurrent() && !dlg) ws.back();
    }

    async function load(d, o = {}) {
        const my = ++token;
        d.loading = true;
        d.error = '';
        render();
        const isPhone = String(d.location).startsWith('phone:');
        try {
            if (typeof d.opts.items === 'function') {
                // a list of its own (Studio's presets): no folders or locations
                const all = await d.opts.items();
                if (my !== token || d.done) return;
                d.all = all || [];
                d.folders = [];
            } else if (d.opts.folderFixed || d.opts.noFolder) {
                d.folders = [];
            } else if (isPhone) {
                await loadPhone(d);
            } else if (d.kind === 'save') {
                const s = await survey(wsRoot(d.location), 1, false);
                if (my !== token || d.done) return;
                d.folders = s.folders;
            } else {
                const s = await survey(wsRoot(d.location), 2, true);
                if (my !== token || d.done) return;
                d.folders = s.folders.filter((f, i, a) => a.findIndex((g) => g.path === f.path) === i);
                d.all = s.files;
                // a start folder deeper than the list: shown on its own
                if (d.folder && !d.folders.some((f) => f.path === d.folder)) {
                    const items = await list(d.folder).catch(() => []);
                    if (my !== token || d.done) return;
                    d.extraFiles = items.filter((i) => !isFolder(i)).map((item) => ({ item, path: d.folder, label: d.startLabel || '' }));
                }
            }
            if (o.first && d.folder && !d.folders.some((f) => f.path === d.folder)) {
                // the start folder (a file's own) is in the Folder list by its name
                let label = '';
                try {
                    const st = await vfsClient.getPathStats(d.folder);
                    const dp = st && (st.displayPath || (st.stats && st.stats.displayPath));
                    if (dp) label = String(dp).split('/').filter(Boolean).slice(2).join('\\');
                } catch (_) { /* below */ }
                if (my !== token || d.done) return;
                d.startLabel = label || d.folder.split('/').pop();
                d.folders.unshift({ path: d.folder, label: d.startLabel });
                if (d.extraFiles) d.extraFiles.forEach((f) => { f.label = d.startLabel; });
            }
        } catch (err) {
            if (my !== token || d.done) return;
            d.error = (err && err.message) || 'Cannot open this folder.';
        }
        if (my !== token || d.done) return;
        d.loading = false;
        render();
    }

    /** The phone's own volume as a location (files read through the Android bridge). */
    async function loadPhone(d) {
        const PS = window.phoneStorage;
        const rootId = String(d.location).slice(6);
        const files = [];
        const folders = [];
        const walk = async (path, label, depth) => {
            let res = null;
            try { res = await PS.call('list', { root: rootId, path }); } catch (_) { res = null; }
            const entries = (res && res.entries) || [];
            for (const e of entries) {
                const name = e.name || '';
                if (!name || name.startsWith('.') || e.hidden) continue;
                const p = e.path || PS.joinPath(path, name);
                if (e.dir) {
                    if (depth < 1 && folders.length < MAX_FOLDERS) {
                        const sub = { path: `phone:${rootId}:${p}`, label: label ? `${label}\\${name}` : name };
                        folders.push(sub);
                        await walk(p, sub.label, depth + 1);
                    }
                } else {
                    const mtime = Number(e.mtime) || 0;
                    files.push({ item: { id: `phone:${rootId}:${p}`, name, phoneFile: { root: rootId, path: p }, mimeType: e.mime || '', size: Number(e.size) || 0, modifiedAt: mtime > 1e12 ? mtime : mtime * 1000 }, path: label ? `phone:${rootId}:${path}` : `phone:${rootId}:/`, label });
                }
            }
        };
        await walk('/', '', 0);
        d.folders = folders;
        d.all = files;
        d.extraFiles = null;
    }

    /** The Open list: the folder's files (or every folder's), the Type's only, in the header's order. */
    function rows(d) {
        const accept = typeof d.opts.accept === 'function' ? d.opts.accept : () => true;
        let src = (d.all || []).concat(d.extraFiles || []);
        if (d.folder) src = src.filter((r) => r.path === d.folder);
        src = src.filter((r) => { try { return accept(r.item); } catch (_) { return false; } });
        const k = d.sort.field;
        const val = (r) => (k === 'folder' ? (r.label || '').toLowerCase()
            : k === 'date' ? (Number(r.item.modifiedAt) || Date.parse(r.item.modifiedAt || r.item.updatedAt || '') || 0)
                : k === 'size' ? (Number(r.item.sizeBytes != null ? r.item.sizeBytes : r.item.size) || 0)
                    : String(r.item.name || '').toLowerCase());
        const dir = d.sort.dir === 'desc' ? -1 : 1;
        return src.slice().sort((a, b) => {
            const va = val(a);
            const vb = val(b);
            const c = typeof va === 'string' ? va.localeCompare(vb, undefined, { numeric: true }) : va - vb;
            return (c || String(a.item.name || '').localeCompare(String(b.item.name || ''), undefined, { numeric: true })) * dir;
        });
    }

    function folderLabel(d) {
        if (!d.folder) return d.kind === 'save' ? 'None' : 'All Folders';
        const f = d.folders.find((x) => x.path === d.folder);
        return f ? f.label : (d.startLabel || d.folder.split('/').pop());
    }

    function locationLabel(d) {
        const p = phoneRoots().find((r) => `phone:${r.id}` === d.location);
        if (p) return p.label;
        const l = locations().find((x) => x.id === d.location);
        return l ? l.name : d.location;
    }

    function phoneRoots() {
        if (!dlg || !dlg.opts.phone) return [];
        try {
            const PD = window.explorerPhoneDrive;
            const PS = window.phoneStorage;
            if (!PD || !PD.available() || !PS || typeof PS.state !== 'function') return [];
            const st = PS.state();
            if (!st || !st.enabled || !st.access || st.locked) return [];
            const roots = Array.isArray(st.roots) ? st.roots : [];
            return roots.filter((r) => r && r.id).map((r) => ({ id: r.id, label: String(r.name || '').trim() || r.id }));
        } catch (_) { return []; }
    }

    function render() {
        if (!page) return;
        const d = dlg;
        closeCombo();
        if (!d) { page.innerHTML = ''; return; }
        if (isCurrent()) {
            ws.setTitle(d.appTitle);
            ws.setTitleAction(null);
            ws.refreshSoftKeys();
        }
        const title = esc(d.opts.title || (d.kind === 'save' ? 'Save As' : 'Open'));
        const typeLabel = esc(d.opts.typeLabel || 'All Files (*.*)');
        const many = !d.opts.noLocation && typeof d.opts.items !== 'function' && locations().length + phoneRoots().length > 1;
        if (d.kind === 'save') {
            const had = page.querySelector('[data-f="name"]');
            if (had) d.name = had.value;
            page.innerHTML = `<div class="wfd wfd-save">
                <div class="wm-form-hdr">${title}</div>
                <div class="wfd-form">
                    <div class="wfd-row"><label for="wfdName">Name:</label><input id="wfdName" class="wm-edit" data-f="name" type="text" autocomplete="off" spellcheck="false" value="${esc(d.name)}"></div>
                    ${d.opts.noFolder ? '' : `<div class="wfd-row"><span class="wfd-label">Folder:</span><button type="button" class="wm-combo" data-dd="folder"${d.loading || d.opts.folderFixed ? ' disabled' : ''}><span>${esc(d.opts.folderFixed || folderLabel(d))}</span></button></div>`}
                    ${d.opts.noType ? '' : `<div class="wfd-row"><span class="wfd-label">Type:</span><button type="button" class="wm-combo" data-dd="type"><span>${typeLabel}</span></button></div>`}
                    ${d.opts.noLocation ? '' : `<div class="wfd-row"><span class="wfd-label">Location:</span><button type="button" class="wm-combo" data-dd="location"${many ? '' : ' disabled'}><span>${esc(locationLabel(d))}</span></button></div>`}
                    <div class="wfd-buttons"><button type="button" class="wm-button" data-act="save"${d.busy ? ' disabled' : ''}>${esc(d.opts.okLabel || 'Save')}</button><button type="button" class="wm-button" data-act="cancel">Cancel</button></div>
                    ${d.error ? `<p class="wfd-note">${esc(d.error)}</p>` : ''}
                </div>
            </div>`;
        } else {
            const r = d.loading ? [] : rows(d);
            const arrow = (k) => (d.sort.field === k ? `<i class="wfd-sort${d.sort.dir === 'desc' ? ' is-desc' : ''}" aria-hidden="true"></i>` : '');
            const scroll = page.querySelector('.wfd-scroll');
            const keep = scroll ? { top: scroll.scrollTop, left: scroll.scrollLeft } : null;
            page.innerHTML = `<div class="wfd wfd-open">
                <div class="wfd-hdr">${title}</div>
                <div class="wfd-top${many ? ' has-loc' : ''}">
                    ${typeof d.opts.items === 'function'
                        ? `<div class="wfd-row has-btn"><span class="wfd-label">Type:</span><button type="button" class="wm-combo" data-dd="type"><span>${typeLabel}</span></button><button type="button" class="wm-button" data-act="cancel">Cancel</button></div>`
                        : `<div class="wfd-row has-btn"><span class="wfd-label">Folder:</span><button type="button" class="wm-combo" data-dd="folder"${d.loading ? ' disabled' : ''}><span>${esc(folderLabel(d))}</span></button><button type="button" class="wm-button" data-act="cancel">Cancel</button></div>
                    <div class="wfd-row"><span class="wfd-label">Type:</span><button type="button" class="wm-combo" data-dd="type"><span>${typeLabel}</span></button></div>`}
                    ${many ? `<div class="wfd-row"><span class="wfd-label">Location:</span><button type="button" class="wm-combo" data-dd="location"><span>${esc(locationLabel(d))}</span></button></div>` : ''}
                </div>
                <div class="wfd-scroll" role="listbox" aria-label="${title}">
                    <div class="wfd-table">
                        <div class="wfd-head" role="row">
                            <button type="button" class="wfd-col is-name" data-sort="name">Name${arrow('name')}</button><button type="button" class="wfd-col is-folder" data-sort="folder">Folder${arrow('folder')}</button><button type="button" class="wfd-col is-date" data-sort="date">Date${arrow('date')}</button><button type="button" class="wfd-col is-size" data-sort="size">Size${arrow('size')}</button>
                        </div>
                        ${r.map((x) => `<div class="wfd-item${d.selected === x.item.id ? ' is-selected' : ''}" role="option" data-id="${esc(x.item.id)}">`
                            + `<span class="wfd-name">${icon(iconOf(x.item))}<span>${esc(x.item.name)}</span></span>`
                            + `<span class="wfd-folder">${esc(x.label || locationLabel(d))}</span><span class="wfd-date">${esc(fmtDate(x.item.modifiedAt || x.item.updatedAt))}</span>`
                            + `<span class="wfd-size">${esc(fmtSize(x.item.sizeBytes != null ? x.item.sizeBytes : x.item.size))}</span></div>`).join('')}
                    </div>
                    ${d.loading ? '<p class="wfd-note">Searching...</p>' : (d.error ? `<p class="wfd-note">${esc(d.error)}</p>` : (!r.length ? '<p class="wfd-note">No files of this type.</p>' : ''))}
                </div>
            </div>`;
            const sc = page.querySelector('.wfd-scroll');
            if (sc && keep) { sc.scrollTop = keep.top; sc.scrollLeft = keep.left; }
        }
    }

    // ---------------------------------------------------------------- actions

    /**
     * A combo box's list, as WM draws it: the box's width under it, 1 px black frame, plain rows with
     * the current one in the highlight colour (not the shell's menu-style drop-down). A tap outside or
     * the back key closes it.
     */
    let combo = null; // { el, btn }

    function closeCombo() {
        if (!combo) return false;
        combo.el.remove();
        combo.btn.setAttribute('aria-expanded', 'false');
        combo = null;
        return true;
    }

    function dropdown(btn, items) {
        const again = combo && combo.btn === btn;
        closeCombo();
        if (again || !page) return;
        const el = document.createElement('div');
        el.className = 'wfd-combo-list';
        el.setAttribute('role', 'listbox');
        items.forEach((it, i) => {
            if (it === '-') { el.insertAdjacentHTML('beforeend', '<div class="wfd-combo-sep" role="separator"></div>'); return; }
            el.insertAdjacentHTML('beforeend', `<div class="wfd-combo-row${it.radio ? ' is-selected' : ''}" role="option" aria-selected="${!!it.radio}" data-i="${i}">${esc(it.label)}</div>`);
        });
        const pr = page.getBoundingClientRect();
        const br = btn.getBoundingClientRect();
        el.style.left = `${br.left - pr.left}px`;
        el.style.width = `${br.width}px`;
        el.style.top = `${br.bottom - pr.top - 1}px`;
        const area = (page.parentElement || page).getBoundingClientRect();
        el.style.maxHeight = `${Math.max(60, Math.min(area.bottom, window.innerHeight) - br.bottom - 4)}px`;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            const row = e.target.closest && e.target.closest('.wfd-combo-row');
            if (!row) return;
            const it = items[Number(row.dataset.i)];
            closeCombo();
            if (it && typeof it.action === 'function') it.action();
        });
        page.appendChild(el);
        btn.setAttribute('aria-expanded', 'true');
        combo = { el, btn };
        const cur = el.querySelector('.is-selected');
        if (cur) cur.scrollIntoView({ block: 'nearest' });
    }

    function onDropdown(btn) {
        const d = dlg;
        if (!d || btn.disabled) return;
        const which = btn.dataset.dd;
        if (which === 'type') {
            dropdown(btn, [{ label: d.opts.typeLabel || 'All Files (*.*)', radio: true, action: () => {} }]);
            return;
        }
        if (which === 'folder') {
            const items = [{ label: d.kind === 'save' ? 'None' : 'All Folders', radio: !d.folder, action: () => { d.folder = ''; d.selected = null; render(); } }];
            d.folders.forEach((f) => items.push({ label: f.label, radio: d.folder === f.path, action: () => { d.folder = f.path; d.selected = null; render(); } }));
            dropdown(btn, items);
            return;
        }
        if (which === 'location') {
            const go = (id) => {
                if (d.location === id) return;
                d.location = id;
                d.folder = '';
                d.folders = [];
                d.all = [];
                d.extraFiles = null;
                d.selected = null;
                void load(d);
            };
            const items = locations().map((l) => ({ label: l.name, radio: d.location === l.id, action: () => go(l.id) }));
            const phones = phoneRoots();
            if (phones.length) {
                items.push('-');
                phones.forEach((p) => items.push({ label: p.label, radio: d.location === `phone:${p.id}`, action: () => go(`phone:${p.id}`) }));
            }
            dropdown(btn, items);
        }
    }

    async function message(text, icon = 'warning') {
        const d = dlg;
        await ws.messageBox({ title: (d && d.appTitle) || 'Melaton Mobile', icon, text });
    }

    async function doSave() {
        const d = dlg;
        if (!d || d.busy || d.loading) return;
        const input = page.querySelector('[data-f="name"]');
        const name = String(input ? input.value : d.name).trim();
        d.name = name;
        if (!name) { await message('Enter a name for the file.'); return; }
        if (BAD_NAME.test(name)) { await message('The name contains characters that cannot be used: \\ / : * ? " < > |'); return; }
        const path = d.opts.folderFixed ? null : (d.folder || wsRoot(d.location));
        d.busy = true;
        render();
        let ok = false;
        try {
            let items = [];
            if (path) { try { items = await list(path); } catch (_) { items = []; } }
            if (d.done) return;
            ok = !!(await d.opts.onSave({ path, name, workspaceId: d.location, items }));
        } catch (err) {
            console.warn('[wmFileDialogs] save', err);
            await message(`${name} could not be saved. ${(err && err.message) || ''}`.trim(), 'error');
        }
        d.busy = false;
        if (ok) settle(d, 'done');
        else if (!d.done) render();
    }

    async function pick(id) {
        const d = dlg;
        if (!d || d.busy) return;
        const row = (d.all || []).concat(d.extraFiles || []).find((r) => r.item.id === id);
        if (!row) return;
        d.selected = id;
        render();
        d.busy = true;
        let keep = false;
        try {
            keep = (await d.opts.onPick(row.item, row.path, { close: () => settle(d, 'done') })) === false;
        } catch (err) {
            console.warn('[wmFileDialogs] open', err);
            keep = true;
            await message(`${row.item.name} could not be opened. ${(err && err.message) || ''}`.trim(), 'error');
        }
        d.busy = false;
        if (!keep) settle(d, 'done');
    }

    function softKeys() {
        const d = dlg;
        if (!d) return { left: null, right: null };
        const extra = (d.opts.extra || []).filter(Boolean);
        return {
            left: null,
            right: extra.length ? { label: 'Menu', menu: () => extra.map((x) => ({ label: x.label, action: () => x.action(d) })) } : null
        };
    }

    function mount(p) {
        page = p;
        page.classList.add('wm-fd');
        page.addEventListener('click', (e) => {
            const t = e.target;
            if (!t || !t.closest || !dlg) return;
            const dd = t.closest('[data-dd]');
            if (combo && (!dd || dd !== combo.btn)) { closeCombo(); return; }
            if (dd) { onDropdown(dd); return; }
            const act = t.closest('[data-act]');
            if (act) {
                if (act.dataset.act === 'cancel') settle(dlg, 'cancel');
                else if (act.dataset.act === 'save') void doSave();
                return;
            }
            const col = t.closest('[data-sort]');
            if (col) {
                const k = col.dataset.sort;
                dlg.sort = { field: k, dir: dlg.sort.field === k && dlg.sort.dir === 'asc' ? 'desc' : 'asc' };
                try { localStorage.setItem(SORT_KEY, JSON.stringify(dlg.sort)); } catch (_) { /* this time only */ }
                render();
                return;
            }
            const row = t.closest('.wfd-item');
            if (row) void pick(row.dataset.id);
        });
        page.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && e.target && e.target.matches && e.target.matches('[data-f="name"]')) {
                e.preventDefault();
                void doSave();
            }
        });
        page.addEventListener('input', (e) => { if (dlg && e.target && e.target.matches && e.target.matches('[data-f="name"]')) dlg.name = e.target.value; });
    }

    // ---------------------------------------------------------------- the desktop's file dialog

    /**
     * studioOpenFolderDialog(mode, options) on a phone: the same host contract as the desktop
     * dialog (studioSession.js), answered by the WM dialogs above. Without a host it is Studio's own
     * (Save As > To Folder saves the session; Open / Open Picture open a picture, preset or session).
     */
    function studioDialog(mode, options) {
        const host = options.host || null;
        const save = mode === 'save';
        const acceptType = (host && host.acceptType) || 'request';
        const sameType = (i) => !!(i && i.shortcutType === acceptType && i.kind !== 'folder');
        const isImage = (i) => i.targetKind === 'image' || i.targetKind === 'scrap' || i.shortcutType === 'image';
        let accept;
        if (host && typeof host.acceptItem === 'function') accept = (i) => host.acceptItem(i);
        else if (host && host.acceptType) accept = sameType;
        else if (save) accept = sameType;
        else if (mode === 'open-gallery') accept = isImage;
        else accept = (i) => isImage(i) || i.shortcutType === 'request' || i.shortcutType === 'preset';
        const typeLabel = (host && host.typeLabel) || (acceptType === 'bracket-generation' ? 'Phasewalker Files'
            : mode === 'open-gallery' ? 'Pictures' : mode === 'open-vfs' ? 'All Studio Files' : 'Studio Sessions');
        const wsId = activeWs();
        let startPath = options.startPath || '';
        if (!startPath) startPath = mode === 'open-gallery' ? `/Workspaces/${wsId}/Pictures` : `/Workspaces/${wsId}`;
        const extra = [];
        if (host && host.extraButton && typeof host.extraButton.onClick === 'function') {
            // "Select on Client" and the like: the phone's own files (the browser's picker)
            extra.push({ label: 'Browse device...', action: () => host.extraButton.onClick() });
        }
        const settled = () => { if (host) host._settled = true; };
        /* global studioSaveFolderState, studioSaveFolderOverwrite, saveRequestAsDesktopShortcut, studioOpenSessionFromImage, desktopShortcuts */
        return show({
            kind: save ? 'save' : 'open',
            title: (host && host.title) || (save ? 'Save As' : 'Open'),
            typeLabel,
            startPath,
            accept,
            suggestName: () => {
                if (host && typeof host.suggestName === 'function') return host.suggestName();
                try { if (typeof studioSessionPresetName === 'function') return studioSessionPresetName(); } catch (_) { /* none */ } // eslint-disable-line no-undef
                return '';
            },
            extra,
            async onSave(info) {
                // the overwrite target: the desktop's own lookup over this folder's items
                let overwrite = {};
                try {
                    studioSaveFolderState.items = info.items;
                    studioSaveFolderState.host = host;
                    studioSaveFolderState.path = info.path;
                    overwrite = studioSaveFolderOverwrite(info.name) || {};
                } catch (_) {
                    const hit = info.items.find((i) => sameType(i) && i.name === info.name);
                    overwrite = hit ? (hit.isDesktopShortcut ? { overwriteId: hit.id } : { overwriteEntryId: hit.id }) : {};
                }
                if (host && typeof host.onSave === 'function') {
                    const ok = await host.onSave({ path: info.path, name: info.name, overwrite, workspaceId: info.workspaceId });
                    if (ok) settled();
                    return ok;
                }
                return saveRequestAsDesktopShortcut({
                    dest: 'vfs',
                    path: info.path,
                    name: info.name,
                    workspaceId: info.workspaceId,
                    overwriteId: overwrite.overwriteId || null,
                    overwriteEntryId: overwrite.overwriteEntryId || null
                });
            },
            async onPick(item, folder, ctl) {
                if (host && typeof host.onOpen === 'function') {
                    settled();
                    ctl.close();
                    await host.onOpen(item, folder);
                    return true;
                }
                if (host && typeof host.onOpenMany === 'function') {
                    settled();
                    ctl.close();
                    await host.onOpenMany([item], folder);
                    return true;
                }
                if (isImage(item)) {
                    const filename = item.previewImageFilename || item.targetId;
                    const name = item.shortcutType === 'image' ? ((item.shortcutData && item.shortcutData.filename) || filename) : filename;
                    ctl.close();
                    await studioOpenSessionFromImage(name, item.workspaceId);
                    return true;
                }
                if (item.shortcutType === 'request' || item.shortcutType === 'preset') {
                    const shortcut = { type: item.shortcutType, name: item.name, id: item.id, data: item.shortcutData || {} };
                    ctl.close();
                    if (item.shortcutType === 'request') await desktopShortcuts.handleRequestClick(shortcut);
                    else await desktopShortcuts.handlePresetClick(shortcut);
                    return true;
                }
                await message('Choose a picture, preset or saved session.');
                return false;
            },
            onCancel() {
                if (host && !host._settled && typeof host.onCancel === 'function') {
                    host._settled = true;
                    host.onCancel();
                }
            }
        });
    }

    function wrapStudio() {
        const orig = window.studioOpenFolderDialog;
        if (typeof orig !== 'function' || orig._wmFd) return !!(orig && orig._wmFd);
        const wrapped = function (mode, options) {
            return studioDialog(mode || 'save', options || {});
        };
        wrapped._wmFd = true;
        wrapped.desktop = orig;
        window.studioOpenFolderDialog = wrapped;
        return true;
    }

    /**
     * Studio's name dialogs (studioSession.js openStudioSaveNameDialog, #studioSaveNameModal): Save
     * As > New Preset / To Desktop, File > Save Preset, the session name and Open Preset, as WM's Save
     * As / Open with the desktop's own save, rename and open calls.
     */
    function studioNameDialog(mode) {
        /* global studioSessionPresetName, studioRenameSessionPreset, studioSaveFindDesktopRequest, handleManualSave, openManualModalWithContent */
        let current = '';
        try { current = studioSessionPresetName(); } catch (_) { current = ''; }
        if (mode === 'load-preset') {
            return show({
                kind: 'open',
                title: 'Open Preset',
                typeLabel: 'Presets',
                items: async () => {
                    const presets = (window.optionsData && Array.isArray(window.optionsData.presets)) ? window.optionsData.presets : [];
                    return presets.filter((p) => p && p.name).map((p) => ({ item: { id: `preset:${p.name}`, name: p.name, shortcutType: 'preset' }, path: '', label: 'Presets' }));
                },
                async onPick(item, _folder, ctl) {
                    ctl.close();
                    await openManualModalWithContent({ type: 'preset', name: item.name, title: item.name });
                    return true;
                }
            });
        }
        if (mode === 'rename') {
            return show({
                kind: 'save',
                title: 'Session Name',
                noFolder: true,
                noType: true,
                noLocation: true,
                okLabel: 'OK',
                suggestName: () => current,
                onSave: ({ name }) => studioRenameSessionPreset(name)
            });
        }
        if (mode === 'desktop') {
            return show({
                kind: 'save',
                title: 'Save to Desktop',
                folderFixed: 'Desktop',
                typeLabel: 'Studio Sessions',
                suggestName: () => current,
                async onSave({ name, workspaceId }) {
                    const existing = await studioSaveFindDesktopRequest(workspaceId, name);
                    return saveRequestAsDesktopShortcut({ name, workspaceId, overwriteId: existing ? existing.id : null });
                }
            });
        }
        return show({
            kind: 'save',
            title: 'Save Preset',
            noFolder: true,
            typeLabel: 'Presets',
            suggestName: () => (mode === 'preset-current' ? current : ''),
            onSave: ({ name, workspaceId }) => handleManualSave({ name, workspaceId })
        });
    }

    function wrapStudioName() {
        const orig = window.openStudioSaveNameDialog;
        if (typeof orig !== 'function' || orig._wmFd) return !!(orig && orig._wmFd);
        const wrapped = function (mode) { return studioNameDialog(mode || 'preset-new'); };
        wrapped._wmFd = true;
        wrapped.desktop = orig;
        window.openStudioSaveNameDialog = wrapped;
        return true;
    }

    // ---------------------------------------------------------------- Director: Attach File

    /** A picked file as a Director attachment (director.js explorerItemAttachment where it has it). */
    function attachmentOf(dir, item) {
        if (dir && typeof dir.explorerItemAttachment === 'function') {
            try { const a = dir.explorerItemAttachment(item); if (a) return a; } catch (_) { /* below */ }
        }
        if (item.targetKind === 'image' || item.targetKind === 'scrap') {
            const filename = item.previewImageFilename || item.targetId;
            return filename ? { source: 'workspace', filename, name: item.name || filename } : null;
        }
        if (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) {
            return { source: 'workspace', filename: item.shortcutData.filename, name: item.name || item.shortcutData.filename };
        }
        if (item.targetKind === 'reference') {
            const hash = item.targetId || item.previewHash;
            return hash ? { source: 'reference', hash, name: item.name || hash } : null;
        }
        if (item.targetKind === 'user-file') {
            const fileId = item.targetId || item.id;
            return fileId ? { source: 'vfs', fileId, name: item.name || 'file' } : null;
        }
        return null;
    }

    /** A file on the phone's own storage (the bridge's file URL) as a computer file for the Director. */
    async function phoneFileToFile(item) {
        const PS = window.phoneStorage;
        const url = PS && PS.fileUrl(item.phoneFile.root, item.phoneFile.path);
        if (!url) throw new Error('The phone did not give the file.');
        const res = await fetch(url);
        if (!res.ok) throw new Error('The phone did not give the file.');
        const blob = await res.blob();
        return new File([blob], item.name, { type: item.mimeType || blob.type || '' });
    }

    function attachDialog(input) {
        const dir = window.directorInstance || null;
        return show({
            kind: 'open',
            title: 'Attach File',
            appTitle: 'Director',
            typeLabel: 'All Files (*.*)',
            phone: true,
            accept: (i) => !!(i.phoneFile ? (Number(i.size) || 0) <= 8 * 1024 * 1024 : attachmentOf(dir, i)),
            extra: [{ label: 'Browse device...', action: () => { settle(dlg, 'done'); HTMLInputElement.prototype.click.call(input); } }],
            async onPick(item) {
                const d = window.directorInstance;
                if (!d) return true;
                if (item.phoneFile) {
                    const file = await phoneFileToFile(item);
                    if (typeof d.addComputerFiles === 'function') d.addComputerFiles([file]);
                    return true;
                }
                const a = attachmentOf(d, item);
                if (!a) { await message('This file cannot be attached.'); return false; }
                if (!Array.isArray(d.pendingAttachments)) d.pendingAttachments = [];
                const same = (x) => x && x.source === a.source && (x.filename || x.hash || x.fileId) === (a.filename || a.hash || a.fileId);
                if (!d.pendingAttachments.some(same)) d.pendingAttachments.push(a);
                if (typeof d.renderAttachChips === 'function') d.renderAttachChips();
                return true;
            }
        });
    }

    /** The Director's file input: Attach File (wmDirector.js, the attach menu) shows the WM Open dialog. */
    function wrapAttachInput() {
        const input = document.getElementById('directorAttachFileInput');
        if (!input) return false;
        if (input._wmFd) return true;
        input._wmFd = true;
        input.click = function () { void attachDialog(input); };
        return true;
    }

    // ---------------------------------------------------------------- app

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return false;
        ws.registerApp({
            id: APP_ID,
            title: 'Melaton Mobile',
            icon: 'app-programs',
            inStart: false,
            sip: true,
            mount,
            show(p) {
                page = p;
                render();
            },
            onBack: () => closeCombo(),
            hide() {
                closeCombo();
                // left for another app (Start menu, back): the dialog answers Cancel, as a WM dialog
                // never stays open behind another program
                if (dlg) settle(dlg, 'cancel', true);
                if (page) page.innerHTML = '';
            },
            softKeys
        });
        window.wmFileDialogs = {
            /** WM's Open dialog over the VFS: see show() for the options. */
            open: (opts) => show(Object.assign({}, opts, { kind: 'open' })),
            save: (opts) => show(Object.assign({}, opts, { kind: 'save' })),
            close: () => { if (dlg) settle(dlg, 'done'); },
            get isOpen() { return !!dlg; }
        };
        return true;
    }

    function init() {
        let tries = 0;
        const tick = () => {
            const a = ws || register();
            const b1 = wrapStudio();
            const b = wrapStudioName() && b1;
            const c = wrapAttachInput();
            if ((a && b && c) || ++tries > 120) return;
            setTimeout(tick, 500);
        };
        tick();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
})();
