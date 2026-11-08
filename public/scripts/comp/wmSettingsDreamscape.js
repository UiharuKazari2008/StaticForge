/**
 * Melaton Mobile Settings: Dreamscape pages (Image Generation, Director, Dovecote, Search Indexing, Error Reporting) (Yozora #709).
 * Pages for the Settings app (wmPrograms.js), added through window.wmSettings.registerPage /
 * extendPage and drawn with window.wmSettings.ui so they look like WM 6.1's own pages. Every
 * value is read and saved through the desktop's own store (one source of truth):
 *
 *   Image Generation  Studio's Preferences menu: getImageGenerationSettings /
 *                     persistImageGenerationSettingsPatch, getEnhancePreset / persistEnhancePreset
 *                     (imageGenerationSettings.js; user global settings + localStorage enhancePreset)
 *   Director          Director Settings sheet: directorInstance.requestDirectorSettings,
 *                     director_settings_set, director_learned_* (director.js), engine catalogs
 *                     through loadSettingsCatalog / catalogFor
 *   Dovecote          Mail Options: window.dovecoteMailSettings (desktop-apps/dovecote.js)
 *   Search Indexing   Control Panel's Melaton Search (cplSearch.js): the tray indicator's
 *                     _indexJobs, actions fired as the tray's contextMenuAction events
 *   Error Reporting   Problem Reports and Solutions (cplPages2.js): its registry key's Consent
 *                     (melatonRegistry) and GET /api/fault-reports
 *
 * Styles: public/css/wm-settings-dreamscape.css. Runs only on Melaton Mobile (uiShell 'mobile').
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile') return;
    const wmSettings = window.wmSettings;
    if (!wmSettings || typeof wmSettings.registerPage !== 'function') return;
    const ui = wmSettings.ui;
    const esc = ui.esc;

    const fn = (name) => (typeof window[name] === 'function' ? window[name] : null);

    /** Redraw the page and keep its scroll position (combos low on a page change others). */
    function rerenderKeep(el, api) {
        const page = el.closest('.wm-set');
        const sc = el.closest('.wm-set-scroll');
        const top = sc ? sc.scrollTop : 0;
        api.rerender();
        const next = page && page.querySelector('.wm-set-scroll');
        if (next) next.scrollTop = top;
    }

    /** A labelled combo row: [[value, label]] options. */
    function comboRow(label, act, options, value, disabled, opts = {}) {
        const cur = options.find(([v]) => v === value);
        return ui.row(label, ui.comboHtml(act, cur ? cur[1] : (options[0] ? options[0][1] : ''), disabled || !options.length), opts);
    }

    const errorBox = (title, text) => ui.messageBox({ title, icon: 'error', text });
    const yesNo = (title, text, icon = 'question') => ui.messageBox({
        title, icon, text,
        buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }],
        cancelValue: false
    });

    // ================================================================ Image Generation
    // Studio > Settings menu (imageGenerationSettings.js getStudioPreferencesMenuItems).

    const IG_BG = [
        ['checker-dark', 'Dark checker', '#1c1c1c'],
        ['checker-light', 'Light checker', '#c8c8c8'],
        ['white', 'White', '#ffffff'],
        ['gray', 'Gray', '#808080'],
        ['black', 'Black', '#111111'],
        ['red', 'Red', '#c62828'],
        ['green', 'Green', '#2e7d32'],
        ['blue', 'Blue', '#1565c0'],
        ['custom', 'Custom color', null]
    ];
    const IG_MAGNITUDES = [1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5];
    const IG_SCALES = [['1', '1x'], ['1.5', '1.5x'], ['2', '2x']];
    const IG_KEYS = ['streamImageGeneration', 'showStreamedImagesUnprocessed', 'simpleOutputViewer', 'lockOutputViewerCamera',
        'reducedMotion', 'hideQuickstartGallery', 'persistHistory', 'imageFormat', 'automaticDownload', 'alphaMode',
        'transparencyBackground', 'transparencyCustomColor'];

    /** The preview box's class and inline colour for a background choice. */
    function igSwatch(bg, custom) {
        if (bg === 'checker-dark' || bg === 'checker-light') return `class="wm-ds-swatch is-${bg}"`;
        const row = IG_BG.find(([v]) => v === bg);
        const color = bg === 'custom' ? custom : row && row[2];
        return `class="wm-ds-swatch"${color && /^#[0-9a-f]{6}$/i.test(color) ? ` style="background:${color}"` : ''}`;
    }

    /** #abc / abc / #aabbcc -> #aabbcc, or null (desktop: normalizeImageGenerationCustomColorClient). */
    function igColor(raw) {
        let v = String(raw || '').trim();
        if (v && v[0] !== '#') v = `#${v}`;
        if (/^#[0-9a-fA-F]{6}$/.test(v)) return v.toLowerCase();
        if (/^#[0-9a-fA-F]{3}$/.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`.toLowerCase();
        return null;
    }

    wmSettings.registerPage({
        id: 'image-generation',
        tab: 'personal',
        label: 'Image Generation',
        icon: 'app-studio-lg',
        tabs: [['preview', 'Preview'], ['saving', 'Saving'], ['background', 'Background'], ['enhance', 'Enhance']],
        available: () => !!(fn('getImageGenerationSettings') && fn('persistImageGenerationSettingsPatch')),
        init() {
            const s = { ...window.getImageGenerationSettings() };
            const enh = fn('getEnhancePreset') ? window.getEnhancePreset() : null;
            return { s, saved: { ...s }, enh: enh ? { ...enh } : null, enhSaved: enh ? { ...enh } : null, colorText: s.transparencyCustomColor };
        },
        render(el, tab, d, api) {
            const s = d.s;
            const checks = (rows) => rows.map(([key, label]) => ui.check(`ig-${key}`, label, s[key] === true, `data-key="${key}"`)).join('');
            const wireChecks = () => el.querySelectorAll('input[data-key]').forEach((c) => c.addEventListener('change', () => { s[c.dataset.key] = c.checked; }));
            if (tab === 'saving') {
                el.innerHTML = `${comboRow('Format:', 'format', [['png', 'PNG'], ['webp', 'WebP']], s.imageFormat)}
                    ${comboRow('Alpha:', 'alpha', [['straight', 'Straight'], ['premultiplied', 'Premultiplied']], s.alphaMode)}
                    ${ui.gap()}
                    ${checks([['automaticDownload', 'Download each print automatically'], ['persistHistory', 'Keep image generation history']])}
                    ${ui.gap()}
                    ${ui.note('Format and Alpha apply to prints you download from Studio.')}`;
                ui.bindCombo(el.querySelector('[data-act="format"]'), [['png', 'PNG'], ['webp', 'WebP']], s.imageFormat, (v) => { s.imageFormat = v; });
                ui.bindCombo(el.querySelector('[data-act="alpha"]'), [['straight', 'Straight'], ['premultiplied', 'Premultiplied']], s.alphaMode, (v) => { s.alphaMode = v; });
                wireChecks();
                return;
            }
            if (tab === 'background') {
                const custom = s.transparencyBackground === 'custom';
                const opts = IG_BG.map(([v, l]) => [v, l]);
                el.innerHTML = `${ui.text('Background shown behind the transparent parts of a print:')}
                    ${comboRow('Background:', 'bg', opts, s.transparencyBackground, false, { wide: true })}
                    ${ui.row('Color:', ui.edit('wmDsIgColor', d.colorText, `maxlength="7" spellcheck="false"${custom ? '' : ' disabled'}`), { for: 'wmDsIgColor', wide: true })}
                    <div class="wm-form-sub">Preview:</div>
                    <div ${igSwatch(s.transparencyBackground, igColor(d.colorText) || s.transparencyCustomColor)} data-f="swatch"></div>
                    ${ui.note('Type a color as #RRGGBB.')}`;
                ui.bindCombo(el.querySelector('[data-act="bg"]'), opts, s.transparencyBackground, (v) => { s.transparencyBackground = v; rerenderKeep(el, api); });
                const edit = el.querySelector('#wmDsIgColor');
                edit.addEventListener('input', () => {
                    d.colorText = edit.value;
                    const c = igColor(edit.value);
                    const sw = el.querySelector('[data-f="swatch"]');
                    if (c && sw && s.transparencyBackground === 'custom') sw.style.background = c;
                });
                return;
            }
            if (tab === 'enhance') {
                if (!d.enh) {
                    el.innerHTML = ui.text('The Enhance preset is not available.');
                    return;
                }
                const scale = IG_SCALES.find(([v]) => v === d.enh.scale);
                el.innerHTML = `${ui.text('Enhance starts with these values.')}
                    <div class="wm-form-sub">Magnitude: <span data-f="mag">${esc(Number(d.enh.magnitude).toFixed(1))}</span></div>
                    <div data-f="track"></div>
                    ${ui.gap()}
                    ${ui.row('Upscale:', ui.comboHtml('scale', scale ? scale[1] : '1x'))}`;
                ui.trackbar(el.querySelector('[data-f="track"]'), {
                    steps: IG_MAGNITUDES, value: Number(d.enh.magnitude), lo: '1.0', hi: '5.5', label: 'Magnitude',
                    onChange: (v) => { d.enh.magnitude = v; el.querySelector('[data-f="mag"]').textContent = v.toFixed(1); }
                });
                ui.bindCombo(el.querySelector('[data-act="scale"]'), IG_SCALES, d.enh.scale, (v) => { d.enh.scale = v; });
                return;
            }
            el.innerHTML = `${checks([
                ['streamImageGeneration', 'Stream image generation'],
                ['showStreamedImagesUnprocessed', 'Show streamed images unprocessed'],
                ['simpleOutputViewer', 'Simple output viewer'],
                ['lockOutputViewerCamera', 'Lock output viewer camera'],
                ['reducedMotion', 'Reduced preview animation'],
                ['hideQuickstartGallery', 'Hide Quickstart Gallery']
            ])}`;
            wireChecks();
        },
        async commit(d) {
            const s = d.s;
            // the Color box only counts while Custom color is picked (it is disabled otherwise)
            if (s.transparencyBackground === 'custom') {
                const c = igColor(d.colorText);
                if (!c) {
                    await errorBox('Image Generation', 'Enter the custom color as # and six hexadecimal digits, for example #808080.');
                    return false;
                }
                s.transparencyCustomColor = c;
            }
            const patch = {};
            IG_KEYS.forEach((k) => { if (s[k] !== d.saved[k]) patch[k] = s[k]; });
            if (Object.keys(patch).length) {
                try {
                    await window.persistImageGenerationSettingsPatch(patch);
                } catch (err) {
                    await errorBox('Image Generation', (err && err.message) || 'The settings could not be saved.');
                    return false;
                }
            }
            if (d.enh && fn('persistEnhancePreset') && (d.enh.magnitude !== d.enhSaved.magnitude || d.enh.scale !== d.enhSaved.scale)) {
                window.persistEnhancePreset({ magnitude: d.enh.magnitude, scale: d.enh.scale });
            }
            return [];
        }
    });

    // ================================================================ Director
    // Director Settings (director.js openDirectorSettings): the same messages and payload.

    const dir = () => window.directorInstance || null;
    const DIR_ROWS = [
        { key: 'wren', tab: 'new', group: 'Yumiya', obliterated: false, blank: '(Last used)' },
        { key: 'kabuki', tab: 'new', group: 'Chiyo (Obliterated Memories)', obliterated: true, blank: '(Last used)' },
        { key: 'normal', tab: 'repair', group: 'Yumiya (normal memories)', obliterated: false, blank: '(Same as the chat)' },
        { key: 'obliterated', tab: 'repair', group: 'Chiyo (Obliterated Memories)', obliterated: true, blank: '(Same as the chat)' }
    ];
    const line = (text) => String(text || '').replace(/\s+/g, ' ').trim();

    function dirEngines(obliterated) {
        const d = dir();
        return ((d && d.directorSettingsEngines) || []).filter((item) => item && (item.memoryStore === 'obliterated') === obliterated);
    }

    function dirModelOptions(engine, model) {
        const d = dir();
        const catalog = engine && d ? d.catalogFor(engine) || [] : [];
        const out = [['', '(Engine default)']].concat(catalog.map((item) => [item.id, item.name || item.id]));
        if (model && !catalog.some((item) => item.id === model)) out.push([model, model]);
        return out;
    }

    function dirEffortOptions(engine, model, effort) {
        const d = dir();
        const catalog = engine && d ? d.catalogFor(engine) || [] : [];
        const family = catalog.find((item) => item.id === (model || d.defaultModel(engine)))
            || (!model ? catalog.find((item) => item.default) : null);
        let levels = family && Array.isArray(family.efforts) ? family.efforts : [];
        if (engine && !catalog.length) levels = (d.effortLevels || []).map((level) => ({ id: level.value, name: level.name }));
        const out = [['', '(Default)']].concat(levels.map((level) => [level.id, level.name || level.id]));
        if (effort && !levels.some((level) => level.id === effort)) out.push([effort, effort]);
        return out;
    }

    /** Fresh model list for an engine, then redraw while the page still shows that engine. */
    function dirRefreshCatalog(st, engine, el, api) {
        const d = dir();
        if (!engine || !d || st.catalogAsked.has(engine)) return;
        st.catalogAsked.add(engine);
        d.loadSettingsCatalog(engine).then(() => { if (st.redraw) st.redraw(); }).catch(() => {});
    }

    function dirPickerHtml(st, row) {
        const pick = st.picks[row.key];
        const engines = dirEngines(row.obliterated);
        const usable = engines.length > 0 && (!row.obliterated || st.kabuki);
        const engine = pick.engine;
        const models = dirModelOptions(engine, pick.model);
        const efforts = dirEffortOptions(engine, pick.model, pick.effort);
        const p = `dir-${row.key}`;
        return `<div class="wm-ds-group" data-row="${row.key}">
            ${ui.sub(row.group)}
            ${comboRow('Engine:', `${p}-engine`, [['', row.blank]].concat(engines.map((e) => [e.engine, e.name || dir().engineName(e.engine)])), engine, !usable)}
            ${comboRow('Model:', `${p}-model`, models, engine ? pick.model : '', !usable || !engine)}
            ${comboRow('Reasoning:', `${p}-effort`, efforts, pick.effort, !usable || !engine || efforts.length < 2)}
        </div>`;
    }

    function dirBindPicker(st, row, el, api) {
        const pick = st.picks[row.key];
        const p = `dir-${row.key}`;
        const engines = dirEngines(row.obliterated);
        ui.bindCombo(el.querySelector(`[data-act="${p}-engine"]`), [['', row.blank]].concat(engines.map((e) => [e.engine, e.name || dir().engineName(e.engine)])), pick.engine, (v) => {
            if (v === pick.engine) return;
            pick.engine = v;
            pick.model = '';
            pick.effort = '';
            dirRefreshCatalog(st, v, el, api);
            rerenderKeep(el, api);
        });
        ui.bindCombo(el.querySelector(`[data-act="${p}-model"]`), dirModelOptions(pick.engine, pick.model), pick.model, (v) => {
            pick.model = v;
            if (!dirEffortOptions(pick.engine, v, '').some(([id]) => id === pick.effort)) pick.effort = '';
            rerenderKeep(el, api);
        });
        ui.bindCombo(el.querySelector(`[data-act="${p}-effort"]`), dirEffortOptions(pick.engine, pick.model, pick.effort), pick.effort, (v) => { pick.effort = v; });
        dirRefreshCatalog(st, pick.engine, el, api);
    }

    const pickOf = (raw) => ({ engine: (raw && raw.engine) || '', model: (raw && raw.model) || '', effort: (raw && raw.effort) || '' });
    const pickOut = (p) => (p.engine ? { engine: p.engine, model: p.model || null, effort: p.effort || null } : null);
    const pickSig = (p) => JSON.stringify(pickOut(p));

    async function dirLoad(st) {
        const d = dir();
        if (!d) { st.error = 'The Director is not available.'; return; }
        try {
            await d.requestDirectorSettings();
        } catch (_) { /* reported below */ }
        const settings = d.directorSettings;
        if (!settings) {
            st.error = window.wsClient && window.wsClient.isConnected && window.wsClient.isConnected()
                ? 'Director Settings could not be read.'
                : 'Director Settings need a connection to the Dreamscape server.';
            return;
        }
        st.kabuki = (d.directorSettingsEngines || []).some((item) => item && item.memoryStore === 'obliterated');
        st.picks = {
            wren: pickOf(settings.defaults && settings.defaults.wren),
            kabuki: pickOf(settings.defaults && settings.defaults.kabuki),
            normal: pickOf(settings.repair && settings.repair.normal),
            obliterated: pickOf(settings.repair && settings.repair.obliterated)
        };
        const auto = settings.autoRepair || { enabled: true, threshold: 85 };
        st.auto = { enabled: auto.enabled !== false, threshold: String(auto.threshold || 85) };
        st.saved = { picks: Object.fromEntries(Object.entries(st.picks).map(([k, v]) => [k, pickSig(v)])), auto: { ...st.auto } };
        try {
            st.learned = await d.directorRequest('director_learned_list', {});
        } catch (_) {
            st.learned = { rules: [], proposals: [] };
        }
        st.ready = true;
    }

    function dirLearnedLists(st) {
        const rules = Array.isArray(st.learned && st.learned.rules) ? st.learned.rules : [];
        const pending = (Array.isArray(st.learned && st.learned.proposals) ? st.learned.proposals : []).filter((row) => row && row.status === 'pending');
        return { rules, pending };
    }

    async function dirLearnedAction(st, type, payload) {
        try {
            // WM's wait cursor while the Director saves it
            st.learned = await (window.wmShell && typeof window.wmShell.busy === 'function' ? window.wmShell.busy(() => dir().directorRequest(type, payload)) : dir().directorRequest(type, payload));
        } catch (err) {
            await errorBox('Director', (err && err.message) || 'Could not save that change.');
        }
        if (st.redraw) st.redraw();
    }

    /** Learned Rules > Edit...: the rule in a multi-line box (the desktop's Edit Learned Rule dialog). */
    function dirRenderRuleEdit(el, st, api) {
        const id = ui.uid('wmDsRule');
        el.innerHTML = `${ui.sub('Edit Learned Rule')}
            <label for="${id}">Rule:</label>
            <textarea id="${id}" class="wm-ds-textarea" spellcheck="true">${esc(st.editing.text)}</textarea>
            ${ui.buttons([['edit-save', 'Save'], ['edit-cancel', 'Cancel']])}`;
        const ta = el.querySelector('textarea');
        ta.addEventListener('input', () => { if (st.editing) st.editing.text = ta.value; });
        el.querySelector('[data-act="edit-cancel"]').addEventListener('click', () => { st.editing = null; rerenderKeep(el, api); });
        el.querySelector('[data-act="edit-save"]').addEventListener('click', async () => {
            const cur = st.editing;
            if (!cur) return;
            const text = String(cur.text || '').trim();
            if (!text) { await errorBox('Edit Learned Rule', 'A rule cannot be empty.'); return; }
            const rule = dirLearnedLists(st).rules.find((r) => r.id === cur.id);
            st.editing = null;
            if (rule && text !== rule.text) await dirLearnedAction(st, 'director_learned_rule_edit', { id: rule.id, text });
            else rerenderKeep(el, api);
        });
    }

    function dirRenderLearned(el, st, api) {
        if (st.editing) { dirRenderRuleEdit(el, st, api); return; }
        const { rules, pending } = dirLearnedLists(st);
        if (!rules.some((r) => r.id === st.ruleSel)) st.ruleSel = '';
        if (!pending.some((r) => r.id === st.propSel)) st.propSel = '';
        const rule = rules.find((r) => r.id === st.ruleSel);
        const prop = pending.find((r) => r.id === st.propSel);
        const d = dir();
        let detail = pending.length ? 'Select a proposal to see why Auto-Repair made it.' : 'No proposals are waiting.';
        if (prop) detail = [prop.why ? `Why: ${prop.why}` : '', prop.kind === 'guide' && prop.path ? `File: ${prop.path}` : ''].filter(Boolean).join('  ') || 'Auto-Repair gave no reason.';
        el.innerHTML = `${ui.text('Learned rules (Yumiya and Chiyo follow these):')}
            ${rules.length ? ui.listbox(rules.map((r) => ({ key: r.id, label: line(r.text), selected: r.id === st.ruleSel })), { maxHeight: 102 }).replace('class="wm-listbox"', 'class="wm-listbox wm-ds-list" data-f="rules"') : `<div class="wm-listbox wm-ds-list is-empty">${esc('No learned rules.')}</div>`}
            ${ui.buttons([['rule-edit', 'Edit...', !rule], ['rule-remove', 'Remove', !rule]])}
            ${ui.gap()}
            ${ui.text('Proposals from Auto-Repair waiting for you:')}
            ${pending.length ? ui.listbox(pending.map((r) => ({ key: r.id, label: `${d.repairProposalLabel(r)}: ${line(r.text)}`, selected: r.id === st.propSel })), { maxHeight: 85 }).replace('class="wm-listbox"', 'class="wm-listbox wm-ds-list" data-f="props"') : `<div class="wm-listbox wm-ds-list is-empty">${esc('None.')}</div>`}
            ${ui.note(detail)}
            ${ui.buttons([['prop-view', 'View...', !prop], ['prop-approve', 'Approve', !prop], ['prop-reject', 'Reject', !prop]])}`;
        ui.bindListbox(el.querySelector('[data-f="rules"]'), (key) => { st.ruleSel = key; rerenderKeep(el, api); });
        ui.bindListbox(el.querySelector('[data-f="props"]'), (key) => { st.propSel = key; rerenderKeep(el, api); });
        const on = (act, f) => { const b = el.querySelector(`[data-act="${act}"]`); if (b) b.addEventListener('click', f); };
        on('rule-edit', () => {
            if (!rule) return;
            st.editing = { id: rule.id, text: rule.text };
            rerenderKeep(el, api);
        });
        on('rule-remove', async () => {
            if (!rule) return;
            if (await yesNo('Director Settings', `Remove this learned rule?\n\n${rule.text}`, 'warning')) {
                await dirLearnedAction(st, 'director_learned_rule_remove', { id: rule.id });
            }
        });
        on('prop-view', () => {
            if (!prop) return;
            ui.messageBox({ title: d.repairProposalLabel(prop), icon: 'info', text: [prop.text, prop.why ? `Why: ${prop.why}` : ''].filter(Boolean).join('\n\n') });
        });
        const decide = (decision) => async () => {
            if (!prop) return;
            await dirLearnedAction(st, 'director_learned_decide', { id: prop.id, decision });
            if (decision === 'approve' && prop.kind === 'guide') {
                ui.messageBox({ title: 'Director', icon: 'info', text: 'Written to the prompt guide clone. Extract, commit, and push it from Prompt Guide.' });
            }
        };
        on('prop-approve', decide('approve'));
        on('prop-reject', decide('reject'));
    }

    wmSettings.registerPage({
        id: 'director',
        tab: 'personal',
        label: 'Director',
        icon: 'app-director-lg',
        tabs: [['new', 'New Sessions'], ['repair', 'Auto-Repair'], ['learned', 'Learned Rules']],
        available: () => !!(dir() && typeof dir().requestDirectorSettings === 'function' && typeof dir().directorRequest === 'function'),
        init() {
            const st = { ready: false, error: '', catalogAsked: new Set(), ruleSel: '', propSel: '' };
            st.loading = dirLoad(st).catch((err) => { st.error = (err && err.message) || 'Director Settings could not be read.'; })
                .then(() => { if (st.redraw) st.redraw(); });
            // the page waits under the shell's wait cursor (WM shows no "Reading..." text)
            const sh = window.wmShell;
            if (sh && typeof sh.busy === 'function') sh.busy(st.loading).catch(() => {});
            return st;
        },
        render(el, tab, st, api) {
            st.redraw = () => { if (el.isConnected) rerenderKeep(el, api); };
            if (!st.ready) {
                el.innerHTML = st.error ? ui.text(st.error) : '';
                return;
            }
            if (tab === 'learned') { dirRenderLearned(el, st, api); return; }
            const rows = DIR_ROWS.filter((r) => r.tab === tab);
            if (tab === 'repair') {
                const id = ui.uid('wmDsRepair');
                el.innerHTML = `${ui.check('auto', 'Repair a session on its own when its context is nearly full', st.auto.enabled)}
                    <div class="wm-form-row is-wide wm-ds-pct"><label for="${id}">Repair at context:</label><span>${ui.edit(id, st.auto.threshold, `inputmode="numeric" maxlength="3"${st.auto.enabled ? '' : ' disabled'}`)}<span>%</span></span></div>
                    ${ui.note('Auto-Repair reads the whole chat on the engine below, restates what you asked as one clear request, and continues in a new session.')}
                    ${rows.map((r) => dirPickerHtml(st, r)).join('')}`;
                const auto = el.querySelector('input[name="auto"]');
                const pct = el.querySelector(`#${id}`);
                auto.addEventListener('change', () => { st.auto.enabled = auto.checked; pct.disabled = !auto.checked; });
                pct.addEventListener('input', () => { st.auto.threshold = pct.value; });
            } else {
                el.innerHTML = `${ui.text('A new chat starts on these. Once it has started, a chat keeps its own engine and model.')}
                    ${rows.map((r) => dirPickerHtml(st, r)).join('')}
                    ${ui.note(st.kabuki
                        ? 'Chiyo chats use Obliterated Memories, so only engines with that store are listed for them.'
                        : 'No model provider uses Obliterated Memories. Turn it on for a custom model provider in Control Panel to use Chiyo.')}`;
            }
            rows.forEach((r) => dirBindPicker(st, r, el, api));
        },
        async commit(st) {
            if (!st.ready) return [];
            const changedPicks = Object.keys(st.picks).some((k) => pickSig(st.picks[k]) !== st.saved.picks[k]);
            const raw = String(st.auto.threshold).trim();
            let threshold = Math.round(Number(raw));
            if (st.auto.enabled && (!/^\d+$/.test(raw) || threshold < 30 || threshold > 100)) {
                await errorBox('Director', 'Enter a number from 30 to 100 for the context at which a session is repaired.');
                return false;
            }
            if (!Number.isFinite(threshold)) threshold = Math.round(Number(st.saved.auto.threshold)) || 85;
            threshold = Math.max(30, Math.min(100, threshold));
            const autoChanged = st.auto.enabled !== st.saved.auto.enabled || String(threshold) !== String(st.saved.auto.threshold);
            if (!changedPicks && !autoChanged) return [];
            const payload = {
                defaults: { wren: pickOut(st.picks.wren) },
                autoRepair: { enabled: !!st.auto.enabled, threshold },
                repair: { normal: pickOut(st.picks.normal) }
            };
            // without an obliterated engine the Chiyo rows are greyed out: leave what config holds (as the desktop does)
            if (st.kabuki) {
                payload.defaults.kabuki = pickOut(st.picks.kabuki);
                payload.repair.obliterated = pickOut(st.picks.obliterated);
            }
            try {
                const body = await dir().directorRequest('director_settings_set', { settings: payload });
                if (body && body.settings) dir().directorSettings = body.settings;
            } catch (err) {
                await errorBox('Director', (err && err.message) || 'Could not save Director Settings.');
                return false;
            }
            return [];
        }
    });

    // ================================================================ Dovecote
    // Mail Options (mailOptions.js): window.dovecoteMailSettings.

    const mail = () => window.dovecoteMailSettings || null;

    wmSettings.registerPage({
        id: 'dovecote',
        tab: 'connections',
        label: 'Dovecote',
        icon: 'app-messaging-lg',
        tabs: [['general', 'General'], ['signatures', 'Signatures']],
        available: () => !!(mail() && typeof mail().soundOn === 'function' && typeof mail().saveSignature === 'function'),
        init() {
            const api = mail();
            const sig = api.signature();
            const s = {
                sound: api.soundOn(),
                notify: api.notifyOn(),
                signature: sig.signature || '',
                signatureOutgoing: sig.signatureOutgoing !== false,
                signatureSkipReplies: sig.signatureSkipReplies === true
            };
            return { s, saved: { ...s } };
        },
        render(el, tab, d) {
            const s = d.s;
            if (tab === 'signatures') {
                const id = ui.uid('wmDsSig');
                el.innerHTML = `${ui.check('signatureOutgoing', 'Add signatures to all outgoing messages', s.signatureOutgoing)}
                    ${ui.check('signatureSkipReplies', 'Don\'t add signatures to replies and forwards', s.signatureSkipReplies)}
                    <div class="wm-form-sub"><label for="${id}">Signature:</label></div>
                    <textarea id="${id}" class="wm-ds-textarea" spellcheck="true" maxlength="${Number(mail().SIGNATURE_MAX) || 4000}">${esc(s.signature)}</textarea>`;
                el.querySelectorAll('.wm-check input').forEach((c) => c.addEventListener('change', () => { s[c.name] = c.checked; }));
                const ta = el.querySelector('textarea');
                ta.addEventListener('input', () => { s.signature = ta.value; });
                return;
            }
            el.innerHTML = `${ui.text('When new messages arrive:')}
                ${ui.check('sound', 'Play a sound', s.sound)}
                ${ui.check('notify', 'Show a notification', s.notify)}
                ${ui.gap()}
                ${ui.note('These apply to this device only.')}`;
            el.querySelectorAll('.wm-check input').forEach((c) => c.addEventListener('change', () => { s[c.name] = c.checked; }));
        },
        async commit(d) {
            const api = mail();
            const s = d.s;
            const p = d.saved;
            const max = Number(api.SIGNATURE_MAX) || 4000;
            if (s.signature.length > max) {
                await errorBox('Dovecote', `A signature can have up to ${max} characters.`);
                return false;
            }
            if (s.sound !== p.sound) api.setSound(s.sound);
            if (s.notify !== p.notify) api.setNotify(s.notify);
            if (s.signature !== p.signature || s.signatureOutgoing !== p.signatureOutgoing || s.signatureSkipReplies !== p.signatureSkipReplies) {
                // saved on this device at once; the server copy follows (dovecote.js)
                Promise.resolve(api.saveSignature({
                    signature: s.signature,
                    signatureOutgoing: s.signatureOutgoing,
                    signatureSkipReplies: s.signatureSkipReplies
                })).catch(() => {});
            }
            return [];
        }
    });

    // ================================================================ Search Indexing
    // Control Panel > Melaton Search (cplSearch.js): read the tray indicator, fire its actions.

    const IDX_ACTIVE = ['starting', 'indexing', 'cache_init'];

    function idxState() {
        const shared = window.cplSearch && window.cplSearch._test && window.cplSearch._test.readState;
        if (typeof shared === 'function') {
            try { return shared(); } catch (_) { /* read it here */ }
        }
        // the same reading as cplSearch.js readState (it loads with Control Panel only)
        const indicator = document.getElementById('searchIndexingIndicator');
        const jobs = (indicator && indicator._indexJobs) || {};
        const client = window.wsClient || {};
        const sync = jobs.search_sync || {};
        const fts = jobs.prompt_fts || client._lastPromptFtsIndexingStatus || {};
        const stats = fts.stats || {};
        const syncActive = IDX_ACTIVE.includes(sync.status);
        const ftsActive = IDX_ACTIVE.includes(fts.status) || fts.running === true;
        const paused = sync.status === 'paused' || fts.status === 'paused' || fts.paused === true;
        let lineText = 'Indexing complete.';
        if (syncActive || ftsActive) lineText = 'Indexing in progress. Search results might not be complete during this time.';
        else if (paused) lineText = 'Indexing is paused.';
        else if (sync.status === 'error' || fts.status === 'error') lineText = 'Indexing stopped because of an error.';
        else if ((stats.ftsPending || 0) > 0) lineText = `${stats.ftsPending} items are waiting to be indexed.`;
        const pct = Number.isFinite(Number(sync.percentage)) ? Number(sync.percentage) : null;
        return { sync, fts, stats, syncActive, ftsActive, paused, line: lineText, progress: syncActive && pct !== null ? pct : null, indexed: stats.ftsDone || 0, total: stats.totalImages || 0 };
    }

    function idxSyncStatus(s) {
        if (s.syncActive) return s.progress !== null ? `Indexing (${Math.round(s.progress)}%)` : 'Indexing';
        if (s.sync.status === 'paused') return 'Paused';
        if (s.sync.status === 'error') return 'Error';
        if (s.sync.status === 'cache_ready') return 'Up to date, cache ready';
        return s.sync.status ? 'Up to date' : 'Not checked yet';
    }

    function idxFtsStatus(s) {
        if (s.ftsActive) return 'Indexing';
        if (s.fts.paused || s.fts.status === 'paused') return 'Paused';
        if (s.fts.status === 'error') return 'Error';
        if ((s.stats.ftsPending || 0) > 0) return `${s.stats.ftsPending} waiting`;
        return s.fts.status ? 'Up to date' : 'Not checked yet';
    }

    /** The tray's own actions (mainMenuManager.js contextMenuAction switch), as cplSearch.js fires them. */
    function idxRun(action) {
        const indicator = document.getElementById('searchIndexingIndicator');
        document.dispatchEvent(new CustomEvent('contextMenuAction', { detail: { action, target: indicator, item: { action } } }));
    }

    let idxDraw = null; // the open page's redraw (search_indexing_status push)
    let idxListening = false;

    function idxListen() {
        if (idxListening || !window.wsClient || typeof window.wsClient.on !== 'function') return;
        idxListening = true;
        window.wsClient.on('search_indexing_status', () => { if (idxDraw) idxDraw(); });
    }

    wmSettings.registerPage({
        id: 'search-indexing',
        tab: 'system',
        label: 'Search Indexing',
        icon: 'set-search-indexing',
        tabs: [['status', 'Status']],
        available: () => !!document.getElementById('searchIndexingIndicator'),
        init: () => ({}),
        render(el, tab, d) {
            const draw = () => {
                // gone, or Settings hidden (hide() leaves the page DOM; show() draws the grid anew)
                if (!el.isConnected || el.closest('[hidden]')) { if (idxDraw === draw) idxDraw = null; clearInterval(d.timer); return; }
                const s = idxState();
                const busy = s.syncActive || s.ftsActive;
                let bar = '';
                if (busy) {
                    bar = s.progress !== null
                        ? `<div class="wm-ds-progress" role="progressbar" aria-valuenow="${Math.round(s.progress)}"><span style="--wm-ds-blocks:${Math.round(s.progress / 100 * 18)}"></span></div>`
                        : '<div class="wm-ds-progress is-marquee" role="progressbar" aria-label="Indexing"><span></span></div>';
                }
                el.innerHTML = `<p class="wm-ds-idx-count"><b>${esc(s.indexed.toLocaleString())} items indexed${s.total ? ` of ${esc(s.total.toLocaleString())}` : ''}</b></p>
                    ${ui.text(s.line)}
                    ${bar}
                    ${s.sync.message && (s.syncActive || s.sync.status === 'error') ? ui.note(s.sync.message) : ''}
                    ${ui.sub('Indexes')}
                    ${ui.value('Search tags:', `${idxSyncStatus(s)}${s.sync.total ? `, ${Number(s.sync.total).toLocaleString()} items` : ''}`, { wide: true })}
                    ${ui.value('Prompt text:', `${idxFtsStatus(s)}${s.total ? `, ${s.indexed.toLocaleString()} of ${s.total.toLocaleString()}` : ''}`, { wide: true })}
                    ${ui.buttons([['search-index-trigger', 'Start'], ['search-index-toggle-pause', s.sync.status === 'paused' ? 'Resume' : 'Pause']])}
                    ${ui.gap()}
                    ${ui.note('Rebuilding the index and the search cache are in Control Panel > Melaton Search on the desktop.')}`;
                el.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
                    idxRun(b.dataset.act);
                    setTimeout(() => { if (idxDraw === draw) draw(); }, 1200);
                }));
            };
            idxDraw = draw;
            idxListen();
            clearInterval(d.timer);
            d.timer = setInterval(draw, 2000);
            draw();
        }
    });

    // ================================================================ Error Reporting
    // Problem Reports and Solutions (cplPages2.js): Consent in its registry key, the server's reports.

    const WER = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Error Reporting';
    const reg = () => window.melatonRegistry || null;

    function faultDate(iso, long) {
        if (!iso) return '';
        const t = new Date(iso);
        if (Number.isNaN(t.getTime())) return '';
        return long ? t.toLocaleString() : t.toLocaleDateString();
    }

    wmSettings.registerPage({
        id: 'error-reporting',
        tab: 'system',
        label: 'Error Reporting',
        icon: 'set-error-reporting',
        tabs: [['settings', 'Settings'], ['history', 'History']],
        available: () => !!(reg() && typeof reg().get === 'function'),
        init() {
            const consent = reg().get(WER, 'Consent', 'auto') === 'ask' ? 'ask' : 'auto';
            const d = { consent, saved: consent, faults: null, sel: '' };
            fetch('/api/fault-reports?limit=100', { credentials: 'same-origin', cache: 'no-store' })
                .then((r) => r.json())
                .then((j) => { d.faults = (j && j.reports) || []; })
                .catch(() => { d.faults = []; d.failed = true; })
                .then(() => { if (d.redraw) d.redraw(); });
            return d;
        },
        render(el, tab, d, api) {
            d.redraw = () => { if (el.isConnected && d.tab === 'history') rerenderKeep(el, api); };
            d.tab = tab;
            if (tab === 'history') {
                if (d.faults === null) { el.innerHTML = ui.text('Reading problem reports...'); return; }
                const rows = d.faults.map((f) => ({ key: f.id, label: `${f.program || 'Melaton Desktop'}: ${line(f.message || 'Stopped working')}`, selected: f.id === d.sel }));
                el.innerHTML = `${ui.text('Problems reported to the Dreamscape server. Tap one for details.')}
                    ${rows.length ? ui.listbox(rows, { maxHeight: 260 }).replace('class="wm-listbox"', 'class="wm-listbox wm-ds-list"') : `<div class="wm-listbox wm-ds-list is-empty">${esc(d.failed ? 'The problem history could not be read.' : 'No problems found.')}</div>`}`;
                ui.bindListbox(el.querySelector('.wm-listbox'), (key) => {
                    d.sel = key;
                    const f = d.faults.find((x) => x.id === key);
                    if (!f) return;
                    ui.messageBox({
                        title: 'Error Reporting',
                        icon: 'info',
                        text: [
                            `Program: ${f.program || 'Melaton Desktop'}`,
                            `Problem: ${f.message || 'Stopped working'}`,
                            f.lastSeen ? `Last seen: ${faultDate(f.lastSeen, true)}` : '',
                            f.firstSeen ? `First seen: ${faultDate(f.firstSeen, true)}` : '',
                            f.count ? `Reports: ${f.count}${f.repeats ? ` (${f.repeats} repeats)` : ''}` : '',
                            `Status: ${f.status === 'closed' ? 'Report sent' : 'Solution not found'}`
                        ].filter(Boolean).join('\n')
                    });
                });
                return;
            }
            el.innerHTML = `${ui.text('When a problem occurs, Melaton can check for solutions automatically or ask you each time.')}
                ${ui.radio('wer', 'auto', 'Check for solutions automatically (recommended)', d.consent === 'auto')}
                ${ui.radio('wer', 'ask', 'Ask me to check if a problem occurs', d.consent === 'ask')}`;
            el.querySelectorAll('input[name="wer"]').forEach((r) => r.addEventListener('change', () => { if (r.checked) d.consent = r.value; }));
        },
        async commit(d) {
            if (d.consent === d.saved) return [];
            try {
                await reg().set(WER, { Consent: d.consent });
            } catch (err) {
                await errorBox('Error Reporting', (err && err.message) || 'The setting could not be saved.');
                return false;
            }
            return [];
        }
    });
})();
