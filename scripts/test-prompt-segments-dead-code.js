// JULES: Regression test for dead code removal in modules/promptSegments.js
const assert = require('assert');
const promptSegments = require('../modules/promptSegments');

console.log('Running test-prompt-segments-dead-code.js...');

// 1. Verify findNextWeightStart is not exported
assert.strictEqual(
    promptSegments.findNextWeightStart,
    undefined,
    'findNextWeightStart should not be exported or present'
);

// 2. Verify exported functions exist
assert.strictEqual(typeof promptSegments.parsePromptSegments, 'function');
assert.strictEqual(typeof promptSegments.extractSeparatorFormat, 'function');
assert.strictEqual(typeof promptSegments.hydrateTextReplacements, 'function');
assert.strictEqual(typeof promptSegments.resolveSelectTextFromSegments, 'function');

// 3. Test parsePromptSegments functionality
const promptText = 'masterpiece, best quality, 1.2::blue eyes::, 1.5::blonde hair::';
const segments = promptSegments.parsePromptSegments(promptText);

assert.strictEqual(Array.isArray(segments), true);
assert.strictEqual(segments.length, 4);
assert.strictEqual(segments[0].text, 'masterpiece');
assert.strictEqual(segments[1].text, 'best quality');
assert.strictEqual(segments[2].text, '1.2::blue eyes::');
assert.strictEqual(segments[2].weight, 1.2);
assert.strictEqual(segments[3].text, '1.5::blonde hair::');
assert.strictEqual(segments[3].weight, 1.5);

// 4. Test extractSeparatorFormat functionality
const sep = promptSegments.extractSeparatorFormat(promptText, segments[0], segments[1]);
assert.strictEqual(sep, ', ');

console.log('✅ test-prompt-segments-dead-code.js passed successfully.');
