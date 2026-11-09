const assert = require('assert');
const fs = require('fs');

const code = fs.readFileSync('public/scripts/comp/explorerApplet.js', 'utf8');

// Verify our code logic exists
assert(code.includes('const dragIds = new Set(dragItems.map(i => i.id));'), 'Optimization logic missing from source code!');
assert(code.includes('const fromHere = this.items.some(x => dragIds.has(x.id));'), 'Optimization logic missing from source code!');
assert(!code.includes('dragItems.some(i => this.items.some(x => x.id === i.id))'), 'Original slow logic still in source code!');

const items = Array.from({ length: 50000 }, (_, i) => ({ id: `item-${i}` }));
const dragItems = Array.from({ length: 2500 }, (_, i) => ({ id: `drag-${i}` }));
// add one matching item at the very end
dragItems.push({ id: 'item-49999' });

// Old implementation simulation
const start1 = Date.now();
let fromHere1 = false;
fromHere1 = dragItems.some(i => items.some(x => x.id === i.id));
const end1 = Date.now();

// New implementation simulation
const start2 = Date.now();
let fromHere2 = false;
const dragIds = new Set(dragItems.map(i => i.id));
fromHere2 = items.some(x => dragIds.has(x.id));
const end2 = Date.now();

console.log(`Original duration: ${end1 - start1}ms`);
console.log(`Optimized duration: ${end2 - start2}ms`);
console.log(`Original result: ${fromHere1}`);
console.log(`Optimized result: ${fromHere2}`);

assert.strictEqual(fromHere1, fromHere2, 'Output should be strictly identical');
assert.strictEqual(fromHere1, true, 'Result should be true');

if ((end1 - start1) < (end2 - start2) && (end1 - start1) > 10) {
    throw new Error('Optimized version was slower!');
}

console.log('Test passed successfully.');
