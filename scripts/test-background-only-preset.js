'use strict';

const assert = require('assert');
const {
    BACKGROUND_ONLY_PRESET_KEY,
    NO_HUMANS_TAG,
    createBackgroundOnlyPreset,
    withBuiltinPresets,
    presentBackgroundOnlyPreset,
    applyBackgroundOnlyGeneration,
    applyBackgroundOnlyToBody,
    isBackgroundOnlyRequest,
    resolvePresetRecord
} = require('../modules/backgroundOnlyPreset');

const builtin = createBackgroundOnlyPreset();
assert.strictEqual(builtin.prompt, NO_HUMANS_TAG);
assert.strictEqual(builtin.backgroundOnly, true);
assert.strictEqual(builtin.forceCharacterBoxesOff, true);
assert.deepStrictEqual(builtin.characterPrompts, []);
assert.strictEqual(builtin.builtin, true);

const userPresets = {
    Portrait: { prompt: '1girl, castle', uc: 'lowres', characterPrompts: [{ prompt: '1girl', uc: 'bad hands', enabled: true, chara_name: 'Ada' }] }
};
const userPortrait = userPresets.Portrait;
const merged = withBuiltinPresets(userPresets);
assert.strictEqual(merged.Portrait, userPortrait);
assert.strictEqual(userPortrait.prompt, '1girl, castle');
assert.ok(merged[BACKGROUND_ONLY_PRESET_KEY]);
assert.strictEqual(merged[BACKGROUND_ONLY_PRESET_KEY].prompt, 'no humans');
assert.ok(!Object.prototype.hasOwnProperty.call(userPresets, BACKGROUND_ONLY_PRESET_KEY));

const custom = { prompt: 'my own background', backgroundOnly: false };
const kept = withBuiltinPresets({ [BACKGROUND_ONLY_PRESET_KEY]: custom });
assert.strictEqual(kept[BACKGROUND_ONLY_PRESET_KEY], custom);

const scenery = {
    backgroundOnly: true,
    prompt: '1girl, castle, night',
    uc: 'lowres, watermark',
    characterPrompts: [
        { prompt: '1girl, blue eyes', uc: 'bad hands', enabled: true, chara_name: 'Ada' },
        { prompt: '1boy, coat', uc: '', enabled: true, chara_name: 'Ben' }
    ]
};
const presented = presentBackgroundOnlyPreset(scenery);
assert.strictEqual(presented.prompt, '1girl, castle, night');
assert.strictEqual(presented.uc, 'lowres, watermark');
assert.strictEqual(scenery.characterPrompts[0].enabled, true);
assert.strictEqual(presented.characterPrompts[0].prompt, '1girl, blue eyes');
assert.strictEqual(presented.characterPrompts[0].uc, 'bad hands');
assert.strictEqual(presented.characterPrompts[0].chara_name, 'Ada');
assert.strictEqual(presented.characterPrompts[0].enabled, false);
assert.strictEqual(presented.characterPrompts[1].prompt, '1boy, coat');
assert.strictEqual(presented.characterPrompts[1].enabled, false);

const plain = presentBackgroundOnlyPreset({ prompt: '1girl, castle', characterPrompts: [{ prompt: '1girl', enabled: true }] });
assert.strictEqual(plain.prompt, '1girl, castle');
assert.strictEqual(plain.characterPrompts[0].enabled, true);

assert.strictEqual(isBackgroundOnlyRequest({ prompt: '1girl, castle' }, null), false);
assert.strictEqual(isBackgroundOnlyRequest({ backgroundOnly: true, prompt: 'castle' }, null), true);

const generated = applyBackgroundOnlyGeneration({
    prompt: '1girl, castle',
    characterPrompts: scenery.characterPrompts
});
assert.strictEqual(generated.prompt, '1girl, castle, no humans');
assert.ok(generated.prompt.indexOf('1girl, castle') === 0);
assert.strictEqual(generated.characterPrompts[0].prompt, '1girl, blue eyes');
assert.strictEqual(generated.characterPrompts[0].uc, 'bad hands');
assert.strictEqual(generated.characterPrompts[0].enabled, false);
assert.strictEqual(generated.characterPrompts[1].enabled, false);
assert.strictEqual(scenery.characterPrompts[0].enabled, true);

assert.strictEqual(
    applyBackgroundOnlyGeneration({ prompt: 'castle, no humans, moon' }).prompt,
    'castle, no humans, moon'
);
assert.strictEqual(applyBackgroundOnlyGeneration({ prompt: '   ' }).prompt, 'no humans');
assert.strictEqual(applyBackgroundOnlyGeneration({ prompt: 'No Humans, sky' }).prompt, 'No Humans, sky');

const body = applyBackgroundOnlyToBody({
    prompt: '1girl, castle',
    uc: 'lowres',
    allCharacterPrompts: [{ prompt: '1girl, smile', uc: 'extra fingers', enabled: true, chara_name: 'Ada' }]
}, null);
assert.strictEqual(body.prompt, '1girl, castle, no humans');
assert.strictEqual(body.uc, 'lowres');
assert.strictEqual(body.allCharacterPrompts[0].prompt, '1girl, smile');
assert.strictEqual(body.allCharacterPrompts[0].uc, 'extra fingers');
assert.strictEqual(body.allCharacterPrompts[0].chara_name, 'Ada');
assert.strictEqual(body.allCharacterPrompts[0].enabled, false);
assert.deepStrictEqual(body.characterPrompts, []);
assert.strictEqual(body.backgroundOnly, true);

const fromPreset = applyBackgroundOnlyToBody(
    { model: 'v5' },
    { backgroundOnly: true, prompt: 'forest', characterPrompts: [{ prompt: '1girl', enabled: true }] }
);
assert.strictEqual(fromPreset.prompt, 'forest, no humans');
assert.strictEqual(fromPreset.allCharacterPrompts[0].prompt, '1girl');
assert.strictEqual(fromPreset.allCharacterPrompts[0].enabled, false);
assert.deepStrictEqual(fromPreset.characterPrompts, []);

assert.strictEqual(resolvePresetRecord({}, BACKGROUND_ONLY_PRESET_KEY).prompt, 'no humans');
assert.strictEqual(resolvePresetRecord({ Background: custom }, BACKGROUND_ONLY_PRESET_KEY), custom);
assert.strictEqual(resolvePresetRecord({}, 'Portrait'), null);

console.log('test-background-only-preset: ok');
