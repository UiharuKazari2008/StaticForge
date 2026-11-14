/**
 * Spellbook (Yozora #828): the MMC snap-in that manages presets on the desktop (the Toolbox /
 * Start menu Spellbook, Run "presets", Spellcaster's Spellbook button). The old Spellbook window
 * (presetManager.js showPresetManager, #presetManagerModal + Update Preset) stays for phones and
 * the classic theme.
 *
 *   Spellbook (Local)     the presets and preset groups at a glance
 *     Presets             every preset: a find box (names and prompts, as the old search) and a
 *                         workspace filter over a sortable list (Name, Model, Size, Steps, Guidance,
 *                         Workspace, Characters, Prompt)
 *     Preset Groups       the preset groups (prompt.config.json preset_group): a group's address
 *                         (/preset/<uuid>) picks one of its presets
 *
 * A preset: Generate Image (Spellcaster), Open in Studio, Copy Address (the REST generation URL),
 * Add to Desktop, New UUID..., Duplicate..., Rename..., Delete, Export..., Properties (a property
 * sheet: General, Generation, Prompt, Characters, Rentan, Details). The built-in Background preset
 * can only be opened, generated, copied or duplicated. New Preset... makes one from a name, model,
 * size, workspace and prompts; Save Studio as Preset... is Studio's own save; Import... reads an
 * exported .json. Server calls are the old window's: get_presets / update_preset / delete_preset /
 * regenerate_preset_uuid / save_preset, and get / save / delete_preset_group(s). update_preset only
 * stores name, workspace, size and upscale, so the other fields go through save_preset with the whole
 * record (as Studio saves it).
 *
 *   window.openSpellbookConsole(node?, opts?)   node: 'root' | 'presets' | 'groups'
 *                                               opts: { preset (open its sheet), search }
 *   window.mmcSpellbook = { def(), open(node?) }   def() for mmcConsole.compose (Data Management)
 *
 * Also window.mmcBooksKit: the file and clipboard helpers mmcExpanders.js shares.
 * Styles: public/css/mmc-books.css (+ mmc-console.css).
 */
