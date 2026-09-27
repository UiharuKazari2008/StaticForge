#!/usr/bin/env node
/**
 * #247 regressions: deleteNeedleOccurrences matches the old indexOf+splice loop,
 * replace keeps the alternative-text append when fallback_select_text is not
 * found, and incremental token counts fully recount for an unseen textarea.
 * Run: node scripts/test-prompt-replacement-fixforward.js
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

const trmSrc = read('textReplacementManager.js');
const pipeSrc = read('promptApplyPipeline.js');
const ctx = {
    console,
    stripManagedEmphasisDelimitersForCounting: (s) => s,
    extractBiasFromTextForDisplay: () => null,
    hasEmphasisGroupForDisplay: () => false,
    applyBiasToText: (s) => s,
    textEndsWithEmphasisGroupClose: () => false
};
vm.createContext(ctx);
vm.runInContext([
    extractBlock(trmSrc, 'function getCleanReplacementPattern('),
    extractBlock(trmSrc, 'function deleteNeedleOccurrences('),
    extractBlock(pipeSrc, 'function normalizeReplacementAction('),
    extractBlock(pipeSrc, 'function prepareReplaceText('),
    extractBlock(pipeSrc, 'function applyReplacementOnResolvedText(')
].join('\n'), ctx);

const del = vm.runInContext('deleteNeedleOccurrences', ctx);
const apply = vm.runInContext('applyReplacementOnResolvedText', ctx);

// Old loop: indexOf from the start after every removal.
function oldDelete(result, needle, count) {
    if (count !== undefined && count !== null) {
        for (let i = 0; i < count; i++) {
            const index = result.indexOf(needle);
            if (index === -1) break;
            result = result.substring(0, index) + result.substring(index + needle.length);
        }
        return result;
    }
    return result.split(needle).join('');
}

assert.strictEqual(del('aabb', 'ab', 2), '', '"aabb" - "ab" (count 2) removes the occurrence formed across the join');
assert.strictEqual(del('aabb', 'ab', 5), '', 'count larger than occurrences');
assert.strictEqual(del('aabb', 'ab', 1), 'ab', 'count 1 removes one');
assert.strictEqual(del('x, a$&b, a$&b', '$&', 1), 'x, ab, a$&b', '$ patterns are literal');
for (const [hay, needle, count] of [
    ['aabb', 'ab', null], ['aabb', 'ab', undefined], ['aaabbb', 'ab', 3], ['red, blue, red', 'red', 1],
    ['red, blue, red', 'red', 0], ['abab', 'ab', '2'], ['nothing here', 'zz', 2]
]) {
    assert.strictEqual(del(hay, needle, count), oldDelete(hay, needle, count),
        `matches old loop: ${JSON.stringify([hay, needle, count])}`);
}
console.log('ok: deleteNeedleOccurrences matches old logic');

const alt = apply('blue hair', {
    action: 'replace',
    select_text: 'red eyes',
    fallback_select_text: 'green eyes',
    alternative_text: 'yellow eyes',
    is_critical: false,
    replace_text: 'purple eyes'
});
assert.strictEqual(alt.success, true, 'alternative applied when fallback is missing');
assert.strictEqual(alt.method, 'alternative');
assert.strictEqual(alt.result, 'blue hair, yellow eyes');

const fb = apply('blue hair, green eyes', {
    action: 'replace',
    select_text: 'red eyes',
    fallback_select_text: 'green eyes',
    alternative_text: 'yellow eyes',
    is_critical: false,
    replace_text: 'purple eyes'
});
assert.strictEqual(fb.method, 'fallback', 'found fallback still wins over alternative');
assert.strictEqual(fb.result, 'blue hair, purple eyes');

const critical = apply('blue hair', {
    action: 'replace',
    select_text: 'red eyes',
    fallback_select_text: 'green eyes',
    alternative_text: 'yellow eyes',
    replace_text: 'purple eyes'
});
assert.strictEqual(critical.success, false, 'critical replacement never appends alternative');
console.log('ok: replace alternative append with missing fallback');

// Token totals: an unseen textarea (rebuilt card) must trigger a full recount.
const toolbarSrc = read('promptTextareaToolbar.js');
const tokenCtx = {
    getPromptTokenizer: () => ({ countTokens: (s) => s.length }),
    getPromptTokenLimit: () => 512
};
vm.createContext(tokenCtx);
vm.runInContext(`const holder = { ${extractBlock(toolbarSrc, '    updateTokenCountIncremental(changedTextarea) {')} };`, tokenCtx);
const incremental = vm.runInContext('holder.updateTokenCountIncremental', tokenCtx);

let fullRecounts = 0;
const toolbar = {
    _groupTotalsReady: true,
    _fieldTokenCache: new WeakMap(),
    _groupTotals: { editablePrompt: 10, editableUc: 0, nePrompt: 0, neUc: 0 },
    updateAllTokenCounts() { fullRecounts++; },
    isUcTextarea: () => false,
    stripTextForTokenCount: (s) => s,
    updateToolbarDisplay() {},
    scheduleBottomSummaryUpdate() {}
};
const known = { value: 'abcdef' };
toolbar._fieldTokenCache.set(known, { count: 4, expanderNe: 0 });
incremental.call(toolbar, known);
assert.strictEqual(fullRecounts, 0, 'cached field updates incrementally');
assert.strictEqual(toolbar._groupTotals.editablePrompt, 12, 'incremental delta applied');

incremental.call(toolbar, { value: 'rebuilt card text' });
assert.strictEqual(fullRecounts, 1, 'unseen field triggers a full recount');
assert.strictEqual(toolbar._groupTotals.editablePrompt, 12, 'unseen field not added on top of stale totals');
console.log('ok: token totals recount for unseen textarea');

console.log('\ntest-prompt-replacement-fixforward: all passed');
