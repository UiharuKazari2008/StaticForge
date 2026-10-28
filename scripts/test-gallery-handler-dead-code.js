// JULES: Regression test for dead code removal in modules/ws/handlers/120-galleryHandler.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');

const filePath = path.join(__dirname, '../modules/ws/handlers/120-galleryHandler.js');
const code = fs.readFileSync(filePath, 'utf8');

assert.strictEqual(
    code.includes('tryFastGalleryMetaProbe'),
    false,
    'tryFastGalleryMetaProbe should be removed as it is uncalled, dead code'
);

console.log('✓ Regression test passed: tryFastGalleryMetaProbe is not present in 120-galleryHandler.js');
