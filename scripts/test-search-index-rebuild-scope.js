const assert = require('assert');
const Module = require('module');

// Override Module._load for sandbox dependency mocking if needed
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        return {
            format: { combine: () => {}, timestamp: () => {}, printf: () => {}, colorize: () => {} },
            createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
            transports: { Console: function () {}, File: function () {} }
        };
    }
    try {
        return originalLoad.apply(this, arguments);
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') return {};
        throw e;
    }
};

const { ApplicationAuthManager, SCOPE_WS_PACKETS } = require('../modules/applicationAuthManager');

console.log('Testing search_index_rebuild_all scope mapping...');

const appAuthManager = new ApplicationAuthManager({});

// Verify search_index_rebuild_all is in SCOPE_WS_PACKETS.search
assert(
    SCOPE_WS_PACKETS.search.includes('search_index_rebuild_all'),
    'search_index_rebuild_all should be present in SCOPE_WS_PACKETS.search'
);

// Verify canAccessWsPacket allows search_index_rebuild_all for a key with search scope
const searchScopes = ['search'];
const canAccess = appAuthManager.canAccessWsPacket(searchScopes, 'search_index_rebuild_all', 'admin');
assert.strictEqual(
    canAccess,
    true,
    'canAccessWsPacket should return true for search_index_rebuild_all with search scope'
);

console.log('✅ Test passed successfully!');
