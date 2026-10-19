const assert = require('assert');
const path = require('path');
const { candidatePaths } = require('../modules/installManifestFilter.js');

try {
    const root = path.resolve(__dirname, '..');
    const result = candidatePaths(root, '/protected/fflate.js');
    console.log("Result for /protected/fflate.js:");
    result.forEach(r => console.log(r));

    assert.strictEqual(result.length, 1, "Should return exactly one path and early exit");
    console.log("PASS");
} catch (err) {
    console.error("FAIL:", err.message);
    process.exit(1);
}
