const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Verify that public/scripts/comp/manualUploadHandlers.js contains the corrected showGlassToast call
const filePath = path.join(__dirname, '../public/scripts/comp/manualUploadHandlers.js');
const fileContent = fs.readFileSync(filePath, 'utf8');

assert.ok(
    fileContent.includes("showGlassToast('success', 'Reference Image Added', '')"),
    "Expected public/scripts/comp/manualUploadHandlers.js to contain showGlassToast('success', 'Reference Image Added', '')"
);

assert.strictEqual(
    fileContent.includes("showGlassToast('success', null, 'Reference Image Added')"),
    false,
    "Should not contain the unshifted showGlassToast call with null title"
);

console.log('✅ Unit test passed: manual upload toast arguments verified.');
