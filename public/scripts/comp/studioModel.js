/**
 * studioModel: the one interface a second Studio front end talks to (#860).
 *
 * Studio keeps its session in the desktop window's own form (manualModalManager.js and friends).
 * A front end that is not that window (Melaton Mobile's DreamStudio, wmDreamStudio.js) never reads
 * or writes those elements itself: it asks here. Today the answers come from the desktop form, kept
 * loaded and out of sight; when Studio's session becomes an object of its own (#844) only this file
 * changes.
 *
 *   studioModel.ready()                 the desktop Studio code and form are there
 *   studioModel.snapshot()              the session as plain data (prompt, uc, negative, model, steps ...)
 *   studioModel.set(id, value)          one value: 'prompt' | 'uc' | 'negative', or a Studio parameter id
 *                                       (studioChangeJson.js STUDIO_CHANGE_PARAM_DEFS)
 *   studioModel.addCharacter() / removeCharacter(i) / setCharacter(i, { name, enabled })
 *                                       characters by their place in snapshot().characters; their text is
 *                                       set('character:<i>:prompt' | ':uc' | ':negative', value)
 *   studioModel.setBaseImage(filename) / clearBaseImage()
 *                                       the gallery picture a print starts from (snapshot().baseImage)
 *   studioModel.setReferences([{ file | source, type, strength, fidelity }])
 *                                       the character / style reference pictures, whole list at once
 *                                       (snapshot().references; at most six)
 *   studioModel.openPicture(filename)   a gallery picture's own settings as the session
 *   studioModel.peers() / sendTo(id) / getFrom(id)
 *                                       the devices ActiveSync can pass a session to or fetch one from
 *   studioModel.presets() / sessionName() / openPreset(name) / savePreset(name)
 *                                       the saved presets' names, this session's name, load one, save as one
 *   studioModel.options()               what the lists offer and which controls the chosen model has
 *                                       (models and sizes with the desktop's badges)
 *   studioModel.datasets() / setDataset(value, { on, bias })
 *                                       the datasets and the Quality / Transparency presets with their
 *                                       weights (the desktop's dataset list); '__quality__' and
 *                                       '__transparency__' name the presets
 *   studioModel.adjustments() / setAdjustment(dataset, id, { on, bias })
 *                                       the checked datasets' adjustment toggles with their weights
 *   studioModel.tagGroups(path) / tagsAt(path) / searchTags(text)
 *                                       Quick Access, the tag library by category (the desktop's
 *                                       datasetTagToolbar.js server calls; promises): a level's groups
 *                                       and main tags, the tags at a leaf, tags matching some letters
 *   studioModel.previewSeed() / usePreviewSeed()
 *                                       the print on show's seed / that seed into the box (kept if locked)
 *   studioModel.clearSeed() / randomSeed()
 *                                       the seed box emptied (and unlocked) / a new random seed in it
 *   studioModel.tokenLimit() / addedTokens('prompt' | 'uc')
 *                                       the token limit; the tokens Studio adds itself (quality, datasets)
 *   studioModel.autofillSettings() / setAutofillSetting(key, value)
 *                                       SmartText's settings (the desktop's, saved to the account)
 *   studioModel.directiveOn()           Rentan's creative mode is on (the Directive field is used:
 *                                       set('directive', text), snapshot().directive)
 *   studioModel.gensoSeeds() / setGensoLock(key | true | false, on)
 *                                       the Inspector's Genso seeds and their locks
 *   studioModel.customSize() / setCustomSize(w, h) / stepRatio(dir) / setRatio('W:H') / cycleArea()
 *                                       Custom Resolution and Custom Ratio, and the area limit
 *   studioModel.tokens(text)            token count of a prompt for the chosen model (a promise)
 *   studioModel.suggest(text)            suggestions for a few typed letters (a promise): [{ text, label, kind
 *                                       'tag' | 'character' | 'expander', category, count, note }], with
 *                                       .spell [{ word, suggestions }] and .lookup [{ word, synonyms }]
 *   studioModel.cost()                  Anlas the next Generate would ask for (0 = free)
 *   studioModel.generate()              one Generate; resolves when it is over (done, failed or stopped)
 *   studioModel.stop()                  give up the print in hand
 *   studioModel.run()                   the generation in hand, or the last one: { active, phase, step,
 *                                       steps, print, prints, frame, files[] }
 *   studioModel.prints()                this visit's finished prints, oldest first (file names)
 *   studioModel.forget(filename)        drop a print from that list (it was scrapped or deleted)
 *   studioModel.heldPicture(filename)   an in-memory address of that print's picture while Studio holds it
 *   studioModel.select(filename)        make a print the one Studio's picture actions work on
 *   studioModel.action(name)            a picture action on the selected print (the desktop's own handler)
 *   studioModel.on(type, fn) / off      'change' (the session changed), 'start', 'progress', 'end'
 *   studioModel.stepPreviewSize         { width, height } of the view that shows the streamed steps
 *   studioModel.ownsPrints              true: the front end shows several prints itself (the desktop's
 *                                       Prints window stays shut; stageResultsReview.js)
 */
