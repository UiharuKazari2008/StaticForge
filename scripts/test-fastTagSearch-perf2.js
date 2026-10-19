const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');

test('O(N^2) / duplicate loops fixed in categorizeSegment preserving exact priority', () => {
    const src = fs.readFileSync('modules/fastTagSearch.js', 'utf8');

    // Make sure we removed the repeated .some(c => c.includes())
    assert.ok(!src.includes('categories.some(c => c.includes('));

    // Also do a runtime check to prove identical output
    const FastTagSearch = require('../modules/fastTagSearch');
    const fts = new FastTagSearch({});

    // Exact priority preservation check
    // If the array has both /bodyparts/ (priority 6) and /composition/framing (priority 0)
    // The old code would scan the array for priority 0 first, find it, and return.
    assert.strictEqual(fts.categorizeSegment({ categories: ['/bodyparts/arm', '/composition/framing/close-up'] }), 'composition_framing');

    // Both gender (priority 4) and location (priority 8)
    assert.strictEqual(fts.categorizeSegment({ categories: ['/locations/indoors', '/bygender/female'] }), 'character_gender');

    assert.strictEqual(fts.categorizeSegment({ categories: ['nothing'] }), 'general');
});
