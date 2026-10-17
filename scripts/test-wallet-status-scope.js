const assert = require('assert');
const Module = require('module');

// Override Module._load for missing native/optional dependencies (e.g. winston)
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === 'winston') {
        const dummy = () => {};
        return {
            format: { combine: dummy, timestamp: dummy, printf: dummy, colorize: dummy, errors: dummy, json: dummy, simple: dummy },
            createLogger: () => ({ info: dummy, error: dummy, warn: dummy, debug: dummy, log: dummy }),
            transports: { Console: class {}, File: class {} }
        };
    }
    try {
        return originalLoad.apply(this, arguments);
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            return {};
        }
        throw e;
    }
};

const { scopesAllowPacket, getPacketScopes, SCOPE_WS_PACKETS } = require('../modules/applicationAuthManager');

// JULES: Regression test for wallet_status scope mapping
console.log('Testing wallet_status scope configuration...');

// 1. Verify SCOPE_WS_PACKETS.infrastructure includes wallet_status
assert(Array.isArray(SCOPE_WS_PACKETS.infrastructure), 'SCOPE_WS_PACKETS.infrastructure should be an array');
assert(SCOPE_WS_PACKETS.infrastructure.includes('wallet_status'), 'SCOPE_WS_PACKETS.infrastructure must include wallet_status');

// 2. Verify getPacketScopes('wallet_status')
const scopes = getPacketScopes('wallet_status');
assert.deepStrictEqual(scopes, ['infrastructure'], `Expected ['infrastructure'], got ${JSON.stringify(scopes)}`);

// 3. Verify scopesAllowPacket
assert.strictEqual(scopesAllowPacket(['infrastructure'], 'wallet_status'), true, 'infrastructure scope should allow wallet_status');
assert.strictEqual(scopesAllowPacket(['universal'], 'wallet_status'), true, 'universal scope should allow wallet_status');
assert.strictEqual(scopesAllowPacket(['gallery'], 'wallet_status'), false, 'gallery scope should NOT allow wallet_status');
assert.strictEqual(scopesAllowPacket(['generation'], 'wallet_status'), false, 'generation scope should NOT allow wallet_status');
assert.strictEqual(scopesAllowPacket([], 'wallet_status'), false, 'empty scopes should NOT allow wallet_status');

console.log('All wallet_status scope tests passed successfully!');
