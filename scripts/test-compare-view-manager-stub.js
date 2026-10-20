const fs = require('fs');
const path = require('path');
const assert = require('assert');

const targetFile = path.join(__dirname, '..', 'public', 'scripts', 'comp', 'compareViewManager.js');
const code = fs.readFileSync(targetFile, 'utf8');

// Assert applyCompareDefaultSettingsStub is removed from compareViewManager.js
assert.strictEqual(
    code.includes('applyCompareDefaultSettingsStub'),
    false,
    'Expected applyCompareDefaultSettingsStub to be completely removed from compareViewManager.js'
);

// Assert applyCompareDefaultSettings exists
assert.strictEqual(
    code.includes('function applyCompareDefaultSettings()'),
    true,
    'Expected applyCompareDefaultSettings to remain in compareViewManager.js'
);

console.log('Test passed: applyCompareDefaultSettingsStub is successfully removed and applyCompareDefaultSettings is preserved.');
