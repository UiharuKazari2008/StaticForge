'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// Handle missing sharp module in sandbox environment if necessary
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'sharp') return {};
    return origLoad.apply(this, arguments);
};

const targetPath = path.join(__dirname, '../modules/appIconRuntimeAssets.js');

// 1. Verify JS file exists
assert.strictEqual(fs.existsSync(targetPath), true, 'appIconRuntimeAssets.js must exist');

// 2. Syntax check via node --check
try {
    execSync(`node --check ${targetPath}`);
} catch (e) {
    assert.fail(`Syntax error in appIconRuntimeAssets.js: ${e.message}`);
}

// 3. Verify module loads cleanly and exports expected functions
const appIconRuntimeAssets = require(targetPath);
assert.strictEqual(typeof appIconRuntimeAssets.compileAppIcons, 'function', 'compileAppIcons should be exported');
assert.strictEqual(typeof appIconRuntimeAssets.isAppIconWebPath, 'function', 'isAppIconWebPath should be exported');
assert.strictEqual(typeof appIconRuntimeAssets.parseAppIconWebPath, 'function', 'parseAppIconWebPath should be exported');
assert.strictEqual(typeof appIconRuntimeAssets.resolveServedAppIconPath, 'function', 'resolveServedAppIconPath should be exported');
assert.strictEqual(typeof appIconRuntimeAssets.webPathFor, 'undefined', 'webPathFor should not be exported');

// 4. Verify webPathFor function definition is absent from the file
const content = fs.readFileSync(targetPath, 'utf8');
assert.strictEqual(
    content.includes('function webPathFor('),
    false,
    'webPathFor should no longer be defined in appIconRuntimeAssets.js'
);

console.log('test-app-icon-webpathfor-dead-code passed successfully!');
