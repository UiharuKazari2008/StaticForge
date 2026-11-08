/**
 * Melaton Mobile: Notes and Contacts, the Windows Mobile 6.1 Professional stock apps over
 * Dreamscape's notes and contact cards (Yozora #709). References: ~/.cache/wm61/ref-notes
 * (Device Emulator VGA, 2x; lengths below are halved).
 *
 * Notes (notes.exe):
 *   list         the folder bar (.wm-pv-bar): "All Folders" / a folder (here: a workspace's Notes)
 *                with its drop-down, the sort drop-down at the right (Sort By: Name, Date, Size,
 *                Type); rows 18 px: 16 px note icon (outres bmp 11071), bold name, the time
 *                ("8:20 a") for today else the date, the size ("504b"); the list field is the
 *                theme's white-to-tint gradient
 *   soft keys    New / Menu (View Recording Toolbar, Rename/Move..., Delete, Create Copy | Select
 *                All | Send..., Beam File... | Options...); tap-and-hold: the same rows as a popup
 *   note page    a white page with the typed text; ok saves and goes back to the list; the name of
 *                a new note is its first line (WM's own rule)
 *   delete       "Selected item(s) will be ... deleted. Do you want to continue?" (Yes / No, the
 *                warning icon); the note goes to the workspace's Recycle Bin like Explorer's delete
 * Store: the notes database (wsClient notes_*), listed through the VFS Notes folder of each
 * workspace (/Workspaces/<id>/Notes) so trashed and hidden notes stay out, as on the desktop.
 *
 * Contacts (poutlook.exe):
 *   list         "Enter a name..." search box (20 px, 1 px black frame) on the tab-strip tint, the
 *                letter tabs (#ab cde fgh ijk lmn opq rst uvw xyz, 17 px), rows 28 px: the card
 *                icon (outres bmp 8005 #11), bold "Last, First" and the default number with its
 *                letter (m / w / h / e); "Select New to create a new contact." when empty;
 *                "No matches: <text>" as a highlight bar when the search finds nothing
 *   card         the name (bold, 20 px band), rows 31 px with an icon: Call mobile / Send text
 *                message / Call work / Call home / Send e-mail ..., then the other fields; tabs
 *                Summary | Notes at the bottom; soft keys Call / Menu (Edit, View All Calls, Save
 *                to SIM, Send Text Message..., Send Contact >, Delete Contact | Add to Speed Dial...)
 *   edit         label column right-aligned to 74 px, fields from 78 px, rows 19.5 px with a grey
 *                rule; Name and the addresses open their parts with the drop arrow; tabs Details |
 *                Notes; ok saves
 *   delete       "Contact will be deleted. Continue?" (WM: "permanently deleted"; here the card goes
 *                to the Recycle Bin like Explorer's delete), Yes / No, the question icon
 * Store: the workspace's Contacts folder (/Workspaces/<id>/Contacts), one vCard per contact, read
 * and written with melatonVCard (vcard.js) like Explorer's Contacts folder and the contacts package.
 *
 * File Explorer opens notes and .vcf files here (wmFileExplorer.js openItem):
 *   window.wmNotesApp.openNote(noteId, workspaceId), window.wmContactsApp.openFile(item)
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Styles: public/css/wm-notes.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const ART = '/static_images/wm61/';
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const srcsetOf = (name) => (window.wmShell ? window.wmShell.art.srcset(name) : `${ART}${name}.png 1x, ${ART}${name}@2x.png 2x`);
    const icon = (name, cls = '') => `<img class="${cls}" src="${ART}${name}.png" srcset="${srcsetOf(name)}" alt="" draggable="false">`;
    const vfs = () => (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; // eslint-disable-line no-undef
    const wsc = () => window.wsClient || null;
    const VC = () => window.melatonVCard || null;

    let ws = null; // window.wmShell
    // WM's wait cursor (wmShell.busy) over work the user waits for: a note or card opening or saving
    const busyOf = (fn) => (ws && typeof ws.busy === 'function' ? ws.busy(fn) : fn());
    // the same held open by hand: the returned release ends it (idempotent)
    const busyHold = () => (ws && typeof ws.busy === 'function' ? ws.busy(true) : () => {});

    /** vcard.js comes with Explorer's feature on the desktop (featureLoader.js); the phone loads it alone. */
    let vcardLoading = null;
    function ensureVCard() {
        if (VC()) return Promise.resolve(true);
        if (!vcardLoading) {
            const fl = window.featureLoader;
            vcardLoading = (fl && typeof fl._loadScript === 'function'
                ? fl._loadScript('scripts/comp/vcard.js')
                : new Promise((resolve, reject) => {
                    const el = document.createElement('script');
                    el.src = '/scripts/comp/vcard.js';
                    el.onload = resolve;
                    el.onerror = reject;
                    document.body.appendChild(el);
                })).then(() => !!VC(), () => { vcardLoading = null; return false; });
        }
        return vcardLoading;
    }

    function activeWs() {
        try {
            // eslint-disable-next-line no-undef
            if (typeof activeWorkspace !== 'undefined' && activeWorkspace) return activeWorkspace;
        } catch (_) { /* not loaded */ }
        return 'default';
    }

    function workspaceList() {
        try {
            // eslint-disable-next-line no-undef
            if (typeof workspaces !== 'undefined' && workspaces) {
                // eslint-disable-next-line no-undef
                return Object.keys(workspaces).map((id) => ({ id, name: (workspaces[id] && workspaces[id].name) || id }));
            }
        } catch (_) { /* not loaded */ }
        return [{ id: activeWs(), name: activeWs() }];
    }

    function workspaceName(id) {
        const w = workspaceList().find((x) => x.id === id);
        return w ? w.name : id;
    }

    function readOnly() {
        try { return localStorage.getItem('userType') === 'readonly'; } catch (_) { return false; }
    }

    function store(key, value) {
        try { localStorage.setItem(key, value); } catch (_) { /* storage off */ }
    }

    function stored(key) {
        try { return localStorage.getItem(key); } catch (_) { return null; }
    }

    /** A layer changed: the shell's title-bar corner follows the app's titleKind(). */
    function refreshTitleKind() {
        if (ws && typeof ws.refreshTitleAction === 'function') ws.refreshTitleAction();
    }

    function errorBox(title, text, err) {
        return ws.messageBox({ title, icon: 'error', text: `${text}${err && err.message ? ` ${err.message}` : ''}` });
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    /** VFS item -> the reference moveToTrash takes (wmFileExplorer refsOf, one item). */
    function trashRef(i) {
        return {
            id: i.id, name: i.name, kind: i.kind, targetKind: i.targetKind, targetId: i.targetId,
            isShortcut: false, isUserFileLink: false, isDesktopShortcut: false, isVfsShortcutEntry: false,
            workspaceId: i.workspaceId, size: i.size, modifiedAt: i.modifiedAt, mimeType: i.mimeType || undefined
        };
    }

    function px() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1; }

    /** Tap-and-hold on rows: fn(row, x, y). Returns a function that says whether the last tap was a hold. */
    function onHold(el, selector, fn) {
        let timer = null;
        let start = null;
        let held = false;
        const clear = () => { clearTimeout(timer); timer = null; };
        el.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            held = false;
            const row = e.target.closest(selector);
            if (!row) return;
            start = { x: e.clientX, y: e.clientY };
            clear();
            timer = setTimeout(() => { held = true; fn(row, start.x, start.y); }, 550);
        });
        el.addEventListener('pointermove', (e) => {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8 * px()) clear();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => el.addEventListener(t, clear));
        el.addEventListener('contextmenu', (e) => {
            const row = e.target.closest(selector);
            if (!row) return;
            e.preventDefault();
            if (held) return;
            held = true;
            clear();
            fn(row, e.clientX, e.clientY);
        });
        // the click that ends a hold must not open the row nor close the menu just opened
        el.addEventListener('click', (e) => {
            if (!held) return;
            held = false;
            e.stopPropagation();
            e.preventDefault();
        }, true);
    }

    // ================================================================ Notes

    const Notes = (() => {
        const APP_ID = 'notes';
        const SORT_KEY = 'wmNotesSort';
        const FOLDER_KEY = 'wmNotesFolder';
        const SORTS = [['name', 'Name'], ['date', 'Date'], ['size', 'Size'], ['type', 'Type']];
        let page = null;
        let items = []; // { id (VFS id), noteId, name, size, modifiedAt, workspaceId, vfs }
        let selectedId = null;
        let loading = false;
        let listToken = 0;
        let sortField = SORTS.some(([k]) => k === stored(SORT_KEY)) ? stored(SORT_KEY) : 'name';
        let folder = stored(FOLDER_KEY) || 'active'; // 'active' | '*' | a workspace id
        let editing = null; // { noteId|null, workspaceId, name, original, saving: the save in flight }
        let pending = null; // a note to open once the app is shown

        const isCurrent = () => !!(ws && ws.current === APP_ID);
        const folderWs = () => (folder === 'active' ? activeWs() : folder);

        function folderLabel() {
            if (folder === '*') return 'All Folders';
            return workspaceName(folderWs());
        }

        // ---- formats

        function fmtWhen(sec) {
            let n = Number(sec);
            if (!n) return '';
            if (n < 1e12) n *= 1000;
            const d = new Date(n);
            const now = new Date();
            if (d.toDateString() === now.toDateString()) {
                const h = d.getHours();
                return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${h < 12 ? 'a' : 'p'}`;
            }
            return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
        }

        /** WM Notes' size column: 504b, 1.2k, 18k. */
        function fmtSize(b) {
            const n = Number(b) || 0;
            if (n < 1024) return `${n}b`;
            const k = n / 1024;
            if (k < 10) return `${k.toFixed(1)}k`;
            if (k < 1024) return `${Math.round(k)}k`;
            return `${(k / 1024).toFixed(1)}m`;
        }

        // ---- data

        async function listWorkspace(id) {
            const res = await vfs().listDirectory(`/Workspaces/${id}/Notes`, { offset: 0, limit: 1000, sortField: 'name', sortDirection: 'asc', search: '' });
            return ((res && res.items) || []).filter((i) => i.targetKind === 'note').map((i) => ({
                id: i.id, noteId: i.targetId, name: i.name, size: Number(i.size) || 0, modifiedAt: i.modifiedAt, workspaceId: i.workspaceId || id, vfs: i
            }));
        }

        function sortItems() {
            const by = {
                name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }),
                date: (a, b) => (Number(b.modifiedAt) || 0) - (Number(a.modifiedAt) || 0),
                size: (a, b) => b.size - a.size,
                type: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true })
            }[sortField];
            items.sort(by);
        }

        async function load(opts = {}) {
            if (!page) return;
            const token = ++listToken;
            loading = true;
            if (!opts.keep) { items = []; render(); }
            let list = [];
            let failed = '';
            try {
                if (!vfs()) throw new Error('The file system is not available.');
                const ids = folder === '*' ? workspaceList().map((w) => w.id) : [folderWs()];
                const parts = await Promise.all(ids.map((id) => listWorkspace(id).catch(() => [])));
                list = parts.flat();
            } catch (err) {
                failed = (err && err.message) || 'Cannot read the notes.';
            }
            if (token !== listToken) return;
            loading = false;
            items = list;
            sortItems();
            if (opts.select) {
                const hit = items.find((i) => i.noteId === opts.select);
                if (hit) selectedId = hit.id;
            }
            if (selectedId && !items.some((i) => i.id === selectedId)) selectedId = null;
            render(failed);
            if (isCurrent()) ws.refreshSoftKeys();
        }

        // ---- drawing

        function renderBar() {
            if (!page) return;
            page.querySelector('.nt-folder-name').textContent = folderLabel();
            const sortBtn = page.querySelector('.wm-pv-sort');
            if (sortBtn.getAttribute('aria-expanded') !== 'true') sortBtn.querySelector('span').textContent = (SORTS.find(([k]) => k === sortField) || SORTS[0])[1];
        }

        function render(failed) {
            if (!page) return;
            renderBar();
            const list = page.querySelector('.nt-list');
            list.innerHTML = items.map((i) => `<div class="nt-row${i.id === selectedId ? ' is-selected' : ''}" role="option" aria-selected="${i.id === selectedId}" data-id="${esc(i.id)}">`
                + `<span class="nt-ico">${icon('notes-note')}</span>`
                + `<span class="nt-name">${esc(i.name)}</span>`
                + `<span class="nt-date">${esc(fmtWhen(i.modifiedAt))}</span>`
                + `<span class="nt-size">${esc(fmtSize(i.size))}</span></div>`).join('');
            const empty = page.querySelector('.nt-empty');
            empty.textContent = failed || '';
            empty.hidden = !failed;
        }

        function selectRow(id) {
            selectedId = id;
            if (!page) return;
            page.querySelectorAll('.nt-row').forEach((r) => {
                const on = r.dataset.id === id;
                r.classList.toggle('is-selected', on);
                r.setAttribute('aria-selected', String(on));
            });
            if (isCurrent()) ws.refreshSoftKeys();
        }

        const itemById = (id) => items.find((i) => i.id === id) || null;
        const selectedItem = () => itemById(selectedId);

        // ---- the note page

        function showView(view) {
            page.querySelector('.nt-listview').hidden = view !== 'list';
            page.querySelector('.nt-noteview').hidden = view !== 'note';
            page.dataset.view = view;
            if (isCurrent()) {
                refreshTitleKind();
                ws.refreshSoftKeys();
            }
        }

        async function openNote(noteId, workspaceId, name) {
            const area = page.querySelector('.nt-text');
            editing = { noteId: noteId || null, workspaceId: workspaceId || folderWs(), name: name || '', original: '' };
            area.value = '';
            area.readOnly = !!noteId;
            showView('note');
            ws.syncHistory();
            if (noteId) {
                try {
                    const res = await busyOf(() => wsc().getNote(noteId));
                    const note = res && (res.note || (res.data && res.data.note));
                    if (!note) throw new Error('The note was not found.');
                    if (!editing || editing.noteId !== noteId) return;
                    editing.name = note.name || editing.name;
                    editing.workspaceId = note.workspace_id || note.workspaceId || editing.workspaceId;
                    editing.original = note.content || '';
                    area.value = editing.original;
                } catch (err) {
                    editing = null;
                    showView('list');
                    ws.syncHistory();
                    await errorBox('Notes', 'Cannot open the note.', err);
                    return;
                } finally {
                    area.readOnly = readOnly();
                }
            }
            area.readOnly = readOnly();
            area.setSelectionRange(area.value.length, area.value.length);
            area.focus({ preventScroll: true });
        }

        function nameFromText(text) {
            const first = String(text || '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';
            return first.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
        }

        function freeName() {
            const taken = new Set(items.map((i) => i.name.toLowerCase()));
            let n = 1;
            while (taken.has(`note${n}`)) n++;
            return `Note${n}`;
        }

        /**
         * Saves the page (ok, New, leaving the app). Resolves with the note id saved, or null.
         * Saves of one page run one after another (ed.saving): leaving the app starts a save without
         * waiting, and an ok right after must see the note that save created, not create it again.
         */
        function saveEditing() {
            if (!editing) return Promise.resolve(null);
            const ed = editing;
            const text = page.querySelector('.nt-text').value;
            if (readOnly()) return Promise.resolve(ed.noteId);
            const run = (ed.saving || Promise.resolve()).catch(() => {}).then(() => writeNote(ed, text));
            ed.saving = run;
            run.then(() => { if (ed.saving === run) ed.saving = null; }, () => { if (ed.saving === run) ed.saving = null; });
            return run;
        }

        async function writeNote(ed, text) {
            try {
                if (!ed.noteId) {
                    // an untouched new note is not kept (WM drops an empty note)
                    if (!text.trim()) return null;
                    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
                    const res = await wsc().createNote({ id, name: nameFromText(text) || freeName(), workspaceId: ed.workspaceId, content: text, icon: 'fas fa-file-lines', color: '#ffc107' });
                    if (!res || res.success === false) throw new Error('The note could not be created.');
                    ed.noteId = (res.note && res.note.id) || id;
                    ed.original = text;
                    return ed.noteId;
                }
                if (text !== ed.original) {
                    const res = await wsc().saveNoteContent(ed.noteId, text);
                    if (res && res.success === false) throw new Error('The note could not be saved.');
                    ed.original = text;
                }
                return ed.noteId;
            } catch (err) {
                await errorBox('Notes', 'The note could not be saved.', err);
                throw err;
            }
        }

        async function closeNote() {
            let id = null;
            try { id = await busyOf(() => saveEditing()); } catch (_) { return false; }
            editing = null;
            page.querySelector('.nt-text').blur();
            showView('list');
            ws.syncHistory();
            await load({ keep: true, select: id });
            return true;
        }

        async function newNote() {
            if (readOnly()) { await ws.messageBox({ title: 'Notes', icon: 'error', text: 'Notes cannot be created with a read-only account.' }); return; }
            if (editing) {
                try { await saveEditing(); } catch (_) { return; }
                editing = null;
            }
            await openNote(null, folder === '*' ? activeWs() : folderWs());
        }

        // ---- operations

        async function renameNote(i) {
            if (!i || readOnly()) return;
            const name = await ws.messageBox({
                title: 'Rename/Move', text: 'Name:', input: { value: i.name },
                buttons: [{ text: 'ok', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false
            });
            if (!name || name === i.name) return;
            try {
                const res = await busyOf(() => wsc().updateNote(i.noteId, { name }));
                if (res && res.success === false) throw new Error('');
            } catch (err) {
                await errorBox('Notes', 'The note could not be renamed.', err);
            }
            await load({ keep: true, select: i.noteId });
        }

        async function copyNote(i) {
            if (!i || readOnly()) return;
            try {
                const res = await busyOf(() => wsc().getNote(i.noteId));
                const note = res && res.note;
                if (!note) throw new Error('The note was not found.');
                const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(16)}`;
                const taken = new Set(items.map((x) => x.name.toLowerCase()));
                let name = `Copy of ${note.name}`;
                for (let n = 2; taken.has(name.toLowerCase()); n++) name = `Copy (${n}) of ${note.name}`;
                await busyOf(() => wsc().createNote({ id, name, workspaceId: note.workspace_id || i.workspaceId, content: note.content || '', icon: note.icon || 'fas fa-file-lines', color: note.color || '#ffc107' }));
                await load({ keep: true, select: id });
            } catch (err) {
                await errorBox('Notes', 'The note could not be copied.', err);
            }
        }

        async function deleteNote(i) {
            if (!i || readOnly()) return;
            // notes.exe's question (warning icon, No the default); the note goes to the Recycle Bin
            const yes = await ws.messageBox({
                title: 'Notes', icon: 'warning', text: 'Selected item(s) will be deleted. Do you want to continue?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false
            });
            if (!yes) return;
            try {
                await busyOf(() => vfs().moveToTrash([trashRef(i.vfs)], `/Workspaces/${i.workspaceId}/Notes`));
            } catch (err) {
                await errorBox('Notes', 'The note could not be deleted.', err);
            }
            if (editing && editing.noteId === i.noteId) { editing = null; showView('list'); ws.syncHistory(); }
            selectedId = null;
            await load({ keep: true });
        }

        function setSort(k) {
            sortField = k;
            store(SORT_KEY, k);
            sortItems();
            render();
        }

        function setFolder(f) {
            folder = f;
            store(FOLDER_KEY, f);
            selectedId = null;
            renderBar();
            load();
        }

        function itemRows(i) {
            const none = !i || readOnly();
            return [
                { label: 'Rename/Move...', disabled: none, action: () => renameNote(i) },
                { label: 'Delete', disabled: none, action: () => deleteNote(i) },
                { label: 'Create Copy', disabled: none, action: () => copyNote(i) },
                '-',
                { label: 'Select All', disabled: true },
                '-',
                { label: 'Send...', disabled: true },
                { label: 'Beam File...', disabled: true }
            ];
        }

        function listMenu() {
            return [{ label: 'View Recording Toolbar', disabled: true }, '-'].concat(itemRows(selectedItem()), ['-', { label: 'Options...', disabled: true }]);
        }

        function editCmd(cmd) {
            const area = page.querySelector('.nt-text');
            area.focus({ preventScroll: true });
            try { document.execCommand(cmd); } catch (_) { /* not supported */ }
        }

        async function paste() {
            const area = page.querySelector('.nt-text');
            try {
                const t = await navigator.clipboard.readText();
                area.focus({ preventScroll: true });
                area.setRangeText(t, area.selectionStart, area.selectionEnd, 'end');
            } catch (_) { editCmd('paste'); }
        }

        function zoom(scale) {
            page.querySelector('.nt-text').style.setProperty('--nt-zoom', String(scale));
            store('wmNotesZoom', String(scale));
        }

        function noteMenu() {
            const z = Number(stored('wmNotesZoom')) || 1;
            const ro = readOnly();
            const cur = editing && editing.noteId ? items.find((x) => x.noteId === editing.noteId) : null;
            return [
                { label: 'View Recording Toolbar', disabled: true },
                { label: 'Draw', disabled: true },
                '-',
                { label: 'Undo', disabled: ro, action: () => editCmd('undo') },
                { label: 'Redo', disabled: ro, action: () => editCmd('redo') },
                '-',
                { label: 'Cut', disabled: ro, action: () => editCmd('cut') },
                { label: 'Copy', action: () => editCmd('copy') },
                { label: 'Paste', disabled: ro, action: paste },
                { label: 'Edit', submenu: [{ label: 'Select All', action: () => { const a = page.querySelector('.nt-text'); a.focus(); a.select(); } }, { label: 'Clear All', disabled: ro, action: () => { page.querySelector('.nt-text').value = ''; } }] },
                '-',
                { label: 'Zoom', submenu: [[0.75, '75%'], [1, '100%'], [1.5, '150%'], [2, '200%'], [3, '300%']].map(([s, l]) => ({ label: l, radio: z === s, action: () => zoom(s) })) },
                { label: 'Tools', submenu: [
                    { label: 'Rename/Move...', disabled: !cur || ro, action: () => renameNote(cur).then(() => { if (editing) editing.name = (items.find((x) => x.noteId === editing.noteId) || {}).name || editing.name; }) },
                    { label: 'Delete', disabled: !cur || ro, action: () => deleteNote(cur) }
                ] }
            ];
        }

        // ---- page

        /**
         * live: another client (or the desktop Notepad) changed a note. The note_* types are taken by
         * 'only'-phase handlers (ws/handlers/80-notesInbound.js), so wsClient.on never sees them, and
         * only note_updated / note_deleted reach the document 'wsMessage' bridge; a 'pre' handler sees
         * all four. A rename or trash through the VFS comes as vfs_updated on the bridge.
         */
        let liveTimer = null;
        function liveChanged() {
            clearTimeout(liveTimer);
            liveTimer = setTimeout(() => {
                if (page && isCurrent() && page.dataset.view !== 'note') load({ keep: true });
            }, 250);
        }

        function liveRefresh() {
            if (typeof registerWsInboundHandler === 'function') { // eslint-disable-line no-undef
                // eslint-disable-next-line no-undef
                registerWsInboundHandler({
                    id: 'wm61.notes.live', type: 'note_created', alias: ['note_updated', 'note_deleted', 'note_content_updated'], phase: 'pre',
                    handler: liveChanged
                });
            }
            document.addEventListener('wsMessage', (e) => {
                const d = e.detail || {};
                if (d.type !== 'vfs_updated') return;
                const path = String((d.data && d.data.path) || '');
                if (!path || /\/Notes(\/|$)/i.test(path)) liveChanged();
            });
        }

        function mount(p) {
            page = p;
            p.classList.add('wm-notes');
            p.innerHTML = `
                <div class="nt-listview">
                    <div class="wm-pv-bar nt-bar">
                        <button type="button" class="wm-pv-folder nt-folder" aria-haspopup="menu" aria-expanded="false">${icon('notes-folders')}<span class="nt-folder-name">All Folders</span><i class="wm-pv-arrow"></i></button>
                        <button type="button" class="wm-pv-sort" aria-haspopup="menu" aria-expanded="false"><span>Name</span><i class="wm-pv-arrow"></i></button>
                    </div>
                    <div class="nt-scroll"><div class="nt-list" role="listbox" aria-label="Notes"></div><p class="nt-empty" hidden></p></div>
                </div>
                <div class="nt-noteview" hidden>
                    <textarea class="nt-text" spellcheck="false" autocapitalize="sentences" aria-label="Note"></textarea>
                </div>`;
            const z = Number(stored('wmNotesZoom'));
            if (z) p.querySelector('.nt-text').style.setProperty('--nt-zoom', String(z));

            const list = p.querySelector('.nt-scroll');
            onHold(list, '.nt-row', (row, x, y) => {
                selectRow(row.dataset.id);
                ws.menuAt(x, y, itemRows(itemById(row.dataset.id)));
            });
            list.addEventListener('click', (e) => {
                const row = e.target.closest('.nt-row');
                if (!row) return;
                selectRow(row.dataset.id);
                const i = itemById(row.dataset.id);
                if (i) openNote(i.noteId, i.workspaceId, i.name);
            });

            const folderBtn = p.querySelector('.nt-folder');
            folderBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // the drop-down reads "Show" while open, as on the device
                folderBtn.querySelector('.nt-folder-name').textContent = 'Show';
                folderBtn.setAttribute('aria-expanded', 'true');
                const cur = folder === '*' ? '*' : folderWs();
                const rows = [{ label: 'All Folders', radio: cur === '*', action: () => setFolder('*') }]
                    .concat(workspaceList().map((w) => ({ label: w.name, radio: cur === w.id, action: () => setFolder(w.id === activeWs() ? 'active' : w.id) })));
                ws.dropdown(folderBtn, rows, 'left', () => { folderBtn.setAttribute('aria-expanded', 'false'); renderBar(); });
            });
            const sortBtn = p.querySelector('.wm-pv-sort');
            sortBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                sortBtn.setAttribute('aria-expanded', 'true');
                sortBtn.querySelector('span').textContent = 'Sort By';
                ws.dropdown(sortBtn, SORTS.map(([k, l]) => ({ label: l, radio: sortField === k, action: () => setSort(k) })), 'right', () => { sortBtn.setAttribute('aria-expanded', 'false'); renderBar(); });
            });

            liveRefresh();
            renderBar();
        }

        return {
            register() {
                ws.registerApp({
                    id: APP_ID,
                    title: 'Notes',
                    icon: 'app-notes',
                    inStart: 'bottom',
                    sip: true,
                    mount,
                    show() {
                        showView(editing ? 'note' : 'list');
                        renderBar();
                        if (pending) {
                            const p = pending;
                            pending = null;
                            if (p.workspaceId && folder !== '*' && p.workspaceId !== folderWs()) { folder = '*'; renderBar(); }
                            load({ keep: true, select: p.noteId });
                            openNote(p.noteId, p.workspaceId, p.name);
                        } else if (!editing) load({ keep: items.length > 0 });
                    },
                    hide() {
                        // leaving the app keeps what was typed (WM saves on deactivate)
                        if (editing) saveEditing().catch(() => {});
                    },
                    // WM: X on the list (Smart Minimize), ok on a note (saves it, back to the list)
                    titleKind: () => (page && page.dataset.view === 'note' ? 'ok' : 'close'),
                    onTitleOk() {
                        if (!page || page.dataset.view !== 'note') return false;
                        closeNote();
                        return true;
                    },
                    historyDepth: () => (editing ? 1 : 0),
                    onBack() {
                        if (!editing) return false;
                        closeNote();
                        return true;
                    },
                    softKeys() {
                        if (page && page.dataset.view === 'note') return { left: { label: 'New', action: newNote }, right: { label: 'Menu', menu: noteMenu } };
                        return { left: { label: 'New', disabled: readOnly(), action: newNote }, right: { label: 'Menu', menu: listMenu } };
                    }
                });
            },
            /** File Explorer: a note of the Notes folder. */
            openNote(noteId, workspaceId, name) {
                if (!ws) return;
                if (editing) { saveEditing().catch(() => {}); editing = null; }
                pending = { noteId, workspaceId, name };
                ws.open(APP_ID);
            }
        };
    })();

    // ================================================================ Contacts

    const Contacts = (() => {
        const APP_ID = 'contacts';
        const GROUPS = ['#ab', 'cde', 'fgh', 'ijk', 'lmn', 'opq', 'rst', 'uvw', 'xyz'];
        const VIEW_KEY = 'wmContactsViewBy';
        let page = null;
        // one entry per person card: { c, key, fileId, index (of the card in its file), count (cards
        // in the file), fileName, item, path }. Rows are keyed by file and card index, not by UID: a
        // copied .vcf keeps its UID, and a UID match would open, edit or delete the other file.
        let entries = [];
        let loaded = false;
        let loadToken = 0;
        let search = '';
        let selectedKey = null;
        let group = null; // { at: index, letter }
        let viewBy = stored(VIEW_KEY) === 'company' ? 'company' : 'name';
        let layers = []; // 'card' | 'edit'
        let current = null; // the entry on the card / in the form
        let draft = null; // the card being edited
        let draftStart = ''; // the draft as the form opened, to tell a changed one
        let cardTab = 'summary';
        let editTab = 'details';
        let pending = null;

        const isCurrent = () => !!(ws && ws.current === APP_ID);
        const folderPath = () => `/Workspaces/${activeWs()}/Contacts`;
        const view = () => layers[layers.length - 1] || 'list';

        // ---- names

        function fileAs(c) {
            if (c.group) return VC().displayName(c);
            if (c.last && c.first) return `${c.last}, ${c.first}`;
            return c.last || c.first || VC().displayName(c);
        }

        function sortKey(e) {
            const k = viewBy === 'company' ? (e.c.work.company || fileAs(e.c)) : fileAs(e.c);
            return k.toLowerCase();
        }

        /** The row's second line: the default number (or address) and WM's letter for it. */
        function defaultComm(c) {
            if (c.home.mobile) return [c.home.mobile, 'm'];
            if (c.work.phone) return [c.work.phone, 'w'];
            if (c.home.phone) return [c.home.phone, 'h'];
            const mail = VC().email(c);
            if (mail) return [mail, 'e'];
            return ['', ''];
        }

        // ---- data

        async function readFile(item) {
            const id = item.targetId || item.id;
            const r = await vfs().downloadFile(id);
            const text = await (await fetch(r.downloadUrl, { credentials: 'same-origin' })).text();
            return { id, cards: VC().parseVcf(text) };
        }

        const keyOf = (fileId, index) => `${fileId}#${index}`;

        function makeEntry(c, fileId, index, count, item, path) {
            return { c, key: keyOf(fileId, index), fileId, index, count, fileName: item ? item.name : null, item, path };
        }

        /**
         * The card's place in its file, read again now: a file holds several cards (an address book
         * exported from another phone), and a write must keep the others.
         */
        async function reread(e) {
            const r = await readFile(e.item || { id: e.fileId });
            let at = r.cards[e.index] && r.cards[e.index].uid === e.c.uid ? e.index : r.cards.findIndex((x) => x.uid === e.c.uid);
            // a card without a UID line gets a new one on every read: then the same place in a file
            // of the same shape, holding the same name
            if (at < 0 && r.cards.length === e.count && r.cards[e.index] && VC().displayName(r.cards[e.index]) === VC().displayName(e.c)) at = e.index;
            if (at < 0 && r.cards.length === 1 && e.count === 1) at = 0;
            if (at < 0) throw new Error('The file was changed elsewhere; open the contact again.');
            return { cards: r.cards, at };
        }

        async function writeCards(fileId, cards) {
            const data = await blobToBase64(new Blob([cards.map((x) => VC().toVcf(x)).join('')], { type: 'text/vcard' }));
            await vfs().replaceFile(fileId, data, 'text/vcard');
        }

        async function load(opts = {}) {
            if (!page) return;
            const token = ++loadToken;
            let list = [];
            let failed = '';
            try {
                await ensureVCard();
                if (!vfs() || !VC()) throw new Error('Contacts are not available.');
                let files = [];
                try {
                    const res = await vfs().listDirectory(folderPath(), { offset: 0, limit: 1000, sortField: 'name', sortDirection: 'asc', search: '' });
                    files = ((res && res.items) || []).filter((i) => /\.vcf$/i.test(i.name || '') && i.kind !== 'folder');
                } catch (_) { files = []; } // no Contacts folder yet: no contacts
                const read = await Promise.all(files.map((f) => readFile(f).then((r) => ({ f, r })).catch(() => null)));
                for (const x of read) {
                    if (!x) continue;
                    x.r.cards.forEach((c, n) => {
                        if (c.group) return; // contact groups are a Vista thing; WM lists people
                        list.push(makeEntry(c, x.r.id, n, x.r.cards.length, x.f, folderPath()));
                    });
                }
            } catch (err) {
                failed = (err && err.message) || 'Cannot read the contacts.';
            }
            if (token !== loadToken) return;
            entries = list;
            loaded = true;
            sortEntries();
            if (opts.select) selectedKey = opts.select;
            if (opts.selectUid) { const hit = entries.find((e) => e.c.uid === opts.selectUid); if (hit) selectedKey = hit.key; }
            if (selectedKey && !entries.some((e) => e.key === selectedKey)) selectedKey = null;
            if (current && current.fileId) {
                // the same file and card only; a file opened from elsewhere is not swapped for a
                // Contacts card that happens to share its UID
                const again = entries.find((e) => e.key === current.key);
                if (again) current = again;
            }
            renderList(failed);
            if (view() === 'card') renderCard();
            if (isCurrent()) ws.refreshSoftKeys();
        }

        function sortEntries() {
            entries.sort((a, b) => sortKey(a).localeCompare(sortKey(b), undefined, { sensitivity: 'base', numeric: true }));
        }

        function matches(e, q) {
            if (!q) return true;
            const c = e.c;
            const words = [c.first, c.last, c.middle, c.nickname, c.work.company, VC().displayName(c)].join(' ').toLowerCase().split(/[\s,]+/).filter(Boolean);
            const ql = q.toLowerCase().trim();
            if (words.some((w) => w.startsWith(ql)) || VC().displayName(c).toLowerCase().startsWith(ql) || fileAs(c).toLowerCase().startsWith(ql)) return true;
            const digits = ql.replace(/\D/g, '');
            if (digits.length >= 2 && ql.replace(/[\d\s()+-]/g, '') === '') {
                return [c.home.mobile, c.home.phone, c.work.phone].some((n) => String(n || '').replace(/\D/g, '').includes(digits));
            }
            return VC().email(c).toLowerCase().startsWith(ql);
        }

        const visible = () => entries.filter((e) => matches(e, search));

        // ---- the list

        function renderList(failed) {
            if (!page) return;
            const listEl = page.querySelector('.ct-list');
            const shown = visible();
            const note = page.querySelector('.ct-note');
            const nomatch = page.querySelector('.ct-nomatch');
            nomatch.hidden = !(search && !shown.length && entries.length);
            nomatch.textContent = `No matches: ${search}`;
            note.hidden = !(!entries.length && loaded) && !failed;
            note.textContent = failed || 'Select New to create a new contact.';
            listEl.innerHTML = shown.map((e) => {
                const [num, kind] = defaultComm(e.c);
                const sel = e.key === selectedKey;
                const line1 = viewBy === 'company' && e.c.work.company ? `${e.c.work.company}` : fileAs(e.c);
                return `<div class="ct-row${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-key="${esc(e.key)}">`
                    + `<span class="ct-ico">${e.c.photo && /^data:image\//.test(e.c.photo) ? `<img src="${esc(e.c.photo)}" alt="">` : icon('contacts-card')}</span>`
                    + `<span class="ct-name">${esc(line1)}</span>`
                    + `<span class="ct-sub"><span class="ct-num">${esc(viewBy === 'company' && e.c.work.company ? fileAs(e.c) : num)}</span>${kind && viewBy !== 'company' ? `<span class="ct-kind">${esc(kind)}</span>` : ''}</span></div>`;
            }).join('');
            page.querySelectorAll('.ct-tab').forEach((t, n) => t.classList.toggle('is-selected', !!group && group.at === n));
        }

        function selectRow(key) {
            selectedKey = key;
            page.querySelectorAll('.ct-row').forEach((r) => {
                const on = r.dataset.key === key;
                r.classList.toggle('is-selected', on);
                r.setAttribute('aria-selected', String(on));
            });
            if (isCurrent()) ws.refreshSoftKeys();
        }

        function scrollToSelected() {
            const row = selectedKey && page.querySelector(`.ct-row[data-key="${CSS.escape(selectedKey)}"]`);
            if (row) row.scrollIntoView({ block: 'start' });
        }

        /** A letter tab: the first contact of its first letter; tapping again goes to the next letter. */
        function jumpTo(at) {
            const letters = GROUPS[at].split('');
            let start = 0;
            if (group && group.at === at) start = (letters.indexOf(group.letter) + 1) % letters.length;
            const shown = visible();
            for (let k = 0; k < letters.length; k++) {
                const L = letters[(start + k) % letters.length];
                const hit = shown.find((e) => {
                    const ch = sortKey(e).charAt(0);
                    return L === '#' ? !/[a-z]/.test(ch) : ch === L;
                });
                if (hit) {
                    group = { at, letter: L };
                    renderList();
                    selectRow(hit.key);
                    scrollToSelected();
                    return;
                }
            }
            group = { at, letter: letters[start] };
            renderList();
        }

        const entryByKey = (key) => entries.find((e) => e.key === key) || null;
        const selectedEntry = () => entryByKey(selectedKey);

        // ---- layers

        function showLayer() {
            const v = view();
            page.querySelector('.ct-listview').hidden = v !== 'list';
            page.querySelector('.ct-cardview').hidden = v !== 'card';
            page.querySelector('.ct-editview').hidden = v !== 'edit';
            page.dataset.view = v;
            if (isCurrent()) {
                refreshTitleKind();
                ws.refreshSoftKeys();
            }
        }

        function push(v) {
            layers.push(v);
            showLayer();
            ws.syncHistory();
        }

        function pop() {
            layers.pop();
            if (!layers.length) { current = null; draft = null; }
            showLayer();
            ws.syncHistory();
        }

        // ---- the card

        function openCard(e) {
            current = e;
            cardTab = 'summary';
            if (e.key) selectedKey = e.key;
            renderCard();
            push('card');
        }

        function cardRows(c) {
            const rows = [];
            const act = (ic, label, value, kind) => rows.push({ ic, label, value, kind });
            if (c.home.mobile) { act('contacts-mobile', 'Call mobile', c.home.mobile, 'call'); act('contacts-sms', 'Send text message', c.home.mobile, 'sms'); }
            if (c.work.phone) act('contacts-work', 'Call work', c.work.phone, 'call');
            if (c.home.phone) act('contacts-home', 'Call home', c.home.phone, 'call');
            c.emails.forEach((m) => act('contacts-email', 'Send e-mail', m, 'mail'));
            if (c.work.url) act('contacts-web', 'Go to web page', c.work.url, 'web');
            if (c.home.url) act('contacts-web', 'Go to web page', c.home.url, 'web');
            const info = (label, value) => { if (value) rows.push({ ic: null, label, value, kind: 'info' }); };
            info('Company', [c.work.title, c.work.department, c.work.company].filter(Boolean).join(', '));
            info('Work fax', c.work.fax);
            info('Home fax', c.home.fax);
            info('Pager', c.work.pager);
            info('Work address', addrText(c.work));
            info('Home address', addrText(c.home));
            info('Birthday', c.birthday);
            info('Anniversary', c.anniversary);
            info('Spouse', c.spouse);
            info('Children', c.children.join(', '));
            return rows;
        }

        function renderCard() {
            if (!page || !current) return;
            const c = current.c;
            const box = page.querySelector('.ct-cardview');
            box.querySelector('.ct-card-name').textContent = VC().displayName(c);
            const pic = box.querySelector('.ct-card-photo');
            pic.hidden = !(c.photo && /^data:image\//.test(c.photo));
            if (!pic.hidden) pic.src = c.photo;
            const rows = cardRows(c);
            box.querySelector('.ct-card-summary').innerHTML = rows.length
                ? rows.map((r, n) => `<div class="ct-crow${r.kind === 'info' ? ' is-info' : ''}" data-n="${n}" role="button" tabindex="-1">`
                    + `<span class="ct-crow-ico">${r.ic ? icon(r.ic) : ''}</span>`
                    + `<span class="ct-crow-label">${esc(r.label)}</span><span class="ct-crow-value">${esc(r.value)}</span></div>`).join('')
                : '<p class="ct-card-empty">Select Edit to add details to this contact.</p>';
            box.querySelector('.ct-card-notes').textContent = c.notes || '';
            box.querySelector('.ct-card-summary').hidden = cardTab !== 'summary';
            box.querySelector('.ct-card-notes').hidden = cardTab !== 'notes';
            box.querySelectorAll('.ct-btab').forEach((t) => t.classList.toggle('is-selected', t.dataset.tab === cardTab));
            const first = box.querySelector('.ct-crow:not(.is-info)');
            box.querySelectorAll('.ct-crow').forEach((r) => r.classList.toggle('is-selected', r === first));
        }

        async function noPhone(number) {
            await ws.messageBox({ title: 'Phone', icon: 'info', text: `Cannot call ${number}: this phone has no line to dial with.` });
        }

        async function runRow(r) {
            if (!r || r.kind === 'info') return;
            if (r.kind === 'call') { await noPhone(r.value); return; }
            if (r.kind === 'web') {
                const site = /^https?:/i.test(r.value) ? r.value : `http://${r.value}`;
                if (window.wmBrowser && window.wmBrowser.open(site)) return;
                window.open(site, '_blank', 'noopener');
                return;
            }
            // Messaging writes the message when it offers a compose entry point
            if (r.kind === 'mail' && typeof window.wmMessagingCompose === 'function') {
                window.wmMessagingCompose({ to: [r.value] });
                return;
            }
            await ws.messageBox({ title: 'Contacts', icon: 'info', text: r.kind === 'mail' ? `Messaging cannot write to ${r.value} yet.` : 'Text messages need a phone line.' });
        }

        function callDefault() {
            if (!current) return;
            const c = current.c;
            const n = c.home.mobile || c.work.phone || c.home.phone;
            if (n) noPhone(n);
        }

        // ---- the form

        const NAME_PARTS = [['prefix', 'Title'], ['first', 'First'], ['middle', 'Middle'], ['last', 'Last'], ['suffix', 'Suffix']];
        const ADDR_PARTS = [['street', 'Street'], ['city', 'City'], ['region', 'State'], ['postal', 'ZIP code'], ['country', 'Country/Region']];
        const FIELDS = [
            { key: 'name', label: 'Name', parts: NAME_PARTS },
            { key: 'picture', label: 'Picture' },
            { key: 'work.company', label: 'Company' },
            { key: 'work.department', label: 'Department' },
            { key: 'work.title', label: 'Job title' },
            { key: 'fileas', label: 'File as' },
            { key: 'work.phone', label: 'Work tel', type: 'tel' },
            { key: 'work.fax', label: 'Work fax', type: 'tel' },
            { key: 'work.addr', label: 'Work addr', parts: ADDR_PARTS, of: 'work' },
            { key: 'email.0', label: 'E-mail', type: 'email' },
            { key: 'home.mobile', label: 'Mobile tel', type: 'tel' },
            { key: 'work.url', label: 'Web page', type: 'url' },
            { key: 'work.office', label: 'Office loc.' },
            { key: 'home.phone', label: 'Home tel', type: 'tel' },
            { key: 'home.addr', label: 'Home addr', parts: ADDR_PARTS, of: 'home' },
            { key: 'home.fax', label: 'Home fax', type: 'tel' },
            { key: 'email.1', label: 'E-mail 2', type: 'email' },
            { key: 'email.2', label: 'E-mail 3', type: 'email' },
            { key: 'work.pager', label: 'Pager', type: 'tel' },
            { key: 'nickname', label: 'Nickname' },
            { key: 'birthday', label: 'Birthday', type: 'date' },
            { key: 'anniversary', label: 'Anniversary', type: 'date' },
            { key: 'spouse', label: 'Spouse' },
            { key: 'children', label: 'Children' }
        ];

        function addrText(a) {
            return [a.street, a.city, [a.region, a.postal].filter(Boolean).join(' '), a.country].filter(Boolean).join(', ');
        }

        function nameText(c) {
            return [c.prefix, c.first, c.middle, c.last, c.suffix].filter(Boolean).join(' ');
        }

        function getField(c, key) {
            if (key === 'name') return nameText(c);
            if (key === 'fileas') return fileAs(c);
            if (key === 'children') return c.children.join(', ');
            if (key === 'work.addr') return addrText(c.work);
            if (key === 'home.addr') return addrText(c.home);
            const [a, b] = key.split('.');
            if (a === 'email') return c.emails[Number(b)] || '';
            return b ? (c[a][b] || '') : (c[a] || '');
        }

        function setField(c, key, v) {
            if (key === 'children') { c.children = v.split(',').map((s) => s.trim()).filter(Boolean); return; }
            const [a, b] = key.split('.');
            if (a === 'email') {
                const list = [0, 1, 2].map((n) => (n === Number(b) ? v : (c.emails[n] || '')));
                c.emails = list.concat(c.emails.slice(3)).filter(Boolean);
                return;
            }
            if (b) c[a][b] = v; else c[a] = v;
        }

        /** "First Middle Last" typed in the Name box, split the way Pocket Outlook does. */
        function parseName(c, text) {
            const bits = text.trim().split(/\s+/).filter(Boolean);
            c.prefix = ''; c.suffix = '';
            c.first = bits.length ? bits[0] : '';
            c.last = bits.length > 1 ? bits[bits.length - 1] : '';
            c.middle = bits.length > 2 ? bits.slice(1, -1).join(' ') : '';
            c.fn = '';
        }

        function openForm(e) {
            current = e || null;
            draft = e ? JSON.parse(JSON.stringify(e.c)) : VC().blank();
            draftStart = JSON.stringify(draft);
            editTab = 'details';
            renderForm();
            push('edit');
            const first = page.querySelector('.ct-field[data-key="name"] input');
            if (first && !e) first.focus({ preventScroll: true });
        }

        function rowHtml(f, c) {
            const val = getField(c, f.key);
            const label = `<span class="ct-flabel">${esc(f.label)}:</span>`;
            if (f.key === 'picture') {
                return `<div class="ct-field is-static" data-key="picture">${label}<span class="ct-fstatic">${c.photo ? '(picture)' : 'Select a picture...'}</span></div>`;
            }
            if (f.key === 'fileas') {
                return `<div class="ct-field is-static" data-key="fileas">${label}<span class="ct-fstatic ct-fileas">${esc(c.first || c.last || c.fn ? fileAs(c) : '<Unnamed>')}</span></div>`;
            }
            const ro = !!f.of; // addresses are typed in their parts
            let html = `<div class="ct-field${f.parts ? ' has-parts' : ''}" data-key="${esc(f.key)}">${label}`
                + `<input type="${f.type === 'date' ? 'date' : (f.type || 'text')}" value="${esc(val)}"${ro ? ' readonly' : ''} autocomplete="off" aria-label="${esc(f.label)}">`
                + (f.parts ? '<button type="button" class="ct-fdrop" aria-label="More" aria-expanded="false"><i class="wm-pv-arrow"></i></button>' : '')
                + '</div>';
            if (f.parts) {
                const src = f.of ? c[f.of] : c;
                html += `<div class="ct-parts" data-for="${esc(f.key)}" hidden>${f.parts.map(([k, l]) => `<div class="ct-field ct-part" data-part="${esc(k)}"><span class="ct-flabel">${esc(l)}:</span><input type="text" value="${esc(src[k] || '')}" autocomplete="off" aria-label="${esc(l)}"></div>`).join('')}</div>`;
            }
            return html;
        }

        function renderForm() {
            const box = page.querySelector('.ct-editview');
            box.querySelector('.ct-form').innerHTML = FIELDS.map((f) => rowHtml(f, draft)).join('');
            box.querySelector('.ct-form-notes').value = draft.notes || '';
            syncEditTab();
        }

        function syncEditTab() {
            const box = page.querySelector('.ct-editview');
            box.querySelector('.ct-form').hidden = editTab !== 'details';
            box.querySelector('.ct-form-notes').hidden = editTab !== 'notes';
            box.querySelectorAll('.ct-btab').forEach((t) => t.classList.toggle('is-selected', t.dataset.tab === editTab));
        }

        function refreshComputed() {
            const box = page.querySelector('.ct-editview');
            const fa = box.querySelector('.ct-fileas');
            if (fa) fa.textContent = draft.first || draft.last || draft.fn ? fileAs(draft) : '<Unnamed>';
            for (const k of ['work.addr', 'home.addr']) {
                const inp = box.querySelector(`.ct-field[data-key="${k}"] > input`);
                if (inp) inp.value = getField(draft, k);
            }
            const nm = box.querySelector('.ct-field[data-key="name"] > input');
            if (nm && document.activeElement !== nm) nm.value = nameText(draft);
        }

        function onFormInput(e) {
            const inp = e.target;
            if (!inp || inp.tagName !== 'INPUT') return;
            const part = inp.closest('.ct-part');
            if (part) {
                const key = inp.closest('.ct-parts').dataset.for;
                const f = FIELDS.find((x) => x.key === key);
                const target = f.of ? draft[f.of] : draft;
                target[part.dataset.part] = inp.value.trim();
                if (!f.of) draft.fn = '';
                refreshComputed();
                return;
            }
            const row = inp.closest('.ct-field');
            const key = row && row.dataset.key;
            if (!key) return;
            if (key === 'name') {
                parseName(draft, inp.value);
                const parts = page.querySelector('.ct-parts[data-for="name"]');
                if (parts) NAME_PARTS.forEach(([k]) => { const p = parts.querySelector(`[data-part="${k}"] input`); if (p) p.value = draft[k] || ''; });
            } else setField(draft, key, inp.value.trim());
            refreshComputed();
        }

        function isEmptyCard(c) {
            return !nameText(c) && !c.fn && !c.emails.length && !c.notes && !c.nickname
                && !Object.values(c.home).some(Boolean) && !Object.values(c.work).some(Boolean) && !c.birthday && !c.spouse;
        }

        async function ensureFolder() {
            const parent = `/Workspaces/${activeWs()}`;
            const res = await vfs().listDirectory(parent, { offset: 0, limit: 500 });
            if (((res && res.items) || []).some((i) => i.name === 'Contacts' && (i.kind === 'folder' || i.targetKind === 'vfs-folder'))) return;
            await vfs().createFolder(parent, 'Contacts');
        }

        function fileNameOf(c) {
            return `${VC().displayName(c).replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80) || 'Contact'}.vcf`;
        }

        /** The form's notes are kept in the draft; true when the draft differs from what was opened. */
        function formChanged() {
            if (!draft || !page) return false;
            draft.notes = page.querySelector('.ct-editview .ct-form-notes').value;
            return JSON.stringify(draft) !== draftStart;
        }

        /** Leaves the form without saving (Cancel, or back on an unchanged form). */
        function discardForm(fromBack) {
            draft = null;
            if (!current) layers = [layers[0]];
            if (fromBack === true) { // the shell syncs history after onBack
                layers.pop();
                if (!layers.length) current = null;
                showLayer();
            } else pop();
            if (current && view() === 'card') renderCard();
        }

        /**
         * ok on the form: write the card (a new file in Contacts, or the card's own file with the
         * file's other cards kept). Resolves true once saved (or nothing to save), false otherwise.
         */
        let saving = null;
        function saveForm() {
            if (!saving) saving = busyOf(() => doSaveForm()).finally(() => { saving = null; });
            return saving;
        }

        async function doSaveForm() {
            if (!draft) return true;
            const ed = page.querySelector('.ct-editview');
            draft.notes = ed.querySelector('.ct-form-notes').value;
            if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
            if (!current && isEmptyCard(draft)) { discardForm(); return true; } // an untouched new contact is dropped
            if (readOnly()) { await ws.messageBox({ title: 'Contacts', icon: 'error', text: 'Contacts cannot be changed with a read-only account.' }); return false; }
            const c = draft;
            let selectKey = null;
            try {
                if (current && current.fileId) {
                    const { cards, at } = await reread(current);
                    cards[at] = c;
                    await writeCards(current.fileId, cards);
                    current = makeEntry(c, current.fileId, at, cards.length, current.item, current.path);
                    selectKey = current.key;
                } else {
                    const data = await blobToBase64(new Blob([VC().toVcf(c)], { type: 'text/vcard' }));
                    await ensureFolder();
                    const used = new Set(entries.map((x) => (x.fileName || '').toLowerCase()));
                    let name = fileNameOf(c);
                    for (let n = 2; used.has(name.toLowerCase()); n++) name = fileNameOf(c).replace(/\.vcf$/, ` (${n}).vcf`);
                    const res = await vfs().uploadFile(folderPath(), data, name, 'text/vcard');
                    const f = (res && (res.file || (res.data && res.data.file) || res.entry)) || null;
                    const fid = (f && (f.targetId || f.id || f.fileId)) || null;
                    current = fid ? makeEntry(c, fid, 0, 1, Object.assign({ name }, f), folderPath()) : { c, key: null, fileId: null, index: 0, count: 1, fileName: name, item: null, path: folderPath() };
                    selectKey = current.key;
                }
            } catch (err) {
                // wab32res 9107: what Vista says when a card cannot be written
                await errorBox('Contacts', 'Changes to this contact could not be saved.', err);
                return false;
            }
            if (window.explorerContacts && typeof window.explorerContacts.changed === 'function') { try { window.explorerContacts.changed(); } catch (_) { /* desktop not loaded */ } }
            draft = null;
            // a new contact shows its card after ok; an edit returns to the card
            if (layers.length === 1) { layers = ['card']; showLayer(); ws.syncHistory(); } else pop();
            cardTab = 'summary';
            renderCard();
            await load(selectKey ? { keep: true, select: selectKey } : { keep: true, selectUid: c.uid });
            return true;
        }

        async function deleteContact(e) {
            if (!e || readOnly()) return;
            const yes = await ws.messageBox({
                title: 'Contacts', icon: 'question', text: 'Contact will be deleted. Continue?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false
            });
            if (!yes) return;
            const done = busyHold();
            try {
                let trash = e.count <= 1;
                if (!trash) {
                    // one card of several: the file keeps the others
                    const { cards, at } = await reread(e);
                    cards.splice(at, 1);
                    if (cards.some((x) => !x.group)) await writeCards(e.fileId, cards);
                    else trash = true; // only group cards left: the file goes, as the last person did
                }
                if (trash) {
                    if (!e.item) throw new Error('The file of this contact is not known.');
                    await vfs().moveToTrash([trashRef(e.item)], e.path || folderPath());
                }
            } catch (err) {
                done();
                await errorBox('Contacts', 'The contact could not be deleted.', err);
                return;
            }
            done();
            if (layers.length) { layers = []; current = null; draft = null; showLayer(); ws.syncHistory(); }
            selectedKey = null;
            await load({ keep: true });
        }

        async function copyContact(e) {
            if (!e || readOnly()) return;
            const c = JSON.parse(JSON.stringify(e.c));
            c.uid = VC().blank().uid;
            const done = busyHold();
            try {
                const data = await blobToBase64(new Blob([VC().toVcf(c)], { type: 'text/vcard' }));
                await ensureFolder();
                const used = new Set(entries.map((x) => (x.fileName || '').toLowerCase()));
                let name = fileNameOf(c);
                for (let n = 2; used.has(name.toLowerCase()); n++) name = fileNameOf(c).replace(/\.vcf$/, ` (${n}).vcf`);
                await vfs().uploadFile(folderPath(), data, name, 'text/vcard');
                done();
            } catch (err) {
                done();
                await errorBox('Contacts', 'The contact could not be copied.', err);
            }
            await load({ keep: true, selectUid: c.uid });
        }

        function sendContactRows(e) {
            return [
                { label: 'Beam...', disabled: true },
                { label: 'E-mail...', disabled: !e || typeof window.wmMessagingCompose !== 'function', action: () => sendVcf(e) }
            ];
        }

        async function sendVcf(e) {
            if (!e || typeof window.wmMessagingCompose !== 'function') return;
            const text = VC().toVcf(e.c);
            const base64 = await blobToBase64(new Blob([text], { type: 'text/vcard' }));
            window.wmMessagingCompose({ subject: VC().displayName(e.c), attachments: [{ name: `${VC().displayName(e.c)}.vcf`, mimeType: 'text/vcard', size: text.length, base64 }] });
        }

        function listMenu() {
            const e = selectedEntry();
            const ro = readOnly();
            return [
                { label: 'Edit', disabled: !e || ro, action: () => openForm(e) },
                '-',
                { label: 'Send Contact', disabled: !e, submenu: () => sendContactRows(e) },
                { label: 'Copy Contact', disabled: !e || ro, action: () => copyContact(e) },
                { label: 'Delete Contact', disabled: !e || ro, action: () => deleteContact(e) },
                '-',
                { label: 'Options...', disabled: true },
                { label: 'View By', submenu: [['name', 'Name'], ['company', 'Company']].map(([k, l]) => ({ label: l, radio: viewBy === k, action: () => { viewBy = k; store(VIEW_KEY, k); sortEntries(); renderList(); } })) },
                { label: 'Filter', submenu: [{ label: 'All Contacts', radio: true }, { label: 'Recently Viewed', disabled: true }] }
            ];
        }

        function cardMenu() {
            const e = current;
            const ro = readOnly();
            return [
                { label: 'Edit', disabled: ro, action: () => openForm(e) },
                { label: 'View All Calls', disabled: true },
                { label: 'Save to SIM', disabled: true },
                { label: 'Send Text Message...', disabled: !(e && e.c.home.mobile), action: () => runRow({ kind: 'sms', value: e.c.home.mobile }) },
                { label: 'Send Contact', submenu: () => sendContactRows(e) },
                { label: 'Delete Contact', disabled: ro, action: () => deleteContact(e) },
                '-',
                { label: 'Add to Speed Dial...', disabled: true }
            ];
        }

        function formMenu() {
            return [
                { label: 'Cancel', action: () => discardForm() },
                '-',
                { label: 'Delete Contact', disabled: !current || readOnly(), action: () => deleteContact(current) }
            ];
        }

        // ---- page

        function mount(p) {
            page = p;
            p.classList.add('wm-contacts');
            p.innerHTML = `
                <div class="ct-listview">
                    <div class="ct-searchbar"><input class="ct-search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Enter a name..." aria-label="Enter a name"></div>
                    <div class="ct-tabs" role="tablist">${GROUPS.map((g, n) => `<button type="button" class="ct-tab" data-at="${n}">${esc(g)}</button>`).join('')}</div>
                    <div class="ct-nomatch" hidden></div>
                    <div class="ct-scroll"><div class="ct-list" role="listbox" aria-label="Contacts"></div><p class="ct-note" hidden></p></div>
                </div>
                <div class="ct-cardview" hidden>
                    <div class="ct-card-head"><span class="ct-card-name"></span><img class="ct-card-photo" alt="" hidden></div>
                    <div class="ct-card-body"><div class="ct-card-summary"></div><div class="ct-card-notes" hidden></div></div>
                    <div class="ct-btabs"><button type="button" class="ct-btab is-selected" data-tab="summary">Summary</button><button type="button" class="ct-btab" data-tab="notes">Notes</button></div>
                </div>
                <div class="ct-editview" hidden>
                    <div class="ct-form-body"><div class="ct-form"></div><textarea class="ct-form-notes" aria-label="Notes" hidden></textarea></div>
                    <div class="ct-btabs"><button type="button" class="ct-btab is-selected" data-tab="details">Details</button><button type="button" class="ct-btab" data-tab="notes">Notes</button></div>
                </div>`;

            const searchEl = p.querySelector('.ct-search');
            searchEl.addEventListener('input', () => {
                search = searchEl.value;
                group = null;
                renderList();
                const first = visible()[0];
                if (first) selectRow(first.key);
            });
            p.querySelector('.ct-tabs').addEventListener('click', (e) => {
                const t = e.target.closest('.ct-tab');
                if (t) jumpTo(Number(t.dataset.at));
            });
            const scroll = p.querySelector('.ct-scroll');
            onHold(scroll, '.ct-row', (row, x, y) => {
                selectRow(row.dataset.key);
                const en = entryByKey(row.dataset.key);
                ws.menuAt(x, y, [
                    { label: 'Edit', disabled: readOnly(), action: () => openForm(en) },
                    { label: 'Send Contact', submenu: () => sendContactRows(en) },
                    { label: 'Copy Contact', disabled: readOnly(), action: () => copyContact(en) },
                    { label: 'Delete Contact', disabled: readOnly(), action: () => deleteContact(en) }
                ]);
            });
            scroll.addEventListener('click', (e) => {
                const row = e.target.closest('.ct-row');
                if (!row) return;
                selectRow(row.dataset.key);
                const en = entryByKey(row.dataset.key);
                if (en) openCard(en);
            });

            const card = p.querySelector('.ct-cardview');
            card.querySelector('.ct-card-summary').addEventListener('click', (e) => {
                const r = e.target.closest('.ct-crow');
                if (!r || r.classList.contains('is-info')) return;
                card.querySelectorAll('.ct-crow').forEach((x) => x.classList.toggle('is-selected', x === r));
                runRow(cardRows(current.c)[Number(r.dataset.n)]);
            });
            card.querySelector('.ct-btabs').addEventListener('click', (e) => {
                const t = e.target.closest('.ct-btab');
                if (!t) return;
                cardTab = t.dataset.tab;
                renderCard();
            });

            const edit = p.querySelector('.ct-editview');
            edit.querySelector('.ct-form').addEventListener('input', onFormInput);
            edit.querySelector('.ct-form').addEventListener('click', (e) => {
                const drop = e.target.closest('.ct-fdrop') || (e.target.closest('.ct-field.has-parts input[readonly]'));
                if (!drop) return;
                const row = drop.closest('.ct-field');
                const parts = edit.querySelector(`.ct-parts[data-for="${CSS.escape(row.dataset.key)}"]`);
                if (!parts) return;
                parts.hidden = !parts.hidden;
                const btn = row.querySelector('.ct-fdrop');
                if (btn) btn.setAttribute('aria-expanded', String(!parts.hidden));
                if (!parts.hidden) { const f = parts.querySelector('input'); if (f) f.focus({ preventScroll: true }); }
            });
            edit.querySelector('.ct-btabs').addEventListener('click', (e) => {
                const t = e.target.closest('.ct-btab');
                if (!t) return;
                editTab = t.dataset.tab;
                syncEditTab();
            });
        }

        return {
            register() {
                ws.registerApp({
                    id: APP_ID,
                    title: 'Contacts',
                    icon: 'app-contacts',
                    inStart: 'top',
                    sip: true,
                    mount,
                    show() {
                        showLayer();
                        // File Explorer's file: openFile shows it once the page is up
                        if (pending) return;
                        load({ keep: loaded });
                    },
                    // WM: X on the list, ok on a contact card and on the edit form (ok saves the form)
                    titleKind: () => (view() === 'list' ? 'close' : 'ok'),
                    onTitleOk() {
                        const v = view();
                        if (v === 'edit') { saveForm(); return true; }
                        if (v === 'card') { pop(); return true; }
                        return false;
                    },
                    historyDepth: () => layers.length,
                    onBack() {
                        if (!layers.length) return false;
                        if (view() === 'edit') {
                            // back keeps what was typed, as ok does (and as Notes does)
                            if (formChanged()) saveForm();
                            else discardForm(true);
                            return true;
                        }
                        layers.pop();
                        if (!layers.length) { current = null; draft = null; }
                        showLayer();
                        if (view() === 'card') renderCard();
                        return true;
                    },
                    softKeys() {
                        const v = view();
                        if (v === 'card') {
                            const c = current && current.c;
                            return { left: { label: 'Call', disabled: !(c && (c.home.mobile || c.work.phone || c.home.phone)), action: callDefault }, right: { label: 'Menu', menu: cardMenu } };
                        }
                        if (v === 'edit') return { left: null, right: { label: 'Menu', menu: formMenu } };
                        return { left: { label: 'New', disabled: readOnly(), action: () => ensureVCard().then((ok) => { if (ok) openForm(null); }) }, right: { label: 'Menu', menu: listMenu } };
                    }
                });
            },
            /** File Explorer: a .vcf file (in Contacts or anywhere else). */
            async openFile(item, folder) {
                if (!ws || !item) return;
                const show = async () => {
                    // a half-done form is saved first, as Notes saves the open note
                    if (view() === 'edit' && formChanged() && !(await saveForm())) return;
                    const done = busyHold();
                    try {
                        await ensureVCard();
                        const r = await readFile(item);
                        done();
                        let at = r.cards.findIndex((x) => !x.group);
                        if (at < 0) at = 0;
                        const c = r.cards[at];
                        if (!c) throw new Error('The file holds no contact.');
                        const path = folder || null;
                        layers = [];
                        draft = null;
                        const e = makeEntry(c, r.id, at, r.cards.length, item, path);
                        openCard(e);
                        load({ keep: loaded, select: e.key });
                    } catch (err) {
                        done();
                        layers = [];
                        showLayer();
                        await errorBox('Contacts', `Cannot open '${item.name}'.`, err);
                        load({ keep: loaded });
                    }
                };
                if (ws.current === APP_ID) { show(); return; }
                pending = item;
                ws.open(APP_ID);
                pending = null;
                show();
            }
        };
    })();

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        Notes.register();
        Contacts.register();
    }

    window.wmNotesApp = { openNote: (id, wsId, name) => Notes.openNote(id, wsId, name) };
    window.wmContactsApp = { openFile: (item, folder) => Contacts.openFile(item, folder) };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
