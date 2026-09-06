#!/usr/bin/env node
'use strict';

/**
 * Unit tests for cake pantry consume_cake soft sitting cap / do-not-eat skip
 * (Yozora #151 hard cap → #152 soft override → #154 cake_type/flag skip).
 * Pure helpers + schema only — does not touch live pantry SQLite or eat cake.
 */

const assert = require('assert');
const {
    applyMultiplier,
    isDoNotEatReason,
    isDoNotEatItem,
    legacyReasonIsDoNotEat,
    resolveDoNotEatFields,
    stampDoNotEatMigration,
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

// Legacy prefix-only reason match (#154 — not mid-string substring)
assert.strictEqual(isDoNotEatReason('Dry-verify do not eat'), true);
assert.strictEqual(isDoNotEatReason('DO-NOT-EAT marker'), true);
assert.strictEqual(isDoNotEatReason('dry verify pantry probe'), true);
assert.strictEqual(isDoNotEatReason('DRY-VERIFY'), true);
assert.strictEqual(isDoNotEatReason('ship reward for #152'), false);
assert.strictEqual(isDoNotEatReason('ship:#154 note: skip do-not-eat leftover'), false);
assert.strictEqual(isDoNotEatReason('please skip do-not-eat'), false);
assert.strictEqual(isDoNotEatReason(null), false);
assert.strictEqual(isDoNotEatReason(''), false);
assert.strictEqual(legacyReasonIsDoNotEat('skip do-not-eat'), false);

// Prefer cake_type / do_not_eat flag
assert.strictEqual(isDoNotEatItem({ cake_type: 'dry-verify', reason: 'anything' }), true);
assert.strictEqual(isDoNotEatItem({ cake_type: 'Dry Verify', reason: 'ship' }), true);
assert.strictEqual(isDoNotEatItem({ do_not_eat: true, reason: 'normal ship' }), true);
assert.strictEqual(isDoNotEatItem({ do_not_eat: 'yes', reason: 'x' }), true);
assert.strictEqual(isDoNotEatItem({ reason: 'ship:#154 note: skip do-not-eat' }), false);
assert.strictEqual(isDoNotEatItem({ reason: 'dry-verify pantry probe' }), true);
assert.strictEqual(isDoNotEatItem({ cake_type: 'strawberry', reason: 'ship' }), false);

const resolvedType = resolveDoNotEatFields({ cake_type: 'dry-verify', reason: 'probe' });
assert.strictEqual(resolvedType.do_not_eat, true);
assert.strictEqual(resolvedType.cake_type, 'dry-verify');
const resolvedFlag = resolveDoNotEatFields({ do_not_eat: true, reason: 'probe' });
assert.strictEqual(resolvedFlag.do_not_eat, true);
assert.strictEqual(resolvedFlag.cake_type, 'dry-verify');
const resolvedNormal = resolveDoNotEatFields({ cake_type: 'tiramisu', reason: 'ship' });
assert.strictEqual(resolvedNormal.do_not_eat, false);
assert.strictEqual(resolvedNormal.cake_type, 'tiramisu');

const stamped = stampDoNotEatMigration({ id: 'legacy', slices: 1, reason: 'dry-verify pantry probe' });
assert.strictEqual(stamped.do_not_eat, true);
assert.strictEqual(stamped.cake_type, 'dry-verify');
const notStamped = stampDoNotEatMigration({ id: 'ship', slices: 2, reason: 'skip do-not-eat note' });
assert.strictEqual(notStamped.do_not_eat, undefined);
assert.strictEqual(isDoNotEatItem(notStamped), false);

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
    { id: 'dry', slices: 5, cake_type: 'dry-verify', reason: 'probe' },
    { id: 'falsepos', slices: 4, reason: 'ship reward — skip do-not-eat leftover' },
    { id: 'real', slices: 16, reason: '11am meal pile' }
];
const eligible = mixed.filter((d) => !isDoNotEatItem(d));
const skipped = mixed.filter((d) => isDoNotEatItem(d));
assert.strictEqual(sumItemSlices(eligible), 20); // falsepos + real
assert.strictEqual(sumItemSlices(skipped), 5);
const sittingDefault = takeSlicesFromItems(eligible, MAX_SLICES_PER_SITTING);
assert.strictEqual(sittingDefault.slicesTaken, 8);
assert.strictEqual(sumItemSlices(sittingDefault.remaining) + sumItemSlices(skipped), 17);

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
    consumeDef.description.includes('do_not_eat') || consumeDef.description.includes('cake_type=dry-verify'),
    'description should mention cake_type/flag skip'
);
assert.ok(
    consumeDef.description.includes('not auto-generate') || consumeDef.description.includes('does not auto-generate'),
    'description should mention no auto-gen'
);

const deliverDef = _test.TOOL_DEFS.find((t) => t.name === 'deliver_cake');
assert.ok(deliverDef.inputSchema.properties.do_not_eat, 'deliver_cake needs do_not_eat');
const feedDef = _test.TOOL_DEFS.find((t) => t.name === 'feed_cake');
assert.ok(feedDef.inputSchema.properties.do_not_eat, 'feed_cake needs do_not_eat');

console.log('test-cake-pantry-consume: ok');
