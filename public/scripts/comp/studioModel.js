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
 *   studioModel.options()               what the lists offer and which controls the chosen model has
 *   studioModel.tokens(text)            token count of a prompt for the chosen model (a promise)
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
       handleManualPreviewImageContextMenuAction */

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

    function snapshot() {
        if (!ready()) return null;
        const p = getStudioParamSnapshot();
        const out = Object.assign({}, p);
        out.model = String(p.model || '').toLowerCase();
        Object.keys(FIELDS).forEach((id) => { const f = el(FIELDS[id][0]); out[id] = f ? f.value : ''; });
        try { out.paid = typeof forcePaidRequest !== 'undefined' && !!forcePaidRequest; } catch (_) { out.paid = false; }
        out.hasBaseImage = !!(window.uploadedImageData || (window.currentEditMetadata && window.currentEditMetadata.sourceFilename && el('manualImg2ImgGroup') && !el('manualImg2ImgGroup').classList.contains('hidden')));
        out.generating = generating();
        return out;
    }

    async function set(id, value) {
        if (!ready()) return false;
        if (FIELDS[id]) {
            const f = el(FIELDS[id][0]);
            if (!f || f.value === String(value == null ? '' : value)) return true;
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
            has: {
                effort,
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
            if (typeof countTokensForText === 'function') return countTokensForText(String(text || ''));
        } catch (_) { /* no tokenizer yet */ }
        return null;
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
        ready, snapshot, set, options, tokens, cost, generate, stop, select, action, on, off,
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
