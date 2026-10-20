'use strict';
const assert = require('assert');
const { _test } = require('../modules/mcpAgentFacade');
const check = _test.invalidMemoryLists;
assert.strictEqual(check({ name: 'x' }), null);
assert.strictEqual(check({ name: 'x', observations: ['a', { entity_id: 'memory', content: 'b', importance: 0.5 }] }), null);
assert.strictEqual(check({ name: 'x', observations: [] }), null);
assert.match(check({ name: 'x', observations: { item: [{ content: 'a' }] } }), /observations must be an array, got an object/);
assert.match(check({ name: 'x', observations: '' }), /got string/);
assert.match(check({ name: 'x', entities: { item: [] } }), /entities must be an array/);
assert.match(check({ name: 'x', relations: 'r' }), /relations must be an array/);
assert.match(check({ name: 'x', observations: ['ok', 7] }), /observations\[1\]/);
assert.match(check({ name: 'x', observations: [{ content: 3 }] }), /observations\[0\]/);
// wired into save_memory before any write
const src = require('fs').readFileSync(require('path').join(__dirname, '../modules/mcpAgentFacade.js'), 'utf8');
const at = src.indexOf('const listError = invalidMemoryLists(input);');
assert.ok(at > 0 && at < src.indexOf('db.saveKnowledgeMemory(', at), 'guard runs before saveKnowledgeMemory');
assert.ok(/listError\) return \{ success: false, error: listError, status: 400 \}/.test(src));
console.log('test-memory-save-guard: ok');
// leading ": " trimmed before save (dirc_f2c4bcf247283280)
assert.strictEqual(_test.trimObservationLead(': the drop is real'), 'the drop is real');
assert.deepStrictEqual(_test.trimObservationLead({ entity_id: 'memory', content: ' :  x' }), { entity_id: 'memory', content: 'x' });
assert.strictEqual(_test.trimObservationLead('Fixed: a'), 'Fixed: a');
assert.strictEqual(_test.trimObservationLead('2026-10-20: a'), '2026-10-20: a');
assert.ok(src.indexOf('observations.map(trimObservationLead)') > at && src.indexOf('observations.map(trimObservationLead)') < src.indexOf('db.saveKnowledgeMemory(', at));
console.log('test-memory-save-guard: trim ok');
assert.deepStrictEqual(_test.droppedMemoryObservations(
    ['keep', 'gone'],
    ['keep']
), ['gone']);
assert.match(_test.formatDroppedObservationsWarning(['gone'], 1), /revision 1/);
console.log('test-memory-save-guard: drop warning ok');
