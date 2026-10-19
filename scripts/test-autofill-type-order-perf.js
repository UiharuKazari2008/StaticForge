const assert = require('assert');
const { normalizeAutofillRanking, AUTOFILL_TYPE_KEYS } = require('../modules/autofillRankingSettings');

console.log('Testing normalizeTypeOrder deduplication and behavior...');

// Test 1: Partial raw order correctly appends missing default keys in order
const partialConfig = normalizeAutofillRanking({
    typeOrder: ['tagDanbooru', 'spellcheck', 'tagDanbooru']
});
assert.deepStrictEqual(partialConfig.typeOrder, [
    'tagDanbooru',
    'spellcheck',
    'character',
    'textReplacement',
    'tagNovelai',
    'tagE621',
    'dynamicPlaceholder'
]);

// Test 2: Invalid/unknown keys are filtered out and duplicate keys deduplicated
const dirtyConfig = normalizeAutofillRanking({
    typeOrder: ['invalidKey', 'character', 'character', 'spellcheck', 'unknownKey']
});
assert.deepStrictEqual(dirtyConfig.typeOrder, [
    'character',
    'spellcheck',
    'textReplacement',
    'tagNovelai',
    'tagDanbooru',
    'tagE621',
    'dynamicPlaceholder'
]);

// Test 3: Standard full order preserved
const fullConfig = normalizeAutofillRanking({
    typeOrder: [...AUTOFILL_TYPE_KEYS].reverse()
});
assert.deepStrictEqual(fullConfig.typeOrder, [...AUTOFILL_TYPE_KEYS].reverse());

console.log('All normalizeTypeOrder tests passed successfully!');
