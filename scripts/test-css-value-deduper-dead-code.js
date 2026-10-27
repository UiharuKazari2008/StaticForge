const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { dedupeCssLiterals, DEFAULT_COLOR_TOLERANCE } = require('../modules/cssValueDeduper');

// Test 1: Deduplication functionality works as expected
const sampleCss = `
a { color: #ff0000; margin: 10px; }
b { color: #ff0000; margin: 10px; }
c { color: #ff0000; margin: 10px; }
`;

const result = dedupeCssLiterals(sampleCss);
assert.ok(result.css.includes('--sf-color-0: #ff0000;'), 'Should deduplicate repeated color');
assert.ok(result.css.includes('--sf-space-0: 10px;'), 'Should deduplicate repeated spacing');
assert.strictEqual(result.dedupedCount, 2, 'Should return count of 2 deduped variables');
assert.strictEqual(DEFAULT_COLOR_TOLERANCE, 0.02, 'Should export default tolerance');

// Test 2: Verify dead functions (colorKey and colorsSimilar) are removed
const moduleSource = fs.readFileSync(path.join(__dirname, '../modules/cssValueDeduper.js'), 'utf8');
assert.strictEqual(moduleSource.includes('function colorKey('), false, 'function colorKey should be removed from modules/cssValueDeduper.js');
assert.strictEqual(moduleSource.includes('function colorsSimilar('), false, 'function colorsSimilar should be removed from modules/cssValueDeduper.js');

console.log('✅ test-css-value-deduper-dead-code passed successfully.');
