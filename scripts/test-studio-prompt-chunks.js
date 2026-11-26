#!/usr/bin/env node
/**
 * Tests for the Studio prompt chunk helpers in public/scripts/comp/studioChangeJson.js (Yozora #1269):
 * tag-aware append / remove / replace, the flat form of managed emphasis groups, and the weight bag
 * prune after an agent write. The client files run in a vm context with small stubs.
 * Run: node scripts/test-studio-prompt-chunks.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const COMP = path.join(__dirname, '../public/scripts/comp');
const changeSrc = fs.readFileSync(path.join(COMP, 'studioChangeJson.js'), 'utf8');
const serverSyntax = require('../modules/emphasisGroupIdSyntax.js');

// Source of one top-level function, found by name with a brace matcher that skips strings and comments
function extractFunction(source, name) {
    const head = new RegExp(`^function ${name}\\(`, 'm').exec(source);
    assert(head, `function ${name} found in studioChangeJson.js`);
    let i = source.indexOf('{', head.index + head[0].length);
    // skip the parameter list's own parentheses: the first "{" after the signature opens the body
    const bodyStart = i;
    let depth = 0;
    for (; i < source.length; i++) {
        const ch = source[i];
        const next = source[i + 1];
        if (ch === '/' && next === '/') { i = source.indexOf('\n', i); if (i < 0) break; continue; }
        if (ch === '/' && next === '*') { i = source.indexOf('*/', i + 2) + 1; continue; }
        if (ch === '\'' || ch === '"' || ch === '`') {
            const quote = ch;
            for (i++; i < source.length && source[i] !== quote; i++) {
                if (source[i] === '\\') i++;
            }
            continue;
        }
        if (ch === '{') depth++;
        else if (ch === '}') {
            depth--;
            if (depth === 0) return source.slice(head.index, i + 1);
        }
    }
    assert.fail(`function ${name} is not closed (body at ${bodyStart})`);
    return '';
}

const textareas = {};
const ctx = {
    console,
    document: {},
    window: {},
    CustomEvent: function CustomEvent(type, init) { this.type = type; this.detail = init && init.detail; },
    getStudioFieldTextarea(fieldId) { return textareas[fieldId] || null; },
    setTextareaValuePreservingUndo(textarea, value) { textarea.value = value; },
    applyFormattedText() {},
    scheduleTextareaVisualRefresh() {},
    getStudioCharacterItems() { return []; },
    updateCharacterPromptPreview() {},
    syncCalls: 0,
    syncEmphasisNormalizationPreviewMetadata() { ctx.syncCalls++; }
};
ctx.window = ctx;
vm.createContext(ctx);
['emphasisParse.js', 'emphasisGroupIdCodec.js'].forEach((file) => {
    vm.runInContext(fs.readFileSync(path.join(COMP, file), 'utf8'), ctx, { filename: file });
});
// The bag store lives in emphasisGroupsToolManager.js (which needs the whole window); its getter is the same shape
ctx.store = {};
ctx.getEmphasisNormalizationFieldStore = () => ctx.store;
['applyStudioChunkOps', 'appendPromptChunk', 'removePromptChunk', 'replacePromptSpan',
    'getStudioFieldValue', 'writeStudioFieldValue'].forEach((name) => {
    vm.runInContext(extractFunction(changeSrc, name), ctx, { filename: `${name}@studioChangeJson.js` });
});
const { appendPromptChunk, removePromptChunk, replacePromptSpan, applyStudioChunkOps } = ctx;

function ok(cond, msg) {
    assert(cond, msg);
    console.log('ok:', msg);
}
function eq(actual, expected, msg) {
    assert.strictEqual(actual, expected, `${msg}: got ${JSON.stringify(actual)}`);
    console.log('ok:', msg);
}

