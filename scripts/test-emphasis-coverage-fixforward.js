#!/usr/bin/env node
/**
 * #243 regression: covered-range checks must see containment by an outer,
 * earlier range when groups are nested (no extra highlight specs).
 * Run: node scripts/test-emphasis-coverage-fixforward.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/emphasisHighlight.js'), 'utf8');
const ctx = {
    console,
    document: { addEventListener() {} },
    weightFromBraceLevel: () => 1
};
vm.createContext(ctx);
vm.runInContext(src, ctx);

const insert = vm.runInContext('emphasisCoveredRangesInsert', ctx);
const rangeCovered = vm.runInContext('emphasisRangeIsCovered', ctx);
const indexCovered = vm.runInContext('emphasisIndexIsCovered', ctx);
const collectSpecs = vm.runInContext('collectEmphasisWeightGroupSpecs', ctx);
const listBounds = vm.runInContext('listEmphasisWeightGroupBoundsForCaret', ctx);

// Inner range inserted first, outer range second: outer sorts before inner.
const ranges = [];
insert(ranges, 4, 12);
insert(ranges, 0, 18);
assert.ok(rangeCovered(ranges, 14, 17), 'range after inner, inside outer is covered');
assert.ok(indexCovered(ranges, 14), 'index after inner, inside outer is covered');
assert.ok(rangeCovered(ranges, 5, 11), 'range inside inner is covered');
assert.ok(!rangeCovered(ranges, 14, 20), 'range crossing outer end is not covered');
assert.ok(!indexCovered(ranges, 18), 'index at outer end is not covered');
assert.ok(!rangeCovered([], 0, 1), 'empty list');
console.log('ok: nested range coverage');

const text = '{a, 1.5::b::, [x]}';
const kinds = Array.from(collectSpecs(text, null), (s) => s.kind);
assert.deepStrictEqual(kinds, ['brace', 'classic'], `collect specs: ${JSON.stringify(kinds)}`);
const boundKinds = Array.from(listBounds(text), (b) => b.kind);
assert.deepStrictEqual(boundKinds, ['brace', 'classic'], `caret bounds: ${JSON.stringify(boundKinds)}`);
console.log('ok: no extra spec for bracket nested in brace group');

console.log('\ntest-emphasis-coverage-fixforward: all passed');
