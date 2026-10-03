const assert = require('assert');
const {
    stripNoTextTag,
    qualityPresetStripCandidates,
    compileTextOverlayAppend,
    textOverlayTagEmphasis
} = require('../modules/promptTextBoundary');

assert.strictEqual(stripNoTextTag('1girl, no text, looking at viewer'), '1girl, looking at viewer');
assert.strictEqual(stripNoTextTag('no text, 1girl'), '1girl');
assert.strictEqual(stripNoTextTag('1girl, very aesthetic, masterpiece, no text'), '1girl, very aesthetic, masterpiece');
assert.ok(stripNoTextTag('1girl, Text: hello no text on the sign').includes('Text: hello no text on the sign'));

const candidates = qualityPresetStripCandidates('very aesthetic, masterpiece');
assert.ok(candidates[0] === 'very aesthetic, masterpiece, no text' || candidates.includes('very aesthetic, masterpiece, no text'));
assert.ok(candidates.includes('very aesthetic, masterpiece'));
assert.ok(candidates[0].length >= candidates[1].length);

assert.strictEqual(textOverlayTagEmphasis(5), 1.5);
assert.strictEqual(textOverlayTagEmphasis(200), 5.5);

const speechTags = {
    speech: { tags: 'english text, speech bubble' },
    caption: { tags: 'english text, caption, subtitle' }
};
function markBias(input, emphasis) {
    return `${emphasis}::${input}::`;
}

const one = compileTextOverlayAppend([{ text: 'Hello', type: 'speech' }], speechTags, markBias);
assert.strictEqual((one.match(/\btext:/ig) || []).length, 1);
assert.ok(one.includes('Text: Hello'));
assert.ok(one.indexOf('english text') < one.toLowerCase().indexOf('text:'));

const multi = compileTextOverlayAppend([
    { text: 'Oh, so you found out.', type: 'speech' },
    { text: 'I can\'t have you running off.', type: 'speech' },
    { text: 'Though, if I turned you.', type: 'speech' }
], speechTags, markBias);
assert.strictEqual((multi.match(/\btext:/ig) || []).length, 1);
assert.ok(multi.includes('Oh, so you found out.\n\nI can\'t have you running off.\n\nThough, if I turned you.'));
assert.strictEqual(multi.split('english text').length - 1, 1);

const kept = compileTextOverlayAppend([{ text: 'line one\nline two', type: 'speech' }], speechTags, markBias);
assert.ok(kept.includes('Text: line one\nline two'));
assert.ok(!kept.includes('line one\n\nline two'));

const mixed = compileTextOverlayAppend([
    { text: 'Hi', type: 'speech' },
    { text: 'Caption line', type: 'caption' }
], speechTags, markBias);
assert.strictEqual((mixed.match(/\btext:/ig) || []).length, 1);
assert.ok(mixed.includes('speech bubble'));
assert.ok(mixed.includes('caption, subtitle'));
assert.ok(mixed.includes('Hi\n\nCaption line'));
assert.ok(mixed.indexOf('speech bubble') < mixed.toLowerCase().indexOf('text:'));
assert.ok(mixed.indexOf('caption, subtitle') < mixed.toLowerCase().indexOf('text:'));

console.log('test-prompt-text-boundary: ok');
