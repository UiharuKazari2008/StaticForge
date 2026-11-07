'use strict';
// Read-only clients must not reach global search-index or Director provider writes.
// Runs the real WebSocketMessageHandlers.prototype.isDestructiveOperation.
const assert = require('assert');
const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');

const inst = Object.create(WebSocketMessageHandlers.prototype);
const blocked = [
    'search_index_rebuild_all',
    'search_index_trigger',
    'search_index_toggle_pause',
    'director_custom_providers_save',
    'prompt_index_start',
    'prompt_index_pause',
    'prompt_index_resume',
    'prompt_index_cancel',
    'prompt_index_reconcile'
];
for (const type of blocked) {
    assert.strictEqual(inst.isDestructiveOperation(type), true, `${type} must be blocked for read-only clients`);
}
// Per-session and read packets stay open.
for (const type of ['search_index_status', 'search_index_clear_cache', 'director_custom_providers_get', 'get_prompt_index_status']) {
    assert.strictEqual(inst.isDestructiveOperation(type), false, `${type} must stay allowed`);
}
console.log('test-readonly-destructive-gate passed');
process.exit(0);
