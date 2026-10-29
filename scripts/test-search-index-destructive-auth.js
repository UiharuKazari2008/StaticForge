const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    try {
        return originalLoad.apply(this, arguments);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND' || request === 'winston' || request === 'ws') {
            return {
                format: { combine: () => {}, timestamp: () => {}, printf: () => {}, colorize: () => {} },
                transports: { Console: class {}, File: class {} },
                createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} })
            };
        }
        throw err;
    }
};

const assert = require('assert');
const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');
const { scopesAllowPacket, ApplicationAuthManager } = require('../modules/applicationAuthManager');

console.log('Testing search index destructive operations & scope auth...');

// 1. Verify WebSocketMessageHandlers isDestructiveOperation
const isDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation;

const expectedDestructivePackets = [
    'search_index_rebuild_all',
    'search_index_trigger',
    'search_index_toggle_pause',
    'search_index_clear_cache',
    'director_custom_providers_save'
];

for (const packetType of expectedDestructivePackets) {
    assert.strictEqual(
        isDestructive(packetType),
        true,
        `Expected ${packetType} to be classified as destructive`
    );
}

// 2. Verify scope checking in applicationAuthManager
const authManager = new ApplicationAuthManager({});

for (const packetType of expectedDestructivePackets) {
    assert.strictEqual(
        scopesAllowPacket(['search'], packetType),
        true,
        `Expected 'search' scope to allow packet ${packetType}`
    );
    assert.strictEqual(
        authManager.canAccessWsPacket(['search'], packetType, 'admin'),
        true,
        `Expected authManager.canAccessWsPacket(['search'], '${packetType}') to be true`
    );
    assert.strictEqual(
        scopesAllowPacket(['gallery'], packetType),
        false,
        `Expected 'gallery' scope NOT to allow packet ${packetType}`
    );
}

console.log('✅ All tests passed successfully for search index destructive auth!');
