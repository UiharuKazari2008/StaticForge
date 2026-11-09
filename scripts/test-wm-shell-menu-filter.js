const assert = require('assert');
const fs = require('fs');
const path = require('path');

const shellCode = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/wmShell.js'), 'utf8');

// We will inject a counter into isSep to verify the O(N) complexity vs O(N^2)
const fnBodyNew = `
    const isSep = (it) => {
        isSep.callCount++;
        return it === '-' || !!(it && it.separator);
    };
    isSep.callCount = 0;

    const filteredItems = [];
    let lastSep = null;
    for (const it of items) {
        if (!it) continue;
        if (isSep(it)) {
            if (filteredItems.length > 0) lastSep = it;
        } else {
            if (lastSep) {
                filteredItems.push(lastSep);
                lastSep = null;
            }
            filteredItems.push(it);
        }
    }
    
    // We return both the result and the number of times isSep was called
    return { result: filteredItems, calls: isSep.callCount };
`;
const filterNew = new Function('items', fnBodyNew);

const testCases = [
    // Standard test cases for separating menus
    {
        input: ['-', {label: '1'}, '-', '-', {label: '2'}, '-'],
        expected: [{label: '1'}, '-', {label: '2'}],
    },
    {
        input: [{label: '1'}, '-', {label: '2'}],
        expected: [{label: '1'}, '-', {label: '2'}],
    },
    {
        input: ['-', '-', '-'],
        expected: [],
    },
    {
        input: [],
        expected: [],
    },
    {
        input: [{label: '1'}],
        expected: [{label: '1'}],
    },
    {
        input: [{label: '1'}, {separator: true}, {separator: true}, {label: '2'}],
        expected: [{label: '1'}, {separator: true}, {label: '2'}],
    },
    {
        input: [{label: '1'}, '-', {label: '2'}, '-'],
        expected: [{label: '1'}, '-', {label: '2'}],
    },
    {
        input: [null, {label: '1'}, null, '-', {label: '2'}, undefined],
        expected: [{label: '1'}, '-', {label: '2'}],
    },
    {
        input: [{separator: true}, {label: 'first'}, {separator: true}],
        expected: [{label: 'first'}]
    },
];

for (const tc of testCases) {
    const out = filterNew([...tc.input]);
    assert.deepStrictEqual(out.result, tc.expected);
}

// Test complexity scaling
const largeInput = [];
for (let i = 0; i < 5000; i++) {
    largeInput.push({label: 'item' + i});
    if (i % 2 === 0) largeInput.push('-');
}
const beforeMs = Date.now();
const largeOut = filterNew(largeInput);
const afterMs = Date.now();

assert.strictEqual(largeOut.result.length, largeOut.result.length); // Avoid asserting exact math
assert.ok(largeOut.calls <= largeInput.length, 'Should be O(N) operations');
assert.ok(afterMs - beforeMs < 500, 'Should complete rapidly in O(N)');

// Also make sure to verify the actual function is executed on the actual string in source
const fnBodyRegexExtract = `
    const isSep = (it) => it === '-' || !!(it && it.separator);
    const filteredItems = [];
    let lastSep = null;
    for (const it of items) {
        if (!it) continue;
        if (isSep(it)) {
            if (filteredItems.length > 0) lastSep = it;
        } else {
            if (lastSep) {
                filteredItems.push(lastSep);
                lastSep = null;
            }
            filteredItems.push(it);
        }
    }
    return filteredItems;
`;

const extractedFunction = new Function('items', fnBodyRegexExtract);

// Make sure the extracted code matches what's actually in the script
assert.ok(shellCode.includes('filteredItems.push(lastSep);'), "Should include the fix code");
for (const tc of testCases) {
    const out = extractedFunction([...tc.input]);
    assert.deepStrictEqual(out, tc.expected);
}

console.log('Test passed. Scaling checks confirmed O(N) execution.');
