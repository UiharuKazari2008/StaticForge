/**
 * studioModel part - Print (#860 migration): the Studio calls DreamStudio's Print part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 *
 *   studioModel.selectFull(filename)     select() with the gallery's original / upscaled pair passed
 *                                        to the preview (select leaves `original` out, so the
 *                                        desktop's Original rows and Enhance's Max saw no pair)
 *   studioModel.printItem(filename)      the gallery's record of a print ({ filename, original,
 *                                        upscaled, width, height, isPinned ... }) or { filename }
 *   studioModel.originalOf(filename)     the un-upscaled original kept beside an upscaled print, or ''
 *   studioModel.originalAction(f, act)   'copy' | 'expand' on that original (the desktop's own
 *                                        handlers); deleteOriginal(f) removes it (the caller asks first)
 *   studioModel.enhanceOptions(f)        the desktop Enhance dialog's choices and defaults: dims,
 *                                        scales, scale, magnitude, presets (magnitude -> strength /
 *                                        noise), upscale scales, deliveries, samplers, noise
 *                                        schedulers, models; printMeta(f) what blank values inherit
 *   studioModel.enhance(f, values)       runs it (runEnhanceImageRequest: spends Anlas on NovelAI)
 *   studioModel.compareState() / compareDo(action, value) / compareSplit(pct)
 *                                        the desktop's comparison (compareViewManager.js): its source,
 *                                        modes and overlay settings, its own menu actions
 *   studioModel.moveTargets() / movePrint(f, workspaceId)
 *                                        the gallery's Move to... (the other workspaces)
 *   studioModel.copyPicture(f)           the gallery's Copy (the picture to the clipboard)
 *   studioModel.history(offset, count)   the workspace gallery's prints, newest first (the desktop's
 *                                        own list): { total, rows: [{ filename, mtime, width, height }] }
 *   studioModel.savePicture(base64, name) a picture (PNG data) into the workspace's gallery
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    /* global findImageByFilename, updateManualPreviewDirectly, getImageMetadata, galleryUnupscaledOriginalFilename,
       galleryImageAsUnupscaledOriginal, handleUnupscaledOriginalContextAction, applyUnupscaledOriginalRemoved,
       getEnhanceScaleOptions, resolveEnhanceScaleValue, getEnhancePreset, getEnhanceSourceDimensions,
       buildEnhanceRequestValues, runEnhanceImageRequest, upscaleScaleChoices, knownLocalUpscaleStatus,
       fetchLocalUpscaleModels, slowDeliveryHint, MAGNITUDE_PRESETS, modelGroups, SAMPLER_MAP, NOISE_MAP,
       lastEnhanceScale, compareSourceImageData, compareOverlayEnabled, compareSlideEnabled, compareRuntimeSettings,
       compareSplitPosition, COMPARE_COLOR_FILTERS, COMPARE_BLEND_MENU, COMPARE_COLOR_MENU, handleCompareContextMenuAction,
       setCompareSplitPosition, hasCompareSavedDefaults, getCompareAutoEnableState, isPreviewSameAsCompareSource,
       compareMenuCurrentPreviewInfo, moveGalleryImagesToWorkspace, removeImageFromGallery, copyImageToClipboard,
       workspaces, activeWorkspace, allImages, localGalleryImageUrl, getForgeModelFeatures */

    const fn = (name) => typeof window[name] === 'function';
    const safe = (f, d) => { try { return f(); } catch (_) { return d; } };

    function printItem(filename) {
        if (!filename) return null;
        const g = fn('findImageByFilename') ? findImageByFilename(filename) : null;
        return g || { filename };
    }

    /** select() with the original / upscaled pair: the preview knows the print has an original. */
    async function selectFull(filename) {
        if (!filename || !fn('updateManualPreviewDirectly')) return false;
        const g = printItem(filename);
        const cur = window.currentManualPreviewImage;
        const same = M.selected() === filename && cur;
        // already shown with its pair (or the print has none)
        if (same && (!g.original || cur.original === g.original)) return true;
        try {
            let metadata = g.metadata || (same && cur.metadata) || null;
            if (!metadata && fn('getImageMetadata')) metadata = await getImageMetadata(filename);
            if (!metadata) return false;
            await updateManualPreviewDirectly({ filename: g.upscaled || g.original || filename, original: g.original, base: g.base, upscaled: g.upscaled, width: g.width, height: g.height, metadata }, metadata);
        } catch (_) { return false; }
        M._emit('change', { id: 'preview' });
        return !!window.currentManualPreviewImage;
    }

    function originalOf(filename) {
        const g = printItem(filename);
        return (g && fn('galleryUnupscaledOriginalFilename') && galleryUnupscaledOriginalFilename(g)) || '';
    }

    async function originalAction(filename, act) {
        const g = printItem(filename);
        if (!originalOf(filename) || !fn('handleUnupscaledOriginalContextAction')) return false;
        if (!(await selectFull(filename))) return false;
        const map = { copy: 'copy-original', expand: 'expand-canvas-original' };
        if (!map[act]) return false;
        return !!handleUnupscaledOriginalContextAction(map[act], window.currentManualPreviewImage || g, null);
    }

    /** The desktop's Incinerate (original) without its own question: the phone asked already. */
    async function deleteOriginal(filename) {
        const orig = originalOf(filename);
        const c = window.wsClient;
        if (!orig || !c || typeof c.deleteUnupscaledOriginal !== 'function') return false;
        const g = printItem(filename);
        const res = await c.deleteUnupscaledOriginal(orig);
        if (fn('applyUnupscaledOriginalRemoved')) applyUnupscaledOriginalRemoved(orig, (res && res.upscaledFilename) || g.upscaled);
        M._emit('change', { id: 'preview' });
        return true;
    }

    // ---- Enhance: the desktop dialog's (imageExpansion.js openEnhanceModal) choices and defaults

    function enhanceOptions(filename) {
        const g = printItem(filename);
        const scales = fn('getEnhanceScaleOptions') ? getEnhanceScaleOptions(g) : [{ value: '1', name: '1x' }, { value: '1.5', name: '1.5x' }, { value: '2', name: '2x' }];
        const preset = fn('getEnhancePreset') ? getEnhancePreset() : { magnitude: 3, scale: '' };
        const last = typeof lastEnhanceScale !== 'undefined' ? lastEnhanceScale : null;
        const scale = fn('resolveEnhanceScaleValue') ? resolveEnhanceScaleValue(scales, preset.scale, last) : '2';
        const mag = Number(preset.magnitude);
        const status = fn('knownLocalUpscaleStatus') ? knownLocalUpscaleStatus() : null;
        if (!status && fn('fetchLocalUpscaleModels')) safe(() => fetchLocalUpscaleModels(), null);
        const caps = fn('getForgeModelFeatures') ? safe(() => getForgeModelFeatures(), null) : null;
        return {
            filename: (g && (g.upscaled || g.original || g.filename)) || filename,
            dims: fn('getEnhanceSourceDimensions') ? getEnhanceSourceDimensions(g) : null,
            // the desktop's names use the multiplication sign; the phone's keyboard-only text an x
            scales: scales.map((o) => ({ value: String(o.value), name: String(o.name).replace(/×/g, 'x') })),
            scale,
            magnitude: Number.isFinite(mag) ? mag : 3,
            presets: typeof MAGNITUDE_PRESETS !== 'undefined' ? MAGNITUDE_PRESETS : {},
            upscaleScales: fn('upscaleScaleChoices') ? upscaleScaleChoices(status) : [2, 4],
            deliveries: [['instant', 'Instant (NovelAI)'], ['fast', 'Fast'], ['slow', 'Slow']],
            slowHint: fn('slowDeliveryHint') ? slowDeliveryHint(status) : '',
            samplers: (typeof SAMPLER_MAP !== 'undefined' ? SAMPLER_MAP : []).map((x) => [x.meta, x.display]),
            noise: (typeof NOISE_MAP !== 'undefined' ? NOISE_MAP : []).map((x) => [x.meta, x.display]),
            // the desktop hides Noise Scheduler where the model has none (updateV3ModelVisibility)
            hasNoise: !(caps && caps.noiseScheduleUi === false),
            models: (typeof modelGroups !== 'undefined' ? modelGroups : []).reduce((out, gr) => out.concat(gr.options.map((o) => [o.value, o.name])), [])
        };
    }

    /**
     * What Enhance inherits when a value is left blank: the print's own settings (its metadata):
     * { steps, guidance, rescale, sampler, noiseScheduler, model }, or null.
     */
    async function printMeta(filename) {
        const g = printItem(filename);
        let m = g && g.metadata;
        if (!m && fn('getImageMetadata')) m = await safe(() => getImageMetadata(filename), null);
        if (!m) return null;
        const n = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
        return { steps: n(m.steps), guidance: n(m.scale != null ? m.scale : m.guidance), rescale: n(m.cfg_rescale != null ? m.cfg_rescale : m.rescale), sampler: m.sampler || '', noiseScheduler: m.noise_schedule || '', model: String(m.model || '').toLowerCase() };
    }

    /** The magnitude preset nearest to m: { strength, noise } (the desktop's nearestEnhanceMagnitudePreset). */
    function magnitudePreset(m) {
        const P = typeof MAGNITUDE_PRESETS !== 'undefined' ? MAGNITUDE_PRESETS : {};
        const keys = Object.keys(P).map(Number).filter(Number.isFinite);
        if (!keys.length) return { strength: 0.5, noise: 0 };
        const n = Number(m);
        let best = keys[0];
        keys.forEach((k) => { if (Math.abs(k - n) < Math.abs(best - n)) best = k; });
        return P[best];
    }

    /**
     * Runs the desktop's Enhance with the phone dialog's values: { scale, magnitude, strength?,
     * noise?, steps?, guidance?, rescale?, seed?, sampler?, noiseScheduler?, model?, speed, localScale }.
     */
    function enhance(filename, v) {
        if (!fn('runEnhanceImageRequest') || !fn('buildEnhanceRequestValues')) return Promise.resolve(null);
        const extra = {};
        ['steps', 'guidance', 'rescale', 'seed'].forEach((k) => { if (v[k] != null && v[k] !== '' && Number.isFinite(Number(v[k]))) extra[k] = Number(v[k]); });
        ['sampler', 'noiseScheduler', 'model'].forEach((k) => { if (v[k]) extra[k] = v[k]; });
        if (v.speed === 'fast' || v.speed === 'slow') {
            extra.upscaler = 'local';
            extra.backend = 'local';
            extra.upscaleSpeed = v.speed;
            extra.localUpscaleScale = Number(v.localScale) === 2 ? 2 : (Number(v.localScale) || 4);
        }
        const values = buildEnhanceRequestValues({
            scale: v.scale,
            magnitude: Number(v.magnitude).toFixed(1),
            strengthRaw: v.strength == null ? '' : String(v.strength),
            noiseRaw: v.noise == null ? '' : String(v.noise),
            extra
        });
        return Promise.resolve(runEnhanceImageRequest(filename, values)).then((r) => { M._emit('change', { id: 'preview' }); return r; });
    }

    // ---- Comparison: the desktop's state, read and changed through its own menu actions

    function compareState() {
        const src = typeof compareSourceImageData !== 'undefined' ? compareSourceImageData : null;
        const rt = typeof compareRuntimeSettings !== 'undefined' ? compareRuntimeSettings : {};
        const has = !!(src && src.url);
        return {
            has,
            url: has ? src.url : '',
            file: has ? (src.chainSourceFile || '') : '',
            overlay: has && typeof compareOverlayEnabled !== 'undefined' && !!compareOverlayEnabled,
            slide: has && typeof compareSlideEnabled !== 'undefined' && !!compareSlideEnabled,
            split: typeof compareSplitPosition !== 'undefined' ? Number(compareSplitPosition) : 50,
            opacity: Number(rt.overlayOpacity) || 50,
            blend: rt.blendMode || 'normal',
            sourceColor: rt.sourceColor || 'none',
            resultColor: rt.generationColor || 'none',
            priority: rt.priority === 'generation' ? 'generation' : 'source',
            filters: typeof COMPARE_COLOR_FILTERS !== 'undefined' ? COMPARE_COLOR_FILTERS : {},
            blends: typeof COMPARE_BLEND_MENU !== 'undefined' ? COMPARE_BLEND_MENU.map((e) => (e.separator ? '-' : [e.id, e.label])) : [],
            colors: typeof COMPARE_COLOR_MENU !== 'undefined' ? COMPARE_COLOR_MENU.map((e) => [e.id, e.tooltip]) : [],
            opacities: [15, 25, 50, 75, 85],
            canEnable: fn('compareMenuCurrentPreviewInfo') ? !!safe(() => compareMenuCurrentPreviewInfo(), null) : false,
            savedDefaults: fn('hasCompareSavedDefaults') ? !!safe(() => hasCompareSavedDefaults(), false) : false,
            autoEnable: fn('getCompareAutoEnableState') ? !!safe(() => getCompareAutoEnableState(), false) : false
        };
    }

    /** One of the desktop comparison menu's actions ('compareEnable', 'compareToggleSlide', 'setCompareOpacity' ...). */
    function compareDo(action, value) {
        if (!fn('handleCompareContextMenuAction')) return false;
        try { handleCompareContextMenuAction(action, null, { action, value }); } catch (err) { console.warn('[studioModel] compare', action, err); return false; }
        M._emit('change', { id: 'compare' });
        return true;
    }

    function compareSplit(pct) {
        if (fn('setCompareSplitPosition')) setCompareSplitPosition(pct);
    }

    // ---- the gallery's own actions on one print

    function moveTargets() {
        const all = typeof workspaces !== 'undefined' ? workspaces : (window.workspaces || {});
        const here = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
        return Object.values(all || {}).filter((w) => w && w.id !== here).sort((a, b) => (a.sort || 0) - (b.sort || 0)).map((w) => ({ id: w.id, name: w.name || w.id }));
    }

    async function movePrint(filename, workspaceId) {
        if (!fn('moveGalleryImagesToWorkspace') || !window.wsClient || !window.wsClient.isConnected()) return false;
        const g = printItem(filename);
        const ok = await moveGalleryImagesToWorkspace([filename], workspaceId);
        if (ok && fn('removeImageFromGallery') && g && g.mtime != null) safe(() => removeImageFromGallery(g), null);
        if (ok && typeof M.forget === 'function') M.forget(filename);
        M._emit('change', { id: 'preview' });
        return !!ok;
    }

    function copyPicture(filename) {
        if (!fn('copyImageToClipboard')) return false;
        copyImageToClipboard(printItem(filename));
        return true;
    }

    function history(offset = 0, count = 40) {
        const list = (typeof allImages !== 'undefined' && Array.isArray(allImages)) ? allImages : [];
        const sorted = list.filter((g) => g && (g.filename || g.original)).slice().sort((a, b) => (Number(b.mtime) || 0) - (Number(a.mtime) || 0));
        return {
            total: sorted.length,
            rows: sorted.slice(offset, offset + count).map((g) => ({ filename: g.filename || g.upscaled || g.original, mtime: Number(g.mtime) || 0, width: g.width || 0, height: g.height || 0, upscaled: !!(g.upscaled && g.original && g.upscaled !== g.original), pinned: !!g.isPinned }))
        };
    }

    /** A PNG (base64, no data: prefix) into the workspace's gallery, as Paint's Save to Gallery does. */
    async function savePicture(base64, name) {
        const c = window.wsClient;
        if (!c || typeof c.uploadWorkspaceImage !== 'function') throw new Error('The server is not connected.');
        const ws = typeof activeWorkspace !== 'undefined' ? activeWorkspace : 'default';
        const res = await c.uploadWorkspaceImage(base64, ws, name, { currentIndex: 0, totalCount: 1 });
        if (!res || res.success === false) throw new Error((res && res.error) || 'The gallery did not take the picture.');
        return res;
    }

    function galleryUrl(filename) {
        return typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(filename) : `/images/${encodeURIComponent(filename)}`;
    }

    /**
     * The session as a request a shortcut keeps: the desktop's Studio change payload (the same
     * builders as Edit > Copy Change JSON and its desktop 'studio-change' shortcut), or null.
     */
    function requestPayload() {
        /* global buildExportOpsFromStudio, buildPayloadFromOps, attachStudioSeedEcho, applyStudioChangePayloadSilent */
        if (!fn('buildExportOpsFromStudio') || !fn('buildPayloadFromOps')) return null;
        try {
            const ops = buildExportOpsFromStudio();
            if (!ops || !ops.length) return null;
            const payload = buildPayloadFromOps(ops, '');
            return fn('attachStudioSeedEcho') ? attachStudioSeedEcho(payload) : payload;
        } catch (err) { console.warn('[studioModel] request', err); return null; }
    }

    /** A kept request back into Studio (the desktop shortcut's Apply to Studio). */
    async function applyRequest(payload) {
        // the silent apply: the desktop's own (with its row list) is a Vista dialog the phone does not show
        if (!payload || !fn('applyStudioChangePayloadSilent')) return false;
        await applyStudioChangePayloadSilent(payload, { source: 'manual' });
        M._emit('change', { id: null, from: 'request' });
        return true;
    }

    M.extend({ selectFull, printItem, originalOf, originalAction, deleteOriginal, enhanceOptions, printMeta, magnitudePreset, enhance, compareState, compareDo, compareSplit, moveTargets, movePrint, copyPicture, history, savePicture, galleryUrl, requestPayload, applyRequest });
})();
