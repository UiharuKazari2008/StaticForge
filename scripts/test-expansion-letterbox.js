const assert = require('assert');
const { computeExpansionLetterboxLayout } = require('../modules/expansionLetterbox');

assert.strictEqual(computeExpansionLetterboxLayout(0, 100, 200, 200, 2), null);
assert.strictEqual(computeExpansionLetterboxLayout(100, 100, 0, 200, 2), null);

const portraitToLandscape = computeExpansionLetterboxLayout(832, 1216, 1216, 832, 2);
assert.ok(portraitToLandscape);
assert.strictEqual(portraitToLandscape.scaledHeight, 832);
assert.strictEqual(portraitToLandscape.scaledWidth, Math.round(832 * (832 / 1216)));
assert.strictEqual(portraitToLandscape.top, 0);
assert.strictEqual(portraitToLandscape.padTop, 0);
assert.strictEqual(portraitToLandscape.padBottom, 0);
assert.ok(portraitToLandscape.padLeft > 0);
assert.ok(portraitToLandscape.padRight > 0);
assert.strictEqual(portraitToLandscape.padLeft + portraitToLandscape.scaledWidth + portraitToLandscape.padRight, 1216);

const leftBias = computeExpansionLetterboxLayout(832, 1216, 1216, 832, 0);
assert.strictEqual(leftBias.left, 0);
assert.strictEqual(leftBias.padLeft, 0);
assert.ok(leftBias.padRight > 0);

const rightBias = computeExpansionLetterboxLayout(832, 1216, 1216, 832, 4);
assert.strictEqual(rightBias.padRight, 0);
assert.ok(rightBias.padLeft > 0);

const landscapeToPortrait = computeExpansionLetterboxLayout(1216, 832, 832, 1216, 2);
assert.strictEqual(landscapeToPortrait.left, 0);
assert.ok(landscapeToPortrait.padTop > 0);
assert.ok(landscapeToPortrait.padBottom > 0);

const insetCenter = computeExpansionLetterboxLayout(832, 1216, 1024, 1536, 2, { inset: true });
assert.strictEqual(insetCenter.scaledWidth, 832);
assert.strictEqual(insetCenter.scaledHeight, 1216);
assert.strictEqual(insetCenter.padLeft, 96);
assert.strictEqual(insetCenter.padRight, 96);
assert.strictEqual(insetCenter.padTop, 160);
assert.strictEqual(insetCenter.padBottom, 160);

const insetTop = computeExpansionLetterboxLayout(832, 1216, 1024, 1536, 0, { inset: true });
assert.strictEqual(insetTop.padTop, 0);
assert.strictEqual(insetTop.padBottom, 320);
assert.strictEqual(insetTop.padLeft, 96);

const noInsetSamePair = computeExpansionLetterboxLayout(832, 1216, 1024, 1536, 2, { inset: false });
assert.strictEqual(noInsetSamePair.scaledWidth, 1024);
assert.strictEqual(noInsetSamePair.scaledHeight, Math.round(1024 * (1216 / 832)));
assert.strictEqual(noInsetSamePair.left, 0);
assert.ok(noInsetSamePair.padTop + noInsetSamePair.padBottom > 0);

console.log('test-expansion-letterbox: ok');
