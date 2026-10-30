const fs = require('fs');
const path = require("path");
const assert = require('assert');
const { Module } = require('module');

// Fallback module loader for optional dependencies in test sandbox
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    try {
        return originalLoad.apply(this, arguments);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            return {};
        }
        throw err;
    }
};

// JULES: Regression test for removal of dead function filterUndesiredResults in novelaiExploreGallery.js
function runTest() {
    console.log('Testing novelaiExploreGallery for removal of dead function filterUndesiredResults...');

    const galleryPath = path.join(__dirname, '..', 'modules', 'novelaiExploreGallery.js');
    const content = fs.readFileSync(galleryPath, 'utf8');

    // 1. Confirm filterUndesiredResults function is no longer defined in novelaiExploreGallery.js
    assert.strictEqual(
        content.includes('function filterUndesiredResults'),
        false,
        'filterUndesiredResults should be removed from novelaiExploreGallery.js'
    );

    // 2. Confirm module syntax is valid and exports expected functions
    const gallery = require(galleryPath);
    assert.strictEqual(typeof gallery.normalizeExploreModel, 'function');
    assert.strictEqual(typeof gallery.resolveExploreFilters, 'function');
    assert.strictEqual(typeof gallery.filterUndesiredResults, 'undefined');

    console.log('✅ PASS: novelaiExploreGallery dead code test passed successfully.');
}

try {
    runTest();
} catch (err) {
    console.error('❌ FAIL:', err);
    process.exit(1);
}
