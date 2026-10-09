'use strict';

const assert = require('assert');
const path = require('path');

async function testCursorAccounts() {
    console.log('Testing Cursor accounts DSAP backend handlers...');

    const adminHandler = require('../modules/ws/handlers/190-adminHandler');
    const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');

    // Create mock handlers context
    let secureConfigData = {
        loginPin: '123456',
        cursorAccounts: {
            wren: { activeAccountId: 'default', customToken: '' },
            xi: { activeAccountId: 'default', customToken: '' },
            accounts: [
                { id: 'default', name: 'Host Account (Default)', email: 'system@cursor.sh', isDefault: true }
            ]
        }
    };

    const mockGlobalResources = {
        getSecureConfig: () => secureConfigData,
        modifyConfig: (name) => ({
            assign: (key, val) => {
                secureConfigData[key] = val;
            }
        })
    };

    const mockHandlers = {
        globalResources: mockGlobalResources,
        sendToClient: (ws, payload) => {
            ws._lastResponse = payload;
        },
        sendError: (ws, msg, code, reqId) => {
            ws._lastError = { msg, code, reqId };
        }
    };

    const mockWs = {};
    const mockAdminClient = { userType: 'admin', sessionId: 'sess-1' };
    const mockUserClient = { userType: 'readonly', sessionId: 'sess-2' };

    // Register packets
    adminHandler.registerPackets(mockHandlers);

    // 1. Test permissions
    const getPacketHandler = wsPacketRegistry.getWsPacketHandler('get_cursor_accounts');
    assert.ok(getPacketHandler, 'get_cursor_accounts packet registered');

    await getPacketHandler({ handlers: mockHandlers, ws: mockWs, message: { requestId: 'r1' }, clientInfo: mockUserClient, wsServer: null });
    assert.strictEqual(mockWs._lastError.code, 'INSUFFICIENT_PERMISSIONS');

    // 2. Test get_cursor_accounts
    await getPacketHandler({ handlers: mockHandlers, ws: mockWs, message: { requestId: 'r2' }, clientInfo: mockAdminClient, wsServer: null });
    assert.strictEqual(mockWs._lastResponse.type, 'get_cursor_accounts_response');
    assert.strictEqual(mockWs._lastResponse.data.success, true);
    assert.strictEqual(mockWs._lastResponse.data.wren.activeAccountId, 'default');
    assert.strictEqual(mockWs._lastResponse.data.xi.activeAccountId, 'default');
    assert.strictEqual(mockWs._lastResponse.data.accounts.length, 1);

    // 3. Test save_cursor_account
    const savePacketHandler = wsPacketRegistry.getWsPacketHandler('save_cursor_account');
    assert.ok(savePacketHandler, 'save_cursor_account packet registered');

    await savePacketHandler({
        handlers: mockHandlers,
        ws: mockWs,
        message: { requestId: 'r3', name: 'Secondary Pro Account', email: 'pro@dreamscape.jp', token: 'token-xyz' },
        clientInfo: mockAdminClient,
        wsServer: null
    });
    assert.strictEqual(mockWs._lastResponse.type, 'save_cursor_account_response');
    assert.strictEqual(mockWs._lastResponse.data.success, true);
    assert.ok(mockWs._lastResponse.data.account.id.startsWith('acc_'));
    assert.strictEqual(secureConfigData.cursorAccounts.accounts.length, 2);

    const newAccId = mockWs._lastResponse.data.account.id;

    // 4. Test switch_cursor_account
    const switchPacketHandler = wsPacketRegistry.getWsPacketHandler('switch_cursor_account');
    assert.ok(switchPacketHandler, 'switch_cursor_account packet registered');

    await switchPacketHandler({
        handlers: mockHandlers,
        ws: mockWs,
        message: { requestId: 'r4', persona: 'wren', accountId: newAccId },
        clientInfo: mockAdminClient,
        wsServer: null
    });
    assert.strictEqual(mockWs._lastResponse.type, 'switch_cursor_account_response');
    assert.strictEqual(mockWs._lastResponse.data.success, true);
    assert.strictEqual(secureConfigData.cursorAccounts.wren.activeAccountId, newAccId);

    // 5. Test delete_cursor_account
    const deletePacketHandler = wsPacketRegistry.getWsPacketHandler('delete_cursor_account');
    assert.ok(deletePacketHandler, 'delete_cursor_account packet registered');

    await deletePacketHandler({
        handlers: mockHandlers,
        ws: mockWs,
        message: { requestId: 'r5', accountId: newAccId },
        clientInfo: mockAdminClient,
        wsServer: null
    });
    assert.strictEqual(mockWs._lastResponse.type, 'delete_cursor_account_response');
    assert.strictEqual(mockWs._lastResponse.data.success, true);
    assert.strictEqual(secureConfigData.cursorAccounts.accounts.length, 1);
    // Should reset wren back to default
    assert.strictEqual(secureConfigData.cursorAccounts.wren.activeAccountId, 'default');

    console.log('✅ All Cursor accounts DSAP backend tests passed!');
}

testCursorAccounts().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
