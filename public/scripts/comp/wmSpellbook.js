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
 *                "No matches: <text>" as a highlight bar. Soft keys Open / Menu; tap = the preset's
 *                page, tap-and-hold = the row's menu.
 *   preset       Contacts' summary card: the name band, the Open in Studio / Open in Spellcaster
 *                buttons, then every setting the preset stores in label / value rows (model, effort,
 *                size, upscale, steps, guidance and rescale, sampler and noise schedule, seed, Variety+,
 *                quality tags, UC preset, datasets, workspace, Anlas) and its sections: Prompt,
 *                Undesired Content, Characters (each one's prompt, undesired content, position), Images
 *                (base image with strength / noise, vibe transfers, precise reference), Stages, Rentan,
 *                Text Expanders, Text Overlays. Soft keys Edit / Menu (Open in Studio, Open in
 *                Spellcaster, Edit, Rename, Delete); ok goes back.
 *   edit         a WM form for what the desktop's Update Preset window edits (update_preset takes
 *                these): Name, Workspace, Size, Upscale; ok or Save writes it (wsClient.updatePreset,
 *                then refreshAppOptionsChunk('presets')), Cancel leaves it. Everything else is changed
 *                in Studio and saved again from there.
 *   rename       a WM edit box (the desktop's rule: no two presets with one name); delete asks Yes /
 *                No with the question icon. The built-in "Background" preset can do none of these.
 *
 * Open in Studio is the desktop's own call (openManualModalWithContent({ type: 'preset', name }));
 * Open in Spellcaster opens the phone's Spellcaster on that spell (wmSpellcaster.js openSpell).
 * Every desktop route to the preset manager window (showPresetManager: Toolbox, Run, Spellcaster,
 * Data Management) opens this app on phones. Only on phones. Styles: public/css/wm-spellbook.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'spellbook';
    const TITLE = 'Spellbook';
    const ICON = '/static_images/app_icons/presetbook.webp';
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
    let layers = []; // 'details', 'edit'
    let current = null; // the entry on the preset page
    let draft = null; // the edit form: { workspace, resolution, upscale }

    const view = () => layers[layers.length - 1] || 'list';
    const isCurrent = () => !!sh && sh.current === APP_ID;
    const connected = () => { const c = wsc(); return !!(c && typeof c.isConnected === 'function' && c.isConnected()); };
    const fail = (text) => sh.messageBox({ title: TITLE, icon: 'error', text });

    // ---------------------------------------------------------------- labels (the desktop's rules)

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

    function sizeOf(res, p) {
        const v = String(res || '').toLowerCase();
        try {
            /* global RESOLUTIONS */
            if (typeof RESOLUTIONS !== 'undefined' && Array.isArray(RESOLUTIONS)) {
                const r = RESOLUTIONS.find((x) => String(x.value).toLowerCase() === v);
                if (r) return { label: r.display.replace('Normal ', ''), dims: `${r.width}x${r.height}`, paid: /^(large_|xlarge_|wallpaper_)/.test(v) };
            }
        } catch (_) { /* below */ }
        const dims = p && p.width && p.height ? `${p.width}x${p.height}` : '';
        if (v.startsWith('custom')) return { label: 'Custom', dims, paid: false };
        return { label: res ? String(res) : (dims ? 'Custom' : 'Portrait?'), dims, paid: false };
    }

    function workspaceName(id) {
        try {
            /* global workspaces */
            if (id && typeof workspaces !== 'undefined' && workspaces && workspaces[id]) return workspaces[id].name || id;
        } catch (_) { /* below */ }
        return !id || id === 'default' ? 'Default' : String(id);
    }

    function samplerLabel(v) {
        const t = String(v || '').toUpperCase();
        try {
            /* global SAMPLER_MAP */
            if (typeof SAMPLER_MAP !== 'undefined') {
                const m = SAMPLER_MAP.find((x) => x.request === t || String(x.meta).toUpperCase() === t);
                if (m) return m.display;
            }
        } catch (_) { /* below */ }
        return v ? String(v) : '';
    }

    function noiseLabel(v) {
        const t = String(v || '').toUpperCase();
        try {
            /* global NOISE_MAP */
            if (typeof NOISE_MAP !== 'undefined') {
                const m = NOISE_MAP.find((x) => x.request === t || String(x.meta).toUpperCase() === t);
                if (m) return m.display;
            }
        } catch (_) { /* below */ }
        return v ? String(v) : '';
    }

    function ucPresetLabel(v) {
        if (v == null || v === '') return '';
        try {
            /* global UC_PRESET_LEVEL_LABELS, ucPresetLevelFromId */
            if (typeof UC_PRESET_LEVEL_LABELS !== 'undefined' && typeof ucPresetLevelFromId === 'function') return UC_PRESET_LEVEL_LABELS[ucPresetLevelFromId(v)] || String(v);
        } catch (_) { /* below */ }
        return String(v);
    }

    const parseMaybe = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return null; } };
    const titleCase = (s) => String(s || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    /** Prompt text as Studio shows it: its managed emphasis groups as weights, no invisible marks. */
    function readable(text, p, hint) {
        let t = String(text == null ? '' : text);
        try {
            /* global expandEmphasisGroupIds, coalesceEmphasisWeightSource, stripUnmanagedEmphasisInvisibles */
            if (typeof expandEmphasisGroupIds === 'function') {
                const bag = typeof coalesceEmphasisWeightSource === 'function' ? coalesceEmphasisWeightSource(parseMaybe(p.emphasis_normalization), hint) : null;
                t = expandEmphasisGroupIds(t, bag).text;
            }
            if (typeof stripUnmanagedEmphasisInvisibles === 'function') t = stripUnmanagedEmphasisInvisibles(t);
        } catch (_) { /* below */ }
        return t.replace(/[\u200B-\u200F\u2060-\u2064\uFEFF]/g, '').trim();
    }

    function subLine(p) {
        const s = sizeOf(p.resolution, p);
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
        if (current) {
            current = entryByKey(current.key);
            if (!current) { layers = []; draft = null; }
        }
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
            if (!opts.quiet || !loaded) sh.notify({ title: TITLE, icon: 'error', text: `The presets could not be read.\n\n${(err && err.message) || ''}`.trim() });
        }
        renderList();
        if (view() === 'details' && current) renderDetails();
        showLayer();
    }

    /** After a change: the client's preset list (appBootstrap.js; Studio, Spellcaster read it) and this one. */
    async function reloadAll() {
        /* global refreshAppOptionsChunk */
        if (typeof refreshAppOptionsChunk === 'function') { try { await refreshAppOptionsChunk('presets'); } catch (_) { /* list only */ } }
        await load();
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
        page.querySelector('.wsb-edit').hidden = v !== 'edit';
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
        page.querySelector('.wsb-card-body').scrollTop = 0;
        if (view() !== 'details') layers = ['details'];
        showLayer();
        sh.syncHistory();
    }

    // ---------------------------------------------------------------- the preset's page

    function renderDetails() {
        if (!page || !current) return;
        const p = current.p;
        const s = sizeOf(p.resolution, p);
        const rows = [];
        const add = (label, value) => { if (value !== '' && value != null) rows.push([label, String(value)]); };
        const onOff = (v) => (v ? 'On' : 'Off');
        add('Model', modelLabel(p.model));
        if (p.effort) add('Effort', titleCase(p.effort));
        add('Size', `${s.label}${s.dims ? ` (${s.dims})` : ''}${s.paid ? ', costs Anlas' : ''}`);
        add('Upscale', p.request_upscale || p.upscale ? 'Yes' : 'No');
        if (p.steps) add('Steps', `${p.steps}${Number(p.steps) > 28 ? ', costs Anlas' : ''}`);
        if (p.guidance != null && p.guidance !== '') add('Guidance', p.guidance);
        if (p.rescale != null && p.rescale !== '') add('Rescale', p.rescale);
        add('Sampler', samplerLabel(p.sampler));
        add('Noise', noiseLabel(p.noiseScheduler || p.noise_schedule));
        add('Seed', p.seed ? `${p.seed}${p.seedLock ? ' (locked)' : ''}` : 'Random');
        if (p.variety != null) add('Variety+', onOff(p.variety));
        if (p.append_quality != null) add('Quality tags', onOff(p.append_quality));
        if (p.append_uc != null && p.append_uc !== '') add('UC preset', ucPresetLabel(p.append_uc));
        const ds = parseMaybe(p.dataset_config);
        if (ds && Array.isArray(ds.include) && ds.include.length) add('Datasets', ds.include.map(titleCase).join(', '));
        add('Workspace', workspaceName(p.target_workspace));
        if (p.allow_paid != null) add('Anlas', p.allow_paid ? 'May use Anlas' : 'Free only');
        if (p.builtin) add('Type', 'Built-in');

        const sections = [];
        const text = (title, value, empty) => {
            sections.push(`<div class="wsb-card-sub">${esc(title)}</div><div class="wsb-card-text${value ? '' : ' is-empty'}">${esc(value || empty)}</div>`);
        };
        text('Prompt', readable(p.prompt, p, 'prompt'), '(no prompt)');
        text('Undesired Content', readable(p.uc, p, 'uc'), '(none)');

        const chars = (Array.isArray(p.allCharacterPrompts) && p.allCharacterPrompts.length ? p.allCharacterPrompts : (Array.isArray(p.characterPrompts) ? p.characterPrompts : [])).filter((c) => c && (c.prompt || c.uc));
        if (chars.length) {
            sections.push(`<div class="wsb-card-sub">Characters (${chars.length})</div>`);
            chars.forEach((c, i) => {
                const bits = [];
                if (c.enabled === false) bits.push('off');
                if (p.use_coords && c.center && Number.isFinite(c.center.x)) bits.push(`at ${Math.round(c.center.x * 100)}%, ${Math.round(c.center.y * 100)}%`);
                sections.push(`<div class="wsb-char"><div class="wsb-char-name">${esc(c.chara_name || `Character ${i + 1}`)}${bits.length ? ` <span class="wsb-char-note">(${esc(bits.join(', '))})</span>` : ''}</div>`
                    + `<div class="wsb-card-text">${esc(readable(c.prompt, p, `character_${i}_prompt`) || '(no prompt)')}</div>`
                    + (c.uc ? `<div class="wsb-card-text wsb-char-uc"><span class="wsb-char-label">Undesired:</span> ${esc(readable(c.uc, p, `character_${i}_uc`))}</div>` : '')
                    + '</div>');
            });
        }

        const imgRows = [];
        if (p.image || p.image_source) imgRows.push(['Base image', `Yes${p.strength != null ? `, strength ${p.strength}` : ''}${p.noise != null ? `, noise ${p.noise}` : ''}${p.mask || p.mask_compressed ? ', masked' : ''}`]);
        const vibes = Array.isArray(p.vibe_transfer) ? p.vibe_transfer : [];
        if (vibes.length) imgRows.push(['Vibes', `${vibes.length}: ${vibes.map((v) => (v && v.strength != null ? v.strength : '?')).join(', ')}${p.normalize_vibes ? ', normalized' : ''}`]);
        if (p.chara_reference_source) imgRows.push(['Precise ref.', 'Yes']);
        const pipe = Array.isArray(p.pipeline) ? p.pipeline : [];
        if (pipe.length) imgRows.push(['Stages', `${pipe.length}: ${pipe.map((st) => titleCase(st && st.type)).join(', ')}`]);
        const dg = parseMaybe(p.dynamic_generation);
        const RENTAN = { tod: 'Time of day', weather: 'Weather', season: 'Season', observeHoliday: 'Holidays', clothing: 'Clothing', action: 'Action', creative: 'Creative', optimize: 'Optimize', location: 'Location', activity: 'Activity', guidance: 'Guidance' };
        const dgOn = dg && typeof dg === 'object' ? Object.keys(RENTAN).filter((k) => dg[k] && dg[k] !== 'false').map((k) => RENTAN[k]) : [];
        if (dgOn.length) imgRows.push(['Rentan', dgOn.join(', ')]);
        const tr = Array.isArray(p.text_replacements) ? p.text_replacements.filter((x) => x && x.name) : [];
        if (tr.length) imgRows.push(['Expanders', `${tr.length}: ${tr.map((x) => x.name).join(', ')}`]);
        const ov = Array.isArray(p.text_overlays) ? p.text_overlays.filter((x) => x && !x.disabled) : [];
        if (ov.length) imgRows.push(['Overlays', String(ov.length)]);
        if (imgRows.length) {
            sections.push('<div class="wsb-card-sub">Other Settings</div>');
            sections.push(imgRows.map(([l, v]) => `<div class="wsb-crow"><span class="wsb-clabel">${esc(l)}:</span><span class="wsb-cvalue">${esc(v)}</span></div>`).join(''));
        }

        const box = page.querySelector('.wsb-details');
        box.querySelector('.wsb-card-name').textContent = nameOf(current);
        box.querySelector('.wsb-card-rows').innerHTML = rows.map(([l, v]) => `<div class="wsb-crow"><span class="wsb-clabel">${esc(l)}:</span><span class="wsb-cvalue">${esc(v)}</span></div>`).join('');
        box.querySelector('.wsb-card-sections').innerHTML = sections.join('');
    }

    // ---------------------------------------------------------------- edit form

    function resolutionChoices() {
        const out = [];
        try {
            /* global RESOLUTION_GROUPS */
            if (typeof RESOLUTION_GROUPS !== 'undefined' && Array.isArray(RESOLUTION_GROUPS)) {
                RESOLUTION_GROUPS.forEach((g) => {
                    const opts = (g.options || []).filter((o) => o && o.value && o.dims);
                    if (!opts.length) return;
                    if (out.length) out.push('-');
                    opts.forEach((o) => out.push({ value: String(o.value).toLowerCase(), label: `${g.group} ${String(o.name).replace('Widescreen', 'Wide')} ${o.dims}` }));
                });
            }
        } catch (_) { /* below */ }
        return out;
    }

    function resolutionLabel(v) {
        if (!v) return '(unchanged)';
        const hit = resolutionChoices().find((c) => c !== '-' && c.value === String(v).toLowerCase());
        if (hit) return hit.label;
        const s = sizeOf(v, current && current.p);
        return `${s.label}${s.dims ? ` (${s.dims})` : ''}`;
    }

    function workspaceChoices() {
        const out = [];
        try {
            if (typeof workspaces !== 'undefined' && workspaces) Object.keys(workspaces).forEach((id) => out.push({ value: id, label: workspaces[id].name || id }));
        } catch (_) { /* below */ }
        if (!out.some((c) => c.value === 'default')) out.unshift({ value: 'default', label: 'Default' });
        return out;
    }

    function paintEdit() {
        const f = page.querySelector('.wsb-edit');
        f.querySelector('.wsb-edit-ws .wsb-combo-text').textContent = workspaceName(draft.workspace);
        f.querySelector('.wsb-edit-res .wsb-combo-text').textContent = resolutionLabel(draft.resolution);
        f.querySelector('[name="upscale"]').checked = !!draft.upscale;
    }

    function openEdit(e) {
        if (!e || e.p.builtin) return;
        if (!current || current.key !== e.key) { current = e; renderDetails(); }
        const p = e.p;
        draft = { workspace: p.target_workspace || 'default', resolution: String(p.resolution || '').toLowerCase(), upscale: !!p.request_upscale };
        const f = page.querySelector('.wsb-edit');
        f.querySelector('.wsb-card-name').textContent = nameOf(e);
        f.querySelector('[name="name"]').value = nameOf(e);
        paintEdit();
        f.querySelector('.wsb-form-body').scrollTop = 0;
        layers = ['details', 'edit'];
        showLayer();
        sh.syncHistory();
    }

    function combo(btn, choices, value, onPick, align = 'left') {
        sh.dropdown(btn, choices.map((c) => (c === '-' ? '-' : { label: c.label, radio: c.value === value, action: () => onPick(c.value) })), align);
    }

    async function saveEdit() {
        if (!current || !draft) return;
        const f = page.querySelector('.wsb-edit');
        const old = current.key;
        const next = f.querySelector('[name="name"]').value.trim();
        draft.upscale = f.querySelector('[name="upscale"]').checked;
        if (!next) { await fail('Type a name for the preset.'); return; }
        if (entries.some((x) => x.key !== old && (x.key === next || nameOf(x) === next))) { await fail('A preset with that name already exists.'); return; }
        // the desktop's Update Preset form sends these four (update_preset reads only them)
        const body = { name: next, target_workspace: draft.workspace || 'default', request_upscale: !!draft.upscale };
        if (draft.resolution !== String(current.p.resolution || '').toLowerCase()) body.resolution = String(draft.resolution || '').toUpperCase();
        if (!connected()) { await fail('The server connection is down.'); return; }
        try {
            await sh.busy(async () => {
                const r = await wsc().updatePreset(old, body);
                if (r && r.success === false) throw new Error(r.message || r.error || 'The server refused.');
                await reloadAll();
            }, { paint: true });
        } catch (err) {
            await fail(`The preset could not be saved.\n\n${(err && err.message) || ''}`.trim());
            return;
        }
        selectedKey = entryByKey(next) ? next : ((entries.find((x) => nameOf(x) === next) || {}).key || old);
        current = entryByKey(selectedKey);
        draft = null;
        layers = current ? ['details'] : [];
        if (current) renderDetails();
        renderList();
        showLayer();
        sh.syncHistory();
    }

    // ---------------------------------------------------------------- actions

    function openInStudio(e) {
        if (!e) return;
        if (typeof window.openManualModalWithContent !== 'function') {
            fail('Studio is not available.');
            return;
        }
        // the desktop preset manager's own call; the phone's Studio app comes up with its wait cursor
        window.openManualModalWithContent({ type: 'preset', name: e.key, title: nameOf(e) });
    }

    async function openInSpellcaster(e) {
        if (!e) return;
        const sc = window.wmSpellcaster;
        if (!sc || typeof sc.openSpell !== 'function') { await fail('Spellcaster is not available.'); return; }
        // Spellcaster lists the client's preset list (optionsData.presets): a preset saved or renamed
        // since it was read comes in first
        const inList = () => (window.optionsData && Array.isArray(window.optionsData.presets) ? window.optionsData.presets : []).some((p) => p && p.name === e.key);
        if (!inList() && typeof refreshAppOptionsChunk === 'function') {
            try { await sh.busy(() => refreshAppOptionsChunk('presets'), { paint: true }); } catch (_) { /* Spellcaster says so */ }
        }
        sc.openSpell(e.key);
    }

    async function rename(e) {
        if (!e || e.p.builtin) return;
        const old = e.key;
        const name = await sh.messageBox({ title: 'Rename', text: 'Enter a new name for the preset:', input: { value: nameOf(e) }, buttons: [{ text: 'OK', value: true, default: true }, { text: 'Cancel', value: false }] });
        if (name == null || name === false) return;
        const next = String(name).trim();
        if (!next || next === old) return;
        if (entries.some((x) => x.key !== old && (x.key === next || nameOf(x) === next))) {
            await fail('A preset with that name already exists.');
            return;
        }
        try {
            await sh.busy(async () => {
                const r = await wsc().updatePreset(old, { name: next });
                if (r && r.success === false) throw new Error(r.message || r.error || 'The server refused.');
                await reloadAll();
            }, { paint: true });
        } catch (err) {
            await fail(`The preset could not be renamed.\n\n${(err && err.message) || ''}`.trim());
            return;
        }
        selectedKey = entryByKey(next) ? next : (entries.find((x) => nameOf(x) === next) || {}).key || null;
        if (layers.length) { current = entryByKey(selectedKey); if (current) renderDetails(); else layers = []; }
        renderList();
        showLayer();
        if (!layers.length) scrollToSelected();
    }

    async function remove(e) {
        if (!e || e.p.builtin) return;
        const yes = await sh.messageBox({ title: TITLE, icon: 'question', text: `Preset "${nameOf(e)}" will be deleted. Continue?`, buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }] });
        if (!yes) return;
        try {
            await sh.busy(async () => {
                const r = await wsc().deletePreset(e.key);
                if (!r || r.success === false) throw new Error((r && (r.message || r.error)) || 'The server refused.');
                await reloadAll();
            }, { paint: true });
        } catch (err) {
            await fail(`The preset could not be deleted.\n\n${(err && err.message) || ''}`.trim());
            return;
        }
        if (selectedKey === e.key) selectedKey = null;
        if (!current || current.key === e.key) { layers = []; current = null; draft = null; sh.syncHistory(); }
        renderList();
        showLayer();
    }

    function rowMenu(e, onPage) {
        const fixed = !e || !!e.p.builtin;
        return [
            onPage ? null : { label: 'Open', disabled: !e, action: () => openDetails(e) },
            { label: 'Open in Studio', disabled: !e, action: () => openInStudio(e) },
            { label: 'Open in Spellcaster', disabled: !e, action: () => openInSpellcaster(e) },
            '-',
            { label: 'Edit...', disabled: fixed, action: () => openEdit(e) },
            { label: 'Rename...', disabled: fixed, action: () => rename(e) },
            { label: 'Delete', disabled: fixed, action: () => remove(e) }
        ].filter(Boolean);
    }

    function listMenu() {
        return rowMenu(selectedEntry(), false).concat(['-', { label: 'Refresh', action: () => refresh() }]);
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
            timer = setTimeout(() => { held = true; fn(row, start.x, start.y); }, ((window.wmShell && window.wmShell.holdMs) || 550));
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

    const comboHtml = (cls) => `<button type="button" class="wsb-combo ${cls}"><span class="wsb-combo-text"></span><span class="wsb-combo-arrow" aria-hidden="true"></span></button>`;

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
                <div class="wsb-card-body">
                    <div class="wsb-buttons"><button type="button" class="wsb-button" data-cmd="studio">Open in Studio</button><button type="button" class="wsb-button" data-cmd="spellcaster">Open in Spellcaster</button></div>
                    <div class="wsb-card-rows"></div>
                    <div class="wsb-card-sections"></div>
                </div>
            </div>
            <form class="wsb-edit" hidden autocomplete="off">
                <div class="wsb-card-head"><img src="${ICON}" alt="" draggable="false"><span class="wsb-card-name"></span></div>
                <div class="wsb-form-body">
                    <label class="wsb-field"><span class="wsb-flabel">Name:</span><input class="wsb-input" name="name" type="text" maxlength="120" autocapitalize="off" spellcheck="false"></label>
                    <div class="wsb-field"><span class="wsb-flabel">Workspace:</span>${comboHtml('wsb-edit-ws')}</div>
                    <div class="wsb-field"><span class="wsb-flabel">Size:</span>${comboHtml('wsb-edit-res')}</div>
                    <label class="wsb-check"><input type="checkbox" name="upscale"><span>Upscale</span></label>
                </div>
            </form>`;
        const searchEl = p.querySelector('.wsb-search');
        searchEl.addEventListener('input', () => {
            search = searchEl.value.trim();
            group = null;
            renderList();
            const first = visible()[0];
            if (first) selectRow(first.key);
        });
        searchEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); const s = selectedEntry(); if (s) openDetails(s); }
        });
        p.querySelector('.wsb-tabs').addEventListener('click', (e) => {
            const t = e.target.closest('.wsb-tab');
            if (t) jumpTo(Number(t.dataset.at));
        });
        const scroll = p.querySelector('.wsb-scroll');
        onHold(scroll, '.wsb-row', (row, x, y) => {
            selectRow(row.dataset.key);
            sh.menuAt(x, y, rowMenu(entryByKey(row.dataset.key), false));
        });
        scroll.addEventListener('click', (e) => {
            const row = e.target.closest('.wsb-row');
            if (!row) return;
            selectRow(row.dataset.key);
            openDetails(entryByKey(row.dataset.key));
        });
        p.querySelector('.wsb-buttons').addEventListener('click', (e) => {
            const b = e.target.closest('[data-cmd]');
            if (!b || !current) return;
            if (b.dataset.cmd === 'studio') openInStudio(current);
            else openInSpellcaster(current);
        });
        const f = p.querySelector('.wsb-edit');
        f.addEventListener('submit', (e) => { e.preventDefault(); saveEdit(); });
        f.querySelector('.wsb-edit-ws').addEventListener('click', (e) => {
            if (draft) combo(e.currentTarget, workspaceChoices(), draft.workspace, (v) => { draft.workspace = v; paintEdit(); });
        });
        f.querySelector('.wsb-edit-res').addEventListener('click', (e) => {
            if (draft) combo(e.currentTarget, resolutionChoices(), draft.resolution, (v) => { draft.resolution = v; paintEdit(); }, 'right');
        });
    }

    function register() {
        sh = window.wmShell;
        if (!sh || typeof sh.registerApp !== 'function') return;
        // every desktop route to the preset manager window opens this app (Toolbox, Run, Spellcaster ...)
        window.showPresetManager = async function () { sh.open(APP_ID); };
        sh.registerApp({
            id: APP_ID,
            title: TITLE,
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
            onTitleOk() {
                if (view() === 'edit') { saveEdit(); return true; }
                return false;
            },
            onBack() {
                if (!layers.length) return false;
                if (layers.pop() === 'edit') draft = null;
                if (!layers.length) current = null;
                showLayer();
                return true;
            },
            softKeys() {
                if (view() === 'edit') return { left: { label: 'Cancel', action: () => sh.back() }, right: { label: 'Save', action: saveEdit } };
                if (view() === 'details') return { left: { label: 'Edit', disabled: !current || !!current.p.builtin, action: () => openEdit(current) }, right: { label: 'Menu', menu: () => rowMenu(current, true) } };
                return { left: { label: 'Open', disabled: !selectedEntry(), action: () => openDetails(selectedEntry()) }, right: { label: 'Menu', menu: listMenu } };
            }
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
