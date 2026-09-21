const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/utilities.js'), 'utf8');
const getFn = src.match(/function getForgeModelFeatures\([\s\S]*?\n\}/);
const visFn = src.match(/function updateV3ModelVisibility\(\) \{[\s\S]*?\n\}/);
assert.ok(getFn && visFn, 'expected getForgeModelFeatures + updateV3ModelVisibility');

function makeEl(id) {
    return {
        id,
        className: '',
        classList: {
            _el: null,
            add(name) { this._el.className = `${this._el.className} ${name}`.trim(); },
            remove(name) {
                this._el.className = this._el.className.split(/\s+/).filter((c) => c && c !== name).join(' ');
            },
            contains(name) { return this._el.className.split(/\s+/).includes(name); }
        },
        setAttribute() {},
        getAttribute() { return null; }
    };
}

function attachClassList(el) {
    el.classList._el = el;
    return el;
}

function runVisibility(model, features) {
    const varietyBtn = attachClassList(makeEl('varietyBtn'));
    const expansionGroup = attachClassList(makeEl('expansionNoiseSchedulerGroup'));
    const enhanceGroup = attachClassList(makeEl('enhanceNoiseSchedulerGroup'));
    const noiseHeader = attachClassList(Object.assign(makeEl('noiseHeader'), {}));
    const byId = {
        vibeReferencesSection: attachClassList(makeEl('vibeReferencesSection')),
        directorReferenceSection: attachClassList(makeEl('directorReferenceSection')),
        expansionNoiseSchedulerGroup: expansionGroup,
        enhanceNoiseSchedulerGroup: enhanceGroup
    };
    const ctx = {
        console,
        window: {},
        document: {
            getElementById(id) { return byId[id] || null; },
            querySelector() { return null; },
            querySelectorAll(sel) {
                if (sel.includes('varietyBtn')) return [varietyBtn];
                if (sel.includes('expansionNoiseSchedulerGroup')) return [expansionGroup, enhanceGroup];
                if (sel.includes('data-noise-schedule-ui')) return [noiseHeader];
                return [];
            }
        },
        getCurrentSelectedModel() { return model; },
        isV3Model() { return String(model).startsWith('v3'); },
        optionsData: { modelFeatures: { [model]: features } },
        datasetDropdown: attachClassList(makeEl('datasetDropdown')),
        addItemDropdown: attachClassList(makeEl('addItemDropdown')),
        characterPromptsContainer: attachClassList(makeEl('characterPromptsContainer')),
        varietyEnabled: true,
        manualSelectedNoiseScheduler: 'polyexponential',
        selectManualNoiseScheduler(value) { ctx.manualSelectedNoiseScheduler = value; ctx.selectCalls.push(value); },
        updateSamplerDisplay() { ctx.displayCalls += 1; },
        selectCalls: [],
        displayCalls: 0
    };
    ctx.window = ctx;
    vm.createContext(ctx);
    vm.runInContext(`${getFn[0]}\n${visFn[0]}\nupdateV3ModelVisibility();`, ctx);
    return { ctx, varietyBtn, expansionGroup, enhanceGroup, noiseHeader };
}

const v5 = runVisibility('v5', { varietyPlus: false, noiseScheduleUi: false, vibeTransfer: false, preciseReference: false });
assert.ok(v5.varietyBtn.classList.contains('hidden'), 'V5 hides Variety+');
assert.ok(v5.expansionGroup.classList.contains('hidden'), 'V5 hides expand noise-schedule group');
assert.ok(v5.enhanceGroup.classList.contains('hidden'), 'V5 hides enhance noise-schedule group');
assert.ok(v5.noiseHeader.classList.contains('hidden'), 'V5 hides marked noise-schedule chrome');
assert.deepStrictEqual(v5.ctx.selectCalls, ['karras'], 'V5 forces karras when a non-karras schedule was selected');
assert.strictEqual(v5.ctx.varietyEnabled, false);

const v45 = runVisibility('v4_5', { varietyPlus: true, noiseScheduleUi: true, vibeTransfer: true, preciseReference: true });
assert.ok(!v45.varietyBtn.classList.contains('hidden'), 'V4.5 keeps Variety+ visible');
assert.ok(!v45.expansionGroup.classList.contains('hidden'), 'V4.5 keeps expand noise-schedule group');
assert.ok(!v45.enhanceGroup.classList.contains('hidden'), 'V4.5 keeps enhance noise-schedule group');
assert.ok(!v45.noiseHeader.classList.contains('hidden'), 'V4.5 keeps marked noise-schedule chrome');
assert.deepStrictEqual(v45.ctx.selectCalls, [], 'V4.5 does not force karras');
assert.ok(v45.ctx.displayCalls >= 1, 'V4.5 refreshes sampler display');
assert.strictEqual(v45.ctx.varietyEnabled, true);

console.log('test-studio-model-cap-chrome: ok');
