const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/imageExpansion.js'), 'utf8');
const fn = src.match(/function resolveEnhanceScaleValue\([\s\S]*?\n\}/);
assert.ok(fn, 'expected resolveEnhanceScaleValue in imageExpansion.js');

const ctx = {};
vm.runInNewContext(fn[0], ctx);
const resolve = ctx.resolveEnhanceScaleValue;

const withMax = [
    { value: '1', name: '1×' },
    { value: '1.5', name: '1.5×' },
    { value: '2', name: '2×' },
    { value: 'max', name: 'Max' }
];
const withoutMax = [
    { value: '1', name: '1×' },
    { value: '1.5', name: '1.5×' },
    { value: '2', name: '2×' }
];

assert.strictEqual(resolve(withMax, null, null), 'max', 'fresh Enhance prefers Max over 1.5× / 2×');
assert.strictEqual(resolve(withMax, '', null), 'max', 'empty preferred still prefers Max');
assert.strictEqual(resolve(withMax, '1.5', null), '1.5', 'current dialog pick sticks');
assert.strictEqual(resolve(withMax, null, '1.5'), '1.5', 'last user pick sticks across opens');
assert.strictEqual(resolve(withMax, '2', '1.5'), '2', 'current dialog pick wins over last pick');
assert.strictEqual(resolve(withMax, 'max', '1.5'), 'max', 'current Max pick sticks');
assert.strictEqual(resolve(withoutMax, null, null), '2', 'no Max option keeps prior 2× fallback');
assert.strictEqual(resolve(withoutMax, null, 'max'), '2', 'remembered Max drops when option is gone');
assert.strictEqual(resolve(withoutMax, null, '1.5'), '1.5', 'remembered 1.5× still available without Max');
assert.strictEqual(resolve(withoutMax, 'max', null), '2', 'invalid current Max falls back without trapping 1.5×');
assert.strictEqual(resolve([], null, null), 'max', 'empty options still resolve to Max');

console.log('test-enhance-scale-default: ok');
