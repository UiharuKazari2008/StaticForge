const assert = require('assert');
const Module = require('module');

// Mock missing optional native/heavy dependencies if running in sandbox without node_modules
const originalRequire = Module.prototype.require;
Module.prototype.require = function(path) {
    if (path === 'winston') {
        const dummy = class {};
        return {
            createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
            format: { combine: () => {}, timestamp: () => {}, printf: () => {}, colorize: () => {}, errors: () => {}, splat: () => {}, json: () => {} },
            transports: { Console: dummy, File: dummy }
        };
    }
    if (path === 'sqlite3' || path === 'sqlite' || path === 'better-sqlite3') {
        return function() { return { prepare: () => ({ run: () => {}, get: () => {}, all: () => [] }) }; };
    }
    if (path === 'sharp' || path === 'canvas') {
        return function() { return {}; };
    }
    return originalRequire.apply(this, arguments);
};

const {
    getPacketScopes,
    scopesAllowPacket
} = require('../modules/applicationAuthManager');

// Test that get_studio_explore_feed is mapped to the explore scope
const scopes = getPacketScopes('get_studio_explore_feed');
assert.ok(Array.isArray(scopes), 'scopes should be an array');
assert.ok(scopes.includes('explore'), 'get_studio_explore_feed should have "explore" scope');

// Test that scopesAllowPacket correctly permits tokens with 'explore' scope
assert.strictEqual(scopesAllowPacket(['explore'], 'get_studio_explore_feed'), true, 'explore scope should allow get_studio_explore_feed');
assert.strictEqual(scopesAllowPacket(['universal'], 'get_studio_explore_feed'), true, 'universal scope should allow get_studio_explore_feed');
assert.strictEqual(scopesAllowPacket(['gallery'], 'get_studio_explore_feed'), false, 'gallery scope should not allow get_studio_explore_feed');

console.log('test-explore-scope-authorization: ok');
