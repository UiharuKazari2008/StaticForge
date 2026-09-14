const assert = require('assert');
const configEditorHandler = require('../modules/ws/handlers/20-configEditorHandler');
const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');

async function main() {
    let sentError = null;
    const mockHandlersCtx = {
        sendError: (ws, message, code, requestId) => {
            sentError = { message, code, requestId };
        },
        sendToClient: () => {},
        globalResources: {
            getConfigEditorService: () => ({
                applyPatches: () => ({ success: true })
            })
        }
    };

    configEditorHandler.registerPackets(mockHandlersCtx);

    const configSaveHandler = wsPacketRegistry.getWsPacketHandler('config_editor_save');
    assert.ok(configSaveHandler, 'config_editor_save handler should be registered');

    sentError = null;
    await configSaveHandler({
        handlers: mockHandlersCtx,
        ws: {},
        message: { type: 'config_editor_save', patches: {}, requestId: 'req-1' },
        clientInfo: { userType: 'user', sessionId: 'sess-1' },
        wsServer: {}
    });
    assert.ok(sentError, 'Non-admin config_editor_save should trigger sendError');
    assert.strictEqual(sentError.code, 'FORBIDDEN');
    assert.strictEqual(sentError.message, 'Admin access required');

    sentError = null;
    await configSaveHandler({
        handlers: mockHandlersCtx,
        ws: {},
        message: { type: 'config_editor_save', patches: {}, requestId: 'req-2' },
        clientInfo: { userType: 'admin', sessionId: 'sess-admin' },
        wsServer: {}
    });
    assert.strictEqual(sentError, null, 'Admin config_editor_save should not trigger FORBIDDEN error');

    console.log('test-config-editor-auth: ok');
}

main().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
