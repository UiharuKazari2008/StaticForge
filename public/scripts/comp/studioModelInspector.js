/**
 * studioModel part - Inspector (#860 migration): the Studio calls DreamStudio's Inspector part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 *
 *   studioModel.inspector()               what the desktop Inspector (#textReplacementLockModal) lists:
 *                                         { seeds[], tendai[], rentan, hasData, hasTendai }
 *   studioModel.gensoLockAt(i, on)        one Genso seed's lock, by its place in inspector().seeds
 *   studioModel.gensoOptions(i)           what that seed's expander can resolve to (a promise; cached)
 *   studioModel.gensoResolve(i, option)   the seed set to one of those options (and locked)
 *   studioModel.gensoReroll(i)            the seed set to a random option (and locked): Randomize Value
 *   studioModel.gensoApply(i)             the seed's value written over its !pattern in its prompt field
 *   studioModel.gensoCopy(i) / tendaiCopy(i)
 *                                         the value to the clipboard (call it straight from the tap)
 *   studioModel.inspectorLockAll(on)      Lock All (also freezes Rentan's cache and context, as the
 *                                         desktop's Lock All does) / Unlock All
 *   studioModel.tendaiLock(i, on) / tendaiApply(i) / tendaiDelete(i) / tendaiEmphasis(i, value)
 *                                         a Rentan (Tendai) modification by its place in inspector().tendai
 *   studioModel.compileTendai()           Compile Tendai: every modification into the fields, Rentan off
 *   studioModel.scanExpanders()           Refresh: scan the prompts for expanders (a promise)
 *   studioModel.hasManagedStages() / deleteManagedStages()
 *                                         the Inspector button menu's Delete Managed
 *   studioModel.compiledPrompts()         the last compile's prompts: { prompt, uc, characters[{ prompt, uc }] }
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    /* global getInspectorAppliedTextReplacementSeeds, syncInspectorTextReplacementsToLoadedMetadata,
       refreshTextReplacementLockModalIfOpen, inspectorEditorHasLoadedData, buildRentanExpanderRowParts,
       findDynamicReplacementByIndex, applyDynamicReplacementFromLockModal, compileAllTendaiReplacements,
       refreshInspectorTextReplacementsFromPrompts, updateMainLockButtonState, applyStudioGensoLocks,
       dynamicGenerationHasCompileCache, setDynamicGenerationLockState, getDynamicGenerationLockState,
       copyTextReplacementOptionToSeed, getTextareaForReplacementSource, setTextareaValuePreservingUndo,
       copyTextToClipboard, getReplacementBias, applyBiasToText, hasEmphasisGroupForDisplay,
       validateDynamicReplacementCanApply, hasReplacementStageConfiguration, getStagesDisplayText,
       hasManagedBracketArtifacts, deleteAllManagedBracketArtifacts, crossoverLabel, crossoverConditionName */

    const changed = (id) => M._emit('change', { id: id || 'genso' });
    const label = (s) => String(s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    function rawSeeds() {
        try { return typeof getInspectorAppliedTextReplacementSeeds === 'function' ? getInspectorAppliedTextReplacementSeeds() : []; } catch (_) { return []; }
    }

    /** Where a seed's expander sits ('character_1_uc' -> Character 2, UC), as the desktop's badges say it. */
    function seedWhere(source) {
        const s = String(source || '');
        const uc = s === 'negative_prompt' || s === 'input_prompt_negative' || s === 'uc' || s === 'manualUc'
            || (s.startsWith('character_') && (s.endsWith('_uc') || s.endsWith('_input_prompt_negative')));
        const m = /^character_(\d+)/.exec(s);
        return { char: m ? Number(m[1]) : null, uc };
    }

    /** The pattern the prompt holds (the desktop's originalPattern) */
    function seedPattern(seed) {
        if (seed.pattern) return String(seed.pattern);
        const t = seed.type;
        return `!${seed.key}${t === 'combine_incrementing' ? '~+#' : t === 'pick_incrementing' ? '~#' : t === 'combine' ? '~+' : '~'}`;
    }

    function rentanOf() { return (window.dynamicGenerationData && window.dynamicGenerationData.compiled_prompt) || null; }

    /** Every Tendai modification in the desktop's order (findDynamicReplacementByIndex counts the same way). */
    function tendaiList() {
        const tr = rentanOf() && rentanOf().text_replacements;
        if (!tr) return [];
        const out = [];
        const add = (arr, targetType, targetSource, targetField) => (arr || []).forEach((rep) => { if (rep) out.push({ rep, targetType, targetSource, targetField }); });
        add(tr.prompt, 'prompt', 'base');
        add(tr.uc, 'uc', 'base');
        (tr.character_prompts || []).forEach((c, ci) => { if (c) { add(c.prompt, 'character', ci, 'prompt'); add(c.uc, 'character', ci, 'uc'); } });
        return out;
    }

    /** The text a Tendai row shows for its replacement, the weight written in as the desktop shows it. */
    function biased(text, bias) {
        if (bias == null || !text) return text;
        try {
            if (typeof hasEmphasisGroupForDisplay === 'function' && hasEmphasisGroupForDisplay(text)) return text;
            return typeof applyBiasToText === 'function' ? applyBiasToText(text, bias) : text;
        } catch (_) { return text; }
    }

    function tendaiRow(x, gi) {
        const r = x.rep;
        const action = String(r.action || 'replace').toLowerCase();
        const meta = Object.assign({}, r, { targetType: x.targetType, targetSource: x.targetSource, targetField: x.targetField });
        let canApply = true;
        try { if (typeof validateDynamicReplacementCanApply === 'function') canApply = !!validateDynamicReplacementCanApply(meta); } catch (_) { canApply = true; }
        let status = 'ok';
        if (r.applied === false || r.error) status = 'failed';
        else if (r.used_fallback || r.application_method === 'fallback') status = 'fallback';
        else if (r.used_alternative || r.application_method === 'alternative') status = 'alternative';
        let bias = null;
        try { bias = typeof getReplacementBias === 'function' ? getReplacementBias(r) : null; } catch (_) { bias = null; }
        const mit = Array.isArray(r.mitigations) ? r.mitigations : [];
        return {
            i: gi,
            action,
            uc: x.targetType === 'uc' || (x.targetType === 'character' && x.targetField === 'uc'),
            char: x.targetType === 'character' ? Number(x.targetSource) : null,
            find: r.select_text ? String(r.select_text) : '',
            // a delete shows what goes, with its weight when the row carries one
            text: action === 'delete'
                ? (r.select_text ? biased(String(r.select_text), r.segment_emphasis != null ? r.segment_emphasis : null) : '')
                : (r.replace_text ? biased(String(r.replace_text), bias) : ''),
            count: r.count || 0,
            anchor: (r.anchor_details && r.anchor_details.preview) || r.anchor_text || '',
            reason: r.reason ? String(r.reason) : '',
            category: r.replacement_category ? String(r.replacement_category) : '',
            status,
            error: r.error ? String(r.error) : '',
            converted: mit.some((m) => m && m.type === 'converted_to_append'),
            mitigations: mit.map((m) => ({ type: String(m.type || ''), text: m.description ? String(m.description) : '' })),
            emphasis: r.segment_emphasis != null && Number.isFinite(Number(r.segment_emphasis)) ? Number(r.segment_emphasis) : null,
            locked: r.locked === true,
            canApply,
            value: String(r.value || r.replace_text || r.select_text || '')
        };
    }

    /** The scene a Rentan compile was made for (compiled_prompt.context), as label / value pairs. */
    function sceneRows(cp) {
        const c = cp && cp.context;
        if (!c) return [];
        const rows = [];
        const tp = c.timePeriod || {};
        const lab = typeof crossoverLabel === 'function' ? crossoverLabel : label;
        if (tp.period) rows.push(['Time period', lab(tp.period)]);
        const season = c.season && typeof c.season === 'object' ? c.season.name : c.season;
        if (season) rows.push(['Season', lab(season)]);
        const hol = c.season && c.season.holiday && c.season.holiday.primaryHoliday;
        if (hol) rows.push(['Holiday', String(hol.name || 'Holiday')]);
        const w = c.weather || {};
        if (w.condition || w.temperature !== undefined) {
            // the same unit choice as the desktop's weather card (weather_units_metric)
            let metric = true;
            try { metric = localStorage.getItem('weather_units_metric') !== 'false'; } catch (_) { metric = true; }
            const t = w.temperature !== undefined ? (metric ? `${w.temperature}\u00b0C` : `${Math.round((w.temperature * 9) / 5 + 32)}\u00b0F`) : '';
            const name = typeof crossoverConditionName === 'function' ? crossoverConditionName(w.condition) : lab(w.condition);
            rows.push(['Weather', [w.condition ? name : '', t].filter(Boolean).join(', ')]);
        }
        const loc = c.location || {};
        const where = loc.city && loc.country ? `${loc.city}, ${loc.country}` : loc.city || loc.country || '';
        if (where) rows.push(['Location', String(where)]);
        return rows;
    }

    function inspector() {
        const cp = rentanOf();
        const seeds = rawSeeds().map((s, i) => {
            const w = seedWhere(s.source);
            let parts = null;
            try { parts = typeof buildRentanExpanderRowParts === 'function' && cp ? buildRentanExpanderRowParts(s.key, cp) : null; } catch (_) { parts = null; }
            let rentan = null;
            if (parts) {
                const entry = (cp.dg_expanders || []).find((r) => String(r.prefix).toLowerCase() === String(s.key || '').toLowerCase()) || {};
                const purpose = String(s.key || '').toLowerCase().replace(/^dg_/, '');
                const cats = [[/time|tod/, 'Time of Day'], [/weather/, 'Weather'], [/season/, 'Seasonal'], [/holiday/, 'Holiday'], [/light/, 'Lighting'], [/scene|atmosphere|setting/, 'Atmosphere'], [/action|pose/, 'Action']];
                const hit = cats.find(([re]) => re.test(purpose));
                rentan = { category: hit ? hit[1] : label(purpose), reason: entry.reason ? String(entry.reason) : '', expiresAt: Number(cp.expiresAt) || 0 };
            }
            let stages = '';
            try { if (typeof hasReplacementStageConfiguration === 'function' && hasReplacementStageConfiguration(s.body_replacement_stages)) stages = String(getStagesDisplayText(s.body_replacement_stages) || ''); } catch (_) { stages = ''; }
            const canLock = s.can_lock !== false;
            return {
                i,
                key: String(s.key || ''),
                value: String(s.value == null ? '' : s.value),
                index: s.index != null ? s.index : null,
                pattern: seedPattern(s),
                isStatic: s.type === 'regular',
                type: String(s.type || ''),
                char: w.char,
                uc: w.uc,
                locked: s.locked === true,
                canLock,
                canResolve: s.can_resolve !== undefined ? s.can_resolve !== false : canLock,
                stages,
                rentan
            };
        });
        const tendai = tendaiList().map(tendaiRow);
        let rentan = null;
        if (cp && (tendai.length || (cp.dg_expanders && cp.dg_expanders.length))) {
            const exp = Number(cp.expiresAt) || 0;
            let locks = { cacheLocked: false, contextLocked: false };
            try { if (typeof getDynamicGenerationLockState === 'function') locks = getDynamicGenerationLockState(); } catch (_) { /* keep */ }
            rentan = { title: tendai.length ? 'Tendai Replacements' : 'Rentan Scene', expiresAt: exp, expired: !!exp && Date.now() >= exp, scene: sceneRows(cp), cacheLocked: !!locks.cacheLocked, contextLocked: !!locks.contextLocked };
        }
        let hasData = false;
        try { hasData = typeof inspectorEditorHasLoadedData === 'function' && inspectorEditorHasLoadedData(); } catch (_) { hasData = false; }
        return { seeds, tendai, rentan, hasData, hasTendai: tendai.length > 0 };
    }

    /** The seeds with one changed (a new array of new objects, so the preview's metadata follows: the desktop's sync). */
    function putSeeds(next) {
        if (typeof syncInspectorTextReplacementsToLoadedMetadata !== 'function') return false;
        syncInspectorTextReplacementsToLoadedMetadata(next);
        if (typeof refreshTextReplacementLockModalIfOpen === 'function') refreshTextReplacementLockModalIfOpen();
        changed('genso');
        return true;
    }

    function gensoLockAt(i, on) {
        const seeds = rawSeeds();
        if (!seeds[i] || seeds[i].can_lock === false) return false;
        return putSeeds(seeds.map((s, k) => (k === i ? Object.assign({}, s, { locked: !!on }) : Object.assign({}, s))));
    }

    const optCache = new Map();
    function optKey(s) { return [s.key, s.pattern || '', s.presetName || '', window.currentModel || '', window.currentPeriodKey || ''].join('|'); }

    /** [{ value, key, index }] the seed's expander offers (get_text_replacement_options, as Resolve to... asks). */
    function gensoOptions(i) {
        const s = rawSeeds()[i];
        if (!s || !window.wsClient) return Promise.resolve([]);
        const k = optKey(s);
        if (optCache.has(k)) return optCache.get(k);
        const p = window.wsClient.sendMessage('get_text_replacement_options', {
            pattern: s.pattern || `!${s.key}`,
            presetName: s.presetName,
            model: window.currentModel,
            periodKey: window.currentPeriodKey
        }).then((r) => (r && r.success && Array.isArray(r.options) ? r.options : [])).catch(() => { optCache.delete(k); return []; });
        optCache.set(k, p);
        return p;
    }

    function gensoResolve(i, option) {
        const seeds = rawSeeds();
        if (!seeds[i] || !option) return false;
        const next = seeds.map((s) => Object.assign({}, s));
        if (typeof copyTextReplacementOptionToSeed === 'function') copyTextReplacementOptionToSeed(next[i], option);
        else Object.assign(next[i], { value: option.value, key: option.key, index: option.index });
        next[i].locked = true;
        next[i].can_lock = true;
        return putSeeds(next);
    }

    /** Randomize Value (selectRandomTextReplacement): a random option, locked. Resolves true when one was set. */
    function gensoReroll(i) {
        return gensoOptions(i).then((opts) => {
            if (!opts.length) return false;
            return gensoResolve(i, opts[Math.floor(Math.random() * opts.length)]);
        });
    }

    /** Apply to Prompt (replacePlaceholderInPrompt): { ok } or { error } in the desktop's words. */
    function gensoApply(i) {
        const seeds = rawSeeds();
        const seed = seeds[i];
        if (!seed) return { error: 'Invalid replacement pattern' };
        const ta = typeof getTextareaForReplacementSource === 'function' ? getTextareaForReplacementSource(seed.source) : null;
        if (!ta) return { error: 'Could not find target prompt area for replacement' };
        const pat = seed.pattern || (seed.key ? `!${seed.key}` : '');
        if (!pat) return { error: 'Invalid replacement pattern' };
        const cur = ta.value || '';
        if (!cur.includes(pat)) return { error: `Pattern "${pat}" not found in target prompt` };
        const next = cur.split(pat).join(seed.value == null ? '' : String(seed.value));
        if (typeof setTextareaValuePreservingUndo === 'function') setTextareaValuePreservingUndo(ta, next);
        else ta.value = next;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
        // the applied seed leaves the list (removeTextReplacement)
        putSeeds(seeds.filter((_, k) => k !== i).map((s) => Object.assign({}, s)));
        changed('prompt');
        return { ok: true };
    }

    function copy(text) {
        if (!text || typeof copyTextToClipboard !== 'function') return Promise.resolve(false);
        return Promise.resolve(copyTextToClipboard(text)).then(() => true, () => false);
    }

    /** Lock All as the desktop menu's (mainMenuManager lockAllReplacements): the lockable seeds, and
     * Rentan's cache and context frozen when a compile is cached. Unlock All leaves the freeze alone. */
    function inspectorLockAll(on) {
        let n = 0;
        if (typeof applyStudioGensoLocks === 'function') n = applyStudioGensoLocks(!!on);
        if (on && typeof dynamicGenerationHasCompileCache === 'function' && dynamicGenerationHasCompileCache() && typeof setDynamicGenerationLockState === 'function') {
            setDynamicGenerationLockState({ cacheLocked: true, contextLocked: true });
        }
        changed('genso');
        return n;
    }

    function tendaiFind(i) { try { return typeof findDynamicReplacementByIndex === 'function' ? findDynamicReplacementByIndex(i) : null; } catch (_) { return null; } }

    function tendaiAfter() {
        if (typeof updateMainLockButtonState === 'function') updateMainLockButtonState();
        if (typeof refreshTextReplacementLockModalIfOpen === 'function') refreshTextReplacementLockModalIfOpen();
        changed('tendai');
    }

    /** toggleDynamicReplacementLockInModal, set rather than flipped; the locked list follows. */
    function tendaiLock(i, on) {
        const f = tendaiFind(i);
        if (!f) return false;
        f.replacement.locked = !!on;
        window.lockedDynamicReplacements = tendaiList().map((x) => x.rep).filter((r) => r.locked === true);
        tendaiAfter();
        return true;
    }

    function tendaiApply(i) {
        if (typeof applyDynamicReplacementFromLockModal !== 'function') return Promise.resolve(false);
        return Promise.resolve(applyDynamicReplacementFromLockModal(i)).then(() => { tendaiAfter(); changed('prompt'); return true; });
    }

    /** deleteDynamicReplacementFromLockModal past its question (the phone asks it itself). */
    function tendaiDelete(i) {
        const f = tendaiFind(i);
        if (!f) return false;
        f.arrayRef.splice(f.arrayIndex, 1);
        window.lockedDynamicReplacements = tendaiList().map((x) => x.rep).filter((r) => r.locked === true);
        tendaiAfter();
        return true;
    }

    function tendaiEmphasis(i, value) {
        const f = tendaiFind(i);
        const n = Number(value);
        if (!f || !Number.isFinite(n)) return false;
        f.replacement.segment_emphasis = n;
        tendaiAfter();
        return true;
    }

    function compileTendai() {
        if (typeof compileAllTendaiReplacements !== 'function') return Promise.resolve(false);
        return Promise.resolve(compileAllTendaiReplacements()).then(() => { changed('tendai'); changed('prompt'); return true; });
    }

    function scanExpanders() {
        if (typeof refreshInspectorTextReplacementsFromPrompts !== 'function') return Promise.resolve(false);
        return Promise.resolve(refreshInspectorTextReplacementsFromPrompts()).then(() => { changed('genso'); return true; });
    }

    /** populateCompiledPromptsSection's choice of texts: the picture's metadata first, else the session's compile. */
    function compiledPrompts() {
        const md = (window.currentManualPreviewImage && window.currentManualPreviewImage.metadata) || (window.lastGeneration && window.lastGeneration.metadata);
        const scp = rentanOf();
        const chars = (cp) => { const a = cp && (cp.characterPrompts || cp.character_prompts); return Array.isArray(a) && a.length ? a : null; };
        let prompt = '';
        let uc = '';
        let list = [];
        if (md) {
            const dg = md.dynamic_generation && md.dynamic_generation.compiled_prompt;
            if (typeof md.compiled_prompt === 'string') prompt = md.compiled_prompt;
            else prompt = (dg && dg.prompt) || md.prompt || (scp && scp.prompt) || '';
            if (md.compiled_uc != null) uc = md.compiled_uc;
            else uc = (dg && dg.uc) || md.uc || (scp && scp.uc) || '';
            if (Array.isArray(md.compiled_characterPrompts) && md.compiled_characterPrompts.length) list = md.compiled_characterPrompts;
            else list = chars(dg) || (Array.isArray(md.characterPrompts) && md.characterPrompts.length ? md.characterPrompts : null) || chars(scp) || [];
        } else if (scp) {
            prompt = scp.prompt || '';
            uc = scp.uc || '';
            list = chars(scp) || [];
        }
        return {
            prompt: String(prompt || ''),
            uc: String(uc || ''),
            characters: list.map((c) => ({ prompt: String((c && (c.prompt || c.char_caption)) || ''), uc: String((c && (c.uc || c.negative)) || '') }))
        };
    }

    M.extend({
        inspector,
        gensoLockAt,
        gensoOptions,
        gensoResolve,
        gensoReroll,
        gensoApply,
        gensoCopy: (i) => { const s = rawSeeds()[i]; return copy(s && s.value != null ? String(s.value) : ''); },
        tendaiCopy: (i) => { const x = tendaiList()[i]; return copy(x ? String(x.rep.value || x.rep.replace_text || x.rep.select_text || '') : ''); },
        inspectorLockAll,
        tendaiLock,
        tendaiApply,
        tendaiDelete,
        tendaiEmphasis,
        compileTendai,
        scanExpanders,
        hasManagedStages: () => { try { return typeof hasManagedBracketArtifacts === 'function' && !!hasManagedBracketArtifacts(); } catch (_) { return false; } },
        deleteManagedStages: () => { if (typeof deleteAllManagedBracketArtifacts !== 'function') return false; deleteAllManagedBracketArtifacts(); changed('prompt'); return true; },
        compiledPrompts
    });
})();
