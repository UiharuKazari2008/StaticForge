'use strict';

/**
 * Regression test for application auth management packets in read-only destructive gate.
 * Run: node scripts/test-app-auth-destructive-gate.js
 */

const assert = require('assert');
const Module = require('module');

// Mock optional native/external modules missing in sandbox environment
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
    try {
        return origLoad.apply(this, arguments);
    } catch (err) {
        return {};
    }
};

const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');

const inst = Object.create(WebSocketMessageHandlers.prototype);

const appAuthDestructivePackets = [
    'create_application_key',
    'revoke_application_key',
    'approve_application_auth_request',
    'deny_application_auth_request'
];

for (const packetType of appAuthDestructivePackets) {
    const isDest = inst.isDestructiveOperation(packetType);
    assert.strictEqual(
        isDest,
        true,
        `Expected packet '${packetType}' to be marked as destructive in isDestructiveOperation`
    );
}

console.log('✓ test-app-auth-destructive-gate passed successfully');
