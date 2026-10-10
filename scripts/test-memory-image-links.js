'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const kb = require('../modules/knowledgeMemoryDatabase');
const { _test } = require('../modules/mcpAgentFacade');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'km-images-'));
assert.strictEqual(kb.initializeKnowledgeMemoryDatabase(dir), true);

const gr = { getKnowledgeMemoryDb: () => kb };
const t0 = 1700000000000;

kb.recordSessionGeneratedImage('wren', 'a.png', t0);
kb.recordSessionGeneratedImage('wren', 'b.png', t0 + 5);
kb.recordSessionGeneratedImage('other', 'c.png', t0 + 5);
kb.recordSessionGeneratedImage('wren', 'later.png', t0 + 5000);

const first = _test.runMemoryTool(gr, 'save_memory', {
    name: 'V5 Medium effort testing',
    description: 'Medium versus high findings',
    category: 'technique',
    model: 'v5',
    observations: ['2026-10-09 | rain alley | medium lost the puddles | high']
}, { sessionId: 'wren', nowMs: t0 + 100 });

assert.strictEqual(first.success, true);
assert.strictEqual(first.revision, 1);
assert.deepStrictEqual(first.linkedImages, ['a.png', 'b.png']);

const second = _test.runMemoryTool(gr, 'save_memory', {
    name: 'V5 Medium effort testing',
    description: 'Medium versus high findings',
    category: 'technique',
    observations: [
        '2026-10-09 | rain alley | medium lost the puddles | high',
        '2026-10-09 | night market | medium held the lanterns | medium'
    ]
}, { sessionId: 'wren', nowMs: t0 + 6000 });

assert.strictEqual(second.success, true);
assert.strictEqual(second.revision, 2);
assert.deepStrictEqual(second.linkedImages, ['later.png']);

const allLinks = kb.listMemoryImageLinks({ memoryName: 'V5 Medium effort testing' });
assert.ok(allLinks.every((row) => row.imageId !== 'c.png'), 'other session image stays unlinked');
assert.ok(allLinks.every((row) => row.source === 'auto'));

const manual = _test.runMemoryTool(gr, 'link_memory_image', {
    memory: 'V5 Medium effort testing',
    image: 'older.png',
    note: 'judged earlier',
    revision: 1
}, { sessionId: 'wren' });
assert.strictEqual(manual.success, true);
assert.strictEqual(manual.source, 'manual');
assert.strictEqual(manual.note, 'judged earlier');

const rev1 = kb.listMemoryImageLinks({ memoryName: 'V5 Medium effort testing', revision: 1 });
assert.ok(rev1.some((row) => row.imageId === 'older.png' && row.source === 'manual'));

const unlinked = kb.unlinkMemoryImage({
    memory: 'V5 Medium effort testing',
    image: 'older.png',
    revision: 1
});
assert.strictEqual(unlinked.success, true);
assert.ok(!kb.listMemoryImageLinks({ memoryName: 'V5 Medium effort testing', revision: 1 })
    .some((row) => row.imageId === 'older.png'));

const view = kb.decorateMemoryForRevisionDisplay(kb.getKnowledgeMemory('V5 Medium effort testing', false));
assert.strictEqual(view.revisions.length, 2);
assert.strictEqual(view.revisions[0].images.length, 2);
assert.strictEqual(view.revisions[1].images.length, 1);
assert.strictEqual(view.findingRows.length, 2);
assert.strictEqual(view.findingRows[0].finding.gist, 'rain alley');
assert.strictEqual(view.findingRows[0].finding.verdict, 'high');
assert.deepStrictEqual(view.findingRows[0].images.map((img) => img.imageId).sort(), ['a.png', 'b.png']);
assert.strictEqual(view.findingRows[1].finding.gist, 'night market');
assert.deepStrictEqual(view.findingRows[1].images.map((img) => img.imageId), ['later.png']);
assert.deepStrictEqual(
    kb.getMemoryRevisionImages('V5 Medium effort testing', 2)[0].images.map((img) => img.imageId),
    ['later.png']
);

