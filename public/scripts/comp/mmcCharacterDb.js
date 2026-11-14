/**
 * Character Database (Yozora #831, the #828 consoles): the MMC snap-in that manages the character
 * database (modules/charactersDatabase.js, .cache/characters.db) on the desktop. Its tree is Local
 * Users and Groups' shape: the store, one folder per copyright, the characters as list rows.
 *
 *   Characters (Local)       every character: a find box over names, copyrights, prompts and
 *                            enhancers; Name, Copyright, Prompt, Enhancers columns (sortable)
 *     <copyright> (<count>)  that copyright's characters (Name, Prompt, Enhancers)
 *
 * Under the list sits Event Viewer's preview pane (View > Preview Pane): the selected character's base
 * prompt and each enhancer, with Copy and Insert into Studio for each (the old window's copy buttons).
 *
 * A character: Properties (a property sheet: General = name, copyright (an existing one or a new one:
 * the character moves), base prompt; Enhancers = the overload groups, Add / Edit / Remove / Move Up /
 * Move Down / Copy), Insert into Studio, Copy Prompt, Copy Name, Duplicate..., Move To..., Rename...,
 * Delete, Export.... A copyright: New Character..., Rename Copyright..., Delete Copyright, Copy Name,
 * Export Copyright.... The store: New Character..., New Copyright... (a copyright is kept while it has a
 * character, so it is made with its first one), Import..., Export All..., Find..., Export List....
 *
 * Server calls are the old window's (characterDbApplet.js, which phones and the classic theme keep):
 * get_character_db, character_db_upsert (oldName renames / moves), character_db_delete,
 * character_db_rename_copyright, character_db_delete_copyright; Import uses character_db_import (one
 * transaction; character_db_upsert one by one on a server without it). Writes are the Administrator's.
 *
 *   window.openCharacterDbConsole(node?, opts?)   node: 'root' | a copyright's name
 *                                                 opts: { character (select it and open it), search }
 *   window.mmcCharacterDb = { def(), open() }      def() for mmcConsole.compose (Computer Management)
 *
 * Uses window.mmcBooksKit (mmcSpellbook.js: files, clipboard, list repaint, dialog helpers).
 * Styles: public/css/mmc-chardb.css (+ mmc-console.css, mmc-books.css).
 */
