'use strict';

const WebSocket = require('ws');
const path = require('path');
const globalResources = require('../modules/globalResources');

async function testLiveWsConnection() {
    console.log('🧪 Starting Live End-to-End WebSocket Test for Cursor Accounts...');

    const dbPath = path.join(process.cwd(), '.cache', 'databases');
    await require('../modules/applicationAuthDatabase').initializeApplicationAuthDatabase(dbPath);
    await globalResources.initializeApplicationAuthManager();
    const appAuthManager = globalResources.getApplicationAuthManager();
    const ua = 'E2ETestClient/1.0';

    // 1. Issue temporary admin application key for WebSocket E2E test
    const keyInfo = await appAuthManager.createApplicationKey({
        name: 'E2E Test Client',
        userAgent: ua,
        userType: 'admin',
        scopes: ['universal']
    });

    console.log('🔑 Created temporary admin application key:', keyInfo.summary.id);

    return new Promise((resolve, reject) => {
        const ws = new WebSocket('ws://127.0.0.1:9220/');
        let testStep = 'init';

        const timeout = setTimeout(() => {
            ws.close();
            appAuthManager.revokeApplicationKey(keyInfo.summary.id).catch(() => {});
            reject(new Error(`WebSocket test timed out at step "${testStep}" after 10 seconds`));
        }, 10000);

        ws.on('open', () => {
            console.log('⚡ Connected to WebSocket port 9220. Authenticating application...');
            testStep = 'authenticate';
            ws.send(JSON.stringify({
                type: 'authenticate_application',
                applicationKey: keyInfo.key,
                userAgent: ua,
                requestId: 'req_auth_1'
            }));
        });

        ws.on('message', (data) => {
            try {
                const msg = JSON.parse(data.toString());

                if (msg.type === 'application_authenticated') {
                    console.log('✅ Authenticated successfully as admin via WebSocket!');
                    testStep = 'get_cursor_accounts';
                    ws.send(JSON.stringify({
                        type: 'get_cursor_accounts',
                        requestId: 'req_get_1'
                    }));
                } else if (msg.type === 'get_cursor_accounts_response') {
                    console.log('✅ Received get_cursor_accounts_response:', msg.data.accounts.length, 'accounts found');
                    testStep = 'save_cursor_account';
                    ws.send(JSON.stringify({
                        type: 'save_cursor_account',
                        name: 'E2E Test Account',
                        email: '',
                        token: '',
                        persona: 'wren',
                        requestId: 'req_save_1'
                    }));
                } else if (msg.type === 'save_cursor_account_response') {
                    console.log('✅ Received save_cursor_account_response:', msg.data.account.name, '(ID:', msg.data.account.id, ')');
                    const createdId = msg.data.account.id;
                    testStep = 'switch_cursor_account';
                    ws.send(JSON.stringify({
                        type: 'switch_cursor_account',
                        persona: 'wren',
                        accountId: createdId,
                        requestId: 'req_switch_1'
                    }));
                } else if (msg.type === 'switch_cursor_account_response') {
                    console.log('✅ Received switch_cursor_account_response for Wren:', msg.data.activeAccountId);
                    testStep = 'capture_cursor_account';
                    ws.send(JSON.stringify({
                        type: 'capture_cursor_account',
                        persona: 'wren',
                        accountId: msg.data.activeAccountId,
                        requestId: 'req_capture_1'
                    }));
                } else if (msg.type === 'capture_cursor_account_response') {
                    console.log('✅ Received capture_cursor_account_response:', msg.data.email);
                    testStep = 'delete_cursor_account';
                    ws.send(JSON.stringify({
                        type: 'delete_cursor_account',
                        accountId: msg.data.accountId,
                        requestId: 'req_delete_1'
                    }));
                } else if (msg.type === 'delete_cursor_account_response') {
                    console.log('✅ Received delete_cursor_account_response for account:', msg.data.accountId);
                    clearTimeout(timeout);
                    ws.close();
                    appAuthManager.revokeApplicationKey(keyInfo.summary.id).catch(() => {});
                    resolve(true);
                } else if (msg.type === 'error' || msg.type === 'auth_error') {
                    console.error('❌ Server sent error packet:', msg);
                    clearTimeout(timeout);
                    ws.close();
                    appAuthManager.revokeApplicationKey(keyInfo.summary.id).catch(() => {});
                    reject(new Error(msg.message || 'Server error'));
                }
            } catch (err) {
                console.error('Error handling message:', err.message);
            }
        });

        ws.on('error', (err) => {
            clearTimeout(timeout);
            appAuthManager.revokeApplicationKey(keyInfo.summary.id).catch(() => {});
            reject(err);
        });
    });
}

testLiveWsConnection()
    .then(() => {
        console.log('🎉 Live E2E WebSocket Cursor Accounts Test PASSED COMPLETELY!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('❌ Live E2E WebSocket Test FAILED:', err.message);
        process.exit(1);
    });
