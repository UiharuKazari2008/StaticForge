/**
 * Melaton Mobile: DreamStudio part - Expanders (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelExpanders.js adds what it needs).
 *
 * Global Expanders (the desktop's Prompt > Text Expanders console, mmcExpanders.js; the Inspector's
 * Actions > Global Expanders): a page with the find box (names and texts), the type filter and the
 * Favorite Expanders switch side by side over one scrolling list (!name, its text, a die for a random
 * choice, a star for a favorite). A tap opens the expander (its name and choices: Add / Remove / Move
 * Up / Move Down work on the choice last touched; Save, Delete); tap-and-hold gives the console's row
 * commands (Insert into Prompt, Copy !name, Copy Text, Favorites, Duplicate..., Rename..., Delete,
 * Export..., Properties). Menu: New Expander..., Import Expanders..., Export Expanders..., Export
 * List..., Local Expanders, Refresh.
 *
 * Local Expanders (Tools > Request Body Replacements, the Inspector's Actions > Local Expanders: the
 * desktop's Text Expanders [Embedded], requestBodyReplacementsModal.js): the request's own expanders,
 * a row each (Phasewalker's lock, name, extend / replace, text or random, the stages). A tap opens the
 * rule: name, Extend, the stage configuration (All, Select: a check list of the pipeline's stages,
 * Range: From / To as LCDs with a jog, typed on the number pad), the values. Menu: New Expander...,
 * Make Global... (expanderMakeGlobalWizard.js as one dialog), Global Expanders.
 *
 * Pages: 'expanders-global', 'expanders-local', and 'expanders' (the global page, for api.openView).
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;
    window.wmDreamStudio.extend('Expanders', (api, reg) => {
        const M = () => api.M;
        const esc = api.esc;
        const ui = () => api.ui;
        const sh = () => api.sh;
        const icon = (cls) => api.toolIcon(cls);
        const toList = (v) => (Array.isArray(v) ? v.map(String) : (v == null || v === '' ? [] : [String(v)]));
        const fromList = (list) => (list.length === 1 ? list[0] : list.slice());
        const plural = (n, one, many) => `${Number(n || 0).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;
        const errText = (err) => String((err && (err.message || err.error)) || err || '').trim();
        const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

        const box = (title, text, ic = 'info') => sh().messageBox({ title, text, icon: ic, modal: true });
        const ask = (title, text, ic = 'warning') => sh().messageBox({ title, text, icon: ic, modal: true, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false });
        const busy = (p) => sh().busy(p, { delay: 250 });
        // a dialog's own error line (the desktop console's dlgError); a message box would open under the dialog
        const ERR = '<p class="wm-form-note wdx-err" role="alert" hidden></p>';
        const dlgErr = (el, text) => { const p = el.querySelector('.wdx-err'); if (p) { p.textContent = text || ''; p.hidden = !text; } };
        const tool = (act, label, cls, extra = '') => `<button type="button" class="wm-tool" data-x="${act}" aria-label="${esc(label)}" title="${esc(label)}"${extra}>${icon(cls)}</button>`;

        /**
         * Tap-and-hold (and right click) on rows: fn(row, x, y). The shell draws the hold ring and sends a
         * contextmenu at the pen point when it is whole (wmShell.js bindHoldRing); a mouse sends its own.
         */
        function onHold(el, selector, fn) {
            el.addEventListener('contextmenu', (e) => {
                const row = e.target.closest && e.target.closest(selector);
                if (!row) return;
                e.preventDefault();
                fn(row, e.clientX, e.clientY);
            });
        }

        /** A file onto the phone (the shell's Save to Phone, which DSApp also takes). */
        function saveFile(name, text, type) {
            const url = URL.createObjectURL(new Blob([text], { type }));
            Promise.resolve(sh().saveToPhone(url, name)).finally(() => setTimeout(() => URL.revokeObjectURL(url), 120000));
        }

        async function copy(text, what) {
            try {
                /* global copyTextToClipboard */
                if (typeof copyTextToClipboard === 'function') await copyTextToClipboard(text);
                else await navigator.clipboard.writeText(text);
            } catch (err) {
                box('Copy', `${what} could not be copied. ${errText(err)}`.trim(), 'error');
            }
        }

        // ------------------------------------------------------------ the choices (both dialogs)

        /**
         * The value's choices as framed text boxes, one each; the tools work on the one last touched.
         * Returns { values(): trimmed non-empty texts }.
         */
        function choicesEditor(el, list, onCount) {
            const host = el.querySelector('.wdx-choices');
            let sel = list.length ? 0 : -1;
            const read = () => [...host.querySelectorAll('textarea')].map((t) => t.value);
            const fill = (items, focus) => {
                host.innerHTML = items.map((t, i) => `<textarea class="wm-edit wdx-choice${i === sel ? ' is-sel' : ''}" rows="2" data-i="${i}" spellcheck="false" autocapitalize="off" autocomplete="off" aria-label="Choice ${i + 1}">${esc(t)}</textarea>`).join('')
                    || '<p class="wds-none">Add gives the expander its text.</p>';
                sync(items.length);
                if (focus && sel >= 0) { const t = host.querySelector(`[data-i="${sel}"]`); if (t) { t.focus(); t.scrollIntoView({ block: 'nearest' }); } }
            };
            const sync = (n) => {
                const en = (act, on) => { const b = el.querySelector(`[data-x="${act}"]`); if (b) b.disabled = !on; };
                en('cremove', sel >= 0);
                en('cup', sel > 0);
                en('cdown', sel >= 0 && sel < n - 1);
                if (onCount) onCount(n);
            };
            host.addEventListener('focusin', (e) => {
                const t = e.target.closest && e.target.closest('textarea[data-i]');
                if (!t) return;
                sel = Number(t.dataset.i);
                host.querySelectorAll('textarea').forEach((x) => x.classList.toggle('is-sel', x === t));
                sync(host.querySelectorAll('textarea').length);
            });
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-x^="c"]');
                if (!b || b.disabled) return;
                const items = read();
                if (b.dataset.x === 'cadd') { items.push(''); sel = items.length - 1; } else if (b.dataset.x === 'cremove' && sel >= 0) { items.splice(sel, 1); sel = Math.min(sel, items.length - 1); } else if ((b.dataset.x === 'cup' || b.dataset.x === 'cdown') && sel >= 0) {
                    const j = sel + (b.dataset.x === 'cup' ? -1 : 1);
                    if (j < 0 || j >= items.length) return;
                    [items[sel], items[j]] = [items[j], items[sel]];
                    sel = j;
                } else return;
                fill(items, true);
            });
            if (!list.length) sel = 0;
            fill(list.length ? list : [''], false);
            return { values: () => read().map((t) => t.trim()).filter(Boolean) };
        }

        const choiceTools = '<div class="wm-toolbar wdx-tools">'
            + `${tool('cadd', 'Add', 'fas fa-plus')}${tool('cremove', 'Remove', 'fas fa-trash')}<span class="wm-tool-sep"></span>${tool('cup', 'Move Up', 'fas fa-arrow-up')}${tool('cdown', 'Move Down', 'fas fa-arrow-down')}`
            + '<span class="wdx-kind"></span></div><div class="wdx-choices"></div>';
        const kindText = (n) => (n > 1 ? `Random choice (${n})` : 'Text');

        // ------------------------------------------------------------ Global Expanders

        const G = { map: null, favs: [], error: '', loading: null, search: '', type: '', favOnly: false };
        const has = (k) => !!(G.map && Object.prototype.hasOwnProperty.call(G.map, k));
        const favOf = (k) => (G.favs || []).find((f) => (f.placeholder || f.name) === k) || null;
        const isRandom = (v) => Array.isArray(v) && v.length > 1;
        const GLOBAL_VIEWS = ['expanders-global', 'expanders'];
        const repaintGlobal = () => { if (GLOBAL_VIEWS.some((n) => api.view() === `x:${n}`)) api.paint(); };

        function load(force) {
            if (G.loading) return G.loading;
            if (G.map && !force) return Promise.resolve();
            G.loading = M().expLoad().then((d) => { G.map = d.map; G.favs = d.favs; G.error = ''; }).catch((err) => { G.error = errText(err) || 'The expanders could not be read.'; })
                .then(() => { G.loading = null; repaintGlobal(); });
            return G.loading;
        }
        /** After a change: the client's shared copy, then this list. */
        async function changed() { await M().expChanged(); await load(true); }

        function matches(k, v) {
            if (G.type === 'text' && isRandom(v)) return false;
            if (G.type === 'random' && !isRandom(v)) return false;
            if (!G.search) return true;
            return `${k} ${toList(v).join(' ')}`.toLowerCase().includes(G.search.toLowerCase());
        }
        function shownKeys() {
            if (!G.map) return [];
            const base = G.favOnly ? (G.favs || []).map((f) => f.placeholder || f.name).filter(Boolean) : Object.keys(G.map);
            return base.filter((k) => matches(k, has(k) ? G.map[k] : (favOf(k) || {}).replacementValue)).sort(coll.compare);
        }

        function globalSkeleton(el) {
            el.innerHTML = '<div class="wdx-bar">'
                + `${ui().edit('', G.search, 'data-x="find" placeholder="Find" aria-label="Find: names and texts" spellcheck="false" autocapitalize="off"')}`
                + `${ui().comboHtml('type', 'All types')}`
                + `${tool('favonly', 'Favorite Expanders', 'fas fa-star', ` aria-pressed="${G.favOnly}"`)}</div>`
                + '<div class="wm-listbox wdx-list"></div>';
            const find = el.querySelector('[data-x="find"]');
            let t = 0;
            find.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { G.search = find.value; drawGlobalList(el); }, 150); });
            const TYPES = [['', 'All types'], ['text', 'Text'], ['random', 'Random choice']];
            const combo = el.querySelector('[data-act="type"]');
            combo.querySelector('span').textContent = (TYPES.find((x) => x[0] === G.type) || TYPES[0])[1];
            ui().bindCombo(combo, TYPES, G.type, (v) => { G.type = v; drawGlobalList(el); });
            el.addEventListener('click', (e) => {
                const fav = e.target.closest && e.target.closest('[data-x="favonly"]');
                if (fav) { G.favOnly = !G.favOnly; fav.setAttribute('aria-pressed', String(G.favOnly)); drawGlobalList(el); return; }
                const row = e.target.closest && e.target.closest('.wdx-row');
                if (row && has(row.dataset.key)) expanderDialog(row.dataset.key);
            });
            onHold(el, '.wdx-row', (row, x, y) => {
                el.querySelectorAll('.wdx-row.is-selected').forEach((r) => r.classList.remove('is-selected'));
                row.classList.add('is-selected');
                sh().menuAt(x, y, rowMenu(row.dataset.key));
            });
        }

        function drawGlobalList(el) {
            const list = el.querySelector('.wdx-list');
            const find = el.querySelector('[data-x="find"]');
            if (!list) return;
            if (!G.map) { list.innerHTML = `<p class="wds-none">${esc(G.error || 'Reading data, please wait...')}</p>`; return; }
            const total = Object.keys(G.map).length;
            if (find) find.placeholder = G.favOnly ? `Find in ${plural((G.favs || []).length, 'favorite', 'favorites')}` : `Find in ${plural(total, 'expander', 'expanders')}`;
            const keys = shownKeys();
            if (!keys.length) {
                list.innerHTML = `<p class="wds-none">${G.search || G.type ? 'No expanders match the search.' : G.favOnly ? 'There are no favorite expanders. Tap and hold an expander for Add to Favorites.' : 'There are no global expanders. Menu &gt; New Expander makes one.'}</p>`;
                return;
            }
            list.innerHTML = keys.map((k) => {
                const v = has(k) ? G.map[k] : (favOf(k) || {}).replacementValue;
                const marks = `${isRandom(v) ? icon('fas fa-dice') : ''}${favOf(k) ? icon('fas fa-star') : ''}`;
                return `<button type="button" class="wm-listbox-row wdx-row${has(k) ? '' : ' is-gone'}" data-key="${esc(k)}"><b>!${esc(k)}</b><span class="wdx-text">${esc(toList(v).join(' | '))}</span>${marks ? `<span class="wdx-marks">${marks}</span>` : ''}</button>`;
            }).join('');
        }

        const globalSpec = {
            title: 'Global Expanders',
            mount: (el) => globalSkeleton(el),
            draw(el) { if (!G.map && !G.loading) load(); drawGlobalList(el); },
            menu: () => [
                { label: 'New Expander...', action: () => expanderDialog(null) },
                { label: 'Import Expanders...', action: importExpanders },
                { label: 'Export Expanders...', disabled: !(G.map && Object.keys(G.map).length), action: () => exportExpanders(Object.keys(G.map || {})) },
                { label: 'Export List...', disabled: !G.map, action: exportList },
                '-',
                { label: 'Local Expanders', action: () => api.openView('expanders-local') },
                { label: 'Refresh', action: () => busy(changed()) }
            ]
        };
        GLOBAL_VIEWS.forEach((n) => reg.view(n, globalSpec));

        function rowMenu(key) {
            if (!has(key)) {
                const f = favOf(key);
                return f ? [{ label: 'Remove from Favorites', action: () => toggleFavorite(key, false) }] : [];
            }
            const fav = !!favOf(key);
            return [
                { label: 'Insert into Prompt', action: () => insertIntoPrompt(key) },
                '-',
                { label: 'Copy !name', action: () => copy(`!${key}`, `!${key}`) },
                { label: 'Copy Text', action: () => copy(toList(G.map[key]).join('\n'), 'The text') },
                { label: fav ? 'Remove from Favorites' : 'Add to Favorites', action: () => toggleFavorite(key, !fav) },
                '-',
                { label: 'Duplicate...', action: () => duplicate(key) },
                { label: 'Rename...', action: () => rename(key) },
                { label: 'Delete', action: () => remove(key) },
                { label: 'Export...', action: () => exportExpanders([key]) },
                '-',
                { label: 'Properties', action: () => expanderDialog(key) }
            ];
        }

        /** "!name" or "name" -> name (the console's rule). */
        const cleanName = (s) => String(s || '').trim().replace(/^!+/, '').trim();
        const nameError = (v, except) => {
            if (!v) return 'Type a name for the expander.';
            if (v !== except && /\s/.test(v)) return 'An expander name cannot have spaces.';
            if (v !== except && has(v)) return `!${v} already exists.`;
            return '';
        };

        /** The expander's dialog (New Expander when key is null): its name and its choices. */
        function expanderDialog(key) {
            const title = key ? `!${key}` : 'New Expander';
            const el = api.openDlg(title, 'wdx-dlg', `<div class="wdx-name"><span>!</span>${ui().edit('', key || '', 'data-x="name" placeholder="name" aria-label="Name" spellcheck="false" autocapitalize="off"')}</div>`
                + choiceTools
                + `${ERR}<div class="wm-msgbox-buttons">${key ? '<button type="button" data-x="delete">Delete</button>' : ''}<button type="button" data-x="save">Save</button></div>`);
            const kind = el.querySelector('.wdx-kind');
            const ed = choicesEditor(el, key ? toList(G.map[key]) : [], (n) => { kind.textContent = kindText(n); });
            if (!key) el.querySelector('[data-x="name"]').focus();
            el.addEventListener('click', async (e) => {
                const b = e.target.closest && e.target.closest('[data-x="save"], [data-x="delete"]');
                if (!b) return;
                if (b.dataset.x === 'delete') { api.closeDlg(); await remove(key); return; }
                const name = cleanName(el.querySelector('[data-x="name"]').value);
                const err = nameError(name, key);
                if (err) { dlgErr(el, err); return; }
                const vals = ed.values();
                if (!vals.length) { dlgErr(el, 'Add at least one choice.'); return; }
                const value = fromList(vals);
                try {
                    await busy((async () => {
                        await M().expSave(name, value);
                        // a rename: the new name is saved, then the old one goes (its favorite follows)
                        const f = key ? favOf(key) : null;
                        if (key && name !== key) {
                            await M().expDelete(key);
                            if (f) await refavorite(f, name, value);
                        } else if (f && JSON.stringify(f.replacementValue) !== JSON.stringify(value)) await refavorite(f, name, value);
                        await changed();
                    })());
                } catch (err2) { dlgErr(el, `The expander was not saved. ${errText(err2)}`.trim()); return; }
                api.closeDlg();
            });
        }

        // the favorite keeps a copy of the text for the prompt menu: it follows the expander
        async function refavorite(f, name, value) {
            try { await M().expFavRemove(f.id); await M().expSave(name, value); await M().expFavAdd(name, value); } catch (_) { /* the expander itself is saved */ }
        }

        function insertIntoPrompt(key) {
            const cur = api.fieldValue('prompt') || '';
            const sep = cur.trim() && !cur.trim().endsWith(',') ? ', ' : (cur && !/\s$/.test(cur) ? ' ' : '');
            Promise.resolve(api.fieldSet('prompt', `${cur}${sep}!${key}`)).then(() => { api.refresh(); api.edReload(); });
        }

        function nameDialog(title, prompt, value, except) {
            return sh().messageBox({ title, text: prompt, input: { value }, modal: true, buttons: [{ text: 'ok', value: true, default: true }, { text: 'Cancel', value: false }], cancelValue: false })
                .then((v) => {
                    if (!v) return null;
                    const name = cleanName(v);
                    const err = nameError(name, except);
                    if (err) return box(title, err, 'warning').then(() => null);
                    return name;
                });
        }

        async function rename(key) {
            const next = await nameDialog('Rename Expander', 'Type a new name for the expander:', key, key);
            if (!next || next === key) return;
            const value = G.map[key];
            try {
                await busy((async () => {
                    await M().expSave(next, value);
                    await M().expDelete(key);
                    const f = favOf(key);
                    if (f) await refavorite(f, next, value);
                    await changed();
                })());
            } catch (err) { box('Rename Expander', `The expander could not be renamed. ${errText(err)}`.trim(), 'error'); }
        }

        async function duplicate(key) {
            let suggest = `${key}_copy`;
            for (let n = 2; has(suggest); n += 1) suggest = `${key}_copy${n}`;
            const next = await nameDialog('Duplicate Expander', 'Type a name for the copy:', suggest, null);
            if (!next) return;
            try { await busy(M().expSave(next, Array.isArray(G.map[key]) ? G.map[key].slice() : G.map[key]).then(changed)); } catch (err) { box('Duplicate Expander', `The copy could not be saved. ${errText(err)}`.trim(), 'error'); }
        }

        async function remove(key) {
            if (!has(key)) return;
            if (!(await ask('Delete Expander', `Are you sure you want to delete the expander "!${key}"?`))) return;
            try {
                await busy((async () => {
                    const f = favOf(key);
                    if (f) {
                        // its favorite goes with it; favorites_remove deletes the expander from the config too
                        await M().expFavRemove(f.id);
                        try { await M().expDelete(key); } catch (_) { /* already gone with the favorite */ }
                    } else await M().expDelete(key);
                    await changed();
                })());
            } catch (err) { box('Delete Expander', `The expander could not be deleted. ${errText(err)}`.trim(), 'error'); }
        }

        async function toggleFavorite(key, on) {
            try {
                await busy((async () => {
                    if (on) { if (!favOf(key)) await M().expFavAdd(key, G.map[key]); } else {
                        const f = favOf(key);
                        if (!f) return;
                        const value = has(key) ? G.map[key] : null;
                        await M().expFavRemove(f.id);
                        // favorites_remove deletes the expander from the config as well: saved again
                        if (value != null) await M().expSave(key, value);
                    }
                    await changed();
                })());
            } catch (err) { box('Favorites', `Favorites could not be changed. ${errText(err)}`.trim(), 'error'); }
        }

        function stamp() {
            const d = new Date();
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}${p(d.getMinutes())}`;
        }

        function exportExpanders(keys) {
            const out = {};
            keys.forEach((k) => { if (has(k)) out[k] = G.map[k]; });
            if (!Object.keys(out).length) return;
            const name = keys.length === 1 ? `${keys[0].replace(/[\\/:*?"<>|]+/g, '_')}.json` : `Expanders ${stamp()}.json`;
            saveFile(name, JSON.stringify({ format: 'melaton-expanders', version: 1, text_replacements: out }, null, 2), 'application/json');
        }

        // the console's columns (Name, Type, Choices, Text, Favorite), tab delimited, the shown rows by name
        function exportList() {
            const keys = shownKeys();
            if (G.favOnly) {
                const lines = ['Name\tText\tDate Added', ...keys.map((k) => { const f = favOf(k) || {}; return [`!${k}`, toList(has(k) ? G.map[k] : f.replacementValue).join(' | '), f.dateAdded || ''].join('\t'); })];
                saveFile('Favorite Expanders.txt', lines.join('\r\n'), 'text/plain');
                return;
            }
            const lines = ['Name\tType\tChoices\tText\tFavorite', ...keys.map((k) => [`!${k}`, isRandom(G.map[k]) ? 'Random choice' : 'Text', String(toList(G.map[k]).length), toList(G.map[k]).join(' | '), favOf(k) ? 'Yes' : ''].join('\t'))];
            saveFile('Text Expanders.txt', lines.join('\r\n'), 'text/plain');
        }

        // Import: a .json from the phone (the browser's file picker: files on the device itself)
        function importExpanders() {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json,application/json';
            input.hidden = true;
            document.body.appendChild(input);
            input.addEventListener('change', async () => {
                const f = input.files && input.files[0];
                input.remove();
                if (!f) return;
                let data = null;
                try { data = JSON.parse(await f.text()); } catch (_) { data = null; }
                const src = data && typeof data === 'object' ? (data.text_replacements && typeof data.text_replacements === 'object' ? data.text_replacements : data) : null;
                const valid = (v) => typeof v === 'string' || (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string'));
                const names = src ? Object.keys(src).filter((k) => k.trim() && !/\s/.test(k.trim()) && valid(src[k])) : [];
                if (!names.length) { box('Import Expanders', `${f.name || 'The file'} has no text expanders in it.`, 'error'); return; }
                await load();
                const clash = names.filter((k) => has(k));
                let replace = false;
                if (clash.length) {
                    const pick = await sh().messageBox({
                        title: 'Import Expanders',
                        icon: 'question',
                        modal: true,
                        text: `${plural(clash.length, 'expander', 'expanders')} in ${f.name || 'the file'} already ${clash.length === 1 ? 'exists' : 'exist'} (${clash.slice(0, 5).map((k) => `!${k}`).join(', ')}${clash.length > 5 ? ', ...' : ''}). Replace them?`,
                        buttons: [{ text: 'Replace', value: 'replace', default: true }, { text: 'Skip', value: 'skip' }, { text: 'Cancel', value: false }],
                        cancelValue: false
                    });
                    if (pick !== 'replace' && pick !== 'skip') return;
                    replace = pick === 'replace';
                }
                const out = {};
                names.forEach((k) => { if (!has(k) || replace) out[k.trim()] = src[k]; });
                if (!Object.keys(out).length) { box('Import Expanders', 'No expanders were imported.'); return; }
                try {
                    await busy(M().expSaveMany(out).then(changed));
                    box('Import Expanders', `${plural(Object.keys(out).length, 'expander was', 'expanders were')} imported.`);
                } catch (err) { box('Import Expanders', `The expanders could not be imported. ${errText(err)}`.trim(), 'error'); }
            }, { once: true });
            input.click();
        }

        // ------------------------------------------------------------ Local Expanders

        function stagesText(s) {
            if (!s) return 'All';
            if (Array.isArray(s)) return s.length ? s.join(', ') : 'All';
            if (typeof s === 'object') {
                if (s.start !== undefined && s.end !== undefined) return `${s.start}-${s.end}`;
                if (s.start !== undefined) return `${s.start}+`;
                if (s.end !== undefined) return `0-${s.end}`;
            }
            return 'All';
        }

        function drawLocal(el) {
            const list = M().localList();
            if (!list.length) { el.innerHTML = '<p class="wds-none">No request body replacements found. Menu &gt; New Expander adds one.</p>'; return; }
            el.innerHTML = `<div class="wm-listbox wdx-list wdx-local">${list.map((r) => {
                const random = Array.isArray(r.value);
                return `<button type="button" class="wm-listbox-row wdx-row wdx-lrow${r.managed ? ' is-managed' : ''}" data-i="${r.index}">`
                    + `<span class="wdx-lhead">${r.managed ? `<span title="Managed by Phasewalker">${icon('fas fa-lock')}</span>` : ''}<b>${esc(r.name)}</b>`
                    + `<span class="wdx-marks"><span title="${r.extend ? 'Extend Mode' : 'Replace Mode'}">${icon(r.extend ? 'fas fa-square-dashed-circle-plus' : 'fas fa-square-dashed')}</span>${icon(random ? 'fas fa-dice' : 'fas fa-input-text')}<span class="wdx-stages">${esc(stagesText(r.stages))}</span></span></span>`
                    + `<span class="wdx-text">${esc(toList(r.value).join(' | '))}</span></button>`;
            }).join('')}</div>`;
        }

        reg.view('expanders-local', {
            title: 'Local Expanders',
            mount(el) {
                el.addEventListener('click', (e) => {
                    const row = e.target.closest && e.target.closest('.wdx-lrow');
                    if (row) ruleDialog(Number(row.dataset.i));
                });
                onHold(el, '.wdx-lrow', (row, x, y) => {
                    const r = M().localList()[Number(row.dataset.i)];
                    if (!r) return;
                    sh().menuAt(x, y, [
                        { label: r.managed ? 'Properties' : 'Edit', action: () => ruleDialog(r.index) },
                        { label: 'Delete', disabled: r.managed, action: () => removeRule(r.index) }
                    ]);
                });
            },
            draw: drawLocal,
            menu: () => [
                { label: 'New Expander...', action: () => ruleDialog(-1) },
                { label: 'Make Global...', disabled: !M().localGroups().length, action: makeGlobalDialog },
                '-',
                { label: 'Global Expanders', action: () => api.openView('expanders-global') }
            ]
        });

        async function removeRule(index) {
            const r = M().localList()[index];
            if (!r) return false;
            if (r.managed) { box('Local Expanders', 'Managed by Phasewalker', 'warning'); return false; }
            if (!(await ask('Delete Expander', `Are you sure you want to delete the request body replacement "${r.name}"?`))) return false;
            M().localRemove(index);
            api.paint();
            return true;
        }

        /** A local expander's dialog (new when index is -1); a managed row only shows. */
        function ruleDialog(index) {
            const r = index >= 0 ? M().localList()[index] : null;
            if (index >= 0 && !r) return;
            if (r && r.managed) {
                api.openDlg(r.name, 'wdx-dlg', `${ui().note('Managed by Phasewalker')}<div class="wds-wt-row"><span class="wds-wt-name">${r.extend ? 'Extend Mode' : 'Replace Mode'}</span><span>Stages: ${esc(stagesText(r.stages))}</span></div>`
                    + `<div class="wdx-choices">${toList(r.value).map((t) => `<p class="wdx-ro">${esc(t)}</p>`).join('')}</div>`);
                return;
            }
            const stages = M().localStages();
            let extend = r ? r.extend : false;
            let mode = r && r.stages ? (Array.isArray(r.stages) ? 'specific' : 'range') : 'all';
            const picked = new Set(r && Array.isArray(r.stages) ? r.stages : []);
            const range = { start: r && r.stages && !Array.isArray(r.stages) ? r.stages.start : undefined, end: r && r.stages && !Array.isArray(r.stages) ? r.stages.end : undefined };
            const MODES = [['all', 'All'], ['specific', 'Select'], ['range', 'Range']];
            const title = r ? r.name : 'New Expander';
            const el = api.openDlg(title, 'wdx-dlg wdx-ruledlg', `<div class="wdx-name">${ui().edit('', r ? r.name : '', 'data-x="name" maxlength="50" placeholder="Name" aria-label="Name" spellcheck="false" autocapitalize="off"')}`
                + `${tool('extend', 'Extend Mode', 'fas fa-square-dashed-circle-plus', ` aria-pressed="${extend}"`)}</div>`
                + `<div class="wds-wt-row"><span class="wds-wt-name">Stages</span>${ui().comboHtml('stmode', (MODES.find((m) => m[0] === mode) || MODES[0])[1])}</div>`
                + '<div class="wdx-stagebox"></div>'
                + choiceTools
                + `${ERR}<div class="wm-msgbox-buttons">${r ? '<button type="button" data-x="delete">Delete</button>' : ''}<button type="button" data-x="save">${r ? 'Save' : 'Add'}</button></div>`);
            const kind = el.querySelector('.wdx-kind');
            const ed = choicesEditor(el, r ? toList(r.value) : [], (n) => { kind.textContent = kindText(n); });
            const stageBox = el.querySelector('.wdx-stagebox');
            const showRange = () => ['start', 'end'].forEach((k) => ui().segText(stageBox.querySelector(`[data-pad="${k}"]`), range[k] === undefined ? '!!' : String(range[k]).padStart(2, '!')));
            const fillStages = () => {
                if (mode === 'specific') {
                    stageBox.innerHTML = ui().listbox(stages.map((name, i) => ({ key: String(i), label: name, checked: picked.has(i) })), { maxHeight: 96 });
                    ui().bindListbox(stageBox.querySelector('.wm-listbox'), null, (k, on) => { if (on) picked.add(Number(k)); else picked.delete(Number(k)); });
                } else if (mode === 'range') {
                    // From / To: blank is open (the desktop's empty number boxes); the pad types, the jog rolls
                    stageBox.innerHTML = [['start', 'From Stage'], ['end', 'To Stage']].map(([k, l]) => `<div class="wds-wt-row is-on" data-rg="${k}"><span class="wds-wt-name">${l}</span><button type="button" class="wds-wt-lcd wm-lcd" data-pad="${k}" aria-label="${l}: type a value"></button></div>`).join('');
                    ['start', 'end'].forEach((k) => {
                        ui().jogWheel(stageBox.querySelector(`[data-rg="${k}"]`), { label: k === 'start' ? 'From Stage' : 'To Stage', value: range[k] || 0, min: 0, max: 99, step: 1, stepPx: 18, zeroStop: 0, onChange: (v) => { range[k] = v; showRange(); } });
                    });
                    showRange();
                } else stageBox.innerHTML = '';
            };
            fillStages();
            ui().bindCombo(el.querySelector('[data-act="stmode"]'), MODES, mode, (v) => {
                if (v !== 'all' && stages.length <= 1) {
                    const btn = el.querySelector('[data-act="stmode"] span');
                    if (btn) btn.textContent = 'All';
                    mode = 'all';
                    fillStages();
                    dlgErr(el, 'No pipeline stages available. Using "All Stages" instead.');
                    return;
                }
                mode = v;
                fillStages();
            });
            if (!r) el.querySelector('[data-x="name"]').focus();
            el.addEventListener('click', async (e) => {
                const pad = e.target.closest && e.target.closest('[data-pad]');
                if (pad) {
                    const k = pad.dataset.pad;
                    ui().numPad({
                        title: k === 'start' ? 'From Stage' : 'To Stage',
                        value: range[k] === undefined ? '' : String(range[k]),
                        max: 2,
                        onOk: (text) => {
                            if (String(text).trim() === '') range[k] = undefined;
                            else { const n = Number(text); if (!Number.isInteger(n) || n < 0) return; range[k] = n; }
                            fillStages();
                        }
                    });
                    return;
                }
                const b = e.target.closest && e.target.closest('[data-x="extend"], [data-x="save"], [data-x="delete"]');
                if (!b) return;
                if (b.dataset.x === 'extend') { extend = !extend; b.setAttribute('aria-pressed', String(extend)); b.title = extend ? 'Extend Mode' : 'Replace Mode'; return; }
                if (b.dataset.x === 'delete') { api.closeDlg(); await removeRule(index); return; }
                const name = String(el.querySelector('[data-x="name"]').value || '').trim();
                if (!name) { dlgErr(el, 'Please enter a name'); return; }
                if (!/^[a-zA-Z0-9_]+$/.test(name)) { dlgErr(el, 'Name can only contain letters, numbers, and underscores'); return; }
                const vals = ed.values();
                if (!vals.length) { dlgErr(el, 'Please enter at least one value'); return; }
                let st;
                if (mode === 'specific' && picked.size) st = [...picked].sort((a, c) => a - c);
                else if (mode === 'range') {
                    if (range.start !== undefined && range.end !== undefined && range.start > range.end) { dlgErr(el, 'Start stage cannot be greater than end stage'); return; }
                    if (range.start !== undefined || range.end !== undefined) { st = {}; if (range.start !== undefined) st.start = range.start; if (range.end !== undefined) st.end = range.end; }
                }
                const rule = { name, value: fromList(vals), extend, stages: st };
                if (r) M().localUpdate(index, rule); else M().localAdd(rule);
                api.closeDlg();
            });
        }

        /**
         * Make Global (expanderMakeGlobalWizard.js) as one dialog: the embedded expanders to convert,
         * what each becomes, what to do with a name that is already global, whether they leave the request.
         */
        async function makeGlobalDialog() {
            const items = M().localGroups();
            if (!items.length) { box('Make Global', 'This request has no embedded expanders to convert.'); return; }
            let globals = {};
            try { globals = await busy(M().localGlobals()); } catch (_) { globals = {}; }
            const chosen = new Set();
            let mode = 'merge';
            let removeAfter = true;
            const el = api.openDlg('Make Global', 'wdx-dlg wdx-mgdlg', `${ui().note('Each expander you select is saved as a global expander. Global expanders work in every request and every stage.')}<div class="wdx-mglist"></div>`
                + `<div class="wdx-mgclash">${ui().sub('When a global expander already has the name')}${ui().radio('wdxMg', 'merge', 'Merge the values', true)}${ui().radio('wdxMg', 'replace', 'Replace the global values', false)}${ui().radio('wdxMg', 'skip', 'Skip it and keep it embedded', false)}</div>`
                + `${ui().check('wdxMgRemove', 'Remove the converted expanders from this request', true, 'data-x="mgremove"')}<p class="wm-form-note wdx-mgnote"></p>`
                + `${ERR}<div class="wm-msgbox-buttons"><button type="button" data-x="mgsave" disabled>Save</button></div>`);
            const fill = () => {
                const isGlobal = (n) => Object.prototype.hasOwnProperty.call(globals, n);
                const status = (it) => (!isGlobal(it.name) ? 'new' : mode === 'merge' ? 'merge' : mode === 'replace' ? 'replace' : 'skip');
                const rows = [{ key: '*', label: 'Select all', checked: chosen.size === items.length }, ...items.map((it) => {
                    const notes = [it.merged ? `${it.count} rows` : '', it.staged ? 'stage limited' : '', it.extend ? 'extend' : ''].filter(Boolean).join(', ');
                    return { key: it.name, label: `!${it.name} (${status(it)})${notes ? ` - ${notes}` : ''}: ${toList(it.value).join(' | ')}`, checked: chosen.has(it.name) };
                })];
                const host = el.querySelector('.wdx-mglist');
                host.innerHTML = ui().listbox(rows, { maxHeight: 120 });
                ui().bindListbox(host.querySelector('.wm-listbox'), null, (k, on) => {
                    if (k === '*') { if (on) items.forEach((it) => chosen.add(it.name)); else chosen.clear(); } else if (on) chosen.add(k); else chosen.delete(k);
                    fill();
                });
                const sel = items.filter((it) => chosen.has(it.name));
                const clash = sel.some((it) => isGlobal(it.name));
                el.querySelector('.wdx-mgclash').hidden = !clash;
                const notes = [];
                if (sel.some((it) => it.staged)) notes.push('Global expanders apply to every stage; stage limits are not kept.');
                if (clash && mode === 'merge' && sel.some((it) => it.extend)) notes.push('Extend rows add their values to the global ones.');
                const note = el.querySelector('.wdx-mgnote');
                note.textContent = notes.join(' ');
                note.hidden = !notes.length;
                el.querySelector('[data-x="mgsave"]').disabled = !chosen.size;
            };
            fill();
            el.addEventListener('change', (e) => {
                const t = e.target;
                if (t && t.name === 'wdxMg') { mode = t.value; fill(); } else if (t && t.dataset && t.dataset.x === 'mgremove') removeAfter = !!t.checked;
            });
            el.addEventListener('click', async (e) => {
                const b = e.target.closest && e.target.closest('[data-x="mgsave"]');
                if (!b || b.disabled) return;
                b.disabled = true;
                let res = null;
                try { res = await busy(M().localMakeGlobal([...chosen], mode, removeAfter)); } catch (err) {
                    b.disabled = false;
                    dlgErr(el, `The expanders were not saved. ${errText(err)}`.trim());
                    return;
                }
                api.closeDlg();
                api.paint();
                if (G.map) load(true);
                const n = res.saved.length;
                const kept = removeAfter ? 'They were removed from this request.' : 'They are still embedded in this request too.';
                const lines = res.saved.map((s) => `!${s.name}: ${s.existed ? (mode === 'replace' ? 'Replaced' : 'Merged') : 'Created'}`).concat(res.skipped.map((name) => `!${name}: Skipped`));
                box('Make Global', `${n ? `${n} global expander${n === 1 ? ' was' : 's were'} saved. ${kept}${res.skipped.length ? ` ${res.skipped.length} skipped.` : ''}` : 'No expanders were saved; every one was skipped.'}\n\n${lines.join('\n')}`);
            });
        }

        // ------------------------------------------------------------ menus

        reg.menu('prompt', () => [{ label: 'Text Expanders', action: () => api.openView('expanders-global') }]);
        reg.menu('tools', () => [{ label: 'Request Body Replacements', action: () => api.openView('expanders-local') }]);
        // the shared list follows changes made elsewhere (the Inspector's Make Global, another window)
        reg.hook('show', () => { if (G.map) load(true); });
    });
})();