(function (root) {
    'use strict';

    const ID = 'characterDb';
    const TITLE = 'Character Database';
    const APP = '/static_images/app_icons';
    const ICON16 = `${APP}/16/vista-character-database.png`;
    const ICON32 = `${APP}/32/vista-character-database.png`;
    const FOLDER16 = '/static_images/vista-icons/explorer/folder-16.png';
    const CMD = '/static_images/vista-cmdbar';

    // dialog styles (Win32)
    const SS = 0x50020000;
    const ETCHED = 0x50000010;
    const ICON = 0x50000003;
    const EDIT = 0x50010080;
    const MULTI = 0x50211044;
    const PUSH = 0x50010000;
    const DEFPUSH = 0x50010001;
    const COMBO_EDIT = 0x50210042; // CBS_DROPDOWN: an edit with the copyrights to pick from
    const LV = 0x5001000D;
    const EDGE = 0x200;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const plural = (n, one, many) => `${Number(n || 0).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;
    const short = (s, n) => { const t = String(s || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 3)}...` : t; };
    const same = (a, b) => String(a || '').toLowerCase() === String(b || '').toLowerCase();
    const cmp = (a, b) => String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true });
    const K = () => {
        const k = root.mmcBooksKit;
        if (!k) throw new Error('The Spellbook snap-in did not load.');
        return k;
    };
    const glob = (name) => (root.mmcBooksKit ? root.mmcBooksKit.glob(name) : root[name]);

    // ---- the data -----------------------------------------------------------------------------------------

    const S = {
        chars: null,      // [{ name, copyright, prompt, enhancers: string[][] }]
        error: '',
        consoles: new Set()
    };

    const cpOf = (ch) => (ch && ch.copyright) || 'Original';
    const enhOf = (ch) => (ch && Array.isArray(ch.enhancers) ? ch.enhancers.filter((g) => Array.isArray(g)) : []);
    const byName = (name) => (S.chars || []).find((ch) => same(ch.name, name)) || null;

    /** The copyrights with their counts, sorted (the server drops a copyright with no characters). */
    function copyrights() {
        const map = new Map();
        (S.chars || []).forEach((ch) => {
            const cp = cpOf(ch);
            const k = cp.toLowerCase();
            if (!map.has(k)) map.set(k, { name: cp, count: 0 });
            map.get(k).count += 1;
        });
        return Array.from(map.values()).sort((a, b) => cmp(a.name, b.name));
    }

    const cpNode = (name) => `cp:${name}`;
    const cpFromNode = (id) => (typeof id === 'string' && id.startsWith('cp:') ? id.slice(3) : null);
    const cpExists = (name) => copyrights().some((x) => same(x.name, name));
    const cpCanon = (name) => { const x = copyrights().find((y) => same(y.name, name)); return x ? x.name : name; };

    function splitTags(text) {
        return String(text || '').split(',').map((t) => t.trim()).filter(Boolean);
    }

    /** modules/charactersDatabase.js normalizeEnhancerGroups: a comma string is one group, a list of
     *  tags is one group, a list of those (strings or arrays) is several groups. */
    function normalizeEnhancers(raw) {
        if (raw == null) return [];
        if (typeof raw === 'string') {
            const t = raw.trim();
            if (!t) return [];
            if (t.charAt(0) === '[') { try { const p = JSON.parse(t); if (Array.isArray(p)) return normalizeEnhancers(p); } catch (_) { /* a comma list */ } }
            const tags = splitTags(t);
            return tags.length ? [tags] : [];
        }
        if (!Array.isArray(raw)) return [];
        const groups = [];
        const loose = [];
        const flush = () => { if (loose.length) groups.push(loose.splice(0, loose.length)); };
        raw.forEach((item) => {
            if (Array.isArray(item)) {
                flush();
                const tags = item.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim());
                if (tags.length === 1 && tags[0].includes(',')) { const sp = splitTags(tags[0]); if (sp.length) groups.push(sp); } else if (tags.length) groups.push(tags);
                return;
            }
            if (typeof item !== 'string' || !item.trim()) return;
            if (item.includes(',')) { flush(); const sp = splitTags(item); if (sp.length) groups.push(sp); return; }
            loose.push(item.trim());
        });
        flush();
        return groups;
    }

    const joinEnh = (ch, group) => {
        const p = String((ch && ch.prompt) || '').trim();
        const e = Array.isArray(group) ? group.join(', ') : '';
        if (p && e) return `${p}, ${e}`;
        return p || e;
    };

    // ---- the server ---------------------------------------------------------------------------------------

    function wsc() {
        const c = root.wsClient;
        if (!c || typeof c.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        if (typeof c.isConnected === 'function' && !c.isConnected()) throw new Error('Melaton is not connected to the server.');
        return c;
    }

    async function send(type, data) {
        return wsc().sendMessage(type, data || {}, false);
    }

    /** The server's reason: sendError's message, and its details when they are words (not a code). */
    function reason(err) {
        if (!err) return '';
        const d = err.details;
        if (typeof d === 'string' && d && !/^[A-Z0-9_]+$/.test(d)) return d;
        return err.message || String(err);
    }

    function canWrite() {
        try { return localStorage.getItem('userType') === 'admin'; } catch (_) { return false; }
    }

    function applyData(list) {
        S.chars = (Array.isArray(list) ? list : []).filter((ch) => ch && typeof ch.name === 'string')
            .map((ch) => ({ name: ch.name, copyright: cpOf(ch), prompt: typeof ch.prompt === 'string' ? ch.prompt : '', enhancers: normalizeEnhancers(ch.enhancers) }));
        S.error = '';
    }

    async function load() {
        try {
            const r = await send('get_character_db', {});
            applyData(r && Array.isArray(r.data) ? r.data : []);
        } catch (err) {
            S.error = reason(err) || 'The character database could not be read.';
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
        await load();
        S.consoles.forEach((c) => K().busy(c, false));
        refreshAll();
    }

    /** A write's reply carries the whole database (data); without it the database is read again. */
    async function took(r) {
        if (r && Array.isArray(r.data)) { applyData(r.data); refreshAll(); } else await reload();
        return r;
    }

    const upsert = async (character, oldName) => took(await send('character_db_upsert', oldName ? { character, oldName } : { character }));
    const removeChar = async (name) => took(await send('character_db_delete', { name }));
    const renameCp = async (oldCopyright, newCopyright) => took(await send('character_db_rename_copyright', { oldCopyright, newCopyright }));
    const removeCp = async (copyright) => took(await send('character_db_delete_copyright', { copyright }));

    // ---- the tree and the pages ---------------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root',
            name: 'Characters (Local)',
            icon: ICON16,
            desc: 'The character database',
            children: copyrights().map((x) => ({ id: cpNode(x.name), name: `${x.name} (${x.count.toLocaleString('en-US')})`, icon: FOLDER16, desc: plural(x.count, 'character', 'characters') }))
        }];
    }

    const COLS_ALL = [
        { key: 'name', t: 'Name', w: 170, text: (d) => d.name },
        { key: 'copyright', t: 'Copyright', w: 140, text: (d) => cpOf(d) },
        { key: 'prompt', t: 'Prompt', w: 300, text: (d) => short(d.prompt, 140) },
        { key: 'enh', t: 'Enhancers', w: 64, num: true, value: (d) => enhOf(d).length, text: (d) => String(enhOf(d).length) }
    ];
    const COLS_CP = [
        { key: 'name', t: 'Name', w: 180, text: (d) => d.name },
        { key: 'prompt', t: 'Prompt', w: 400, text: (d) => short(d.prompt, 180) },
        { key: 'enh', t: 'Enhancers', w: 64, num: true, value: (d) => enhOf(d).length, text: (d) => String(enhOf(d).length) }
    ];

    const findOf = (c, nodeId) => { c.data.find = c.data.find || {}; return c.data.find[nodeId] || ''; };
    const setFind = (c, nodeId, v) => { c.data.find = c.data.find || {}; c.data.find[nodeId] = v; };

    /** Every word of the find text in the character's name, copyright, prompt or enhancers (_ = space). */
    function matches(ch, q) {
        if (!q) return true;
        const hay = `${ch.name} ${cpOf(ch)} ${ch.prompt} ${enhOf(ch).map((g) => g.join(' ')).join(' ')}`.toLowerCase().replace(/_/g, ' ');
        return q.toLowerCase().replace(/_/g, ' ').split(/[\s,]+/).filter(Boolean).every((w) => hay.includes(w));
    }

    function rowsFor(c, nodeId) {
        const cp = cpFromNode(nodeId);
        const q = findOf(c, nodeId);
        return (S.chars || []).filter((ch) => (cp == null || same(cpOf(ch), cp)) && matches(ch, q))
            .map((ch) => ({ key: ch.name, data: ch, icon: ICON16 }));
    }

    function listHtml(c, nodeId) {
        const cp = cpFromNode(nodeId);
        const q = findOf(c, nodeId);
        const cols = cp == null ? COLS_ALL : COLS_CP;
        const empty = q ? 'No characters match the search.' : (cp == null ? 'There are no characters. Use New Character to add one.' : 'There are no characters in this copyright.');
        return c.listView(cols, rowsFor(c, nodeId), { sortId: cp == null ? 'cdb-all' : 'cdb-cp', sort: { key: 'name', dir: 1 }, empty });
    }

    const previewOn = (c) => c.reg('PreviewPane', true) !== false;

    /** Event Viewer's preview pane: the selected character. */
    function previewHtml(c) {
        const ch = byName(c.sel);
        if (!ch) return '<div class="cdb-pv-none">Select a character to see its prompt.</div>';
        const links = (copyAct, studioAct, i) => `<span class="mmc-link" data-act="${copyAct}"${i != null ? ` data-arg="${i}"` : ''}>Copy</span><span class="mmc-link" data-act="${studioAct}"${i != null ? ` data-arg="${i}"` : ''}>Insert into Studio</span>`;
        const enh = enhOf(ch);
        return `<div class="cdb-pv-head"><b>${esc(ch.name)}</b><span>${esc(cpOf(ch))}</span></div>
            <div class="cdb-pv-body" data-mmc-scroll>
                <div class="cdb-pv-item"><div class="cdb-pv-label"><span>Base prompt</span>${links('copy-prompt', 'studio')}</div><div class="cdb-pv-text">${ch.prompt ? esc(ch.prompt) : '<i>(empty)</i>'}</div></div>
                ${enh.map((g, i) => `<div class="cdb-pv-item"><div class="cdb-pv-label"><span>Enhancer ${i + 1}</span>${links('copy-enh', 'studio-enh', i)}</div><div class="cdb-pv-text">${esc(g.join(', '))}</div></div>`).join('')}
            </div>`;
    }

    function listPage(node, c) {
        if (!S.chars) return { html: `<div class="mmc-empty">${S.error ? esc(S.error) : 'Reading data, please wait...'}</div>`, list: true };
        const nodeId = node.id;
        const pv = previewOn(c);
        const html = `<div class="mbk-page cdb-page">
            <div class="mbk-bar">
                <label class="mbk-find"><span>F<u>i</u>nd:</span><input type="text" class="mbk-search" data-field="cdb-search-${esc(nodeId)}" value="${esc(findOf(c, nodeId))}" placeholder="${nodeId === 'root' ? 'Names, copyrights, prompts and enhancers' : 'Names, prompts and enhancers'}" autocomplete="off" spellcheck="false"></label>
            </div>
            ${listHtml(c, nodeId)}
            ${pv ? `<div class="cdb-hsplit"></div><div class="cdb-preview">${previewHtml(c)}</div>` : ''}
        </div>`;
        return {
            html,
            list: true,
            mount: (pane) => {
                const input = pane.querySelector('.mbk-search');
                const pvEl = pane.querySelector('.cdb-preview');
                const h = Number(c.reg('PreviewHeight', 0)) || 0;
                if (pvEl && h) pvEl.style.height = `${h}px`;
                wireHSplit(pane, c);
                let t = 0;
                if (!input) return;
                input.addEventListener('input', () => {
                    clearTimeout(t);
                    t = setTimeout(() => {
                        setFind(c, nodeId, input.value);
                        K().repaintList(c, listHtml(c, nodeId));
                        c.note('');
                    }, 150);
                });
                input.addEventListener('keydown', (ev) => {
                    if (ev.key === 'ArrowDown') { ev.preventDefault(); const l = pane.querySelector('.mmc-list'); if (l) l.focus(); }
                    if (ev.key === 'Escape' && input.value) { ev.preventDefault(); ev.stopPropagation(); input.value = ''; setFind(c, nodeId, ''); K().repaintList(c, listHtml(c, nodeId)); c.note(''); }
                });
            }
        };
    }

    /** The splitter between the list and the preview pane. */
    function wireHSplit(pane, c) {
        const split = pane.querySelector('.cdb-hsplit');
        const pv = pane.querySelector('.cdb-preview');
        if (!split || !pv) return;
        split.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            split.setPointerCapture(ev.pointerId);
            const y0 = ev.clientY;
            const h0 = pv.getBoundingClientRect().height;
            const max = Math.max(80, pane.getBoundingClientRect().height - 110);
            const move = (e) => { pv.style.height = `${Math.max(60, Math.min(max, Math.round(h0 - (e.clientY - y0))))}px`; };
            const up = () => {
                split.removeEventListener('pointermove', move);
                split.removeEventListener('pointerup', up);
                c.setReg({ PreviewHeight: Math.round(pv.getBoundingClientRect().height) });
            };
            split.addEventListener('pointermove', move);
            split.addEventListener('pointerup', up);
        });
    }

    function paintPreview(c) {
        const pane = c.el('.mmc-result');
        const pv = pane && pane.querySelector('.cdb-preview');
        if (pv) pv.innerHTML = previewHtml(c);
    }

    function page(node, c) {
        return listPage(node, c);
    }

    // ---- dialogs ------------------------------------------------------------------------------------------

    function templates() {
        const T = {
            'cdb:general': { t: 'General', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'E', 44, 10, 201, 13, EDIT, '', EDGE],
                [12, 'S', 7, 34, 238, 1, ETCHED, '', 0],
                [13, 'S', 7, 44, 50, 8, SS, '&Copyright:', 0], [14, 'C', 60, 42, 185, 120, COMBO_EDIT, '', 0],
                [15, 'S', 7, 62, 238, 8, SS, '&Base prompt:', 0],
                [16, 'E', 7, 73, 238, 100, MULTI, '', EDGE],
                [17, 'S', 7, 180, 238, 1, ETCHED, '', 0],
                [18, 'S', 7, 190, 50, 8, SS, 'Tags:', 0], [19, 'S', 60, 190, 185, 8, SS, '', 0],
                [20, 'S', 7, 202, 50, 8, SS, 'Enhancers:', 0], [21, 'S', 60, 202, 185, 8, SS, '', 0]
            ] },
            'cdb:enhancers': { t: 'Enhancers', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [30, 'S', 7, 7, 238, 8, SS, '&Enhancers:', 0],
                [31, 'SysListView32', 7, 18, 186, 193, LV, '', EDGE],
                [32, 'B', 199, 18, 46, 14, PUSH, '&Add...', 0],
                [33, 'B', 199, 36, 46, 14, PUSH, '&Edit...', 0],
                [34, 'B', 199, 54, 46, 14, PUSH, '&Remove', 0],
                [35, 'B', 199, 78, 46, 14, PUSH, 'Move &Up', 0],
                [36, 'B', 199, 96, 46, 14, PUSH, 'Move &Down', 0],
                [37, 'B', 199, 120, 46, 14, PUSH, '&Copy', 0]
            ] },
            'cdb:enhancer': { t: 'Enhancer', w: 262, h: 122, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 248, 8, SS, '&Tags (separated by commas):', 0],
                [102, 'E', 7, 18, 248, 76, MULTI, '', EDGE],
                [103, 'S', 7, 98, 140, 20, SS, '', 0],
                [1, 'B', 151, 101, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 101, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'cdb:new': { t: 'New Character', w: 262, h: 172, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 9, 50, 8, SS, '&Name:', 0], [102, 'E', 60, 7, 195, 13, EDIT, '', EDGE],
                [103, 'S', 7, 27, 50, 8, SS, '&Copyright:', 0], [104, 'C', 60, 25, 195, 120, COMBO_EDIT, '', 0],
                [105, 'S', 7, 45, 200, 8, SS, '&Base prompt:', 0], [106, 'E', 7, 56, 248, 84, MULTI, '', EDGE],
                [107, 'S', 7, 144, 140, 24, SS, '', 0],
                [1, 'B', 151, 151, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 151, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'cdb:newcp': { t: 'New Copyright', w: 262, h: 172, f: ['MS Shell Dlg', 8], s: 0, c: [
                [103, 'S', 7, 9, 50, 8, SS, '&Copyright:', 0], [104, 'E', 60, 7, 195, 13, EDIT, '', EDGE],
                [101, 'S', 7, 27, 50, 8, SS, '&Character:', 0], [102, 'E', 60, 25, 195, 13, EDIT, '', EDGE],
                [105, 'S', 7, 45, 200, 8, SS, '&Base prompt:', 0], [106, 'E', 7, 56, 248, 84, MULTI, '', EDGE],
                [107, 'S', 7, 144, 140, 24, SS, '', 0],
                [1, 'B', 151, 151, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 151, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'cdb:name': { t: 'Name', w: 232, h: 64, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 218, 8, SS, '', 0],
                [102, 'E', 7, 18, 218, 13, EDIT, '', EDGE],
                [103, 'S', 7, 36, 110, 24, SS, '', 0],
                [1, 'B', 121, 43, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 175, 43, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'cdb:move': { t: 'Move To', w: 232, h: 64, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 218, 8, SS, '', 0],
                [102, 'C', 7, 18, 218, 120, COMBO_EDIT, '', 0],
                [103, 'S', 7, 36, 110, 24, SS, '', 0],
                [1, 'B', 121, 43, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 175, 43, 50, 14, PUSH, 'Cancel', 0]
            ] }
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function dialogApi() {
        const api = root.vistaDialogTemplate;
        if (!api || typeof api.openDialog !== 'function' || typeof api.openSheet !== 'function') throw new Error('The dialog could not be shown.');
        templates();
        return api;
    }

    const cpChoices = () => copyrights().map((x) => x.name);

    async function failBox(c, what, err, title) {
        await c.box(`<p>${esc(what)}</p>${err ? `<p>${esc(reason(err))}</p>` : ''}`, null, { icon: 'error', title: title || TITLE });
    }

    const nameCheck = (except) => (v) => {
        if (!v) return 'Type a name for the character.';
        const have = byName(v);
        if (have && !(except && same(have.name, except))) return `"${have.name}" already exists.`;
        return '';
    };

    function textDialog(c, { id, key, title, prompt, value, check, choices }) {
        const api = dialogApi();
        return new Promise((resolve) => {
            let result = null;
            api.openDialog({
                id, key, title, owner: c.modal, focusFirst: true,
                init: (ctx) => {
                    ctx.text(101, prompt);
                    if (choices) ctx.options(102, choices, value || ''); else ctx.set(102, value || '');
                },
                ok: (ctx) => {
                    const v = String(ctx.get(102) || '').trim();
                    const err = check(v);
                    if (err) { K().dlgError(ctx, 103, err); return false; }
                    result = v;
                    return true;
                },
                close: () => resolve(result)
            });
        });
    }

    /** New Character... (asCopyright: New Copyright..., the copyright and its first character). */
    function newDialog(c, asCopyright) {
        if (!canWrite()) { void denied(c); return; }
        const api = dialogApi();
        const kit = K();
        const cp0 = cpFromNode(c.node);
        api.openDialog({
            id: asCopyright ? 'characterDbNewCopyright' : 'characterDbNewCharacter',
            key: asCopyright ? 'cdb:newcp' : 'cdb:new',
            title: asCopyright ? 'New Copyright' : 'New Character',
            owner: c.modal,
            icon: ICON16,
            focusFirst: true,
            init: (ctx) => {
                if (asCopyright) ctx.set(104, '');
                else ctx.options(104, cpChoices(), cp0 || '');
            },
            ok: async (ctx) => {
                const name = String(ctx.get(102) || '').trim();
                const cp = String(ctx.get(104) || '').trim();
                if (asCopyright) {
                    if (!cp) { kit.dlgError(ctx, 107, 'Type a name for the copyright.'); return false; }
                    if (cpExists(cp)) { kit.dlgError(ctx, 107, `"${cpCanon(cp)}" already exists.`); return false; }
                }
                const err = nameCheck(null)(name);
                if (err) { kit.dlgError(ctx, 107, err); return false; }
                const copyright = cp ? cpCanon(cp) : 'Original';
                try {
                    await upsert({ name, copyright, prompt: String(ctx.get(106) || ''), enhancers: [] });
                } catch (e2) { kit.dlgError(ctx, 107, reason(e2) || 'The character was not saved.'); return false; }
                c.sel = name;
                c.note(asCopyright ? `${copyright} was made with "${name}".` : `"${name}" was added to ${copyright}.`);
                c.select(cpNode(copyright));
                c.selectRow(name);
                return true;
            }
        });
    }

    const sheets = new Map();
    let sheetSeq = 0;

    /** A character's Properties: General and Enhancers. */
    function propertiesSheet(c, name) {
        const ch0 = byName(name);
        if (!ch0) return;
        const have = sheets.get(ch0.name.toLowerCase());
        if (have && have.modal && have.modal.isConnected) { if (typeof root.bringModalToFront === 'function') root.bringModalToFront(have.modal); return; }
        const api = dialogApi();
        const kit = K();
        const ro = !canWrite();
        let current = ch0.name;
        const enh = enhOf(ch0).map((g) => g.slice());
        const lvOf = (ctx) => ctx.el(31, 'cdb:enhancers');

        const paintEnh = (ctx, sel) => {
            kit.fillList(lvOf(ctx), [{ t: '#', w: 24 }, { t: 'Tags', w: 250 }], enh.map((g, i) => ({ cells: [String(i + 1), g.join(', ')], sel: i === sel })), ro ? '' : 'Use Add to give the character an enhancer.');
            const i = kit.selectedRow(lvOf(ctx));
            ctx.enable(32, !ro);
            ctx.enable(33, !ro && i >= 0);
            ctx.enable(34, !ro && i >= 0);
            ctx.enable(35, !ro && i > 0);
            ctx.enable(36, !ro && i >= 0 && i < enh.length - 1);
            ctx.enable(37, i >= 0);
            ctx.text(21, enh.length ? String(enh.length) : 'None', 'cdb:general');
        };
        const paintTags = (ctx) => {
            const n = splitTags(ctx.get(16, 'cdb:general')).length;
            ctx.text(19, n ? String(n) : 'None', 'cdb:general');
        };
        const editEnh = (ctx, i) => {
            if (ro) return;
            api.openDialog({
                id: 'characterDbEnhancerDialog', key: 'cdb:enhancer', title: i >= 0 ? 'Edit Enhancer' : 'Add Enhancer', owner: ctx.modal, focusFirst: true,
                init: (d) => { d.set(102, i >= 0 ? enh[i].join(', ') : ''); },
                ok: (d) => {
                    const tags = splitTags(d.get(102));
                    if (!tags.length) { kit.dlgError(d, 103, 'Type at least one tag.'); return false; }
                    if (i >= 0) enh[i] = tags; else enh.push(tags);
                    paintEnh(ctx, i >= 0 ? i : enh.length - 1);
                    ctx.dirty();
                    return true;
                }
            });
        };
        const move = (ctx, d) => {
            const i = kit.selectedRow(lvOf(ctx));
            const j = i + d;
            if (ro || i < 0 || j < 0 || j >= enh.length) return;
            [enh[i], enh[j]] = [enh[j], enh[i]];
            paintEnh(ctx, j);
            ctx.dirty();
        };
        const removeEnh = (ctx) => {
            const i = kit.selectedRow(lvOf(ctx));
            if (ro || i < 0) return;
            enh.splice(i, 1);
            paintEnh(ctx, Math.min(i, enh.length - 1));
            ctx.dirty();
        };
        const formError = (ctx) => {
            const nm = String(ctx.get(11, 'cdb:general') || '').trim();
            return nameCheck(current)(nm);
        };
        const sheet = api.openSheet({
            id: `characterDbSheet${++sheetSeq}`,
            title: `${current} Properties`,
            owner: c.modal,
            icon: ICON16,
            noApply: ro,
            pages: [
                { key: 'cdb:general', overrides: { 10: { image: ICON32 } } },
                { key: 'cdb:enhancers' }
            ],
            init: (ctx) => {
                ctx.set(11, current, 'cdb:general');
                ctx.options(14, cpChoices(), cpOf(ch0), 'cdb:general');
                ctx.set(16, ch0.prompt || '', 'cdb:general');
                paintTags(ctx);
                ctx.on(16, 'input', () => paintTags(ctx), 'cdb:general');
                if (ro) {
                    [11, 14, 16].forEach((id) => { const e = ctx.el(id, 'cdb:general'); if (e) e.readOnly = true; });
                }
                paintEnh(ctx, enh.length ? 0 : -1);
                const lv = lvOf(ctx);
                if (lv) {
                    lv.addEventListener('click', () => setTimeout(() => paintEnh(ctx, kit.selectedRow(lv)), 0));
                    lv.addEventListener('dblclick', (ev) => { const r = ev.target.closest('.vdt-lv-row'); if (r) editEnh(ctx, Number(r.dataset.row)); });
                    lv.addEventListener('keydown', (ev) => {
                        const i = kit.selectedRow(lv);
                        if (ev.key === 'Delete' && i >= 0) { ev.preventDefault(); removeEnh(ctx); } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
                            ev.preventDefault();
                            paintEnh(ctx, Math.max(0, Math.min(enh.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1))));
                        }
                    });
                }
                ctx.on(32, 'click', () => editEnh(ctx, -1), 'cdb:enhancers');
                ctx.on(33, 'click', () => { const i = kit.selectedRow(lvOf(ctx)); if (i >= 0) editEnh(ctx, i); }, 'cdb:enhancers');
                ctx.on(34, 'click', () => removeEnh(ctx), 'cdb:enhancers');
                ctx.on(35, 'click', () => move(ctx, -1), 'cdb:enhancers');
                ctx.on(36, 'click', () => move(ctx, 1), 'cdb:enhancers');
                ctx.on(37, 'click', () => {
                    const i = kit.selectedRow(lvOf(ctx));
                    if (i < 0) return;
                    void kit.copy(c, joinEnh({ prompt: ctx.get(16, 'cdb:general') }, enh[i]), `The prompt with enhancer ${i + 1}`);
                }, 'cdb:enhancers');
                // OK / Apply / Enter wait for a valid name (the sheet itself closes on OK regardless)
                const guard = (ev) => {
                    if (ro) return;
                    const err = formError(ctx);
                    if (!err) return;
                    ev.preventDefault();
                    ev.stopImmediatePropagation();
                    ctx.selectPage('cdb:general');
                    void c.box(`<p>${esc(err)}</p>`, null, { icon: 'error', title: `${current} Properties` });
                };
                ctx.content.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-vdt-action="ok"], [data-vdt-action="apply"]');
                    if (b && !b.disabled) guard(ev);
                }, true);
                ctx.modal.addEventListener('keydown', (ev) => {
                    if (ev.key === 'Enter' && !ev.target.matches('button, textarea, select')) guard(ev);
                }, true);
            },
            apply: async (ctx) => {
                if (ro) return;
                const name = String(ctx.get(11, 'cdb:general') || '').trim();
                const cpTyped = String(ctx.get(14, 'cdb:general') || '').trim();
                const copyright = cpTyped ? cpCanon(cpTyped) : 'Original';
                const prompt = String(ctx.get(16, 'cdb:general') || '');
                try {
                    await upsert({ name, copyright, prompt, enhancers: enh.map((g) => g.slice()) }, current);
                    if (!same(name, current)) {
                        sheets.delete(current.toLowerCase());
                        sheets.set(name.toLowerCase(), sheet);
                    }
                    current = name;
                    const cap = ctx.modal && ctx.modal.querySelector('.modal-window-title-main span, .vdt-caption-text');
                    if (cap) cap.textContent = `${current} Properties`;
                    c.sel = name;
                    c.note(`"${name}" was saved.`);
                    const cpNow = cpFromNode(c.node);
                    if (cpNow != null && !same(cpNow, copyright)) {
                        // the character moved: its old folder may be gone (empty copyrights are dropped)
                        if (!cpExists(cpNow)) c.select(cpNode(copyright));
                    }
                    c.refresh();
                } catch (err) {
                    await failBox(c, `"${current}" could not be saved.`, err, `${current} Properties`);
                }
            },
            close: () => { sheets.delete(current.toLowerCase()); }
        });
        if (sheet) sheets.set(current.toLowerCase(), sheet);
    }

    // ---- commands -----------------------------------------------------------------------------------------

    async function denied(c) {
        await c.box('<p>Only the Administrator can change the character database.</p>', null, { icon: 'warning' });
    }

    function studioOpen() {
        const m = document.getElementById('manualModal');
        return !!(m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none');
    }

    /** Insert into Studio: the text after Studio's prompt (the old window's Add to prompt; a "--tag"
     *  takes the tag out again). Studio opens when it is closed. */
    async function insertIntoStudio(c, text, what) {
        if (!text) return;
        const openStudio = glob('openManualModalWithContent');
        if (!studioOpen() && typeof openStudio === 'function') { try { await openStudio(); } catch (_) { /* below */ } }
        const ta = document.getElementById('manualPrompt');
        if (!studioOpen() || !ta) { await c.box('<p>Studio could not be opened.</p>', null, { icon: 'error' }); return; }
        const cur = ta.value || '';
        let next;
        if (text.startsWith('--')) {
            const tag = text.slice(2).trim();
            if (!tag) return;
            const re = new RegExp(`,?\\s*${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,?`, 'gi');
            next = cur.replace(re, (m) => (m.startsWith(',') && m.endsWith(',') ? ', ' : '')).trim().replace(/^,|,$/g, '').replace(/,\s*,/g, ', ').trim();
        } else {
            const sep = cur.trim() && !cur.trim().endsWith(',') ? ', ' : (cur && !/\s$/.test(cur) ? ' ' : '');
            next = `${cur}${sep}${text}`;
        }
        const set = glob('setTextareaValuePreservingUndo');
        if (typeof set === 'function') set(ta, next); else ta.value = next;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        c.note(`${what} was added to Studio's prompt.`);
    }

    async function rename(c, name) {
        const ch = byName(name);
        if (!ch) return;
        if (!canWrite()) { await denied(c); return; }
        const next = await textDialog(c, { id: 'characterDbRename', key: 'cdb:name', title: 'Rename Character', prompt: 'Type a new name for the character:', value: ch.name, check: nameCheck(ch.name) });
        if (!next || next === ch.name) return;
        try {
            await upsert({ name: next, copyright: cpOf(ch), prompt: ch.prompt, enhancers: enhOf(ch) }, ch.name);
            c.sel = next;
            c.note(`"${ch.name}" was renamed to "${next}".`);
            c.refresh();
        } catch (err) { await failBox(c, 'The character could not be renamed.', err); }
    }

    async function duplicate(c, name) {
        const ch = byName(name);
        if (!ch) return;
        if (!canWrite()) { await denied(c); return; }
        let suggest = `${ch.name} (2)`;
        for (let n = 3; byName(suggest); n += 1) suggest = `${ch.name} (${n})`;
        const next = await textDialog(c, { id: 'characterDbDuplicate', key: 'cdb:name', title: 'Duplicate Character', prompt: 'Type a name for the copy:', value: suggest, check: nameCheck(null) });
        if (!next) return;
        try {
            await upsert({ name: next, copyright: cpOf(ch), prompt: ch.prompt, enhancers: enhOf(ch).map((g) => g.slice()) });
            c.sel = next;
            c.note(`"${next}" was made from "${ch.name}".`);
            c.refresh();
        } catch (err) { await failBox(c, 'The copy could not be saved.', err); }
    }

    async function moveTo(c, name) {
        const ch = byName(name);
        if (!ch) return;
        if (!canWrite()) { await denied(c); return; }
        const next = await textDialog(c, {
            id: 'characterDbMove', key: 'cdb:move', title: 'Move To', prompt: `Move "${ch.name}" to the copyright:`, value: cpOf(ch), choices: cpChoices(),
            check: (v) => (v ? '' : 'Type or choose a copyright.')
        });
        if (!next || same(next, cpOf(ch))) return;
        const copyright = cpCanon(next);
        const was = cpOf(ch);
        try {
            await upsert({ name: ch.name, copyright, prompt: ch.prompt, enhancers: enhOf(ch) }, ch.name);
            c.note(`"${ch.name}" was moved to ${copyright}.`);
            const cpNow = cpFromNode(c.node);
            if (cpNow != null && same(cpNow, was)) { c.select(cpNode(copyright)); c.selectRow(ch.name); } else c.refresh();
        } catch (err) { await failBox(c, 'The character could not be moved.', err); }
    }

    async function removeCharacter(c, name) {
        const ch = byName(name);
        if (!ch) return;
        if (!canWrite()) { await denied(c); return; }
        const yes = await c.box(`<p>Are you sure you want to delete "${esc(ch.name)}"?</p>`, K().yesNo, { icon: 'warning', title: 'Delete Character' });
        if (yes !== true) return;
        try {
            await removeChar(ch.name);
            c.sel = null;
            c.note(`"${ch.name}" was deleted.`);
            if (!cpExists(cpOf(ch)) && cpFromNode(c.node) != null) c.select('root');
            c.refresh();
        } catch (err) { await failBox(c, 'The character could not be deleted.', err); }
    }

    async function renameCopyright(c, cp) {
        if (!cpExists(cp)) return;
        if (!canWrite()) { await denied(c); return; }
        const next = await textDialog(c, {
            id: 'characterDbRenameCopyright', key: 'cdb:name', title: 'Rename Copyright', prompt: 'Type a new name for the copyright:', value: cp,
            check: (v) => (v ? '' : 'Type a name for the copyright.')
        });
        if (!next || next === cp) return;
        let merge = false;
        if (!same(next, cp) && cpExists(next)) {
            const yes = await c.box(`<p>${esc(cpCanon(next))} already exists.</p><p>Do you want to move the characters of ${esc(cp)} into it?</p>`, K().yesNo, { icon: 'question', title: 'Rename Copyright' });
            if (yes !== true) return;
            merge = true;
        }
        const target = merge ? cpCanon(next) : next;
        try {
            await renameCp(cp, target);
            c.note(merge ? `The characters of ${cp} were moved to ${target}.` : `${cp} was renamed to ${target}.`);
            c.select(cpNode(target));
        } catch (err) { await failBox(c, 'The copyright could not be renamed.', err); }
    }

    async function removeCopyright(c, cp) {
        const x = copyrights().find((y) => same(y.name, cp));
        if (!x) return;
        if (!canWrite()) { await denied(c); return; }
        const yes = await c.box(`<p>Are you sure you want to delete the copyright "${esc(x.name)}" and its ${esc(plural(x.count, 'character', 'characters'))}?</p><p>The characters are deleted too.</p>`, K().yesNo, { icon: 'warning', title: 'Delete Copyright' });
        if (yes !== true) return;
        try {
            await removeCp(x.name);
            c.note(`${x.name} was deleted.`);
            c.select('root');
        } catch (err) { await failBox(c, 'The copyright could not be deleted.', err); }
    }

    // ---- import and export --------------------------------------------------------------------------------

    const fileSafe = (s) => String(s || '').replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Characters';

    async function exportChars(c, list, fileName) {
        if (!list.length) return;
        const data = list.map((ch) => ({ name: ch.name, copyright: cpOf(ch), prompt: ch.prompt || '', enhancers: enhOf(ch) }));
        await K().saveText(c, `${fileSafe(fileName)}.json`, JSON.stringify({ format: 'melaton-characters', version: 1, data }, null, 2), 'Character Database (*.json)', 'application/json');
    }

    /** { data: [...] } (an export, characters.json), { characters: [...] } or a bare list. */
    function readImport(text) {
        let j = null;
        try { j = JSON.parse(text); } catch (_) { return null; }
        const list = Array.isArray(j) ? j : (j && Array.isArray(j.data) ? j.data : (j && Array.isArray(j.characters) ? j.characters : null));
        if (!list) return null;
        const seen = new Map();
        list.forEach((e) => {
            if (!e || typeof e !== 'object') return;
            const name = typeof e.name === 'string' ? e.name.trim() : '';
            if (!name) return;
            seen.set(name.toLowerCase(), {
                name,
                copyright: typeof e.copyright === 'string' && e.copyright.trim() ? e.copyright.trim() : 'Original',
                prompt: typeof e.prompt === 'string' ? e.prompt : '',
                enhancers: normalizeEnhancers(e.enhancers)
            });
        });
        return Array.from(seen.values());
    }

    async function importChars(c) {
        if (!canWrite()) { await denied(c); return; }
        const kit = K();
        const f = await kit.openText('Character Database (*.json)', /\.json$/i);
        if (!f) return;
        if (f.error) { await c.box(`<p>${esc(f.error)}</p>`, null, { icon: 'error', title: 'Import Characters' }); return; }
        const list = readImport(f.text);
        if (!list || !list.length) { await c.box(`<p>${esc(f.name || 'The file')} has no characters in it.</p>`, null, { icon: 'error', title: 'Import Characters' }); return; }
        const clash = list.filter((e) => byName(e.name));
        let replace = true;
        if (clash.length) {
            const pick = await c.box(`<p>${esc(plural(clash.length, 'character', 'characters'))} in ${esc(f.name || 'the file')} already ${clash.length === 1 ? 'exists' : 'exist'} (${esc(clash.slice(0, 5).map((e) => e.name).join(', '))}${clash.length > 5 ? ', ...' : ''}).</p><p>Do you want to replace ${clash.length === 1 ? 'it' : 'them'}?</p>`,
                [{ text: 'Replace', value: 'replace', className: 'btn-standard primary' }, { text: 'Skip', value: 'skip', className: 'btn-standard' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question', title: 'Import Characters' });
            if (pick !== 'replace' && pick !== 'skip') return;
            replace = pick === 'replace';
        }
        const out = list.filter((e) => replace || !byName(e.name)).map((e) => Object.assign({}, e, { copyright: cpExists(e.copyright) ? cpCanon(e.copyright) : e.copyright }));
        if (!out.length) { c.note('No characters were imported.'); return; }
        K().busy(c, true);
        try {
            try {
                await took(await send('character_db_import', { characters: out }));
            } catch (err) {
                // a server from before character_db_import: one by one
                if (!/unknown message type/i.test(String(err && err.message))) throw err;
                for (let i = 0; i < out.length; i += 1) {
                    c.note(`Importing ${i + 1} of ${out.length}...`);
                    const e = out[i];
                    const have = byName(e.name);
                    const r = await send('character_db_upsert', have ? { character: e, oldName: have.name } : { character: e });
                    if (r && Array.isArray(r.data)) applyData(r.data);
                }
                refreshAll();
            }
            c.note(`${plural(out.length, 'character was', 'characters were')} imported.`);
        } catch (err) {
            await reload();
            await failBox(c, 'The characters could not be imported.', err, 'Import Characters');
        } finally {
            K().busy(c, false);
        }
    }

    async function exportList(c) {
        const nodeId = c.node;
        const cp = cpFromNode(nodeId);
        const cols = cp == null ? COLS_ALL : COLS_CP;
        const full = cols.map((col) => (col.key === 'prompt' ? Object.assign({}, col, { text: (d) => d.prompt || '' }) : col));
        const rows = c.sorted(rowsFor(c, nodeId), cols, cp == null ? 'cdb-all' : 'cdb-cp', { key: 'name', dir: 1 });
        await K().saveText(c, `${fileSafe(cp == null ? 'Characters' : cp)}.txt`, K().listText(full, rows), 'Text (Tab Delimited) (*.txt)');
    }

    // ---- the console's def --------------------------------------------------------------------------------

    function commands(node, c) {
        const w = canWrite();
        const cp = cpFromNode(node.id);
        const has = !!(S.chars && S.chars.length);
        if (cp == null) {
            return [
                { text: 'New Character...', action: 'new', icon: `${CMD}/new.png`, disabled: !w },
                { text: 'New Copyright...', action: 'new-cp', icon: `${CMD}/folder.png`, disabled: !w },
                { separator: true },
                { text: 'Import...', action: 'import', icon: `${CMD}/download.png`, disabled: !w },
                { text: 'Export All...', action: 'export-all', disabled: !has },
                { separator: true },
                { text: 'Find...', action: 'find', icon: `${CMD}/find.png` },
                { text: 'Export List...', action: 'export-list', icon: 16 }
            ];
        }
        return [
            { text: 'New Character...', action: 'new', icon: `${CMD}/new.png`, disabled: !w },
            { separator: true },
            { text: 'Copy Name', action: 'copy-cp', icon: `${CMD}/copy.png` },
            { text: 'Rename Copyright...', action: 'rename-cp', icon: `${CMD}/rename.png`, disabled: !w },
            { text: 'Delete Copyright', action: 'delete-cp', icon: `${CMD}/delete.png`, disabled: !w },
            { text: 'Export Copyright...', action: 'export-cp' },
            { separator: true },
            { text: 'Find...', action: 'find', icon: `${CMD}/find.png` },
            { text: 'Export List...', action: 'export-list', icon: 16 }
        ];
    }

    function selCommands(node, sel) {
        const ch = byName(sel);
        if (!ch) return null;
        const w = canWrite();
        return { title: ch.name, items: [
            { text: 'Insert into Studio', action: 'studio', icon: `${CMD}/new-window.png` },
            { separator: true },
            { text: 'Copy Prompt', action: 'copy-prompt', icon: `${CMD}/copy.png` },
            { text: 'Copy Name', action: 'copy-name' },
            { separator: true },
            { text: 'Duplicate...', action: 'duplicate', disabled: !w },
            { text: 'Move To...', action: 'move', icon: `${CMD}/move-to.png`, disabled: !w },
            { text: 'Rename...', action: 'rename', icon: `${CMD}/rename.png`, disabled: !w },
            { text: 'Delete', action: 'delete', icon: `${CMD}/delete.png`, disabled: !w },
            { text: 'Export...', action: 'export' },
            { separator: true },
            { text: 'Properties', action: 'open', icon: 8 }
        ] };
    }

    function toolbar(node, c) {
        const ch = byName(c.sel);
        return [
            { id: 'refresh', i: 3, title: 'Refresh' },
            { id: 'export-list', i: 16, title: 'Export List' },
            { id: 'open', i: 8, title: 'Properties', disabled: !ch },
            { id: 'delete', i: 11, title: 'Delete', disabled: !ch || !canWrite() }
        ];
    }

    function viewMenu(node, c) {
        return [{ text: previewOn(c) ? 'Hide Preview Pane' : 'Show Preview Pane', action: 'preview' }];
    }

    async function action(a, c, arg) {
        const cp = cpFromNode(c.node);
        switch (a) {
            case 'refresh': c.note(''); await reload(); return true;
            case 'new': newDialog(c, false); return true;
            case 'new-cp': newDialog(c, true); return true;
            case 'import': await importChars(c); return true;
            case 'export-all': await exportChars(c, (S.chars || []).slice().sort((x, y) => cmp(x.name, y.name)), `Characters ${K().stamp()}`); return true;
            case 'export-list': await exportList(c); return true;
            case 'find': {
                const i = c.el('.mbk-search');
                if (i) { i.focus(); i.select(); }
                return true;
            }
            case 'preview': c.setReg({ PreviewPane: !previewOn(c) }); c.render(); return true;
            case 'copy-cp': if (cp) await K().copy(c, cp, 'The copyright\'s name'); return true;
            case 'rename-cp': if (cp) await renameCopyright(c, cp); return true;
            case 'delete-cp': if (cp) await removeCopyright(c, cp); return true;
            case 'export-cp': if (cp) await exportChars(c, (S.chars || []).filter((ch) => same(cpOf(ch), cp)), cp); return true;
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('character-db'); return true;
            default:
        }
        const ch = byName(c.sel);
        if (!ch) return a === 'open' || a === 'delete';
        const i = Number(arg);
        const group = Number.isInteger(i) ? enhOf(ch)[i] : null;
        switch (a) {
            case 'open': propertiesSheet(c, ch.name); return true;
            case 'studio': await insertIntoStudio(c, ch.prompt || '', `The prompt of "${ch.name}"`); return true;
            case 'studio-enh': if (group) await insertIntoStudio(c, joinEnh(ch, group), `"${ch.name}" with enhancer ${i + 1}`); return true;
            case 'copy-prompt': await K().copy(c, ch.prompt || '', 'The prompt'); return true;
            case 'copy-enh': if (group) await K().copy(c, joinEnh(ch, group), `The prompt with enhancer ${i + 1}`); return true;
            case 'copy-name': await K().copy(c, ch.name, 'The name'); return true;
            case 'duplicate': await duplicate(c, ch.name); return true;
            case 'move': await moveTo(c, ch.name); return true;
            case 'rename': await rename(c, ch.name); return true;
            case 'delete': await removeCharacter(c, ch.name); return true;
            case 'export': await exportChars(c, [ch], ch.name); return true;
            default: return false;
        }
    }

    function status(node, c) {
        if (!S.chars) return S.error ? 'The server did not answer.' : 'Reading data, please wait...';
        const cp = cpFromNode(node.id);
        const total = cp == null ? S.chars.length : S.chars.filter((ch) => same(cpOf(ch), cp)).length;
        const all = cp == null ? `${plural(total, 'character', 'characters')} in ${plural(copyrights().length, 'copyright', 'copyrights')}` : plural(total, 'character', 'characters');
        if (!findOf(c, node.id)) return all;
        return `${rowsFor(c, node.id).length} of ${plural(total, 'character', 'characters')}`;
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
            viewMenu,
            action,
            rowOpen: (key, node, c) => { void action('open', c); },
            status,
            onSelectRow: (key, node, c) => { paintPreview(c); if (root.mmcBooksKit) root.mmcBooksKit.toolbarAgain(c); },
            about: { version: '1.0.0', lines: ['Character Database keeps the characters, their copyrights, base prompts and enhancers.'] },
            help: () => { if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('character-db'); },
            onOpen: (c) => { S.consoles.add(c); void reload(); },
            onClose: (c) => { S.consoles.delete(c); }
        };
    }

    function applyOpts(c, opts) {
        const o = opts || {};
        if (o.search !== undefined) { setFind(c, c.node, String(o.search || '')); c.refresh(); }
        if (o.character) {
            const go = () => {
                const ch = byName(o.character);
                if (!ch) return;
                c.select(cpNode(cpOf(ch)));
                c.selectRow(ch.name);
                propertiesSheet(c, ch.name);
            };
            if (S.chars) go(); else setTimeout(function wait(n = 0) { if (S.chars) go(); else if (n < 40) setTimeout(() => wait(n + 1), 250); }, 250);
        }
    }

    async function openCharacterDbConsole(node, opts) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        const target = node && node !== 'root' ? cpNode(node) : 'root';
        const c = root.mmcConsole.open(def(), { node: target });
        // a copyright's folder is in the tree once the database has been read
        if (c && target !== 'root' && c.node !== target) {
            setTimeout(function wait(n = 0) { if (S.chars) { if (c.find(target)) c.select(target); } else if (n < 40) setTimeout(() => wait(n + 1), 250); }, 250);
        }
        if (c && opts) applyOpts(c, opts);
        return c;
    }

    root.openCharacterDbConsole = openCharacterDbConsole;
    root.mmcCharacterDb = { def, open: openCharacterDbConsole, _state: S };
})(typeof window !== 'undefined' ? window : globalThis);
