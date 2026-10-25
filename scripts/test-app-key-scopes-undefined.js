const Module = require('module');
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === 'winston') {
        const dummyFormat = () => {};
        dummyFormat.combine = () => {};
        dummyFormat.timestamp = () => {};
        dummyFormat.printf = () => {};
        dummyFormat.colorize = () => {};
        return {
            format: dummyFormat,
            createLogger: () => ({
                info: () => {},
                error: () => {},
                warn: () => {},
                debug: () => {}
            }),
            transports: {
                Console: function() {},
                File: function() {}
            }
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

const mockAppAuthManager = {
    canAccessWsPacket(scopes, packetType, userType) {
        const { ApplicationAuthManager } = require('../modules/applicationAuthManager');
        const inst = Object.create(ApplicationAuthManager.prototype);
        return inst.canAccessWsPacket(scopes, packetType, userType);
    }
};

const mockGlobalResources = {
    getApplicationAuthManager: () => mockAppAuthManager,
    getSessionStore: () => null
};

const handlers = Object.create(WebSocketMessageHandlers.prototype);
handlers.globalResources = mockGlobalResources;
handlers.isDestructiveOperation = () => false;
handlers.routeMessage = async () => {};

let sentResponse = null;
const mockWsServer = {
    sendToClient: (ws, response) => {
        sentResponse = response;
    }
};

async function runTest() {
    // 1. Test client with application_key and undefined applicationScopes
    const clientInfoUndefined = {
        authenticated: true,
        authMethod: 'application_key',
        applicationScopes: undefined,
        userType: 'admin'
    };

    const message = {
        type: 'vfs_read',
        requestId: 'req-1'
    };

    sentResponse = null;
    await handlers.handleMessage({}, message, clientInfoUndefined, mockWsServer);

    assert.ok(sentResponse, 'Response should be sent when applicationScopes is undefined');
    assert.strictEqual(sentResponse.code, 'INSUFFICIENT_SCOPE', 'Should fail with INSUFFICIENT_SCOPE when applicationScopes is undefined');

    // 2. Test client with application_key and valid scope for packet
    const clientInfoWithScope = {
        authenticated: true,
        authMethod: 'application_key',
        applicationScopes: ['vfs'],
        userType: 'admin'
    };

    sentResponse = null;
    await handlers.handleMessage({}, message, clientInfoWithScope, mockWsServer);

    assert.strictEqual(sentResponse, null, 'Should not fail scope check when applicationScopes includes required scope');

    console.log('✅ All scope enforcement tests passed!');
}

runTest().catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
