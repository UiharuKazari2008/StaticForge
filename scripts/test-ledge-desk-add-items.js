'use strict';

const assert = require('assert');
const { openSession, addItems, applyLedge } = require('../modules/ledgeDesk');

// Test 1: Add items without specifying index (default prepend)
const session1 = openSession({ name: 'Test Session 1' }).session;
const initialItems = addItems(session1, [{ filename: 'a.png' }, { filename: 'b.png' }]);

assert.strictEqual(initialItems.length, 2);
assert.strictEqual(initialItems[0].index, 0);
assert.strictEqual(initialItems[0].filename, 'a.png');
assert.strictEqual(initialItems[1].index, 1);
assert.strictEqual(initialItems[1].filename, 'b.png');

// Prepend items when index is null/undefined
const prependedItems = addItems(session1, [{ filename: 'c.png' }, { filename: 'd.png' }]);
assert.strictEqual(prependedItems.length, 2);
assert.strictEqual(prependedItems[0].index, 0);
assert.strictEqual(prependedItems[0].filename, 'c.png');
assert.strictEqual(prependedItems[1].index, 1);
assert.strictEqual(prependedItems[1].filename, 'd.png');

// Verify session1 items order: c.png, d.png, a.png, b.png
assert.strictEqual(session1.items.length, 4);
assert.strictEqual(session1.items[0].filename, 'c.png');
assert.strictEqual(session1.items[1].filename, 'd.png');
assert.strictEqual(session1.items[2].filename, 'a.png');
assert.strictEqual(session1.items[3].filename, 'b.png');

applyLedge({ op: 'dispose', sessionId: session1.id });

// Test 2: Add items at specific index
const session2 = openSession({ name: 'Test Session 2' }).session;
addItems(session2, [{ filename: '1.png' }, { filename: '2.png' }]);

// Insert at index 1
const insertedItems = addItems(session2, [{ filename: 'mid1.png' }, { filename: 'mid2.png' }], 1);
assert.strictEqual(insertedItems.length, 2);
assert.strictEqual(insertedItems[0].index, 1);
assert.strictEqual(insertedItems[0].filename, 'mid1.png');
assert.strictEqual(insertedItems[1].index, 2);
assert.strictEqual(insertedItems[1].filename, 'mid2.png');

// Verify session2 items order: 1.png, mid1.png, mid2.png, 2.png
assert.strictEqual(session2.items.length, 4);
assert.strictEqual(session2.items[0].filename, '1.png');
assert.strictEqual(session2.items[1].filename, 'mid1.png');
assert.strictEqual(session2.items[2].filename, 'mid2.png');
assert.strictEqual(session2.items[3].filename, '2.png');

applyLedge({ op: 'dispose', sessionId: session2.id });

console.log('✅ test-ledge-desk-add-items.js passed');
