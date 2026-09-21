const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/manualModalManager.js'), 'utf8');
const match = src.match(/function applyForgeEditorInputToMetadata\([\s\S]*?\n\}/);
assert.ok(match, 'applyForgeEditorInputToMetadata must exist in manualModalManager.js');

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(match[0], ctx);

const hydrate = ctx.applyForgeEditorInputToMetadata;

const compiled = '1girl, masterpiece, best quality, fur dataset, compiled fluff';
const editorPrompt = '1girl, fluffy tail';
const editorUc = 'lowres';
const raw = {
    prompt: compiled,
    uc: 'compiled uc, lowres, worst quality',
    dataset_config: undefined,
    forge_data: {
        input_prompt: editorPrompt,
        input_uc: editorUc,
        dataset_config: { include: ['fur dataset'], nsfw: 2 },
        allCharacters: [{ prompt: 'alice', uc: '' }]
    },
    characterPrompts: [{ prompt: 'compiled alice, masterpiece', uc: 'compiled uc' }]
};

const hydrated = hydrate(raw);
assert.strictEqual(hydrated.prompt, editorPrompt, 'Modify/preview cache must use input_prompt, not compiled prompt');
assert.strictEqual(hydrated.uc, editorUc, 'UC must come from input_uc when input_prompt is present');
assert.deepStrictEqual(hydrated.dataset_config, raw.forge_data.dataset_config);
assert.deepStrictEqual(hydrated.allCharacterPrompts, raw.forge_data.allCharacters);
assert.strictEqual(raw.prompt, compiled, 'must not mutate the cached generation metadata prompt');

const galleryAlreadyRemapped = {
    prompt: editorPrompt,
    uc: editorUc,
    dataset_config: { include: ['fur dataset'] },
    allCharacterPrompts: [{ prompt: 'alice', uc: '' }],
    forge_data: {
        input_prompt: editorPrompt,
        input_uc: editorUc,
        dataset_config: { include: ['fur dataset'] },
        allCharacters: [{ prompt: 'alice', uc: '' }]
    }
};
const again = hydrate(galleryAlreadyRemapped);
assert.strictEqual(again.prompt, editorPrompt);
assert.deepStrictEqual(again.dataset_config, galleryAlreadyRemapped.dataset_config);
assert.deepStrictEqual(again.allCharacterPrompts, galleryAlreadyRemapped.allCharacterPrompts);

assert.strictEqual(hydrate(null), null);
assert.strictEqual(hydrate(undefined), undefined);

console.log('test-forge-editor-input-hydrate: ok');
