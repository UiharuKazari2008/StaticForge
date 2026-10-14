#!/usr/bin/env node
// Control Panel's Melaton Search (Yukimi 2026-10-13): search indexing status and controls laid
// out as Vista's Indexing Options. Run: node scripts/test-melaton-search.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
global.window = global;
let jobs = {};
global.document = { readyState: 'complete', getElementById: () => ({ _indexJobs: jobs }), addEventListener: () => {} };
const search = require('../public/scripts/comp/cplSearch.js');

jobs = { search_sync: { status: 'indexing', percentage: 40, total: 1200, message: 'Indexing 480 of 1200' }, prompt_fts: { status: 'idle', stats: { ftsDone: 900, totalImages: 1000, ftsPending: 100 } } };
let s = search._test.readState();
assert.strictEqual(s.line, 'Indexing in progress. Search results might not be complete during this time.');
assert.strictEqual(s.progress, 40);
let html = search._test.html();
assert.ok(html.includes('900 items indexed of 1,000') && html.includes('Indexing (40%)') && html.includes('role="progressbar"'));

jobs = { search_sync: { status: 'paused' }, prompt_fts: { status: 'idle', stats: { ftsDone: 1000, totalImages: 1000, ftsPending: 0 } } };
s = search._test.readState();
assert.strictEqual(s.line, 'Indexing is paused.');
assert.ok(search._test.html().includes('>Resume<'), 'Pause turns into Resume');

jobs = { search_sync: { status: 'complete' }, prompt_fts: { status: 'complete', stats: { ftsDone: 1000, totalImages: 1000, ftsPending: 0 } } };
assert.strictEqual(search._test.readState().line, 'Indexing complete.');

const js = read('public/scripts/comp/cplSearch.js');
assert.ok(js.includes("new CustomEvent('contextMenuAction'"), "the tray's own actions run (mainMenuManager.js)");
for (const a of ['search-index-trigger', 'search-index-toggle-pause', 'search-index-rebuild-all', 'prompt-index-reconcile']) assert.ok(js.includes(`'${a}'`) || js.includes(`"${a}"`), a);
assert.ok(read('public/scripts/comp/featureLoader.js').includes("'scripts/comp/cplSearch.js'"));
assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-cpl/indexing-48.png')));
console.log('test-melaton-search: ok');
