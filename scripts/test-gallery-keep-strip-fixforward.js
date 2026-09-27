#!/usr/bin/env node
/**
 * #244 regressions: keep-strip DOM range must detect non-contiguous data-index
 * (missing index, gaps, jumps) and fileSearch keeps its single effective
 * handleSearchInput (no per-keystroke currentSearchTerm / title bar update).
 * Run: node scripts/test-gallery-keep-strip-fixforward.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const compDir = path.join(__dirname, '../public/scripts/comp');
const read = (name) => fs.readFileSync(path.join(compDir, name), 'utf8');

function extractBlock(src, header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, `missing ${header}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced ${header}`);
}

const ctx = { console };
vm.createContext(ctx);
vm.runInContext(extractBlock(read('galleryView.js'), 'function galleryKeepStripDomRange('), ctx);
const stripRange = vm.runInContext('galleryKeepStripDomRange', ctx);

const cells = (indices) => indices.map((index) => ({
    dataset: index === undefined ? {} : { index: String(index) }
}));
const pick = (r) => ({ start: r.start, end: r.end, contiguous: r.contiguous });

assert.deepStrictEqual(pick(stripRange(cells([10, 11, 12, 13, 14, 15]), 12, 13)),
    { start: 2, end: 3, contiguous: true }, 'contiguous fast path');
{
    const before = stripRange(cells([10, 11, 12]), 0, 5);
    assert.ok(before.contiguous && before.end < before.start, 'contiguous strip before DOM has no overlap');
}
assert.deepStrictEqual(pick(stripRange([], 0, 5)),
    { start: 0, end: -1, contiguous: true }, 'empty list');
assert.deepStrictEqual(pick(stripRange(cells([undefined, 0, 1, 2]), 1, 2)),
    { start: 0, end: 3, contiguous: false }, 'first child without index');
assert.deepStrictEqual(pick(stripRange(cells([0, 40, 41, 42, 43]), 41, 42)),
    { start: 0, end: 4, contiguous: false }, 'generating tile index 0 at top');
assert.deepStrictEqual(pick(stripRange(cells([5, 6, 7, 20, 21, 22]), 20, 21)),
    { start: 0, end: 5, contiguous: false }, 'jump-created items');
assert.deepStrictEqual(pick(stripRange(cells([0, 2, 3, 3, 4, 5]), 2, 3)),
    { start: 0, end: 5, contiguous: false }, 'gap offset by a duplicate (endpoints look contiguous)');
console.log('ok: keep-strip contiguity detection');

const methodSrc = extractBlock(read('fileSearch.js'), '    handleSearchInput(query) {');
assert.strictEqual((read('fileSearch.js').match(/^ {4}handleSearchInput\(/gm) || []).length, 1,
    'single handleSearchInput method');

const calls = [];
const searchCtx = {
    window: {},
    setTimeout: (fn) => { calls.push('debounce'); fn(); return 1; },
    clearTimeout() {},
    updateGalleryTitleBar: () => calls.push('title')
};
vm.createContext(searchCtx);
vm.runInContext(`const holder = { ${methodSrc} };`, searchCtx);
const handleSearchInput = vm.runInContext('holder.handleSearchInput', searchCtx);
const fakeSearch = {
    debounceDelay: 0,
    getCurrentTagText: () => 'blue',
    updateTagSuggestions: (q) => calls.push(`suggest:${q}`),
    showTopResults: () => calls.push('top')
};

handleSearchInput.call(fakeSearch, ' blue ');
assert.strictEqual(fakeSearch.currentQuery, ' blue ', 'query stored untrimmed');
assert.deepStrictEqual(calls.slice(), ['debounce', 'suggest:blue'], 'debounced suggestions only');
assert.ok(!('currentSearchTerm' in searchCtx.window), 'no per-keystroke currentSearchTerm');
calls.length = 0;
handleSearchInput.call(fakeSearch, '   ');
assert.deepStrictEqual(calls.slice(), ['top'], 'blank query shows top results without title update');
calls.length = 0;
handleSearchInput.call(fakeSearch, null);
assert.deepStrictEqual(calls.slice(), ['top'], 'null query is safe');
console.log('ok: fileSearch handleSearchInput restored');

console.log('\ntest-gallery-keep-strip-fixforward: all passed');
