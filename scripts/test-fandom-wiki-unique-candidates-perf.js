#!/usr/bin/env node
const assert = require('assert');

console.log('Running fandomWiki candidate deduplication regression test...');

// Test inputs including nulls, falsy values, and duplicates
const logo = 'https://static.wikia.nocookie.net/testwiki/images/site-logo.png';
const candidates = [
    logo,
    logo.replace('images.wikia.com', 'static.wikia.nocookie.net'), // duplicate of logo
    'https://static.wikia.nocookie.net/testwiki/images/favicon.ico',
    null,
    'https://testwiki.fandom.com/wiki/Special:FilePath/Site-logo.png',
    'https://testwiki.fandom.com/wiki/Special:FilePath/Wiki.png',
    null,
    'https://static.wikia.nocookie.net/testwiki/images/favicon.ico' // duplicate
];

// O(n^2) logic (original)
const originalDedupe = candidates.filter((u, i, arr) => u && arr.indexOf(u) === i);

// O(n) logic (optimized)
const optimizedDedupe = [...new Set(candidates.filter(Boolean))];

// Verify correctness
assert.deepStrictEqual(optimizedDedupe, originalDedupe, 'Optimized Set deduplication output must match original output byte-for-byte');
assert.strictEqual(optimizedDedupe.length, 4, 'Should contain exactly 4 unique non-null candidate URLs');
assert.ok(!optimizedDedupe.includes(null), 'Should not contain null elements');

// Performance benchmark on realistic / larger candidate arrays
const largeCandidates = [];
for (let i = 0; i < 50000; i++) {
    largeCandidates.push(`https://static.wikia.nocookie.net/wiki/image_${i % 1000}.png`);
    if (i % 5 === 0) largeCandidates.push(null);
}

const startOld = performance.now();
const oldResult = largeCandidates.filter((u, i, arr) => u && arr.indexOf(u) === i);
const timeOld = performance.now() - startOld;

const startNew = performance.now();
const newResult = [...new Set(largeCandidates.filter(Boolean))];
const timeNew = performance.now() - startNew;

assert.deepStrictEqual(newResult, oldResult, 'Large scale deduplication output must match');

console.log(`Original O(N^2) time: ${timeOld.toFixed(2)}ms`);
console.log(`Optimized O(N) time: ${timeNew.toFixed(2)}ms`);
assert.ok(timeNew < timeOld, 'Optimized Set deduplication should be faster than O(N^2)');

console.log('✓ All fandomWiki candidate deduplication tests passed successfully!');
