#!/usr/bin/env node
'use strict';

/**
 * Unit tests for cake pantry consume_cake soft sitting cap / do-not-eat skip
 * (Yozora #151 hard cap → #152 soft override via slices / max_slices).
 * Pure helpers + schema only — does not touch live pantry SQLite or eat cake.
 */

const assert = require('assert');
const {
    applyMultiplier,
    isDoNotEatReason,
    takeSlicesFromItems,
    sumItemSlices,
    resolveSittingBudget,
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
assert.strictEqual(isDoNotEatReason('ship reward for #152'), false);
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
const sittingDefault = takeSlicesFromItems(eligible, MAX_SLICES_PER_SITTING);
assert.strictEqual(sittingDefault.slicesTaken, 8);
assert.strictEqual(sumItemSlices(sittingDefault.remaining) + sumItemSlices(skipped), 13);

// Soft sitting budget (#152)
const dflt = resolveSittingBudget(21, {});
assert.strictEqual(dflt.ok, true);
assert.strictEqual(dflt.budget, 8);
assert.strictEqual(dflt.override, false);

const small = resolveSittingBudget(21, { slices: 3 });
assert.strictEqual(small.budget, 3);
assert.strictEqual(small.override, true);

const raiseViaSlices = resolveSittingBudget(21, { slices: 16 });
assert.strictEqual(raiseViaSlices.budget, 16);
assert.strictEqual(raiseViaSlices.ceiling, 16);
assert.strictEqual(raiseViaSlices.override, true);

const raiseViaMax = resolveSittingBudget(21, { max_slices: 20 });
assert.strictEqual(raiseViaMax.budget, 20);
assert.strictEqual(raiseViaMax.ceiling, 20);

const both = resolveSittingBudget(30, { slices: 12, max_slices: 20 });
assert.strictEqual(both.budget, 12);
assert.strictEqual(both.ceiling, 20);

const bothClamp = resolveSittingBudget(30, { slices: 25, max_slices: 20 });
assert.strictEqual(bothClamp.budget, 20);

const allEligible = resolveSittingBudget(13, { max_slices: 999 });
assert.strictEqual(allEligible.budget, 13);
assert.strictEqual(allEligible.ceiling, 13);

const lowerCap = resolveSittingBudget(21, { max_slices: 4 });
assert.strictEqual(lowerCap.budget, 4);

const bad = resolveSittingBudget(21, { slices: 0 });
assert.strictEqual(bad.ok, false);

const consumeDef = _test.TOOL_DEFS.find((t) => t.name === 'consume_cake');
assert.ok(consumeDef, 'consume_cake tool def missing');
assert.ok(consumeDef.inputSchema.properties.slices, 'optional slices arg missing on consume_cake');
assert.ok(consumeDef.inputSchema.properties.max_slices, 'optional max_slices arg missing on consume_cake');
assert.ok(
    consumeDef.description.includes('soft sitting cap') || consumeDef.description.includes('Soft sitting'),
    'description should mention soft sitting cap'
);
assert.ok(consumeDef.description.includes('max_slices'), 'description should mention max_slices');
assert.ok(
    consumeDef.description.includes('do-not-eat') || consumeDef.description.includes('dry-verify'),
    'description should mention skip'
);
assert.ok(
    consumeDef.description.includes('not auto-generate') || consumeDef.description.includes('does not auto-generate'),
    'description should mention no auto-gen'
);

console.log('test-cake-pantry-consume: ok');
