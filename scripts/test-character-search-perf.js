#!/usr/bin/env node
/**
 * JULES: Regression and performance test for character search tokenization optimization in SearchService.
 * Run: node scripts/test-character-search-perf.js
 */
'use strict';

const assert = require('assert');
const { SearchService } = require('../modules/searchService');

// Mock globalResources with dummy character data
const mockCharacters = [
    { name: 'Minakami Sayo', copyright: 'Touhou Project' },
    { name: 'Sayo', copyright: '' },
    { name: 'Asuna Yuuki', copyright: 'Sword Art Online' },
    { name: 'Asuna (SAO)', copyright: 'Sword Art Online' },
    { name: 'Hatsune Miku', copyright: 'Vocaloid' },
    { name: 'Miku Nakano', copyright: 'Gotoubun no Hanayome' }
];

const mockGlobalResources = {
    getCharacterData: () => mockCharacters,
    getSpellChecker: () => null,
    getWordLookupService: () => null,
    getTagAutofillSearch: () => null,
    isInitialized: () => false
};

const service = new SearchService(mockGlobalResources);

// 1. Verify match parity between default scoreCharacterSearchMatch and scoreCharacterSearchMatch with pre-tokenized inputs
const testQueries = [
    { query: 'sayo', expectedName: 'Sayo' },
    { query: 'minakami sayo', expectedName: 'Minakami Sayo' },
    { query: 'asuna yuuki', expectedName: 'Asuna Yuuki' },
    { query: 'vocaloid', expectedName: 'Hatsune Miku' }
];

for (const t of testQueries) {
    const searchWords = t.query.toLowerCase().split(/\s+/).filter(Boolean);
    for (const char of mockCharacters) {
        const nameLower = char.name.toLowerCase();
        const copyLower = char.copyright.toLowerCase();

        const matchWithoutTokens = service.scoreCharacterSearchMatch(nameLower, copyLower, t.query.toLowerCase(), searchWords);

        const nTokens = nameLower.split(/[^a-z0-9]+/).filter(Boolean);
        const cTokens = copyLower.split(/[^a-z0-9]+/).filter(Boolean);
        const matchWithTokens = service.scoreCharacterSearchMatch(nameLower, copyLower, t.query.toLowerCase(), searchWords, nTokens, cTokens);

        assert.deepStrictEqual(
            matchWithTokens,
            matchWithoutTokens,
            `Match result mismatch for query "${t.query}" on character "${char.name}"`
        );
    }
}

// 2. Perform mock character search over 10,000 synthetic characters to benchmark speed
const syntheticCharacters = [];
for (let i = 0; i < 10000; i++) {
    syntheticCharacters.push({
        name: `Character Hero ${i} Long Name`,
        copyright: `Series Title Copyright ${i % 50}`
    });
}

const largeGlobalResources = {
    getCharacterData: () => syntheticCharacters,
    isInitialized: () => false
};
const largeService = new SearchService(largeGlobalResources);

const start = Date.now();
largeService.performCharacterSearch('hero series 10', 'nai-diffusion-4-5-full').then(results => {
    const duration = Date.now() - start;
    assert.ok(Array.isArray(results), 'results should be an array');
    assert.ok(results.length > 0, 'should find matches in synthetic dataset');
    console.log(`Character search performance test completed in ${duration}ms for 10,000 records.`);
    console.log('test-character-search-perf: ALL PASSED');
}).catch(err => {
    console.error(err);
    process.exit(1);
});
