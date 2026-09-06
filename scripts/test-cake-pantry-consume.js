#!/usr/bin/env node
'use strict';

/**
 * Unit tests for cake pantry consume_cake sitting cap / do-not-eat skip (Yozora #151).
 * Pure helpers + schema only — does not touch live pantry SQLite or eat cake.
 */

const assert = require('assert');
const {
    applyMultiplier,
    isDoNotEatReason,
    takeSlicesFromItems,
    sumItemSlices,
    MAX_SLICES_PER_SITTING,
    KG_PER_SLICE
} = require('../modules/cakePantry');
const { _test } = require('../modules/mcpAgentFacade');

assert.strictEqual(MAX_SLICES_PER_SITTING, 8);
assert.strictEqual(KG_PER_SLICE, 0.12);

assert.strictEqual(applyMultiplier(1, 'grok.menma'), 2);
assert.strictEqual(applyMultiplier(4, 'grok.menma'), 5);

assert.strictEqual(isDoNotEatReason('Dry-verify do not eat'), true);
assert.strictEqual(isDoNotEatReason('DO-NOT-EAT marker'), true);
assert.strictEqual(isDoNotEatReason('dry verify pantry probe'), true);
assert.strictEqual(isDoNotEatReason('DRY-VERIFY'), true);
assert.strictEqual(isDoNotEatReason('ship reward for #151'), false);
assert.strictEqual(isDoNotEatReason(null), false);
assert.strictEqual(isDoNotEatReason(''), false);

const items = [
    { id: 'a', slices: 3, reason: 'real A' },
    { id: 'b', slices: 10, reason: 'real B' },
    { id: 'c', slices: 2, reason: 'real C' }
];
const taken8 = takeSlicesFromItems(items, 8);
assert.strictEqual(taken8.slicesTaken, 8);
assert.strictEqual(taken8.taken.length, 2);
assert.strictEqual(taken8.taken[0].id, 'a');
assert.strictEqual(taken8.taken[1].id, 'b');
assert.strictEqual(taken8.taken[1].slices, 5);
assert.strictEqual(taken8.taken[1]._partial, true);
assert.strictEqual(taken8.remaining.length, 2);
assert.strictEqual(taken8.remaining[0].id, 'b');
assert.strictEqual(taken8.remaining[0].slices, 5);
assert.strictEqual(taken8.remaining[1].id, 'c');

const mixed = [
    { id: 'dry', slices: 5, reason: 'dry-verify do not eat' },
    { id: 'real', slices: 16, reason: '11am meal pile' }
];
const eligible = mixed.filter((d) => !isDoNotEatReason(d.reason));
const skipped = mixed.filter((d) => isDoNotEatReason(d.reason));
assert.strictEqual(sumItemSlices(eligible), 16);
assert.strictEqual(sumItemSlices(skipped), 5);
const sitting = takeSlicesFromItems(eligible, MAX_SLICES_PER_SITTING);
assert.strictEqual(sitting.slicesTaken, 8);
assert.strictEqual(sumItemSlices(sitting.remaining) + sumItemSlices(skipped), 13);

const consumeDef = _test.TOOL_DEFS.find((t) => t.name === 'consume_cake');
assert.ok(consumeDef, 'consume_cake tool def missing');
assert.ok(consumeDef.inputSchema.properties.slices, 'optional slices arg missing on consume_cake');
assert.ok(consumeDef.description.includes('max 8'), 'description should mention 8-cap');
assert.ok(
    consumeDef.description.includes('do-not-eat') || consumeDef.description.includes('dry-verify'),
    'description should mention skip'
);
assert.ok(
    consumeDef.description.includes('not auto-generate') || consumeDef.description.includes('does not auto-generate'),
    'description should mention no auto-gen'
);

console.log('test-cake-pantry-consume: ok');
