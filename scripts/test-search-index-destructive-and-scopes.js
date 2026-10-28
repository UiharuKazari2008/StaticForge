const assert = require('assert');
const Module = require('module');

// Mock missing native/external packages in sandbox environment
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        return {
            format: { combine: () => {}, timestamp: () => {}, printf: () => {}, errors: () => {}, colorize: () => {} },
            transports: { Console: class {}, File: class {} },
            createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} })
        };
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

const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');
const { scopesAllowPacket, getPacketScopes } = require('../modules/applicationAuthManager');

console.log('Running search index & director custom providers security gate test...');

const packetsToCheck = [
    'search_index_rebuild_all',
    'search_index_trigger',
    'search_index_toggle_pause',
    'search_index_clear_cache',
    'director_custom_providers_save'
];

// Check isDestructiveOperation
for (const pkt of packetsToCheck) {
    const isDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation(pkt);
    assert.strictEqual(
        isDestructive,
        true,
        `Expected packet '${pkt}' to be flagged as destructive in WebSocketMessageHandlers.isDestructiveOperation`
    );
}

// Check search scope in applicationAuthManager
const searchIndexPackets = [
    'search_index_rebuild_all',
    'search_index_trigger',
    'search_index_toggle_pause',
    'search_index_clear_cache'
];

for (const pkt of searchIndexPackets) {
    const scopes = getPacketScopes(pkt);
    assert.ok(
        scopes.includes('search'),
        `Expected packet '${pkt}' to be mapped to 'search' scope in SCOPE_WS_PACKETS, got: ${JSON.stringify(scopes)}`
    );
    assert.strictEqual(
        scopesAllowPacket(['search'], pkt),
        true,
        `Expected scopesAllowPacket(['search'], '${pkt}') to be true`
    );
}

console.log('✅ Search index & director custom providers security test passed!');
