/**
 * Text Expanders (Yozora #828): the MMC snap-in that manages the global text expanders
 * (prompt.config.json text_replacements, the !name expanders) on the desktop: the Toolbox / Start
 * menu Expanders, the main menu, the request's Embedded expanders' Manage. The old window
 * (textReplacementManager.js showTextReplacementManager, #textReplacementManagerModal) stays for
 * phones and the classic theme.
 *
 *   Text Expanders (Local)   counts at a glance
 *     Global Expanders       every global expander: a find box (names and texts, as the old search)
 *                            and a type filter over a sortable list (Name, Type, Choices, Text,
 *                            Favorite)
 *     Favorite Expanders     the expanders marked as favorites (favorites.json textReplacements):
 *                            the prompt menu's Favorites list
 *
 * An expander: Properties (a dialog: the name and its choices, Add / Edit / Remove / Move Up / Move
 * Down; one choice is saved as text, several are picked from at random, as the old window saved
 * them), Rename..., Duplicate..., Delete, Copy !name, Copy Text, Insert into Studio, Add to
 * Favorites / Remove from Favorites, Export.... New Expander..., Import..., Export Expanders... and
 * Export List... are the node's. Server calls are the old window's: get_text_replacements /
 * save_text_replacements / delete_text_replacement, favorites_get / favorites_add / favorites_remove;
 * after a change the text_replacements app options chunk is read again (autocomplete, Run, the token
 * counter). Renaming saves the new name, then deletes the old one. favorites_remove also deletes the
 * expander from the config, so Remove from Favorites saves it again right after.
 *
 *   window.openTextExpandersConsole(node?, opts?)   node: 'root' | 'global' | 'favorites'
 *                                                   opts: { expander (open it), search, create }
 *   window.mmcExpanders = { def(), open(node?) }      def() for mmcConsole.compose (Data Management)
 *
 * Shares window.mmcBooksKit (mmcSpellbook.js, loaded first by featureLoader 'mmc_snapins').
 * Styles: public/css/mmc-books.css (+ mmc-console.css).
 */
