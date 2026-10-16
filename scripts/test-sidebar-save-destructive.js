const Module = require('module');
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === 'ws' || request === 'winston') {
        return {};
    }
    try {
        return originalLoad.apply(this, arguments);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') {
            return {};
        }
        throw err;
    }
};

const assert = require('assert');
const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');

// Test isDestructiveOperation method directly on prototype
const isDest = WebSocketMessageHandlers.prototype.isDestructiveOperation('sidebar_save');
assert.strictEqual(isDest, true, 'sidebar_save must be marked as a destructive operation');

console.log('✅ sidebar_save destructive operation test passed!');