// --- Plain tags ---
eq(removePromptChunk('red, dark red, hair', 'red'), 'dark red, hair', 'remove matches whole tags, not substrings');
eq(appendPromptChunk('a, bb', 'b'), 'a, bb, b', 'append is not blocked by a longer tag containing it');
eq(appendPromptChunk('a, b', 'b'), 'a, b', 'append skips an equal tag');
eq(appendPromptChunk('a, B', 'b'), 'a, B', 'append skips an equal tag ignoring case');
eq(appendPromptChunk('', 'x'), 'x', 'append to empty');
eq(appendPromptChunk('a,', 'b'), 'a, b', 'append after a trailing comma');
eq(appendPromptChunk('a, b', ''), 'a, b', 'append of nothing keeps the text');
eq(appendPromptChunk('a, b', 'b, c'), 'a, b, c', 'multi-tag append adds only the missing tags');
eq(removePromptChunk('red, blue, red', 'red'), 'blue', 'remove drops every equal tag');
eq(removePromptChunk('a, b', 'c'), 'a, b', 'remove of a missing tag returns the input');
eq(removePromptChunk('a ,,  b', 'c'), 'a ,,  b', 'unmatched input is kept byte for byte');
eq(removePromptChunk('Red, blue', 'red'), 'blue', 'remove falls back to case-insensitive');
eq(removePromptChunk('Red, red', 'red'), 'Red', 'remove prefers the exact-case tag');
eq(removePromptChunk('a, red, blue, c', 'red, blue'), 'a, c', 'multi-tag remove drops the sequence');
eq(removePromptChunk('a, blue, x, red', 'red, blue'), 'a, x', 'multi-tag remove falls back to each tag');
eq(removePromptChunk('a, b,', 'b'), 'a', 'remove leaves no trailing comma');
eq(removePromptChunk('b', 'b'), '', 'remove of the only tag');
eq(removePromptChunk('a,\nb,\nc', 'b'), 'a,\nc', 'remove keeps the line break style');
eq(removePromptChunk('', 'b'), '', 'remove from empty');
eq(removePromptChunk('a, (b, c), d', 'c'), 'a, (b, c), d', 'no split inside parentheses');
eq(removePromptChunk('a, (b, c), d', '(b, c)'), 'a, d', 'a bracketed tag is one tag');
eq(removePromptChunk('a, {{b, c}}, d', '{{b, c}}'), 'a, d', 'braces are kept whole');
eq(removePromptChunk('a, :(, c, d', 'c'), 'a, :(, d', 'a lone opener does not swallow later tags');
eq(replacePromptSpan('red hair, blue eyes', 'red hair', 'blue hair'), 'blue hair, blue eyes', 'replace in place');
eq(replacePromptSpan('a, x, b, x', 'x', 'y'), 'a, y, b', 'replace puts the new tag at the first match and drops later duplicates');
eq(replacePromptSpan('a, b', 'zzz', 'c'), 'a, b, c', 'replace of a missing tag appends');
eq(replacePromptSpan('a, b', 'zzz', 'b'), 'a, b', 'replace append does not duplicate an existing tag');
eq(replacePromptSpan('a, b', 'b', 'b'), 'a, b', 'replace with itself keeps the text');
eq(replacePromptSpan('a, b, c', 'b', ''), 'a, c', 'replace with nothing removes');
eq(replacePromptSpan('a, red, blue, c', 'red, blue', 'green'), 'a, green, c', 'replace of a tag sequence');
eq(applyStudioChunkOps('old', [{ action: 'replace', text: 'a' }, { action: 'replace', text: 'b' }]), 'a, b', 'all-replace joins the chunks');
eq(applyStudioChunkOps('a, b', [{ action: 'remove', text: 'a' }, { action: 'append', text: 'c' }]), 'b, c', 'ops run in order');
eq(applyStudioChunkOps('a, b', [{ action: 'append', text: 'c' }, { action: 'replace', text: 'b' }]), 'a, b, c', 'replace without from, next to other ops, only ensures the chunk is there');

// --- Weighted groups in flat form ---
eq(removePromptChunk('a, 1.3::red, dress::, b', 'b'), 'a, 1.3::red, dress::', 'commas inside a weighted group do not split');
eq(removePromptChunk('a, 1.3::red, dress::, b', 'red'), 'a, 1.3::red, dress::, b', 'a group inner is not matched by one of its comma parts');
eq(removePromptChunk('a, 1.3::red dress::, b', 'red dress'), 'a, b', 'remove by the group inner text drops the whole group');
eq(removePromptChunk('a, 1.3::red dress::, b', '1.3::red dress::'), 'a, b', 'remove by the full group');
eq(removePromptChunk('a, 1.3::red, dress::, b', 'red, dress'), 'a, 1.3::red, dress::, b', 'multi-tag target does not match inside a group');
eq(removePromptChunk('1.3::x, y, 0.8::z', 'y'), '1.3::x, y, 0.8::z', 'an unterminated group runs to the next opener');
eq(removePromptChunk('1.3::x, y, 0.8::z', 'z'), '1.3::x, y', 'the next weight opener starts a new tag');
eq(removePromptChunk('year 2025::, a', 'a'), 'year 2025::', 'a large number before :: is text, not a weight');
eq(replacePromptSpan('a, 1.3::red dress::, b', 'red dress', 'blue dress'), 'a, blue dress, b', 'replace by group inner keeps nothing of the old group');
eq(appendPromptChunk('a, 1.3::red dress::', '1.3::red dress::'), 'a, 1.3::red dress::', 'append skips an equal group');
eq(removePromptChunk('1.2::a:: 0.8::b::', 'a'), '0.8::b::', 'two groups with a space between are two tags');

