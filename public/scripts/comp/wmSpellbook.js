/**
 * Melaton Mobile: Spellbook, a phone version of the desktop's preset manager (presetManager.js,
 * Toolbox > Spellbook = showPresetManager), Yozora #732 (parent #709). Not the desktop window
 * re-hosted: the same presets (wsClient getPresets / updatePreset / deletePreset) on WM screens.
 *
 * Laid out like WM 6.1's Contacts (Device Emulator VGA, 2x halved; ~/.cache/wm61/ref-notes):
 *   list         "Enter a name..." type-to-find box (20 px, 1 px black frame, on the 26 px tab-strip
 *                band; it matches names and prompts like the desktop's search), the letter tabs
 *                (#ab cde ... xyz, 17 px; a tap goes to the first preset of the group's letters, again
 *                to the next letter), rows 28 px with a 1 px #A5A5A5 rule: the Spellbook icon, the bold
 *                name, the model and size under it ("v4.5 Full  Portrait 832x1216  28 steps");
 *                "No matches: <text>" as a highlight bar. Soft keys Open / Menu; tap = Open in Studio
 *                (the desktop's own route: openManualModalWithContent({ type: 'preset', name })),
 *                tap-and-hold = the row's menu.
 *   details      Contacts' card: the name band, label / value rows (model, size, steps, guidance,
 *                upscale, workspace, characters, images) and the prompt; soft keys Studio / Menu; ok
 *                goes back.
 *   rename       a WM edit box (the desktop's rule: no two presets with one name); delete asks Yes /
 *                No with the question icon. The built-in "Background" preset can do neither.
 *
 * Every desktop route to the preset manager window (showPresetManager: Toolbox, Run, Spellcaster,
 * Data Management) opens this app on phones. Only on phones. Styles: public/css/wm-spellbook.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'spellbook';
    const ICON = '/static_images/app_icons/presetbook.png';
    const GROUPS = ['#ab', 'cde', 'fgh', 'ijk', 'lmn', 'opq', 'rst', 'uvw', 'xyz'];
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const wsc = () => window.wsClient || null;

    let sh = null;
    let page = null;
    let entries = []; // { key, p }
    let loaded = false;
    let search = '';
    let selectedKey = null;
    let group = null; // { at, letter }
    let layers = []; // 'details'
    let current = null; // the entry on the details page

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const connected = () => { const c = wsc(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };

    // ---------------------------------------------------------------- labels (the desktop manager's rules)

    function modelLabel(model) {
        const v = String(model || '').toLowerCase();
        try {
            /* global modelGroups */
            if (typeof modelGroups !== 'undefined' && Array.isArray(modelGroups)) {
                for (const g of modelGroups) {
                    const o = (g.options || []).find((x) => String(x.value).toLowerCase() === v);
                    if (o) return `${o.display}${o.badge_full || o.badge ? ` ${o.badge_full || o.badge}` : ''}`;
                }
            }
        } catch (_) { /* below */ }
        return model ? String(model) : 'v4.5?';
    }

    function sizeOf(res) {
        const v = String(res || '').toLowerCase();
        try {
            /* global RESOLUTIONS */
            if (typeof RESOLUTIONS !== 'undefined' && Array.isArray(RESOLUTIONS)) {
                const r = RESOLUTIONS.find((x) => String(x.value).toLowerCase() === v);
                if (r) return { label: r.display.replace('Normal ', ''), dims: `${r.width}x${r.height}`, paid: /^(large_|xlarge_|wallpaper_)/.test(v) };
            }
        } catch (_) { /* below */ }
        return { label: res ? String(res) : 'Portrait?', dims: '', paid: false };
    }

    function workspaceName(id) {
        try {
            /* global workspaces */
            if (id && typeof workspaces !== 'undefined' && workspaces && workspaces[id]) return workspaces[id].name || id;
        } catch (_) { /* below */ }
        return id ? String(id) : 'Default';
    }

    function subLine(p) {
        const s = sizeOf(p.resolution);
        const bits = [modelLabel(p.model), `${s.label}${s.dims ? ` ${s.dims}` : ''}`];
        if (p.steps) bits.push(`${p.steps} steps`);
        return bits.join('\u2002');
    }

    const nameOf = (e) => (e.p && e.p.name) || e.key;
    const sortKey = (e) => nameOf(e).toLowerCase();

    // ---------------------------------------------------------------- data

    async function load() {
        if (!connected()) throw new Error('The server connection is down.');
        // one page holds them all (the server pages only for the desktop's 15-row view)
        const r = await wsc().getPresets(1, 5000, '');
        const presets = (r && r.presets) || (r && r.data && r.data.presets) || {};
        entries = Object.keys(presets).map((key) => ({ key, p: presets[key] || {} }));
        const coll = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
        entries.sort((a, b) => coll.compare(nameOf(a), nameOf(b)));
        loaded = true;
    }

    function matches(e, q) {
        if (!q) return true;
        const s = q.toLowerCase();
        return nameOf(e).toLowerCase().includes(s) || e.key.toLowerCase().includes(s) || String(e.p.prompt || '').toLowerCase().includes(s);
    }

    const visible = () => entries.filter((e) => matches(e, search));
    const entryByKey = (k) => entries.find((e) => e.key === k) || null;
    const selectedEntry = () => entryByKey(selectedKey);

    async function refresh(opts = {}) {
        try {
            if (opts.quiet) await load();
            else await sh.busy(load, { paint: true });
        } catch (err) {
            if (!opts.quiet || !loaded) sh.notify({ title: 'Spellbook', icon: 'error', text: `The presets could not be read.\n\n${(err && err.message) || ''}`.trim() });
        }
        renderList();
    }

    // ---------------------------------------------------------------- list

    function renderList() {
        if (!page) return;
        const shown = visible();
        // WM Contacts: a row is always selected (the first one until the user picks)
        if (!shown.some((e) => e.key === selectedKey)) selectedKey = shown.length ? shown[0].key : null;
        const nomatch = page.querySelector('.wsb-nomatch');
        nomatch.hidden = !(search && !shown.length && entries.length);
        nomatch.textContent = `No matches: ${search}`;
        const note = page.querySelector('.wsb-note');
        note.hidden = !(loaded && !entries.length);
        note.textContent = 'No presets. Save one from Studio (Menu > File > Save Preset).';
        page.querySelector('.wsb-list').innerHTML = shown.map((e) => {
            const sel = e.key === selectedKey;
            return `<div class="wsb-row${sel ? ' is-selected' : ''}" role="option" aria-selected="${sel}" data-key="${esc(e.key)}">`
                + `<span class="wsb-ico"><img src="${ICON}" alt="" draggable="false"></span>`
                + `<span class="wsb-name">${esc(nameOf(e))}</span>`
                + `<span class="wsb-sub">${esc(subLine(e.p))}</span></div>`;
        }).join('');
        page.querySelectorAll('.wsb-tab').forEach((t, n) => t.classList.toggle('is-selected', !!group && group.at === n));
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function selectRow(key) {
        selectedKey = key;
        page.querySelectorAll('.wsb-row').forEach((r) => {
            const on = r.dataset.key === key;
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) sh.refreshSoftKeys();
    }

    function scrollToSelected() {
        const row = selectedKey && page.querySelector(`.wsb-row[data-key="${CSS.escape(selectedKey)}"]`);
        if (row) row.scrollIntoView({ block: 'start' });
    }

    /** A letter tab: the first preset of its first letter; tapping again goes to the next letter. */
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

    // ---------------------------------------------------------------- layers

    function showLayer() {
        if (!page) return;
        const v = view();
        page.querySelector('.wsb-listview').hidden = v !== 'list';
        page.querySelector('.wsb-details').hidden = v !== 'details';
        if (isCurrent()) {
            sh.refreshSoftKeys();
            sh.refreshTitleAction();
        }
    }

    function openDetails(e) {
        if (!e) return;
        current = e;
        selectedKey = e.key;
        renderDetails();
        layers.push('details');
        showLayer();
        sh.syncHistory();
    }

    function renderDetails() {
        if (!page || !current) return;
        const p = current.p;
        const s = sizeOf(p.resolution);
        const rows = [];
        const add = (label, value) => { if (value !== '' && value != null) rows.push([label, value]); };
        add('Model', modelLabel(p.model));
        add('Size', `${s.label}${s.dims ? ` (${s.dims})` : ''}${s.paid ? ', costs Anlas' : ''}`);
        if (p.steps) add('Steps', `${p.steps}${Number(p.steps) > 28 ? ', costs Anlas' : ''}`);
        if (p.guidance != null && p.guidance !== '') add('Guidance', `${p.guidance}${p.rescale ? ` / ${Math.round(Number(p.rescale) * 100)}%` : ''}`);
        if (p.request_upscale || p.upscale) add('Upscale', 'Yes');
        add('Workspace', workspaceName(p.target_workspace));
        const chars = Array.isArray(p.characterPrompts) ? p.characterPrompts.filter((c) => c && c.prompt).length : 0;
        if (chars) add('Characters', String(chars));
        if (p.image || p.image_source) add('Base image', 'Yes');
        const vibes = Array.isArray(p.vibe_transfer) ? p.vibe_transfer.length : 0;
        if (vibes) add('Vibes', String(vibes));
        if (p.chara_reference_source) add('Precise ref.', 'Yes');
        if (p.builtin) add('Type', 'Built-in');
        const box = page.querySelector('.wsb-details');
        box.querySelector('.wsb-card-name').textContent = nameOf(current);
        box.querySelector('.wsb-card-rows').innerHTML = rows.map(([l, v]) => `<div class="wsb-crow"><span class="wsb-clabel">${esc(l)}:</span><span class="wsb-cvalue">${esc(v)}</span></div>`).join('');
        const prompt = String(p.prompt || '').trim();
        box.querySelector('.wsb-card-prompt').textContent = prompt || '(no prompt)';
        box.querySelector('.wsb-card-prompt').classList.toggle('is-empty', !prompt);
    }

    // ---------------------------------------------------------------- actions

    function openInStudio(e) {
        if (!e) return;
        if (typeof window.openManualModalWithContent !== 'function') {
            sh.notify({ title: 'Spellbook', icon: 'error', text: 'Studio is not available.' });
            return;
        }
        // the desktop preset manager's own call; the phone's Studio app comes up with its wait cursor
        window.openManualModalWithContent({ type: 'preset', name: e.key, title: nameOf(e) });
    }

    async function rename(e) {
        if (!e || e.p.builtin) return;
        const old = e.key;
        const name = await sh.messageBox({ title: 'Rename', text: 'Enter a new name for the preset:', input: { value: nameOf(e) }, buttons: [{ text: 'OK', value: true, default: true }, { text: 'Cancel', value: false }] });
        if (name == null) return;
        const next = String(name).trim();
        if (!next || next === old) return;
        if (entries.some((x) => x.key !== old && (x.key === next || nameOf(x) === next))) {
            sh.notify({ title: 'Spellbook', icon: 'warning', text: 'A preset with that name already exists.' });
            return;
        }
        try {
            await sh.busy(async () => {
                const r = await wsc().updatePreset(old, { name: next });
                if (r && r.success === false) throw new Error(r.message || r.error || 'The server refused.');
                // the preset list the rest of the client reads (appBootstrap.js)
                /* global refreshAppOptionsChunk */
                if (typeof refreshAppOptionsChunk === 'function') { try { await refreshAppOptionsChunk('presets'); } catch (_) { /* list only */ } }
                await load();
            }, { paint: true });
        } catch (err) {
            sh.notify({ title: 'Spellbook', icon: 'error', text: `The preset could not be renamed.\n\n${(err && err.message) || ''}`.trim() });
            return;
        }
        selectedKey = entryByKey(next) ? next : (entries.find((x) => nameOf(x) === next) || {}).key || null;
        if (current && current.key === old) { current = entryByKey(selectedKey); if (current) renderDetails(); }
        renderList();
        scrollToSelected();
    }

    async function remove(e) {
        if (!e || e.p.builtin) return;
        const yes = await sh.messageBox({ title: 'Spellbook', icon: 'question', text: `Preset "${nameOf(e)}" will be deleted. Continue?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        try {
            await sh.busy(async () => {
                const r = await wsc().deletePreset(e.key);
                if (!r || r.success === false) throw new Error((r && (r.message || r.error)) || 'The server refused.');
                if (typeof refreshAppOptionsChunk === 'function') { try { await refreshAppOptionsChunk('presets'); } catch (_) { /* list only */ } }
                await load();
            }, { paint: true });
        } catch (err) {
            sh.notify({ title: 'Spellbook', icon: 'error', text: `The preset could not be deleted.\n\n${(err && err.message) || ''}`.trim() });
            return;
        }
        if (selectedKey === e.key) selectedKey = null;
        if (current && current.key === e.key) { layers = []; current = null; showLayer(); sh.syncHistory(); }
        renderList();
    }

    function rowMenu(e) {
        const fixed = !e || !!e.p.builtin;
        return [
            { label: 'Open in Studio', disabled: !e, action: () => openInStudio(e) },
            { label: 'Properties', disabled: !e, action: () => openDetails(e) },
            '-',
            { label: 'Rename...', disabled: fixed, action: () => rename(e) },
            { label: 'Delete', disabled: fixed, action: () => remove(e) }
        ];
    }

    function listMenu() {
        return rowMenu(selectedEntry()).concat(['-', { label: 'Refresh', action: () => refresh() }]);
    }

    function detailsMenu() {
        return rowMenu(current);
    }

    // ---------------------------------------------------------------- page

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
        el.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) clear(); });
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
        el.addEventListener('click', (e) => {
            if (!held) return;
            held = false;
            e.stopPropagation();
            e.preventDefault();
        }, true);
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-spellbook');
        p.innerHTML = `
            <div class="wsb-listview">
                <div class="wsb-searchbar"><input class="wsb-search" type="search" enterkeyhint="search" autocomplete="off" placeholder="Enter a name..." aria-label="Enter a name"></div>
                <div class="wsb-tabs" role="tablist">${GROUPS.map((g, n) => `<button type="button" class="wsb-tab" data-at="${n}">${esc(g)}</button>`).join('')}</div>
                <div class="wsb-nomatch" hidden></div>
                <div class="wsb-scroll"><div class="wsb-list" role="listbox" aria-label="Presets"></div><p class="wsb-note" hidden></p></div>
            </div>
            <div class="wsb-details" hidden>
                <div class="wsb-card-head"><img src="${ICON}" alt="" draggable="false"><span class="wsb-card-name"></span></div>
                <div class="wsb-card-body"><div class="wsb-card-rows"></div><div class="wsb-card-sub">Prompt:</div><div class="wsb-card-prompt"></div></div>
            </div>`;
        const searchEl = p.querySelector('.wsb-search');
        searchEl.addEventListener('input', () => {
            search = searchEl.value.trim();
            group = null;
            renderList();
            const first = visible()[0];
            if (first) selectRow(first.key);
        });
        searchEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); const s = selectedEntry(); if (s) openInStudio(s); }
        });
        p.querySelector('.wsb-tabs').addEventListener('click', (e) => {
            const t = e.target.closest('.wsb-tab');
            if (t) jumpTo(Number(t.dataset.at));
        });
        const scroll = p.querySelector('.wsb-scroll');
        onHold(scroll, '.wsb-row', (row, x, y) => {
            selectRow(row.dataset.key);
            sh.menuAt(x, y, rowMenu(entryByKey(row.dataset.key)));
        });
        scroll.addEventListener('click', (e) => {
            const row = e.target.closest('.wsb-row');
            if (!row) return;
            selectRow(row.dataset.key);
            openInStudio(entryByKey(row.dataset.key));
        });
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        // every desktop route to the preset manager window opens this app (Toolbox, Run, Spellcaster ...)
        window.showPresetManager = async function () { sh.open(APP_ID); };
        sh.registerApp({
            id: APP_ID,
            title: 'Spellbook',
            icon: 'app-spellbook',
            inStart: 'programs',
            programsFolder: 'toolbox',
            sip: true,
            mount,
            show() {
                showLayer();
                refresh({ quiet: loaded });
            },
            titleKind: () => (view() === 'list' ? 'close' : 'ok'),
            historyDepth: () => layers.length,
            onBack() {
                if (!layers.length) return false;
                layers.pop();
                if (!layers.length) current = null;
                showLayer();
                return true;
            },
            softKeys() {
                if (view() === 'details') return { left: { label: 'Studio', action: () => openInStudio(current) }, right: { label: 'Menu', menu: detailsMenu } };
                return { left: { label: 'Open', disabled: !selectedEntry(), action: () => openInStudio(selectedEntry()) }, right: { label: 'Menu', menu: listMenu } };
            }
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