(function (root) {
    'use strict';

    const ID = 'spellbook';
    const TITLE = 'Spellbook';
    const APP = '/static_images/app_icons';
    const ICON16 = `${APP}/16/presetbook.png`;
    const ICON32 = `${APP}/32/presetbook.png`;
    const CMD = '/static_images/vista-cmdbar';
    const VI = '/static_images/vista-icons';
    const FOLDER16 = `${VI}/explorer/folder-16.png`;

    // dialog styles (Win32)
    const SS = 0x50020000;
    const ETCHED = 0x50000010;
    const ICON = 0x50000003;
    const EDIT = 0x50010080;
    const EDIT_RO = 0x50010880;
    const NUM = 0x50012080;
    const MULTI = 0x50211044;
    const PUSH = 0x50010000;
    const DEFPUSH = 0x50010001;
    const CHECK = 0x50010003;
    const GROUP = 0x50000007;
    const COMBO = 0x50210003;
    const LV = 0x5001000D;
    const EDGE = 0x200;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
    const plural = (n, one, many) => `${Number(n || 0).toLocaleString('en-US')} ${Number(n) === 1 ? one : many}`;
    const clone = (o) => JSON.parse(JSON.stringify(o == null ? null : o));
    const glob = (name) => {
        if (typeof root[name] !== 'undefined') return root[name];
        try { return (0, eval)(`typeof ${name} !== 'undefined' ? ${name} : undefined`); } catch (_) { return undefined; } // eslint-disable-line no-eval
    };

    // ---- shared with mmcExpanders.js: files, clipboard, the busy cursor -------------------------------

    const kit = (function () {
        function vfs() { return glob('vfsClient') || null; }

        function utf8ToBase64(text) {
            const bytes = new TextEncoder().encode(text);
            let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return btoa(bin);
        }

        function download(name, text, type) {
            const blob = new Blob([text], { type: type || 'text/plain' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = name;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        }

        /** Save As (the shell's own dialog into the user's files; a browser download without it). */
        function saveText(c, name, text, typeLabel, mime) {
            const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1] || 'txt';
            const dlg = root.studioOpenFolderDialog;
            const v = vfs();
            if (typeof dlg !== 'function' || !v || typeof v.uploadFile !== 'function') { download(name, text, mime); return Promise.resolve(true); }
            const ws = glob('activeWorkspace') || '';
            return dlg('save', {
                startPath: ws ? `/Workspaces/${ws}` : '/',
                host: {
                    title: 'Save As',
                    typeLabel,
                    acceptType: 'user-file',
                    suggestName: () => name,
                    async onSave(info) {
                        let file = String(info.name || '').trim();
                        if (!file || file.startsWith('*.')) return false;
                        if (!/\.[a-z0-9]{1,5}$/i.test(file)) file += `.${ext}`;
                        try {
                            await v.uploadFile(info.path || '/', utf8ToBase64(text), file, mime || 'text/plain');
                            if (c) c.note(`${file} was saved.`);
                            return true;
                        } catch (err) {
                            if (c) await c.box(`<p>${esc(file)} could not be saved.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
                            return false;
                        }
                    }
                }
            });
        }

        /** Open (the shell's dialog over the user's files; a browser file pick without it): the text. */
        function openText(typeLabel, pattern) {
            const dlg = root.studioOpenFolderDialog;
            const v = vfs();
            if (typeof dlg === 'function' && v && typeof v.downloadFile === 'function') {
                return new Promise((resolve) => {
                    let done = false;
                    const ws = glob('activeWorkspace') || '';
                    Promise.resolve(dlg('open-vfs', {
                        startPath: ws ? `/Workspaces/${ws}` : '/',
                        host: {
                            title: 'Open',
                            typeLabel,
                            rejectMessage: `Choose a file of the type ${typeLabel}`,
                            acceptItem: (item) => item && item.targetKind === 'user-file' && pattern.test(item.name || ''),
                            async onOpen(item) {
                                done = true;
                                try {
                                    const res = await v.downloadFile(item.id);
                                    const r = await fetch(res.downloadUrl, { credentials: 'same-origin', cache: 'no-store' });
                                    resolve({ name: item.name, text: await r.text() });
                                } catch (err) { resolve({ error: (err && err.message) || 'The file could not be read.' }); }
                            }
                        }
                    })).then(() => { if (!done) setTimeout(() => { if (!done) resolve(null); }, 0); }, () => resolve(null));
                });
            }
            return new Promise((resolve) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = '.json,application/json';
                input.addEventListener('change', () => {
                    const f = input.files && input.files[0];
                    if (!f) { resolve(null); return; }
                    f.text().then((text) => resolve({ name: f.name, text }), () => resolve({ error: 'The file could not be read.' }));
                });
                input.click();
            });
        }

        async function copy(c, text, what) {
            if (!text) return;
            try {
                const fn = glob('copyTextToClipboard');
                if (typeof fn === 'function') await fn(String(text));
                else await navigator.clipboard.writeText(String(text));
                if (c) c.note(`${what || 'The text'} was copied to the Clipboard.`);
            } catch (err) {
                if (c) await c.box(`<p>The text could not be copied to the Clipboard.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
            }
        }

        /** MMC's Export List: the list as tab-separated text, the heading row first. */
        function listText(cols, rows) {
            const clean = (s) => String(s == null ? '' : s).replace(/[\t\r\n]+/g, ' ');
            return [cols.map((col) => clean(col.t)).join('\t')].concat(rows.map((r) => cols.map((col) => clean(col.text(r.data))).join('\t'))).join('\r\n');
        }

        function busy(c, on) {
            if (c && c.modal) c.modal.classList.toggle('mbk-busy', !!on);
        }

        function toolbarAgain(c) {
            const host = c && (c.host || c);
            if (host && typeof host.renderToolbar === 'function') host.renderToolbar();
        }

        /** Repaint only the list (typing in the find box keeps its caret); a full render next time. */
        function repaintList(c, html) {
            const pane = c.el('.mmc-result');
            const old = pane && pane.querySelector('.mbk-page > .mmc-list');
            if (!old) return;
            const tmp = document.createElement('div');
            tmp.innerHTML = html;
            const fresh = tmp.firstElementChild;
            if (fresh) old.replaceWith(fresh);
            delete pane.dataset.html;
        }

        function dlgError(ctx, id, text) {
            ctx.html(id, text ? `<span class="mbk-dlg-error"><img src="${VI}/error-16.png" alt="">${esc(text)}</span>` : '');
        }

        function fillList(lv, cols, rows, empty) {
            if (!lv) return;
            lv.classList.add('is-report');
            lv.querySelector('.vdt-lv-header').innerHTML = cols.map((col) => `<span class="vdt-lv-col" style="width:${col.w}px">${esc(col.t)}</span>`).join('');
            lv.querySelector('.vdt-lv-body').innerHTML = rows.length
                ? rows.map((r, i) => `<div class="vdt-lv-row${r.sel ? ' is-selected' : ''}" data-row="${i}">${r.cells.map((cell, j) => `<span style="width:${cols[j].w}px" title="${esc(cell)}">${j === 0 && r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}${esc(cell)}</span>`).join('')}</div>`).join('')
                : `<div class="mbk-lv-empty">${esc(empty || '')}</div>`;
        }

        const selectedRow = (lv) => { const r = lv && lv.querySelector('.vdt-lv-row.is-selected'); return r ? Number(r.dataset.row) : -1; };

        const yesNo = [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }];

        function stamp() {
            const d = new Date();
            const p = (n) => String(n).padStart(2, '0');
            return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
        }

        return { saveText, openText, copy, listText, busy, toolbarAgain, repaintList, dlgError, fillList, selectedRow, yesNo, stamp, download, glob, esc };
    })();
    root.mmcBooksKit = kit;

    // ---- labels (the old window's and Studio's rules) --------------------------------------------------

    function modelChoices() {
        const out = [];
        const groups = glob('modelGroups');
        if (Array.isArray(groups)) {
            groups.forEach((g) => (g.options || []).forEach((o) => {
                if (o && o.value) out.push({ value: String(o.value).toLowerCase(), text: `${o.display}${o.badge_full || o.badge ? ` ${o.badge_full || o.badge}` : ''}` });
            }));
        }
        return out;
    }

    function modelLabel(model) {
        const v = String(model || '').toLowerCase();
        const hit = modelChoices().find((o) => o.value === v);
        return hit ? hit.text : (model ? String(model) : 'V4.5?');
    }

    function resolutionChoices() {
        const out = [];
        const groups = glob('RESOLUTION_GROUPS');
        if (Array.isArray(groups)) {
            groups.forEach((g) => (g.options || []).forEach((o) => {
                if (o && o.value && o.dims) out.push({ value: String(o.value).toLowerCase(), text: `${g.group} ${o.name} (${o.dims})`, paid: /^(large_|xlarge_|wallpaper_)/i.test(o.value) });
            }));
        }
        return out;
    }

    function sizeLabel(p) {
        const v = String(p.resolution || '').toLowerCase();
        const list = glob('RESOLUTIONS');
        if (v && Array.isArray(list)) {
            const r = list.find((x) => String(x.value).toLowerCase() === v);
            if (r) return `${String(r.display || '').replace('Normal ', '')}${r.width && r.height ? ` (${r.width}x${r.height})` : ''}`;
        }
        if (p.width && p.height) return `Custom (${p.width}x${p.height})`;
        return p.resolution ? String(p.resolution) : 'Portrait?';
    }

    const isPaidSize = (p) => /^(large_|xlarge_|wallpaper_)/i.test(String(p.resolution || ''));

    function workspaceList() {
        const out = [];
        const ws = glob('workspaces');
        if (ws && typeof ws === 'object') Object.keys(ws).forEach((id) => out.push({ value: id, text: (ws[id] && ws[id].name) || id }));
        if (!out.some((x) => x.value === 'default')) out.unshift({ value: 'default', text: 'Default' });
        return out;
    }

    function workspaceName(id) {
        if (!id || id === 'default') return 'Default';
        const ws = glob('workspaces');
        return (ws && ws[id] && ws[id].name) || String(id);
    }

    function samplerChoices() {
        const m = glob('SAMPLER_MAP');
        return [{ value: '', text: '(Studio default)' }].concat(Array.isArray(m) ? m.map((x) => ({ value: x.request, text: x.display })) : []);
    }

    function noiseChoices() {
        const m = glob('NOISE_MAP');
        return [{ value: '', text: '(Studio default)' }].concat(Array.isArray(m) ? m.map((x) => ({ value: x.request, text: x.display })) : []);
    }

    function samplerValue(v) {
        const t = String(v || '').toUpperCase();
        const m = glob('SAMPLER_MAP');
        if (!t) return '';
        const hit = Array.isArray(m) ? m.find((x) => x.request === t || String(x.meta).toUpperCase() === t) : null;
        return hit ? hit.request : String(v);
    }

    function noiseValue(v) {
        const t = String(v || '').toUpperCase();
        const m = glob('NOISE_MAP');
        if (!t) return '';
        const hit = Array.isArray(m) ? m.find((x) => x.request === t || String(x.meta).toUpperCase() === t) : null;
        return hit ? hit.request : String(v);
    }

    function ucChoices() {
        const labels = glob('UC_PRESET_LEVEL_LABELS') || ['None', 'Human Focus', 'Light', 'Heavy', 'Curated', 'Furry Focus'];
        return [{ value: '', text: '(Studio default)' }].concat(labels.map((t, i) => ({ value: String(i), text: t })));
    }

    function ucValue(v) {
        if (v == null || v === '') return '';
        const fn = glob('ucPresetLevelFromId');
        return String(typeof fn === 'function' ? fn(v) : v);
    }

    const parseMaybe = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return null; } };
    const titleCase = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());
    const charsOf = (p) => (Array.isArray(p.allCharacterPrompts) && p.allCharacterPrompts.length ? p.allCharacterPrompts : (Array.isArray(p.characterPrompts) ? p.characterPrompts : []));
    const charsKey = (p) => (Array.isArray(p.allCharacterPrompts) && p.allCharacterPrompts.length ? 'allCharacterPrompts' : (Array.isArray(p.characterPrompts) ? 'characterPrompts' : 'allCharacterPrompts'));

    /** Prompt text as Studio shows it (its managed emphasis groups as weights, no invisible marks). */
    function readable(text, p, hint) {
        let t = String(text == null ? '' : text);
        try {
            const expand = glob('expandEmphasisGroupIds');
            const coalesce = glob('coalesceEmphasisWeightSource');
            const strip = glob('stripUnmanagedEmphasisInvisibles');
            if (typeof expand === 'function') t = expand(t, typeof coalesce === 'function' ? coalesce(parseMaybe(p.emphasis_normalization), hint) : null).text;
            if (typeof strip === 'function') t = strip(t);
        } catch (_) { /* below */ }
        return t.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF]/g, '').trim();
    }

    const RENTAN = [
        { key: 'tod', id: 301, text: '&Time of day' },
        { key: 'weather', id: 302, text: '&Weather' },
        { key: 'season', id: 303, text: '&Season' },
        { key: 'clothing', id: 304, text: '&Clothing' },
        { key: 'action', id: 305, text: 'Character &action' },
        { key: 'location', id: 306, text: '&Location' },
        { key: 'observeHoliday', id: 307, text: '&Holidays' },
        { key: 'activity', id: 308, text: 'Acti&vity' },
        { key: 'creative', id: 310, text: 'C&reative mode' },
        { key: 'optimize', id: 311, text: 'Token o&ptimization' }
    ];

    // ---- the server -------------------------------------------------------------------------------------

    const S = {
        list: null,       // [{ key, p }]
        groups: null,     // [{ name, displayName, uuid, presets: [uuid] }]
        error: '',
        groupError: '',
        loading: false,
        consoles: new Set(),
        timer: 0,
        wired: false
    };

    function ws() {
        const c = root.wsClient;
        if (!c || typeof c.sendMessage !== 'function') throw new Error('Melaton is not connected to the server.');
        if (typeof c.isConnected === 'function' && !c.isConnected()) throw new Error('Melaton is not connected to the server.');
        return c;
    }

    const okOf = (r) => !!(r && (r.success || (r.data && r.data.success)));
    const msgOf = (r, d) => (r && (r.error || r.message || (r.data && (r.data.error || r.data.message)))) || d;

    async function loadPresets() {
        S.loading = true;
        try {
            const r = await ws().getPresets(1, 100000, '');
            const presets = (r && r.presets) || (r && r.data && r.data.presets) || {};
            const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
            S.list = Object.keys(presets).map((key) => ({ key, p: presets[key] || {} })).sort((a, b) => coll.compare(a.key, b.key));
            S.error = '';
        } catch (err) {
            S.error = (err && err.message) || 'The presets could not be read.';
            if (!S.list) S.list = null;
        } finally {
            S.loading = false;
        }
    }

    async function loadGroups() {
        try {
            const r = await ws().getPresetGroups();
            const list = (r && r.presetGroups) || (r && r.data && r.data.presetGroups) || [];
            S.groups = list.map((g) => ({ name: g.name, displayName: g.displayName || g.name, uuid: g.uuid || '', presets: Array.isArray(g.presets) ? g.presets.slice() : [] }));
            S.groupError = '';
        } catch (err) {
            S.groupError = (err && err.message) || 'The preset groups could not be read.';
        }
    }

    function refreshAll() {
        S.consoles.forEach((c) => {
            if (!c.modal || !c.modal.isConnected) { S.consoles.delete(c); return; }
            if (typeof c.isActive === 'function' && !c.isActive()) return;
            c.refresh();
        });
    }

    async function reload(opts = {}) {
        S.consoles.forEach((c) => kit.busy(c, true));
        await Promise.all([loadPresets(), opts.presetsOnly ? null : loadGroups()]);
        S.consoles.forEach((c) => kit.busy(c, false));
        refreshAll();
    }

    /** After a change: Studio's and Spellcaster's preset list (appBootstrap.js), then this one. */
    async function changed() {
        const fn = glob('refreshAppOptionsChunk');
        if (typeof fn === 'function') { try { await fn('presets'); } catch (_) { /* the list only */ } }
        await reload();
    }

    function wireServer() {
        if (S.wired || !root.wsClient || typeof root.wsClient.on !== 'function') return;
        S.wired = true;
        // another window (or another device) saved, renamed or deleted a preset: read the list again
        const later = () => {
            if (!S.consoles.size) return;
            clearTimeout(S.timer);
            S.timer = setTimeout(() => { void reload(); }, 400);
        };
        root.wsClient.on('preset_updated', later);
        root.wsClient.on('preset_group_updated', later);
    }

    const byKey = (k) => (S.list || []).find((e) => e.key === k) || null;
    const nameTaken = (name, except) => (S.list || []).some((e) => e.key !== except && (e.key === name || (e.p && e.p.name === name)));

    // ---- the pages --------------------------------------------------------------------------------------

    function nodes() {
        return [{
            id: 'root',
            name: TITLE,
            icon: ICON16,
            desc: 'Presets and preset groups',
            children: [
                { id: 'presets', name: 'Presets', icon: ICON16, desc: 'Every saved preset' },
                { id: 'groups', name: 'Preset Groups', icon: FOLDER16, desc: 'Presets picked from one address' }
            ]
        }];
    }

    function rootPage(c) {
        const list = S.list || [];
        const builtins = list.filter((e) => e.p.builtin).length;
        const paid = list.filter((e) => e.p.allow_paid || isPaidSize(e.p) || Number(e.p.steps) > 28).length;
        const rows = S.list ? [
            ['Presets', `<span class="mmc-link" data-act="nav:presets">${esc(plural(list.length, 'preset', 'presets'))}</span>`],
            ['Built-in', esc(String(builtins))],
            ['May use Anlas', esc(String(paid))],
            ['Preset groups', S.groups ? `<span class="mmc-link" data-act="nav:groups">${esc(plural(S.groups.length, 'group', 'groups'))}</span>` : esc(S.groupError || 'Reading data, please wait...')]
        ] : [['Presets', S.error ? c.state(false, S.error) : 'Reading data, please wait...']];
        return c.page(TITLE, '', [
            { id: 'mbk-sb-overview', title: 'Overview', body: c.overview(ICON32, ['A preset keeps a print\'s prompts and settings under a name. Open one in Studio, make a picture with it in Spellcaster, or change its settings here.']) },
            { id: 'mbk-sb-summary', title: 'Summary', body: c.props(rows) },
            { id: 'mbk-sb-tasks', title: 'Actions', body: `<p><span class="mmc-link" data-act="new">New Preset...</span></p><p><span class="mmc-link" data-act="save-studio">Save Studio as Preset...</span></p><p><span class="mmc-link" data-act="import">Import Presets...</span></p>` }
        ]);
    }

    const COLS = [
        { key: 'name', t: 'Name', w: 170, text: (p) => p.__key },
        { key: 'model', t: 'Model', w: 110, text: (p) => modelLabel(p.model) },
        { key: 'size', t: 'Size', w: 165, text: (p) => sizeLabel(p) },
        { key: 'steps', t: 'Steps', w: 46, num: true, value: (p) => Number(p.steps) || 0, text: (p) => (p.steps != null && p.steps !== '' ? String(p.steps) : '') },
        { key: 'guidance', t: 'Guidance', w: 60, num: true, value: (p) => Number(p.guidance) || 0, text: (p) => (p.guidance != null && p.guidance !== '' ? String(p.guidance) : '') },
        { key: 'ws', t: 'Workspace', w: 110, text: (p) => workspaceName(p.target_workspace) },
        { key: 'chars', t: 'Characters', w: 70, num: true, value: (p) => charsOf(p).length, text: (p) => (charsOf(p).length ? String(charsOf(p).length) : '') },
        { key: 'prompt', t: 'Prompt', w: 320, text: (p) => readable(p.prompt, p, 'prompt') }
    ];

    function matches(e, q, wsId) {
        if (wsId && (e.p.target_workspace || 'default') !== wsId) return false;
        if (!q) return true;
        const s = q.toLowerCase();
        return e.key.toLowerCase().includes(s) || String(e.p.name || '').toLowerCase().includes(s) || String(e.p.prompt || '').toLowerCase().includes(s);
    }

    const viewOf = (c) => { c.data.search = c.data.search || ''; c.data.ws = c.data.ws || ''; return c.data; };

    function presetRows(c) {
        const v = viewOf(c);
        return (S.list || []).filter((e) => matches(e, v.search, v.ws)).map((e) => ({
            key: e.key,
            data: Object.assign({ __key: e.key }, e.p),
            icon: ICON16,
            cls: e.p.builtin ? 'mbk-builtin' : ''
        }));
    }

    function presetList(c) {
        return c.listView(COLS, presetRows(c), { sortId: 'mbk-presets', sort: { key: 'name', dir: 1 }, empty: viewOf(c).search || viewOf(c).ws ? 'No presets match the search.' : 'There are no presets. Save one from Studio or use New Preset.' });
    }

    function presetsPage(c) {
        if (!S.list) {
            return { html: `<div class="mmc-empty">${S.error ? esc(S.error) : 'Reading data, please wait...'}</div>`, list: true };
        }
        const v = viewOf(c);
        const wsOpts = [{ value: '', text: 'All workspaces' }].concat(workspaceList());
        const html = `<div class="mbk-page">
            <div class="mbk-bar">
                <label class="mbk-find"><span>F<u>i</u>nd:</span><input type="text" class="mbk-search" data-field="mbk-sb-search" value="${esc(v.search)}" placeholder="Names and prompts" autocomplete="off" spellcheck="false"></label>
                <label><span>Workspace:</span><select class="mbk-filter" data-field="mbk-sb-ws">${wsOpts.map((o) => `<option value="${esc(o.value)}"${o.value === v.ws ? ' selected' : ''}>${esc(o.text)}</option>`).join('')}</select></label>
            </div>
            ${presetList(c)}
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
                        t = setTimeout(() => { v.search = input.value; kit.repaintList(c, presetList(c)); c.note(''); }, 150);
                    });
                    input.addEventListener('keydown', (ev) => {
                        if (ev.key === 'ArrowDown') { ev.preventDefault(); const l = pane.querySelector('.mmc-list'); if (l) l.focus(); }
                    });
                }
                if (sel) sel.addEventListener('change', () => { v.ws = sel.value; kit.repaintList(c, presetList(c)); c.note(''); });
            }
        };
    }

    const GCOLS = [
        { key: 'name', t: 'Name', w: 180, text: (g) => g.displayName || g.name },
        { key: 'count', t: 'Presets', w: 60, num: true, value: (g) => g.presets.length, text: (g) => String(g.presets.length) },
        { key: 'members', t: 'Members', w: 330, text: (g) => g.presets.map((u) => { const e = (S.list || []).find((x) => x.p.uuid === u); return e ? e.key : u; }).join(', ') },
        { key: 'uuid', t: 'UUID', w: 250, text: (g) => g.uuid }
    ];

    function groupsPage(c) {
        if (!S.groups) return { html: `<div class="mmc-empty">${S.groupError ? esc(S.groupError) : 'Reading data, please wait...'}</div>`, list: true };
        const rows = S.groups.map((g) => ({ key: g.name, data: g, icon: FOLDER16 }));
        return { html: c.listView(GCOLS, rows, { sortId: 'mbk-groups', sort: { key: 'name', dir: 1 }, empty: 'There are no preset groups. Use New Preset Group to make one.' }), list: true };
    }

    function page(node, c) {
        if (node.id === 'presets') return presetsPage(c);
        if (node.id === 'groups') return groupsPage(c);
        return rootPage(c);
    }

    // ---- dialog templates -------------------------------------------------------------------------------

    function templates() {
        const T = {
            'mbk:general': { t: 'General', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [10, 'S', 7, 7, 21, 20, ICON, '', 0],
                [11, 'E', 44, 10, 201, 13, EDIT, '', EDGE],
                [12, 'S', 7, 34, 238, 1, ETCHED, '', 0],
                [13, 'S', 7, 44, 60, 8, SS, '&Workspace:', 0], [14, 'C', 70, 42, 175, 120, COMBO, '', 0],
                [15, 'S', 7, 62, 60, 8, SS, 'Si&ze:', 0], [16, 'C', 70, 60, 175, 160, COMBO, '', 0],
                [17, 'B', 70, 78, 175, 10, CHECK, '&Upscale', 0],
                [18, 'S', 7, 96, 238, 1, ETCHED, '', 0],
                [19, 'S', 7, 106, 60, 8, SS, 'UUID:', 0], [20, 'E', 70, 104, 175, 13, EDIT_RO, '', EDGE],
                [21, 'B', 70, 121, 84, 14, PUSH, '&Copy Address', 0], [22, 'B', 158, 121, 87, 14, PUSH, '&New UUID...', 0],
                [23, 'S', 7, 142, 238, 1, ETCHED, '', 0],
                [24, 'S', 7, 152, 60, 8, SS, 'Type:', 0], [25, 'S', 70, 152, 175, 8, SS, '', 0],
                [26, 'S', 7, 164, 60, 8, SS, 'Characters:', 0], [27, 'S', 70, 164, 175, 8, SS, '', 0],
                [28, 'S', 7, 176, 60, 8, SS, 'Images:', 0], [29, 'S', 70, 176, 175, 8, SS, '', 0],
                [30, 'S', 7, 188, 60, 8, SS, 'Stages:', 0], [31, 'S', 70, 188, 175, 8, SS, '', 0],
                [32, 'S', 7, 200, 60, 8, SS, 'Expanders:', 0], [33, 'S', 70, 200, 175, 8, SS, '', 0]
            ] },
            'mbk:generation': { t: 'Generation', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [40, 'S', 7, 9, 60, 8, SS, '&Model:', 0], [41, 'C', 70, 7, 175, 160, COMBO, '', 0],
                [42, 'S', 7, 27, 60, 8, SS, 'S&teps:', 0], [43, 'E', 70, 25, 40, 13, NUM, '', EDGE],
                [44, 'S', 125, 27, 45, 8, SS, '&Guidance:', 0], [45, 'E', 175, 25, 40, 13, EDIT, '', EDGE],
                [46, 'S', 7, 45, 60, 8, SS, '&Rescale:', 0], [47, 'E', 70, 43, 40, 13, EDIT, '', EDGE],
                [48, 'S', 125, 45, 45, 8, SS, 'S&eed:', 0], [49, 'E', 175, 43, 70, 13, NUM, '', EDGE],
                [50, 'S', 7, 63, 60, 8, SS, 'Sa&mpler:', 0], [51, 'C', 70, 61, 175, 120, COMBO, '', 0],
                [52, 'S', 7, 81, 60, 8, SS, '&Noise schedule:', 0], [53, 'C', 70, 79, 175, 120, COMBO, '', 0],
                [54, 'S', 7, 99, 60, 8, SS, 'U&C preset:', 0], [55, 'C', 70, 97, 175, 120, COMBO, '', 0],
                [56, 'S', 7, 118, 238, 1, ETCHED, '', 0],
                [57, 'B', 7, 126, 238, 10, CHECK, '&Variety+', 0],
                [58, 'B', 7, 140, 238, 10, CHECK, '&Quality tags', 0],
                [59, 'B', 7, 154, 238, 10, CHECK, 'May use &Anlas (paid requests)', 0]
            ] },
            'mbk:prompt': { t: 'Prompt', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [70, 'S', 7, 7, 238, 8, SS, '&Prompt:', 0], [71, 'E', 7, 18, 238, 98, MULTI, '', EDGE],
                [72, 'S', 7, 122, 238, 8, SS, '&Undesired content:', 0], [73, 'E', 7, 133, 238, 78, MULTI, '', EDGE]
            ] },
            'mbk:characters': { t: 'Characters', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [80, 'S', 7, 7, 238, 8, SS, 'The character prompts in this preset:', 0],
                [81, 'SysListView32', 7, 18, 238, 152, LV, '', EDGE],
                [82, 'B', 7, 175, 50, 14, PUSH, '&Edit...', 0], [83, 'B', 61, 175, 50, 14, PUSH, '&Remove', 0],
                [84, 'B', 7, 196, 238, 10, CHECK, 'Use character &positions', 0]
            ] },
            'mbk:rentan': { t: 'Rentan', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [300, 'B', 7, 7, 238, 80, GROUP, 'Crossover', 0],
                ...RENTAN.filter((r) => r.id < 309).map((r, i) => [r.id, 'B', i % 2 ? 130 : 16, 21 + Math.floor(i / 2) * 15, 108, 10, CHECK, r.text, 0]),
                [309, 'B', 7, 94, 238, 36, GROUP, 'Crossover data', 0],
                ...RENTAN.filter((r) => r.id > 309).map((r, i) => [r.id, 'B', i % 2 ? 130 : 16, 108, 108, 10, CHECK, r.text, 0]),
                [313, 'B', 7, 140, 238, 10, CHECK, 'Use cached &responses for this preset', 0]
            ] },
            'mbk:details': { t: 'Details', w: 252, h: 218, f: ['MS Shell Dlg', 8], s: 0, c: [
                [320, 'S', 7, 7, 238, 204, SS, '', 0]
            ] },
            'mbk:character': { t: 'Character', w: 262, h: 172, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 9, 40, 8, SS, '&Name:', 0], [102, 'E', 50, 7, 205, 13, EDIT, '', EDGE],
                [103, 'S', 7, 26, 200, 8, SS, '&Prompt:', 0], [104, 'E', 7, 37, 248, 52, MULTI, '', EDGE],
                [105, 'S', 7, 94, 200, 8, SS, '&Undesired content:', 0], [106, 'E', 7, 105, 248, 34, MULTI, '', EDGE],
                [107, 'B', 7, 147, 100, 10, CHECK, '&Enabled', 0],
                [1, 'B', 151, 151, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 151, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'mbk:name': { t: 'Name', w: 232, h: 64, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 7, 218, 8, SS, '', 0],
                [102, 'E', 7, 18, 218, 13, EDIT, '', EDGE],
                [103, 'S', 7, 36, 110, 24, SS, '', 0],
                [1, 'B', 121, 43, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 175, 43, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'mbk:new': { t: 'New Preset', w: 262, h: 214, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 9, 50, 8, SS, '&Name:', 0], [102, 'E', 60, 7, 195, 13, EDIT, '', EDGE],
                [103, 'S', 7, 27, 50, 8, SS, '&Model:', 0], [104, 'C', 60, 25, 195, 160, COMBO, '', 0],
                [105, 'S', 7, 45, 50, 8, SS, 'Si&ze:', 0], [106, 'C', 60, 43, 195, 160, COMBO, '', 0],
                [107, 'S', 7, 63, 50, 8, SS, '&Workspace:', 0], [108, 'C', 60, 61, 195, 120, COMBO, '', 0],
                [109, 'S', 7, 81, 200, 8, SS, '&Prompt:', 0], [110, 'E', 7, 92, 248, 54, MULTI, '', EDGE],
                [111, 'S', 7, 151, 200, 8, SS, '&Undesired content:', 0], [112, 'E', 7, 162, 248, 24, MULTI, '', EDGE],
                [113, 'S', 7, 190, 140, 20, SS, '', 0],
                [1, 'B', 151, 193, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 193, 50, 14, PUSH, 'Cancel', 0]
            ] },
            'mbk:group': { t: 'Preset Group', w: 262, h: 214, f: ['MS Shell Dlg', 8], s: 0, c: [
                [101, 'S', 7, 9, 50, 8, SS, '&Name:', 0], [102, 'E', 60, 7, 195, 13, EDIT, '', EDGE],
                [103, 'S', 7, 26, 248, 8, SS, '&Presets in this group:', 0],
                [104, 'S', 7, 37, 248, 134, SS, '', 0],
                [105, 'S', 7, 176, 248, 8, SS, '', 0],
                [106, 'S', 7, 190, 140, 20, SS, '', 0],
                [1, 'B', 151, 193, 50, 14, DEFPUSH, 'OK', 0], [2, 'B', 205, 193, 50, 14, PUSH, 'Cancel', 0]
            ] }
        };
        root.vistaDialogTemplates = Object.assign(root.vistaDialogTemplates || {}, T);
    }

    function dialogApi() {
        const api = root.vistaDialogTemplate;
        if (!api || typeof api.openSheet !== 'function') throw new Error('The dialog could not be shown.');
        templates();
        return api;
    }

    // ---- one-name dialogs (Rename, Duplicate, Save Studio as Preset) -------------------------------------

    function nameDialog(c, { id, title, prompt, value, check }) {
        const api = dialogApi();
        return new Promise((resolve) => {
            let result = null;
            api.openDialog({
                id,
                key: 'mbk:name',
                title,
                owner: c.modal,
                focusFirst: true,
                init: (ctx) => { ctx.text(101, prompt); ctx.set(102, value || ''); },
                ok: (ctx) => {
                    const v = String(ctx.get(102) || '').trim();
                    const err = check ? check(v) : (v ? '' : 'Type a name.');
                    if (err) { kit.dlgError(ctx, 103, err); return false; }
                    result = v;
                    return true;
                },
                close: () => resolve(result)
            });
        });
    }

    const presetNameCheck = (except) => (v) => {
        if (!v) return 'Type a name for the preset.';
        if (nameTaken(v, except)) return 'A preset with that name already exists.';
        return '';
    };

    // ---- the commands -------------------------------------------------------------------------------------

    function studioOpen() {
        const m = document.getElementById('manualModal');
        return !!(m && !m.classList.contains('hidden') && getComputedStyle(m).display !== 'none');
    }

    async function openInStudio(c, key) {
        const fn = glob('openManualModalWithContent');
        if (typeof fn !== 'function') { await c.box('<p>Studio could not be opened.</p>', null, { icon: 'error' }); return; }
        await fn({ type: 'preset', name: key, title: key });
    }

    async function generate(c, key) {
        const fn = glob('generateFromPreset');
        try {
            if (typeof fn === 'function') { await fn(key); return; }
            const open = glob('openSpellbookApplet');
            if (typeof open === 'function') await open();
            const m = root.spellbookModalManager;
            if (!m) throw new Error('Spellcaster is not available.');
            m.selectPreset(key);
            await m.handleGenerate();
        } catch (err) {
            await c.box(`<p>The picture could not be made.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    const addressOf = (uuid) => `${location.origin}/preset/${uuid}?download=true`;

    async function copyAddress(c, key) {
        const e = byKey(key);
        if (!e || !e.p.uuid) { await c.box('<p>This preset has no UUID.</p>', null, { icon: 'error' }); return; }
        await kit.copy(c, addressOf(e.p.uuid), 'The preset\'s address');
    }

    async function addToDesktop(c, key) {
        const e = byKey(key);
        if (!e) return;
        if (!e.p.uuid) { await c.box('<p>This preset has no UUID.</p>', null, { icon: 'error' }); return; }
        const ds = glob('desktopShortcuts');
        if (!ds || typeof ds.addShortcut !== 'function') { await c.box('<p>The desktop is not available.</p>', null, { icon: 'error' }); return; }
        if ((ds.shortcuts || []).some((s) => s.type === 'preset' && s.data && s.data.uuid === e.p.uuid)) { c.note(`"${e.key}" is already on the desktop.`); return; }
        try {
            await ds.addShortcut({ name: e.p.name || e.key, type: 'preset', data: { uuid: e.p.uuid } });
            c.note(`"${e.key}" was added to the desktop.`);
        } catch (err) {
            await c.box(`<p>The shortcut could not be made.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    async function newUuid(c, key, quiet) {
        const e = byKey(key);
        if (!e || e.p.builtin) return null;
        if (!quiet) {
            const yes = await c.box(`<p>Are you sure you want to make a new UUID for "${esc(e.key)}"?</p><p>Addresses and REST calls that use the current UUID stop working.</p>`, kit.yesNo, { icon: 'warning', title: 'New UUID' });
            if (yes !== true) return null;
        }
        try {
            const r = await ws().regeneratePresetUuid(key);
            if (!okOf(r)) throw new Error(msgOf(r, 'The UUID was not changed.'));
            const uuid = r.uuid || (r.data && r.data.uuid);
            if (uuid) e.p.uuid = uuid;
            c.note(`"${e.key}" has a new UUID.`);
            refreshAll();
            return uuid || null;
        } catch (err) {
            await c.box(`<p>The UUID could not be changed.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
            return null;
        }
    }

    async function rename(c, key) {
        const e = byKey(key);
        if (!e || e.p.builtin) return;
        const next = await nameDialog(c, { id: 'spellbookRenameDialog', title: 'Rename Preset', prompt: 'Type a new name for the preset:', value: e.key, check: presetNameCheck(e.key) });
        if (!next || next === e.key) return;
        try {
            const r = await ws().updatePreset(key, { name: next });
            if (!okOf(r)) throw new Error(msgOf(r, 'The preset was not renamed.'));
            c.sel = next;
            c.note(`The preset was renamed to "${next}".`);
            await changed();
        } catch (err) {
            await c.box(`<p>The preset could not be renamed.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    /** A copy of the record under a new name (the server gives it its own UUID). */
    function copyConfig(p) {
        const config = clone(p) || {};
        ['uuid', 'builtin', 'preset_name', '__key'].forEach((k) => { delete config[k]; });
        return config;
    }

    async function duplicate(c, key) {
        const e = byKey(key);
        if (!e) return;
        let suggest = `${e.key} (2)`;
        for (let n = 2; nameTaken(suggest); n += 1) suggest = `${e.key} (${n + 1})`;
        const next = await nameDialog(c, { id: 'spellbookDuplicateDialog', title: 'Duplicate Preset', prompt: 'Type a name for the copy:', value: suggest, check: presetNameCheck(null) });
        if (!next) return;
        const config = copyConfig(e.p);
        if (config.name !== undefined) config.name = next;
        try {
            if (!config.prompt || !config.model) throw new Error('The preset has no prompt or model.');
            const r = await ws().savePreset(next, config);
            if (r && r.success === false) throw new Error(msgOf(r, 'The copy was not saved.'));
            c.sel = next;
            c.note(`"${next}" was made from "${e.key}".`);
            await changed();
        } catch (err) {
            await c.box(`<p>The copy could not be saved.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    async function remove(c, key) {
        const e = byKey(key);
        if (!e) return;
        if (e.p.builtin) { await c.box(`<p>"${esc(e.key)}" is a built-in Studio preset and cannot be deleted.</p>`, null, { icon: 'info' }); return; }
        const yes = await c.box(`<p>Are you sure you want to delete the preset "${esc(e.key)}"?</p>`, kit.yesNo, { icon: 'warning', title: 'Delete Preset' });
        if (yes !== true) return;
        try {
            const r = await ws().deletePreset(key);
            if (!okOf(r)) throw new Error(msgOf(r, 'The preset was not deleted.'));
            c.sel = null;
            c.note(`"${e.key}" was deleted.`);
            await changed();
        } catch (err) {
            await c.box(`<p>The preset could not be deleted.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    async function exportPresets(c, keys) {
        const out = {};
        keys.forEach((k) => { const e = byKey(k); if (e) out[k] = copyConfig(e.p); });
        if (!Object.keys(out).length) return;
        const name = keys.length === 1 ? `${keys[0].replace(/[\\/:*?"<>|]+/g, '_')}.json` : `Presets ${kit.stamp()}.json`;
        await kit.saveText(c, name, JSON.stringify({ format: 'melaton-presets', version: 1, presets: out }, null, 2), 'Presets (*.json)', 'application/json');
    }

    async function importPresets(c) {
        const f = await kit.openText('Presets (*.json)', /\.json$/i);
        if (!f) return;
        if (f.error) { await c.box(`<p>${esc(f.error)}</p>`, null, { icon: 'error' }); return; }
        let data = null;
        try { data = JSON.parse(f.text); } catch (_) { data = null; }
        const presets = data && typeof data === 'object' ? (data.presets && typeof data.presets === 'object' ? data.presets : data) : null;
        const names = presets ? Object.keys(presets).filter((k) => presets[k] && typeof presets[k] === 'object' && presets[k].prompt && presets[k].model) : [];
        if (!names.length) { await c.box(`<p>${esc(f.name || 'The file')} has no presets in it.</p>`, null, { icon: 'error' }); return; }
        const clash = names.filter((k) => byKey(k));
        let replace = false;
        if (clash.length) {
            const pick = await c.box(`<p>${esc(plural(clash.length, 'preset', 'presets'))} in ${esc(f.name || 'the file')} already ${clash.length === 1 ? 'exists' : 'exist'} (${esc(clash.slice(0, 5).join(', '))}${clash.length > 5 ? ', ...' : ''}).</p><p>Do you want to replace ${clash.length === 1 ? 'it' : 'them'}?</p>`,
                [{ text: 'Replace', value: 'replace', className: 'btn-standard primary' }, { text: 'Skip', value: 'skip', className: 'btn-standard' }, { text: 'Cancel', value: false, className: 'btn-standard' }], { icon: 'question', title: 'Import Presets' });
            if (pick !== 'replace' && pick !== 'skip') return;
            replace = pick === 'replace';
        }
        let saved = 0;
        const failed = [];
        for (const k of names) {
            if (byKey(k) && (!replace || byKey(k).p.builtin)) continue;
            const config = copyConfig(presets[k]);
            try {
                const r = await ws().savePreset(k, config);
                if (r && r.success === false) throw new Error(msgOf(r, ''));
                saved += 1;
            } catch (err) { failed.push(k); }
        }
        c.note(`${plural(saved, 'preset was', 'presets were')} imported.`);
        if (failed.length) await c.box(`<p>These presets could not be saved: ${esc(failed.join(', '))}</p>`, null, { icon: 'error', title: 'Import Presets' });
        await changed();
    }

    async function exportList(c) {
        const node = c.node;
        if (node === 'groups') {
            const rows = (S.groups || []).map((g) => ({ data: g }));
            await kit.saveText(c, 'Preset Groups.txt', kit.listText(GCOLS, c.sorted(rows, GCOLS, 'mbk-groups', { key: 'name', dir: 1 })), 'Text (Tab Delimited) (*.txt)');
            return;
        }
        await kit.saveText(c, 'Presets.txt', kit.listText(COLS, c.sorted(presetRows(c), COLS, 'mbk-presets', { key: 'name', dir: 1 })), 'Text (Tab Delimited) (*.txt)');
    }

    // ---- New Preset / Save Studio as Preset ---------------------------------------------------------------

    function newPreset(c) {
        const api = dialogApi();
        const models = modelChoices();
        const sizes = resolutionChoices();
        api.openDialog({
            id: 'spellbookNewPresetDialog',
            key: 'mbk:new',
            title: 'New Preset',
            owner: c.modal,
            focusFirst: true,
            init: (ctx) => {
                ctx.options(104, models.length ? models : [{ value: 'v4_5', text: 'V4.5' }], models.some((m) => m.value === 'v4_5') ? 'v4_5' : (models[0] && models[0].value));
                ctx.options(106, sizes.length ? sizes : [{ value: 'normal_portrait', text: 'Normal Portrait' }], sizes.some((s) => s.value === 'normal_portrait') ? 'normal_portrait' : (sizes[0] && sizes[0].value));
                const active = glob('activeWorkspace');
                ctx.options(108, workspaceList(), active && workspaceList().some((w) => w.value === active) ? active : 'default');
            },
            ok: async (ctx) => {
                const name = String(ctx.get(102) || '').trim();
                const err = presetNameCheck(null)(name);
                if (err) { kit.dlgError(ctx, 113, err); return false; }
                const prompt = String(ctx.get(110) || '').trim();
                if (!prompt) { kit.dlgError(ctx, 113, 'Type the prompt.'); return false; }
                const config = { model: String(ctx.get(104) || 'v4_5').toLowerCase(), prompt, resolution: String(ctx.get(106) || 'normal_portrait'), target_workspace: String(ctx.get(108) || 'default') };
                const uc = String(ctx.get(112) || '').trim();
                if (uc) config.uc = uc;
                try {
                    const r = await ws().savePreset(name, config);
                    if (r && r.success === false) throw new Error(msgOf(r, 'The preset was not saved.'));
                } catch (e2) { kit.dlgError(ctx, 113, (e2 && e2.message) || 'The preset was not saved.'); return false; }
                c.sel = name;
                c.note(`"${name}" was saved.`);
                if (c.node !== 'presets') c.select('presets');
                await changed();
                return true;
            }
        });
    }

    async function saveStudio(c) {
        const fn = glob('handleManualSave');
        if (typeof fn !== 'function' || !studioOpen()) { await c.box('<p>Open Studio first: its settings are saved as the preset.</p>', null, { icon: 'info', title: 'Save Studio as Preset' }); return; }
        const box = document.getElementById('manualPresetName');
        const name = await nameDialog(c, { id: 'spellbookSaveStudioDialog', title: 'Save Studio as Preset', prompt: 'Save Studio\'s prompts and settings as the preset:', value: box ? box.value.trim() : '', check: (v) => (v ? '' : 'Type a name for the preset.') });
        if (!name) return;
        if (byKey(name)) {
            const yes = await c.box(`<p>"${esc(name)}" already exists.</p><p>Do you want to replace it?</p>`, kit.yesNo, { icon: 'warning', title: 'Save Studio as Preset' });
            if (yes !== true) return;
        }
        try {
            const ok = await fn({ name });
            if (ok === false) return;
            c.sel = name;
            if (c.node !== 'presets') c.select('presets');
            await reload();
        } catch (err) {
            await c.box(`<p>The preset could not be saved.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    // ---- a preset's property sheet ------------------------------------------------------------------------

    const sheets = new Map();
    let sheetSeq = 0;

    function detailsHtml(p) {
        const rows = [];
        const add = (k, v) => { if (v !== '' && v != null) rows.push([k, v]); };
        add('Effort', p.effort ? titleCase(p.effort) : '');
        const ds = parseMaybe(p.dataset_config);
        if (ds && Array.isArray(ds.include) && ds.include.length) add('Datasets', ds.include.map(titleCase).join(', '));
        if (p.width && p.height) add('Custom size', `${p.width} x ${p.height}`);
        if (p.image || p.image_source) add('Base image', `Yes${p.strength != null ? `, strength ${p.strength}` : ''}${p.noise != null ? `, noise ${p.noise}` : ''}${p.mask || p.mask_compressed ? ', masked (inpaint)' : ''}${p.image_bias ? ', image bias' : ''}`);
        const vibes = Array.isArray(p.vibe_transfer) ? p.vibe_transfer : [];
        if (vibes.length) add('Vibe transfers', `${vibes.length}: ${vibes.map((v) => (v && v.strength != null ? v.strength : '?')).join(', ')}${p.normalize_vibes ? ', normalized' : ''}`);
        if (p.chara_reference_source) add('Precise reference', 'Yes');
        const pipe = Array.isArray(p.pipeline) ? p.pipeline : [];
        if (pipe.length) add('Stages', `${pipe.length}: ${pipe.map((st) => titleCase(st && st.type)).join(', ')}`);
        const tr = Array.isArray(p.text_replacements) ? p.text_replacements.filter((x) => x && x.name) : [];
        if (tr.length) add('Embedded expanders', `${tr.length}: ${tr.map((x) => x.name).join(', ')}`);
        const ov = Array.isArray(p.text_overlays) ? p.text_overlays.filter((x) => x && !x.disabled) : [];
        if (ov.length) add('Text overlays', String(ov.length));
        if (p.upscale || p.upscaler) add('Upscaler', p.upscaler === 'local' ? `Local${p.localUpscaleScale ? `, ${p.localUpscaleScale}x` : ''}` : 'NovelAI');
        if (p.n) add('Prints', String(p.n));
        if (p.backgroundOnly) add('Background only', 'Yes');
        if (p.text_replacements_seed_preset) add('Expander seed', 'Kept with the preset');
        const body = rows.length ? `<dl class="mbk-details">${rows.map(([k, v]) => `<dt>${esc(k)}:</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : '<p class="mbk-muted">This preset has no other settings.</p>';
        return body;
    }

    function openSheet(c, key) {
        const e = byKey(key);
        if (!e) return;
        const have = sheets.get(key);
        if (have && have.modal && have.modal.isConnected) { if (typeof root.bringModalToFront === 'function') root.bringModalToFront(have.modal); return; }
        const api = dialogApi();
        const p = e.p;
        const ro = !!p.builtin;
        const work = { chars: clone(charsOf(p)) || [] };
        let current = e.key;
        const sizes = resolutionChoices();
        const resNow = String(p.resolution || '').toLowerCase();
        if (resNow && !sizes.some((s) => s.value === resNow)) sizes.unshift({ value: resNow, text: sizeLabel(p) });
        if (!resNow) sizes.unshift({ value: '', text: p.width && p.height ? `Custom (${p.width}x${p.height})` : '(not set)' });
        const models = modelChoices();
        const modelNow = String(p.model || '').toLowerCase();
        if (modelNow && !models.some((m) => m.value === modelNow)) models.unshift({ value: modelNow, text: String(p.model) });
        const dg = parseMaybe(p.dynamic_generation) || {};
        const initial = {};

        const paintChars = (ctx, sel) => kit.fillList(ctx.el(81, 'mbk:characters'), [{ t: 'Name', w: 90 }, { t: 'Prompt', w: 220 }, { t: 'On', w: 34 }],
            work.chars.map((ch, i) => ({ cells: [ch.chara_name || `Character ${i + 1}`, readable(ch.prompt, p, `character_${i}_prompt`), ch.enabled === false ? 'No' : 'Yes'], sel: i === sel })), 'There are no character prompts.');

        const editChar = (ctx, i) => {
            const ch = work.chars[i];
            if (!ch) return;
            api.openDialog({
                id: 'spellbookCharacterDialog',
                key: 'mbk:character',
                title: 'Character',
                owner: ctx.modal,
                focusFirst: true,
                init: (d) => {
                    d.set(102, ch.chara_name || '');
                    d.set(104, ch.prompt || '');
                    d.set(106, ch.uc || '');
                    d.set(107, ch.enabled !== false);
                    if (ro) d.content.querySelectorAll('input, textarea').forEach((x) => { x.disabled = true; });
                },
                ok: (d) => {
                    if (ro) return true;
                    const next = Object.assign({}, ch, { prompt: String(d.get(104) || ''), uc: String(d.get(106) || ''), enabled: !!d.get(107) });
                    const nm = String(d.get(102) || '').trim();
                    if (nm) next.chara_name = nm; else delete next.chara_name;
                    work.chars[i] = next;
                    work.charsChanged = true;
                    paintChars(ctx, i);
                    ctx.dirty();
                    return true;
                }
            });
        };

        const readForm = (ctx) => {
            const v = {};
            v.name = String(ctx.get(11) || '').trim();
            v.workspace = String(ctx.get(14) || 'default');
            v.resolution = String(ctx.get(16) || '');
            v.upscale = !!ctx.get(17);
            v.model = String(ctx.get(41) || '');
            v.steps = String(ctx.get(43) || '').trim();
            v.guidance = String(ctx.get(45) || '').trim();
            v.rescale = String(ctx.get(47) || '').trim();
            v.seed = String(ctx.get(49) || '').trim();
            v.sampler = String(ctx.get(51) || '');
            v.noise = String(ctx.get(53) || '');
            v.ucp = String(ctx.get(55) || '');
            v.variety = !!ctx.get(57);
            v.quality = !!ctx.get(58);
            v.paid = !!ctx.get(59);
            v.prompt = String(ctx.get(71) || '');
            v.uc = String(ctx.get(73) || '');
            v.coords = !!ctx.get(84);
            v.dg = {};
            RENTAN.forEach((r) => { v.dg[r.key] = !!ctx.get(r.id); });
            v.cache = !!ctx.get(313);
            return v;
        };

        const numOrNull = (s, int, min, max) => {
            if (s === '') return null;
            const n = int ? parseInt(s, 10) : parseFloat(s);
            if (!Number.isFinite(n)) return undefined;
            return Math.min(max, Math.max(min, n));
        };

        const apply = async (ctx) => {
            if (ro) return;
            const v = readForm(ctx);
            const ent = byKey(current);
            const base = ent ? ent.p : p;
            // General: update_preset (name, workspace, size, upscale)
            const simple = {};
            if (v.name && v.name !== current) {
                const err = presetNameCheck(current)(v.name);
                if (err) { await c.box(`<p>${esc(err)}</p>`, null, { icon: 'error', title: 'Preset Properties' }); ctx.set(11, current); v.name = current; } else simple.name = v.name;
            }
            if (v.workspace !== initial.workspace) simple.target_workspace = v.workspace;
            if (v.resolution !== initial.resolution && v.resolution) simple.resolution = v.resolution.toUpperCase();
            if (v.upscale !== initial.upscale) simple.request_upscale = v.upscale;
            // the rest: the whole record again (save_preset)
            const config = clone(base) || {};
            delete config.__key;
            let full = false;
            const setField = (k, val, was) => { if (val === was) return; full = true; if (val === null || val === '' || val === undefined) delete config[k]; else config[k] = val; };
            if (v.model !== initial.model && v.model) setField('model', v.model, initial.model);
            const steps = numOrNull(v.steps, true, 1, 50);
            const guidance = numOrNull(v.guidance, false, 0, 10);
            const rescale = numOrNull(v.rescale, false, 0, 1);
            const seed = numOrNull(v.seed, true, 0, 4294967295);
            if (v.steps !== initial.steps && steps !== undefined) setField('steps', steps, '__');
            if (v.guidance !== initial.guidance && guidance !== undefined) setField('guidance', guidance, '__');
            if (v.rescale !== initial.rescale && rescale !== undefined) setField('rescale', rescale, '__');
            if (v.seed !== initial.seed && seed !== undefined) setField('seed', seed, '__');
            if (v.sampler !== initial.sampler) setField('sampler', v.sampler || null, '__');
            if (v.noise !== initial.noise) setField('noiseScheduler', v.noise || null, '__');
            if (v.ucp !== initial.ucp) setField('append_uc', v.ucp === '' ? null : Number(v.ucp), '__');
            if (v.variety !== initial.variety) setField('variety', v.variety, '__');
            if (v.quality !== initial.quality) setField('append_quality', v.quality, '__');
            if (v.paid !== initial.paid) setField('allow_paid', v.paid, '__');
            if (v.prompt !== initial.prompt) { if (!v.prompt.trim()) { await c.box('<p>A preset needs a prompt. The prompt was not changed.</p>', null, { icon: 'error', title: 'Preset Properties' }); ctx.set(71, initial.prompt); } else setField('prompt', v.prompt, '__'); }
            if (v.uc !== initial.uc) setField('uc', v.uc || null, '__');
            if (work.charsChanged) { full = true; config[charsKey(base)] = clone(work.chars); work.charsChanged = false; }
            if (v.coords !== initial.coords) setField('use_coords', v.coords, '__');
            const dgChanged = RENTAN.some((r) => v.dg[r.key] !== initial.dg[r.key]);
            if (dgChanged) {
                full = true;
                const was = parseMaybe(base.dynamic_generation) || {};
                const next = Object.assign({}, typeof was === 'object' ? was : {});
                // an override value (a fixed season, a time of day) stays while the box stays checked
                RENTAN.forEach((r) => { if (v.dg[r.key]) { if (!next[r.key] || next[r.key] === 'false') next[r.key] = true; } else delete next[r.key]; });
                if (Object.keys(next).length) config.dynamic_generation = next; else delete config.dynamic_generation;
            }
            if (v.cache !== initial.cache) setField('use_cache_responses_preset', v.cache, '__');
            try {
                if (Object.keys(simple).length) {
                    const r = await ws().updatePreset(current, simple);
                    if (!okOf(r)) throw new Error(msgOf(r, 'The preset was not changed.'));
                    if (simple.name) {
                        sheets.delete(current);
                        current = simple.name;
                        sheets.set(current, ctx);
                        config.name = current;
                        const cap = ctx.modal && ctx.modal.querySelector('.modal-window-title-main span, .vdt-caption-text');
                        if (cap) cap.textContent = `${current} Properties`;
                    }
                    if (simple.target_workspace) config.target_workspace = simple.target_workspace;
                    if (simple.resolution) config.resolution = simple.resolution;
                    if (simple.request_upscale !== undefined) config.request_upscale = simple.request_upscale;
                }
                if (full) {
                    if (!config.prompt || !config.model) throw new Error('A preset needs a prompt and a model.');
                    delete config.preset_name;
                    const r = await ws().savePreset(current, config);
                    if (r && r.success === false) throw new Error(msgOf(r, 'The preset was not saved.'));
                }
                Object.assign(initial, readForm(ctx));
                if (Object.keys(simple).length || full) {
                    c.sel = current;
                    c.note(`"${current}" was saved.`);
                    await changed();
                }
            } catch (err) {
                await c.box(`<p>The preset could not be saved.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error', title: 'Preset Properties' });
            }
        };

        const sheet = api.openSheet({
            id: `spellbookPresetSheet${++sheetSeq}`,
            title: `${e.key} Properties`,
            owner: c.modal,
            icon: ICON16,
            noApply: ro,
            pages: [
                { key: 'mbk:general', overrides: { 10: { image: ICON32 } } },
                { key: 'mbk:generation', overrides: { 43: { spin: [1, 50] } } },
                { key: 'mbk:prompt' },
                { key: 'mbk:characters' },
                { key: 'mbk:rentan' },
                { key: 'mbk:details' }
            ],
            init: (ctx) => {
                ctx.set(11, e.key);
                const wsl = workspaceList();
                const wsNow = p.target_workspace || 'default';
                if (!wsl.some((w) => w.value === wsNow)) wsl.push({ value: wsNow, text: wsNow });
                ctx.options(14, wsl, wsNow);
                ctx.options(16, sizes, resNow);
                ctx.set(17, !!p.request_upscale);
                ctx.set(20, p.uuid || '');
                ctx.text(25, p.builtin ? 'Built-in Studio preset' : 'Saved preset');
                const chars = charsOf(p);
                ctx.text(27, chars.length ? `${chars.length}${p.use_coords ? ', positioned' : ''}` : 'None');
                const imgs = [];
                if (p.image || p.image_source) imgs.push(p.mask_compressed ? 'Base image, masked' : 'Base image');
                if (Array.isArray(p.vibe_transfer) && p.vibe_transfer.length) imgs.push(plural(p.vibe_transfer.length, 'vibe', 'vibes'));
                if (p.chara_reference_source) imgs.push('precise reference');
                ctx.text(29, imgs.length ? imgs.join(', ') : 'None');
                const pipe = Array.isArray(p.pipeline) ? p.pipeline : [];
                ctx.text(31, pipe.length ? String(pipe.length) : 'None');
                const tr = Array.isArray(p.text_replacements) ? p.text_replacements.filter((x) => x && x.name) : [];
                ctx.text(33, tr.length ? String(tr.length) : 'None');

                ctx.options(41, models.length ? models : [{ value: modelNow, text: p.model || '' }], modelNow);
                ctx.set(43, p.steps != null ? String(p.steps) : '');
                ctx.set(45, p.guidance != null ? String(p.guidance) : '');
                ctx.set(47, p.rescale != null ? String(p.rescale) : '');
                ctx.set(49, p.seed != null && p.seed !== '' ? String(p.seed) : '');
                ctx.options(51, samplerChoices(), samplerValue(p.sampler));
                ctx.options(53, noiseChoices(), noiseValue(p.noiseScheduler || p.noise_schedule));
                ctx.options(55, ucChoices(), ucValue(p.append_uc));
                ctx.set(57, !!p.variety);
                ctx.set(58, !!p.append_quality);
                ctx.set(59, !!p.allow_paid);

                ctx.set(71, p.prompt || '');
                ctx.set(73, p.uc || '');

                paintChars(ctx, -1);
                ctx.set(84, !!p.use_coords);
                const lv = ctx.el(81, 'mbk:characters');
                if (lv) lv.addEventListener('dblclick', (ev) => { const row = ev.target.closest('.vdt-lv-row'); if (row) editChar(ctx, Number(row.dataset.row)); });
                ctx.on(82, 'click', () => { const i = kit.selectedRow(lv); if (i >= 0) editChar(ctx, i); });
                ctx.on(83, 'click', () => {
                    const i = kit.selectedRow(lv);
                    if (i < 0 || ro) return;
                    work.chars.splice(i, 1);
                    work.charsChanged = true;
                    paintChars(ctx, Math.min(i, work.chars.length - 1));
                    ctx.dirty();
                });

                RENTAN.forEach((r) => { const val = dg[r.key]; ctx.set(r.id, !!val && val !== 'false'); });
                ctx.set(313, p.use_cache_responses_preset !== false);
                ctx.html(320, detailsHtml(p));

                ctx.on(21, 'click', () => { void copyAddress(c, current); });
                ctx.on(22, 'click', async () => { const u = await newUuid(c, current); if (u) ctx.set(20, u); });

                // the steps and numbers keep to their ranges as they are typed
                [[43, 1, 50, true], [45, 0, 10, false], [47, 0, 1, false]].forEach(([id, lo, hi, int]) => {
                    const el = ctx.el(id, 'mbk:generation');
                    if (el) el.addEventListener('change', () => { const n = numOrNull(String(el.value).trim(), int, lo, hi); if (n === undefined) el.value = initial[{ 43: 'steps', 45: 'guidance', 47: 'rescale' }[id]] || ''; else if (n !== null) el.value = String(n); });
                });

                if (ro) {
                    ctx.content.querySelectorAll('.tbp-page input, .tbp-page select, .tbp-page textarea').forEach((x) => { x.disabled = true; });
                    ctx.enable(22, false);
                    ctx.enable(83, false);
                }
                Object.assign(initial, readForm(ctx));
                sheets.set(current, ctx);
            },
            apply: (ctx) => apply(ctx),
            close: () => { sheets.delete(current); }
        });
        return sheet;
    }

    // ---- preset groups -------------------------------------------------------------------------------------

    const groupByName = (n) => (S.groups || []).find((g) => g.name === n) || null;

    function groupDialog(c, g) {
        const api = dialogApi();
        const list = (S.list || []).filter((e) => e.p.uuid);
        const chosen = new Set(g ? g.presets : []);
        api.openDialog({
            id: 'spellbookGroupDialog',
            key: 'mbk:group',
            title: g ? `${g.displayName || g.name} Properties` : 'New Preset Group',
            owner: c.modal,
            focusFirst: true,
            init: (ctx) => {
                ctx.set(102, g ? (g.displayName || g.name) : '');
                const rows = list.map((e, i) => `<div class="vdt-lv-row mbk-check-row"><span class="tbp-check" style="width:100%"><input type="checkbox" id="mbkGroupC${i}" data-uuid="${esc(e.p.uuid)}"${chosen.has(e.p.uuid) ? ' checked' : ''}><label for="mbkGroupC${i}"><span>${esc(e.key)}</span></label></span></div>`).join('');
                ctx.html(104, `<div class="vdt-listview vdt-edge is-report no-header mbk-checklist" tabindex="0"><div class="vdt-lv-body">${rows || '<div class="mbk-lv-empty">There are no presets with a UUID.</div>'}</div></div>`);
                const count = () => ctx.text(105, `${plural(chosen.size, 'preset', 'presets')} selected`);
                count();
                ctx.content.addEventListener('change', (ev) => {
                    const box = ev.target.closest('input[data-uuid]');
                    if (!box) return;
                    if (box.checked) chosen.add(box.dataset.uuid); else chosen.delete(box.dataset.uuid);
                    count();
                });
            },
            ok: async (ctx) => {
                const display = String(ctx.get(102) || '').trim();
                if (!display) { kit.dlgError(ctx, 106, 'Type a name for the group.'); return false; }
                const key = g ? g.name : display;
                if (!g && groupByName(key)) { kit.dlgError(ctx, 106, 'A group with that name already exists.'); return false; }
                const data = { name: display, presets: list.filter((e) => chosen.has(e.p.uuid)).map((e) => e.p.uuid) };
                if (g && g.uuid) data.uuid = g.uuid;
                try {
                    const r = await ws().savePresetGroup(key, data);
                    if (!okOf(r)) throw new Error(msgOf(r, 'The group was not saved.'));
                } catch (err) { kit.dlgError(ctx, 106, (err && err.message) || 'The group was not saved.'); return false; }
                c.sel = key;
                c.note(`The group "${display}" was saved.`);
                await reload();
                return true;
            }
        });
    }

    async function deleteGroup(c, name) {
        const g = groupByName(name);
        if (!g) return;
        const yes = await c.box(`<p>Are you sure you want to delete the preset group "${esc(g.displayName || g.name)}"?</p><p>Its presets are not deleted.</p>`, kit.yesNo, { icon: 'warning', title: 'Delete Preset Group' });
        if (yes !== true) return;
        try {
            const r = await ws().deletePresetGroup(name);
            if (!okOf(r)) throw new Error(msgOf(r, 'The group was not deleted.'));
            c.sel = null;
            c.note(`The group "${g.displayName || g.name}" was deleted.`);
            await reload();
        } catch (err) {
            await c.box(`<p>The group could not be deleted.</p><p>${esc((err && err.message) || '')}</p>`, null, { icon: 'error' });
        }
    }

    // ---- the console's def ---------------------------------------------------------------------------------

    function commands(node, c) {
        if (node.id === 'presets' || node.id === 'root') {
            return [
                { text: 'New Preset...', action: 'new', icon: `${CMD}/new.png` },
                { text: 'Save Studio as Preset...', action: 'save-studio', icon: `${CMD}/save.png` },
                { text: 'Import Presets...', action: 'import', icon: `${CMD}/download.png` },
                ...(node.id === 'presets' ? [
                    { text: 'Export Presets...', action: 'export-all', disabled: !(S.list && S.list.length) },
                    { separator: true },
                    { text: 'Find...', action: 'find', icon: `${CMD}/find.png` },
                    { text: 'Export List...', action: 'export-list', icon: 16 }
                ] : [])
            ];
        }
        if (node.id === 'groups') {
            return [
                { text: 'New Preset Group...', action: 'group-new', icon: `${CMD}/new.png` },
                { separator: true },
                { text: 'Export List...', action: 'export-list', icon: 16 }
            ];
        }
        return [];
    }

    function selCommands(node, key, c) {
        if (node.id === 'presets') {
            const e = byKey(key);
            if (!e) return null;
            const ro = !!e.p.builtin;
            return { title: e.key, items: [
                { text: 'Generate Image', action: 'generate', icon: `${CMD}/play.png` },
                { text: 'Open in Studio', action: 'studio', icon: `${CMD}/new-window.png` },
                { separator: true },
                { text: 'Copy Address', action: 'copy-address', icon: `${CMD}/copy.png`, disabled: !e.p.uuid },
                { text: 'Copy Prompt', action: 'copy-prompt', disabled: !e.p.prompt },
                { text: 'Add to Desktop', action: 'desktop', icon: `${CMD}/desktop.png`, disabled: !e.p.uuid },
                { text: 'New UUID...', action: 'new-uuid', disabled: ro },
                { separator: true },
                { text: 'Duplicate...', action: 'duplicate', icon: `${CMD}/copy.png` },
                { text: 'Rename...', action: 'rename', icon: `${CMD}/rename.png`, disabled: ro },
                { text: 'Delete', action: 'delete', icon: `${CMD}/delete.png`, disabled: ro },
                { text: 'Export...', action: 'export' },
                { separator: true },
                { text: 'Properties', action: 'open', icon: 8 }
            ] };
        }
        if (node.id === 'groups') {
            const g = groupByName(key);
            if (!g) return null;
            return { title: g.displayName || g.name, items: [
                { text: 'Copy Address', action: 'group-copy', icon: `${CMD}/copy.png`, disabled: !g.uuid },
                { separator: true },
                { text: 'Delete', action: 'delete', icon: `${CMD}/delete.png` },
                { separator: true },
                { text: 'Properties', action: 'open', icon: 8 }
            ] };
        }
        return null;
    }

    function toolbar(node, c) {
        if (node.id === 'presets' || node.id === 'groups') {
            const none = c.sel == null || (node.id === 'presets' ? !byKey(c.sel) : !groupByName(c.sel));
            const builtin = node.id === 'presets' && byKey(c.sel) && byKey(c.sel).p.builtin;
            return [
                { id: 'refresh', i: 3, title: 'Refresh' },
                { id: 'export-list', i: 16, title: 'Export List' },
                { id: 'open', i: 8, title: 'Properties', disabled: none },
                { id: 'delete', i: 11, title: 'Delete', disabled: none || !!builtin }
            ];
        }
        return [{ id: 'refresh', i: 3, title: 'Refresh' }];
    }

    async function action(a, c) {
        const node = c.node;
        const key = c.sel;
        switch (a) {
            case 'refresh': c.note(''); await reload(); return true;
            case 'find': { if (node !== 'presets') c.select('presets'); const i = c.el('.mbk-search'); if (i) { i.focus(); i.select(); } return true; }
            case 'new': newPreset(c); return true;
            case 'save-studio': await saveStudio(c); return true;
            case 'import': await importPresets(c); return true;
            case 'export-all': await exportPresets(c, (S.list || []).filter((e) => !e.p.builtin).map((e) => e.key)); return true;
            case 'export-list': await exportList(c); return true;
            case 'group-new': groupDialog(c, null); return true;
            case 'help': if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('spellbook'); return true;
            default:
        }
        if (key == null) return a === 'open' || a === 'delete';
        if (node === 'groups') {
            if (a === 'open') { const g = groupByName(key); if (g) groupDialog(c, g); return true; }
            if (a === 'delete') { await deleteGroup(c, key); return true; }
            if (a === 'group-copy') { const g = groupByName(key); if (g && g.uuid) await kit.copy(c, addressOf(g.uuid), 'The group\'s address'); return true; }
            return false;
        }
        if (node !== 'presets') return false;
        switch (a) {
            case 'open': openSheet(c, key); return true;
            case 'generate': await generate(c, key); return true;
            case 'studio': await openInStudio(c, key); return true;
            case 'copy-address': await copyAddress(c, key); return true;
            case 'copy-prompt': { const e = byKey(key); if (e) await kit.copy(c, readable(e.p.prompt, e.p, 'prompt'), 'The prompt'); return true; }
            case 'desktop': await addToDesktop(c, key); return true;
            case 'new-uuid': await newUuid(c, key); return true;
            case 'duplicate': await duplicate(c, key); return true;
            case 'rename': await rename(c, key); return true;
            case 'delete': await remove(c, key); return true;
            case 'export': await exportPresets(c, [key]); return true;
            default: return false;
        }
    }

    function status(node, c) {
        if (node.id === 'presets') {
            if (!S.list) return S.error ? 'The server did not answer.' : 'Reading data, please wait...';
            const v = viewOf(c);
            const shown = (v.search || v.ws) ? (S.list || []).filter((e) => matches(e, v.search, v.ws)).length : null;
            return shown == null ? plural(S.list.length, 'preset', 'presets') : `${shown} of ${plural(S.list.length, 'preset', 'presets')}`;
        }
        if (node.id === 'groups') return S.groups ? plural(S.groups.length, 'preset group', 'preset groups') : 'Reading data, please wait...';
        return '';
    }

    function rowOpen(key, node, c) {
        void action('open', c);
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
            rowOpen,
            status,
            onSelectRow: (key, node, c) => { kit.toolbarAgain(c); },
            about: { version: '1.0.0', lines: ['Spellbook keeps your presets and preset groups.'] },
            help: () => { if (typeof root.openHelpAndSupport === 'function') root.openHelpAndSupport('spellbook'); },
            onOpen: (c) => {
                S.consoles.add(c);
                wireServer();
                void reload();
            },
            onClose: (c) => { S.consoles.delete(c); }
        };
    }

    function applyOpts(c, opts) {
        const o = opts || {};
        if (o.search !== undefined) { viewOf(c).search = String(o.search || ''); c.refresh(); }
        if (o.preset) {
            const want = String(o.preset);
            const go = () => { if (byKey(want)) { c.sel = want; c.refresh(); openSheet(c, want); } };
            if (S.list) go(); else setTimeout(function wait(n = 0) { if (S.list) go(); else if (n < 40) setTimeout(() => wait(n + 1), 250); }, 250);
        }
    }

    async function openSpellbookConsole(node, opts) {
        if (root.featureLoader) await root.featureLoader.loadFeature('mmc_snapins');
        if (!root.mmcConsole) return null;
        const target = ['root', 'presets', 'groups'].includes(node) ? node : 'presets';
        const c = root.mmcConsole.open(def(), { node: target });
        if (c && opts) applyOpts(c, opts);
        return c;
    }

    root.openSpellbookConsole = openSpellbookConsole;
    root.mmcSpellbook = { def, open: openSpellbookConsole, _state: S };
})(typeof window !== 'undefined' ? window : globalThis);
