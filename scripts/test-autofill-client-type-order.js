/**
 * Regression test for normalizeAutofillRankingClient typeOrder deduplication and Set-based O(N) lookup.
 * Ensures client matches server normalizeTypeOrder behavior in modules/autofillRankingSettings.js.
 * Credit: grok.menma
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const clientScriptPath = path.join(__dirname, '../public/scripts/comp/autofillRankingConfig.js');
const clientSource = fs.readFileSync(clientScriptPath, 'utf8');

// Execute script in function scope with mock window
const initModule = new Function('window', 'clearAutofillRankingScoreCache', `${clientSource}; return { normalizeAutofillRankingClient, AUTOFILL_TYPE_KEYS };`);
const { normalizeAutofillRankingClient, AUTOFILL_TYPE_KEYS } = initModule({
    wsClient: {
        registerInitStep: () => {},
        on: () => {},
        isConnected: () => false
    }
}, () => {});

assert.strictEqual(typeof normalizeAutofillRankingClient, 'function', 'normalizeAutofillRankingClient should be defined');

// 1. Deduplication test: duplicate keys in raw typeOrder must be deduplicated, preserving first-seen order
const partialConfig = normalizeAutofillRankingClient({
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
], 'Duplicate raw keys must be deduplicated preserving first-seen order');

// 2. Invalid/unknown keys are filtered out and duplicate keys deduplicated
const dirtyConfig = normalizeAutofillRankingClient({
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
], 'Invalid keys filtered and duplicates deduplicated');

// 3. Reverse order preserved without duplication
const reversed = [...AUTOFILL_TYPE_KEYS].reverse();
const fullConfig = normalizeAutofillRankingClient({
    typeOrder: reversed
});
assert.deepStrictEqual(fullConfig.typeOrder, reversed, 'Full custom order should be preserved');

// 4. Fallback when typeOrder is missing or non-array
const emptyConfig = normalizeAutofillRankingClient({});
assert.deepStrictEqual(emptyConfig.typeOrder, AUTOFILL_TYPE_KEYS, 'Default typeOrder preserved on empty input');

console.log('✅ normalizeAutofillRankingClient typeOrder deduplication tests passed!');
