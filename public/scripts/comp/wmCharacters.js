/**
 * Melaton Mobile: Characters, a phone version of the desktop's character database
 * (characterDbApplet.js, Toolbox > Characters), Yozora #732 (parent #709). Not the desktop window
 * re-hosted: the desktop applet's data and calls (characterDbApplet.loadDatabase / getCopyrights /
 * getCharactersForCopyright / joinOverloadText / addToPrompt / upsertCharacter / deleteCharacterByName,
 * wsClient.searchCharacters) on WM 6.1 screens laid out like File Explorer and Contacts:
 *
 *   copyrights   "Enter a name..." find box, then the copyrights as folder rows with their counts.
 *                Typing lists the matching characters instead (names, copyrights and tags here, plus
 *                the server's fuzzy character search the desktop uses, from 2 letters).
 *   characters   the copyright's characters (bold name, the tags under it).
 *   character    Contacts' card: the name band, Copyright, then selectable rows: Tags (the base
 *                prompt) and each Overload (prompt + its extra tags). Soft keys Add (to Studio's prompt:
 *                the desktop's addToPrompt; Studio opens first when it is closed, then comes to the
 *                front) / Menu (Add to Studio, Copy, Edit, Delete).
 *   edit / new   a WM form (Name, Copyright, Tags, Overloads one group per line); ok saves through the
 *                desktop's upsert, Cancel leaves it. Delete asks Yes / No.
 *
 * The desktop's route to the Characters window (characterDbApplet.open) opens this app on phones. Only on
 * phones. Styles: public/css/wm-characters.css (+ wm-suite-kit.css).
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'characters';
    const TITLE = 'Characters';
    const ICON = 'app-characters'; // WM art (public/static_images/wm61)
    const FOLDER = '/static_images/app_icons/vista-folder.webp';
    const SESSION = 'wm_characters';

    let sh = null;
    let K = null;
    let page = null;
    let loaded = false;
    let search = '';
    let hits = null; // server search hits (characters) for `search`, or null
    let searchReq = null;
    let searchTimer = null;
    let subscribed = false;
    let copyright = null; // the open copyright
    let character = null; // the open character's name
    let selRow = null; // the selected row key on each level
    let layers = []; // 'chars', 'card', 'edit'
    let editing = null; // { oldName } while the form is up

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const esc = (s) => K.esc(s);
    /* global characterDbApplet */
    const applet = () => (typeof characterDbApplet !== 'undefined' ? characterDbApplet : null);
    const all = () => { const a = applet(); return a && Array.isArray(a.characters) ? a.characters : []; };
    const byName = (n) => all().find((c) => c.name === n) || null;
    const cpOf = (c) => (c && c.copyright) || 'Original';
    const isAdmin = () => { try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; } };

    // ---------------------------------------------------------------- data

    async function load(force) {
        if (loaded && !force) return true;
        if (!K.connected()) throw new Error('The server connection is down.');
        if (!await K.feature('character_db')) throw new Error('The character database could not be loaded.');
        patchApplet();
        const a = applet();
        if (!a) throw new Error('The character database could not be loaded.');
        await a.loadDatabase();
        loaded = true;
        return true;
    }

    async function refresh(force) {
        try {
            await sh.busy(() => load(force), { paint: true });
        } catch (err) {
            K.tell(APP_ID, { title: TITLE, icon: 'error', text: `The characters could not be read.\n\n${K.errText(err)}`.trim() });
        }
        render();
    }

    function localHits(q) {
        const s = q.toLowerCase();
        return all().filter((c) => c.name.toLowerCase().includes(s) || cpOf(c).toLowerCase().includes(s) || String(c.prompt || '').toLowerCase().includes(s));
    }

    /** The desktop applet's server search (fuzzy names), from 2 letters; local matches show at once. */
    function runSearch() {
        clearTimeout(searchTimer);
        hits = null;
        const q = search;
        if (q.length < 2 || !K.connected() || !window.wsClient || typeof window.wsClient.searchCharacters !== 'function') return;
        if (!subscribed && typeof window.wsClient.on === 'function') { subscribed = true; window.wsClient.on('search_results_update', onSearchResults); }
        searchTimer = setTimeout(() => {
            searchReq = `wm_char_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const model = (document.getElementById('manualModel') || {}).value || 'v4_5';
            try {
                window.wsClient.searchCharacters(q, model, {
                    requestId: searchReq,
                    autofillSessionId: SESSION,
                    autofillSettings: { spellcheck: false, thesaurus: false, naiAnimeTags: false, naiFurryTags: false, dbAnimeTags: false, dbFurryTags: false, wikiPreviews: false, resultTypeFilter: 'characters', maxResults: 50 }
                });
            } catch (_) { /* local matches stay */ }
        }, 150);
    }

    function onSearchResults(message) {
        if (!message || message.service !== 'characters' || message.autofillSessionId !== SESSION) return;
        if (searchReq && message.requestId && message.requestId !== searchReq) return;
        const results = Array.isArray(message.results) ? message.results : [];
        hits = results.slice().sort((a, b) => (b.similarity || 0) - (a.similarity || 0))
            .map((r) => (r.name ? byName(r.name) : null) || (r.character && byName(r.character.name)) || r.character || null)
            .filter(Boolean);
        if (page && view() === 'list' && search) renderList();
    }

    function searchList() {
        const seen = new Set();
        const out = [];
        // names first (starting with the text, then containing it), the server's fuzzy hits, then
        // matches in the copyright or the tags
        const q = search.toLowerCase();
        const local = localHits(search);
        const starts = local.filter((c) => c.name.toLowerCase().startsWith(q));
        const named = local.filter((c) => c.name.toLowerCase().includes(q));
        for (const c of [...starts, ...named, ...(hits || []), ...local]) {
            if (!c || !c.name || seen.has(c.name)) continue;
            seen.add(c.name);
            out.push(c);
        }
        return out;
    }

    // ---------------------------------------------------------------- rendering

    function rowHtml(key, { icon, name, sub, right, one }) {
        const sel = key === selRow;
        return `<div class="wsk-row${one ? ' is-one' : ''}${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-key="${esc(key)}">`
            + `<span class="wsk-ico"><img src="${icon}" alt="" draggable="false"></span>`
            + `<span class="wsk-name">${esc(name)}</span>${right != null ? `<span class="wsk-right">${esc(right)}</span>` : ''}`
            + (one ? '' : `<span class="wsk-sub">${esc(sub || '')}</span>`) + '</div>';
    }

    function listRows() {
        if (search) return searchList().map((c) => ({ key: `c:${c.name}`, icon: ICON, name: c.name, sub: cpOf(c) }));
        const a = applet();
        if (!a) return [];
        return a.getCopyrights().map((cp) => ({ key: `p:${cp.name}`, icon: FOLDER, name: cp.name, right: String(cp.count), one: true }));
    }

    function charRows() {
        const a = applet();
        if (!a || !copyright) return [];
        return a.getCharactersForCopyright(copyright === 'Original' ? 'Original' : copyright)
            .map((c) => ({ key: `c:${c.name}`, icon: ICON, name: c.name, sub: c.prompt || '' }));
    }

    function cardRows(c) {
        if (!c) return [];
        const rows = [{ key: 't:base', label: 'Tags', text: c.prompt || '' }];
        (Array.isArray(c.enhancers) ? c.enhancers : []).forEach((g, n) => {
            if (Array.isArray(g) && g.length) rows.push({ key: `t:${n}`, label: `Overload ${n + 1}`, text: applet().joinOverloadText(c, g) });
        });
        return rows;
    }

    function fillList(box, rows, emptyText) {
        if (!rows.some((r) => r.key === selRow)) selRow = rows.length ? rows[0].key : null;
        box.querySelector('.wch-rows').innerHTML = rows.map((r) => rowHtml(r.key, r)).join('');
        const note = box.querySelector('.wsk-note');
        note.hidden = rows.length > 0 || !loaded;
        note.textContent = emptyText;
    }

    function renderList() {
        const box = page.querySelector('.wch-list');
        const rows = listRows();
        const nomatch = box.querySelector('.wsk-nomatch');
        nomatch.hidden = !(search && !rows.length && loaded && (hits !== null || search.length < 2));
        nomatch.textContent = `No matches: ${search}`;
        fillList(box, rows, search ? '' : 'No characters.');
    }

    function renderChars() {
        const box = page.querySelector('.wch-chars');
        box.querySelector('.wsk-head-name').textContent = copyright || '';
        fillList(box, charRows(), 'No characters in this copyright.');
    }

    function renderCard() {
        const box = page.querySelector('.wch-card');
        const c = byName(character);
        box.querySelector('.wsk-head-name').textContent = character || '';
        if (!c) { box.querySelector('.wch-card-body').innerHTML = '<p class="wsk-note">This character is no longer in the database.</p>'; return; }
        const rows = cardRows(c);
        if (!rows.some((r) => r.key === selRow)) selRow = rows[0].key;
        box.querySelector('.wch-card-body').innerHTML = `<div class="wsk-crow"><span class="wsk-clabel">Copyright:</span><span class="wsk-cvalue">${esc(cpOf(c))}</span></div>`
            + rows.map((r) => {
                const sel = r.key === selRow;
                return `<div class="wch-trow${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-key="${esc(r.key)}"><div class="wch-tlabel">${esc(r.label)}</div><div class="wch-ttext${r.text ? '' : ' is-empty'}">${esc(r.text || '(none)')}</div></div>`;
            }).join('');
    }

    function render() {
        if (!page) return;
        const v = view();
        page.querySelector('.wch-list').hidden = v !== 'list';
        page.querySelector('.wch-chars').hidden = v !== 'chars';
        page.querySelector('.wch-card').hidden = v !== 'card';
        page.querySelector('.wch-edit').hidden = v !== 'edit';
        if (v === 'list') renderList();
        else if (v === 'chars') renderChars();
        else if (v === 'card') renderCard();
        if (isCurrent()) {
            sh.setTitle(TITLE);
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    function selectKey(key) {
        selRow = key;
        page.querySelectorAll('.wch-view:not([hidden]) [data-key]').forEach((r) => {
            const on = r.dataset.key === key;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    // ---------------------------------------------------------------- navigation

    function push(layer) {
        layers.push(layer);
        selRow = null;
        render();
        page.querySelector('.wch-view:not([hidden]) .wsk-scroll, .wch-view:not([hidden]) .wsk-body')?.scrollTo(0, 0);
        sh.syncHistory();
    }

    function openCopyright(name) { copyright = name; push('chars'); }

    function openCharacter(name) {
        const c = byName(name);
        if (!c) return;
        character = name;
        copyright = cpOf(c);
        push('card');
    }

    function activate(key) {
        if (!key) return;
        if (key.startsWith('p:')) openCopyright(key.slice(2));
        else if (key.startsWith('c:')) openCharacter(key.slice(2));
        else if (key.startsWith('t:')) addToStudio(selectedText());
    }

    // ---------------------------------------------------------------- actions

    function selectedText() {
        const c = byName(character);
        const r = cardRows(c).find((x) => x.key === selRow);
        return r ? r.text : '';
    }

    function selectedCharacter() {
        if (view() === 'card') return byName(character);
        return selRow && selRow.startsWith('c:') ? byName(selRow.slice(2)) : null;
    }

    /** The desktop's addToPrompt into Studio's prompt; Studio opens first when it is closed, then comes up. */
    async function addToStudio(text) {
        if (!text) return;
        const a = applet();
        if (!a) return;
        if (!K.studioOpen() && typeof window.openManualModalWithContent === 'function') {
            try { await sh.busy(() => window.openManualModalWithContent(), { paint: true }); } catch (_) { /* below */ }
        }
        if (!K.studioOpen()) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: 'Studio could not be opened.' });
            return;
        }
        a.addToPrompt(text);
        sh.open('studio');
    }

    async function copy(text) {
        if (!text) return;
        try { await K.copy(text); } catch (err) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: `The text could not be copied.\n\n${K.errText(err)}`.trim() });
        }
    }

    // ---- edit / new (the desktop's upsert)

    function openEdit(c) {
        editing = { oldName: c ? c.name : null };
        const f = page.querySelector('.wch-edit');
        f.querySelector('.wsk-head-name').textContent = c ? `Edit ${c.name}` : 'New Character';
        f.querySelector('[name="name"]').value = c ? c.name : '';
        f.querySelector('[name="copyright"]').value = c ? (c.copyright || '') : (copyright && copyright !== 'Original' ? copyright : '');
        f.querySelector('[name="prompt"]').value = c ? (c.prompt || '') : '';
        f.querySelector('[name="overloads"]').value = c && Array.isArray(c.enhancers) ? c.enhancers.filter((g) => Array.isArray(g) && g.length).map((g) => g.join(', ')).join('\n') : '';
        layers.push('edit');
        render();
        sh.syncHistory();
    }

    async function saveEdit() {
        const f = page.querySelector('.wch-edit');
        const a = applet();
        const name = f.querySelector('[name="name"]').value.trim();
        const cp = f.querySelector('[name="copyright"]').value.trim();
        const prompt = f.querySelector('[name="prompt"]').value.trim();
        const enhancers = f.querySelector('[name="overloads"]').value.split('\n')
            .map((line) => a.parseTagList(line)).filter((g) => g.length);
        if (!name) { await sh.messageBox({ title: TITLE, icon: 'warning', text: 'Enter a name.' }); return; }
        if (name !== editing.oldName && byName(name)) {
            await sh.messageBox({ title: TITLE, icon: 'warning', text: `A character named "${name}" already exists.` });
            return;
        }
        let saved = null;
        try {
            await sh.busy(async () => { saved = await a.upsertCharacter({ name, copyright: cp, prompt, enhancers }, editing.oldName || null); }, { paint: true });
        } catch (err) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: `The character could not be saved.\n\n${K.errText(err)}`.trim() });
            return;
        }
        layers.pop();
        editing = null;
        const savedName = (saved && saved.name) || name;
        character = savedName;
        copyright = cpOf(byName(savedName) || { copyright: cp });
        if (view() !== 'card') layers.push('card');
        selRow = null;
        render();
        sh.syncHistory();
    }

    async function remove(c) {
        if (!c) return;
        const yes = await sh.messageBox({ title: TITLE, icon: 'question', text: `"${c.name}" will be deleted. Continue?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        try {
            await sh.busy(() => applet().deleteCharacterByName(c.name), { paint: true });
        } catch (err) {
            await sh.messageBox({ title: TITLE, icon: 'error', text: `The character could not be deleted.\n\n${K.errText(err)}`.trim() });
            return;
        }
        if (character === c.name) {
            while (layers.length && layers[layers.length - 1] !== 'chars') layers.pop();
            character = null;
            if (!applet().getCopyrights().some((x) => x.name === copyright)) layers = [];
        }
        selRow = null;
        render();
        sh.syncHistory();
    }

    // ---------------------------------------------------------------- menus / keys

    function menu() {
        const v = view();
        const c = selectedCharacter();
        const items = [];
        if (v === 'card') {
            const text = selectedText();
            items.push({ label: 'Add to Studio', disabled: !text, action: () => addToStudio(text) });
            items.push({ label: 'Copy', disabled: !text, action: () => copy(text) });
            items.push({ label: 'Copy Name', action: () => copy(character) });
            items.push('-');
        } else if (c) {
            items.push({ label: 'Open', action: () => openCharacter(c.name) });
            items.push({ label: 'Add to Studio', disabled: !c.prompt, action: () => addToStudio(c.prompt) });
            items.push({ label: 'Copy Tags', disabled: !c.prompt, action: () => copy(c.prompt) });
            items.push('-');
        } else if (selRow && selRow.startsWith('p:')) {
            items.push({ label: 'Open', action: () => openCopyright(selRow.slice(2)) }, '-');
        }
        // the database's writes are the admin's (the server refuses the rest: 235-characterDbHandler.js)
        if (isAdmin()) items.push({ label: 'New Character...', action: () => openEdit(null) });
        if (c && isAdmin()) {
            items.push({ label: 'Edit...', action: () => openEdit(c) });
            items.push({ label: 'Delete', action: () => remove(c) });
        }
        items.push('-', { label: 'Refresh', action: () => refresh(true) });
        return items;
    }

    function softKeys() {
        const v = view();
        if (v === 'edit') return { left: { label: 'Cancel', action: () => { sh.back(); } }, right: { label: 'Save', action: saveEdit } };
        if (v === 'card') {
            const text = selectedText();
            return { left: { label: 'Add', disabled: !text, action: () => addToStudio(text) }, right: { label: 'Menu', menu } };
        }
        return { left: { label: 'Open', disabled: !selRow, action: () => activate(selRow) }, right: { label: 'Menu', menu } };
    }

    // ---------------------------------------------------------------- desktop route

    function patchApplet() {
        const a = applet();
        if (!a || a.wmPatched) return;
        a.wmPatched = true;
        a.open = () => sh.open(APP_ID);
    }

    // ---------------------------------------------------------------- page

    function mount(p) {
        page = p;
        p.classList.add('wsk', 'wm-characters');
        p.innerHTML = `
            <div class="wsk-view is-list wch-view wch-list">
                <div class="wsk-searchbar"><input class="wsk-search wch-search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Enter a name..." aria-label="Enter a name"></div>
                <div class="wsk-nomatch" hidden></div>
                <div class="wsk-scroll"><div class="wch-rows" role="listbox" aria-label="Copyrights"></div><p class="wsk-note" hidden></p></div>
            </div>
            <div class="wsk-view is-list wch-view wch-chars" hidden>
                <div class="wsk-head"><img src="${FOLDER}" alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsk-scroll"><div class="wch-rows" role="listbox" aria-label="Characters"></div><p class="wsk-note" hidden></p></div>
            </div>
            <div class="wsk-view wch-view wch-card" hidden>
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsk-body wch-card-body" role="listbox"></div>
            </div>
            <form class="wsk-view wch-view wch-edit" hidden autocomplete="off">
                <div class="wsk-head"><img ${K.artAttrs(ICON)} alt="" draggable="false"><span class="wsk-head-name"></span></div>
                <div class="wsk-body">
                    <label class="wsk-field"><span class="wsk-flabel">Name:</span><input class="wsk-input" name="name" type="text" autocapitalize="off" spellcheck="false"></label>
                    <label class="wsk-field"><span class="wsk-flabel">Copyright:</span><input class="wsk-input" name="copyright" type="text" autocapitalize="off" spellcheck="false" placeholder="Original"></label>
                    <label class="wsk-field is-tall"><span class="wsk-flabel">Tags:</span><textarea class="wsk-textarea" name="prompt" autocapitalize="off" spellcheck="false"></textarea></label>
                    <label class="wsk-field is-tall"><span class="wsk-flabel">Overloads:</span><textarea class="wsk-textarea" name="overloads" autocapitalize="off" spellcheck="false" placeholder="One group of extra tags per line"></textarea></label>
                </div>
            </form>`;
        p.querySelector('.wch-edit').addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
        const searchEl = p.querySelector('.wch-search');
        searchEl.value = search;
        searchEl.addEventListener('input', () => {
            search = searchEl.value.trim();
            selRow = null;
            runSearch();
            renderList();
            if (isCurrent()) sh.refreshSoftKeys();
        });
        searchEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); activate(selRow); } });
        for (const sel of ['.wch-list .wsk-scroll', '.wch-chars .wsk-scroll', '.wch-card-body']) {
            const el = p.querySelector(sel);
            K.onHold(el, '[data-key]', (row, x, y) => { selectKey(row.dataset.key); sh.menuAt(x, y, menu()); });
            el.addEventListener('click', (e) => {
                const row = e.target.closest('[data-key]');
                if (!row) return;
                // the card's rows select on the first tap (Add / Menu act on them); lists open
                if (row.dataset.key.startsWith('t:') && row.dataset.key !== selRow) { selectKey(row.dataset.key); return; }
                if (row.dataset.key.startsWith('t:')) return;
                selectKey(row.dataset.key);
                activate(row.dataset.key);
            });
        }
        render();
    }

    function register() {
        sh = window.wmShell;
        K = window.wmSuiteKit;
        if (!sh || typeof sh.registerApp !== 'function' || !K) return;
        K.afterFeature('character_db', patchApplet);
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
                if (!loaded) refresh(false);
            },
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            historyDepth: () => layers.length,
            onTitleOk() {
                // ok on the form saves it (WM: ok = done); elsewhere the shell steps back
                if (view() === 'edit') { saveEdit(); return true; }
                return false;
            },
            onBack() {
                if (!layers.length) return false;
                const was = layers.pop();
                if (was === 'edit') editing = null;
                selRow = was === 'card' && character ? `c:${character}` : was === 'chars' && copyright ? `p:${copyright}` : null;
                render();
                return true;
            },
            closeQuestion: () => (view() === 'edit' ? 'The character has not been saved. Close Characters anyway?' : null),
            softKeys
        });
    }

    if (window.wmShell && window.wmSuiteKit) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
