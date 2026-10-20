'use strict';
// Obliterated Memories is a second knowledge-memory database, not a filter on the Studio one.
//   node scripts/test-obliterated-memory-store.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const kb = require('../modules/knowledgeMemoryDatabase');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-oblit-'));
assert.strictEqual(kb.initializeKnowledgeMemoryDatabase(dir), true);
kb.saveKnowledgeMemory('only_main', 'Studio store', 'test', [], [], ['studio line'], 0.1, 'v5');

kb.withKnowledgeMemoryStore('obliterated', () => {
    assert.strictEqual(kb.getKnowledgeMemory('only_main', false), null);
    kb.saveKnowledgeMemory('only_oblit', 'Shared store', 'test', [], [], ['oblit line'], 0.1, 'obliterated');
    const saved = kb.getKnowledgeMemory('only_oblit', false);
    assert.ok(saved);
    assert.strictEqual(saved.model, 'obliterated');
});

assert.ok(kb.getKnowledgeMemory('only_main', false));
assert.strictEqual(kb.getKnowledgeMemory('only_oblit', false), null);
assert.strictEqual(fs.existsSync(path.join(dir, 'knowledge_memory_obliterated.db')), true);

assert.throws(() => kb.withKnowledgeMemoryStore('nope', () => {}), (err) => err.code === 'MEMORY_STORE_UNKNOWN');

kb.closeKnowledgeMemoryDatabase();
console.log('obliterated memory store tests passed');
