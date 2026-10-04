'use strict';
// img2img strength/noise: an explicit 0 must not fall back to the default (|| -> finite check).
// Run: node scripts/test-img2img-zero-params.js
const assert = require('assert');
const { img2imgNumber } = require('../modules/imageGeneration');

assert.strictEqual(img2imgNumber(0.1, 0), 0, 'noise 0 kept');
assert.strictEqual(img2imgNumber(0.1, '0'), 0, 'noise "0" kept');
assert.strictEqual(img2imgNumber(0.8, 0), 0, 'strength 0 kept');
assert.strictEqual(img2imgNumber(0.1, undefined), 0.1);
assert.strictEqual(img2imgNumber(0.1, null), 0.1);
assert.strictEqual(img2imgNumber(0.1, ''), 0.1);
assert.strictEqual(img2imgNumber(0.1, 'abc'), 0.1);
assert.strictEqual(img2imgNumber(0.1, 0.35), 0.35);
assert.strictEqual(img2imgNumber(1, undefined, 0.6), 0.6, 'inpaint falls through to strength');
assert.strictEqual(img2imgNumber(1, 0, 0.6), 0, 'inpainting_strength 0 kept');
assert.strictEqual(img2imgNumber(1, undefined, undefined), 1);
console.log('test-img2img-zero-params: ok');
