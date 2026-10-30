// JULES: Regression test for search index mutation packets and director_custom_providers_save destructive operations and scope mapping
const assert = require('assert');
const path = require('path');
const Module = require('module');

// Override Module._load for winston if missing in sandbox
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        return {
            format: { combine: () => {}, timestamp: () => {}, errors: () => {}, splat: () => {}, json: () => {}, printf: () => {}, colorize: () => {} },
            transports: { Console: class {}, File: class {} },
            createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} })
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

const repoRoot = path.join(__dirname, '..');
const { WebSocketMessageHandlers } = require(path.join(repoRoot, 'modules/websocketHandlers'));
const { ApplicationAuthManager, scopesAllowPacket, getPacketScopes } = require(path.join(repoRoot, 'modules/applicationAuthManager'));

async function runTests() {
    console.log('Running security sweep regression tests...');

    // 1. Verify isDestructiveOperation on WebSocketMessageHandlers.prototype
    const isDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation;

    const testDestructivePackets = [
        'search_index_rebuild_all',
        'search_index_trigger',
        'search_index_toggle_pause',
        'search_index_clear_cache',
        'director_custom_providers_save'
    ];

    for (const packetType of testDestructivePackets) {
        assert.strictEqual(
            isDestructive(packetType),
            true,
            `Expected ${packetType} to be flagged as destructive`
        );
        console.log(`✓ ${packetType} is correctly flagged as destructive`);
    }

    // 2. Verify SCOPE_WS_PACKETS scope mapping in applicationAuthManager
    const searchPackets = [
        'search_index_rebuild_all',
        'search_index_trigger',
        'search_index_toggle_pause',
        'search_index_clear_cache',
        'search_index_prepare_cache'
    ];

    for (const packetType of searchPackets) {
        const scopes = getPacketScopes(packetType);
        assert.ok(scopes.includes('search'), `Expected ${packetType} to be in 'search' scope`);
        assert.strictEqual(
            scopesAllowPacket(['search'], packetType),
            true,
            `Expected scopesAllowPacket(['search'], '${packetType}') to be true`
        );
        console.log(`✓ ${packetType} is mapped to 'search' scope`);
    }

    const chatScopes = getPacketScopes('director_custom_providers_save');
    assert.ok(chatScopes.includes('chat'), "Expected 'director_custom_providers_save' to be in 'chat' scope");
    assert.strictEqual(
        scopesAllowPacket(['chat'], 'director_custom_providers_save'),
        true,
        "Expected scopesAllowPacket(['chat'], 'director_custom_providers_save') to be true"
    );
    console.log("✓ director_custom_providers_save is mapped to 'chat' scope");

    console.log('All security sweep regression tests passed successfully!');
}

runTests().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
