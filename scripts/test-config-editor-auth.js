const assert = require('assert');
const configEditorHandler = require('../modules/ws/handlers/20-configEditorHandler');
const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');

async function main() {
    let sentError = null;
    const mockHandlersCtx = {
        sendError: (ws, message, code, requestId) => {
            sentError = { message, code, requestId };
        },
        sendToClient: (ws, data) => {},
        globalResources: {
            getConfigEditorService: () => ({
                applyPatches: () => ({ success: true })
            })
        }
    };

    // Register handler to wsPacketRegistry
    configEditorHandler.registerPackets(mockHandlersCtx);

    const nonAdminClient = { userType: 'user', sessionId: 'sess-1' };

    // Test 1: handleConfigEditorSave with non-admin clientInfo
    sentError = null;
    const configSaveHandler = wsPacketRegistry.getWsPacketHandler('config_editor_save');
    assert.ok(configSaveHandler, 'config_editor_save handler should be registered');

    await configSaveHandler({
        handlers: mockHandlersCtx,
        ws: {},
        message: { type: 'config_editor_save', patches: {}, requestId: 'req-1' },
        clientInfo: nonAdminClient,
        wsServer: {}
    });

    assert.ok(sentError, 'Non-admin config_editor_save should trigger sendError');
    assert.strictEqual(sentError.code, 'FORBIDDEN');
    assert.strictEqual(sentError.message, 'Admin access required');

    // Test 2: Call config_editor_save as admin
    sentError = null;
    const adminClient = { userType: 'admin', sessionId: 'sess-admin' };
    await configSaveHandler({
        handlers: mockHandlersCtx,
        ws: {},
        message: { type: 'config_editor_save', patches: {}, requestId: 'req-2' },
        clientInfo: adminClient,
        wsServer: { sendToClient: () => {} }
    });
    assert.strictEqual(sentError, null, 'Admin config_editor_save should not trigger FORBIDDEN error');

    console.log('test-config-editor-auth: ok');
}

main().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
