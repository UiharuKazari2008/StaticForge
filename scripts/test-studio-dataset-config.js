'use strict';
// Regression: Wren sev-5 — apply_studio_changes dataset_config.include dropped / UI selection wiped.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const { normalizeDatasetConfig } = require('../modules/studioDatasetIds');
const datasets = require('../prompt.config.json').datasets;

// (1) aliases resolve to the real id; unknown ids are reported, not silently dropped.
let r = normalizeDatasetConfig({ include: ['furry'] }, datasets);
assert.deepStrictEqual(r.config.include, ['fur dataset']);
assert.deepStrictEqual(r.unknown, []);
assert.deepStrictEqual(r.remapped, [{ from: 'furry', to: 'fur dataset' }]);
assert.deepStrictEqual(normalizeDatasetConfig({ include: ['fur', 'Fur Dataset', 'background'] }, datasets).config.include,
    ['fur dataset', 'background dataset']);
r = normalizeDatasetConfig({ include: ['furry_human', 'nonsense'], bias: { furry: 2 } }, datasets);
assert.deepStrictEqual(r.unknown, ['furry_human', 'nonsense']);
assert.ok(r.hints[0].includes('sub-toggle'));
assert.deepStrictEqual(r.config.bias, { 'fur dataset': 2 });
assert.deepStrictEqual(normalizeDatasetConfig({ nsfw: 1 }, datasets).config, { nsfw: 1 }, 'no include key stays absent');

// Facade rejects unknown ids instead of returning applied:true.
const facade = fs.readFileSync(path.join(root, 'modules/mcpAgentFacade.js'), 'utf8');
const applyFn = facade.slice(facade.indexOf('async function applyStudioChanges('), facade.indexOf('function mcpTextResult('));
assert.ok(/normalizeDatasetConfig\(/.test(applyFn) && /unknown\.length/.test(applyFn) && /err\.status = 400/.test(applyFn),
    'apply_studio_changes validates dataset ids');

// Server compile accepts the short aliases too.
const ig = fs.readFileSync(path.join(root, 'modules/imageGeneration.js'), 'utf8');
assert.ok(/'furry': 'fur dataset'/.test(ig) && /'fur': 'fur dataset'/.test(ig), 'compile aliases furry/fur');

// Client: run the real applyStudioDatasetConfig + snapshot/restore helpers.
const scj = fs.readFileSync(path.join(root, 'public/scripts/comp/studioChangeJson.js'), 'utf8');
const grab = (start, end) => scj.slice(scj.indexOf(start), scj.indexOf(end));
const src = [
    grab('function studioDatasetConfigHasWork(', 'function buildOpsFromPayload('),
    grab('const STUDIO_DATASET_ID_ALIASES', 'async function applyStudioParam(')
].join('\n');
const ctx = {
    selectedDatasets: ['fur dataset'], datasetBias: { 'fur dataset': 1.5 }, nsfwBias: 1, selectedNsfwValue: 0,
    window: { optionsData: { datasets }, datasetSettings: { 'fur dataset': { furry_human: { enabled: true } } } },
    updateDatasetDisplay() {}, renderDatasetDropdown() {}, renderSubTogglesDropdown() {}, updateSubTogglesButtonState() {},
    updateNsfwButtonDisplay() {}, selectNsfwValue() {}, findDatasetConfig() { return null; }, writeSubToggleSetting() {},
    console
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext("applyStudioDatasetConfig({ include: ['furry'] })", ctx);
assert.deepStrictEqual(Array.from(ctx.selectedDatasets), ['fur dataset'], 'client maps furry alias');

// (2) apply without dataset_config keeps the UI selection even when Studio reopens/clears.
ctx.selectedDatasets = ['fur dataset'];
vm.runInContext(`
    var snap = captureStudioDatasetSelection();
    selectedDatasets = []; datasetBias = {}; window.datasetSettings = {}; // simulate clearManualForm on reopen
    restoreStudioDatasetSelectionUnlessChanged(snap, { prompt: 'x', params: { steps: 28 } });
`, ctx);
assert.deepStrictEqual(Array.from(ctx.selectedDatasets), ['fur dataset'], 'selection survives apply w/o dataset_config');
assert.strictEqual(ctx.window.datasetSettings['fur dataset'].furry_human.enabled, true);
vm.runInContext(`
    var snap2 = captureStudioDatasetSelection();
    selectedDatasets = [];
    restoreStudioDatasetSelectionUnlessChanged(snap2, { dataset_config: { include: [] } });
`, ctx);
assert.deepStrictEqual(Array.from(ctx.selectedDatasets), [], 'explicit include [] still clears');

const silent = grab('async function applyStudioChangePayloadSilent(', 'async function tryApplyStudioChangeJsonFromText(');
assert.ok(silent.indexOf('captureStudioDatasetSelection()') < silent.indexOf('ensureStudioOpenForChange('), 'snapshot before reopen');
assert.ok(/restoreStudioDatasetSelectionUnlessChanged\(/.test(silent));
console.log('test-studio-dataset-config: ok');
