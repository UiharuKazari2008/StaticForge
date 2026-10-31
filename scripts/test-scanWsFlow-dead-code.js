'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const targetPath = path.join(__dirname, '../modules/flowMap/scanWsFlow.js');

// 1. Verify JS file exists
assert.strictEqual(fs.existsSync(targetPath), true, 'scanWsFlow.js must exist');

// 2. Syntax check via node --check
try {
    execSync(`node --check ${targetPath}`);
} catch (e) {
    assert.fail(`Syntax error in scanWsFlow.js: ${e.message}`);
}

// 3. Verify extractQuotedStrings function definition is absent
const content = fs.readFileSync(targetPath, 'utf8');
assert.strictEqual(
    content.includes('function extractQuotedStrings'),
    false,
    'extractQuotedStrings should no longer be defined in scanWsFlow.js'
);

// 4. Verify scanWsFlow module exports and functions load cleanly
const scanWsFlowModule = require(targetPath);
assert.strictEqual(typeof scanWsFlowModule.scanWsFlow, 'function');
assert.strictEqual(typeof scanWsFlowModule.buildWsLinks, 'function');
assert.strictEqual(scanWsFlowModule.extractQuotedStrings, undefined);

console.log('✅ test-scanWsFlow-dead-code passed successfully!');
