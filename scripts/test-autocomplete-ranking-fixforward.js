#!/usr/bin/env node
/**
 * #242 regressions: zero-score fallback in calculateComprehensiveRanking and
 * normalized exact/prefix scoring in runScoreText.
 * Run: node scripts/test-autocomplete-ranking-fixforward.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const compDir = path.join(__dirname, '../public/scripts/comp');
const read = (name) => fs.readFileSync(path.join(compDir, name), 'utf8');

function extractFunction(src, name) {
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `missing function ${name}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced function ${name}`);
}

const utilsSrc = read('autocompleteUtils.js');
const helperSrc = [
    'const TOKEN_MATCH_SCORE_CACHE = new Map();',
    'const TOKEN_MATCH_SCORE_CACHE_MAX = 4096;',
    'const LEVENSHTEIN_PAIR_CACHE = new Map();',
    'const LEVENSHTEIN_PAIR_CACHE_MAX = 2048;',
    ...['normalizeTagSearchText', 'tokenizeTagSearchText', 'commonPrefixLength',
        'rememberBoundedCache', 'getTokenMatchScore', 'levenshteinDistance']
        .map((name) => extractFunction(utilsSrc, name))
].join('\n');

const ranking = {
    rankingVersion: 1,
    typeWeights: {},
    clientNonTag: {
        exactMatchBonus: 0, prefixMatchBonus: 0, containsBonus: 0, similarityMult: 1,
        characterBonus: 0, characterSimilarityMult: 0, textReplacementBestBonus: 0,
        textReplacementExactPlaceholderBonus: 0, dynamicPlaceholderBonus: 0,
        frequencyMult: 0, frequencyCap: 0
    }
};

const ctx = {
    console,
    getAutofillRanking: () => ranking,
    isTagResult: () => false,
    getTagDisplayLabel: (r) => r.name,
    getAutofillTypeKey: (r) => r.type,
    getTagNCount: () => 0
};
vm.createContext(ctx);
vm.runInContext(helperSrc, ctx);
vm.runInContext(read('autocompleteRanking.js'), ctx);

const runSrc = read('runCommandIndex.js');
const runStart = runSrc.indexOf('const RUN_SCORE_TEXT_CACHE = new Map();');
assert.ok(runStart >= 0, 'missing RUN_SCORE_TEXT_CACHE');
vm.runInContext(runSrc.slice(runStart, runSrc.indexOf('function runScoreEntry(')), ctx);

const rank = vm.runInContext('calculateComprehensiveRanking', ctx);
const runScoreText = vm.runInContext('runScoreText', ctx);

// Stored 0 must fall through to the next prepared score.
assert.strictEqual(
    rank({ type: 'character', name: 'zeta', predictionaryScore: 0, enhancedSimilarity: 40 }, 'alpha').score,
    40,
    'predictionaryScore 0 falls through to enhancedSimilarity'
);
assert.strictEqual(
    rank({ type: 'character', name: 'zeta', predictionaryScore: 0, enhancedSimilarity: 0, matchScore: 25 }, 'alpha').score,
    25,
    'enhancedSimilarity 0 falls through to matchScore'
);
assert.strictEqual(
    rank({ type: 'character', name: 'blue_hair', predictionaryScore: 0 }, 'blue hair').score,
    100,
    'all stored scores 0 fall through to calculateStringSimilarity'
);
assert.strictEqual(
    rank({ type: 'character', name: 'zeta', predictionaryScore: 70, enhancedSimilarity: 40 }, 'alpha').score,
    70,
    'non-zero predictionaryScore still wins'
);
console.log('ok: ranking zero-score fallback');

// Exact / prefix only after normalization must keep 100 / 85.
assert.strictEqual(runScoreText('hair', '-hair', null, null), 100, 'normalized exact');
assert.strictEqual(runScoreText('hair', ' hair', null, null), 100, 'normalized exact (leading space)');
assert.strictEqual(runScoreText('hair', '_hair_clip', null, null), 85, 'normalized prefix');
assert.strictEqual(runScoreText('hair', 'long hair', null, null), 60, 'plain includes');
assert.strictEqual(runScoreText('hair', 'hair', 'tag', 'tag'), 125, 'category hint bonus');
assert.strictEqual(runScoreText('hair', 'hair', null, null), 100, 'cached score has no stale bonus');
assert.strictEqual(runScoreText('', 'hair', null, null), 0, 'empty query');
console.log('ok: runScoreText normalized exact/prefix');

console.log('\ntest-autocomplete-ranking-fixforward: all passed');
