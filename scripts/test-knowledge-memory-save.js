const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const kb = require('../modules/knowledgeMemoryDatabase');

assert.deepStrictEqual(
    kb.normalizeMemoryObservations([
        'compiled_prompt.success false: Dynamic generation processing failed.',
        'get_session_state live: directorApi noop'
    ], []),
    [
        { entity_id: 'memory', content: 'compiled_prompt.success false: Dynamic generation processing failed.', importance: 0.5 },
        { entity_id: 'memory', content: 'get_session_state live: directorApi noop', importance: 0.5 }
    ]
);

const entities = kb.ensureObservationEntities(
    kb.normalizeMemoryEntities([]),
    kb.normalizeMemoryObservations(['note one'], [])
);
assert.strictEqual(entities[0].id, 'memory');
assert.strictEqual(kb.normalizeMemoryRelations([{ from: 'a' }]).length, 0);
assert.strictEqual(kb.coerceMemoryList('solo-note').length, 1);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-save-'));
assert.strictEqual(kb.initializeKnowledgeMemoryDatabase(dir), true);
const saved = kb.saveKnowledgeMemory(
    'v5_dynagen_bake_off_maternity',
    'Maternity Ward V5 jobs with dynamicGeneration enabled but unintegrated return compile failure and still generate.',
    'technique',
    [],
    [],
    [
        '1788330978919_generated_3075288647.png compiled_prompt.success false: Dynamic generation processing failed.',
        'get_session_state live: directorApi noop; mustAct bake resolved then integrated=true.',
        'Old 2k-tan 1759130606374 baked christmas city night weather in compiled prompt successfully on V4.5.'
    ],
    0.1,
    'v5'
);
assert.strictEqual(saved.model, 'v5');
assert.strictEqual(saved.observations.length, 3);
assert.strictEqual(saved.entities[0].id, 'memory');
assert.ok(saved.observations[0].content.includes('compiled_prompt.success false'));

const got = kb.getKnowledgeMemory('v5_dynagen_bake_off_maternity', false);
assert.strictEqual(got.observations.length, 3);
assert.strictEqual(got.model, 'v5');

kb.closeKnowledgeMemoryDatabase();
fs.rmSync(dir, { recursive: true, force: true });
console.log('test-knowledge-memory-save: ok');
