/**
 * Melaton Mobile: Expanders, a phone version of the desktop's text expander manager
 * (textReplacementManager.js, Toolbox > Expanders = showTextReplacementManager), Yozora #732
 * (parent #709). Not the desktop window re-hosted: the same expanders (the client's shared copy,
 * optionsData.textReplacements via ensureAppOptionsChunk('text_replacements')) and the manager's own
 * server calls (save_text_replacements / delete_text_replacement, then refreshAppOptionsChunk so
 * autocomplete, Run and the token counter see the change) on WM 6.1 screens like Contacts:
 *
 *   list      "Enter a name..." find box (names and texts, as the desktop's search), rows with the bold
 *             !name and its text, or "Random: N choices" for a list (the desktop's dice). Tap = open.
 *   expander  the name band, Type, then the text or the numbered choices. Soft keys Edit / Menu (Copy
 *             !name, Add to Studio (the !name into Studio's prompt), Delete).
 *   edit/new  a WM form: Name, Type (Text | Random choice), Text (Random: one choice per line); ok or
 *             Save stores it (the desktop's rules: a name and at least one text; one choice is saved
 *             as plain text, several as a list), Cancel leaves it. Renaming saves the new name, then
 *             deletes the old one. Delete asks Yes / No.
 *
 * Every desktop route to the manager window (showTextReplacementManager: Toolbox, the main menu, the
 * request-body replacements' Manage, Data Management) opens this app on phones. Only on phones.
 * Styles: public/css/wm-expanders.css (+ wm-suite-kit.css).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'expanders';
    const TITLE = 'Expanders';
    const ICON = 'app-expanders'; // WM art (public/static_images/wm61)
    const TYPES = [{ value: 'text', label: 'Text' }, { value: 'random', label: 'Random choice' }];

    let sh = null;
    let K = null;
    let page = null;
    let loaded = false;
    let search = '';
    let selected = null; // key highlighted in the list
    let current = null; // key on the expander screen
    let layers = []; // 'item', 'edit'
    let form = null; // { oldKey, type }

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const esc = (s) => K.esc(s);
    const data = () => (window.optionsData && window.optionsData.textReplacements && typeof window.optionsData.textReplacements === 'object') ? window.optionsData.textReplacements : {};
    const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
    const keys = () => Object.keys(data()).sort(coll.compare);
    const has = (k) => Object.prototype.hasOwnProperty.call(data(), k);
    const textOf = (v) => (Array.isArray(v) ? v.join('\n') : String(v == null ? '' : v));

    // ---------------------------------------------------------------- data

    async function load(force) {
        if (!K.connected()) throw new Error('The server connection is down.');
        /* global ensureAppOptionsChunk, refreshAppOptionsChunk */
        if (force && typeof refreshAppOptionsChunk === 'function') await refreshAppOptionsChunk('text_replacements');
        else if (typeof ensureAppOptionsChunk === 'function') await ensureAppOptionsChunk('text_replacements');
        loaded = true;
    }

    async function refresh(force) {
        try {
            await sh.busy(() => load(force), { paint: true });
        } catch (err) {
            K.tell(APP_ID, { title: TITLE, icon: 'error', text: `The expanders could not be read.\n\n${K.errText(err)}`.trim() });
        }
        render();
    }

    /** The manager's own server calls, then the shared copy again (appBootstrap.js). */
    async function send(type, payload) {
        const r = await window.wsClient.sendMessage(type, payload);
        if (r && r.success === false) throw new Error(r.message || r.error || 'The server refused.');
        if (typeof refreshAppOptionsChunk === 'function') await refreshAppOptionsChunk('text_replacements');
        return r;
    }

    function visible() {
        const q = search.toLowerCase();
        const d = data();
        return keys().filter((k) => !q || k.toLowerCase().includes(q) || textOf(d[k]).toLowerCase().includes(q));
    }

    function subLine(v) {
        if (Array.isArray(v)) return `Random: ${v.length} ${v.length === 1 ? 'choice' : 'choices'}`;
        return String(v || '').replace(/\s+/g, ' ').trim() || '(empty)';
    }

    // ---------------------------------------------------------------- rendering

    function renderList() {
        const box = page.querySelector('.wex-list');
        const shown = visible();
        if (!shown.includes(selected)) selected = shown.length ? shown[0] : null;
        const nomatch = box.querySelector('.wsk-nomatch');
        nomatch.hidden = !(search && !shown.length && keys().length);
        nomatch.textContent = `No matches: ${search}`;
        const note = box.querySelector('.wsk-note');
        note.hidden = !(loaded && !keys().length);
        note.textContent = 'No expanders. Use Menu > New Expander to add one.';
        const d = data();
        box.querySelector('.wex-rows').innerHTML = shown.map((k) => {
            const sel = k === selected;
            return `<div class="wsk-row${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-key="${esc(k)}">`
                + `<span class="wsk-ico"><img ${K.artAttrs(ICON)} alt="" draggable="false"></span>`
                + `<span class="wsk-name">!${esc(k)}</span><span class="wsk-sub">${esc(subLine(d[k]))}</span></div>`;
        }).join('');
    }

    function renderItem() {
        const box = page.querySelector('.wex-item');
        box.querySelector('.wsk-head-name').textContent = current ? `!${current}` : '';
        const body = box.querySelector('.wsk-body');
        if (!current || !has(current)) { body.innerHTML = '<p class="wsk-note">This expander no longer exists.</p>'; return; }
        const v = data()[current];
        const rows = `<div class="wsk-crow"><span class="wsk-clabel">Type:</span><span class="wsk-cvalue">${Array.isArray(v) ? `Random choice (${v.length})` : 'Text'}</span></div>`;
        const text = Array.isArray(v)
            ? `<ol class="wex-choices">${v.map((x) => `<li>${esc(x)}</li>`).join('')}</ol>`
            : `<div class="wsk-text${String(v || '').trim() ? '' : ' is-empty'}">${esc(String(v || '').trim() ? v : '(empty)')}</div>`;
        body.innerHTML = `${rows}<div class="wsk-subhead">${Array.isArray(v) ? 'Choices:' : 'Text:'}</div>${text}`;
    }

    function renderFormType() {
        const f = page.querySelector('.wex-edit');
        f.querySelector('.wex-type .wsk-combo-text').textContent = (TYPES.find((t) => t.value === form.type) || TYPES[0]).label;
        f.querySelector('.wex-text-label').textContent = form.type === 'random' ? 'Choices:' : 'Text:';
        f.querySelector('[name="text"]').placeholder = form.type === 'random' ? 'One choice per line' : '';
    }

    function render() {
        if (!page) return;
        const v = view();
        page.querySelector('.wex-list').hidden = v !== 'list';
        page.querySelector('.wex-item').hidden = v !== 'item';
        page.querySelector('.wex-edit').hidden = v !== 'edit';
        if (v === 'list') renderList();
        else if (v === 'item') renderItem();
        if (isCurrent()) {
            sh.setTitle(TITLE);
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    function selectRow(k) {
        selected = k;
        page.querySelectorAll('.wex-rows .wsk-row').forEach((r) => {
            const on = r.dataset.key === k;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- actions

    function openItem(k) {
        if (!k || !has(k)) return;
        current = k;
        selected = k;
        layers.push('item');
        render();
        sh.syncHistory();
    }

    function openEdit(k) {
        const v = k != null && has(k) ? data()[k] : '';
        form = { oldKey: k != null && has(k) ? k : null, type: Array.isArray(v) ? 'random' : 'text' };
        const f = page.querySelector('.wex-edit');
        f.querySelector('.wsk-head-name').textContent = form.oldKey != null ? `Edit !${form.oldKey}` : 'New Expander';
        f.querySelector('[name="name"]').value = form.oldKey != null ? form.oldKey : '';
        f.querySelector('[name="text"]').value = textOf(v);
        renderFormType();
        layers.push('edit');
        render();
        sh.syncHistory();
        if (form.oldKey == null) f.querySelector('[name="name"]').focus();
    }

    async function saveEdit() {
        const f = page.querySelector('.wex-edit');
        const key = f.querySelector('[name="name"]').value.trim().replace(/^!+/, '');
        const raw = f.querySelector('[name="text"]').value;
        let value;
        if (form.type === 'random') {
            const items = raw.split('\n').map((s) => s.trim()).filter(Boolean);
            value = items.length === 1 ? items[0] : items;
            if (!items.length) { await sh.messageBox({ title: TITLE, icon: 'warning', text: 'Enter at least one choice.' }); return; }
        } else {
            value = raw.trim();
            if (!value) { await sh.messageBox({ title: TITLE, icon: 'warning', text: 'Enter the text.' }); return; }
        }
        if (!key) { await sh.messageBox({ title: TITLE, icon: 'warning', text: 'Enter a name.' }); return; }
        if (key !== form.oldKey && /\s/.test(key)) { await sh.messageBox({ title: TITLE, icon: 'warning', text: 'A name cannot contain spaces.' }); return; }
        // the server overwrites a name that exists: ask first (the desktop checks only its page)
        if (key !== form.oldKey && has(key)) {
            const yes = await sh.messageBox({ title: TITLE, icon: 'question', text: `!${key} already exists. Replace it?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
            if (!yes) return;
        }
        const oldKey = form.oldKey;
        try {
            await sh.busy(async () => {
                await send('save_text_replacements', { textReplacements: { [key]: value } });
                if (oldKey != null && oldKey !== key) await send('delete_text_replacement', { key: oldKey });
            }, { paint: true });
        } catch (err) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: `The expander could not be saved.\n\n${K.errText(err)}`.trim() });
            return;
        }
        layers.pop();
        form = null;
        current = key;
        selected = key;
        if (view() !== 'item') layers.push('item');
        render();
        sh.syncHistory();
    }

    async function remove(k) {
        if (!k || !has(k)) return;
        const yes = await sh.messageBox({ title: TITLE, icon: 'question', text: `!${k} will be deleted. Continue?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        try {
            await sh.busy(() => send('delete_text_replacement', { key: k }), { paint: true });
        } catch (err) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: `The expander could not be deleted.\n\n${K.errText(err)}`.trim() });
            return;
        }
        if (current === k) { layers = []; current = null; }
        render();
        sh.syncHistory();
    }

    async function addToStudio(k) {
        if (!k) return;
        if (!K.studioOpen() && typeof window.openManualModalWithContent === 'function') {
            try { await sh.busy(() => window.openManualModalWithContent(), { paint: true }); } catch (_) { /* below */ }
        }
        const ta = document.getElementById('manualPrompt');
        if (!K.studioOpen() || !ta) { await sh.messageBox({ title: TITLE, icon: 'error', text: 'Studio could not be opened.' }); return; }
        const cur = ta.value || '';
        const sep = cur.trim() && !cur.trim().endsWith(',') ? ', ' : (cur && !/\s$/.test(cur) ? ' ' : '');
        /* global setTextareaValuePreservingUndo */
        if (typeof setTextareaValuePreservingUndo === 'function') setTextareaValuePreservingUndo(ta, `${cur}${sep}!${k}`);
        else ta.value = `${cur}${sep}!${k}`;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        sh.open('studio');
    }

    async function copyName(k) {
        try { await K.copy(`!${k}`); } catch (err) { await sh.messageBox({ title: TITLE, icon: 'error', text: `!${k} could not be copied.` }); }
    }

    // ---------------------------------------------------------------- menus / keys

    function itemMenu(k) {
        return [
            { label: 'Open', disabled: !k || view() === 'item', action: () => openItem(k) },
            { label: 'Edit...', disabled: !k, action: () => openEdit(k) },
            { label: 'Copy Name', disabled: !k, action: () => copyName(k) },
            { label: 'Add to Studio', disabled: !k, action: () => addToStudio(k) },
            '-',
            { label: 'Delete', disabled: !k, action: () => remove(k) }
        ].filter((x) => x === '-' || !(x.label === 'Open' && view() === 'item'));
    }

    function listMenu() {
        return [...itemMenu(selected), '-', { label: 'New Expander...', action: () => openEdit(null) }, { label: 'Refresh', action: () => refresh(true) }];
    }

    function softKeys() {
        const v = view();
        if (v === 'edit') return { left: { label: 'Cancel', action: () => sh.back() }, right: { label: 'Save', action: saveEdit } };
        if (v === 'item') return { left: { label: 'Edit', disabled: !has(current), action: () => openEdit(current) }, right: { label: 'Menu', menu: () => itemMenu(current) } };
        return { left: { label: 'Open', disabled: !selected, action: () => openItem(selected) }, right: { label: 'Menu', menu: listMenu } };
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        p.classList.add('wsk', 'wm-expanders');
        p.innerHTML = `
            <div class="wsk-view is-list wex-list">
                <div class="wsk-searchbar"><input class="wsk-search wex-search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Enter a name..." aria-label="Enter a name"></div>
                <div class="wsk-nomatch" hidden></div>
                <div class="wsk-scroll"><div class="wex-rows" role="listbox" aria-label="Expanders"></div><p class="wsk-note" hidden></p></div>
            </div>
            <div class="wsk-view wex-item" hidden>
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsk-body"></div>
            </div>
            <form class="wsk-view wex-edit" hidden autocomplete="off">
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsk-body">
                    <label class="wsk-field"><span class="wsk-flabel">Name: !</span><input class="wsk-input" name="name" type="text" autocapitalize="off" spellcheck="false"></label>
                    <div class="wsk-field"><span class="wsk-flabel">Type:</span>${K.comboHtml('wex-type', 'Text')}</div>
                    <label class="wsk-field is-tall"><span class="wsk-flabel wex-text-label">Text:</span><textarea class="wsk-textarea" name="text" autocapitalize="off" spellcheck="false"></textarea></label>
                </div>
            </form>`;
        const f = p.querySelector('.wex-edit');
        f.addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
        f.querySelector('.wex-type').addEventListener('click', (e) => {
            K.combo(e.currentTarget, TYPES, () => form && form.type, (v) => { if (form) { form.type = v; renderFormType(); } });
        });
        const searchEl = p.querySelector('.wex-search');
        searchEl.value = search;
        searchEl.addEventListener('input', () => { search = searchEl.value.trim(); renderList(); if (isCurrent()) sh.refreshSoftKeys(); });
        searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); openItem(selected); } });
        const scroll = p.querySelector('.wex-list .wsk-scroll');
        K.onHold(scroll, '.wsk-row', (row, x, y) => { selectRow(row.dataset.key); sh.menuAt(x, y, itemMenu(row.dataset.key)); });
        scroll.addEventListener('click', (e) => {
            const row = e.target.closest('.wsk-row');
            if (!row) return;
            selectRow(row.dataset.key);
            openItem(row.dataset.key);
        });
        render();
    }

    function register() {
        sh = window.wmShell;
        K = window.wmSuiteKit;
        if (!sh || typeof sh.registerApp !== 'function' || !K) return;
        // every desktop route to the manager window opens this app (Toolbox, main menu, Data Management ...)
        window.showTextReplacementManager = async function () { sh.open(APP_ID); };
        window.addEventListener('appOptionsChunkLoaded', () => { if (page && view() !== 'edit') render(); });
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
            icon: ICON,
            inStart: 'programs',
            programsFolder: 'toolbox',
            sip: true,
            mount,
            show() {
                render();
                refresh(false);
            },
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            historyDepth: () => layers.length,
            onTitleOk() {
                if (view() === 'edit') { saveEdit(); return true; }
                return false;
            },
            onBack() {
                if (!layers.length) return false;
                if (layers.pop() === 'edit') form = null;
                render();
                return true;
            },
            closeQuestion: () => (view() === 'edit' ? 'The expander has not been saved. Close Expanders anyway?' : null),
            softKeys
        });
    }

    if (window.wmShell && window.wmSuiteKit) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