(function () {
    'use strict';

    /* global getStudioParamSnapshot, applyStudioParam, writeStudioFieldValue, handleManualGeneration,
       modelGroups, SAMPLER_MAP, NOISE_MAP, RESOLUTION_GROUPS, RESOLUTIONS, isGenerating, forcePaidRequest,
       v5FullSupportsEffort, mediumControlIsLocked, isV5Model, getForgeModelFeatures, countTokensForText,
       ensurePromptTokenizerForModel, collectManualFormValues, addSharedFieldsToRequestBody,
       calculateCreditCost, registerWsInboundHandler, findImageByFilename, updateManualPreviewDirectly, getImageMetadata,
       handleManualPreviewImageContextMenuAction, getAutofillSearchSettings, selectedDatasets,
       applyStudioDatasetConfig, getCurrentDatasetModelKey, getCharacterPrompts, getStudioCharacterItems, hasManagedEmphasisGroupIds, expandEmphasisGroupIds,
       resolveEmphasisBagForTextarea,
       addCharacterPrompt, deleteCharacterPrompt, setStudioCharacterName, handleManualSave, applyImageAsVariationBase, handleDeleteBaseImage, collectPreciseReferenceData,
       loadPreciseReferencesFromMetadata, updateManualPriceDisplay, datasetAllowedForModel, getStudioUcPresetMenuItems,
       getStudioDatasetCatalog, datasetBias, findDatasetConfig, toggleDataset, adjustDatasetBias, ensureActiveSubTogglesInitialized,
       getActiveSubToggleDatasets, getVisibleSubToggles, getSubToggleGroup, getSubToggleDefaultBias, isSubToggleEnabled,
       getRatioGroupSharedBias, toggleSubToggle, adjustSubToggleBias, getCurrentDatasetModelKey, setSproutSeedLocked, getPromptTokenLimit,
       manualSelectedResolution, isCustomRatioMode, isCustomResolutionMode, formatAspectRatio, stepManualRatioFromCurrent, commitManualRatioInput, promptTextareaToolbar,
       getInspectorAppliedTextReplacementSeeds, applyStudioGensoLocks, saveAutofillSearchSettingsToServer */

    // directive: Rentan's creative directive (its own textarea; no managed emphasis marks in it)
    const FIELDS = { prompt: ['manualPrompt', 'prompt'], uc: ['manualUc', 'uc'], negative: ['manualPromptNegative', 'promptNegative'], directive: ['creativeDirectiveInput', null] };
    const listeners = new Map();
    const session = [];
    let current = null;
    let wired = false;

    const el = (id) => document.getElementById(id);
    const has = (name) => typeof window[name] === 'function';

    function emit(type, detail) {
        const set = listeners.get(type);
        if (!set) return;
        set.forEach((fn) => { try { fn(detail); } catch (err) { console.warn('[studioModel]', type, err); } });
    }

    function on(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
        wire();
    }

    function off(type, fn) {
        const set = listeners.get(type);
        if (set) set.delete(fn);
    }

    function ready() {
        return !!el('manualForm') && typeof getStudioParamSnapshot === 'function' && typeof applyStudioParam === 'function';
    }

    function generating() {
        try { return typeof isGenerating !== 'undefined' && !!isGenerating; } catch (_) { return false; }
    }

    /**
     * A field's text as a person writes it. Studio keeps weighted groups in its fields as invisible
     * marks with the weights held beside them (emphasisGroupIdCodec.js); out here they are the plain
     * `1.2::text::` form, which Studio turns back into its marks when the text is set.
     */
    function visibleText(field) {
        if (!field) return '';
        const raw = field.value || '';
        try {
            if (typeof hasManagedEmphasisGroupIds === 'function' && hasManagedEmphasisGroupIds(raw) && typeof expandEmphasisGroupIds === 'function') {
                const bag = typeof resolveEmphasisBagForTextarea === 'function' ? resolveEmphasisBagForTextarea(field) : null;
                const out = expandEmphasisGroupIds(raw, bag);
                if (out && typeof out.text === 'string') return out.text;
            }
        } catch (_) { /* the stored text */ }
        return raw;
    }

    function snapshot() {
        if (!ready()) return null;
        const p = getStudioParamSnapshot();
        const out = Object.assign({}, p);
        out.model = String(p.model || '').toLowerCase();
        Object.keys(FIELDS).forEach((id) => { out[id] = visibleText(el(FIELDS[id][0])); });
        try { out.paid = typeof forcePaidRequest !== 'undefined' && !!forcePaidRequest; } catch (_) { out.paid = false; }
        out.hasBaseImage = !!(window.uploadedImageData || (window.currentEditMetadata && window.currentEditMetadata.sourceFilename && el('manualImg2ImgGroup') && !el('manualImg2ImgGroup').classList.contains('hidden')));
        // the base image, when it is a picture of the gallery: its file name
        const src = window.uploadedImageData && typeof window.uploadedImageData.image_source === 'string' ? window.uploadedImageData.image_source : '';
        out.baseImage = out.hasBaseImage ? (src.startsWith('file:') ? src.slice(5) : '') : '';
        try {
            const refs = typeof collectPreciseReferenceData === 'function' ? collectPreciseReferenceData() : null;
            out.references = refs ? refs.chara_reference_source.map((source, i) => ({
                source,
                file: String(source).startsWith('file:') ? String(source).slice(5) : '',
                type: refs.chara_reference_type[i] || 1,
                strength: refs.chara_reference_strength[i],
                fidelity: refs.chara_reference_fidelity[i]
            })) : [];
        } catch (_) { out.references = []; }
        out.generating = generating();
        // the seed box's own text ('' = random); out.seed falls back to the last print's seed
        out.seedText = el('manualSeed') ? String(el('manualSeed').value || '').trim() : '';
        try {
            const items = typeof getStudioCharacterItems === 'function' ? getStudioCharacterItems() : [];
            out.characters = (typeof getCharacterPrompts === 'function' ? getCharacterPrompts() : []).map((c, i) => {
                const id = items[i] && items[i].id;
                const text = (part, fallback) => { const f = id && el(`${id}_${part}`); return f ? visibleText(f).trim() : (fallback || ''); };
                return { name: c.chara_name || '', prompt: text('prompt', c.prompt), uc: text('uc', c.uc), negative: text('promptNegative', c.input_prompt_negative), enabled: c.enabled !== false };
            });
        } catch (_) { out.characters = []; }
        try { out.datasets = typeof selectedDatasets !== 'undefined' && Array.isArray(selectedDatasets) ? selectedDatasets.slice() : []; } catch (_) { out.datasets = []; }
        return out;
    }

    async function set(id, value) {
        if (!ready()) return false;
        const chr = /^character:(\d+):(prompt|uc|negative)$/.exec(String(id));
        if (chr) {
            // one field of a character, by its place in the list (studioChangeJson.js field ids)
            writeStudioFieldValue(`character:${chr[1]}:${chr[2] === 'negative' ? 'promptNegative' : chr[2]}`, value);
        } else if (id === 'datasets') {
            // the checked datasets, by value (studioChangeJson.js applyStudioDatasetConfig)
            if (typeof applyStudioDatasetConfig === 'function') applyStudioDatasetConfig({ include: Array.isArray(value) ? value : [] });
        } else if (FIELDS[id]) {
            const f = el(FIELDS[id][0]);
            if (!f || visibleText(f) === String(value == null ? '' : value)) return true;
            if (FIELDS[id][1]) writeStudioFieldValue(FIELDS[id][1], value);
            else {
                f.value = String(value == null ? '' : value);
                f.dispatchEvent(new Event('input', { bubbles: true }));
                f.dispatchEvent(new Event('change', { bubbles: true }));
            }
        } else {
            await applyStudioParam(id, value);
        }
        emit('change', { id });
        return true;
    }

    function options() {
        const model = (snapshot() || {}).model || '';
        const caps = (typeof getForgeModelFeatures === 'function' && getForgeModelFeatures(model)) || {};
        const locked = (name) => { try { return typeof mediumControlIsLocked === 'function' && !!mediumControlIsLocked(name); } catch (_) { return false; } };
        let v5 = false;
        try { v5 = typeof isV5Model === 'function' && !!isV5Model(); } catch (_) { /* before the model list */ }
        let effort = false;
        try { effort = typeof v5FullSupportsEffort === 'function' && !!v5FullSupportsEffort(); } catch (_) { /* same */ }
        return {
            // short: the version as the desktop's closed combo shows it; badge: its edition (Full, Cur ...)
            models: (typeof modelGroups !== 'undefined' ? modelGroups : []).map((g) => ({ group: g.group, options: g.options.map((o) => ({ value: o.value, name: o.name, short: o.display_full || o.display || o.name, badge: o.badge_full || o.badge || '', badgeClass: o.badge_class || '' })) })),
            samplers: (typeof SAMPLER_MAP !== 'undefined' ? SAMPLER_MAP : []).map((s) => ({ value: s.meta, name: s.display, short: s.display_short_full || s.display, badge: s.badge || '' })),
            noise: (typeof NOISE_MAP !== 'undefined' ? NOISE_MAP : []).map((s) => ({ value: s.meta, name: s.display })),
            // badge / free: the size group's badge as the desktop draws it (formatResolutionSelectedHtml)
            resolutions: (typeof RESOLUTION_GROUPS !== 'undefined' ? RESOLUTION_GROUPS : []).map((g) => ({ group: g.group, badge: g.badge || '', free: !!g.free, options: g.options.map((o) => ({ value: o.value, name: o.name || o.display || o.value })) })),
            sizes: (typeof RESOLUTIONS !== 'undefined' ? RESOLUTIONS : []).reduce((m, r) => { m[r.value] = [r.width, r.height]; return m; }, {}),
            datasets: (() => {
                try {
                    const key = typeof getCurrentDatasetModelKey === 'function' ? getCurrentDatasetModelKey() : null;
                    return ((window.optionsData && window.optionsData.datasets) || [])
                        // the __quality__ kind are presets with switches of their own, not datasets
                        .filter((d) => d && !/^__/.test(String(d.value)) && (typeof datasetAllowedForModel !== 'function' || datasetAllowedForModel(d, key)))
                        .map((d) => ({ value: d.value, name: d.display || d.name || d.label || d.value }));
                } catch (_) { return []; }
            })(),
            ucPresets: (() => {
                try {
                    return (typeof getStudioUcPresetMenuItems === 'function' ? getStudioUcPresetMenuItems() : [])
                        .filter((r) => r && !r.separator && typeof r.value === 'number' && /^studio-uc-select-/.test(String(r.action || '')))
                        .map((r) => ({ value: r.value, name: r.text }));
                } catch (_) { return []; }
            })(),
            nsfw: [[3, 'Nude'], [2, 'Skimpy'], [1, 'Allow'], [0, 'Neutral'], [-1, 'Remove'], [-2, 'Cleanse']].map(([value, name]) => ({ value, name })),
            has: {
                effort,
                uc: !locked('uc'),
                datasets: !/^v3/.test(model),
                characters: !/^v3/.test(model),
                references: caps.preciseReference !== false && !/^v3/.test(model),
                noise: !v5,
                variety: !v5 && caps.varietyPlus !== false,
                rescale: !locked('rescale'),
                sampler: !locked('sampler'),
                steps: !locked('steps')
            }
        };
    }

    // ---- SmartText (autofill) settings: the desktop's, saved to the account (autofillSettings.js)
    const AUTOFILL_DELAYS = [[0, 'Instant (0 ms)'], [80, 'Fast (80 ms)'], [120, 'Normal (120 ms)'], [200, 'Relaxed (200 ms)'], [300, 'Slow (300 ms)'], [500, 'Very Slow (500 ms)']];
    const AUTOFILL_MAX = [15, 25, 35, 50, 75];
    /** { enabled, spellcheck, spellcheckSoundAlike, thesaurus, naiAnimeTags, naiFurryTags, dbAnimeTags, dbFurryTags, searchDelayMs, maxResults, delays, maxima } */
    function autofillSettings() {
        let s = {};
        try { s = typeof getAutofillSearchSettings === 'function' ? Object.assign({}, getAutofillSearchSettings()) : {}; } catch (_) { s = {}; }
        s.delays = AUTOFILL_DELAYS.map(([ms, label]) => ({ ms, label }));
        s.maxima = AUTOFILL_MAX.slice();
        return s;
    }

    async function setAutofillSetting(key, value) {
        if (typeof saveAutofillSearchSettingsToServer !== 'function') return false;
        const cur = autofillSettings();
        delete cur.delays;
        delete cur.maxima;
        cur[key] = value;
        const ok = await saveAutofillSearchSettingsToServer(cur);
        emit('change', { id: 'autofill' });
        return ok;
    }

    /** Rentan's creative mode is on (its Directive is used): the desktop shows the Directive tab then. */
    function directiveOn() {
        const b = el('creativeBtn');
        const g = el('dynamicGenerationGroup');
        return !!(b && b.getAttribute('data-state') === 'on' && g && !g.classList.contains('hidden'));
    }

    // ---- the Inspector's Genso seeds (expander picks of the last print): their value and lock
    /** [{ key, value, locked, canLock }] */
    function gensoSeeds() {
        try {
            if (typeof getInspectorAppliedTextReplacementSeeds !== 'function') return [];
            return getInspectorAppliedTextReplacementSeeds().filter((x) => x && x.key).map((x) => ({
                key: String(x.key),
                value: String(x.value == null ? '' : x.value),
                locked: x.locked === true,
                canLock: x.can_lock !== false
            }));
        } catch (_) { return []; }
    }

    /** One seed's lock (key), or every seed (key true / false). */
    function setGensoLock(key, on) {
        if (typeof applyStudioGensoLocks !== 'function') return false;
        if (key === true || key === false) applyStudioGensoLocks(key);
        else {
            const locked = new Set(gensoSeeds().filter((x) => x.locked).map((x) => x.key.toLowerCase()));
            if (on) locked.add(String(key).toLowerCase()); else locked.delete(String(key).toLowerCase());
            applyStudioGensoLocks(Array.from(locked));
        }
        emit('change', { id: 'genso' });
        return true;
    }

    // ---- custom size: Custom Resolution (width and height) and Custom Ratio (a W:H stepped through the
    // legal sizes), within the area limit the desktop's Normal / Large / Max toggle sets
    /** { mode 'size' | 'ratio' | null, width, height, ratio 'W:H', area: 'Normal' | 'Large' | 'Max' } */
    function customSize() {
        if (!ready()) return null;
        let res = '';
        try { res = typeof manualSelectedResolution !== 'undefined' ? String(manualSelectedResolution || '') : ''; } catch (_) { res = ''; }
        const ratio = typeof isCustomRatioMode === 'function' && isCustomRatioMode(res);
        const custom = typeof isCustomResolutionMode === 'function' && isCustomResolutionMode(res);
        const w = parseInt((el('manualWidth') || {}).value, 10) || 0;
        const h = parseInt((el('manualHeight') || {}).value, 10) || 0;
        const t = el('resolutionAreaToggle');
        return {
            mode: ratio ? 'ratio' : custom ? 'size' : null,
            width: w,
            height: h,
            ratio: w && h && typeof formatAspectRatio === 'function' ? formatAspectRatio(w, h) : '',
            area: (t && t.textContent.trim()) || 'Normal'
        };
    }

    async function setCustomSize(width, height) {
        if (!ready()) return false;
        if (width) await applyStudioParam('width', Math.round(width));
        if (height) await applyStudioParam('height', Math.round(height));
        emit('change', { id: 'resolution' });
        return true;
    }

    /** Custom Ratio: the next legal size up (1) or down (-1) at this ratio; or a typed 'W:H'. */
    function stepRatio(dir) {
        if (!ready() || typeof stepManualRatioFromCurrent !== 'function') return false;
        stepManualRatioFromCurrent(dir);
        emit('change', { id: 'resolution' });
        return true;
    }

    function setRatio(text) {
        const f = el('manualRatio');
        if (!ready() || !f || typeof commitManualRatioInput !== 'function') return false;
        f.value = String(text || '');
        commitManualRatioInput();
        emit('change', { id: 'resolution' });
        return true;
    }

    /** The area limit's next step (Normal, Large, Max: the desktop's toggle beside Resolution). */
    function cycleArea() {
        const t = el('resolutionAreaToggle');
        if (!ready() || !t) return false;
        t.click();
        emit('change', { id: 'resolution' });
        return true;
    }

    /** Tokens Studio adds to a field on its own (quality and dataset tags): 'prompt' | 'uc'. */
    function addedTokens(field) {
        try {
            const t = typeof promptTextareaToolbar !== 'undefined' && promptTextareaToolbar && promptTextareaToolbar._groupTotals;
            return t ? Number(field === 'uc' ? t.neUc : t.nePrompt) || 0 : 0;
        } catch (_) { return 0; }
    }

    /** The prompt's token limit for the chosen model (the desktop's token bar). */
    function tokenLimit() {
        try { return typeof getPromptTokenLimit === 'function' ? Number(getPromptTokenLimit((snapshot() || {}).model)) || 0 : 0; } catch (_) { return 0; }
    }

    async function tokens(text) {
        const model = (snapshot() || {}).model || '';
        try {
            if (typeof ensurePromptTokenizerForModel === 'function') await ensurePromptTokenizerForModel(model);
            // a weighted group counts as its words: the `1.2::` and `::` around them are not sent as
            // tokens (the desktop counts its marked text the same way, presetTokenCount.js)
            const plain = String(text || '').replace(/(-?\d+(?:\.\d+)?)::([\s\S]*?)::/g, '$2');
            if (typeof countTokensForText === 'function') return countTokensForText(plain);
        } catch (_) { /* no tokenizer yet */ }
        return null;
    }

    // ---- tag suggestions: the server's autofill search, asked under a session of this file's own so
    // the desktop's autofill (autocompleteUtils.js) neither sees these answers nor loses its own
    const SUGGEST_SESSION = 'studioModel';
    const suggestWaiting = new Map();
    let suggestSeq = 0;
    let suggestWired = false;

    // spell check and thesaurus come in their own update messages before the search completes: kept
    // per request until then
    const suggestExtras = new Map();

    /** A misspelt word's usable suggestions (none equal to it, no repeats); words left with none go. */
    function spellRows(data) {
        if (!data || !data.hasErrors || !Array.isArray(data.misspelled)) return [];
        return data.misspelled.map((word) => {
            const seen = new Set([String(word).toLowerCase()]);
            const list = ((data.suggestions && data.suggestions[word]) || []).filter((x) => { const k = String(x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
            return { word, suggestions: list.slice(0, 6) };
        }).filter((r) => r.suggestions.length);
    }

    /** Thesaurus words with synonyms (the word being typed first, as the server orders them). */
    function lookupRows(data) {
        if (!data || !data.hasData || !Array.isArray(data.words)) return [];
        return data.words.filter((w) => w && Array.isArray(w.synonyms) && w.synonyms.length).map((w) => ({ word: w.word, synonyms: w.synonyms.slice(0, 8) }));
    }

    /** One result row as the phone lists it: what goes in, its label, its kind and the facts beside it. */
    function suggestRow(r) {
        if (!r || typeof r !== 'object') return null;
        if (r.type === 'textReplacement' && r.placeholder) {
            return { text: `!${r.placeholder}`, label: String(r.displayName || r.placeholder).replace(/^[^:]*:\s*/, ''), kind: 'expander', note: 'Expander' };
        }
        if (r.type === 'character' || r.type === 'characterTag') {
            const c = r.character || {};
            const name = String((r.tag && (r.tag.title || r.tag.name)) || r.tagInsertName || c.name || r.name || '').trim();
            return name ? { text: name.replace(/_/g, ' '), label: name.replace(/_/g, ' '), kind: 'character', note: c.copyright || '' } : null;
        }
        const name = String(r.tag || r.title || r.name || '').trim();
        if (!name) return null;
        const cat = typeof r.category === 'number' ? r.category : ({ general: 0, artist: 1, copyright: 3, character: 4, meta: 5, species: 6 }[String(r.categoryName || r.category || '').toLowerCase()]);
        const count = Number(r.n_count || r.count || r.d_count || r.e_count) || 0;
        return { text: name.replace(/_/g, ' '), label: name.replace(/_/g, ' '), kind: 'tag', category: Number.isFinite(cat) ? cat : 0, count };
    }

    function wireSuggest() {
        if (suggestWired || typeof window.handleSearchResponse !== 'function') return suggestWired;
        suggestWired = true;
        const orig = window.handleSearchResponse;
        window.handleSearchResponse = function (message) {
            if (!message || message.autofillSessionId !== SUGGEST_SESSION) return orig.apply(this, arguments);
            if (message.type === 'search_results_update') {
                const svc = message.service;
                if ((svc === 'spellcheck' || svc === 'wordLookup') && suggestWaiting.has(message.requestId)) {
                    const x = suggestExtras.get(message.requestId) || {};
                    const row = (message.results || [])[0];
                    x[svc] = row ? row.data : null;
                    suggestExtras.set(message.requestId, x);
                }
                return undefined;
            }
            if (message.type !== 'search_characters_complete') return undefined;
            const done = suggestWaiting.get(message.requestId);
            if (!done) return undefined;
            suggestWaiting.delete(message.requestId);
            const extra = suggestExtras.get(message.requestId) || {};
            suggestExtras.delete(message.requestId);
            const seen = new Set();
            const out = [];
            ((message.data && message.data.results) || []).forEach((r) => {
                const row = suggestRow(r);
                if (!row || seen.has(row.text.toLowerCase())) return;
                seen.add(row.text.toLowerCase());
                out.push(row);
            });
            out.spell = spellRows(extra.spellcheck || (message.data && message.data.spellCheck));
            out.lookup = lookupRows(extra.wordLookup);
            done(out);
            return undefined;
        };
        return true;
    }

    function suggest(text) {
        const query = String(text || '').trim();
        if (!query || !wireSuggest() || !window.wsClient || typeof window.wsClient.sendAcklessMessage !== 'function') return Promise.resolve([]);
        const requestId = `${SUGGEST_SESSION}-${++suggestSeq}`;
        const modelEl = el('manualModel');
        return new Promise((resolve) => {
            suggestWaiting.set(requestId, resolve);
            // a search overtaken by the next one is never answered: it ends empty
            setTimeout(() => { if (suggestWaiting.delete(requestId)) { suggestExtras.delete(requestId); resolve([]); } }, 6000);
            try {
                window.wsClient.sendAcklessMessage('search_characters', {
                    query,
                    model: (modelEl && modelEl.value) || 'nai-diffusion-4-5-full',
                    requestId,
                    autofillSessionId: SUGGEST_SESSION,
                    spellCheckText: query,
                    isContinuation: false,
                    autofillSettings: typeof getAutofillSearchSettings === 'function' ? getAutofillSearchSettings() : null,
                    modelMode: 'anime'
                });
            } catch (_) { suggestWaiting.delete(requestId); resolve([]); }
        });
    }

    function cost() {
        try {
            if (typeof collectManualFormValues !== 'function' || typeof calculateCreditCost !== 'function') return 0;
            const values = collectManualFormValues();
            const body = { model: values.model, steps: values.steps, resolution: values.resolutionValue, width: values.width, height: values.height, n: values.n, upscale: values.upscale };
            if (typeof addSharedFieldsToRequestBody === 'function') { try { addSharedFieldsToRequestBody(body, values); } catch (_) { /* the plain body still prices */ } }
            const c = calculateCreditCost(body);
            const n = Number(c && typeof c === 'object' ? (c.isFree ? c.opus : c.list) : c);
            return Number.isFinite(n) ? n : 0;
        } catch (_) { return 0; }
    }

    // ---- characters: the desktop's character cards, by their place in the list

    const characterItems = () => (typeof getStudioCharacterItems === 'function' ? getStudioCharacterItems() : []);

    function addCharacter() {
        if (typeof addCharacterPrompt !== 'function') return -1;
        const before = characterItems().length;
        addCharacterPrompt();
        const n = characterItems().length;
        emit('change', { id: 'characters' });
        return n > before ? n - 1 : -1;
    }

    function removeCharacter(index) {
        const item = characterItems()[index];
        if (!item || typeof deleteCharacterPrompt !== 'function') return false;
        deleteCharacterPrompt(item.id);
        emit('change', { id: 'characters' });
        return true;
    }

    function setCharacter(index, values) {
        const item = characterItems()[index];
        if (!item || !values) return false;
        if (typeof values.name === 'string' && values.name.trim() && typeof setStudioCharacterName === 'function') setStudioCharacterName(index, values.name.trim());
        if (typeof values.enabled === 'boolean') {
            const toggle = el(`${item.id}_enabled`);
            if (toggle) toggle.setAttribute('data-state', values.enabled ? 'on' : 'off');
            item.classList.toggle('character-prompt-disabled', !values.enabled);
        }
        emit('change', { id: 'characters' });
        return true;
    }

    // ---- base image: the picture a print starts from (strength and noise are parameters)

    function setBaseImage(filename) {
        if (!filename || typeof applyImageAsVariationBase !== 'function') return false;
        applyImageAsVariationBase({ filename });
        emit('change', { id: 'baseImage' });
        return true;
    }

    function clearBaseImage() {
        if (typeof handleDeleteBaseImage !== 'function') return false;
        handleDeleteBaseImage();
        emit('change', { id: 'baseImage' });
        return true;
    }

    // ---- references: pictures a print takes its character and / or its style from
    // (type 1 character and style, 2 character, 3 style; strength and fidelity 0..1)

    async function setReferences(list) {
        if (typeof loadPreciseReferencesFromMetadata !== 'function') return false;
        const refs = (Array.isArray(list) ? list : []).filter((r) => r && (r.source || r.file)).slice(0, 6);
        const clamp = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1; };
        await loadPreciseReferencesFromMetadata({
            chara_reference_source: refs.map((r) => r.source || `file:${r.file}`),
            chara_reference_type: refs.map((r) => (r.type === 2 || r.type === 3 ? r.type : 1)),
            chara_reference_strength: refs.map((r) => clamp(r.strength)),
            chara_reference_fidelity: refs.map((r) => clamp(r.fidelity))
        });
        if (typeof updateManualPriceDisplay === 'function') { try { updateManualPriceDisplay(); } catch (_) { /* the badge only */ } }
        emit('change', { id: 'references' });
        return true;
    }

    // ---- a session from a picture, and to / from another device (activeSyncStudio.js)

    function openPicture(filename) {
        if (!filename || typeof window.openManualModalWithContent !== 'function') return Promise.resolve(false);
        const image = (typeof findImageByFilename === 'function' && findImageByFilename(filename)) || { filename };
        return Promise.resolve(window.openManualModalWithContent({ type: 'image', image, metadata: null })).then(() => true);
    }

    const sync = () => window.activeSyncStudio || null;
    function peers() { try { return sync() ? sync().targets() : []; } catch (_) { return []; } }
    function sendTo(id) { return sync() ? sync().sendTo(id) : Promise.resolve(null); }
    function getFrom(id) { return sync() ? sync().getFrom(id) : Promise.resolve(null); }

    // ---- presets: a session kept under a name on the server

    function presets() {
        const list = (window.optionsData && window.optionsData.presets) || [];
        return list.map((p) => p && p.name).filter(Boolean).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    }

    function sessionName() {
        const f = el('manualPresetName');
        return f ? String(f.value || '').trim() : '';
    }

    function openPreset(name) {
        if (!name || typeof window.openManualModalWithContent !== 'function') return Promise.resolve(false);
        return Promise.resolve(window.openManualModalWithContent({ type: 'preset', name, title: name })).then(() => true);
    }

    /** Saves the session as the preset `name` (replacing one of that name: the caller asks first). */
    async function savePreset(name) {
        const clean = String(name || '').trim();
        if (!clean || typeof handleManualSave !== 'function') return false;
        const f = el('manualPresetName');
        if (f) { f.value = clean; f.dispatchEvent(new Event('input', { bubbles: true })); }
        await handleManualSave({ name: clean });
        emit('change', { id: 'presetName' });
        return true;
    }

    /** The packet's newest step picture ({ imageData, imageFormat }), or null. */
    function frameOf(d) {
        const frames = Array.isArray(d.stepFrames) ? d.stepFrames : null;
        const last = frames && frames.length ? frames[frames.length - 1] : d;
        return last && last.imageData ? last : null;
    }

    function frameSrc(last) {
        return `data:${last.imageFormat === 'png' ? 'image/png' : 'image/jpeg'};base64,${last.imageData}`;
    }

    /**
     * A generation's record. Its frame (the newest step picture as a data: address) is made when it is
     * read, not on every progress packet: a page out of sight never reads it, and the string (the
     * picture's whole base64 again) was built ~28 times a print for nobody (#890).
     */
    function newRun(prints) {
        const run = { active: true, phase: 'starting', step: 0, steps: 0, print: 1, prints, files: [], stopped: false, error: '' };
        let pending = null;
        let src = '';
        Object.defineProperty(run, 'frame', {
            enumerable: true,
            get() { if (pending) { src = frameSrc(pending); pending = null; } return src; },
            set(v) { pending = null; src = v ? String(v) : ''; }
        });
        // the packet's step picture, made into the frame when read
        Object.defineProperty(run, 'takeFrame', { value: (last) => { pending = last; } });
        return run;
    }

    function wire() {
        if (wired || typeof registerWsInboundHandler !== 'function') return;
        wired = true;
        registerWsInboundHandler({
            id: 'studioModel.progress',
            type: 'image_generation_progress',
            phase: 'pre',
            handler(message) {
                const d = message && message.data;
                if (!d || !current || !current.active) return;
                if (d.phase) current.phase = d.phase;
                if (Number(d.totalSteps) > 0) current.steps = Number(d.totalSteps);
                if (d.currentStep != null) current.step = Number(d.currentStep) || 0;
                if (d.stageType === 'print' && Number(d.totalStages) > 1) {
                    current.prints = Number(d.totalStages);
                    if (Number(d.currentStage) > 0) current.print = Number(d.currentStage);
                }
                const last = frameOf(d);
                if (last) current.takeFrame(last);
                if ((d.phase === 'stage_complete' || d.phase === 'complete') && d.filename && !current.files.includes(d.filename)) {
                    current.files.push(d.filename);
                    current.frame = '';
                    current.step = 0;
                }
                emit('progress', current);
            }
        });
        // a session loaded or cleared by another route (a print opened from the gallery, a preset,
        // an agent's change, New Session): whoever listens redraws from a fresh snapshot
        ['loadIntoManualForm', 'applyStudioChangeOps', 'startStudioNewSession', 'clearManualForm'].forEach((name) => {
            const orig = window[name];
            if (typeof orig !== 'function' || orig._studioModel) return;
            const wrapped = function () {
                const out = orig.apply(this, arguments);
                Promise.resolve(out).catch(() => {}).then(() => emit('change', { id: null, from: name }));
                return out;
            };
            wrapped._studioModel = true;
            window[name] = wrapped;
        });
        // the steps are drawn for the view that shows them, not for the desktop pane
        const dims = window.getManualModalStepPreviewDimensions;
        if (typeof dims === 'function' && !dims._studioModel) {
            const sized = function () {
                const s = api.stepPreviewSize;
                if (s && s.width > 0 && s.height > 0) return { width: Math.round(s.width), height: Math.round(s.height) };
                return dims.apply(this, arguments);
            };
            sized._studioModel = true;
            window.getManualModalStepPreviewDimensions = sized;
        }
    }

    function previewName() {
        const p = window.currentManualPreviewImage;
        return (p && (p.filename || p.upscaled || p.original)) || '';
    }

    /**
     * The picture Studio already holds in memory for a print (the one a generation just delivered):
     * an address that shows at once, with no request. '' when Studio holds another picture.
     */
    function heldPicture(filename) {
        const img = el('manualPreviewImage');
        const src = img ? (img.getAttribute('src') || '') : '';
        return filename && previewName() === filename && /^blob:/.test(src) ? src : '';
    }

    async function generate() {
        if (!ready() || generating() || (current && current.active)) return current;
        wire();
        const before = previewName();
        const run = newRun((snapshot() || {}).n || 1);
        current = run;
        emit('start', run);
        try {
            await handleManualGeneration({ preventDefault() {}, stopPropagation() {} });
        } catch (err) {
            run.error = (err && err.message) || 'Generation failed';
        }
        run.active = false;
        // one print reports no file of its own while it runs: it is the picture Studio now holds
        const after = previewName();
        if (!run.files.length && after && after !== before && !run.stopped) run.files.push(after);
        run.files.forEach((f) => { if (!session.includes(f)) session.push(f); });
        run.phase = run.stopped ? 'stopped' : (run.files.length ? 'complete' : 'none');
        emit('end', run);
        emit('change', { id: null, from: 'generate' });
        return run;
    }

    // ---- datasets and their adjustments with weights: the desktop's dataset and adjustment lists
    // (manualDropdownManager.js); a weight is set as the step the desktop's own - / + would take
    const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

    function datasets() {
        const out = { datasets: [], quality: null, transparency: null };
        if (!ready() || typeof getStudioDatasetCatalog !== 'function') return out;
        try {
            const cat = getStudioDatasetCatalog();
            const p = getStudioParamSnapshot();
            const bias = typeof datasetBias !== 'undefined' && datasetBias ? datasetBias : {};
            const on = typeof selectedDatasets !== 'undefined' && Array.isArray(selectedDatasets) ? selectedDatasets : [];
            out.datasets = cat.datasets.map((d) => ({
                value: d.value,
                name: d.display || d.value,
                icon: d.icon || 'fa-cube fas',
                on: on.includes(d.value),
                bias: num(bias[d.value], num(d.default, 1)),
                min: num(d.min, -3),
                max: num(d.max, 5),
                def: num(d.default, 1)
            }));
            out.quality = { value: '__quality__', name: (cat.qualityPreset && cat.qualityPreset.display) || 'Quality', icon: (cat.qualityPreset && cat.qualityPreset.icon) || 'fa-crown fas', on: !!p.append_quality, bias: num(p.quality_preset_bias, 1), min: 0, max: 9, def: 1 };
            if (cat.transparencyPreset) out.transparency = { value: '__transparency__', name: cat.transparencyPreset.display || 'Transparency', icon: cat.transparencyPreset.icon || 'fas fa-chess-board', on: !!p.append_transparency, bias: num(p.transparency_bias, 1), min: 0, max: 9, def: 1 };
        } catch (err) { console.warn('[studioModel] datasets', err); }
        return out;
    }

    async function setDataset(value, { on, bias } = {}) {
        if (!ready()) return false;
        if (value === '__quality__' || value === '__transparency__') {
            const q = value === '__quality__';
            if (on !== undefined) await applyStudioParam(q ? 'append_quality' : 'append_transparency', !!on);
            if (bias !== undefined) await applyStudioParam(q ? 'quality_preset_bias' : 'transparency_bias', Number(bias));
        } else {
            const cfg = typeof findDatasetConfig === 'function' ? findDatasetConfig(value) : null;
            if (!cfg) return false;
            const list = typeof selectedDatasets !== 'undefined' && Array.isArray(selectedDatasets) ? selectedDatasets : [];
            if (on !== undefined && !!on !== list.includes(value) && typeof toggleDataset === 'function') toggleDataset(value, cfg);
            if (bias !== undefined && typeof adjustDatasetBias === 'function') {
                const cur = num((typeof datasetBias !== 'undefined' && datasetBias ? datasetBias : {})[value], num(cfg.default, 1));
                adjustDatasetBias(value, Number(bias) - cur, cfg);
            }
        }
        emit('change', { id: 'datasets' });
        return true;
    }

    function adjustments() {
        if (!ready() || typeof getActiveSubToggleDatasets !== 'function') return [];
        try {
            if (typeof ensureActiveSubTogglesInitialized === 'function') ensureActiveSubTogglesInitialized();
            const key = typeof getCurrentDatasetModelKey === 'function' ? getCurrentDatasetModelKey() : undefined;
            return getActiveSubToggleDatasets().map((d) => {
                const toggles = getVisibleSubToggles(d, key);
                const row = (t) => {
                    const group = t.group ? getSubToggleGroup(d, t.group) : null;
                    const ratio = !!(group && group.mode === 'ratio');
                    const stored = window.datasetSettings && window.datasetSettings[d.value] && window.datasetSettings[d.value][t.id];
                    const def = getSubToggleDefaultBias(t);
                    return {
                        id: t.id,
                        name: t.name || t.id,
                        icon: t.icon || 'fas fa-toggle-on',
                        on: isSubToggleEnabled(d.value, t),
                        bias: ratio ? getRatioGroupSharedBias(d.value, d, t.group) : num(stored && stored.bias, def),
                        min: num(t.min, -3),
                        max: num(t.max, 5),
                        def,
                        ratio
                    };
                };
                // as the desktop lists them: the ones of no group, then each group under its name
                const rows = toggles.filter((t) => !t.group).map(row);
                const groups = [];
                (d.sub_toggle_groups || []).forEach((g) => groups.push([g.id, g.name || g.id]));
                toggles.forEach((t) => { if (t.group && !groups.some((g) => g[0] === t.group)) groups.push([t.group, t.group]); });
                groups.forEach(([id, name]) => {
                    const mine = toggles.filter((t) => t.group === id);
                    if (mine.length) rows.push({ head: name }, ...mine.map(row));
                });
                return { dataset: d.value, name: d.display || d.value, icon: d.icon || '', rows };
            }).filter((x) => x.rows.length);
        } catch (err) { console.warn('[studioModel] adjustments', err); return []; }
    }

    function setAdjustment(dataset, id, { on, bias } = {}) {
        if (!ready() || typeof findDatasetConfig !== 'function') return false;
        const cfg = findDatasetConfig(dataset);
        const t = cfg && (cfg.sub_toggles || []).find((x) => x.id === id);
        if (!t) return false;
        if (on !== undefined && !!on !== isSubToggleEnabled(dataset, t)) toggleSubToggle(dataset, id, t);
        if (bias !== undefined) {
            const now = adjustments().find((x) => x.dataset === dataset);
            const r = now && now.rows.find((x) => x.id === id);
            const cur = r ? r.bias : getSubToggleDefaultBias(t);
            adjustSubToggleBias(dataset, id, Number(bias) - cur, t);
        }
        emit('change', { id: 'adjustments' });
        return true;
    }

    // ---- Quick Access: the tag library the desktop's Quick Access window browses
    const ws = () => (window.wsClient && typeof window.wsClient.isConnected === 'function' && window.wsClient.isConnected() ? window.wsClient : null);

    /** A level of the library: { groups: [{ name, label, path, kind: 'groups' | 'tags' | 'main', count, note }], tags: [{ name, label, count }] }. */
    async function tagGroups(path = []) {
        const c = ws();
        if (!c || typeof c.searchDatasetTags !== 'function') return { groups: [], tags: [] };
        const r = await c.searchDatasetTags('*', path);
        const label = (x) => x.prettyName || (String(x.name || '').charAt(0).toUpperCase() + String(x.name || '').slice(1));
        return {
            groups: ((r && r.results) || []).map((x) => ({ name: x.name, label: label(x), path: x.path || path.concat(x.name), kind: x.hasChildren ? 'groups' : (x.isTagArray ? 'tags' : 'main'), count: x.itemCount, note: x.description || '' })),
            tags: ((r && r.mainTags) || []).map((t) => ({ name: t.name, label: t.prettyName || t.name, count: t.itemCount }))
        };
    }

    /** The tags at a leaf of the library (a group of the 'tags' kind; a 'main' group's path + 'main'). */
    async function tagsAt(path) {
        const c = ws();
        if (!c || typeof c.getTagsForPath !== 'function') return [];
        const r = await c.getTagsForPath(path);
        const list = Array.isArray(r) ? r : ((r && r.tags) || []);
        return list.map((t) => (typeof t === 'string' ? t : (t && (t.name || t.tag)) || '')).filter(Boolean);
    }

    /** Tags of the library matching some letters: [{ tag, path }]. */
    async function searchTags(text) {
        const c = ws();
        if (!c || typeof c.searchTags !== 'function' || !String(text || '').trim()) return [];
        const r = await c.searchTags(String(text).trim(), false);
        return ((r && r.results) || []).map((x) => ({ tag: x.tag, path: (x.paths && x.paths[0]) || [] }));
    }

    // ---- the seed box: emptied (and unlocked), or a new random seed in it (the desktop's Clear seed
    // and New seed buttons)
    function clearSeed() {
        if (!ready()) return false;
        if (typeof setSproutSeedLocked === 'function') setSproutSeedLocked(false);
        const f = el('manualSeed');
        if (f && f.value) { f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); }
        emit('change', { id: 'seed' });
        return true;
    }

    /** The seed of the print on show (the preview's), or null. */
    function previewSeed() {
        const v = window.lastGeneratedSeed;
        return v != null && v !== '' ? String(v) : null;
    }

    /** The print on show's seed into the box, kept if the seed was kept (the desktop's Paste seed). */
    async function usePreviewSeed() {
        const v = previewSeed();
        if (!ready() || v == null) return false;
        const btn = el('sproutSeedBtn');
        const locked = !!(btn && btn.getAttribute('data-state') === 'on');
        if (locked && typeof setSproutSeedLocked === 'function') setSproutSeedLocked(true, v);
        else await set('seed', v);
        emit('change', { id: 'seed' });
        return true;
    }

    async function randomSeed() {
        // the desktop's range (presetManager.js New seed): 1 .. 2147483646
        const seed = Math.floor(Math.random() * 2147483646) + 1;
        await set('seed', seed);
        return seed;
    }

    function stop() {
        if (!current || !current.active) return false;
        current.stopped = true;
        if (window.wsClient && typeof window.wsClient.cancelClientImageGeneration === 'function') window.wsClient.cancelClientImageGeneration();
        return true;
    }

    async function select(filename) {
        if (!filename || typeof updateManualPreviewDirectly !== 'function') return false;
        if (previewName() === filename) return true;
        const g = (typeof findImageByFilename === 'function' && findImageByFilename(filename)) || {};
        try {
            // the preview wants the picture's metadata with it (its buttons and "Use Its Settings" read it)
            let metadata = g.metadata || null;
            if (!metadata && typeof getImageMetadata === 'function') metadata = await getImageMetadata(filename);
            if (!metadata) return false;
            await updateManualPreviewDirectly({ filename: g.upscaled || g.original || filename, base: g.base, upscaled: g.upscaled, metadata }, metadata);
        } catch (_) { return false; }
        return previewName() === filename || !!window.currentManualPreviewImage;
    }

    function action(name) {
        const target = el('manualPreviewImage');
        if (!target || typeof handleManualPreviewImageContextMenuAction !== 'function') return false;
        return handleManualPreviewImageContextMenuAction({ detail: { action: name, target, item: { action: name } } });
    }

    const api = {
        ready, snapshot, set, options, tokens, suggest, cost, addCharacter, removeCharacter, setCharacter, presets, sessionName, openPreset, savePreset, setBaseImage, clearBaseImage, setReferences, openPicture, peers, sendTo, getFrom, generate, stop, select, action, on, off,
        datasets, setDataset, adjustments, setAdjustment, clearSeed, randomSeed, previewSeed, usePreviewSeed, tokenLimit, addedTokens, directiveOn, gensoSeeds, setGensoLock, autofillSettings, setAutofillSetting, customSize, setCustomSize, stepRatio, setRatio, cycleArea, tagGroups, tagsAt, searchTags,
        run: () => current,
        prints: () => session.slice(),
        /** A print that was scrapped or deleted leaves this visit's list. */
        forget(filename) {
            const i = session.indexOf(filename);
            if (i >= 0) session.splice(i, 1);
            const j = current ? current.files.indexOf(filename) : -1;
            if (j >= 0) { current.files.splice(j, 1); current.prints = Math.max(1, current.prints - 1); }
        },
        selected: previewName,
        heldPicture,
        generating,
        has,
        stepPreviewSize: null,
        ownsPrints: false,
        /**
         * A part of its own adds functions here (studioModel<Part>.js, #860 migration): extend({ name: fn })
         * - the phone view still reaches Studio only through studioModel. Helpers for those files:
         * _emit(type, detail) tells the views something changed ('change' repaints them), _el(id).
         */
        extend(fns) { Object.keys(fns || {}).forEach((k) => { if (!(k in api)) api[k] = fns[k]; else console.warn('[studioModel] extend: already there', k); }); return api; },
        _emit: (type, detail) => emit(type, detail),
        _el: (id) => el(id)
    };
    window.studioModel = api;
})();
