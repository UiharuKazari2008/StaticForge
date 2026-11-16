/**
 * studioModel part - Stages (#860 migration): the Studio calls DreamStudio's Stages part needs, added
 * with studioModel.extend. Only this file touches the desktop form for them.
 *
 *   studioModel.stageTypes()                 Add > Pipeline Stage's rows as the desktop lists them (Max
 *                                            Enhance only where the model has it)
 *   studioModel.stages() / stage(id)         the stage list / one stage: its type, name, toggles and values
 *                                            (an empty value is inherited: .inherited names it)
 *   studioModel.addStage(key) / removeStage(id) / moveStage(id, dir) / removeAllStages()
 *   studioModel.hasRemovableStages()         Remove All Stages has something to remove (managed ones stay)
 *   studioModel.stageToggle(id, name)        one of the stage's buttons, as a click on the desktop's own
 *                                            (upscale, saveResults, lockPrompt, branch, stop, inset,
 *                                            useBaseImage, inheritSeed, autoSeed, variety, bgFocus, reset)
 *   studioModel.stageSet(id, key, value)     a number or text: level, strength, noise, steps, guidance,
 *                                            rescale, seed, directive ('' / null = inherit)
 *   studioModel.stageMenu(id, kind) / stagePick(id, kind, index)
 *                                            the desktop's own list for resolution | bias | model | sampler,
 *                                            and a pick from it (the desktop's option is clicked)
 *   studioModel.stageSizeStep(id, 'width' | 'height', dir) / stageAreaToggle(id)
 *                                            a custom stage size, stepped along the legal sizes as the
 *                                            desktop's arrow keys do; its Normal / Large area limit
 *   studioModel.generateStageRows() / generateStage(index)
 *                                            Generate Stage's rows (Stage 0 = the base) / one run to that stage
 *   studioModel.stageResultsAvailable() / loadStageResults() / stageResults() / stageResultAction(i, action)
 *                                            Stage Results: whether there is a chain to show, fill the list
 *                                            (the desktop window stays shut), its items, a picture action
 *   studioModel.positions() / setAutoPosition(on) / setPosition(i, x, y, cell) / setPositions([{x, y}])
 *   studioModel.clearPositions() / revertPositions() / applyReturnedPositions()
 *                                            character positions: the 5 x 5 grid (V4) or the free centers (V5)
 *   studioModel.characterDirective(i) / setCharacterDirective(i, text)
 *                                            a character's line of the Creative Directive (Rentan)
 */
