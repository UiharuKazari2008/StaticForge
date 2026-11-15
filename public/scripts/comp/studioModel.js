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
 *   studioModel.tokens(text)            token count of a prompt for the chosen model (a promise)
 *   studioModel.suggest(text)            tag suggestions for a few typed letters: [{ text, count }] (a promise)
 *   studioModel.cost()                  Anlas the next Generate would ask for (0 = free)
 *   studioModel.generate()              one Generate; resolves when it is over (done, failed or stopped)
 *   studioModel.stop()                  give up the print in hand
 *   studioModel.run()                   the generation in hand, or the last one: { active, phase, step,
 *                                       steps, print, prints, frame, files[] }
 *   studioModel.prints()                this visit's finished prints, oldest first (file names)
 *   studioModel.forget(filename)        drop a print from that list (it was scrapped or deleted)
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
       loadPreciseReferencesFromMetadata, updateManualPriceDisplay, datasetAllowedForModel, getStudioUcPresetMenuItems */

    const FIELDS = { prompt: ['manualPrompt', 'prompt'], uc: ['manualUc', 'uc'], negative: ['manualPromptNegative', 'promptNegative'] };
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
            writeStudioFieldValue(FIELDS[id][1], value);
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
            models: (typeof modelGroups !== 'undefined' ? modelGroups : []).map((g) => ({ group: g.group, options: g.options.map((o) => ({ value: o.value, name: o.name })) })),
            samplers: (typeof SAMPLER_MAP !== 'undefined' ? SAMPLER_MAP : []).map((s) => ({ value: s.meta, name: s.display })),
            noise: (typeof NOISE_MAP !== 'undefined' ? NOISE_MAP : []).map((s) => ({ value: s.meta, name: s.display })),
            resolutions: (typeof RESOLUTION_GROUPS !== 'undefined' ? RESOLUTION_GROUPS : []).map((g) => ({ group: g.group, options: g.options.map((o) => ({ value: o.value, name: o.name || o.display || o.value })) })),
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

    function wireSuggest() {
        if (suggestWired || typeof window.handleSearchResponse !== 'function') return suggestWired;
        suggestWired = true;
        const orig = window.handleSearchResponse;
        window.handleSearchResponse = function (message) {
            if (!message || message.autofillSessionId !== SUGGEST_SESSION) return orig.apply(this, arguments);
            if (message.type !== 'search_characters_complete') return undefined;
            const done = suggestWaiting.get(message.requestId);
            if (!done) return undefined;
            suggestWaiting.delete(message.requestId);
            const seen = new Set();
            const out = [];
            ((message.data && message.data.results) || []).forEach((r) => {
                const text = r && typeof r.tag === 'string' ? r.tag.trim() : '';
                if (!text || seen.has(text.toLowerCase())) return;
                seen.add(text.toLowerCase());
                out.push({ text, count: Number(r.count) || 0 });
            });
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
            setTimeout(() => { if (suggestWaiting.delete(requestId)) resolve([]); }, 6000);
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

    function frameSrc(d) {
        const frames = Array.isArray(d.stepFrames) ? d.stepFrames : null;
        const last = frames && frames.length ? frames[frames.length - 1] : d;
        if (!last || !last.imageData) return '';
        return `data:${last.imageFormat === 'png' ? 'image/png' : 'image/jpeg'};base64,${last.imageData}`;
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
                const src = frameSrc(d);
                if (src) current.frame = src;
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

    async function generate() {
        if (!ready() || generating() || (current && current.active)) return current;
        wire();
        const before = previewName();
        const run = { active: true, phase: 'starting', step: 0, steps: 0, print: 1, prints: (snapshot() || {}).n || 1, frame: '', files: [], stopped: false, error: '' };
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
        generating,
        has,
        stepPreviewSize: null,
        ownsPrints: false
    };
    window.studioModel = api;
})();
