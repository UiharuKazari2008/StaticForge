// JULES: Regression test for sfapp_dovecote scope WebSocket packet access
const assert = require('assert');
const Module = require('module');

// Override Module._load for missing sandbox native modules
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
    if (request === 'winston') {
        return {
            format: { combine: () => ({}), timestamp: () => ({}), printf: () => ({}), errors: () => ({}), colorize: () => ({}) },
            transports: { Console: class {}, File: class {} },
            createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} })
        };
    }
    try {
        return origLoad.apply(this, arguments);
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') return {};
        throw e;
    }
};

const { ApplicationAuthManager, SCOPE_WS_PACKETS, scopesAllowPacket, getPacketScopes } = require('../modules/applicationAuthManager');

console.log('Testing sfapp_dovecote scope packet access...');

// 1. Check that SCOPE_WS_PACKETS has sfapp_dovecote defined
assert(Array.isArray(SCOPE_WS_PACKETS.sfapp_dovecote), 'SCOPE_WS_PACKETS.sfapp_dovecote must be an array');
assert(SCOPE_WS_PACKETS.sfapp_dovecote.includes('dovecote_list_mail'), 'dovecote_list_mail must be in SCOPE_WS_PACKETS.sfapp_dovecote');
assert(SCOPE_WS_PACKETS.sfapp_dovecote.includes('dovecote_send_mail'), 'dovecote_send_mail must be in SCOPE_WS_PACKETS.sfapp_dovecote');

// 2. Test getPacketScopes
const scopesForListMail = getPacketScopes('dovecote_list_mail');
assert(scopesForListMail.includes('sfapp_dovecote'), 'getPacketScopes("dovecote_list_mail") should include "sfapp_dovecote"');

// 3. Test scopesAllowPacket
assert.strictEqual(scopesAllowPacket(['sfapp_dovecote'], 'dovecote_list_mail'), true, 'sfapp_dovecote scope should allow dovecote_list_mail');
assert.strictEqual(scopesAllowPacket(['gallery'], 'dovecote_list_mail'), false, 'gallery scope should not allow dovecote_list_mail');

// 4. Test ApplicationAuthManager.canAccessWsPacket
const manager = new ApplicationAuthManager({});
for (const packetType of SCOPE_WS_PACKETS.sfapp_dovecote) {
    assert.strictEqual(
        manager.canAccessWsPacket(['sfapp_dovecote'], packetType, 'admin'),
        true,
        `canAccessWsPacket should allow ${packetType} for sfapp_dovecote scope`
    );
    assert.strictEqual(
        manager.canAccessWsPacket(['gallery'], packetType, 'admin'),
        false,
        `canAccessWsPacket should deny ${packetType} for gallery scope`
    );
}

console.log('✓ All sfapp_dovecote scope assertions passed successfully!');