(function () {
    'use strict';
    const M = window.studioModel;
    if (!M || typeof M.extend !== 'function') return;

    /* global STAGE_TYPES, pipelineStagesContainer, addPipelineStage, deletePipelineStage, movePipelineStageUp,
       movePipelineStageDown, studioRemoveAllStages, studioHasRemovableStages, getPipelineStages, getPipelineStageMenuLabel, getPipelineStageDefaultTypeName,
       getStageInheritedValues, getForgeModelFeatures, renderStageResolutionDropdown, renderStageBiasDropdown,
       renderStageModelDropdown, renderStageSamplerDropdown, toggleStageBackgroundFocus, getGenerateStageMenuItems,
       handleManualGeneration, isGenerating, stageResultsReviewManager, characterPromptsContainer,
       setCharacterPromptPosition, clearCharacterPromptPositions, getOccupiedPositionCellLabels,
       characterPositionToolManager, getDimensionsFromResolution, isV5Model, isCustomResolutionMode, mediumControlIsLocked, activeMediumLock, SAMPLER_MAP */

    const el = (id) => document.getElementById(id);
    const has = (name) => typeof window[name] === 'function';
    const emit = (id) => M._emit('change', { id });
    const items = () => Array.from((typeof pipelineStagesContainer !== 'undefined' && pipelineStagesContainer && pipelineStagesContainer.querySelectorAll('.pipeline-stage-item')) || []);
    const on = (node) => !!node && node.dataset.state === 'on';
    const hidden = (node) => !node || node.classList.contains('hidden');

    // ---- Add > Pipeline Stage (imageGenerationSettings.js getStudioAddMenuItems: same rows, same order)
    function stageTypes() {
        if (typeof STAGE_TYPES === 'undefined') return [];
        const rows = [{ key: 'expand', label: 'Expand Canvas', icon: 'mdi mdi-relative-scale' }];
        let maxEnhance = false;
        try { maxEnhance = !!(has('getForgeModelFeatures') && getForgeModelFeatures() && getForgeModelFeatures().maxEnhance); } catch (_) { /* before the models */ }
        if (maxEnhance) rows.push({ key: 'maxenhance', label: 'Max Enhance', icon: 'fas fa-wand-magic-sparkles' });
        rows.push({ key: 'enhance', label: 'Enhance', icon: 'fas fa-diagram-venn' }, { key: 'variation', label: 'Variation', icon: 'ri-image-ai-fill' });
        return rows;
    }

    function addStage(key) {
        if (!has('addPipelineStage') || typeof STAGE_TYPES === 'undefined') return null;
        if (key === 'expand') addPipelineStage(STAGE_TYPES.EXPAND_CANVAS, { useBaseImage: false, maxEnhance: false });
        else addPipelineStage(STAGE_TYPES.VARIATION, { useBaseImage: key !== 'variation', maxEnhance: key === 'maxenhance' });
        emit('stages');
        const list = items();
        return list.length ? list[list.length - 1].id : null;
    }

    function removeStage(id) {
        if (!has('deletePipelineStage')) return;
        deletePipelineStage(id);
        emit('stages');
    }

    function moveStage(id, dir) {
        if (dir < 0 && has('movePipelineStageUp')) movePipelineStageUp(id);
        else if (dir > 0 && has('movePipelineStageDown')) movePipelineStageDown(id);
        emit('stages');
    }

    function removeAllStages() {
        if (has('studioRemoveAllStages')) studioRemoveAllStages();
        emit('stages');
    }

    const hasRemovableStages = () => (has('studioHasRemovableStages') ? !!studioHasRemovableStages() : false);

    // ---- one stage, as plain data

    const TOGGLES = ['upscale', 'saveResults', 'lockPrompt', 'branch', 'stop'];

    function stage(id) {
        const item = el(id);
        if (!item) return null;
        const list = items();
        const index = list.indexOf(item) + 1;
        let label = { text: `Stage ${index}`, hex: '', icon: 'fas fa-layer-group' };
        try { if (has('getPipelineStageMenuLabel')) label = getPipelineStageMenuLabel(index); } catch (_) { /* the plain name */ }
        // the stage's own name, else its type's (the card's header; the menu label leaves the type out)
        let typeName = '';
        try { typeName = has('getPipelineStageDefaultTypeName') ? getPipelineStageDefaultTypeName(id) : ''; } catch (_) { typeName = ''; }
        const shownName = String(item.dataset.phaseStepName || '').trim() || typeName;
        const type = item.dataset.stageType;
        const expand = typeof STAGE_TYPES !== 'undefined' && type === STAGE_TYPES.EXPAND_CANVAS;
        const maxEnhance = item.dataset.maxEnhance === 'true';
        const useBase = on(el(`${id}_useBaseImageToggle`));
        let inh = {};
        try { inh = has('getStageInheritedValues') ? getStageInheritedValues(id) || {} : {}; } catch (_) { inh = {}; }
        const val = (key) => { const f = el(`${id}_${key}`); return f ? String(f.value || '') : ''; };
        const toggles = {};
        TOGGLES.forEach((t) => { const b = el(`${id}_${t}Toggle`); toggles[t] = { on: on(b), disabled: !b || !!b.disabled, title: b ? b.title : '' }; });
        const seedInput = el(`${id}_seed`);
        const autoSeed = el(`${id}_autoSeedToggle`);
        const resolution = val('resolution');
        const custom = !!resolution && has('isCustomResolutionMode') && isCustomResolutionMode(resolution);
        const areaToggle = el(`${id}_resolutionAreaToggle`);
        const bgState = (el(`${id}_bgFocusToggle`) || {}).dataset ? el(`${id}_bgFocusToggle`).dataset.state || '' : '';
        const advanced = el(`${id}_advancedControls`);
        const directiveGroup = advanced ? advanced.querySelector('.group-creative-directive') : null;
        const varietyBtn = el(`${id}_varietyBtn`);
        const overlay = (key) => { const o = el(`${id}_${key}Overlay`); return o ? Number.parseFloat(o.textContent) / 100 : NaN; };
        const mag = el(`${id}_magnitude`);
        let v5 = false;
        try { v5 = has('isV5Model') && !!isV5Model(); } catch (_) { v5 = false; }
        return {
            id,
            index,
            label: shownName ? `Stage ${index} \u2014 ${shownName}` : label.text,
            hex: label.hex,
            icon: label.icon,
            name: item.dataset.phaseStepName || '',
            type: expand ? 'expand' : maxEnhance ? 'maxenhance' : useBase ? 'enhance' : 'variation',
            expand,
            maxEnhance,
            useBase,
            managed: item.dataset.managed === 'true',
            toggles,
            resetShown: !hidden(el(`${id}_resetAdvanced`)),
            // the rows the desktop shows for this stage now
            show: {
                mode: !expand && !maxEnhance,
                strength: !expand && useBase,
                resolution: !maxEnhance,
                inset: expand && !hidden(el(`${id}_insetToggle`)),
                bias: expand,
                custom,
                area: custom && !hidden(areaToggle),
                autoSeed: !hidden(autoSeed),
                directive: !!directiveGroup && !directiveGroup.classList.contains('hidden'),
                variety: !!varietyBtn && !v5
            },
            resolutionText: (el(`${id}_resolutionSelected`) || {}).textContent || '',
            resolutionInherited: resolution === '',
            width: Number(val('width')) || 0,
            height: Number(val('height')) || 0,
            areaText: areaToggle ? areaToggle.textContent.trim() : '',
            biasText: (el(`${id}_biasSelected`) || {}).textContent || 'Center',
            bgFocus: bgState === '' ? !!inh.backgroundFocus : bgState === 'on',
            bgFocusInherited: bgState === '',
            inset: on(el(`${id}_insetToggle`)),
            level: mag && mag.value !== '' ? Number(mag.value) : null,
            levelHint: mag && mag.placeholder ? Number(mag.placeholder) : null,
            strength: val('strength') !== '' ? Number(val('strength')) : overlay('strength'),
            strengthSet: val('strength') !== '',
            noise: val('noise') !== '' ? Number(val('noise')) : overlay('noise'),
            noiseSet: val('noise') !== '',
            seed: seedInput ? (seedInput.value || seedInput.placeholder || '') : '',
            seedEditable: !!seedInput && !seedInput.disabled,
            inheritSeed: on(el(`${id}_inheritSeedToggle`)),
            autoSeed: on(autoSeed),
            steps: val('steps') !== '' ? Number(val('steps')) : Number(inh.steps),
            stepsSet: val('steps') !== '',
            guidance: val('guidance') !== '' ? Number(val('guidance')) : Number(inh.guidance),
            guidanceSet: val('guidance') !== '',
            rescale: val('rescale') !== '' ? Number(val('rescale')) : Number(inh.rescale),
            rescaleSet: val('rescale') !== '',
            variety: on(varietyBtn),
            // the sampler by its list name (the desktop's button carries a short and a long name)
            samplerText: (() => { const v = val('sampler') || inh.sampler || ''; const hit = typeof SAMPLER_MAP !== 'undefined' ? SAMPLER_MAP.find((x) => x.meta === v) : null; return hit ? hit.display : ((el(`${id}_samplerSelected`) || {}).textContent || ''); })(),
            samplerSet: val('sampler') !== '',
            modelText: (el(`${id}_modelSelected`) || {}).textContent || '',
            modelSet: val('model') !== '',
            directive: (el(`${id}_creativeDirective`) || {}).value || ''
        };
    }

    const stages = () => items().map((item) => stage(item.id)).filter(Boolean);

    function stageToggle(id, name) {
        if (name === 'bgFocus') { if (has('toggleStageBackgroundFocus')) toggleStageBackgroundFocus(id); emit('stages'); return; }
        const node = name === 'variety' ? el(`${id}_varietyBtn`) : name === 'reset' ? el(`${id}_resetAdvanced`) : el(`${id}_${name}Toggle`);
        if (!node || node.disabled) return;
        node.click();
        emit('stages');
    }

    // the desktop's limits for each typed number (pipelineStageControls.js: blur clamps, wheel ranges)
    const LIMITS = { level: [1, 5.5], strength: [0, 1], noise: [0, 1], steps: [1, 50], guidance: [0, 10], rescale: [0, 1] };

    function stageSet(id, key, value) {
        const field = key === 'level' ? el(`${id}_magnitude`) : key === 'directive' ? el(`${id}_creativeDirective`) : el(`${id}_${key}`);
        if (!field) return;
        let text = value == null ? '' : String(value);
        if (text !== '' && LIMITS[key]) {
            let n = Math.max(LIMITS[key][0], Math.min(LIMITS[key][1], Number(text)));
            if (key === 'steps') {
                n = Math.round(n);
                // a medium lock caps the steps (the desktop's blur rule)
                try { if (typeof mediumControlIsLocked === 'function' && mediumControlIsLocked('steps') && typeof activeMediumLock === 'function' && activeMediumLock()) n = Math.min(n, activeMediumLock().steps); } catch (_) { /* no lock */ }
                text = String(n);
            } else if (key === 'guidance') text = n >= 10 ? '10' : n.toFixed(1);
            else if (key === 'level') text = n.toFixed(1);
            else text = n.toFixed(2);
        }
        if (key === 'seed') text = text.replace(/[^0-9]/g, '');
        field.value = text;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
        emit('stages');
    }

    // ---- the desktop's own drop-down lists: rendered into their (hidden) menus and read back, so the
    // rows, their order and their filters are the desktop's

    const MENU = {
        resolution: (id) => { const f = el(`${id}_resolution`); return [renderStageResolutionDropdown, f ? f.value || '' : '']; },
        bias: (id) => { const f = el(`${id}_bias`); return [renderStageBiasDropdown, f && f.value !== '' ? f.value : '2']; },
        model: (id) => { const f = el(`${id}_model`); return [renderStageModelDropdown, f ? f.value || '' : '']; },
        sampler: (id) => { const f = el(`${id}_sampler`); return [renderStageSamplerDropdown, f ? f.value || '' : '']; }
    };

    function renderMenu(id, kind) {
        const spec = MENU[kind];
        if (!spec) return null;
        const [render, selected] = spec(id);
        if (typeof render !== 'function') return null;
        render(id, selected);
        return el(`${id}_${kind}DropdownMenu`);
    }

    function stageMenu(id, kind) {
        const menu = renderMenu(id, kind);
        if (!menu) return [];
        const shownText = (el(`${id}_${kind}Selected`) || {}).textContent || '';
        const rows = [];
        let idx = 0;
        Array.from(menu.children).forEach((n) => {
            if (n.classList.contains('custom-dropdown-group') || n.classList.contains('custom-dropdown-separator')) { if (rows.length && rows[rows.length - 1] !== '-') rows.push('-'); return; }
            if (!n.classList.contains('custom-dropdown-option')) return;
            let label = n.textContent.replace(/\s+/g, ' ').trim();
            const group = n.dataset.group || '';
            // a size's group in front of its name, as the phone's own size list names them
            if (kind === 'resolution' && group && group !== 'Custom' && group !== 'Area' && !label.toLowerCase().includes(group.toLowerCase())) label = `${group} ${label}`;
            const row = { index: idx++, label, selected: n.classList.contains('selected') };
            // Background Focus is a switch above the positions
            if (kind === 'bias' && !n.dataset.value) { row.check = true; row.checked = n.classList.contains('active'); }
            rows.push(row);
        });
        if (rows[rows.length - 1] === '-') rows.pop();
        // an inherited value has no selected row: the one the stage shows is the current one
        const opts = rows.filter((r) => r !== '-' && !r.check);
        if (!opts.some((r) => r.selected)) {
            const plain = shownText.replace(/\s+/g, ' ').trim().toLowerCase();
            opts.forEach((r) => { if (plain && (r.label.toLowerCase() === plain || r.label.toLowerCase().endsWith(plain))) r.current = true; });
        }
        return rows;
    }

    function stagePick(id, kind, index) {
        const menu = renderMenu(id, kind);
        if (!menu) return;
        const opt = menu.querySelectorAll('.custom-dropdown-option')[index];
        if (opt) opt.click();
        emit('stages');
    }

    // a custom size: the desktop's arrow keys step along the legal sizes of its area
    function stageSizeStep(id, which, dir) {
        const f = el(`${id}_${which}`);
        if (!f) return;
        f.dispatchEvent(new KeyboardEvent('keydown', { key: dir > 0 ? 'ArrowUp' : 'ArrowDown', bubbles: true, cancelable: true }));
        emit('stages');
    }

    function stageAreaToggle(id) {
        const t = el(`${id}_resolutionAreaToggle`);
        if (t && !t.classList.contains('hidden')) t.click();
        emit('stages');
    }

    // ---- Generate Stage (the Generate button's menu, manualModalManager.js)

    function generateStageRows() {
        if (!has('getGenerateStageMenuItems') || !items().length) return [];
        // a stage by its card's name (the desktop's own label drops the type when the stage has no name of its own)
        const list = items();
        try { return getGenerateStageMenuItems().map((r, i) => { const st = i > 0 && list[i - 1] ? stage(list[i - 1].id) : null; return { index: i, label: st ? st.label : r.text, note: r.subtext || '', disabled: !!r.disabled }; }); } catch (_) { return []; }
    }

    function generateStage(index) {
        if (!has('handleManualGeneration')) return;
        try { if (typeof isGenerating !== 'undefined' && isGenerating) return; } catch (_) { /* not started */ }
        handleManualGeneration(new Event('submit'), { targetStageIndex: index });
    }

    // ---- Stage Results (stageResultsReview.js): its list is filled as the desktop fills it, but the
    // desktop window is not shown (the phone draws the list)

    const srr = () => (typeof stageResultsReviewManager !== 'undefined' ? stageResultsReviewManager : null);

    function stageResultsAvailable() {
        const m = srr();
        if (!m) return false;
        try { return !!m.previewChainFilename() || m.hasResults(); } catch (_) { return false; }
    }

    async function loadStageResults() {
        const m = srr();
        if (!m) return [];
        const show = m.show;
        m.show = () => {};
        try { await m.openFromStudio(); } finally { m.show = show; }
        return stageResults();
    }

    function stageResults() {
        const m = srr();
        if (!m) return [];
        return m.items().map((item, i) => {
            const status = item.querySelector('.stage-result-status');
            return { index: i, label: item.dataset.label || '', filename: item.dataset.stageFilename || '', state: item.dataset.state || '', status: status ? status.textContent : '', size: item.dataset.size || '' };
        });
    }

    function stageResultAction(index, action) {
        const m = srr();
        const item = m ? m.items()[index] : null;
        if (!item) return Promise.resolve();
        m.select(item);
        return Promise.resolve(m.runImageAction(action, item)).then(() => emit('stage-results'));
    }

    // ---- character positions

    const charItems = () => Array.from((typeof characterPromptsContainer !== 'undefined' && characterPromptsContainer && characterPromptsContainer.querySelectorAll('.character-prompt-item')) || []);
    const cpt = () => (typeof characterPositionToolManager !== 'undefined' ? characterPositionToolManager : null);

    function positions() {
        const list = charItems();
        const tool = cpt();
        let freeform = false;
        try { freeform = !!(tool && tool.isFreeformModel()); } catch (_) { freeform = false; }
        const autoBtn = el('autoPositionBtn');
        const auto = !autoBtn || autoBtn.getAttribute('data-state') === 'on';
        const returned = !!(tool && tool._hasReturnedCenters());
        // the board's shape: the last picture's, else the size chosen (the desktop tool's rule)
        let aspect = { width: 1024, height: 1024 };
        try {
            const res = (el('manualResolution') || {}).value;
            aspect = (has('getDimensionsFromResolution') && getDimensionsFromResolution(res)) || aspect;
            if (tool && tool.image && !tool.image.classList.contains('hidden') && tool.image.naturalWidth) aspect = { width: tool.image.naturalWidth, height: tool.image.naturalHeight };
        } catch (_) { /* square */ }
        return {
            freeform,
            auto,
            // the grid's Auto Position switch shows for two characters or more (characterPromptManager.js)
            autoShown: !freeform && list.length >= 2,
            returned,
            imageUrl: tool && returned ? tool.returnedImageUrl || '' : '',
            aspect,
            characters: list.map((item, i) => {
                const name = item.dataset.charaName || `Character ${i + 1}`;
                const x = Number.parseFloat(item.dataset.positionX);
                const y = Number.parseFloat(item.dataset.positionY);
                let center = { x: (i + 1) / (list.length + 1), y: 0.5 };
                try { if (tool) center = tool._centerForItem(item, i, list.length); } catch (_) { /* spread */ }
                let taken = [];
                try { taken = has('getOccupiedPositionCellLabels') ? Array.from(getOccupiedPositionCellLabels(item.id)) : []; } catch (_) { taken = []; }
                return { index: i, name, x: Number.isFinite(x) ? x : null, y: Number.isFinite(y) ? y : null, cell: item.dataset.positionCell || '', center, taken };
            })
        };
    }

    function setAutoPosition(onState) {
        const b = el('autoPositionBtn');
        if (!b) return;
        if ((b.getAttribute('data-state') === 'on') !== !!onState) b.click();
        emit('characters');
    }

    function setPosition(index, x, y, cell) {
        const item = charItems()[index];
        if (!item || !has('setCharacterPromptPosition')) return;
        setCharacterPromptPosition(item.id, x, y, cell || null);
        emit('characters');
    }

    /** V5: every character's center at once (the tool's Save: the centers kept, Auto Position off). */
    function setPositions(centers) {
        const list = charItems();
        if (!has('setCharacterPromptPosition')) return;
        (centers || []).forEach((c, i) => { if (list[i] && c && Number.isFinite(c.x) && Number.isFinite(c.y)) setCharacterPromptPosition(list[i].id, c.x, c.y); });
        const tool = cpt();
        if (tool) { tool._setAutoPosition(false); tool._syncIndicator(); }
        emit('characters');
    }

    function clearPositions() {
        if (has('clearCharacterPromptPositions')) clearCharacterPromptPositions();
        const tool = cpt();
        if (tool) tool._syncIndicator();
        emit('characters');
    }

    /** The last print's centers (Revert in the desktop tool), as the board's pins; nothing is kept yet. */
    function revertPositions() {
        const tool = cpt();
        return tool && tool._hasReturnedCenters() ? tool.returnedCenters.map((c) => (c ? { x: c.x, y: c.y } : null)) : [];
    }

    function applyReturnedPositions() {
        const tool = cpt();
        if (tool && tool._hasReturnedCenters()) tool._applyReturnedCenters();
        emit('characters');
    }

    // ---- a character's Creative Directive (its card's Directive pane)

    function characterDirective(index) {
        const item = charItems()[index];
        const f = item && el(`${item.id}_directive`);
        return f ? f.value || '' : '';
    }

    function setCharacterDirective(index, text) {
        const item = charItems()[index];
        const f = item && el(`${item.id}_directive`);
        if (!f) return;
        f.value = String(text == null ? '' : text);
        f.dispatchEvent(new Event('input', { bubbles: true }));
        f.dispatchEvent(new Event('change', { bubbles: true }));
        emit('characters');
    }

    M.extend({
        stageTypes, stages, stage, addStage, removeStage, moveStage, removeAllStages, hasRemovableStages, stageToggle, stageSet,
        stageMenu, stagePick, stageSizeStep, stageAreaToggle, generateStageRows, generateStage,
        stageResultsAvailable, loadStageResults, stageResults, stageResultAction,
        positions, setAutoPosition, setPosition, setPositions, clearPositions, revertPositions, applyReturnedPositions,
        characterDirective, setCharacterDirective
    });
})();
