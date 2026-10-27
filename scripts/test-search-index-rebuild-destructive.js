const Module = require('module');
const originalLoad = Module._load;

Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        return {
            format: {
                combine: () => {},
                timestamp: () => {},
                printf: () => {},
                colorize: () => {},
                errors: () => {}
            },
            transports: {
                Console: function () {},
                File: function () {}
            },
            createLogger: () => ({
                info: () => {},
                warn: () => {},
                error: () => {},
                debug: () => {}
            })
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

const assert = require('assert');
const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');
const { ApplicationAuthManager, SCOPE_WS_PACKETS, scopesAllowPacket } = require('../modules/applicationAuthManager');

console.log('Testing WebSocketMessageHandlers.prototype.isDestructiveOperation...');

// Test 1: Verify search_index_rebuild_all is recognized as destructive
const isRebuildAllDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation('search_index_rebuild_all');
assert.strictEqual(isRebuildAllDestructive, true, 'search_index_rebuild_all should be a destructive operation');

// Test 2: Verify other search index mutation packets are destructive
const isTriggerDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation('search_index_trigger');
assert.strictEqual(isTriggerDestructive, true, 'search_index_trigger should be a destructive operation');

const isTogglePauseDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation('search_index_toggle_pause');
assert.strictEqual(isTogglePauseDestructive, true, 'search_index_toggle_pause should be a destructive operation');

const isClearCacheDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation('search_index_clear_cache');
assert.strictEqual(isClearCacheDestructive, true, 'search_index_clear_cache should be a destructive operation');

// Test 3: Verify director_custom_providers_save is destructive
const isDirectorCustomProvidersSaveDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation('director_custom_providers_save');
assert.strictEqual(isDirectorCustomProvidersSaveDestructive, true, 'director_custom_providers_save should be a destructive operation');

// Test 4: Verify search_index_rebuild_all is accessible under search scope
const searchScopeAllowed = scopesAllowPacket(['search'], 'search_index_rebuild_all');
assert.strictEqual(searchScopeAllowed, true, 'search_index_rebuild_all should be accessible with search scope');

// Test 5: Verify non-destructive packets return false
const isSearchTagsDestructive = WebSocketMessageHandlers.prototype.isDestructiveOperation('search_tags');
assert.strictEqual(isSearchTagsDestructive, false, 'search_tags should not be a destructive operation');

console.log('✅ All regression tests for search_index_rebuild_all destructive operation passed!');
