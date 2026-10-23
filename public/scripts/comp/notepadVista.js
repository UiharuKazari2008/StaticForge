/**
 * Notepad as Vista's notepad.exe (Yozora #632), over the existing note windows
 * (notepadManager.js Notepad): the menus, keys and dialogs of Vista's Notepad, and plain text
 * files from Cartograph beside Melaton's notes.
 *
 *   File    New Ctrl+N, Open... Ctrl+O, Save Ctrl+S, Save As..., Page Setup..., Print... Ctrl+P, Exit
 *           (a note keeps Open in Notion, Note Properties and Add to Desktop under them)
 *   Edit    Undo Ctrl+Z, Cut, Copy, Paste, Delete, Find... Ctrl+F, Find Next F3, Replace... Ctrl+H,
 *           Go To... Ctrl+G, Select All Ctrl+A, Time/Date F5 (and a note's Copy Lookback / novel items)
 *   Format  Word Wrap, Font...      View  Status Bar (off while Word Wrap is on, as in Vista)
 *   Help    View Help, About Notepad
 *
 * The title is "<name> - Notepad" ("Untitled - Notepad", a leading * while unsaved is Vista's
 * own: none; Vista shows no marker, so the unsaved state lives in the File menu and the prompt).
 * Find, Replace, Go To, Font and Page Setup are Vista's own templates (comdlg32.dll.mui 1540,
 * 1541, 1543; notepad.exe.mui 14, 12) through vistaDialogTemplate.js. Word Wrap, the font and the
 * status bar are Notepad's registry values (HKCU\Software\Xyridian\Notepad, as Vista keeps
 * them in HKCU\Software\Microsoft\Notepad).
 *
 * Documents: a note (Melaton's notes, as before), a text file in the VFS (this.file: { id, name,
 * path }), or Untitled. Save on Untitled asks for a file with the Save As dialog
 * (studioSession.js studioOpenFolderDialog); a note window made with New Note still saves a note.
 *
 *   notepadVista.openFile(item, folderPath)   a VFS user file (Cartograph's Open, Default Programs)
 *   notepadVista.openBlank()                  Accessories > Notepad
 */
