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
 *   select all   every row highlighted; Delete and Rename/Move (the folder only) act on all of them;
 *                a tap on a row goes back to one
 *   rename/move  a form: Name, Folder (a workspace's Notes); ok renames and / or moves (#784)
 *   send         Messaging's new e-mail with the note attached as <name>.txt (#784)
 *   options      a form: Default template (Blank Note, Meeting Notes, Memo, Phone Memo, To Do; the
 *                typed text of each) and Save to (the folder new notes go to); ok keeps them (#784)
 *   note page    a white page with the typed text; ok saves and goes back to the list; the name of
 *                a new note is its first line (WM's own rule); New starts from the default template,
 *                and a template left as it was is not kept, like an empty note
 *   not here     Draw and the recording toolbar (no ink or voice store), Beam File (no IR)
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
    // Melaton Mobile 6.5 (Windows Mobile 6.5 Professional's Notes and Contacts, measured on its emulator)
    function is65() { return !!(ws && ws.version === '6.5') || document.documentElement.dataset.wmVersion === '6.5'; }

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
            timer = setTimeout(() => { held = true; fn(row, start.x, start.y); }, ((window.wmShell && window.wmShell.holdMs) || 550));
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
        const TEMPLATE_KEY = 'wmNotesTemplate';
        const SAVE_TO_KEY = 'wmNotesSaveTo';
        // #785: Writing (ink) / Typing as a new note's mode, the recording toolbar shown or not
        const MODE_KEY = 'wmNotesMode';
        const VOICEBAR_KEY = 'wmNotesVoiceBar';
        const RULE = 36.5; // units between the writing page's rules (device: 73 px at VGA)
        const PEN = 1.5; // the pen's width in units (device: 3 px at VGA)
        // notes.exe's templates in typing form: the device draws them as ink layouts; here the same
        // headings as text (Options > Default template)
        const TEMPLATES = [
            ['blank', 'Blank Note', ''],
            ['meeting', 'Meeting Notes', 'Meeting Notes\nSubject:\nDate:\nAttendees:\n\nNotes:\n\nAction items:\n'],
            ['memo', 'Memo', 'Memo\nTo:\nFrom:\nDate:\nSubject:\n\n'],
            ['phone', 'Phone Memo', 'Phone Memo\nFor:\nFrom:\nPhone:\nDate:\nTime:\n\nMessage:\n'],
            ['todo', 'To Do', 'To Do\n[ ] \n[ ] \n[ ] \n']
        ];
        let page = null;
        let items = []; // { id (VFS id), noteId, name, size, modifiedAt, workspaceId, vfs }
        let selectedId = null; // the row last tapped
        let selected = new Set(); // the highlighted rows (Select All highlights every one)
        let form = null; // the Rename/Move or Options form on screen: { kind, items, values }
        let loading = false;
        let listToken = 0;
        let sortField = SORTS.some(([k]) => k === stored(SORT_KEY)) ? stored(SORT_KEY) : 'name';
        let folder = stored(FOLDER_KEY) || 'active'; // 'active' | '*' | a workspace id
        let editing = null; // { noteId|null, workspaceId, name, original, template, saving: the save in flight }
        let pending = null; // a note to open once the app is shown
        const newestCache = { at: 0, ws: null, value: null, list: null, busy: false }; // Today's Notes item

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
                id: i.id, noteId: i.targetId, name: i.name, size: Number(i.size) || 0, modifiedAt: i.modifiedAt, workspaceId: i.workspaceId || id, vfs: i,
                kind: i.noteKind || 'note', ink: Number(i.noteInk) || 0, audio: Array.isArray(i.noteAudio) ? i.noteAudio : []
            }));
        }

        // a voice note (Record from the list): its own icon, its length in the size column ("6.3s")
        const isVoice = (i) => !!i && i.kind === 'voice';
        const fmtDur = (ms) => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)}s`;

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
            // an emptied list (a folder picked, the first open) is a wait: the wait cursor over it;
            // a refresh of the list on screen (keep) runs behind it
            const done = opts.keep ? () => {} : busyHold();
            try {
                if (!vfs()) throw new Error('The file system is not available.');
                const ids = folder === '*' ? workspaceList().map((w) => w.id) : [folderWs()];
                const parts = await Promise.all(ids.map((id) => listWorkspace(id).catch(() => [])));
                list = parts.flat();
            } catch (err) {
                failed = (err && err.message) || 'Cannot read the notes.';
            } finally {
                done();
            }
            if (token !== listToken) return;
            loading = false;
            items = list;
            sortItems();
            if (opts.select) {
                const hit = items.find((i) => i.noteId === opts.select);
                if (hit) { selectedId = hit.id; selected = new Set([hit.id]); }
            }
            if (selectedId && !items.some((i) => i.id === selectedId)) selectedId = null;
            selected = new Set([...selected].filter((id) => items.some((i) => i.id === id)));
            render(failed);
            if (isCurrent()) ws.refreshSoftKeys();
            renderVoicebar();
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
            list.setAttribute('aria-multiselectable', 'true');
            list.innerHTML = items.map((i) => `<div class="nt-row${selected.has(i.id) ? ' is-selected' : ''}" role="option" aria-selected="${selected.has(i.id)}" data-id="${esc(i.id)}">`
                + `<span class="nt-ico">${icon(isVoice(i) ? 'notes-recording' : 'notes-note')}</span>`
                + `<span class="nt-name">${esc(i.name)}</span>`
                + `<span class="nt-date">${esc(fmtWhen(i.modifiedAt))}</span>`
                + `<span class="nt-size">${esc(isVoice(i) ? fmtDur((i.audio[0] || {}).ms) : fmtSize(i.size))}</span></div>`).join('');
            const empty = page.querySelector('.nt-empty');
            empty.textContent = failed || '';
            empty.hidden = !failed;
        }

        function paintSelection() {
            if (!page) return;
            page.querySelectorAll('.nt-row').forEach((r) => {
                const on = selected.has(r.dataset.id);
                r.classList.toggle('is-selected', on);
                r.setAttribute('aria-selected', String(on));
            });
            if (isCurrent()) ws.refreshSoftKeys();
            renderVoicebar();
        }

        function selectRow(id) {
            selectedId = id;
            selected = new Set(id ? [id] : []);
            paintSelection();
        }

        /** Menu > Select All: every note in the list highlighted (WM keeps the first as the focus). */
        function selectAll() {
            selected = new Set(items.map((i) => i.id));
            if (!selected.has(selectedId)) selectedId = items.length ? items[0].id : null;
            paintSelection();
        }

        const itemById = (id) => items.find((i) => i.id === id) || null;
        const selectedItems = () => items.filter((i) => selected.has(i.id));

        // ---- the note page

        function showView(view) {
            page.querySelector('.nt-listview').hidden = view !== 'list';
            page.querySelector('.nt-noteview').hidden = view !== 'note';
            page.querySelector('.nt-formview').hidden = view !== 'form';
            const was = page.dataset.view;
            page.dataset.view = view;
            // another page: a playback ends and Play picks its target again (a form keeps both)
            if (was !== view && view !== 'form' && was !== 'form') {
                if (vb.mode === 'playing' || vb.mode === 'paused') vbHalt();
                vb.src = null;
                vb.latched = null;
                vb.pos = 0;
            }
            renderVoicebar();
            if (view === 'note') requestAnimationFrame(() => { fitPage(); paintInk(); });
            if (isCurrent()) {
                refreshTitleKind();
                ws.refreshSoftKeys();
            }
        }

        async function openNote(noteId, workspaceId, name) {
            const area = page.querySelector('.nt-text');
            const tpl = noteId ? '' : templateText();
            editing = {
                noteId: noteId || null, workspaceId: workspaceId || folderWs(), name: name || '', original: '', template: tpl,
                // #785: the page's strokes (page units), the redo stack, its recordings, Writing / Typing
                ink: { strokes: [] }, redo: [], inkChanged: false, audio: [], mode: noteId ? 'typing' : defaultMode()
            };
            area.value = tpl;
            area.readOnly = !!noteId;
            page.querySelector('.nt-pagewrap').scrollTop = 0;
            applyMode();
            paintInk();
            renderClips();
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
                    let ink = null;
                    try { ink = note.ink ? (typeof note.ink === 'string' ? JSON.parse(note.ink) : note.ink) : null; } catch (_) { ink = null; }
                    editing.ink = { strokes: (ink && Array.isArray(ink.strokes)) ? ink.strokes : [] };
                    editing.audio = (note.metadata && Array.isArray(note.metadata.audio)) ? note.metadata.audio : [];
                    // a page of ink with no typing opens in Writing, as it was made
                    editing.mode = editing.ink.strokes.length && !editing.original.trim() ? 'writing' : 'typing';
                    applyMode();
                    paintInk();
                    renderClips();
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
            area.readOnly = readOnly() || editing.mode === 'writing';
            if (editing.mode === 'writing') return;
            area.setSelectionRange(area.value.length, area.value.length);
            area.focus({ preventScroll: true });
        }

        // ---- Writing mode: ink on the ruled page (#785) ----

        const defaultMode = () => (stored(MODE_KEY) === 'typing' ? 'typing' : 'writing');
        const zoomOf = () => Number(stored('wmNotesZoom')) || 1;

        /** Writing: the rules, the pen on the page (no caret, no keyboard); Typing: the text box. */
        function applyMode() {
            if (!page) return;
            const writing = !!(editing && editing.mode === 'writing');
            page.classList.toggle('is-writing', writing);
            const area = page.querySelector('.nt-text');
            area.readOnly = readOnly() || writing;
            if (writing) area.blur();
            fitPage();
        }

        /**
         * The page (.nt-pagewrap) scrolls; the text box is as tall as its text, the screen, and in
         * Writing a screen past the lowest stroke, so there is always room to write further down.
         */
        function fitPage() {
            if (!page) return;
            const wrap = page.querySelector('.nt-pagewrap');
            const area = page.querySelector('.nt-text');
            const strokes = (editing && editing.ink.strokes) || [];
            let low = 0;
            strokes.forEach((st) => st.pts.forEach((pt) => { if (pt[1] > low) low = pt[1]; }));
            const writing = !!(editing && editing.mode === 'writing');
            const view = wrap.clientHeight;
            const top = wrap.scrollTop;
            area.style.height = '0px';
            const text = area.scrollHeight;
            const ink = low ? low * inkScale() + (writing ? view : view * 0.25) : 0;
            area.style.height = `${Math.ceil(Math.max(view, text, ink))}px`;
            wrap.scrollTop = top;
        }

        // Windows Journal's flags on a shared page (journal.js): its flag bitmaps
        const flagArt = {};
        function flagImage(color) {
            if (!flagArt[color]) {
                const im = new Image();
                im.src = `/static_images/vista-journal/flag-${['red', 'blue', 'green', 'orange', 'purple'].includes(color) ? color : 'red'}.png`;
                im.onload = () => paintInk();
                flagArt[color] = im;
            }
            return flagArt[color];
        }

        function drawStroke(ctx, st) {
            const pts = st.pts;
            if (!pts || !pts.length) return;
            if (st.tool === 'flag') {
                const im = flagImage(st.color);
                if (im.complete && im.naturalWidth) ctx.drawImage(im, pts[0][0], pts[0][1], 14.5, 14.5);
                return;
            }
            if (st.tool === 'highlighter') {
                // Journal's highlighter: see-through, square-ended
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.globalCompositeOperation = 'multiply';
                ctx.lineCap = 'square';
            }
            ctx.strokeStyle = st.color || '#000';
            ctx.lineWidth = Number(st.width) || PEN;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
            for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
            ctx.stroke();
            if (st.tool === 'highlighter') ctx.restore();
        }

        /**
         * Page units -> px: the phone writes 1 unit = 1 WM unit; a page drawn in Windows Journal (850
         * units across a Letter page) is shrunk to the phone's page width.
         */
        function inkScale() {
            const area = page.querySelector('.nt-text');
            const k = px() * zoomOf();
            const pageUnits = area.clientWidth / k;
            let right = 0;
            ((editing && editing.ink.strokes) || []).forEach((st) => st.pts.forEach((pt) => { if (pt[0] > right) right = pt[0]; }));
            return k * (right > pageUnits ? pageUnits / right : 1);
        }

        /** Redraws the strokes over the page as it is scrolled (page units * --wm-px * zoom). */
        function paintInk(live) {
            if (!page) return;
            const area = page.querySelector('.nt-text');
            const cv = page.querySelector('.nt-ink');
            const dpr = window.devicePixelRatio || 1;
            const w = area.offsetWidth;
            const h = area.offsetHeight;
            if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
                cv.width = Math.round(w * dpr);
                cv.height = Math.round(h * dpr);
                cv.style.width = `${w}px`;
                cv.style.height = `${h}px`;
            }
            const ctx = cv.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, cv.width, cv.height);
            const k = inkScale();
            ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            ((editing && editing.ink.strokes) || []).forEach((st) => drawStroke(ctx, st));
            if (live) drawStroke(ctx, live);
        }

        function inkPoint(e) {
            const area = page.querySelector('.nt-text');
            const r = area.getBoundingClientRect();
            const k = inkScale();
            return [Math.round(((e.clientX - r.left) / k) * 10) / 10, Math.round(((e.clientY - r.top) / k) * 10) / 10];
        }

        function bindInk(cv) {
            let live = null;
            cv.addEventListener('pointerdown', (e) => {
                if (!editing || editing.mode !== 'writing' || readOnly()) return;
                if (e.pointerType === 'mouse' && e.button !== 0) return;
                e.preventDefault();
                try { cv.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
                live = { tool: 'pen', color: '#000000', width: PEN, pts: [inkPoint(e)] };
                paintInk(live);
            });
            cv.addEventListener('pointermove', (e) => {
                if (!live) return;
                const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e];
                (events.length ? events : [e]).forEach((ev) => {
                    const pt = inkPoint(ev);
                    const last = live.pts[live.pts.length - 1];
                    if (Math.hypot(pt[0] - last[0], pt[1] - last[1]) >= 0.4) live.pts.push(pt);
                });
                paintInk(live);
            });
            const end = () => {
                if (!live) return;
                if (editing) {
                    editing.ink.strokes.push(live);
                    editing.redo = [];
                    editing.inkChanged = true;
                }
                live = null;
                fitPage();
                paintInk();
            };
            cv.addEventListener('pointerup', end);
            cv.addEventListener('pointercancel', end);
        }

        function undoInk() {
            if (!editing || !editing.ink.strokes.length) return;
            editing.redo.push(editing.ink.strokes.pop());
            editing.inkChanged = true;
            fitPage();
            paintInk();
        }

        function redoInk() {
            if (!editing || !editing.redo.length) return;
            editing.ink.strokes.push(editing.redo.pop());
            editing.inkChanged = true;
            fitPage();
            paintInk();
        }

        /** Menu > Draw: Writing <-> Typing for this page. */
        function toggleDraw() {
            if (!editing) return;
            editing.mode = editing.mode === 'writing' ? 'typing' : 'writing';
            applyMode();
            paintInk();
            if (editing.mode === 'typing' && !readOnly()) page.querySelector('.nt-text').focus({ preventScroll: true });
        }

        /** The note's recordings as speaker icons along the top of the page; a tap plays one. */
        function renderClips() {
            if (!page) return;
            const box = page.querySelector('.nt-clips-in');
            const list = (editing && editing.audio) || [];
            box.innerHTML = list.map((a, n) => `<button type="button" class="nt-clip" data-audio="${esc(a.id)}" style="left:calc(${4 + n * 30} * var(--wm-px))" aria-label="${esc(a.name || 'Recording')}">${icon('notes-speaker')}</button>`).join('');
            paintInk();
        }

        async function deleteClip(audioId) {
            if (!editing || !editing.noteId || readOnly()) return;
            const yes = await ws.messageBox({
                title: 'Notes', icon: 'warning', text: 'Selected item(s) will be deleted. Do you want to continue?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false
            });
            if (!yes || !editing) return;
            if (vb.src && vb.src.audioId === audioId) { vbHalt(); vb.src = null; }
            try {
                const res = await busyOf(() => wsc().deleteNoteAudio(editing.noteId, audioId));
                const data = res && (res.note ? res : res.data);
                editing.audio = (data && data.note && data.note.metadata && data.note.metadata.audio) || editing.audio.filter((a) => a.id !== audioId);
            } catch (err) {
                await errorBox('Notes', 'The recording could not be deleted.', err);
            }
            renderClips();
            renderVoicebar();
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

        /** A new note's name: its first line, made free in its folder ("Memo", "Memo (2)"). */
        function newName(text, workspaceId) {
            const base = nameFromText(text);
            if (!base) return freeName();
            const taken = new Set(items.filter((i) => i.workspaceId === workspaceId).map((i) => i.name.toLowerCase()));
            let name = base;
            for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n})`;
            return name;
        }

        const templateKey = () => (TEMPLATES.some(([k]) => k === stored(TEMPLATE_KEY)) ? stored(TEMPLATE_KEY) : 'blank');
        const templateText = () => (TEMPLATES.find(([k]) => k === templateKey()) || TEMPLATES[0])[2];

        /** Options > Save to: the folder new notes go to ('' = the folder on screen, else a workspace id). */
        function saveToWs() {
            const v = stored(SAVE_TO_KEY) || '';
            return v && workspaceList().some((w) => w.id === v) ? v : '';
        }

        /**
         * Saves the page (ok, New, leaving the app). Resolves with the note id saved, or null.
         * Saves of one page run one after another (ed.saving): leaving the app starts a save without
         * waiting, and an ok right after must see the note that save created, not create it again.
         */
        function saveEditing(force) {
            if (!editing) return Promise.resolve(null);
            const ed = editing;
            const text = page.querySelector('.nt-text').value;
            if (readOnly()) return Promise.resolve(ed.noteId);
            const run = (ed.saving || Promise.resolve()).catch(() => {}).then(() => writeNote(ed, text, force));
            ed.saving = run;
            run.then(() => { if (ed.saving === run) ed.saving = null; }, () => { if (ed.saving === run) ed.saving = null; });
            return run;
        }

        /** The page's strokes as stored (notes.ink), or null for none. */
        function inkOf(ed) {
            const strokes = (ed && ed.ink && ed.ink.strokes) || [];
            if (!strokes.length) return null;
            let h = 0;
            strokes.forEach((st) => st.pts.forEach((pt) => { if (pt[1] > h) h = pt[1]; }));
            return { v: 1, w: 240, h: Math.ceil(h), strokes };
        }

        /** force: keep a new page even untouched (a recording made on it needs the note). */
        async function writeNote(ed, text, force) {
            try {
                if (!ed.noteId) {
                    const ink = inkOf(ed);
                    // an untouched new note is not kept (WM drops an empty note, and a template left as it was)
                    if (!force && !ink && (!text.trim() || (ed.template && text === ed.template))) return null;
                    // one id per new page: a create whose answer was lost (the server restarting under
                    // it) may still have landed, so a retry looks for that note before creating another
                    if (!ed.newId) ed.newId = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
                    let landed = null;
                    if (ed.createTried) {
                        try {
                            const got = await wsc().getNote(ed.newId);
                            landed = got && (got.note || (got.data && got.data.note));
                        } catch (_) { /* not there: create it */ }
                    }
                    if (landed) {
                        ed.noteId = ed.newId;
                        ed.original = landed.content || '';
                    } else {
                        ed.createTried = true;
                        const res = await wsc().createNote({ id: ed.newId, name: newName(text, ed.workspaceId), workspaceId: ed.workspaceId, content: text, icon: 'fas fa-file-lines', color: '#ffc107', ink });
                        if (!res || res.success === false) throw new Error('The note could not be created.');
                        ed.noteId = (res.note && res.note.id) || ed.newId;
                        ed.original = text;
                        ed.inkChanged = false;
                        return ed.noteId;
                    }
                }
                if (ed.inkChanged) {
                    const res = await wsc().saveNoteInk(ed.noteId, inkOf(ed));
                    if (res && res.success === false) throw new Error('The drawing could not be saved.');
                    ed.inkChanged = false;
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
            if (vb.mode === 'recording') await vbStop();
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
            await openNote(null, saveToWs() || (folder === '*' ? activeWs() : folderWs()));
        }

        // ---- operations

        /**
         * Rename/Move... (notes.exe's form: Name, Folder): one note renames and / or moves to another
         * workspace's Notes; several (Select All) only move. Resolves when the form is closed.
         */
        function renameNote(list) {
            list = (Array.isArray(list) ? list : [list]).filter(Boolean);
            if (!list.length || readOnly()) return Promise.resolve(false);
            return openForm('move', list);
        }

        async function applyMove(list, values) {
            const one = list.length === 1;
            const name = one ? String(values.name || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() : '';
            if (one && !name) {
                await ws.messageBox({ title: 'Notes', icon: 'error', text: 'Enter a name for the note.' });
                return false;
            }
            const to = values.folder;
            const clash = one && items.some((x) => x !== list[0] && x.workspaceId === (to || list[0].workspaceId) && x.name.toLowerCase() === name.toLowerCase());
            if (clash) {
                await ws.messageBox({ title: 'Notes', icon: 'error', text: `A note named "${name}" already exists in that folder.` });
                return false;
            }
            try {
                await busyOf(async () => {
                    for (const i of list) {
                        const updates = {};
                        if (one && name !== i.name) updates.name = name;
                        if (to && to !== i.workspaceId) updates.workspace_id = to;
                        if (!Object.keys(updates).length) continue;
                        const res = await wsc().updateNote(i.noteId, updates);
                        if (res && res.success === false) throw new Error('');
                        if (editing && editing.noteId === i.noteId) {
                            if (updates.name) editing.name = updates.name;
                            if (updates.workspace_id) editing.workspaceId = updates.workspace_id;
                        }
                    }
                });
            } catch (err) {
                await errorBox('Notes', one ? 'The note could not be renamed or moved.' : 'The notes could not be moved.', err);
            }
            // a note moved out of the folder on screen leaves the list; All Folders keeps it
            await load({ keep: true, select: one ? list[0].noteId : undefined });
            return true;
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
                // the copy keeps the strokes and gets its own copies of the recordings (#785)
                const audio = (note.metadata && Array.isArray(note.metadata.audio)) ? note.metadata.audio : [];
                await busyOf(async () => {
                    await wsc().createNote({ id, name, workspaceId: note.workspace_id || i.workspaceId, content: note.content || '', icon: note.icon || 'fas fa-file-lines', color: note.color || '#ffc107', note_kind: note.note_kind === 'voice' ? 'voice' : undefined, ink: note.ink || null, metadata: audio.length ? { audio } : undefined });
                    if (audio.length) await wsc().copyNoteAudio(i.noteId, id);
                });
                await load({ keep: true, select: id });
            } catch (err) {
                await errorBox('Notes', 'The note could not be copied.', err);
            }
        }

        async function deleteNote(list) {
            list = (Array.isArray(list) ? list : [list]).filter(Boolean);
            if (!list.length || readOnly()) return;
            // notes.exe's question (warning icon, No the default); the notes go to the Recycle Bin
            const yes = await ws.messageBox({
                title: 'Notes', icon: 'warning', text: 'Selected item(s) will be deleted. Do you want to continue?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false
            });
            if (!yes) return;
            // one trash call per workspace (a Select All over All Folders spans several)
            const byWs = new Map();
            list.forEach((i) => { if (!byWs.has(i.workspaceId)) byWs.set(i.workspaceId, []); byWs.get(i.workspaceId).push(i); });
            try {
                await busyOf(async () => {
                    for (const [wsId, group] of byWs) await vfs().moveToTrash(group.map((i) => trashRef(i.vfs)), `/Workspaces/${wsId}/Notes`);
                });
            } catch (err) {
                await errorBox('Notes', list.length > 1 ? 'The notes could not be deleted.' : 'The note could not be deleted.', err);
            }
            if (editing && list.some((i) => i.noteId === editing.noteId)) { editing = null; showView('list'); ws.syncHistory(); }
            selectedId = null;
            selected = new Set();
            await load({ keep: true });
        }

        /** A page's strokes as a picture to send (white, at 2x). */
        function inkPng(strokes) {
            let w = 240;
            let h = 40;
            strokes.forEach((st) => st.pts.forEach((pt) => { if (pt[0] + 4 > w) w = pt[0] + 4; if (pt[1] + 4 > h) h = pt[1] + 4; }));
            const cv = document.createElement('canvas');
            cv.width = Math.ceil(w * 2);
            cv.height = Math.ceil(h * 2);
            const ctx = cv.getContext('2d');
            ctx.fillStyle = '#fff';
            ctx.fillRect(0, 0, cv.width, cv.height);
            ctx.scale(2, 2);
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            strokes.forEach((st) => drawStroke(ctx, st));
            return new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
        }

        /**
         * Send...: Messaging's new e-mail with the note: its typing as <name>.txt, its drawing as
         * <name>.png, each recording as its own file (#785); a voice note sends its recording.
         */
        async function sendNote(i) {
            if (!i || typeof window.wmMessagingCompose !== 'function') return;
            try {
                const own = editing && editing.noteId === i.noteId;
                const res = await busyOf(() => wsc().getNote(i.noteId));
                const note = res && (res.note || (res.data && res.data.note));
                if (!note) throw new Error('The note was not found.');
                const text = own ? page.querySelector('.nt-text').value : (note.content || '');
                let strokes = [];
                if (own) strokes = editing.ink.strokes;
                else {
                    try { const k = note.ink ? JSON.parse(note.ink) : null; strokes = (k && k.strokes) || []; } catch (_) { strokes = []; }
                }
                const audio = (note.metadata && Array.isArray(note.metadata.audio)) ? note.metadata.audio : [];
                const files = [];
                if (text.trim()) {
                    const blob = new Blob([text], { type: 'text/plain' });
                    files.push({ name: `${i.name}.txt`, mimeType: 'text/plain', size: blob.size, base64: await blobToBase64(blob) });
                }
                if (strokes.length) {
                    const png = await inkPng(strokes);
                    if (png) files.push({ name: `${i.name}.png`, mimeType: 'image/png', size: png.size, base64: await blobToBase64(png) });
                }
                for (const a of audio) {
                    const got = await busyOf(() => wsc().getNoteAudio(i.noteId, a.id));
                    const data = got && (got.base64 != null ? got : got.data);
                    if (!data || !data.base64) continue;
                    const ext = { 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/aac': 'aac' }[data.mime] || 'webm';
                    files.push({ name: `${audio.length === 1 && isVoice(i) ? i.name : (a.name || 'Recording')}.${ext}`, mimeType: data.mime, size: Math.floor(data.base64.length * 3 / 4), base64: data.base64 });
                }
                if (!files.length) {
                    const blob = new Blob([''], { type: 'text/plain' });
                    files.push({ name: `${i.name}.txt`, mimeType: 'text/plain', size: 0, base64: await blobToBase64(blob) });
                }
                window.wmMessagingCompose({ subject: i.name, attachments: files });
            } catch (err) {
                await errorBox('Notes', 'The note could not be sent.', err);
            }
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

        /** The rows for the highlighted notes (list: one or, after Select All, several). */
        function itemRows(list) {
            const ro = readOnly();
            const one = list.length === 1 ? list[0] : null;
            return [
                { label: 'Rename/Move...', disabled: !list.length || ro, action: () => renameNote(list) },
                { label: 'Delete', disabled: !list.length || ro, action: () => deleteNote(list) },
                { label: 'Create Copy', disabled: !one || ro, action: () => copyNote(one) },
                '-',
                { label: 'Select All', disabled: !items.length, action: selectAll },
                '-',
                { label: 'Send...', disabled: !one || typeof window.wmMessagingCompose !== 'function', action: () => sendNote(one) },
                { label: 'Beam File...', disabled: true }
            ];
        }

        function listMenu() {
            return [{ label: 'View Recording Toolbar', checked: vbShown(), action: toggleVoicebar }, '-'].concat(itemRows(selectedItems()), ['-', { label: 'Options...', action: () => openForm('options') }]);
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
            page.querySelector('.nt-clips').style.setProperty('--nt-zoom', String(scale));
            store('wmNotesZoom', String(scale));
            fitPage();
            paintInk();
        }

        /** Edit > Clear All: the typing and the strokes. */
        function clearAll() {
            page.querySelector('.nt-text').value = '';
            if (editing && editing.ink.strokes.length) {
                editing.redo = editing.ink.strokes.slice().reverse();
                editing.ink.strokes = [];
                editing.inkChanged = true;
                fitPage();
                paintInk();
            }
        }

        function noteMenu() {
            const z = Number(stored('wmNotesZoom')) || 1;
            const ro = readOnly();
            const cur = editing && editing.noteId ? items.find((x) => x.noteId === editing.noteId) : null;
            // Writing (device 03.png): Draw ticked, Undo Ink, the clipboard rows greyed; Tools as on the
            // device (Rename/Move..., Delete | Send..., Beam...)
            const writing = !!(editing && editing.mode === 'writing');
            const ink = editing ? editing.ink.strokes.length : 0;
            return [
                { label: 'View Recording Toolbar', checked: vbShown(), action: toggleVoicebar },
                { label: 'Draw', checked: writing, disabled: ro, action: toggleDraw },
                '-',
                writing
                    ? { label: 'Undo Ink', disabled: ro || !ink, action: undoInk }
                    : { label: 'Undo', disabled: ro, action: () => editCmd('undo') },
                writing
                    ? { label: 'Redo', disabled: ro || !(editing && editing.redo.length), action: redoInk }
                    : { label: 'Redo', disabled: ro, action: () => editCmd('redo') },
                '-',
                { label: 'Cut', disabled: ro || writing, action: () => editCmd('cut') },
                { label: 'Copy', disabled: writing, action: () => editCmd('copy') },
                { label: 'Paste', disabled: ro || writing, action: paste },
                { label: 'Edit', submenu: [
                    { label: 'Select All', disabled: writing, action: () => { const a = page.querySelector('.nt-text'); a.focus(); a.select(); } },
                    { label: 'Clear All', disabled: ro, action: clearAll }
                ] },
                '-',
                { label: 'Zoom', submenu: [[0.75, '75%'], [1, '100%'], [1.5, '150%'], [2, '200%'], [3, '300%']].map(([s, l]) => ({ label: l, radio: z === s, action: () => zoom(s) })) },
                { label: 'Tools', submenu: [
                    { label: 'Rename/Move...', disabled: !cur || ro, action: () => renameNote(cur) },
                    { label: 'Delete', disabled: !cur || ro, action: () => deleteNote(cur) },
                    '-',
                    { label: 'Send...', disabled: !cur || typeof window.wmMessagingCompose !== 'function', action: () => sendNote(cur) },
                    { label: 'Beam...', disabled: true }
                ] }
            ];
        }

        // ---- the recording toolbar (#785): View Recording Toolbar; notes.exe's voice bar ----
        // Record, Stop, Play (Pause while playing), the position slider, Previous / Next, volume.
        // Recording on a note's page attaches the recording to that note (a speaker on the page);
        // recording from the list makes a voice note ("Recording1"). Art: ~/.cache/wm61/ref-notes/ink.

        const vb = { mode: 'idle', latched: null, rec: null, audio: null, src: null, pos: 0, timer: null };
        const audioUrls = new Map(); // noteId/audioId -> object URL
        const vbShown = () => stored(VOICEBAR_KEY) === '1';

        function toggleVoicebar() {
            store(VOICEBAR_KEY, vbShown() ? '0' : '1');
            renderVoicebar();
        }

        function newAudioId() {
            return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        }

        /** What Play plays: the speaker last tapped on the page, the page's first, the voice note picked. */
        function vbTarget() {
            if (vb.src) return vb.src;
            if (page && page.dataset.view === 'note' && editing && editing.noteId && editing.audio.length) {
                const a = editing.audio[0];
                return { noteId: editing.noteId, audioId: a.id, ms: a.ms };
            }
            if (page && page.dataset.view === 'list') {
                const i = selectedItems().length === 1 ? selectedItems()[0] : null;
                if (isVoice(i) && i.audio.length) return { noteId: i.noteId, audioId: i.audio[0].id, ms: i.audio[0].ms };
            }
            return null;
        }

        /** The recordings Next steps through: the page's speakers, or the voice notes of the list. */
        function vbQueue() {
            if (page && page.dataset.view === 'note' && editing && editing.noteId) return editing.audio.map((a) => ({ noteId: editing.noteId, audioId: a.id, ms: a.ms }));
            return items.filter((i) => isVoice(i) && i.audio.length).map((i) => ({ noteId: i.noteId, audioId: i.audio[0].id, ms: i.audio[0].ms }));
        }

        function vbImg(name) {
            return `<img src="${ART}${name}.png" srcset="${ART}${name}.png 1x, ${ART}${name}@2x.png 2x" alt="" draggable="false">`;
        }

        function renderVoicebar() {
            if (!page) return;
            const bar = page.querySelector('.nt-voicebar');
            const view = page.dataset.view;
            const show = (vbShown() || vb.mode === 'recording' || vb.mode === 'playing') && view !== 'form';
            bar.hidden = !show;
            if (!show) return;
            const recOn = vb.mode === 'recording';
            const playing = vb.mode === 'playing';
            const paused = vb.mode === 'paused';
            const target = vbTarget();
            const canPlay = !recOn && !!target;
            const set = (key, art, { on = false, disabled = false } = {}) => {
                const b = bar.querySelector(`[data-vb="${key}"]`);
                b.innerHTML = vbImg(art);
                b.classList.toggle('is-latched', on);
                b.disabled = disabled;
            };
            set('rec', recOn ? 'notes-vb-rec-on' : 'notes-vb-rec', { on: recOn, disabled: readOnly() || playing });
            const stopOn = recOn || playing || paused;
            set('stop', vb.latched === 'stop' && !stopOn ? 'notes-vb-stop-latched' : (stopOn ? 'notes-vb-stop-on' : 'notes-vb-stop'), { on: vb.latched === 'stop' && !stopOn, disabled: !stopOn });
            set('play', playing ? 'notes-vb-pause' : (canPlay ? 'notes-vb-play-on' : 'notes-vb-play'), { disabled: !canPlay && !playing });
            const atStart = vb.pos <= 0.001;
            set('prev', !atStart && !recOn && (playing || paused || vb.latched === 'stop') ? 'notes-vb-prev-on' : 'notes-vb-prev', { disabled: atStart || recOn });
            set('next', playing || paused ? 'notes-vb-next-on' : 'notes-vb-next', { disabled: !(playing || paused) });
            set('vol', 'notes-vb-vol');
            bar.querySelector('.nt-vb-slider').style.setProperty('--nt-vb-pos', String(Math.max(0, Math.min(1, vb.pos))));
        }

        function vbTick(fn) {
            clearInterval(vb.timer);
            vb.timer = fn ? setInterval(fn, 100) : null;
        }

        async function audioUrl(src) {
            const key = `${src.noteId}/${src.audioId}`;
            if (audioUrls.has(key)) return audioUrls.get(key);
            const res = await busyOf(() => wsc().getNoteAudio(src.noteId, src.audioId));
            const data = res && (res.base64 != null ? res : res.data);
            if (!data || !data.base64) throw new Error('The recording was not found.');
            const bin = atob(data.base64);
            const bytes = new Uint8Array(bin.length);
            for (let n = 0; n < bin.length; n++) bytes[n] = bin.charCodeAt(n);
            const url = URL.createObjectURL(new Blob([bytes], { type: data.mime || 'audio/webm' }));
            audioUrls.set(key, url);
            return url;
        }

        async function vbRecord() {
            if (vb.mode === 'recording' || readOnly()) return;
            vbHalt();
            const md = navigator.mediaDevices;
            if (!md || typeof md.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') {
                await ws.messageBox({ title: 'Notes', icon: 'error', text: 'Cannot record. This device has no microphone available.' });
                return;
            }
            let stream;
            try {
                stream = await md.getUserMedia({ audio: true });
            } catch (err) {
                await ws.messageBox({ title: 'Notes', icon: 'error', text: 'Cannot record. Access to the microphone was refused.' });
                return;
            }
            const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'].find((m) => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) || '';
            let rec;
            try {
                rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
            } catch (err) {
                stream.getTracks().forEach((t) => t.stop());
                await errorBox('Notes', 'Cannot record.', err);
                return;
            }
            const chunks = [];
            rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
            rec.start(250);
            vb.rec = { rec, stream, chunks, t0: Date.now(), mime: rec.mimeType || mime || 'audio/webm', where: page.dataset.view === 'note' ? 'note' : 'list' };
            vb.mode = 'recording';
            vb.latched = null;
            vb.pos = 0;
            vbTick(() => { vb.pos = Math.min(1, (Date.now() - vb.rec.t0) / 60000); renderVoicebar(); });
            renderVoicebar();
        }

        /** Stop: ends a recording (and saves it) or the playback. */
        async function vbStop() {
            if (vb.mode === 'recording' && vb.rec) {
                const r = vb.rec;
                vb.rec = null;
                vbTick(null);
                await new Promise((resolve) => { r.rec.onstop = resolve; try { r.rec.stop(); } catch (_) { resolve(); } });
                r.stream.getTracks().forEach((t) => t.stop());
                vb.mode = 'idle';
                vb.pos = 0;
                renderVoicebar();
                const blob = new Blob(r.chunks, { type: r.mime });
                if (blob.size) await saveRecording(blob, Date.now() - r.t0, r.where);
                return;
            }
            if (vb.audio && (vb.mode === 'playing' || vb.mode === 'paused')) {
                vb.audio.pause();
                vb.audio.currentTime = 0;
                vb.mode = 'idle';
                vb.latched = 'stop';
                vb.pos = 0;
                vbTick(null);
                renderVoicebar();
            }
        }

        /** Leaving the app or the page: a recording is kept, a playback ends. */
        function vbHalt() {
            if (vb.mode === 'recording') { void vbStop(); return; }
            if (vb.audio) { vb.audio.pause(); vb.audio = null; }
            vb.mode = 'idle';
            vbTick(null);
        }

        function freeRecordingName(names) {
            const taken = new Set(names.map((n) => String(n).toLowerCase()));
            let n = 1;
            while (taken.has(`recording${n}`)) n++;
            return `Recording${n}`;
        }

        async function saveRecording(blob, ms, where) {
            const audioId = newAudioId();
            const done = busyHold();
            try {
                const base64 = await blobToBase64(blob);
                if (where === 'note' && editing) {
                    // the page becomes a note if it was not one yet (WM keeps a page with a recording)
                    const noteId = editing.noteId || await saveEditing(true);
                    if (!noteId || !editing) return;
                    const res = await wsc().putNoteAudio(noteId, { audioId, name: freeRecordingName(editing.audio.map((a) => a.name)), mime: blob.type, ms, base64 });
                    const data = res && (res.audio ? res : res.data);
                    editing.audio = (data && data.note && data.note.metadata && data.note.metadata.audio) || editing.audio.concat([{ id: audioId, ms }]);
                    vb.src = { noteId, audioId, ms };
                    renderClips();
                } else {
                    const wsId = saveToWs() || (folder === '*' ? activeWs() : folderWs());
                    const id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
                    const name = freeRecordingName(items.filter((i) => i.workspaceId === wsId).map((i) => i.name));
                    const res = await wsc().createNote({ id, name, workspaceId: wsId, content: '', note_kind: 'voice', icon: 'fas fa-microphone', color: '#ffc107' });
                    if (!res || res.success === false) throw new Error('');
                    await wsc().putNoteAudio(id, { audioId, name, mime: blob.type, ms, base64 });
                    vb.src = { noteId: id, audioId, ms };
                    await load({ keep: true, select: id });
                }
            } catch (err) {
                await errorBox('Notes', 'The recording could not be saved.', err);
            } finally {
                done();
                renderVoicebar();
            }
        }

        async function vbPlay(src) {
            if (vb.mode === 'recording') return;
            if (!src && vb.audio && vb.mode === 'playing') { vb.audio.pause(); vb.mode = 'paused'; vbTick(null); renderVoicebar(); return; }
            if (!src && vb.audio && vb.mode === 'paused') { void vb.audio.play(); vb.mode = 'playing'; vbWatch(); renderVoicebar(); return; }
            const target = src || vbTarget();
            if (!target) return;
            if (vb.audio) { vb.audio.pause(); vb.audio = null; }
            vb.src = target;
            let url;
            try { url = await audioUrl(target); } catch (err) { await errorBox('Notes', 'Cannot play the recording.', err); return; }
            const a = new Audio(url);
            a.volume = 1;
            vb.audio = a;
            a.onended = () => {
                if (vb.audio !== a) return;
                vb.mode = 'idle';
                vb.latched = 'stop';
                vb.pos = 1;
                vbTick(null);
                renderVoicebar();
            };
            try { await a.play(); } catch (err) { vb.audio = null; await errorBox('Notes', 'Cannot play the recording.', err); return; }
            vb.mode = 'playing';
            vb.latched = null;
            vbWatch();
            renderVoicebar();
        }

        function vbWatch() {
            const a = vb.audio;
            const len = () => (isFinite(a.duration) && a.duration > 0 ? a.duration : ((vb.src && vb.src.ms) || 1) / 1000);
            vbTick(() => { if (vb.audio === a) { vb.pos = a.currentTime / len(); renderVoicebar(); } });
        }

        function vbPrev() {
            if (vb.audio) vb.audio.currentTime = 0;
            vb.pos = 0;
            if (vb.mode === 'idle') vb.latched = null;
            renderVoicebar();
        }

        function vbNext() {
            if (!vb.audio || !vb.src) return;
            const q = vbQueue();
            const at = q.findIndex((x) => x.noteId === vb.src.noteId && x.audioId === vb.src.audioId);
            if (at >= 0 && at < q.length - 1) { void vbPlay(q[at + 1]); return; }
            if (isFinite(vb.audio.duration)) vb.audio.currentTime = vb.audio.duration;
        }

        function vbSeek(e) {
            if (!vb.audio || !isFinite(vb.audio.duration)) return;
            const track = page.querySelector('.nt-vb-track').getBoundingClientRect();
            const f = Math.max(0, Math.min(1, (e.clientX - track.left) / track.width));
            vb.audio.currentTime = f * vb.audio.duration;
            vb.pos = f;
            renderVoicebar();
        }

        function bindVoicebar(bar) {
            bar.addEventListener('click', (e) => {
                const b = e.target.closest('button[data-vb]');
                if (!b || b.disabled) return;
                const k = b.dataset.vb;
                if (k === 'rec') void vbRecord();
                else if (k === 'stop') void vbStop();
                else if (k === 'play') void vbPlay();
                else if (k === 'prev') vbPrev();
                else if (k === 'next') vbNext();
                else if (k === 'vol' && ws && typeof ws.volumeBubble === 'function') ws.volumeBubble(b);
            });
            const slider = bar.querySelector('.nt-vb-slider');
            slider.addEventListener('pointerdown', (e) => {
                if (!vb.audio) return;
                e.preventDefault();
                try { slider.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
                vbSeek(e);
                const move = (ev) => vbSeek(ev);
                const up = () => { slider.removeEventListener('pointermove', move); slider.removeEventListener('pointerup', up); };
                slider.addEventListener('pointermove', move);
                slider.addEventListener('pointerup', up);
            });
        }

        // ---- forms: Rename/Move..., Options... (#784)

        function openForm(kind, list = []) {
            if (!page) return Promise.resolve(false);
            if (form) closeForm(false);
            return new Promise((resolve) => {
                const wsOf = new Set(list.map((i) => i.workspaceId));
                form = {
                    kind, items: list, from: page.dataset.view, resolve,
                    values: kind === 'move'
                        ? { name: list.length === 1 ? list[0].name : '', folder: wsOf.size === 1 ? [...wsOf][0] : '' }
                        : { mode: defaultMode(), template: templateKey(), saveTo: saveToWs() }
                };
                renderForm();
                if (form.from === 'note') page.querySelector('.nt-text').blur();
                showView('form');
                ws.syncHistory();
                const name = page.querySelector('.nt-form [data-f="name"]');
                if (name) { name.focus({ preventScroll: true }); name.select(); }
            });
        }

        /**
         * The device's forms (~/.cache/wm61/ref-notes/ink 17-options.png, 19-rename.png): labels at
         * the left, the fields in a column at their right, 24.5- / 25-unit rows; Rename/Move lists
         * the item's Size, Modified and Format under its fields. Location and Record button action
         * are the device's (one memory, no record button here): shown, greyed.
         */
        function renderForm() {
            const f = form;
            const box = page.querySelector('.nt-formview');
            const combo = (act, label, disabled) => `<button type="button" class="wm-combo" data-act="${act}"${disabled ? ' disabled' : ''}><span>${esc(label)}</span></button>`;
            const row = (label, field, cls = '') => `<div class="nt-frow${cls}"><span class="nt-flabel">${label}</span>${field}</div>`;
            if (f.kind === 'move') {
                const one = f.items.length === 1 ? f.items[0] : null;
                const fmt = one && isVoice(one) ? 'Recording' : 'Note';
                box.innerHTML = `<div class="wm-form-hdr">Rename/Move</div><div class="wm-set-scroll"><div class="nt-form is-move">`
                    + (one ? row('<label for="ntFormName">Name:</label>', `<input id="ntFormName" class="wm-edit" type="text" data-f="name" maxlength="60" autocomplete="off" spellcheck="false" value="${esc(f.values.name)}">`) : '')
                    + row('Folder:', combo('folder', f.values.folder ? workspaceName(f.values.folder) : ''))
                    + row('Location:', combo('location', 'Main memory'))
                    + (one ? `<div class="nt-facts">${row('Size:', `<span>${esc(isVoice(one) ? fmtDur((one.audio[0] || {}).ms) : fmtSize(one.size))}</span>`)}${row('Modified:', `<span>${esc(fmtWhen(one.modifiedAt))}</span>`)}${row('Format:', `<span>${fmt}</span>`)}</div>` : '')
                    + `</div></div>`;
            } else {
                const tpl = (TEMPLATES.find(([k]) => k === f.values.template) || TEMPLATES[0])[1];
                box.innerHTML = `<div class="wm-form-hdr">Options</div><div class="wm-set-scroll"><div class="nt-form is-options">`
                    + row('Default mode:', combo('mode', f.values.mode === 'typing' ? 'Typing' : 'Writing'))
                    + row('Default template:', combo('template', tpl))
                    + row('Save to:', combo('saveTo', f.values.saveTo ? workspaceName(f.values.saveTo) : 'Current folder'))
                    + `<div class="nt-fblock"><span class="nt-flabel">Record button action:</span>${combo('record', 'Switch to Notes', true)}</div>`
                    + `<a href="#" class="nt-flink" data-act="input">Global Input Options</a>`
                    + `</div></div>`;
            }
            const name = box.querySelector('[data-f="name"]');
            if (name) name.addEventListener('input', () => { f.values.name = name.value; });
            const link = box.querySelector('[data-act="input"]');
            if (link) link.addEventListener('click', (e) => { e.preventDefault(); if (window.wmSettings && typeof window.wmSettings.open === 'function') window.wmSettings.open('input'); });
            box.querySelectorAll('.wm-combo').forEach((b) => b.addEventListener('click', (e) => {
                e.stopPropagation();
                if (b.disabled) return;
                const act = b.dataset.act;
                const pick = (v) => { f.values[act] = v; renderForm(); };
                let rows;
                if (act === 'folder') rows = workspaceList().map((w) => ({ label: w.name, radio: f.values.folder === w.id, action: () => pick(w.id) }));
                else if (act === 'location') rows = [{ label: 'Main memory', radio: true, action: () => {} }];
                else if (act === 'mode') rows = [['writing', 'Writing'], ['typing', 'Typing']].map(([k, l]) => ({ label: l, radio: f.values.mode === k, action: () => pick(k) }));
                else if (act === 'template') rows = TEMPLATES.map(([k, l]) => ({ label: l, radio: f.values.template === k, action: () => pick(k) }));
                else rows = [{ label: 'Current folder', radio: !f.values.saveTo, action: () => pick('') }].concat(workspaceList().map((w) => ({ label: w.name, radio: f.values.saveTo === w.id, action: () => pick(w.id) })));
                ws.dropdown(b, rows, 'left');
            }));
        }

        /** ok (apply) or Cancel / back: the form goes and the list or the note comes back. */
        async function closeForm(apply) {
            const f = form;
            if (!f) return;
            if (apply) {
                if (f.kind === 'move') {
                    if (f.busy) return;
                    f.busy = true;
                    const ok = await applyMove(f.items, f.values).finally(() => { f.busy = false; });
                    if (!ok || form !== f) return;
                } else {
                    store(MODE_KEY, f.values.mode);
                    store(TEMPLATE_KEY, f.values.template);
                    store(SAVE_TO_KEY, f.values.saveTo || '');
                }
            }
            form = null;
            page.querySelector('.nt-formview').innerHTML = '';
            showView(f.from === 'note' && editing ? 'note' : 'list');
            ws.syncHistory();
            f.resolve(!!apply);
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
                    <div class="nt-pagewrap">
                        <textarea class="nt-text" spellcheck="false" autocapitalize="sentences" aria-label="Note"></textarea>
                        <canvas class="nt-ink" aria-hidden="true"></canvas>
                        <div class="nt-clips"><div class="nt-clips-in"></div></div>
                    </div>
                </div>
                <div class="nt-formview" hidden></div>
                <div class="nt-voicebar" role="toolbar" aria-label="Recording" hidden>
                    <button type="button" class="nt-vb" data-vb="rec" aria-label="Record"></button>
                    <button type="button" class="nt-vb" data-vb="stop" aria-label="Stop"></button>
                    <button type="button" class="nt-vb" data-vb="play" aria-label="Play"></button>
                    <div class="nt-vb-slider" role="slider" aria-label="Position"><span class="nt-vb-track"></span>${vbImg('notes-vb-thumb').replace('<img ', '<img class="nt-vb-thumb" ')}</div>
                    <button type="button" class="nt-vb" data-vb="prev" aria-label="Previous"></button>
                    <button type="button" class="nt-vb" data-vb="next" aria-label="Next"></button>
                    <button type="button" class="nt-vb" data-vb="vol" aria-label="Volume"></button>
                </div>`;
            const z = Number(stored('wmNotesZoom'));
            if (z) {
                p.querySelector('.nt-text').style.setProperty('--nt-zoom', String(z));
                p.querySelector('.nt-clips').style.setProperty('--nt-zoom', String(z));
            }
            // #785: the ink over the page follows its scrolling and size; the speakers play
            const area = p.querySelector('.nt-text');
            area.addEventListener('input', () => { fitPage(); paintInk(); });
            if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (p.dataset.view === 'note') { fitPage(); paintInk(); } }).observe(p.querySelector('.nt-pagewrap'));
            bindInk(p.querySelector('.nt-ink'));
            const clips = p.querySelector('.nt-clips');
            onHold(clips, '.nt-clip', (b, x, y) => {
                const id = b.dataset.audio;
                ws.menuAt(x, y, [
                    { label: 'Play', action: () => editing && editing.noteId && vbPlay({ noteId: editing.noteId, audioId: id, ms: ((editing.audio.find((a) => a.id === id)) || {}).ms }) },
                    { label: 'Delete', disabled: readOnly(), action: () => deleteClip(id) }
                ]);
            });
            clips.addEventListener('click', (e) => {
                const b = e.target.closest('.nt-clip');
                if (!b || !editing || !editing.noteId) return;
                const a = editing.audio.find((x) => x.id === b.dataset.audio);
                if (a) void vbPlay({ noteId: editing.noteId, audioId: a.id, ms: a.ms });
            });
            bindVoicebar(p.querySelector('.nt-voicebar'));

            const list = p.querySelector('.nt-scroll');
            onHold(list, '.nt-row', (row, x, y) => {
                // a hold on a highlighted row keeps the highlight (after Select All: every note)
                if (!selected.has(row.dataset.id)) selectRow(row.dataset.id);
                ws.menuAt(x, y, itemRows(selectedItems()));
            });
            list.addEventListener('click', (e) => {
                const row = e.target.closest('.nt-row');
                if (!row) return;
                selectRow(row.dataset.id);
                const i = itemById(row.dataset.id);
                // a voice note plays where it is (the toolbar comes up for it), as on the device
                if (isVoice(i)) { if (i.audio.length) void vbPlay({ noteId: i.noteId, audioId: i.audio[0].id, ms: i.audio[0].ms }); return; }
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
                        showView(form ? 'form' : (editing ? 'note' : 'list'));
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
                        // leaving the app keeps a recording and ends a playback
                        vbHalt();
                        // leaving the app keeps what was typed (WM saves on deactivate)
                        if (editing) saveEditing().catch(() => {});
                    },
                    // WM: X on the list (Smart Minimize), ok on a note (saves it, back to the list)
                    titleKind: () => (page && (page.dataset.view === 'note' || page.dataset.view === 'form') ? 'ok' : 'close'),
                    onTitleOk() {
                        if (page && page.dataset.view === 'form') { closeForm(true); return true; }
                        if (!page || page.dataset.view !== 'note') return false;
                        closeNote();
                        return true;
                    },
                    historyDepth: () => (editing ? 1 : 0) + (form ? 1 : 0),
                    onBack() {
                        if (form) { closeForm(false); return true; }
                        if (!editing) return false;
                        closeNote();
                        return true;
                    },
                    softKeys() {
                        // the device's Options and Rename/Move have no soft keys: ok saves, back leaves
                        if (page && page.dataset.view === 'form') return { left: null, right: null };
                        if (page && page.dataset.view === 'note') return { left: { label: 'New', action: newNote }, right: { label: 'Menu', menu: noteMenu } };
                        return { left: { label: 'New', disabled: readOnly(), action: newNote }, right: { label: 'Menu', menu: listMenu } };
                    }
                });
            },
            /** File Explorer: a note of the Notes folder. */
            openNote(noteId, workspaceId, name) {
                if (!ws) return;
                if (form) closeForm(false);
                if (editing) { saveEditing().catch(() => {}); editing = null; }
                pending = { noteId, workspaceId, name };
                ws.open(APP_ID);
            },
            /**
             * Today's Notes row (wmTodayWidgets.js): the newest note of the active workspace
             * ({ name, noteId, workspaceId, modifiedAt } or false), null before the first answer;
             * listed again after 2 minutes or a workspace switch.
             */
            newest() {
                const wsId = activeWs();
                if (!newestCache.busy && vfs() && (newestCache.ws !== wsId || Date.now() - newestCache.at > 120000)) {
                    newestCache.busy = true;
                    let ok = false;
                    listWorkspace(wsId).then((list) => {
                        ok = true;
                        const slim = list.map((i) => ({ name: i.name, noteId: i.noteId, workspaceId: i.workspaceId, modifiedAt: i.modifiedAt }));
                        const top = slim.reduce((a, b) => ((Number(b.modifiedAt) || 0) > (Number(a && a.modifiedAt) || 0) ? b : a), null);
                        newestCache.value = top || false;
                        newestCache.list = slim;
                    }).catch(() => { if (newestCache.ws !== wsId) { newestCache.value = null; newestCache.list = null; } /* else keeps the last answer */ }).finally(() => { newestCache.busy = false; newestCache.at = ok ? Date.now() : Date.now() - 105000; newestCache.ws = wsId; }); // a failure (early in boot) retries in 15 s
                }
                return newestCache.ws === wsId ? newestCache.value : null;
            },
            /** Today's Notes item: every note of the active workspace (same cache as newest()), null before the first answer. */
            list() {
                const v = this.newest();
                return v == null ? null : (newestCache.list || []);
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
            // the first read of the Contacts folder is a wait (the list is empty until it comes)
            const done = loaded ? () => {} : busyHold();
            try {
                await ensureVCard();
                if (!vfs() || !VC()) throw new Error('Contacts are not available.');
                let files = [];
                try {
                    const res = await vfs().listDirectory(folderPath(), { offset: 0, limit: 1000, sortField: 'name', sortDirection: 'asc', search: '' });
                    files = ((res && res.items) || []).filter((i) => /\.vcf$/i.test(i.name || '') && i.kind !== 'folder');
                } catch (_) { files = []; } // no Contacts folder yet: no contacts
                // this phone's own mirror file (Synchronize) is shown live from the phone instead
                const pdm = window.wmPhoneData;
                if (pdm && pdm.live('contacts')) files = files.filter((f) => !pdm.isOwnMirror(f.name));
                const read = await Promise.all(files.map((f) => readFile(f).then((r) => ({ f, r })).catch(() => null)));
                for (const x of read) {
                    if (!x) continue;
                    x.r.cards.forEach((c, n) => {
                        if (c.group) return; // contact groups are a Vista thing; WM lists people
                        list.push(makeEntry(c, x.r.id, n, x.r.cards.length, x.f, folderPath()));
                    });
                }
                // the phone's own contacts, live: every field, the photo, edited and deleted on the
                // phone itself (ActiveSync > Phone Data: Show or Synchronize; #776 / #778)
                if (pdm && pdm.live('contacts')) list.push(...pdm.contactEntries(VC()));
            } catch (err) {
                failed = (err && err.message) || 'Cannot read the contacts.';
            } finally {
                done();
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
                    + `<span class="ct-ico">${e.c.photo && (/^data:image\//.test(e.c.photo) || /^https:\/\/appassets\.androidplatform\.net\/contact-photo\//.test(e.c.photo)) ? `<img src="${esc(e.c.photo)}" alt="" loading="lazy">` : icon('contacts-card')}</span>`
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
            loadPersonaState(e);
        }

        function cardRows(c) {
            const rows = [];
            const act = (ic, label, value, kind) => rows.push({ ic, label, value, kind });
            if (c.home.mobile) { act('contacts-mobile', 'Call mobile', c.home.mobile, 'call'); act('contacts-sms', 'Send text message', c.home.mobile, 'sms'); }
            else if (canText(c) && !textAddress(c)) act('contacts-sms', 'Send text message', 'Dreamscape Messenger', 'sms');
            if (c.work.phone) act('contacts-work', 'Call work', c.work.phone, 'call');
            if (c.home.phone) act('contacts-home', 'Call home', c.home.phone, 'call');
            // an address can take text messages too (iMessage) when a Text Messaging account is set up (#779)
            c.emails.forEach((m) => { act('contacts-email', 'Send e-mail', m, 'mail'); if (tmAccounts().length && !c.chatId) act('contacts-sms', 'Send text message', m, 'sms'); });
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
            // a chat persona's card (#763): its state as the server has it, read when the card opens
            if (c.chatId && !c.group) {
                const st = personaStates.get(String(c.chatId));
                if (c.chatDeleted || (st && st.exists === false)) info('Chat', 'Deleted');
                else if (st) {
                    // a row cut short opens whole when tapped
                    const full = (label, value) => { if (value) rows.push({ ic: null, label, value, kind: 'info', full: true }); };
                    personaInfoRows(st).forEach(([label, value]) => full(label, value));
                    (st.memories || []).slice(0, 3).forEach((m) => full('Memory', m.content));
                }
            }
            return rows;
        }

        // ---- chat personas (#763)

        const personaStates = new Map(); // chatId -> get_chat_persona_state's state

        function personaInfoRows(st) {
            const rows = [];
            const add = (label, value) => { if (value) rows.push([label, value]); };
            add('Feeling', st.emotion ? `${st.emotion}${st.emotionIntensity != null ? ` (${st.emotionIntensity}%)` : ''}` : '');
            add('Trust', st.trust ? `${st.trust}${st.trustValue != null ? ` (${st.trustValue}/100)` : ''}` : (st.trustValue != null ? `${st.trustValue}/100` : ''));
            add('Location', st.location);
            add('Time of day', st.timeOfDay);
            add('Surroundings', st.environment);
            add('Plan', st.currentPlan);
            add('Later', st.futurePlans);
            add('Carrying', st.inventory);
            if (st.lastSeen) {
                const d = new Date(st.lastSeen);
                if (!Number.isNaN(d.getTime())) add('Last seen', `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
            }
            return rows;
        }

        /** Read the persona's state for the card on show; the card is drawn again when it comes. */
        function loadPersonaState(e) {
            const c = e && e.c;
            if (!c || !c.chatId || c.group || c.chatDeleted || !wsc() || typeof wsc().sendMessage !== 'function') return;
            const id = Number(c.chatId);
            if (!Number.isInteger(id) || id <= 0) return;
            Promise.resolve(wsc().sendMessage('get_chat_persona_state', { chatId: id }, false)).then((r) => {
                const st = r && (r.state || (r.data && r.data.state));
                if (!st) return;
                personaStates.set(String(c.chatId), st);
                if (current === e && view() === 'card') renderCard();
            }).catch(() => { /* the card shows what it has */ });
        }

        function renderCard() {
            if (!page || !current) return;
            const c = current.c;
            const box = page.querySelector('.ct-cardview');
            box.querySelector('.ct-card-name').textContent = VC().displayName(c);
            const pic = box.querySelector('.ct-card-photo');
            const hasPhoto = !!(c.photo && (/^data:image\//.test(c.photo) || /^https:\/\/appassets\.androidplatform\.net\/contact-photo\//.test(c.photo)));
            pic.hidden = !hasPhoto && !is65();
            pic.removeAttribute('srcset');
            if (hasPhoto) pic.src = c.photo;
            else if (is65()) {
                // 6.5: a contact with no picture shows the device's own picture frame
                pic.src = '/static_images/wm65/pim-contact-picture.png';
                pic.srcset = '/static_images/wm65/pim-contact-picture.png 1x, /static_images/wm65/pim-contact-picture@2x.png 2x, /static_images/wm65/pim-contact-picture@4x.png 4x';
            }
            pic.classList.toggle('is-frame', !hasPhoto);
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
            // 6.5: with nothing to call or write to, the name band holds the highlight
            box.querySelector('.ct-card-head').classList.toggle('is-selected', !first);
            box.querySelectorAll('.ct-btab').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === cardTab)));
        }

        /** Text Messaging accounts (#779, wmTextMessaging.js): the list as last read, connected ones first. */
        function tmAccounts() {
            const T = window.wmTextMessaging;
            let list = [];
            try { list = T && typeof T.accounts === 'function' ? T.accounts() || [] : []; } catch (_) { list = []; }
            return list.filter((a) => a.status === 'connected').concat(list.filter((a) => a.status !== 'connected'));
        }

        /** Where a text to the contact goes: the mobile number, else (with a Text Messaging account) the first e-mail address. */
        function textAddress(c) {
            if (!c) return '';
            if (c.home && c.home.mobile) return c.home.mobile;
            // a chat persona's card keeps opening Dreamscape Messenger
            if (c.chatId) return '';
            return tmAccounts().length && c.emails && c.emails.length ? c.emails[0] : '';
        }

        /** The Text Messaging account to write from: the first connected one, or the choice when several are. */
        async function pickTmAccount() {
            const list = tmAccounts();
            const on = list.filter((a) => a.status === 'connected');
            if (on.length <= 1) return (on[0] || list[0] || null);
            const name = (a) => {
                const t = window.textMessaging;
                const l = t && typeof t.label === 'function' ? t.label(a) : { subline: a.identity || '' };
                return a.service || l.subline || a.id;
            };
            const pick = await ws.messageBox({
                title: 'Text Messaging',
                icon: 'question',
                text: `Send the text message from which account?\n\n${on.map((a) => { const t = window.textMessaging; const l = t && typeof t.label === 'function' ? t.label(a) : { subline: '' }; return `${name(a)}: ${l.subline || a.id}`; }).join('\n')}`,
                buttons: on.map((a) => ({ text: name(a), value: a.id })).concat([{ text: 'Cancel', value: null }]),
                cancelValue: null
            });
            return pick ? on.find((a) => a.id === pick) || null : null;
        }

        /** A contact can be texted: a mobile number, an e-mail address with a Text Messaging account, or a Dreamscape Messenger (Chat) persona of that name (#757). */
        function canText(c) {
            if (!c) return false;
            if (c.home && c.home.mobile) return true;
            if (textAddress(c)) return true;
            if (c.chatId && !c.chatDeleted && window.wmChatApp) return true;
            const chat = window.wmChatApp;
            return !!(chat && typeof chat.hasPersona === 'function' && chat.hasPersona(VC().displayName(c)));
        }

        async function noPhone(number) {
            await ws.messageBox({ title: 'Phone', icon: 'info', text: `Cannot call ${number}: this phone has no line to dial with.` });
        }

        async function runRow(r) {
            if (r && r.kind === 'info' && r.full) { await ws.messageBox({ title: r.label, icon: 'info', text: r.value }); return; }
            if (!r || r.kind === 'info') return;
            if (r.kind === 'call') { await noPhone(r.value); return; }
            if (r.kind === 'web') {
                const site = /^https?:/i.test(r.value) ? r.value : `http://${r.value}`;
                if (window.wmBrowser && window.wmBrowser.open(site)) return;
                window.open(site, '_blank', 'noopener');
                return;
            }
            if (r.kind === 'sms') {
                const card = r.card || (current && current.c);
                // a phone number or an address: Text Messaging (#779) composes to it
                const T = window.wmTextMessaging;
                const addr = /[@\d]/.test(String(r.value || '')) ? String(r.value) : '';
                if (addr && T && typeof T.compose === 'function' && tmAccounts().length) {
                    const a = await pickTmAccount();
                    if (!a) return;
                    if (await T.compose(a.id, [addr])) return;
                }
            }
            // Dreamscape Messenger (the Chat applet, #757): the conversation with the persona of that name
            if (r.kind === 'sms') {
                const card = r.card || (current && current.c);
                const who = r.name || (card && (card.chatName || VC().displayName(card))) || '';
                const chat = window.wmChatApp;
                // a persona's card opens its own chat (#763), whatever the card is called now
                if (chat && card && card.chatId && !(card.home && card.home.mobile)) {
                    if (typeof chat.openWithId === 'function' && (await chat.openWithId(Number(card.chatId)))) return;
                    if (card.chatName && typeof chat.openWith === 'function' && (await chat.openWith(card.chatName))) return;
                }
                if (chat && typeof chat.openWith === 'function' && (await chat.openWith(who, r.value))) return;
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
            box.querySelectorAll('.ct-btab').forEach((t) => { t.classList.toggle('is-selected', t.dataset.tab === editTab); t.setAttribute('aria-selected', String(t.dataset.tab === editTab)); });
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

        /** Where an Open dialog item's picture is: a phone file, a gallery picture or scrap, a Dreamscape file. */
        async function pictureUrlOf(item) {
            if (item.phoneFile && window.phoneStorage) return window.phoneStorage.fileUrl(item.phoneFile.root, item.phoneFile.path);
            const g = (item.targetKind === 'image' || item.targetKind === 'scrap') ? (item.previewImageFilename || item.targetId) : (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) || null;
            if (g) return `/images/${encodeURIComponent(g)}`;
            if (item.targetKind === 'user-file' && (item.targetId || item.id) && vfs()) { const r = await vfs().downloadFile(item.targetId || item.id); return (r && r.downloadUrl) || null; }
            return null;
        }

        /** A picture as the contact's photo: at most 720 px, JPEG data URL. */
        async function photoFrom(url) {
            const img = new Image();
            img.crossOrigin = 'anonymous'; // the phone's own files come from the app's asset host (CORS)
            await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
            const sc = Math.min(1, 720 / Math.max(img.naturalWidth, img.naturalHeight));
            const cv = document.createElement('canvas');
            cv.width = Math.max(1, Math.round(img.naturalWidth * sc));
            cv.height = Math.max(1, Math.round(img.naturalHeight * sc));
            cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
            return cv.toDataURL('image/jpeg', 0.9);
        }

        function pictureMenu(row, x, y) {
            const setText = () => { const t = row.querySelector('.ct-fstatic'); if (t) t.textContent = draft && draft.photo ? '(picture)' : 'Select a picture...'; };
            ws.menuAt(x, y, [
                {
                    label: 'Select a picture...',
                    disabled: !window.wmFileDialogs,
                    action: () => window.wmFileDialogs.open({
                        title: 'Select Picture', typeLabel: 'Pictures', pictures: true, phone: true,
                        accept: (i) => !!(i.phoneFile || i.targetKind === 'image' || i.targetKind === 'scrap' || (i.targetKind === 'user-file' && /^image\//i.test(String(i.mimeType || '')))),
                        onPick: async (item) => {
                            try {
                                const url = await pictureUrlOf(item);
                                if (!url) throw new Error('not a picture');
                                const data = await photoFrom(url);
                                if (draft) draft.photo = data;
                                setText();
                                return true;
                            } catch (_) {
                                await ws.messageBox({ title: 'Contacts', icon: 'error', text: `"${item.name}" could not be used as the picture.` });
                                return false;
                            }
                        }
                    })
                },
                { label: 'Remove picture', disabled: !(draft && draft.photo), action: () => { if (draft) draft.photo = ''; setText(); } }
            ]);
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
                if (current && current.phone) {
                    // a contact of the phone: Android gets the whole contact, its other rows kept
                    const r = window.wmPhoneData.saveContact(c, current.phone);
                    selectKey = r && r.id ? `phone:${r.id}` : current.key;
                    current = Object.assign({}, current, { c, key: selectKey });
                } else if (current && current.fileId) {
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

            // 6.5 asks under the contact's name, with the warning sign
            const yes = await ws.messageBox(is65() ? {
                title: VC().displayName(e.c) || 'Contacts', icon: 'warning', text: 'Permanently delete the selected contact or contacts?',
                buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false
            } : {
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
                if (e.phone) {
                    // a contact of the phone: Android deletes it
                    window.wmPhoneData.deleteContact(e.phone);
                    trash = false;
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
            const viewByRows = () => [['name', 'Name'], ['company', 'Company']].map(([k, l]) => ({ label: l, radio: viewBy === k, action: () => { viewBy = k; store(VIEW_KEY, k); sortEntries(); renderList(); } }));
            if (is65()) {
                return [
                    { label: 'Edit', disabled: !e || ro, action: () => openForm(e) },
                    '-',
                    { label: 'Send Contact', disabled: !e, submenu: () => sendContactRows(e) },
                    { label: 'Copy Contact', disabled: !e || ro, action: () => copyContact(e) },
                    { label: 'Delete', disabled: !e || ro, action: () => deleteContact(e) },
                    '-',
                    { label: 'Options...', disabled: true },
                    { label: 'View By', submenu: viewByRows },
                    { label: 'Filter', submenu: [{ label: 'All Contacts', radio: true }, { label: 'Recently Viewed', disabled: true }] },
                    '-',
                    { label: 'Select Contacts', disabled: true, submenu: () => [] }
                ];
            }
            return [
                { label: 'Edit', disabled: !e || ro, action: () => openForm(e) },
                '-',
                { label: 'Send Contact', disabled: !e, submenu: () => sendContactRows(e) },
                { label: 'Copy Contact', disabled: !e || ro, action: () => copyContact(e) },
                { label: 'Delete Contact', disabled: !e || ro, action: () => deleteContact(e) },
                '-',
                { label: 'Options...', disabled: true },
                { label: 'View By', submenu: viewByRows },
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
                { label: 'Send Text Message...', disabled: !(e && canText(e.c)), action: () => runRow({ kind: 'sms', value: textAddress(e.c) || e.c.home.mobile, name: VC().displayName(e.c), card: e.c }) },
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

            if (is65()) {
                // 6.5: the shell's tab strip (wm65.css .wm-tabs) and the card's picture frame, which a
                // contact with no picture also has (outres.192.dll bitmap 8202)
                p.classList.add('is-65');
                p.querySelectorAll('.ct-btabs').forEach((t) => t.classList.add('wm-tabs'));
                p.querySelectorAll('.ct-btab').forEach((t) => { t.classList.add('wm-tab'); t.setAttribute('aria-selected', String(t.classList.contains('is-selected'))); });
            }
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
                if (is65() && en) {
                    // the device's row menu: the calls and messages first, no Edit
                    const c = en.c;
                    const mail = VC().email(c);
                    ws.menuAt(x, y, [
                        { label: 'Call Work', disabled: !c.work.phone, action: () => runRow({ kind: 'call', value: c.work.phone }) },
                        { label: 'Call Home', disabled: !c.home.phone, action: () => runRow({ kind: 'call', value: c.home.phone }) },
                        { label: 'Call Mobile', disabled: !c.home.mobile, action: () => runRow({ kind: 'call', value: c.home.mobile }) },
                        { label: 'Send E-mail', disabled: !mail, action: () => runRow({ kind: 'mail', value: mail }) },
                        { label: 'Send Text Message', disabled: !canText(c), action: () => runRow({ kind: 'sms', value: textAddress(c) || c.home.mobile, name: VC().displayName(c), card: c }) },
                        '-',
                        { label: 'Send Contact', submenu: () => sendContactRows(en) },
                        { label: 'Copy Contact', disabled: readOnly(), action: () => copyContact(en) },
                        { label: 'Delete', disabled: readOnly(), action: () => deleteContact(en) }
                    ]);
                    return;
                }
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
                if (!r) return;
                if (r.classList.contains('is-info')) {
                    // a persona's state row (#763) opens whole; other info rows do nothing, as on WM
                    const row = cardRows(current.c)[Number(r.dataset.n)];
                    if (row && row.full) runRow(row);
                    return;
                }
                card.querySelectorAll('.ct-crow').forEach((x) => x.classList.toggle('is-selected', x === r));
                card.querySelector('.ct-card-head').classList.remove('is-selected');
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
                // Picture: choose one (pictures, Dreamscape files, the phone's storage) or remove it (#778)
                const picRow = e.target.closest('.ct-field[data-key="picture"]');
                if (picRow && draft) { pictureMenu(picRow, e.clientX, e.clientY); return; }
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
                            const canCall = !!(c && (c.home.mobile || c.work.phone || c.home.phone));
                            // 6.5: a card with no number has Edit there
                            if (is65() && !canCall) return { left: { label: 'Edit', disabled: readOnly(), action: () => openForm(current) }, right: { label: 'Menu', menu: cardMenu } };
                            return { left: { label: 'Call', disabled: !canCall, action: callDefault }, right: { label: 'Menu', menu: cardMenu } };
                        }
                        if (v === 'edit') return { left: null, right: { label: 'Menu', menu: formMenu } };
                        return { left: { label: 'New', disabled: readOnly(), action: () => ensureVCard().then((ok) => { if (ok) openForm(null); }) }, right: { label: 'Menu', menu: listMenu } };
                    }
                });
            },
            /** Messaging's sender card (Save, #757): a new contact with that name and e-mail address filled in. */
            /** Read the Contacts folder (and the phone's contacts) again when the list is up (#776). */
            reload() { if (page && loaded) void load({ keep: true }); },
            async newContact(init = {}) {
                if (!ws) return;
                if (ws.current !== APP_ID) ws.open(APP_ID);
                if (view() === 'edit' && formChanged() && !(await saveForm())) return;
                if (!(await ensureVCard())) return;
                layers = [];
                openForm(null);
                const parts = String(init.name || '').trim().split(/\s+/).filter(Boolean);
                if (parts.length) { draft.first = parts[0]; draft.last = parts.slice(1).join(' '); }
                if (init.email) draft.emails = [String(init.email)];
                renderForm();
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

    window.wmNotesApp = { openNote: (id, wsId, name) => Notes.openNote(id, wsId, name), newest: () => Notes.newest(), list: () => Notes.list() };
    window.wmContactsApp = { openFile: (item, folder) => Contacts.openFile(item, folder), newContact: (init) => Contacts.newContact(init), reload: () => Contacts.reload() };

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
    // the phone's contacts changed (Phone Data switched, a sync wrote the mirror): Contacts reads again
    document.addEventListener('wmPhoneDataUpdated', () => { try { if (window.wmContactsApp && typeof window.wmContactsApp.reload === 'function') window.wmContactsApp.reload(); } catch (_) { /* next open */ } });
})();
