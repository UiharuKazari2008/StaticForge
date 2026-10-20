'use strict';

const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    try {
        return originalLoad.apply(this, arguments);
    } catch (e) {
        if (e.code === 'MODULE_NOT_FOUND') {
            const dummy = function () {};
            dummy.format = { combine: () => {}, timestamp: () => {}, printf: () => {}, colorize: () => {}, json: () => {} };
            dummy.transports = { Console: dummy, File: dummy };
            dummy.createLogger = () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} });
            return dummy;
        }
        throw e;
    }
};

const assert = require('assert');
const { ApplicationAuthManager } = require('../modules/applicationAuthManager');

async function runTest() {
    console.log('Testing ApplicationAuthManager packet scope access for admin management packets...');

    const manager = new ApplicationAuthManager({});

    // 1. Un-scoped application auth packet (e.g., authenticate_application) - allowed for any key
    assert.strictEqual(
        manager.canAccessWsPacket(['gallery'], 'authenticate_application', 'admin'),
        true,
        'Application auth handshake packet should be accessible to scoped key'
    );

    // 2. Scoped key (e.g., gallery) attempting admin management packet (e.g., create_application_key) - MUST BE DENIED
    assert.strictEqual(
        manager.canAccessWsPacket(['gallery'], 'create_application_key', 'admin'),
        false,
        'Scoped key (gallery) MUST NOT access create_application_key'
    );

    assert.strictEqual(
        manager.canAccessWsPacket(['gallery'], 'list_application_keys', 'admin'),
        false,
        'Scoped key (gallery) MUST NOT access list_application_keys'
    );

    assert.strictEqual(
        manager.canAccessWsPacket(['gallery'], 'revoke_application_key', 'admin'),
        false,
        'Scoped key (gallery) MUST NOT access revoke_application_key'
    );

    // 3. Universal key attempting admin management packet - MUST BE ALLOWED
    assert.strictEqual(
        manager.canAccessWsPacket(['universal'], 'create_application_key', 'admin'),
        true,
        'Universal key MUST access create_application_key'
    );

    assert.strictEqual(
        manager.canAccessWsPacket(['universal'], 'list_application_keys', 'admin'),
        true,
        'Universal key MUST access list_application_keys'
    );

    // 4. Scoped key accessing allowed packet within its scope
    assert.strictEqual(
        manager.canAccessWsPacket(['gallery'], 'request_gallery', 'admin'),
        true,
        'Scoped key (gallery) MUST access request_gallery'
    );

    console.log('✅ All ApplicationAuthManager scope tests passed successfully!');
}

runTest().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
