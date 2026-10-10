'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const {
    v5SourceForgeCode,
    forgeCodeToKey,
    apiModelForParsedSource
} = require('../modules/modelFeatures');
const {
    resolveMediumLock,
    applyMediumLocksToOptions
} = require('../modules/v5MediumLock');
const MEDIUM_A = 'NovelAI Diffusion V5 93F4BD30';
const MEDIUM_B = 'NovelAI Diffusion V5 70AB5786';
const FULL = 'NovelAI Diffusion V5 DB276663';
const FULL_OLD = 'NovelAI Diffusion V5 657484A5';

function extractFunction(src, name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing function ${name}`);
    return src.slice(start, closeBrace(src, src.indexOf('{', start)));
}

function extractMethod(src, name) {
    const re = new RegExp(`${name}\\(([^)]*)\\)\\s*\\{`);
    const match = re.exec(src);
    assert.ok(match, `missing method ${name}`);
    const brace = match.index + match[0].length - 1;
    return `function ${name}(${match[1]}) ${src.slice(brace, closeBrace(src, brace))}`;
}

function closeBrace(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return i + 1;
        }
    }
    throw new Error('unclosed brace');
}

[MEDIUM_A, MEDIUM_B].forEach((source) => {
    assert.strictEqual(v5SourceForgeCode(source), 'V5_MEDIUM', source);
    assert.strictEqual(forgeCodeToKey(v5SourceForgeCode(source)), 'v5_medium', source);
});
assert.strictEqual(v5SourceForgeCode(FULL), 'V5');
assert.strictEqual(v5SourceForgeCode(FULL_OLD), 'V5');
assert.strictEqual(forgeCodeToKey('V5'), 'v5');
assert.strictEqual(v5SourceForgeCode('NovelAI Diffusion V5 DEADBEEF'), 'V5');

const pngSrc = fs.readFileSync(path.join(__dirname, '../modules/pngMetadata.js'), 'utf8');
const dbSrc = fs.readFileSync(path.join(__dirname, '../modules/metadataDatabase.js'), 'utf8');
const serverParserCtx = { v5SourceForgeCode, console };
vm.createContext(serverParserCtx);
vm.runInContext(
    `${extractMethod(pngSrc, 'determineModelFromMetadata')}\n${extractMethod(pngSrc, 'getModelDisplayName')}\n${extractFunction(dbSrc, 'determineForgeModelCode')}`,
    serverParserCtx
);
[MEDIUM_A, MEDIUM_B].forEach((source) => {
    assert.strictEqual(serverParserCtx.determineModelFromMetadata({ source }), 'V5_MEDIUM', 'pngMetadata ' + source);
    assert.strictEqual(serverParserCtx.determineForgeModelCode(source), 'V5_MEDIUM', 'metadataDatabase ' + source);
    assert.strictEqual(forgeCodeToKey(serverParserCtx.determineForgeModelCode(source)), 'v5_medium');
});
assert.strictEqual(serverParserCtx.determineModelFromMetadata({ source: FULL }), 'V5');
assert.strictEqual(serverParserCtx.determineForgeModelCode(FULL), 'V5');
assert.strictEqual(serverParserCtx.getModelDisplayName('V5_MEDIUM'), 'V5 Medium');

assert.strictEqual(
    apiModelForParsedSource({ source: MEDIUM_A }),
    'nai-diffusion-5-full-medium'
);
assert.strictEqual(
    apiModelForParsedSource({ source: MEDIUM_B, model: 'nai-diffusion-5-full-medium-inpainting' }),
    'nai-diffusion-5-full-medium-inpainting'
);
assert.strictEqual(
    apiModelForParsedSource({ source: MEDIUM_A, forge_data: { mask_compressed: 'abc' } }),
    'nai-diffusion-5-full-medium-inpainting'
);
assert.strictEqual(
    apiModelForParsedSource({ source: FULL }),
    'nai-diffusion-5-full'
);

const clientSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/reference/pngMetadata.js'), 'utf8');
const clientCtx = { console };
vm.createContext(clientCtx);
vm.runInContext(extractFunction(clientSrc, 'determineModelFromMetadata'), clientCtx);
[MEDIUM_A, MEDIUM_B].forEach((source) => {
    assert.strictEqual(clientCtx.determineModelFromMetadata({ source }), 'V5_MEDIUM', 'client parser ' + source);
});
assert.strictEqual(clientCtx.determineModelFromMetadata({ source: FULL }), 'V5');
assert.strictEqual(clientCtx.determineModelFromMetadata({ source: 'NovelAI Diffusion V5 FFFFFFFF' }), 'V5');

const heavy = 'nsfw, lowres, heavy preset';
const ucPresets = { v5: ['human focus', 'light preset', heavy, 'curated preset'] };

assert.strictEqual(resolveMediumLock('v5', 'high'), null);
assert.strictEqual(resolveMediumLock('v4_5', 'medium'), null);

const fromEffort = resolveMediumLock('v5', 'medium');
const fromModel = resolveMediumLock('v5_medium', 'high');
[fromEffort, fromModel].forEach((lock) => {
    assert.ok(lock);
    assert.strictEqual(lock.steps, 14);
    assert.strictEqual(lock.sampler, 'k_euler_ancestral');
    assert.strictEqual(lock.ucPresetId, 'heavy');
    assert.strictEqual(lock.clearsUserUc, true);
    assert.strictEqual(lock.cfgRescale, false);
    assert.strictEqual(lock.varietyPlus, false);
    assert.strictEqual(lock.dynamicThresholding, false);
    assert.strictEqual(lock.smea, false);
});

function studioBody(steps) {
    return {
        model: 'v5',
        steps: steps,
        sampler: 'k_euler',
        scale: 6.5,
        cfg_rescale: 0.45,
        rescale: 0.45,
        negative_prompt: 'user uc, extra hands',
        uc: 'user uc, extra hands',
        input_uc: 'user uc, extra hands',
        ucPreset: 4,
        noise_schedule: 'polyexponential',
        noiseScheduler: 'polyexponential',
        variety: true,
        skip_cfg_above_sigma: 59,
        dynamic_thresholding: true,
        dynamicThresholding: true,
        sm: true,
        sm_dyn: true,
        characterPrompts: [{ name: 'Mika', prompt: '1girl', uc: 'bad hands', center: { x: 0.2, y: 0.4 } }],
        allCharacterPrompts: [{ name: 'Mika', prompt: '1girl', uc: 'bad hands', center: { x: 0.2, y: 0.4 } }],
        input_character_prompts: [{ name: 'Mika', prompt: '1girl', uc: 'bad hands' }]
    };
}

const locked = applyMediumLocksToOptions(studioBody(50), fromEffort, ucPresets, 'v5');
assert.strictEqual(locked.steps, 14);
assert.strictEqual(locked.sampler, 'k_euler_ancestral');
assert.strictEqual(locked.scale, 6.5);
assert.strictEqual(Object.prototype.hasOwnProperty.call(locked, 'cfg_rescale'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(locked, 'noise_schedule'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(locked, 'sm'), false);
assert.strictEqual(Object.prototype.hasOwnProperty.call(locked, 'sm_dyn'), false);
assert.strictEqual(locked.negative_prompt, heavy);
assert.strictEqual(locked.uc, heavy);
assert.strictEqual(locked.ucPresetId, 'heavy');
assert.strictEqual(locked.append_uc, 3);
assert.strictEqual(Object.prototype.hasOwnProperty.call(locked, 'ucPreset'), false);
assert.strictEqual(locked.input_uc, 'user uc, extra hands');
assert.strictEqual(locked.characterPrompts[0].uc, '');
assert.strictEqual(locked.characterPrompts[0].name, 'Mika');
assert.strictEqual(locked.characterPrompts[0].prompt, '1girl');
assert.deepStrictEqual(locked.characterPrompts[0].center, { x: 0.2, y: 0.4 });
assert.strictEqual(locked.allCharacterPrompts[0].uc, '');
assert.strictEqual(locked.input_character_prompts[0].uc, 'bad hands');
assert.strictEqual(locked.dynamic_thresholding, false);
assert.strictEqual(locked.variety, false);
assert.strictEqual(locked.skip_cfg_above_sigma, undefined);

const over = applyMediumLocksToOptions(studioBody(28), fromModel, ucPresets, 'v5_medium');
assert.strictEqual(over.steps, 14);
assert.strictEqual(over.negative_prompt, heavy);
assert.strictEqual(over.sampler, 'k_euler_ancestral');

const emptyPreset = applyMediumLocksToOptions(studioBody(20), fromEffort, {}, 'v5');
assert.strictEqual(emptyPreset.negative_prompt, '');
assert.strictEqual(emptyPreset.characterPrompts[0].uc, '');
assert.strictEqual(emptyPreset.steps, 14);

const genSrc = fs.readFileSync(path.join(__dirname, '../modules/imageGeneration.js'), 'utf8');
assert.ok(genSrc.includes('applyMediumLocksToOptions'), 'buildOptions must apply the Medium lock');
assert.ok(genSrc.includes('resolveMediumLock'), 'buildOptions must resolve the Medium lock');

const features = JSON.parse(fs.readFileSync(path.join(__dirname, '../config/model-features.json'), 'utf8'));
const utilSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/utilities.js'), 'utf8');
const uiFns = [
    `const V5_MEDIUM_EFFORT_SOURCES = ${JSON.stringify([MEDIUM_A, MEDIUM_B])};`,
    ...[
        'getForgeModelFeatures',
        'resolveGenerationEffort',
        'ucPresetLevelFromId',
        'activeMediumLock',
        'mediumControlIsLocked',
        'applyMediumStudioChrome',
        'applyModelLocks'
    ].map((name) => extractFunction(utilSrc, name))
].join('\n');

function makeEl(id) {
    return {
        id,
        className: '',
        disabled: false,
        readOnly: false,
        value: '',
        title: '',
        max: '',
        dataset: {},
        classList: {
            _el: null,
            toggle(name, on) {
                const parts = this._el.className.split(/\s+/).filter(Boolean);
                const has = parts.includes(name);
                if (on && !has) parts.push(name);
                if (!on && has) parts.splice(parts.indexOf(name), 1);
                this._el.className = parts.join(' ');
            },
            contains(name) { return this._el.className.split(/\s+/).includes(name); }
        },
        setAttribute(name, value) { this[name] = value; },
        removeAttribute(name) { delete this[name]; },
        getAttribute(name) { return this[name]; }
    };
}

function wire(el) {
    el.classList._el = el;
    return el;
}

function runChrome(effort) {
    const steps = wire(makeEl('manualSteps'));
    steps.className = 'form-control hover-show colored';
    steps.value = '28';
    steps.max = '50';
    const stepsGroup = wire(makeEl('manualStepsGroup'));
    const samplerRow = wire(makeEl('samplerRow'));
    const rescaleGroup = wire(makeEl('manualRescaleGroup'));
    const rescale = wire(makeEl('manualRescale'));
    rescale.value = '0.40';
    const samplerBtn = wire(makeEl('manualSamplerDropdownBtn'));
    const ucBtn = wire(makeEl('ucPresetsDropdownBtn'));
    const uc = wire(makeEl('manualUc'));
    const charUc = wire(makeEl('char_uc'));
    const stageSteps = wire(makeEl('stage_steps'));
    stageSteps.className = 'form-control hover-show colored';
    stageSteps.value = '30';
    const byId = {
        manualSteps: steps,
        manualStepsGroup: stepsGroup,
        manualRescaleGroup: rescaleGroup,
        manualRescale: rescale,
        manualSamplerDropdownBtn: samplerBtn,
        ucPresetsDropdownBtn: ucBtn,
        manualUc: uc,
        pipelineStagesContainer: {
            querySelectorAll(sel) {
                if (sel.includes('_steps')) return [stageSteps];
                return [];
            }
        }
    };
    const ctx = {
        console,
        effort,
        model: 'v5',
        window: { optionsData: { modelFeatures: features } },
        getCurrentSelectedModel() { return ctx.model; },
        getManualEffort() { return ctx.effort; },
        document: {
            getElementById(id) { return byId[id] || null; },
            querySelector(sel) {
                if (sel.includes('control-row-sampler')) return samplerRow;
                return null;
            },
            querySelectorAll(sel) {
                if (sel.includes('textarea')) return [charUc];
                return [];
            }
        }
    };
    vm.createContext(ctx);
    vm.runInContext(`${uiFns}\nthis.lock = activeMediumLock();\napplyMediumStudioChrome(this.lock);\nthis.stepsLocked = mediumControlIsLocked('steps');\nthis.guidanceLocked = mediumControlIsLocked('guidance');`, ctx);
    return { ctx, steps, stepsGroup, samplerRow, rescaleGroup, rescale, ucBtn, charUc, stageSteps };
}

const mediumUi = runChrome('medium');
assert.ok(mediumUi.ctx.lock);
assert.strictEqual(mediumUi.ctx.lock.steps, 14);
assert.strictEqual(mediumUi.steps.disabled, true);
assert.strictEqual(mediumUi.steps.value, '14');
assert.strictEqual(mediumUi.steps.max, '14');
assert.strictEqual(mediumUi.steps.tabIndex, -1);
assert.ok(mediumUi.steps.classList.contains('medium-locked'));
assert.ok(!mediumUi.steps.classList.contains('hover-show'), 'locked steps have no hover affordance');
assert.ok(mediumUi.stageSteps.classList.contains('medium-locked'));
assert.ok(!mediumUi.stageSteps.classList.contains('hover-show'));
assert.ok(mediumUi.steps.title.includes('V5 Medium'));
assert.strictEqual(mediumUi.stepsGroup.title, mediumUi.steps.title);
assert.strictEqual(mediumUi.stepsGroup.dataset.mediumLock, '1');
assert.ok(mediumUi.stepsGroup.classList.contains('hidden'), 'steps hidden in Medium');
assert.ok(mediumUi.stageSteps.classList.contains('hidden'), 'stage steps hidden in Medium');
assert.ok(mediumUi.samplerRow.classList.contains('hidden'), 'sampler row hidden');
assert.ok(mediumUi.rescaleGroup.classList.contains('hidden'), 'rescale hidden');
assert.strictEqual(mediumUi.rescale.disabled, true);
assert.strictEqual(mediumUi.ucBtn.disabled, true);
assert.strictEqual(mediumUi.charUc.readOnly, true);
assert.strictEqual(mediumUi.stageSteps.value, '14');
assert.strictEqual(mediumUi.ctx.stepsLocked, true);
assert.strictEqual(mediumUi.ctx.guidanceLocked, false, 'guidance stays editable');

const highUi = runChrome('high');
assert.strictEqual(highUi.ctx.lock, null);
assert.strictEqual(highUi.steps.disabled, false);
assert.strictEqual(highUi.steps.value, '28');
assert.ok(highUi.steps.classList.contains('hover-show'));
assert.ok(!highUi.steps.classList.contains('medium-locked'));
assert.ok(!highUi.samplerRow.classList.contains('hidden'));
assert.ok(!highUi.rescaleGroup.classList.contains('hidden'));
assert.ok(!highUi.stepsGroup.classList.contains('hidden'), 'steps visible in Full');
assert.strictEqual(highUi.ctx.stepsLocked, false);

const effortCtx = {
    console,
    getCurrentSelectedModel() { return 'v5'; },
    window: { optionsData: { modelFeatures: features } }
};
vm.createContext(effortCtx);
vm.runInContext(`${uiFns}\nthis.effort = resolveGenerationEffort({ source: ${JSON.stringify(MEDIUM_A)} });`, effortCtx);
assert.strictEqual(effortCtx.effort, 'medium');

const paramsSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/manualGenerationParams.js'), 'utf8');
const keysSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/keyboardShortcuts.js'), 'utf8');
const changeSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/studioChangeJson.js'), 'utf8');
const stageSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/pipelineStageControls.js'), 'utf8');
assert.ok(paramsSrc.includes("mediumControlIsLocked('steps')"));
assert.ok(paramsSrc.includes("mediumControlIsLocked('rescale')"));
assert.ok(keysSrc.includes("mediumControlIsLocked('steps')"));
assert.ok(changeSrc.includes("mediumControlIsLocked('steps')"));
assert.ok(changeSrc.includes("mediumControlIsLocked('sampler')"));
assert.ok(changeSrc.includes("mediumControlIsLocked('uc')"));
assert.ok(stageSrc.includes("mediumControlIsLocked('steps')"));
assert.ok(stageSrc.includes("mediumControlIsLocked('sampler')"));

function runImageLoad(metadata) {
    const steps = wire(makeEl('manualSteps'));
    steps.className = 'form-control hover-show colored';
    steps.value = String(metadata.steps);
    steps.max = '50';
    const stepsGroup = wire(makeEl('manualStepsGroup'));
    const samplerRow = wire(makeEl('samplerRow'));
    const rescaleGroup = wire(makeEl('manualRescaleGroup'));
    const rescale = wire(makeEl('manualRescale'));
    rescale.value = Number(metadata.cfg_rescale).toFixed(2);
    const samplerBtn = wire(makeEl('manualSamplerDropdownBtn'));
    const ucBtn = wire(makeEl('ucPresetsDropdownBtn'));
    const uc = wire(makeEl('manualUc'));
    const charUc = wire(makeEl('char_uc'));
    const stageSteps = wire(makeEl('stage_steps'));
    stageSteps.className = 'form-control hover-show colored';
    stageSteps.value = '30';
    const byId = {
        manualSteps: steps,
        manualStepsGroup: stepsGroup,
        manualRescaleGroup: rescaleGroup,
        manualRescale: rescale,
        manualSamplerDropdownBtn: samplerBtn,
        ucPresetsDropdownBtn: ucBtn,
        manualUc: uc,
        pipelineStagesContainer: {
            querySelectorAll(sel) {
                if (sel.includes('_steps')) return [stageSteps];
                return [];
            }
        }
    };
    const ctx = {
        console,
        effort: 'high',
        model: 'v5',
        metadata,
        appliedSampler: metadata.sampler || 'k_euler',
        appliedUc: 4,
        setEffortCalls: 0,
        manualSelectedSampler: metadata.sampler || 'k_euler',
        window: { optionsData: { modelFeatures: features } },
        getCurrentSelectedModel() { return ctx.model; },
        getManualEffort() { return ctx.effort; },
        document: {
            getElementById(id) { return byId[id] || null; },
            querySelector(sel) {
                if (sel.includes('control-row-sampler')) return samplerRow;
                return null;
            },
            querySelectorAll(sel) {
                if (sel.includes('textarea')) return [charUc];
                return [];
            }
        }
    };
    vm.createContext(ctx);
    vm.runInContext(`${uiFns}
function setManualEffort(level) {
    this.effort = String(level || '').toLowerCase() === 'medium' ? 'medium' : 'high';
    this.setEffortCalls += 1;
    applyModelLocks();
}
function selectManualSampler(value) { this.appliedSampler = value; }
function selectUcPreset(value) { this.appliedUc = value; }
applyModelLocks(this.metadata);
`, ctx);
    return { ctx, steps, stepsGroup, samplerRow, rescaleGroup, rescale, stageSteps };
}

const loadedMedium = runImageLoad({
    source: MEDIUM_A,
    model: 'V5_MEDIUM',
    steps: 28,
    sampler: 'k_euler',
    cfg_rescale: 0.45
});
assert.strictEqual(loadedMedium.ctx.effort, 'medium');
assert.strictEqual(loadedMedium.ctx.setEffortCalls, 1, 'image load uses the effort switch path');
assert.strictEqual(loadedMedium.steps.disabled, true);
assert.strictEqual(loadedMedium.steps.value, '14');
assert.strictEqual(loadedMedium.steps.tabIndex, -1);
assert.ok(loadedMedium.steps.classList.contains('medium-locked'));
assert.ok(loadedMedium.stepsGroup.classList.contains('hidden'), 'steps hidden after Medium image load');
assert.ok(!loadedMedium.steps.classList.contains('hover-show'), 'image load drops the steps hover affordance');
assert.ok(loadedMedium.samplerRow.classList.contains('hidden'), 'image load hides sampler');
assert.ok(loadedMedium.rescaleGroup.classList.contains('hidden'), 'image load hides cfg rescale');
assert.strictEqual(loadedMedium.rescale.disabled, true);
assert.strictEqual(loadedMedium.rescale.value, '0.00');
assert.strictEqual(loadedMedium.ctx.appliedSampler, 'k_euler_ancestral');
assert.strictEqual(loadedMedium.ctx.appliedUc, 3);
assert.strictEqual(loadedMedium.stageSteps.disabled, true);
assert.strictEqual(loadedMedium.stageSteps.value, '14');
assert.ok(!loadedMedium.stageSteps.classList.contains('hover-show'));

const loadedFull = runImageLoad({
    source: FULL,
    model: 'V5',
    steps: 28,
    sampler: 'k_euler',
    cfg_rescale: 0.45
});
assert.strictEqual(loadedFull.ctx.effort, 'high');
assert.strictEqual(loadedFull.ctx.setEffortCalls, 0);
assert.strictEqual(loadedFull.steps.disabled, false);
assert.strictEqual(loadedFull.steps.value, '28');
assert.ok(loadedFull.steps.classList.contains('hover-show'));
assert.ok(!loadedFull.samplerRow.classList.contains('hidden'));
assert.ok(!loadedFull.rescaleGroup.classList.contains('hidden'));

const modalSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/manualModalManager.js'), 'utf8');
const formSrc = modalSrc.slice(
    modalSrc.indexOf('async function loadIntoManualForm'),
    modalSrc.indexOf('function autoResizeTextareasAfterModalShow')
);
const populatedAt = formSrc.indexOf('manualSteps.value = data.steps');
const pipelineAt = formSrc.lastIndexOf('loadPipelineStages(');
const lockAt = formSrc.lastIndexOf('applyModelLocks(data)');
assert.ok(populatedAt > 0 && pipelineAt > populatedAt && lockAt > pipelineAt, 'locks run after settings and pipeline stages');
assert.ok(!formSrc.includes("setManualEffort('medium')"), 'load form uses applyModelLocks, not a mid-load effort write');
const openSrc = modalSrc.slice(
    modalSrc.indexOf('async function openManualModalWithContent'),
    modalSrc.indexOf('function updateCreativeDirectiveVisibility')
);
assert.ok(openSrc.includes("loadIntoManualForm('preset'"));
assert.ok(openSrc.includes("loadIntoManualForm('metadata'"));
assert.ok(extractFunction(modalSrc, 'setManualEffort').includes('applyModelLocks('));
assert.ok(extractFunction(modalSrc, 'syncManualEffortChrome').includes('applyModelLocks('));
assert.ok(extractFunction(utilSrc, 'updateV3ModelVisibility').includes('syncManualEffortChrome('));

const settingsSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/imageGenerationSettings.js'), 'utf8');
const restoreSrc = settingsSrc.slice(
    settingsSrc.indexOf('async function maybeRestoreLastStudioPreview'),
    settingsSrc.indexOf('const IMAGE_GENERATION_BOOLEAN_MENU_ITEMS')
);
assert.ok(restoreSrc.includes('openManualModalWithContent'));
assert.ok(restoreSrc.includes("type: 'image'"), 'history restore loads the image through Studio');

const opsSrc = changeSrc.slice(
    changeSrc.indexOf('async function applyStudioChangeOps'),
    changeSrc.indexOf('async function saveStudioChangeToDesktop')
);
const opsLock = opsSrc.lastIndexOf('applyModelLocks(');
const opsReturn = opsSrc.lastIndexOf('return enabled.length');
assert.ok(opsLock > 0 && opsLock < opsReturn, 'apply_studio_changes locks after params are written');

// Medium folds user UC into the inline negative (deduped, raw saved fields untouched).
{
    const { foldUcIntoInlineNegative } = require('../modules/v5MediumLock');
    assert.strictEqual(foldUcIntoInlineNegative('', 'blue'), 'blue');
    assert.strictEqual(foldUcIntoInlineNegative('red, blurry', ''), 'red, blurry');
    assert.strictEqual(foldUcIntoInlineNegative('red, Blurry', 'blurry, blue'), 'red, Blurry, blue');
    assert.strictEqual(foldUcIntoInlineNegative('2::red, hat::, red', 'red'), '2::red, hat::, red');
    const genSrc = fs.readFileSync(path.join(__dirname, '../modules/imageGeneration.js'), 'utf8');
    assert.ok(genSrc.includes('effectiveInputPromptNegative ||'), 'inline negative processing uses folded UC');
    assert.ok(genSrc.includes('input_prompt_negative: rawInputPromptNegative,'), 'saved inline negative stays raw');
    const utilSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/utilities.js'), 'utf8');
    assert.ok(utilSrc.includes("getElementById('ucPresetsDropdown')") && utilSrc.includes('toggleUcWrap(uc)'), 'Medium hides UC field and presets');
}

console.log('test-v5-medium-locks: ok');
