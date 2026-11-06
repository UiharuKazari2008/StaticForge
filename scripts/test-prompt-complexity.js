'use strict';

// Complexity typed into a prompt moves into the Quality preset's Complexity group (no double tag).
// Server: modules/promptComplexity.js (buildOptions). Client: imageGenerationSettings.js studioLiftComplexity.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const pc = require('../modules/promptComplexity');

const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../prompt.config.json'), 'utf8'));
const toggles = pc.complexityToggles(config, 'v5');
assert.deepStrictEqual(toggles.map((t) => t.id), ['low_complexity', 'medium_complexity', 'high_complexity', 'ultra_complexity']);
assert.strictEqual(pc.complexityToggles(config, 'v4_5').length, 0, 'V5 only, like the toggles');

const cases = [
    ['1girl, high complexity, smile', '1girl, smile', { id: 'high_complexity', bias: 1 }],
    ['1.3::low complexity::, cat', 'cat', { id: 'low_complexity', bias: 1.3 }],
    ['1.2::a, b::, High  Complexity', '1.2::a, b::', { id: 'high_complexity', bias: 1 }],
    ['medium complexity, x, ultra complexity', 'x', { id: 'ultra_complexity', bias: 1 }],
    ['x, -1::high complexity::', 'x, -1::high complexity::', null],
    ['complexity theory, high complexity art', 'complexity theory, high complexity art', null],
    ['', '', null]
];
for (const [input, text, pick] of cases) {
    const got = pc.liftComplexity(input, toggles);
    assert.strictEqual(got.text, text, input);
    assert.deepStrictEqual(got.pick, pick, input);
}

const body = { dataset_config: { include: ['__quality__'], settings: { __quality__: { medium_complexity: { enabled: true, bias: 1 }, no_text: { enabled: true } } } } };
pc.applyComplexityPick(body, { id: 'high_complexity', bias: 1.2 }, toggles);
const q = body.dataset_config.settings.__quality__;
assert.deepStrictEqual(q.high_complexity, { enabled: true, bias: 1.2, value: 'high complexity' });
assert.strictEqual(q.medium_complexity.enabled, false, 'one choice in the group');
assert.strictEqual(q.no_text.enabled, true, 'other quality toggles untouched');
const empty = {};
pc.applyComplexityPick(empty, { id: 'low_complexity', bias: 1 }, toggles);
assert.strictEqual(empty.dataset_config.settings.__quality__.low_complexity.enabled, true);

// buildOptions wiring: the input prompt is cleaned before the quality preset compiles.
const gen = fs.readFileSync(path.join(__dirname, '../modules/imageGeneration.js'), 'utf8');
assert.ok(gen.includes("promptComplexity.liftComplexity(rawPrompt, complexityToggles)"));
assert.ok(gen.includes("promptComplexity.liftComplexity(processedPrompt, complexityToggles)"));

// The client copy gives the same answers.
const client = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/imageGenerationSettings.js'), 'utf8');
const start = client.indexOf('// ---- Complexity');
const end = client.indexOf('// Studio form: before Generate');
assert.ok(start > 0 && end > start);
const sandbox = { window: { optionsData: { datasets: config.datasets } } };
vm.runInNewContext(`function studioNormalizePromptTag(tag) { return String(tag || '').replace(/\\s+/g, ' ').trim().toLowerCase(); }\n${client.slice(start, end)}`, sandbox);
const clientToggles = sandbox.studioComplexityToggles('v5');
assert.strictEqual(clientToggles.length, 4);
for (const [input] of cases) {
    const a = pc.liftComplexity(input, toggles);
    const b = sandbox.studioLiftComplexity(input, clientToggles);
    assert.strictEqual(b.text, a.text, `client text: ${input}`);
    assert.deepStrictEqual(b.pick ? { ...b.pick } : null, a.pick, `client pick: ${input}`);
}
const settings = sandbox.studioApplyComplexityPick({ high_complexity: { enabled: true } }, { id: 'low_complexity', bias: 1 }, clientToggles);
assert.strictEqual(settings.high_complexity.enabled, false);
assert.strictEqual(settings.low_complexity.enabled, true);

console.log('test-prompt-complexity: ok');
