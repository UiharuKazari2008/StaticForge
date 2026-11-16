/**
 * studioModel part - Refs (#860 migration): the Studio calls DreamStudio's Refs part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 *
 *   refsState()                  every reference as the desktop holds it: { basePreview, precise: [...], vibes: [...],
 *                                normalize, vibeBlock, preciseBlock, reroll, variation }
 *                                (the desktop's own collectors skip the ones switched off; these rows keep them)
 *   setPrecise(key, patch)       { type 1|2|3, strength, fidelity, enabled } on one precise reference
 *   addPrecise(filename)         a gallery picture as a character / style reference (desktop defaults)
 *   removePrecise(key)
 *   setVibe(id, patch)           { ie, strength, enabled, inject } on one vibe transfer
 *   addVibe(id, ie)              a workspace vibe into the session (strength 0.7, the desktop's default)
 *   removeVibe(id)
 *   setNormalizeVibes(on)
 *   workspaceVibes()             the vibes the reference browser lists (Promise)
 *   vibeModels()                 the models a vibe can be encoded for (the desktop's encoding dialog)
 *   encodeVibe({ filename | id, ie, model, comment, add })
 *                                a gallery picture encoded as a vibe (or a vibe's new IE) through the
 *                                server; add: put it into the session after (Promise of { ok, id, message })
 *   addBaseFrom(kind)            'reroll' (Previous Image) / 'variation' (Current Image): the Add menu's rows
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    /* global addPreciseReferenceToContainer, removePreciseReference, syncPreciseTypeToggles, getPreciseTypeTogglePair,
       getPreciseReferenceTypeFromToggles, addVibeReferenceToContainer, removeVibeReference, loadCacheImages, cacheImages,
       getForgeModelFeatures, hasPreciseReferences, getCurrentSelectedModel, localGalleryImageUrl, localCachePreviewUrl,
       wsClient, unifiedUploadSelectedWorkspace, selectTransformation, updateManualPriceDisplay */

    // the desktop's functions are top-level declarations of classic scripts: properties of window
    const fn = (name) => typeof window[name] === 'function';
    const box = () => document.getElementById('vibeReferencesContainer');
    const changed = (id) => { try { if (typeof updateManualPriceDisplay === 'function') updateManualPriceDisplay(); } catch (_) { /* the badge only */ } M._emit('change', { id }); };
    const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };
    const model = () => { try { return String(getCurrentSelectedModel() || '').toLowerCase(); } catch (_) { return String((M.snapshot() || {}).model || '').toLowerCase(); } };
    const caps = () => { try { return (typeof getForgeModelFeatures === 'function' && getForgeModelFeatures()) || {}; } catch (_) { return {}; } };

    // the vibes the workspace knows (the reference browser's list): kept from the last load
    let known = [];
    const knownVibe = (id) => known.find((v) => v.id === id) || null;

    function preciseItems() { const b = box(); return b ? Array.from(b.querySelectorAll('.precise-reference-item')) : []; }
    function vibeItems() { const b = box(); return b ? Array.from(b.querySelectorAll('.vibe-reference-item:not(.precise-reference-item)')) : []; }
    const preciseItem = (key) => preciseItems().find((it) => it.dataset.preciseRefKey === key) || null;
    const vibeItem = (id) => vibeItems().find((it) => it.getAttribute('data-vibe-id') === id) || null;

    // the item's power and text injection buttons are told apart by their glyphs, as collectVibeTransferData does
    const indicator = (item, glyph) => Array.from(item.querySelectorAll('.vibe-reference-controls .indicator')).find((b) => b.querySelector(glyph)) || null;

    function readPrecise(item) {
        const key = item.dataset.preciseRefKey || '';
        const [kind, id] = key.split(/:(.*)/s);
        const [cb, sb] = fn('getPreciseTypeTogglePair') ? getPreciseTypeTogglePair(item) : [null, null];
        const type = cb && sb && fn('getPreciseReferenceTypeFromToggles') ? getPreciseReferenceTypeFromToggles(cb, sb) : (Number(item.dataset.preciseType) || 1);
        const power = indicator(item, '.fa-power-off');
        const img = item.querySelector('img.vibe-reference-preview');
        return {
            key,
            file: kind === 'file' ? id : '',
            preview: img ? img.getAttribute('src') || '' : '',
            type,
            strength: num((item.querySelector('input[data-precise-field="strength"]') || {}).value, 1),
            fidelity: num((item.querySelector('input[data-precise-field="fidelity"]') || {}).value, 1),
            enabled: !power || power.getAttribute('data-state') !== 'off'
        };
    }

    function readVibe(item) {
        const id = item.getAttribute('data-vibe-id') || '';
        const btn = item.querySelector('.custom-dropdown-btn');
        const power = indicator(item, '.fa-power-off');
        const inject = indicator(item, '.fa-indent');
        const img = item.querySelector('img.vibe-reference-preview');
        // the IE values this vibe has for the session's model: the item's own menu lists them
        const ies = Array.from(item.querySelectorAll('.custom-dropdown-menu .custom-dropdown-option[data-ie]')).map((o) => num(o.dataset.ie, 0));
        const ie = btn && btn.dataset.selectedIe != null ? num(btn.dataset.selectedIe, null) : null;
        const v = knownVibe(id);
        return {
            id,
            preview: img ? img.getAttribute('src') || '' : '',
            ie,
            ies,
            // the picked IE is not encoded for this model (the desktop's warning triangle)
            missing: ie == null || !ies.some((x) => Math.abs(x - ie) < 1e-6),
            noEncodings: !!(btn && btn.disabled),
            locked: !!(v && v.locked),
            comment: (v && v.comment) || '',
            strength: num((item.querySelector('input.vibe-reference-ratio-input') || {}).value, 0.7),
            enabled: !power || power.getAttribute('data-state') !== 'off',
            inject: !inject || inject.getAttribute('data-state') !== 'off'
        };
    }

    /** Why a vibe cannot be added now ('' = it can): the desktop's own refusals, in its words. */
    function vibeBlock() {
        if (window.currentMaskData) return 'Vibe transfers are disabled during inpainting.';
        if (caps().vibeTransfer === false) return 'Vibe transfer is not supported on this model.';
        if (fn('hasPreciseReferences') && hasPreciseReferences()) return 'Remove precise references before adding vibe transfers.';
        return '';
    }

    function preciseBlock() {
        if (caps().preciseReference === false) return 'Character / style reference is not supported on this model.';
        if (preciseItems().length >= 6) return 'Maximum 6 precise references allowed.';
        return '';
    }

    // Previous Image / Current Image: shown on the desktop's Add menu under these conditions (renderAddItemDropdown)
    function baseChoices() {
        const img = window.currentEditImage;
        const meta = window.currentEditMetadata;
        const valid = !!(img && meta);
        return {
            reroll: !!(valid && meta.base_image === true && meta.image_source),
            variation: !!(valid && (meta.original_filename || img.filename || img.original))
        };
    }

    function refsState() {
        const norm = document.getElementById('vibeNormalizeToggle');
        const b = baseChoices();
        // the base image as the desktop shows it (an upload or a cache picture has no gallery name)
        const pic = M._el('manualVariationImage');
        const src = pic ? pic.getAttribute('src') || '' : '';
        return {
            basePreview: src && !/background\.jpg$/.test(src) ? src : '',
            precise: preciseItems().map(readPrecise),
            vibes: vibeItems().map(readVibe),
            normalize: !norm || norm.getAttribute('data-state') === 'on',
            vibeBlock: vibeBlock(),
            preciseBlock: preciseBlock(),
            reroll: b.reroll,
            variation: b.variation
        };
    }

    // a number field of the desktop's item: set and announced, as typing into it would be
    function setInput(input, value, digits) {
        if (!input) return;
        input.value = Number(value).toFixed(digits);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function setIndicator(btn, on) {
        if (btn && (btn.getAttribute('data-state') !== 'off') !== !!on) btn.click();
    }

    function setPrecise(key, patch = {}) {
        const item = preciseItem(key);
        if (!item) return false;
        const clamp = (v) => Math.max(0, Math.min(1, num(v, 1)));
        if (patch.strength != null) setInput(item.querySelector('input[data-precise-field="strength"]'), clamp(patch.strength), 2);
        if (patch.fidelity != null) setInput(item.querySelector('input[data-precise-field="fidelity"]'), clamp(patch.fidelity), 2);
        if (patch.type != null && fn('syncPreciseTypeToggles')) syncPreciseTypeToggles(item, patch.type === 2 || patch.type === 3 ? patch.type : 1);
        if (patch.enabled != null) setIndicator(indicator(item, '.fa-power-off'), patch.enabled);
        changed('references');
        return true;
    }

    async function addPrecise(filename) {
        if (!filename || !fn('addPreciseReferenceToContainer')) return { ok: false, message: 'Studio is not ready.' };
        const why = preciseBlock();
        if (why) return { ok: false, message: why };
        const key = `file:${filename}`;
        if (preciseItem(key)) return { ok: false, message: 'Precise reference already added.' };
        const url = typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(filename) : `/images/${encodeURIComponent(filename)}`;
        // the desktop's defaults: character and style, strength 1, fidelity 1 (it drops the session's vibes, as there)
        await addPreciseReferenceToContainer({ type: 'file', id: filename, url, filename }, {});
        changed('references');
        return { ok: !!preciseItem(key), message: '' };
    }

    function removePrecise(key) {
        if (!fn('removePreciseReference')) return false;
        removePreciseReference(key);
        changed('references');
        return true;
    }

    function setVibe(id, patch = {}) {
        const item = vibeItem(id);
        if (!item) return false;
        if (patch.strength != null) setInput(item.querySelector('input.vibe-reference-ratio-input'), Math.max(-1, Math.min(1, num(patch.strength, 0.7))), 2);
        if (patch.ie != null) {
            // the item's own menu option: it rewrites the button and its data as a pick there does
            const opt = Array.from(item.querySelectorAll('.custom-dropdown-menu .custom-dropdown-option[data-ie]')).find((o) => Math.abs(num(o.dataset.ie, -1) - patch.ie) < 1e-6);
            if (opt) opt.click();
        }
        if (patch.enabled != null) setIndicator(indicator(item, '.fa-power-off'), patch.enabled);
        if (patch.inject != null) setIndicator(indicator(item, '.fa-indent'), patch.inject);
        changed('vibes');
        return true;
    }

    async function addVibe(id, ie, strength = 0.7) {
        if (!id || !fn('addVibeReferenceToContainer')) return { ok: false, message: 'Studio is not ready.' };
        const why = vibeBlock();
        if (why) return { ok: false, message: why };
        if (vibeItem(id)) return { ok: false, message: 'This vibe is already in the session.' };
        await addVibeReferenceToContainer(id, ie == null ? 'default' : ie, strength);
        changed('vibes');
        return { ok: !!vibeItem(id), message: vibeItem(id) ? '' : 'The vibe could not be added.' };
    }

    function removeVibe(id) {
        if (!fn('removeVibeReference')) return false;
        removeVibeReference(id);
        changed('vibes');
        return true;
    }

    function setNormalizeVibes(on) {
        const t = document.getElementById('vibeNormalizeToggle');
        if (!t) return false;
        t.setAttribute('data-state', on ? 'on' : 'off');
        changed('vibes');
        return true;
    }

    async function workspaceVibes() {
        if (!fn('loadCacheImages')) return [];
        try { await loadCacheImages(); } catch (_) { return known; }
        const m = model();
        const list = [];
        const seen = new Set();
        (typeof cacheImages !== 'undefined' && Array.isArray(cacheImages) ? cacheImages : []).forEach((img) => (img.vibes || []).forEach((v) => {
            if (!v || !v.id || seen.has(v.id)) return;
            seen.add(v.id);
            const enc = (v.encodings || []).map((e) => ({ model: String(e.model || '').toLowerCase(), ie: num(e.informationExtraction, 0) }));
            list.push({
                id: v.id,
                preview: v.preview && typeof localCachePreviewUrl === 'function' ? localCachePreviewUrl(v.preview) : '',
                ies: enc.filter((e) => e.model === m).map((e) => e.ie).sort((a, b) => a - b),
                encoded: enc.length > 0,
                locked: !!v.locked,
                comment: v.comment || '',
                workspaceId: v.workspaceId || img.workspaceId || ''
            });
        }));
        known = list;
        return list;
    }

    /** The desktop encoding dialog's model list: V4 and later that take vibes (V5 does not), V4.5 first. */
    function vibeModels() {
        const models = (window.optionsData && window.optionsData.models) || {};
        return Object.entries(models)
            .filter(([key]) => { const k = key.toLowerCase(); return !k.startsWith('v5') && (k.includes('v4') || k.includes('kayra') || k.includes('opus')); })
            .sort((a, b) => {
                const ak = a[0].toLowerCase(); const bk = b[0].toLowerCase();
                if (ak.includes('v4_5')) return -1;
                if (bk.includes('v4_5')) return 1;
                if (ak.includes('v4')) return -1;
                if (bk.includes('v4')) return 1;
                return String(a[1]).localeCompare(String(b[1]));
            })
            .map(([value, name]) => ({ value, name: String(name) }));
    }

    function toBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] || '');
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    async function encodeVibe({ filename = '', id = '', ie = 0.35, model: forModel = '', comment = '', add = true } = {}) {
        if (typeof wsClient === 'undefined' || !wsClient || typeof wsClient.encodeVibe !== 'function') return { ok: false, message: 'Not connected.' };
        const target = forModel || model();
        const params = { informationExtraction: num(ie, 0.35), model: target };
        try {
            if (id) {
                // a new IE for a vibe the workspace has: the vibe's own workspace (the desktop's 'ie' mode)
                params.id = id;
                const v = knownVibe(id);
                if (v && v.workspaceId) params.workspace = v.workspaceId;
            } else {
                // a gallery picture: its bytes, as the gallery's "add as vibe transfer" sends them
                const url = typeof localGalleryImageUrl === 'function' ? localGalleryImageUrl(filename) : `/images/${encodeURIComponent(filename)}`;
                const res = await fetch(url);
                if (!res.ok) return { ok: false, message: `The picture could not be read (${res.status}).` };
                params.image = await toBase64(await res.blob());
                params.workspace = typeof unifiedUploadSelectedWorkspace !== 'undefined' ? unifiedUploadSelectedWorkspace : undefined;
                params.comment = comment || null;
            }
            const response = await wsClient.encodeVibe(params);
            if (!response || !response.success) return { ok: false, message: (response && response.message) || 'Failed to process vibe encoding.' };
            const vid = (response.vibeData && response.vibeData.id) || id;
            await workspaceVibes();
            if (id) {
                // the session's item was built with the old encodings: built again with the new IE picked
                const old = vibeItem(id);
                if (old) {
                    const was = readVibe(old);
                    removeVibeReference(id);
                    await addVibeReferenceToContainer(id, params.informationExtraction, was.strength, was.inject ? 'on' : 'off');
                    if (!was.enabled) setVibe(id, { enabled: false });
                }
            } else if (add && vid) {
                const r = await addVibe(vid, params.informationExtraction);
                if (!r.ok) return { ok: false, id: vid, message: r.message };
            }
            changed('vibes');
            return { ok: true, id: vid, message: '' };
        } catch (err) {
            return { ok: false, message: (err && err.message) || String(err) };
        }
    }

    function addBaseFrom(kind) {
        if ((kind !== 'reroll' && kind !== 'variation') || !fn('selectTransformation')) return false;
        if (!baseChoices()[kind]) return false;
        selectTransformation(kind);
        // the base image is set up a moment later (its size is read from the picture first)
        setTimeout(() => changed('baseImage'), 400);
        return true;
    }

    M.extend({ refsState, setPrecise, addPrecise, removePrecise, setVibe, addVibe, removeVibe, setNormalizeVibes, workspaceVibes, vibeModels, encodeVibe, addBaseFrom });
})();
