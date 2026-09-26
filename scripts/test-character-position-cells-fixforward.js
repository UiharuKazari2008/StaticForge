#!/usr/bin/env node
/**
 * #245 regression: occupied position cells fall back to positionX/positionY
 * when positionCell is empty (position tool clears positionCell).
 * Run: node scripts/test-character-position-cells-fixforward.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/characterPromptManager.js'), 'utf8');

function extractFunction(name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing function ${name}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced function ${name}`);
}

const item = (id, dataset, cls = 'character-prompt-item') => ({
    id,
    dataset,
    classList: { contains: (c) => c === cls }
});

const ctx = {
    characterPromptsContainer: {
        children: [
            item('c1', { positionCell: 'A1' }),
            item('c2', { positionX: '0.7', positionY: '0.3' }),
            item('c3', { positionX: '', positionY: '' }),
            item('c4', { positionX: '0.42', positionY: '0.3' }),
            item('c5', { positionCell: 'E5' }),
            item('other', { positionCell: 'C3' }, 'not-a-character')
        ]
    }
};
vm.createContext(ctx);
vm.runInContext(extractFunction('getCellLabelFromCoords') + '\n' + extractFunction('getOccupiedPositionCellLabels'), ctx);
const occupied = vm.runInContext('getOccupiedPositionCellLabels', ctx);

assert.deepStrictEqual(Array.from(occupied(null)).sort(), ['A1', 'D2', 'E5'],
    'cells from positionCell plus positionX/positionY fallback');
assert.deepStrictEqual(Array.from(occupied('c2')).sort(), ['A1', 'E5'], 'excluded character is skipped');
console.log('ok: coordinate fallback for occupied cells');

console.log('\ntest-character-position-cells-fixforward: all passed');