(function (root) {
    'use strict';

    const NP = root.Notepad || (typeof Notepad !== 'undefined' ? Notepad : null); // eslint-disable-line no-undef
    if (!NP) return;
    const doc = document;
    const KEY = 'HKCU\\Software\\Xyridian\\Notepad';
    const TEXT_TYPES = /\.(txt|log|ini|inf|cfg|conf|json|md|csv|tsv|xml|html?|css|js|ts|py|sh|bat|cmd|yml|yaml|srt|nfo)$/i;

    function reg(name, def) {
        const r = root.melatonRegistry;
        return r ? r.get(KEY, name, def) : def;
    }

    function setReg(values) {
        const r = root.melatonRegistry;
        if (r) void r.set(KEY, values);
    }

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function vdt() {
        return root.vistaDialogTemplate;
    }

    async function ensureDialogs() {
        if (root.vistaDialogTemplate && root.vistaDialogTemplates) return true;
        try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialogs */ }
        return !!(root.vistaDialogTemplate && root.vistaDialogTemplates);
    }

    /** vfsClient.js declares a script-level const, not a window property. */
    function vfs() {
        return root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
    }

    function isTextItem(item) {
        if (!item) return false;
        return /^text\//.test(item.mimeType || '') || /json|xml|javascript/.test(item.mimeType || '') || TEXT_TYPES.test(item.name || '');
    }

    function utf8ToBase64(text) {
        const bytes = new TextEncoder().encode(text);
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(bin);
    }

    // ---- the window: title, status bar, font, wrap ------------------------------------------

    const proto = NP.prototype;
    const original = {
        init: proto.init,
        setupEventListeners: proto.setupEventListeners,
        runNotepadAction: proto.runNotepadAction,
        close: proto.close,
        saveNoteContent: proto.saveNoteContent,
        updateTitle: proto.updateTitle,
        markAsUnsaved: proto.markAsUnsaved
    };

    proto.textarea = function () {
        return this.element.querySelector(`#notepadTextarea_${this.id}`) || this.element.querySelector('textarea');
    };

    proto.docName = function () {
        if (this.file) return this.file.name.replace(/\.txt$/i, '');
        if (this.note && this.note.name) return this.note.name;
        return 'Untitled';
    };

    proto.updateTitle = function () {
        const t = this.element.querySelector(`#notepadTitle_${this.id}`);
        if (t) t.textContent = `${this.docName()} - Notepad`;
        this.element.setAttribute('aria-label', `${this.docName()} - Notepad`);
    };

    proto.applyFormat = function () {
        const box = this.textarea();
        if (!box) return;
        const wrap = reg('fWrap', false) === true;
        box.wrap = wrap ? 'soft' : 'off';
        box.style.whiteSpace = wrap ? 'pre-wrap' : 'pre';
        box.style.overflowX = wrap ? 'hidden' : 'auto';
        const face = reg('lfFaceName', 'Lucida Console');
        const size = Number(reg('iPointSize', 100)) / 10;
        const weight = Number(reg('lfWeight', 400));
        const italic = reg('lfItalic', false) === true;
        box.style.fontFamily = `"${face}", monospace`;
        box.style.fontSize = `${(size * 96) / 72}px`;
        box.style.fontWeight = String(weight);
        box.style.fontStyle = italic ? 'italic' : 'normal';
        const status = this.element.querySelector('.notepad-statusbar');
        const showStatus = !wrap && reg('StatusBar', false) === true;
        if (status) status.hidden = !showStatus;
        this.element.classList.toggle('notepad-has-status', showStatus);
        this.updateStatus();
    };

    proto.updateStatus = function () {
        const status = this.element.querySelector('.notepad-statusbar-pos');
        const box = this.textarea();
        if (!status || !box) return;
        const before = box.value.slice(0, box.selectionStart);
        const ln = before.split('\n').length;
        const col = before.length - before.lastIndexOf('\n');
        status.textContent = `Ln ${ln}, Col ${col}`;
    };

    proto.init = function () {
        // Vista's window: File Edit Format View Help, the status bar under the text
        const bar = this.element.querySelector('.naxt-menubar');
        if (bar && !bar.querySelector('[data-notepad-menu="format"]')) {
            bar.innerHTML = ["file", "edit", "format", "view", "help"].map((m) => `<button type="button" class="naxt-menu-title" data-notepad-menu="${m}" role="menuitem">${m[0].toUpperCase()}${m.slice(1)}</button>`).join("");
        }
        const box = this.element.querySelector('textarea');
        if (box) {
            box.placeholder = '';
            box.spellcheck = false;
            box.setAttribute('autocomplete', 'off');
            box.classList.add('notepad-vista-text');
        }
        if (!this.element.querySelector('.notepad-statusbar')) {
            const content = this.element.querySelector('.modal-content');
            content.insertAdjacentHTML('beforeend', '<div class="notepad-statusbar" hidden><span class="notepad-statusbar-fill"></span><span class="notepad-statusbar-pos">Ln 1, Col 1</span></div>');
        }
        original.init.call(this);
        this.applyFormat();
        this.updateTitle();
    };

    proto.setupEventListeners = function () {
        original.setupEventListeners.call(this);
        const box = this.textarea();
        if (box) {
            ['keyup', 'click', 'select', 'input'].forEach((ev) => box.addEventListener(ev, () => this.updateStatus()));
        }
        this.element.addEventListener('keydown', (ev) => this.onKey(ev));
    };

    proto.markAsUnsaved = function () {
        if (!this.hasUnsavedChanges) this.hasUnsavedChanges = true;
        this.updateTitle();
    };

    proto.markAsSaved = function () {
        this.hasUnsavedChanges = false;
        this.updateTitle();
    };

    proto.onKey = function (ev) {
        const ctrl = ev.ctrlKey || ev.metaKey;
        const k = ev.key.toLowerCase();
        let action = null;
        if (ctrl && !ev.shiftKey && !ev.altKey) {
            action = { n: 'new', o: 'open', s: 'save', p: 'print', f: 'find', h: 'replace', g: 'goto' }[k] || null;
        } else if (ev.key === 'F3') action = 'find-next';
        else if (ev.key === 'F5') action = 'time-date';
        if (!action) return;
        ev.preventDefault();
        ev.stopPropagation();
        void this.runNotepadAction(action);
    };

    // ---- menus ----------------------------------------------------------------------------

    proto.notepadMenuItems = function (menu) {
        const isNote = !!(this.note && this.note.id);
        const box = this.textarea();
        const sel = box && box.selectionStart !== box.selectionEnd;
        const wrap = reg('fWrap', false) === true;
        switch (menu) {
            case 'file': {
                const items = [
                    { text: 'New', subtext: 'Ctrl+N', action: 'new' },
                    { text: 'Open...', subtext: 'Ctrl+O', action: 'open' },
                    { text: 'Save', subtext: 'Ctrl+S', action: 'save' },
                    { text: 'Save As...', action: 'save-as' }
                ];
                if (isNote) {
                    items.push({ separator: true },
                        { text: 'Open in Notion', action: 'open-in-notion' },
                        { text: 'Note Properties...', action: 'update' },
                        { text: 'Add to Desktop', action: 'add-shortcut' });
                }
                items.push({ separator: true },
                    { text: 'Page Setup...', action: 'page-setup' },
                    { text: 'Print...', subtext: 'Ctrl+P', action: 'print' },
                    { separator: true },
                    { text: 'Exit', action: 'close' });
                return items;
            }
            case 'edit': {
                const items = [
                    { text: 'Undo', subtext: 'Ctrl+Z', action: 'undo' },
                    { separator: true },
                    { text: 'Cut', subtext: 'Ctrl+X', action: 'cut', disabled: !sel },
                    { text: 'Copy', subtext: 'Ctrl+C', action: 'copy', disabled: !sel },
                    { text: 'Paste', subtext: 'Ctrl+V', action: 'paste' },
                    { text: 'Delete', subtext: 'Del', action: 'delete', disabled: !sel },
                    { separator: true },
                    { text: 'Find...', subtext: 'Ctrl+F', action: 'find' },
                    { text: 'Find Next', subtext: 'F3', action: 'find-next' },
                    { text: 'Replace...', subtext: 'Ctrl+H', action: 'replace' },
                    { text: 'Go To...', subtext: 'Ctrl+G', action: 'goto', disabled: wrap },
                    { separator: true },
                    { text: 'Select All', subtext: 'Ctrl+A', action: 'select-all' },
                    { text: 'Time/Date', subtext: 'F5', action: 'time-date' }
                ];
                if (isNote) items.push({ separator: true }, { text: 'Copy Lookback', action: 'copy-lookback' });
                if (this.note && this.note.note_kind === 'novel') {
                    items.push({ text: 'Generate Next', action: 'novel-generate' },
                        { text: 'Undo Generation', action: 'novel-undo', disabled: !(this.note.metadata && this.note.metadata.undo_stack && this.note.metadata.undo_stack.length > 0) });
                }
                return items;
            }
            case 'format':
                return [
                    { text: 'Word Wrap', action: 'word-wrap', showIndicator: true, checked: wrap },
                    { text: 'Font...', action: 'font' }
                ];
            case 'view':
                return [{ text: 'Status Bar', action: 'status-bar', showIndicator: true, checked: !wrap && reg('StatusBar', false) === true, disabled: wrap }];
            case 'help':
                return [
                    { text: 'View Help', action: 'help' },
                    { separator: true },
                    { text: 'About Notepad', action: 'about' }
                ];
            default:
                return [];
        }
    };

    proto.runNotepadAction = async function (action) {
        const box = this.textarea();
        switch (action) {
            case 'new': return this.newDocument();
            case 'open': return this.openDialog();
            case 'save': return this.save();
            case 'save-as': return this.saveAs();
            case 'page-setup': return this.pageSetup();
            case 'print': return this.print();
            case 'undo': box.focus(); doc.execCommand('undo'); return undefined;
            case 'cut': box.focus(); doc.execCommand('cut'); return undefined;
            case 'copy': box.focus(); doc.execCommand('copy'); return undefined;
            case 'paste':
                box.focus();
                try {
                    const text = await navigator.clipboard.readText();
                    doc.execCommand('insertText', false, text);
                } catch (_) { doc.execCommand('paste'); }
                return undefined;
            case 'delete': box.focus(); doc.execCommand('delete'); return undefined;
            case 'find': return this.findDialog(false);
            case 'replace': return this.findDialog(true);
            case 'find-next': return this.findNext();
            case 'goto': return this.goTo();
            case 'select-all': box.focus(); box.select(); return undefined;
            case 'time-date': {
                // Vista: "h:mm AM/PM M/D/YYYY"
                const d = new Date();
                const stamp = `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} ${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
                box.focus();
                doc.execCommand('insertText', false, stamp);
                return undefined;
            }
            case 'word-wrap': setReg({ fWrap: !(reg('fWrap', false) === true) }); this.applyFormat(); return undefined;
            case 'status-bar': setReg({ StatusBar: !(reg('StatusBar', false) === true) }); this.applyFormat(); return undefined;
            case 'font': return this.fontDialog();
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('notepad'); return undefined;
            case 'about': return this.about();
            default: return original.runNotepadAction.call(this, action);
        }
    };

    // ---- documents ------------------------------------------------------------------------

    proto.save = async function () {
        const box = this.textarea();
        if (this.file) return this.writeFile(box.value);
        if (this.note || this.kind === 'note') return original.saveNoteContent.call(this, box.value);
        return this.saveAs();
    };

    /** File > New: Vista clears this window (asking to save first), it does not open another. */
    proto.newDocument = async function () {
        if (this.hasUnsavedChanges) {
            const choice = await root.notepadVista.askSave(this.docName());
            if (choice === 'cancel' || choice === null) return;
            if (choice === 'save') {
                const ok = await this.save();
                if (ok === false || this.hasUnsavedChanges) return;
            }
        }
        this.note = null;
        this.file = null;
        this.kind = 'file';
        const box = this.textarea();
        box.value = '';
        this.hasUnsavedChanges = false;
        this.updateTitle();
        this.updateStatus();
        box.focus();
    };

    proto.saveNoteContent = async function (content) {
        if (this.file) return this.writeFile(content);
        if (!this.note && this.kind !== 'note') return this.saveAs();
        return original.saveNoteContent.call(this, content);
    };

    proto.writeFile = async function (text) {
        try {
            const res = await vfs().replaceFile(this.file.id, utf8ToBase64(text), 'text/plain');
            if (res && res.success === false) throw new Error(res.error || 'Could not save');
            this.markAsSaved();
            return true;
        } catch (err) {
            await root.notepadVista.message(`Cannot save ${this.file.name}.\n${(err && err.message) || ''}`, 'error');
            return false;
        }
    };

    proto.saveAs = function () {
        if (typeof root.studioOpenFolderDialog !== 'function') return Promise.resolve(false);
        const self = this;
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : ''; // eslint-disable-line no-undef
        return root.studioOpenFolderDialog('save', {
            startPath: (this.file && this.file.path) || (ws ? `/Workspaces/${ws}` : '/'),
            host: {
                title: 'Save As',
                typeLabel: 'Text Documents (*.txt)',
                acceptType: 'user-file',
                suggestName: () => (self.file ? self.file.name : (self.note ? `${self.note.name}.txt` : '*.txt')),
                async onSave(info) {
                    let name = String(info.name || '').trim();
                    if (!name || name === '*.txt') return false;
                    if (!/\.[a-z0-9]{1,5}$/i.test(name)) name += '.txt';
                    const text = self.textarea().value;
                    try {
                        // vfs_upload_file takes the folder; the name is the file's
                        const res = await vfs().uploadFile(info.path || '/', utf8ToBase64(text), name, 'text/plain');
                        const file = res && (res.file || res.entry || res);
                        self.file = { id: (file && (file.id || file.fileId)) || null, name, path: info.path };
                        self.note = null;
                        self.markAsSaved();
                        return true;
                    } catch (err) {
                        await root.notepadVista.message(`Cannot save ${name}.\n${(err && err.message) || ''}`, 'error');
                        return false;
                    }
                }
            }
        });
    };

    proto.openDialog = function () {
        if (typeof root.studioOpenFolderDialog !== 'function') return this.manager.showOpenNoteModal();
        const self = this;
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : ''; // eslint-disable-line no-undef
        return root.studioOpenFolderDialog('open-vfs', {
            startPath: (this.file && this.file.path) || (ws ? `/Workspaces/${ws}` : '/'),
            host: {
                title: 'Open',
                typeLabel: 'Text Documents (*.txt)',
                rejectMessage: 'Choose a text document',
                acceptItem: (item) => item && (item.targetKind === 'note' || (item.targetKind === 'user-file' && isTextItem(item))),
                async onOpen(item, folderPath) {
                    if (item.targetKind === 'note') {
                        await self.manager.openExistingNote(item.targetId);
                        return;
                    }
                    // Vista opens it in this window when it is Untitled and untouched
                    const reuse = !self.note && !self.file && !self.hasUnsavedChanges && !self.textarea().value;
                    await root.notepadVista.openFile(item, folderPath, reuse ? self : null);
                }
            }
        });
    };

    proto.close = async function () {
        if (this.hasUnsavedChanges) {
            const choice = await root.notepadVista.askSave(this.docName());
            if (choice === 'cancel' || choice === null) return;
            if (choice === 'save') {
                const ok = await this.save();
                if (ok === false || this.hasUnsavedChanges) return;
            }
            this.hasUnsavedChanges = false;
        }
        return original.close.call(this);
    };

    // ---- Find, Replace, Go To ---------------------------------------------------------------

    proto.findDialog = async function (replace) {
        if (!await ensureDialogs()) return;
        const self = this;
        const box = this.textarea();
        const state = root.notepadVista.findState;
        const selText = box.value.slice(box.selectionStart, box.selectionEnd);
        if (selText && !selText.includes('\n')) state.what = selText;
        const id = replace ? 'notepadReplaceDialog' : 'notepadFindDialog';
        const existing = doc.getElementById(id);
        if (existing) existing.remove();
        vdt().openDialog({
            id,
            key: replace ? 'comdlg32:1541' : 'comdlg32:1540',
            owner: this.element,
            overrides: { 1038: { hidden: true } },
            init(ctx) {
                ctx.set(1152, state.what);
                if (replace) ctx.set(1153, state.with);
                ctx.set(1040, state.word);
                ctx.set(1041, state.matchCase);
                if (!replace) ctx.set(state.down ? 1057 : 1056, true);
                const sync = () => {
                    const has = !!ctx.get(1152);
                    ctx.enable(1, has);
                    if (replace) { ctx.enable(1024, has); ctx.enable(1025, has); }
                };
                ctx.on(1152, 'input', sync);
                sync();
                const read = () => {
                    state.what = ctx.get(1152);
                    state.word = ctx.get(1040);
                    state.matchCase = ctx.get(1041);
                    if (replace) state.with = ctx.get(1153);
                    else state.down = ctx.get(1057);
                };
                ctx.store.read = read;
                setTimeout(() => { const e = ctx.el(1152); if (e) { e.focus(); e.select(); } }, 50);
            },
            buttons: {
                1: (ctx) => { ctx.store.read(); self.findNext(); },
                1024: (ctx) => { ctx.store.read(); self.replaceOne(); },
                1025: (ctx) => { ctx.store.read(); self.replaceAll(); }
            }
        });
    };

    function matcher(state) {
        const esc2 = state.what.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(state.word ? `\\b${esc2}\\b` : esc2, state.matchCase ? 'g' : 'gi');
    }

    proto.findNext = function (quiet) {
        const state = root.notepadVista.findState;
        if (!state.what) return this.findDialog(false);
        const box = this.textarea();
        const re = matcher(state);
        let hit = null;
        if (state.down) {
            re.lastIndex = box.selectionEnd;
            hit = re.exec(box.value);
        } else {
            const before = box.value.slice(0, box.selectionStart);
            let m;
            re.lastIndex = 0;
            while ((m = re.exec(before))) { hit = m; if (m[0].length === 0) re.lastIndex += 1; }
        }
        if (!hit) {
            if (!quiet) void root.notepadVista.message(`Cannot find "${state.what}"`, 'info');
            return false;
        }
        box.focus();
        box.setSelectionRange(hit.index, hit.index + hit[0].length);
        this.scrollToSelection();
        this.updateStatus();
        return true;
    };

    proto.replaceOne = function () {
        const state = root.notepadVista.findState;
        const box = this.textarea();
        const sel = box.value.slice(box.selectionStart, box.selectionEnd);
        const same = state.matchCase ? sel === state.what : sel.toLowerCase() === state.what.toLowerCase();
        if (sel && same) {
            box.focus();
            doc.execCommand('insertText', false, state.with);
        }
        const down = state.down;
        state.down = true;
        this.findNext();
        state.down = down;
    };

    proto.replaceAll = function () {
        const state = root.notepadVista.findState;
        const box = this.textarea();
        const next = box.value.replace(matcher(state), state.with.replace(/\$/g, '$$$$'));
        if (next === box.value) return;
        box.focus();
        box.select();
        doc.execCommand('insertText', false, next);
        box.setSelectionRange(0, 0);
    };

    proto.scrollToSelection = function () {
        const box = this.textarea();
        const lineH = parseFloat(getComputedStyle(box).lineHeight) || 16;
        const line = box.value.slice(0, box.selectionStart).split('\n').length - 1;
        const top = line * lineH;
        if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - lineH) box.scrollTop = Math.max(0, top - box.clientHeight / 2);
    };

    proto.goTo = async function () {
        if (reg('fWrap', false) === true || !await ensureDialogs()) return;
        const self = this;
        const box = this.textarea();
        const lines = box.value.split('\n');
        const current = box.value.slice(0, box.selectionStart).split('\n').length;
        vdt().openDialog({
            id: 'notepadGoToDialog',
            key: 'notepad:14',
            title: 'Go To Line',
            owner: this.element,
            init(ctx) {
                ctx.set(258, String(current));
                setTimeout(() => { const e = ctx.el(258); if (e) { e.focus(); e.select(); } }, 50);
            },
            async ok(ctx) {
                const n = Number(String(ctx.get(258)).trim());
                if (!Number.isInteger(n) || n < 1 || n > lines.length) {
                    await root.notepadVista.message('The line number is beyond the total number of lines', 'info', 'Notepad - Goto Line');
                    return false;
                }
                const at = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
                box.focus();
                box.setSelectionRange(at, at);
                self.scrollToSelection();
                self.updateStatus();
                return true;
            }
        });
    };

    // ---- Font --------------------------------------------------------------------------------

    const FONT_FACES = ['Arial', 'Calibri', 'Cambria', 'Candara', 'Comic Sans MS', 'Consolas', 'Constantia', 'Corbel', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Lucida Sans Unicode', 'Microsoft Sans Serif', 'Palatino Linotype', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
    const FONT_STYLES = [['Regular', 400, false], ['Italic', 400, true], ['Bold', 700, false], ['Bold Italic', 700, true]];
    const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

    function simpleCombo(cls, list, value) {
        return `<div class="np-simple-combo ${cls}"><input type="text" class="tbp-edit" value="${esc(value)}" spellcheck="false"><div class="vdt-listbox vdt-edge" tabindex="0">${list.map((v) => `<div class="vdt-lb-row${String(v) === String(value) ? ' is-selected' : ''}" data-value="${esc(v)}"><span>${esc(v)}</span></div>`).join('')}</div></div>`;
    }

    proto.fontDialog = async function () {
        if (!await ensureDialogs()) return;
        const self = this;
        const face = reg('lfFaceName', 'Lucida Console');
        const size = Number(reg('iPointSize', 100)) / 10;
        const style = FONT_STYLES.find((s) => s[1] === Number(reg('lfWeight', 400)) && s[2] === (reg('lfItalic', false) === true)) || FONT_STYLES[0];
        vdt().openDialog({
            id: 'notepadFontDialog',
            key: 'comdlg32:1543',
            owner: this.element,
            overrides: {
                1136: { html: simpleCombo('np-face', FONT_FACES, face) },
                1137: { html: simpleCombo('np-style', FONT_STYLES.map((s) => s[0]), style[0]) },
                1138: { html: simpleCombo('np-size', FONT_SIZES, size) },
                1072: { hidden: true }, 1040: { hidden: true }, 1041: { hidden: true }, 1091: { hidden: true }, 1139: { hidden: true },
                1026: { hidden: true }, 1038: { hidden: true },
                1092: { html: '<div class="np-font-sample">AaBbYyZz</div>' }
            },
            init(ctx) {
                ctx.options(1140, ['Western'], 'Western');
                ctx.show(1092, true);
                const read = () => {
                    const v = (cls) => ctx.content.querySelector(`.${cls} input`).value;
                    return { face: v('np-face'), style: v('np-style'), size: Number(v('np-size')) || 10 };
                };
                const sample = () => {
                    const f = read();
                    const st = FONT_STYLES.find((s) => s[0] === f.style) || FONT_STYLES[0];
                    const el = ctx.content.querySelector('.np-font-sample');
                    el.style.fontFamily = `"${f.face}"`;
                    el.style.fontSize = `${Math.min(f.size, 36) * 96 / 72}px`;
                    el.style.fontWeight = String(st[1]);
                    el.style.fontStyle = st[2] ? 'italic' : 'normal';
                    ctx.text(1093, /Lucida Console|Courier New|Consolas/.test(f.face) ? 'This is an OpenType font. This same font will be used on both your printer and your screen.' : 'This is a TrueType font. This same font will be used on both your printer and your screen.');
                };
                ctx.content.querySelectorAll('.np-simple-combo').forEach((combo) => {
                    const input = combo.querySelector('input');
                    const list = combo.querySelector('.vdt-listbox');
                    list.addEventListener('change', () => { input.value = list.dataset.value; sample(); });
                    input.addEventListener('input', () => {
                        const v = input.value.toLowerCase();
                        const row = Array.from(list.querySelectorAll('.vdt-lb-row')).find((r) => r.dataset.value.toLowerCase().startsWith(v));
                        list.querySelectorAll('.is-selected').forEach((r) => r.classList.remove('is-selected'));
                        if (row) { row.classList.add('is-selected'); row.scrollIntoView({ block: 'nearest' }); }
                        sample();
                    });
                    const sel = list.querySelector('.is-selected');
                    if (sel) setTimeout(() => sel.scrollIntoView({ block: 'nearest' }), 0);
                });
                ctx.store.read = read;
                sample();
            },
            ok(ctx) {
                const f = ctx.store.read();
                const st = FONT_STYLES.find((s) => s[0] === f.style) || FONT_STYLES[0];
                setReg({ lfFaceName: f.face, iPointSize: Math.round(f.size * 10), lfWeight: st[1], lfItalic: st[2] });
                self.applyFormat();
                // every open Notepad uses the one font, as Vista's keeps one setting
                if (self.manager && self.manager.notepads) self.manager.notepads.forEach((n) => n !== self && n.applyFormat && n.applyFormat());
            }
        });
    };

    // ---- Page Setup and Print ----------------------------------------------------------------

    function pageSettings() {
        return {
            portrait: reg('iPrintOrientation', 'portrait') !== 'landscape',
            left: reg('iMarginLeft', '0.75'), right: reg('iMarginRight', '0.75'),
            top: reg('iMarginTop', '1'), bottom: reg('iMarginBottom', '1'),
            header: reg('szHeader', '&f'), footer: reg('szTrailer', 'Page &p'),
            paper: reg('PaperSize', 'Letter')
        };
    }

    proto.pageSetup = async function () {
        if (!await ensureDialogs()) return;
        const p = pageSettings();
        vdt().openDialog({
            id: 'notepadPageSetup',
            key: 'notepad:12',
            owner: this.element,
            overrides: { 1080: { html: '<div class="np-page-preview"><div class="np-page-lines"></div></div>' } },
            init(ctx) {
                ctx.options(1137, ['Letter', 'Legal', 'A4', 'A5', 'B5 (JIS)', 'Executive'], p.paper);
                ctx.options(1138, ['Automatically Select'], 'Automatically Select');
                ctx.set(p.portrait ? 1056 : 1057, true);
                ctx.set(1155, p.left); ctx.set(1157, p.right); ctx.set(1156, p.top); ctx.set(1158, p.bottom);
                ctx.set(30, p.header); ctx.set(31, p.footer);
                const preview = () => ctx.content.querySelector('.np-page-preview').classList.toggle('is-landscape', !!ctx.get(1057));
                ctx.content.addEventListener('change', preview);
                preview();
                ctx.on(1026, 'click', () => root.print());
            },
            ok(ctx) {
                setReg({
                    PaperSize: ctx.get(1137), iPrintOrientation: ctx.get(1057) ? 'landscape' : 'portrait',
                    iMarginLeft: ctx.get(1155), iMarginRight: ctx.get(1157), iMarginTop: ctx.get(1156), iMarginBottom: ctx.get(1158),
                    szHeader: ctx.get(30), szTrailer: ctx.get(31)
                });
            }
        });
    };

    /** Print: the text in Notepad's font, Page Setup's margins, header (&f file name, &d date, &t time) and footer (&p page). */
    proto.print = function () {
        const p = pageSettings();
        const name = this.file ? this.file.name : `${this.docName()}${this.note ? '' : '.txt'}`;
        const now = new Date();
        const codes = (s) => esc(String(s || '')
            .replace(/&f/gi, name).replace(/&d/gi, now.toLocaleDateString('en-US')).replace(/&t/gi, now.toLocaleTimeString('en-US'))
            .replace(/&[lcr]/gi, '').replace(/&&/g, '&'));
        const box = this.textarea();
        const frame = doc.createElement('iframe');
        frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
        doc.body.appendChild(frame);
        const face = reg('lfFaceName', 'Lucida Console');
        const size = Number(reg('iPointSize', 100)) / 10;
        frame.contentDocument.open();
        frame.contentDocument.write(`<!doctype html><html><head><title>${esc(name)}</title><style>
            @page { size: ${p.paper === 'A4' ? 'A4' : 'letter'} ${p.portrait ? 'portrait' : 'landscape'}; margin: ${Number(p.top) || 1}in ${Number(p.right) || 0.75}in ${Number(p.bottom) || 1}in ${Number(p.left) || 0.75}in; }
            body { margin: 0; font: ${size}pt "${face}", monospace; }
            pre { margin: 0; white-space: pre-wrap; font: inherit; }
            .h, .f { text-align: center; font: 10pt Arial, sans-serif; margin: 0 0 12pt; }
            .f { margin: 12pt 0 0; }
        </style></head><body><div class="h">${codes(p.header)}</div><pre>${esc(box.value)}</pre><div class="f">${codes(p.footer).replace(/&amp;p/gi, '1')}</div></body></html>`);
        frame.contentDocument.close();
        setTimeout(() => {
            try { frame.contentWindow.focus(); frame.contentWindow.print(); } catch (_) { /* blocked */ }
            setTimeout(() => frame.remove(), 1000);
        }, 100);
    };

    proto.about = function () {
        if (typeof root.openAboutMelatoninModal === 'function') return root.openAboutMelatoninModal({ program: 'Notepad' });
        return undefined;
    };

    // ---- the public side ---------------------------------------------------------------------

    async function message(text, kind = 'info', title = 'Notepad') {
        if (typeof root.showConfirmationDialog !== 'function') return null;
        return root.showConfirmationDialog(`<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title, width: 360, icon: kind === 'error' ? 'fas fa-circle-xmark' : 'fas fa-circle-info' });
    }

    /** Vista's "Do you want to save changes to <name>?" (Save / Don't Save / Cancel). */
    async function askSave(name) {
        if (typeof root.showConfirmationDialog !== 'function') return 'discard';
        return root.showConfirmationDialog(`<p>Do you want to save changes to ${esc(name)}?</p>`, [
            { text: 'Save', value: 'save', className: 'btn-standard primary' },
            { text: "Don't Save", value: 'discard', className: 'btn-standard' },
            { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
        ], null, { title: 'Notepad', width: 380 });
    }

    function openBlank(kind = 'file') {
        const mgr = root.notepadManager;
        if (!mgr) return null;
        const np = mgr.createBlankNotepad();
        np.kind = kind;
        np.updateTitle();
        return np;
    }

    async function openFile(item, folderPath, reuse) {
        const mgr = root.notepadManager;
        if (!mgr || !item) return null;
        const already = Array.from(mgr.notepads.values()).find((n) => n.file && n.file.id === item.id);
        if (already) {
            if (typeof root.bringModalToFront === 'function') root.bringModalToFront(already.element);
            return already;
        }
        let text = '';
        try {
            const res = await vfs().downloadFile(item.id);
            const r = await fetch(res.downloadUrl, { credentials: 'same-origin', cache: 'no-store' });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            text = await r.text();
        } catch (err) {
            await message(`Cannot open ${item.name}.\n${(err && err.message) || ''}`, 'error');
            return null;
        }
        const np = reuse || mgr.createBlankNotepad();
        np.kind = 'file';
        np.file = { id: item.id, name: item.name, path: folderPath || '' };
        np.note = null;
        const box = np.textarea();
        box.value = text;
        box.setSelectionRange(0, 0);
        np.hasUnsavedChanges = false;
        np.updateTitle();
        np.updateStatus();
        if (window.recentItems && typeof window.recentItems.noteExplorerItem === 'function') window.recentItems.noteExplorerItem(item, folderPath || '');
        return np;
    }

    // Notion's New Note still makes a note (it saves to Melaton's notes, as before)
    const MgrProto = root.notepadManager && Object.getPrototypeOf(root.notepadManager);
    if (MgrProto && !MgrProto.__vistaNewNote) {
        const handleNewNote = MgrProto.handleNewNote;
        MgrProto.handleNewNote = function (...args) {
            const before = new Set(this.notepads.keys());
            const out = handleNewNote.apply(this, args);
            this.notepads.forEach((n, id) => { if (!before.has(id)) { n.kind = 'note'; n.updateTitle(); } });
            return out;
        };
        MgrProto.__vistaNewNote = true;
    }

    root.notepadVista = {
        openBlank, openFile, isTextItem, askSave, message,
        findState: { what: '', with: '', word: false, matchCase: false, down: true }
    };
})(typeof window !== 'undefined' ? window : globalThis);
