const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { execSync } = require('child_process');

console.log('Running defect sweep regression tests...');

// 1. Check syntax compilation using node --check
const filesToCheck = [
    'public/scripts/comp/balanceDisplay.js',
    'public/scripts/comp/utilities.js'
];

filesToCheck.forEach(f => {
    execSync(`node --check "${f}"`, { stdio: 'inherit' });
});
console.log('✓ Syntax checks passed.');

// 2. Check balanceDisplay.js content
const balanceDisplayContent = fs.readFileSync('public/scripts/comp/balanceDisplay.js', 'utf8');
assert.strictEqual(
    balanceDisplayContent.includes('function toggleSubMenu'),
    false,
    'toggleSubMenu dead code should be removed'
);
assert.strictEqual(
    balanceDisplayContent.includes('function closeSubMenu'),
    true,
    'closeSubMenu function should be defined'
);
assert.strictEqual(
    balanceDisplayContent.includes('menu.forEach(menu =>'),
    false,
    'variable shadowing in closeSubMenu should be fixed'
);
console.log('✓ balanceDisplay.js checks passed.');

// 3. Check utilities.js content
const utilitiesContent = fs.readFileSync('public/scripts/comp/utilities.js', 'utf8');
assert.strictEqual(
    utilitiesContent.includes('TODO: Move actual implementations from app.js here'),
    false,
    'stale TODO comment should be removed'
);
console.log('✓ utilities.js checks passed.');

console.log('ALL DEFECT SWEEP TESTS PASSED SUCCESSFULLY.');
