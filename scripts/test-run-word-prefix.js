#!/usr/bin/env node
// Start Search matching (runCommandIndex.js runWordPrefixRank): word prefixes as Vista, not the
// Run window's fuzzy similarity. The two functions are pure; they are lifted from the source.
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/runCommandIndex.js'), 'utf8');
function lift(name) {
    const m = src.match(new RegExp(`\\nfunction ${name}\\([\\s\\S]*?\\n}\\n`));
    assert.ok(m, `${name} found in source`);
    return m[0];
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(lift('runSearchWords') + lift('runWordPrefixRank') + '\nthis.runSearchWords = runSearchWords; this.runWordPrefixRank = runWordPrefixRank;', ctx);
// arrays from the vm context have their own Array prototype: copy them before deepStrictEqual
const runSearchWords = (text) => [...ctx.runSearchWords(text)];
const runWordPrefixRank = ctx.runWordPrefixRank;

assert.deepStrictEqual(runSearchWords('DreamStudio 2026 R7'), ['dream', 'studio', '2026', 'r7']);
assert.deepStrictEqual(runSearchWords('nikke_labor_pain_masked'), ['nikke', 'labor', 'pain', 'masked']);
assert.deepStrictEqual(runSearchWords(''), []);

const rank = (q, label, keywords = []) => runWordPrefixRank(q, { label, keywords });
// whole-label prefix beats word prefix beats keyword
assert.strictEqual(rank('pa', 'Paint'), 0);
assert.strictEqual(rank('pa', 'Control Panel'), 1);
assert.strictEqual(rank('pa', 'Paint', ['mspaint']), 0);
assert.strictEqual(rank('msp', 'Paint', ['mspaint']), 2);
// no substring or near-miss hits
assert.strictEqual(rank('pa', 'Expanders'), -1);
assert.strictEqual(rank('pa', 'Dreamscape Workspaces'), -1);
assert.strictEqual(rank('note', 'Notion'), -1);
assert.strictEqual(rank('note', 'Notepad'), 0);
assert.strictEqual(rank('calc', 'Melaton Calendar'), -1);
assert.strictEqual(rank('calc', 'Calculator'), 0);
assert.strictEqual(rank('wall', 'Lord Elf Boy (Wallpaper)'), 1);
// several words: each must start a word; order free; case free
assert.strictEqual(rank('control pan', 'Control Panel'), 0);
assert.strictEqual(rank('pan con', 'Control Panel'), 1);
assert.strictEqual(rank('PANEL', 'Control Panel'), 1);
assert.strictEqual(rank('pan x', 'Control Panel'), -1);
// camel case and separators
assert.strictEqual(rank('studio', 'DreamStudio 2026 R7'), 1);
assert.strictEqual(rank('pain', 'nikke_labor_pain_masked'), 1);
// empty / odd input
assert.strictEqual(rank('', 'Paint'), -1);
assert.strictEqual(rank('   ', 'Paint'), -1);
assert.strictEqual(rank('pa', ''), -1);
assert.strictEqual(runWordPrefixRank('pa', null), -1);

console.log('test-run-word-prefix: ok');
