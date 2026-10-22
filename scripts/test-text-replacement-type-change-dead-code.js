const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetPath = path.join(__dirname, '../public/scripts/comp/textReplacementManager.js');

// 1. Verify JS file exists
assert.strictEqual(fs.existsSync(targetPath), true, 'textReplacementManager.js must exist');

// 2. Syntax check via node --check
try {
    execSync(`node --check ${targetPath}`);
} catch (e) {
    assert.fail(`Syntax error in textReplacementManager.js: ${e.message}`);
}

// 3. Verify handleTextReplacementTypeChange function definition is absent
const content = fs.readFileSync(targetPath, 'utf8');
assert.strictEqual(
    content.includes('function handleTextReplacementTypeChange'),
    false,
    'handleTextReplacementTypeChange should no longer be defined in textReplacementManager.js'
);

console.log('test-text-replacement-type-change-dead-code passed successfully!');
