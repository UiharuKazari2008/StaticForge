'use strict';

// Studio's token budget counts Rentan (dynamic generation) text replacements by what they change,
// as the server applies them (modules/dynamicGenerationHandlers.js): a replace adds the difference,
// an append / append-to-end (EOF) adds the whole text, a replacement whose select_text is not in
// the prompt adds nothing. Counting every replace_text in full overstated the "tokens free" badge.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/presetTokenCount.js'), 'utf8');
// one token per word: enough to check the arithmetic
const countTokensForText = (text) => String(text || '').split(/[\s,]+/).filter(Boolean).length;
const sandbox = {
    window: {},
    getPromptTokenizer: () => ({ countTokens: countTokensForText }),
    getManualEffort: () => 'high',
    console
};
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: 'presetTokenCount.js' });

sandbox.window.dynamicGenerationData = {
    compiled_prompt: {
        text_replacements: {
            prompt: [
                { select_text: 'rain', replace_text: 'overcast sky' },                 // +1
                { select_text: '1girl', replace_text: '1girl with light sweat sheen' }, // +4
                { select_text: 'EOF', replace_text: ', still air, golden tones' },      // +4
                { select_text: 'sidewalk', replace_text: 'wet', action: 'append' },     // +1
                { select_text: 'not in the prompt', replace_text: 'a b c d e' },        // 0
                { select_text: 'missing', fallback_select_text: 'city view', replace_text: 'autumn city view now' } // 4 - 2 = +2
            ],
            uc: [{ select_text: 'EOF', replace_text: ', drizzle, wet' }],               // +2
            character_prompts: [{
                prompt: [{ select_text: 'standing', replace_text: 'standing tall' }],   // +1
                input: [{ select_text: 'EOF', replace_text: 'ignored by the server' }]  // 0: not a field the server applies
            }]
        }
    }
};

const promptTexts = ['1girl, sidewalk, city view, rain', 'girl, standing'];
const delta = vm.runInContext('computeRentanTokenDelta', sandbox)(promptTexts, ['lowres']);
assert.strictEqual(delta.prompt, 1 + 4 + 4 + 1 + 0 + 2 + 1, 'prompt delta counts differences, appends and skips misses');
assert.strictEqual(delta.uc, 2, 'uc append counted');

// shortening replaces never push the total below zero
sandbox.window.dynamicGenerationData.compiled_prompt.text_replacements = {
    prompt: [{ select_text: 'very long phrase here', replace_text: 'short' }]
};
assert.strictEqual(vm.runInContext('computeRentanTokenDelta', sandbox)(['a very long phrase here'], []).prompt, 0);

console.log('test-rentan-token-delta: ok');