kb.saveKnowledgeMemory('alpha tip', 'alpha body', 'anatomy', [], [], ['zeta note'], 0.2, 'v4');
kb.saveKnowledgeMemory('beta tip', 'mentions alpha tip in the writeup', 'style', [{ id: 'lantern', type: 'concept', name: 'lantern' }], [], ['beta note'], 0.9, 'v5');
kb.saveKnowledgeMemory('gamma tip', 'gamma body', 'style', [{ id: 'lantern', type: 'concept', name: 'lantern' }], [{ from: 'gamma tip', to: 'alpha tip', type: 'links', weight: 1 }], ['gamma note'], 0.5, 'v4_5');

const raw = new Database(path.join(dir, 'knowledge_memory.db'));
raw.prepare('UPDATE knowledge_memories SET updated_at = ? WHERE name = ?').run(10, 'alpha tip');
raw.prepare('UPDATE knowledge_memories SET updated_at = ? WHERE name = ?').run(40, 'beta tip');
raw.prepare('UPDATE knowledge_memories SET updated_at = ? WHERE name = ?').run(20, 'gamma tip');
raw.prepare('UPDATE knowledge_memories SET updated_at = ? WHERE name = ?').run(5, 'V5 Medium effort testing');
raw.close();

const byName = kb.listKnowledgeMemoriesPaged({ limit: 10, sort: 'name' }).items.map((row) => row.name);
assert.deepStrictEqual(byName, ['alpha tip', 'beta tip', 'gamma tip', 'V5 Medium effort testing'].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })));

const byConfidence = kb.listKnowledgeMemoriesPaged({ limit: 10, sort: 'confidence' }).items.map((row) => row.name);
assert.strictEqual(byConfidence[0], 'beta tip');
assert.strictEqual(byConfidence[byConfidence.length - 1], 'alpha tip');

const byCategory = kb.listKnowledgeMemoriesPaged({ limit: 10, sort: 'category' }).items.map((row) => row.category);
assert.deepStrictEqual(byCategory, [...byCategory].sort((a, b) => String(a).localeCompare(String(b))));

const byModel = kb.listKnowledgeMemoriesPaged({ limit: 10, sort: 'model' }).items.map((row) => row.model);
assert.deepStrictEqual(byModel, [...byModel].sort((a, b) => String(a).localeCompare(String(b))));

const byUpdated = kb.listKnowledgeMemoriesPaged({ limit: 10, sort: 'updated' }).items.map((row) => row.name);
assert.strictEqual(byUpdated[0], 'beta tip');
assert.ok(byUpdated.indexOf('beta tip') < byUpdated.indexOf('gamma tip'));
assert.ok(byUpdated.indexOf('gamma tip') < byUpdated.indexOf('alpha tip'));

const hits = kb.fastSearchKnowledgeMemories('puddles', 8);
assert.ok(hits.some((row) => row.name === 'V5 Medium effort testing'), 'fast search finds an observation');
const refinedHits = kb.fastSearchKnowledgeMemories('lanterns', 8);
assert.ok(refinedHits.some((row) => row.name === 'V5 Medium effort testing'), 'fast search sees the latest revision');
const nameHits = kb.fastSearchKnowledgeMemories('gamma', 8);
assert.ok(nameHits.some((row) => row.name === 'gamma tip'));

const map = kb.buildMemoryMindMap({ limit: 20 });
const edgeKinds = new Set(map.edges.map((edge) => edge.kind));
assert.ok(edgeKinds.has('category'), 'shared category');
assert.ok(edgeKinds.has('shared_tag'), 'shared tag');
assert.ok(map.edges.some((edge) => edge.kind === 'reference' && edge.from === 'mem:beta tip' && edge.to === 'mem:alpha tip'));
assert.ok(map.edges.some((edge) => edge.kind === 'link' && edge.from === 'mem:gamma tip' && edge.to === 'mem:alpha tip'));
assert.ok(map.nodes.some((node) => node.kind === 'memory' && node.name === 'gamma tip'));

kb.closeKnowledgeMemoryDatabase();
fs.rmSync(dir, { recursive: true, force: true });
console.log('test-memory-image-links: ok');
