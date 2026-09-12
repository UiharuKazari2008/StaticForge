#!/usr/bin/env node
'use strict';

/**
 * pickLogEntry / composeCakeLogEntry image wiring (Yozora #190).
 * DSAP Log/Status read cake_log.before/after; inspect_pantry uses the same
 * SQLite row. Aliases and extra_data must not drop provided filenames.
 * Does not touch live pantry SQLite.
 */

const assert = require('assert');
const {
    pickLogEntry,
    composeCakeLogEntry,
    firstSafeImage,
    safeImageName
} = require('../modules/menmaStatus');

const IVORY_BEFORE = '1788887354858_generated_2779763718.png';
const IVORY_AFTER = '1788887375993_generated_2137548186.png';

assert.strictEqual(safeImageName(IVORY_BEFORE), IVORY_BEFORE);
assert.strictEqual(safeImageName('not-an-image'), null);
assert.strictEqual(firstSafeImage({ before_image: IVORY_BEFORE }, ['before', 'before_image']), IVORY_BEFORE);

const fromConsume = pickLogEntry({
    at: '2026-09-12T23:41:26.375Z',
    loop: 'pantry-7:30pm',
    slices: 8,
    before: IVORY_BEFORE,
    after: IVORY_AFTER,
    visual_gen_status: 'provided'
});
assert.strictEqual(fromConsume.before, IVORY_BEFORE);
assert.strictEqual(fromConsume.after, IVORY_AFTER);

const fromAliases = pickLogEntry({
    at: '2026-09-12T23:41:26.375Z',
    slices: 8,
    before_image: IVORY_BEFORE,
    after_image: IVORY_AFTER
});
assert.strictEqual(fromAliases.before, IVORY_BEFORE);
assert.strictEqual(fromAliases.after, IVORY_AFTER);

const fromCols = pickLogEntry({
    at: 'x',
    slices: 1,
    before_img: IVORY_BEFORE,
    after_img: IVORY_AFTER
});
assert.strictEqual(fromCols.before, IVORY_BEFORE);
assert.strictEqual(fromCols.after, IVORY_AFTER);

const menmaNull = pickLogEntry({
    at: '2026-09-12T23:03:00.000Z',
    loop: '7pm-dinner',
    slices: 8,
    before: null,
    after: null,
    visual_gen_status: 'not_generated'
});
assert.strictEqual(menmaNull.before, null);
assert.strictEqual(menmaNull.after, null);

const extraClobber = composeCakeLogEntry({
    at: '2026-09-12T23:41:26.375Z',
    loop: 'pantry-7:30pm',
    slices: 8,
    cake_type: 'strawberry shortcake',
    before_img: IVORY_BEFORE,
    after_img: IVORY_AFTER,
    named_for: '["first pantry plate"]',
    landed: '[]',
    left_open: '[]',
    extra_data: JSON.stringify({
        before: null,
        after: null,
        visual_gen_status: 'provided',
        landscape: false
    })
});
assert.strictEqual(extraClobber.before, IVORY_BEFORE);
assert.strictEqual(extraClobber.after, IVORY_AFTER);
assert.strictEqual(extraClobber.visual_gen_status, 'provided');

const extraAliasOnly = composeCakeLogEntry({
    at: '2026-09-12T23:41:26.375Z',
    slices: 8,
    before_img: null,
    after_img: null,
    extra_data: JSON.stringify({
        before_image: IVORY_BEFORE,
        after_image: IVORY_AFTER,
        visual_gen_status: 'provided'
    })
});
assert.strictEqual(extraAliasOnly.before, IVORY_BEFORE);
assert.strictEqual(extraAliasOnly.after, IVORY_AFTER);

const dsapPayload = pickLogEntry(extraClobber);
assert.strictEqual(dsapPayload.before, IVORY_BEFORE);
assert.strictEqual(dsapPayload.after, IVORY_AFTER);
assert.ok(!dsapPayload.visual_gen_status);

const aliasPayload = pickLogEntry(extraAliasOnly);
assert.strictEqual(aliasPayload.before, IVORY_BEFORE);
assert.strictEqual(aliasPayload.after, IVORY_AFTER);

console.log('test-menma-status-pick-log: ok');