(function (root) {
    'use strict';

    const ID = 'textExpanders';
    const TITLE = 'Text Expanders';
    const APP = '/static_images/app_icons';
    const ICON16 = `${APP}/16/expanders.webp`;
    const ICON32 = `${APP}/32/expanders.webp`;
    const FAV16 = `${APP}/16/vista-favorites.webp`;
    const CMD = '/static_images/vista-cmdbar';

    const SS = 0x50020000;
    const EDIT = 0x50010080;
    const MULTI = 0x50211044;
    const PUSH = 0x50010000;
    const DEFPUSH = 0x50010001;
    const LV = 0x5001000D;
    const EDGE = 0x200;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const plural = (n, one, many) => `${Number(n || 0).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;
    const toList = (v) => (Array.isArray(v) ? v.map(String) : (v == null ? [] : [String(v)]));
    const fromList = (list) => (list.length === 1 ? list[0] : list.slice());
    const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
    const K = () => {
        const k = root.mmcBooksKit;
        if (!k) throw new Error('The Spellbook snap-in did not load.');
        return k;
    };
    const glob = (name) => (root.mmcBooksKit ? root.mmcBooksKit.glob(name) : root[name]);

    // ---- the server -------------------------------------------------------------------------------------

    const S = {
        map: null,        // { key: string | string[] }
        favs: null,       // [{ id, name, placeholder, replacementValue, dateAdded }]
        error: '',
        favError: '',
        consoles: new Set()
    };

    function wsc() {
        const c = root.wsClient;
        if (!c || typeof c.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        if (typeof c.isConnected === 'function' && !c.isConnected()) throw new Error('Melaton is not connected to the server.');
        return c;
    }

    async function send(type, data, banner = true) {
        const r = await wsc().sendMessage(type, data || {}, banner);
        return r && r.data && typeof r.data === 'object' && r.success === undefined ? r.data : r;
    }

    const okOf = (r) => !!(r && (r.success || (r.data && r.data.success)));
    const msgOf = (r, d) => (r && (r.error || r.message || (r.data && (r.data.error || r.data.message)))) || d;

    async function loadMap() {
        try {
            const r = await send('get_text_replacements', { page: 1, itemsPerPage: 1000000, searchTerm: '' }, false);
            S.map = (r && r.textReplacements) || {};
            S.error = '';
        } catch (err) {
            S.error = (err && err.message) || 'The expanders could not be read.';
        }
    }

    async function loadFavs() {
        try {
            const r = await send('favorites_get', {}, false);
            const f = (r && r.favorites) || (r && r.data && r.data.favorites) || {};
            S.favs = Array.isArray(f.textReplacements) ? f.textReplacements : [];
            S.favError = '';
        } catch (err) {
            S.favError = (err && err.message) || 'The favorites could not be read.';
        }
    }

    function refreshAll() {
        S.consoles.forEach((c) => {
            if (!c.modal || !c.modal.isConnected) { S.consoles.delete(c); return; }
            if (typeof c.isActive === 'function' && !c.isActive()) return;
            c.refresh();
        });
    }

    async function reload() {
        S.consoles.forEach((c) => K().busy(c, true));
        await Promise.all([loadMap(), loadFavs()]);
        S.consoles.forEach((c) => K().busy(c, false));
        refreshAll();
    }

    /** After a change: the client's shared copy (autocomplete, Run, the token counter), then this one. */
    async function changed() {
        const fn = glob('refreshAppOptionsChunk');
        if (typeof fn === 'function') { try { await fn('text_replacements'); } catch (_) { /* the list only */ } }
        await reload();
    }

    async function saveOne(key, value) {
        const r = await send('save_text_replacements', { textReplacements: { [key]: value } });
        if (!okOf(r)) throw new Error(msgOf(r, 'The expander was not saved.'));
    }

    async function deleteOne(key) {
        const r = await send('delete_text_replacement', { key });
        if (!okOf(r)) throw new Error(msgOf(r, 'The expander was not deleted.'));
    }

    const has = (k) => !!(S.map && Object.prototype.hasOwnProperty.call(S.map, k));
    const favOf = (k) => (S.favs || []).find((f) => (f.placeholder || f.name) === k) || null;
    const favById = (id) => (S.favs || []).find((f) => String(f.id) === String(id)) || null;
    const typeOf = (v) => (Array.isArray(v) && v.length > 1 ? 'Random choice' : 'Text');

    // ---- the pages --------------------------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root',
            name: TITLE,
            icon: ICON16,
            desc: 'Global text expanders',
            children: [
                { id: 'global', name: 'Global Expanders', icon: ICON16, desc: 'The !name expanders every request can use' },
                { id: 'favorites', name: 'Favorite Expanders', icon: FAV16, desc: 'Expanders in the prompt menu\'s Favorites' }
            ]
        }];
    }

    function rootPage(c) {
        const keys = S.map ? Object.keys(S.map) : [];
        const random = keys.filter((k) => Array.isArray(S.map[k]) && S.map[k].length > 1).length;
        const rows = S.map ? [
            ['Global expanders', `<span class="mmc-link" data-act="nav:global">${esc(plural(keys.length, 'expander', 'expanders'))}</span>`],
            ['Text', esc(String(keys.length - random))],
            ['Random choice', esc(String(random))],
            ['Favorites', S.favs ? `<span class="mmc-link" data-act="nav:favorites">${esc(plural(S.favs.length, 'favorite', 'favorites'))}</span>` : esc(S.favError || 'Reading data, please wait...')]
        ] : [['Global expanders', S.error ? c.state(false, S.error) : 'Reading data, please wait...']];
        return c.page(TITLE, '', [
            { id: 'mbk-ex-overview', title: 'Overview', body: c.overview(ICON32, ['A text expander is a name that stands for text: type !name in a prompt and the server puts the text in its place when the picture is made. An expander with several choices puts one of them in, picked at random.']) },
            { id: 'mbk-ex-summary', title: 'Summary', body: c.props(rows) },
            { id: 'mbk-ex-tasks', title: 'Actions', body: '<p><span class="mmc-link" data-act="new">New Expander...</span></p><p><span class="mmc-link" data-act="import">Import Expanders...</span></p>' }
        ]);
    }

    const COLS = [
        { key: 'name', t: 'Name', w: 170, text: (d) => `!${d.key}` },
        { key: 'type', t: 'Type', w: 100, text: (d) => typeOf(d.value) },
        { key: 'count', t: 'Choices', w: 56, num: true, value: (d) => toList(d.value).length, text: (d) => String(toList(d.value).length) },
        { key: 'text', t: 'Text', w: 380, text: (d) => toList(d.value).join(' | ') },
        { key: 'fav', t: 'Favorite', w: 60, text: (d) => (favOf(d.key) ? 'Yes' : '') }
    ];

    const viewOf = (c) => { c.data.search = c.data.search || ''; c.data.type = c.data.type || ''; return c.data; };

    function matches(k, v, q, type) {
        if (type === 'text' && typeOf(v) !== 'Text') return false;
        if (type === 'random' && typeOf(v) !== 'Random choice') return false;
        if (!q) return true;
        return `${k} ${toList(v).join(' ')}`.toLowerCase().includes(q.toLowerCase());
    }

    function rows(c) {
        const v = viewOf(c);
        return Object.keys(S.map || {}).filter((k) => matches(k, S.map[k], v.search, v.type))
            .map((k) => ({ key: k, data: { key: k, value: S.map[k] }, icon: ICON16 }));
    }

    function list(c) {
        const v = viewOf(c);
        return c.listView(COLS, rows(c), { sortId: 'mbk-expanders', sort: { key: 'name', dir: 1 }, empty: v.search || v.type ? 'No expanders match the search.' : 'There are no global expanders. Use New Expander to make one.' });
    }

    function globalPage(c) {
        if (!S.map) return { html: `<div class="mmc-empty">${S.error ? esc(S.error) : 'Reading data, please wait...'}</div>`, list: true };
        const v = viewOf(c);
        const types = [{ value: '', text: 'All types' }, { value: 'text', text: 'Text' }, { value: 'random', text: 'Random choice' }];
        const html = `<div class="mbk-page">
            <div class="mbk-bar">
                <label class="mbk-find"><span>F<u>i</u>nd:</span><input type="text" class="mbk-search" data-field="mbk-ex-search" value="${esc(v.search)}" placeholder="Names and texts" autocomplete="off" spellcheck="false"></label>
                <label><span>Type:</span><select class="vdt-select mbk-filter" data-field="mbk-ex-type">${types.map((o) => `<option value="${o.value}"${o.value === v.type ? ' selected' : ''}>${o.text}</option>`).join('')}</select></label>
            </div>
            ${list(c)}
        </div>`;
        return {
            html,
            list: true,
            mount: (pane) => {
                const input = pane.querySelector('.mbk-search');
                const sel = pane.querySelector('.mbk-filter');
                let t = 0;
                if (input) {
                    input.addEventListener('input', () => {
                        clearTimeout(t);
                        t = setTimeout(() => { v.search = input.value; K().repaintList(c, list(c)); c.note(''); }, 150);
                    });
                    input.addEventListener('keydown', (ev) => {
                        if (ev.key === 'ArrowDown') { ev.preventDefault(); const l = pane.querySelector('.mmc-list'); if (l) l.focus(); }
                    });
                }
                if (sel) sel.addEventListener('change', () => { v.type = sel.value; K().repaintList(c, list(c)); c.note(''); });
            }
        };
    }

    const FCOLS = [
        { key: 'name', t: 'Name', w: 170, text: (f) => `!${f.placeholder || f.name || ''}` },
        { key: 'text', t: 'Text', w: 380, text: (f) => { const k = f.placeholder || f.name; return has(k) ? toList(S.map[k]).join(' | ') : toList(f.replacementValue).join(' | '); } },
        { key: 'added', t: 'Date Added', w: 130, value: (f) => (f.dateAdded ? Date.parse(f.dateAdded) || 0 : 0), text: (f) => (root.mmcConsole ? root.mmcConsole.when(f.dateAdded) : String(f.dateAdded || '')) }
    ];

    function favoritesPage(c) {
        if (!S.favs) return { html: `<div class="mmc-empty">${S.favError ? esc(S.favError) : 'Reading data, please wait...'}</div>`, list: true };
        const r = S.favs.map((f) => ({ key: f.id, data: f, icon: FAV16 }));
        return { html: c.listView(FCOLS, r, { sortId: 'mbk-ex-favs', sort: { key: 'name', dir: 1 }, empty: 'There are no favorite expanders. Select an expander and use Add to Favorites.' }), list: true };
    }

    function page(node, c) {
        if (node.id === 'global') return globalPage(c);
        if (node.id === 'favorites') return favoritesPage(c);
        return rootPage(c);
    }

    // ---- dialogs ------------------------------------------------------------------------------------------

    function templates() {
        const T = {
            'mbkx:expander': { t: 'Expander', w: 262, h: 214, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 9, 30, 8, SS, '&Name:', 0], [109, 'S', 40, 9, 6, 8, SS, '!', 0], [102, 'E', 47, 7, 208, 13, EDIT, '', EDGE],
                [103, 'S', 7, 26, 30, 8, SS, 'Type:', 0], [104, 'S', 47, 26, 208, 8, SS, '', 0],
                [105, 'S', 7, 41, 200, 8, SS, '&Choices:', 0],
                [106, 'SysListView32', 7, 52, 190, 134, LV, '', EDGE],
                [110, 'B', 203, 52, 52, 14, PUSH, '&Add...', 0],
                [111, 'B', 203, 70, 52, 14, PUSH, '&Edit...', 0],
                [112, 'B', 203, 88, 52, 14, PUSH, '&Remove', 0],
                [113, 'B', 203, 112, 52, 14, PUSH, 'Move &Up', 0],
                [114, 'B', 203, 130, 52, 14, PUSH, 'Move &Down', 0],
                [107, 'S', 7, 190, 140, 20, SS, '', 0],
                [1, 'B', 151, 193, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 193, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'mbkx:choice': { t: 'Choice', w: 262, h: 122, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 248, 8, SS, '&Text:', 0],
                [102, 'E', 7, 18, 248, 76, MULTI, '', EDGE],
                [103, 'S', 7, 98, 140, 20, SS, '', 0],
                [1, 'B', 151, 101, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 101, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'mbkx:name': { t: 'Name', w: 232, h: 64, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 218, 8, SS, '', 0],
                [102, 'E', 7, 18, 218, 13, EDIT, '', EDGE],
                [103, 'S', 7, 36, 110, 24, SS, '', 0],
                [1, 'B', 121, 43, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 175, 43, 50, 14, PUSH, 'Cancel', 0]
            ] }
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function dialogApi() {
        const api = root.vistaDialogTemplate;
        if (!api || typeof api.openDialog !== 'function') throw new Error('The dialog could not be shown.');
        templates();
        return api;
    }

    /** "!name" or "name" -> name; the old window's keys are plain text without spaces at the ends. */
    const cleanName = (s) => String(s || '').trim().replace(/^!+/, '').trim();

    const nameCheck = (except) => (v) => {
        if (!v) return 'Type a name for the expander.';
        if (v !== except && /\s/.test(v)) return 'An expander name cannot have spaces.';
        if (v !== except && has(v)) return `!${v} already exists.`;
        return '';
    };

    function nameDialog(c, { id, title, prompt, value, check }) {
        const api = dialogApi();
        return new Promise((resolve) => {
            let result = null;
            api.openDialog({
                id, key: 'mbkx:name', title, owner: c.modal, focusFirst: true,
                init: (ctx) => { ctx.text(101, prompt); ctx.set(102, value || ''); },
                ok: (ctx) => {
                    const v = cleanName(ctx.get(102));
                    const err = check(v);
                    if (err) { K().dlgError(ctx, 103, err); return false; }
                    result = v;
                    return true;
                },
                close: () => resolve(result)
            });
        });
    }

    const open = new Map();

    /** The expander's dialog (New Expander when key is null): the name and the choices. */
    function expanderDialog(c, key) {
        const have = open.get(key || '\n');
        if (have && have.modal && have.modal.isConnected) { if (typeof root.bringModalToFront === 'function') root.bringModalToFront(have.modal); return; }
        const api = dialogApi();
        const choices = key ? toList(S.map[key]) : [];
        const kit = K();
        const paint = (ctx, sel) => {
            kit.fillList(ctx.el(106), [{ t: '#', w: 26 }, { t: 'Text', w: 240 }], choices.map((t, i) => ({ cells: [String(i + 1), t], sel: i === sel })), 'Use Add to give the expander its text.');
            ctx.text(104, choices.length > 1 ? `Random choice (${choices.length} choices)` : (choices.length ? 'Text' : ''));
            const i = kit.selectedRow(ctx.el(106));
            ctx.enable(111, i >= 0);
            ctx.enable(112, i >= 0);
            ctx.enable(113, i > 0);
            ctx.enable(114, i >= 0 && i < choices.length - 1);
        };
        const editChoice = (ctx, i) => {
            api.openDialog({
                id: 'textExpandersChoiceDialog', key: 'mbkx:choice', title: i >= 0 ? 'Edit Choice' : 'Add Choice', owner: ctx.modal, focusFirst: true,
                init: (d) => { d.set(102, i >= 0 ? choices[i] : ''); },
                ok: (d) => {
                    const t = String(d.get(102) || '').trim();
                    if (!t) { kit.dlgError(d, 103, 'Type the text.'); return false; }
                    if (i >= 0) choices[i] = t; else choices.push(t);
                    paint(ctx, i >= 0 ? i : choices.length - 1);
                    return true;
                }
            });
        };
        const move = (ctx, d) => {
            const i = kit.selectedRow(ctx.el(106));
            const j = i + d;
            if (i < 0 || j < 0 || j >= choices.length) return;
            [choices[i], choices[j]] = [choices[j], choices[i]];
            paint(ctx, j);
        };
        const ctx0 = api.openDialog({
            id: 'textExpandersExpanderDialog',
            key: 'mbkx:expander',
            title: key ? `!${key} Properties` : 'New Expander',
            owner: c.modal,
            icon: ICON16,
            focusFirst: true,
            init: (ctx) => {
                ctx.set(102, key || '');
                paint(ctx, choices.length ? 0 : -1);
                const lv = ctx.el(106);
                lv.addEventListener('click', () => setTimeout(() => paint(ctx, kit.selectedRow(lv)), 0));
                lv.addEventListener('dblclick', (ev) => { const r = ev.target.closest('.vdt-lv-row'); if (r) editChoice(ctx, Number(r.dataset.row)); });
                lv.addEventListener('keydown', (ev) => {
                    const i = kit.selectedRow(lv);
                    if (ev.key === 'Delete' && i >= 0) { ev.preventDefault(); choices.splice(i, 1); paint(ctx, Math.min(i, choices.length - 1)); } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                        ev.preventDefault();
                        const n = Math.max(0, Math.min(choices.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)));
                        paint(ctx, n);
                    }
                });
            },
            buttons: {
                110: (ctx) => editChoice(ctx, -1),
                111: (ctx) => { const i = kit.selectedRow(ctx.el(106)); if (i >= 0) editChoice(ctx, i); },
                112: (ctx) => { const i = kit.selectedRow(ctx.el(106)); if (i >= 0) { choices.splice(i, 1); paint(ctx, Math.min(i, choices.length - 1)); } },
                113: (ctx) => move(ctx, -1),
                114: (ctx) => move(ctx, 1)
            },
            ok: async (ctx) => {
                const name = cleanName(ctx.get(102));
                const err = nameCheck(key)(name);
                if (err) { kit.dlgError(ctx, 107, err); return false; }
                const vals = choices.map((t) => String(t).trim()).filter(Boolean);
                if (!vals.length) { kit.dlgError(ctx, 107, 'Add at least one choice.'); return false; }
                const value = fromList(vals);
                try {
                    await saveOne(name, value);
                    // a rename: the new name is saved, then the old one goes (and its favorite follows)
                    if (key && name !== key) {
                        await deleteOne(key);
                        const f = favOf(key);
                        if (f) await moveFavorite(f, name, value);
                    } else if (key) {
                        const f = favOf(key);
                        if (f) await refreshFavorite(f, value);
                    }
                } catch (e2) { kit.dlgError(ctx, 107, (e2 && e2.message) || 'The expander was not saved.'); return false; }
                c.sel = name;
                c.note(key ? `!${name} was saved.` : `!${name} was made.`);
                if (c.node !== 'global') c.select('global');
                await changed();
                return true;
            },
            close: () => { open.delete(key || '\n'); }
        });
        if (ctx0) open.set(key || '\n', ctx0);
    }

    // ---- favorites --------------------------------------------------------------------------------------

    /** favorites_add for an expander writes the expander too (favorites.js addTextReplacementToConfig). */
    async function addFavorite(key) {
        const value = S.map[key];
        const item = { type: 'textReplacement', name: key, originalName: key, placeholder: key, displayName: `!${key}`, replacementValue: value, description: toList(value).join(', ') };
        const r = await send('favorites_add', { favoriteType: 'textReplacements', item });
        if (!okOf(r)) throw new Error(msgOf(r, 'The expander was not added to Favorites.'));
    }

    /** favorites_remove deletes the expander from the config as well: it is saved again right after. */
    async function removeFavorite(f, keep) {
        const k = f.placeholder || f.name;
        const value = has(k) ? S.map[k] : null;
        const r = await send('favorites_remove', { favoriteType: 'textReplacements', itemId: f.id });
        if (!okOf(r)) throw new Error(msgOf(r, 'The favorite was not removed.'));
        if (keep && value != null) await saveOne(k, value);
    }

    async function moveFavorite(f, name, value) {
        try {
            await send('favorites_remove', { favoriteType: 'textReplacements', itemId: f.id });
            S.map[name] = value;
            await addFavorite(name);
        } catch (_) { /* the expander itself is saved */ }
    }

    async function refreshFavorite(f, value) {
        // the favorite keeps a copy of the text for the prompt menu: it follows the expander
        if (JSON.stringify(f.replacementValue) === JSON.stringify(value)) return;
        try {
            const k = f.placeholder || f.name;
            await send('favorites_remove', { favoriteType: 'textReplacements', itemId: f.id });
            S.map[k] = value;
            await addFavorite(k);
        } catch (_) { /* the expander itself is saved */ }
    }

    // ---- commands ---------------------------------------------------------------------------------------

    function studioOpen() {
        const m = document.getElementById('manualModal');
        return !!(m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none');
    }

    async function insertIntoStudio(c, key) {
        const openStudio = glob('openManualModalWithContent');
        if (!studioOpen() && typeof openStudio === 'function') { try { await openStudio(); } catch (_) { /* below */ } }
        const ta = document.getElementById('manualPrompt');
        if (!studioOpen() || !ta) { await c.box('<p>Studio could not be opened.</p>', null, { icon: 'error' }); return; }
        const cur = ta.value || '';
        const sep = cur.trim() && !cur.trim().endsWith(',') ? ', ' : (cur && !/\s$/.test(cur) ? ' ' : '');
        const set = glob('setTextareaValuePreservingUndo');
        if (typeof set === 'function') set(ta, `${cur}${sep}!${key}`); else ta.value = `${cur}${sep}!${key}`;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        c.note(`!${key} was added to Studio's prompt.`);
    }

    async function rename(c, key) {
        if (!has(key)) return;
        const next = await nameDialog(c, { id: 'textExpandersRenameDialog', title: 'Rename Expander', prompt: 'Type a new name for the expander:', value: key, check: nameCheck(key) });
        if (!next || next === key) return;
        const value = S.map[key];
        try {
            await saveOne(next, value);
            await deleteOne(key);
            const f = favOf(key);
            if (f) await moveFavorite(f, next, value);
            c.sel = next;
            c.note(`!${key} was renamed to !${next}.`);
            await changed();
        } catch (err) {
            await c.box(`<p>The expander could not be renamed.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    async function duplicate(c, key) {
        if (!has(key)) return;
        let suggest = `${key}_copy`;
        for (let n = 2; has(suggest); n += 1) suggest = `${key}_copy${n}`;
        const next = await nameDialog(c, { id: 'textExpandersDuplicateDialog', title: 'Duplicate Expander', prompt: 'Type a name for the copy:', value: suggest, check: nameCheck(null) });
        if (!next) return;
        try {
            await saveOne(next, Array.isArray(S.map[key]) ? S.map[key].slice() : S.map[key]);
            c.sel = next;
            c.note(`!${next} was made from !${key}.`);
            await changed();
        } catch (err) {
            await c.box(`<p>The copy could not be saved.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    async function remove(c, key) {
        if (!has(key)) return;
        const yes = await c.box(`<p>Are you sure you want to delete the expander "!${esc(key)}"?</p>`, K().yesNo, { icon: 'warning', title: 'Delete Expander' });
        if (yes !== true) return;
        try {
            const f = favOf(key);
            if (f) {
                // its favorite goes with it; favorites_remove deletes the expander from the config too
                await removeFavorite(f, false);
                try { await deleteOne(key); } catch (_) { /* already gone with the favorite */ }
            } else {
                await deleteOne(key);
            }
            c.sel = null;
            c.note(`!${key} was deleted.`);
            await changed();
        } catch (err) {
            await c.box(`<p>The expander could not be deleted.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    async function toggleFavorite(c, key, on) {
        try {
            if (on) {
                if (favOf(key)) return;
                await addFavorite(key);
                c.note(`!${key} was added to Favorites.`);
            } else {
                const f = favOf(key);
                if (!f) return;
                await removeFavorite(f, true);
                c.note(`!${key} was removed from Favorites.`);
            }
            await changed();
        } catch (err) {
            await c.box(`<p>Favorites could not be changed.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    async function exportExpanders(c, keys) {
        const out = {};
        keys.forEach((k) => { if (has(k)) out[k] = S.map[k]; });
        if (!Object.keys(out).length) return;
        const kit = K();
        const name = keys.length === 1 ? `${keys[0].replace(/[\\/:*?"<>|]+/g, '_')}.json` : `Expanders ${kit.stamp()}.json`;
        await kit.saveText(c, name, JSON.stringify({ format: 'melaton-expanders', version: 1, text_replacements: out }, null, 2), 'Text Expanders (*.json)', 'application/json');
    }

    async function importExpanders(c) {
        const kit = K();
        const f = await kit.openText('Text Expanders (*.json)', /\.json$/i);
        if (!f) return;
        if (f.error) { await c.box(`<p>${esc(f.error)}</p>`, null, { icon: 'error' }); return; }
        let data = null;
        try { data = JSON.parse(f.text); } catch (_) { data = null; }
        const src = data && typeof data === 'object' ? (data.text_replacements && typeof data.text_replacements === 'object' ? data.text_replacements : data) : null;
        const valid = (v) => typeof v === 'string' || (Array.isArray(v) && v.length && v.every((x) => typeof x === 'string'));
        const names = src ? Object.keys(src).filter((k) => k.trim() && !/\s/.test(k.trim()) && valid(src[k])) : [];
        if (!names.length) { await c.box(`<p>${esc(f.name || 'The file')} has no text expanders in it.</p>`, null, { icon: 'error' }); return; }
        const clash = names.filter((k) => has(k));
        let replace = false;
        if (clash.length) {
            const pick = await c.box(`<p>${esc(plural(clash.length, 'expander', 'expanders'))} in ${esc(f.name || 'the file')} already ${clash.length === 1 ? 'exists' : 'exist'} (${esc(clash.slice(0, 5).map((k) => `!${k}`).join(', '))}${clash.length > 5 ? ', ...' : ''}).</p><p>Do you want to replace ${clash.length === 1 ? 'it' : 'them'}?</p>`,
                [{ text: 'Replace', value: 'replace', className: 'btn-standard primary' }, { text: 'Skip', value: 'skip', className: 'btn-standard' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question', title: 'Import Expanders' });
            if (pick !== 'replace' && pick !== 'skip') return;
            replace = pick === 'replace';
        }
        const out = {};
        names.forEach((k) => { if (!has(k) || replace) out[k.trim()] = src[k]; });
        if (!Object.keys(out).length) { c.note('No expanders were imported.'); return; }
        try {
            const r = await send('save_text_replacements', { textReplacements: out });
            if (!okOf(r)) throw new Error(msgOf(r, 'The expanders were not saved.'));
            c.note(`${plural(Object.keys(out).length, 'expander was', 'expanders were')} imported.`);
            await changed();
        } catch (err) {
            await c.box(`<p>The expanders could not be imported.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error', title: 'Import Expanders' });
        }
    }

    async function exportList(c) {
        const kit = K();
        if (c.node === 'favorites') {
            const r = (S.favs || []).map((f) => ({ data: f }));
            await kit.saveText(c, 'Favorite Expanders.txt', kit.listText(FCOLS, c.sorted(r, FCOLS, 'mbk-ex-favs', { key: 'name', dir: 1 })), 'Text (Tab Delimited) (*.txt)');
            return;
        }
        await kit.saveText(c, 'Text Expanders.txt', kit.listText(COLS, c.sorted(rows(c), COLS, 'mbk-expanders', { key: 'name', dir: 1 })), 'Text (Tab Delimited) (*.txt)');
    }

    // ---- the console's def ------------------------------------------------------------------------------

    function commands(node, c) {
        if (node.id === 'global' || node.id === 'root') {
            return [
                { text: 'New Expander...', action: 'new', icon: `${CMD}/new.png` },
                { text: 'Import Expanders...', action: 'import', icon: `${CMD}/download.png` },
                ...(node.id === 'global' ? [
                    { text: 'Export Expanders...', action: 'export-all', disabled: !(S.map && Object.keys(S.map).length) },
                    { separator: true },
                    { text: 'Find...', action: 'find', icon: `${CMD}/find.png` },
                    { text: 'Export List...', action: 'export-list', icon: 16 }
                ] : [])
            ];
        }
        if (node.id === 'favorites') return [{ text: 'Export List...', action: 'export-list', icon: 16 }];
        return [];
    }

    /** The selected row's expander name (Global Expanders: the key; Favorites: the favorite's). */
    function keyOf(node, sel) {
        if (sel == null) return null;
        if (node === 'favorites') { const f = favById(sel); return f ? (f.placeholder || f.name) : null; }
        return has(sel) ? sel : null;
    }

    function selCommands(node, sel, c) {
        const key = keyOf(node.id, sel);
        if (node.id === 'favorites') {
            const f = favById(sel);
            if (!f) return null;
            return { title: `!${f.placeholder || f.name}`, items: [
                { text: 'Insert into Studio', action: 'studio', icon: `${CMD}/new-window.png` },
                { text: 'Copy !name', action: 'copy-name', icon: `${CMD}/copy.png` },
                { separator: true },
                { text: 'Remove from Favorites', action: 'unfav', icon: `${CMD}/delete.png` },
                { separator: true },
                { text: 'Properties', action: 'open', icon: 8, disabled: !key }
            ] };
        }
        if (node.id !== 'global' || !key) return null;
        const fav = !!favOf(key);
        return { title: `!${key}`, items: [
            { text: 'Insert into Studio', action: 'studio', icon: `${CMD}/new-window.png` },
            { separator: true },
            { text: 'Copy !name', action: 'copy-name', icon: `${CMD}/copy.png` },
            { text: 'Copy Text', action: 'copy-text' },
            { text: fav ? 'Remove from Favorites' : 'Add to Favorites', action: fav ? 'unfav' : 'fav', icon: `${CMD}/favorites.png` },
            { separator: true },
            { text: 'Duplicate...', action: 'duplicate', icon: `${CMD}/copy.png` },
            { text: 'Rename...', action: 'rename', icon: `${CMD}/rename.png` },
            { text: 'Delete', action: 'delete', icon: `${CMD}/delete.png` },
            { text: 'Export...', action: 'export' },
            { separator: true },
            { text: 'Properties', action: 'open', icon: 8 }
        ] };
    }

    function toolbar(node, c) {
        if (node.id === 'global' || node.id === 'favorites') {
            const none = !keyOf(node.id, c.sel) && !(node.id === 'favorites' && favById(c.sel));
            return [
                { id: 'refresh', i: 3, title: 'Refresh' },
                { id: 'export-list', i: 16, title: 'Export List' },
                { id: 'open', i: 8, title: 'Properties', disabled: !keyOf(node.id, c.sel) },
                node.id === 'favorites' ? { id: 'unfav', i: 11, title: 'Remove from Favorites', disabled: none } : { id: 'delete', i: 11, title: 'Delete', disabled: none }
            ];
        }
        return [{ id: 'refresh', i: 3, title: 'Refresh' }];
    }

    async function action(a, c) {
        const node = c.node;
        switch (a) {
            case 'refresh': c.note(''); await reload(); return true;
            case 'new': expanderDialog(c, null); return true;
            case 'import': await importExpanders(c); return true;
            case 'export-all': await exportExpanders(c, Object.keys(S.map || {})); return true;
            case 'export-list': await exportList(c); return true;
            case 'find': { if (node !== 'global') c.select('global'); const i = c.el('.mbk-search'); if (i) { i.focus(); i.select(); } return true; }
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('text-expanders'); return true;
            default:
        }
        const key = keyOf(node, c.sel);
        if (node === 'favorites' && (a === 'unfav' || a === 'delete')) {
            const f = favById(c.sel);
            if (f) await toggleFavorite(c, f.placeholder || f.name, false);
            return true;
        }
        if (!key) return a === 'open' || a === 'delete';
        switch (a) {
            case 'open': expanderDialog(c, key); return true;
            case 'studio': await insertIntoStudio(c, key); return true;
            case 'copy-name': await K().copy(c, `!${key}`, `!${key}`); return true;
            case 'copy-text': await K().copy(c, toList(S.map[key]).join('\n'), 'The text'); return true;
            case 'fav': await toggleFavorite(c, key, true); return true;
            case 'unfav': await toggleFavorite(c, key, false); return true;
            case 'duplicate': if (node === 'global') await duplicate(c, key); return true;
            case 'rename': if (node === 'global') await rename(c, key); return true;
            case 'delete': if (node === 'global') await remove(c, key); return true;
            case 'export': await exportExpanders(c, [key]); return true;
            default: return false;
        }
    }

    function status(node, c) {
        if (node.id === 'global') {
            if (!S.map) return S.error ? 'The server did not answer.' : 'Reading data, please wait...';
            const total = Object.keys(S.map).length;
            const v = viewOf(c);
            if (!v.search && !v.type) return plural(total, 'expander', 'expanders');
            return `${rows(c).length} of ${plural(total, 'expander', 'expanders')}`;
        }
        if (node.id === 'favorites') return S.favs ? plural(S.favs.length, 'favorite', 'favorites') : 'Reading data, please wait...';
        return '';
    }

    function def() {
        return {
            id: ID,
            title: TITLE,
            icon16: ICON16,
            icon32: ICON32,
            taskbarIcon: ICON32,
            nodes,
            page,
            commands,
            selCommands,
            toolbar,
            action,
            rowOpen: (key, node, c) => { void action('open', c); },
            status,
            onSelectRow: (key, node, c) => { if (root.mmcBooksKit) root.mmcBooksKit.toolbarAgain(c); },
            about: { version: '1.0.0', lines: ['Text Expanders keeps the global !name expanders and your favorite ones.'] },
            help: () => { if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('text-expanders'); },
            onOpen: (c) => { S.consoles.add(c); void reload(); },
            onClose: (c) => { S.consoles.delete(c); }
        };
    }

    function applyOpts(c, opts) {
        const o = opts || {};
        if (o.search !== undefined) { viewOf(c).search = String(o.search || ''); c.refresh(); }
        if (o.create) expanderDialog(c, null);
        if (o.expander) {
            const want = cleanName(o.expander);
            const go = () => { if (has(want)) { c.sel = want; c.refresh(); expanderDialog(c, want); } };
            if (S.map) go(); else setTimeout(function wait(n = 0) { if (S.map) go(); else if (n < 40) setTimeout(() => wait(n + 1), 250); }, 250);
        }
    }

    async function openTextExpandersConsole(node, opts) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        const target = ['root', 'global', 'favorites'].includes(node) ? node : 'global';
        const c = root.mmcConsole.open(def(), { node: target });
        if (c && opts) applyOpts(c, opts);
        return c;
    }

    root.openTextExpandersConsole = openTextExpandersConsole;
    root.mmcExpanders = { def, open: openTextExpandersConsole, _state: S };
})(typeof window !== 'undefined' ? window : globalThis);