// --- Managed groups: flat form, ops, re-import ---
const g3 = serverSyntax.buildManagedEmphasisGroupText(3, 'red dress');
const managedRaw = `a, ${g3}, b`;
textareas.prompt = { id: 'manualPrompt', value: managedRaw, dispatchEvent() { return true; } };
ctx.store.manualPrompt = { groupsById: { 3: 1.3, 9: 0.7 }, syntaxMode: 'hidden' };

eq(ctx.getStudioFieldValue('prompt'), managedRaw, 'raw value keeps the invisible ids');
const flat = ctx.getStudioFieldValue('prompt', true);
eq(flat, 'a, 1.3::red dress::, b', 'flat value shows the weight as n::text::');
ok(!/[⁠-⁤​‌]/.test(flat), 'flat value has no zero-width characters');

const removed = applyStudioChunkOps(flat, [{ action: 'remove', text: 'red dress' }]);
eq(removed, 'a, b', 'remove of a managed group leaves a, b');
ok(!/[⁠-⁤​‌]/.test(removed) && !removed.includes('::'), 'no zero-width characters or :: left behind');

const replaced = applyStudioChunkOps(flat, [{ action: 'replace', from: 'red dress', text: '1.1::blue dress::' }]);
eq(replaced, 'a, 1.1::blue dress::, b', 'replace swaps the whole group, no duplicate');
const imported = ctx.importClassicEmphasisIntoManagedText(replaced, {}, 'hidden');
ok(imported.imported === 1, 'the re-import makes one managed group');
const reflat = ctx.expandEmphasisGroupIds(imported.text, { groupsById: imported.groupsById }, { alwaysTerminate: true }).text;
eq(reflat.split('blue dress').length - 1, 1, 'blue dress occurs once after the re-import');
eq(reflat.includes('red dress'), false, 'the old group is gone after the re-import');

const replacedPlain = applyStudioChunkOps(flat, [{ action: 'replace', from: 'red dress', text: 'blue dress' }]);
eq(replacedPlain, 'a, blue dress, b', 'a plain replacement drops the weight with the group');
eq(applyStudioChunkOps(flat, [{ action: 'append', text: 'c' }]), 'a, 1.3::red dress::, b, c', 'append keeps the flat group');
eq(applyStudioChunkOps(flat, [{ action: 'remove', text: 'nothing' }]), flat, 'no match keeps the flat text, so the field keeps its ids');

// --- writeStudioFieldValue prunes the bag ---
{
    const field = textareas.prompt;
    ctx.syncCalls = 0;
    ctx.writeStudioFieldValue('prompt', 'a, b');
    eq(field.value, 'a, b', 'the write reaches the textarea');
    eq(JSON.stringify(Object.keys(ctx.store.manualPrompt.groupsById)), '[]', 'stale ids are pruned from the bag');
    eq(ctx.store.manualPrompt.syntaxMode, 'hidden', 'the rest of the bag entry is kept');
    eq(ctx.syncCalls, 1, 'the preview metadata is synced once when the bag changed');

    ctx.syncCalls = 0;
    ctx.writeStudioFieldValue('prompt', 'a, b, c');
    eq(ctx.syncCalls, 0, 'no sync when the bag did not change');

    const live = serverSyntax.buildManagedEmphasisGroupText(4, 'keep me');
    ctx.store.manualPrompt = { groupsById: { 4: 1.2, 5: 0.5 } };
    ctx.store.prompt = { groupsById: { 4: 1.2, 5: 0.5 } };
    ctx.writeStudioFieldValue('prompt', `x, ${live}`);
    eq(JSON.stringify(Object.keys(ctx.store.manualPrompt.groupsById)), '["4"]', 'live ids stay, others go');
    eq(JSON.stringify(Object.keys(ctx.store.prompt.groupsById)), '["4"]', 'the dual-write key is pruned too');

    ctx.store = {};
    ctx.syncCalls = 0;
    ctx.writeStudioFieldValue('prompt', 'plain');
    eq(ctx.syncCalls, 0, 'no work and no sync when the field has no bag');
    eq(Object.keys(ctx.store).length, 0, 'no bag entry is created');
}

console.log('all studio prompt chunk tests passed');
