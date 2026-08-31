const assert = require('assert');
const {
    stripNoTextTag,
    qualityPresetStripCandidates
} = require('../modules/promptTextBoundary');

assert.strictEqual(stripNoTextTag('1girl, no text, looking at viewer'), '1girl, looking at viewer');
assert.strictEqual(stripNoTextTag('no text, 1girl'), '1girl');
assert.strictEqual(stripNoTextTag('1girl, very aesthetic, masterpiece, no text'), '1girl, very aesthetic, masterpiece');
assert.ok(stripNoTextTag('1girl, Text: hello no text on the sign').includes('Text: hello no text on the sign'));

const candidates = qualityPresetStripCandidates('very aesthetic, masterpiece');
assert.ok(candidates[0] === 'very aesthetic, masterpiece, no text' || candidates.includes('very aesthetic, masterpiece, no text'));
assert.ok(candidates.includes('very aesthetic, masterpiece'));
assert.ok(candidates[0].length >= candidates[1].length);

console.log('test-prompt-text-boundary: ok');
