#!/usr/bin/env node
/**
 * Smoke tests for modules/generationFingerprint.js
 * Run: node scripts/test-generation-fingerprint.js
 */
'use strict';

const assert = require('assert');
const { canonicalizeApiOptions } = require('../modules/generationFingerprint');

const baseApi = {
    prompt: '1girl, sitting, smile',
    negative_prompt: 'lowres',
    seed: 1790347424281,
    steps: 28,
    scale: 5,
    sampler: 'k_euler_ancestral'
};

function key(api, upscale, flags) {
    return canonicalizeApiOptions(api || baseApi, upscale, flags);
}

assert.strictEqual(key(), key({ ...baseApi }), 'same request gives the same key');
assert.strictEqual(key(baseApi, false, {}), key(baseApi, false, {}), 'identical calls match');

assert.notStrictEqual(
    key(baseApi, false, { prompt_normalize: true }),
    key(baseApi, false, { prompt_normalize: false }),
    'prompt_normalize true vs false gives different keys'
);
assert.strictEqual(
    key(baseApi, false, {}),
    key(baseApi, false, { prompt_normalize: true }),
    'omitted prompt_normalize matches explicit default true'
);
assert.strictEqual(
    key(baseApi, false, { prompt_normalize: undefined }),
    key(baseApi, false, { prompt_normalize: true }),
    'undefined prompt_normalize matches explicit default true'
);

assert.notStrictEqual(
    key(baseApi, false, { keep_newlines: true }),
    key(baseApi, false, { keep_newlines: false }),
    'keep_newlines true vs false gives different keys'
);
assert.strictEqual(
    key(baseApi, false, {}),
    key(baseApi, false, { keep_newlines: false }),
    'omitted keep_newlines matches explicit default false'
);

assert.notStrictEqual(
    key(baseApi, false, { auto_char_numerize: true }),
    key(baseApi, false, { auto_char_numerize: false }),
    'auto_char_numerize true vs false gives different keys'
);
assert.strictEqual(
    key(baseApi, false, {}),
    key(baseApi, false, { auto_char_numerize: true }),
    'omitted auto_char_numerize matches explicit default true'
);

assert.notStrictEqual(
    key(baseApi, false, { auto_clean_uc: true }),
    key(baseApi, false, { auto_clean_uc: false }),
    'auto_clean_uc true vs false gives different keys'
);
assert.strictEqual(
    key(baseApi, false, {}),
    key(baseApi, false, { auto_clean_uc: true }),
    'omitted auto_clean_uc matches explicit default true'
);

assert.strictEqual(
    key({ ...baseApi }),
    key({ ...baseApi, deduplicate_tags: true }),
    'omitted deduplicate_tags matches explicit default true'
);
assert.notStrictEqual(
    key({ ...baseApi, deduplicate_tags: true }),
    key({ ...baseApi, deduplicate_tags: false }),
    'deduplicate_tags true vs false gives different keys'
);

assert.notStrictEqual(
    key(baseApi, true, {}),
    key(baseApi, false, {}),
    'upscale still changes the key'
);

assert.notStrictEqual(
    key({ ...baseApi, skip_cfg_above_sigma: 59.04722600415217 }),
    key(baseApi),
    'variety (skip_cfg_above_sigma) already changes the key via apiOpts'
);

console.log('test-generation-fingerprint: ok');
