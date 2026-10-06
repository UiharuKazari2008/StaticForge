const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Verify that public/scripts/comp/referenceManager.js contains the corrected showGlassToast call
const filePath = path.join(__dirname, '../public/scripts/comp/referenceManager.js');
const fileContent = fs.readFileSync(filePath, 'utf8');

assert.ok(
    fileContent.includes("showGlassToast('success', null, 'Reference metadata updated successfully')"),
    "Expected public/scripts/comp/referenceManager.js to contain showGlassToast('success', null, 'Reference metadata updated successfully')"
);

assert.strictEqual(
    fileContent.includes("showGlassToast('success', 'Reference metadata updated successfully')"),
    false,
    "Should not contain the unshifted 2-argument showGlassToast call"
);

console.log('✅ Unit test passed: reference metadata toast arguments verified.');
