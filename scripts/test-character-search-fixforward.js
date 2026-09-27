#!/usr/bin/env node
/**
 * #249 regression: scored character search results are not capped at 50
 * (the empty-query list keeps its cap).
 * Run: node scripts/test-character-search-fixforward.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/characterSearchModal.js'), 'utf8');

function extractBlock(header) {
    const start = src.indexOf(header);
    assert.ok(start >= 0, `missing ${header}`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`unbalanced ${header}`);
}

const ctx = {};
vm.createContext(ctx);
vm.runInContext(`const holder = { ${extractBlock('    performSearch() {')} };`, ctx);
const performSearch = vm.runInContext('holder.performSearch', ctx);

const characters = [];
for (let i = 0; i < 120; i++) {
    const name = `hero ${String(i).padStart(3, '0')}`;
    characters.push({
        name,
        copyright: 'saga',
        nameTokens: name.split(' '),
        copyrightTokens: ['saga'],
        char: { name }
    });
}

let rendered = null;
const modal = {
    characters,
    renderCap: 50,
    searchInput: { value: 'hero' },
    renderResults(results) { rendered = results; }
};

performSearch.call(modal);
assert.strictEqual(rendered.length, 120, 'all scored hits are rendered');
modal.searchInput.value = '';
performSearch.call(modal);
assert.strictEqual(rendered.length, 50, 'empty-query list keeps its 50 cap');
console.log('ok: scored search results uncapped');

console.log('\ntest-character-search-fixforward: all passed');
