'use strict';

const assert = require('assert');
const Module = require('module');

// Override Module._load to handle missing native/external dependencies in sandbox
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === 'winston') {
        return {
            format: { combine: () => {}, timestamp: () => {}, printf: () => {}, colorize: () => {}, errors: () => {} },
            transports: { Console: class {}, File: class {} },
            createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} })
        };
    }
    try {
        return origLoad.apply(this, arguments);
    } catch (err) {
        if (err.code === 'MODULE_NOT_FOUND') return {};
        throw err;
    }
};

const { scopesAllowPacket, getPacketScopes } = require('../modules/applicationAuthManager');

console.log('Testing infrastructure scope allowance for get_system_info...');

const scopes = getPacketScopes('get_system_info');
console.log('Required scopes for get_system_info:', scopes);
assert(scopes.includes('infrastructure'), 'get_system_info should be mapped to infrastructure scope');

const allowed = scopesAllowPacket(['infrastructure'], 'get_system_info');
console.log('scopesAllowPacket(["infrastructure"], "get_system_info") =', allowed);
assert.strictEqual(allowed, true, 'infrastructure scope should allow get_system_info packet');

console.log('✅ Infrastructure scope test passed!');
