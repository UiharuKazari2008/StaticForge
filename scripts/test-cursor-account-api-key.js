'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const store = require('../modules/cursorAccountAuthStore');
const adminHandler = require('../modules/ws/handlers/190-adminHandler');
const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');

const ACCOUNT_ID = 'b5xi_api_key';
const PASTED_KEY = 'crsr_pastedkey00000000000000000000';
const MINTED_KEY = 'crsr_mintedkey00000000000000000000';
const OPAQUE_KEY = 'opaque-cursor-key-not-a-jwt-123456';

function jwt(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `eyJhbGciOiJub25lIn0.${body}.sig`;
}

function readAuth(accountId) {
    const file = path.join(store.getAccountDir(accountId), 'auth.json');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function mockResponse(status, body) {
    return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body)
    };
}

function cleanup() {
    fs.rmSync(store.getAccountDir(ACCOUNT_ID), { recursive: true, force: true });
}

async function testCredentialStorage() {
    cleanup();
    store.saveAccountAuthFiles(ACCOUNT_ID, { name: 'Primary Heavy', email: 'heavy@example.com' }, PASTED_KEY);
    let auth = readAuth(ACCOUNT_ID);
    assert.strictEqual(auth.apiKey, PASTED_KEY);
    assert.strictEqual(auth.accessToken, undefined, 'a crsr_ key must not be stored as an access token');

    store.saveAccountAuthFiles(ACCOUNT_ID, { name: 'Primary Heavy', email: 'heavy@example.com' }, 'sk-legacy-key-value');
    auth = readAuth(ACCOUNT_ID);
    assert.strictEqual(auth.apiKey, 'sk-legacy-key-value');
    assert.strictEqual(auth.accessToken, undefined);

    const session = jwt({ email: 'session@example.com' });
    store.saveAccountAuthFiles(ACCOUNT_ID, { name: 'Primary Heavy', email: '' }, session);
    auth = readAuth(ACCOUNT_ID);
    assert.strictEqual(auth.accessToken, session);
    assert.strictEqual(auth.apiKey, undefined);

    store.saveAccountAuthFiles(ACCOUNT_ID, {
        name: 'Primary Heavy',
        email: 'heavy@example.com',
        tokenKind: 'apiKey'
    }, OPAQUE_KEY);
    auth = readAuth(ACCOUNT_ID);
    assert.strictEqual(auth.apiKey, OPAQUE_KEY);
    assert.strictEqual(auth.accessToken, undefined);

    store.saveAccountAuthFiles(ACCOUNT_ID, { name: 'Primary Heavy', email: 'heavy@example.com' }, JSON.stringify({
        accessToken: PASTED_KEY,
        refreshToken: 'should-drop'
    }));
    auth = readAuth(ACCOUNT_ID);
    assert.strictEqual(auth.apiKey, PASTED_KEY);
    assert.strictEqual(auth.accessToken, undefined);
    assert.strictEqual(auth.refreshToken, undefined);
    cleanup();
}

function testLoginSpawnEnv() {
    const previous = {
        CURSOR_API_KEY: process.env.CURSOR_API_KEY,
        CURSOR_AUTH_TOKEN: process.env.CURSOR_AUTH_TOKEN,
        CURSOR_CONFIG_DIR: process.env.CURSOR_CONFIG_DIR,
        CURSOR_AGENT: process.env.CURSOR_AGENT,
        CURSOR_CONVERSATION_ID: process.env.CURSOR_CONVERSATION_ID,
        CURSOR_AGENT_STORE_X: process.env.CURSOR_AGENT_STORE_X,
        VSCODE_IPC_HOOK: process.env.VSCODE_IPC_HOOK
    };
    process.env.CURSOR_API_KEY = 'crsr_inherited_from_pm2_000000000000';
    process.env.CURSOR_AUTH_TOKEN = 'inherited-session';
    process.env.CURSOR_CONFIG_DIR = '/tmp/inherited-cursor';
    process.env.CURSOR_AGENT = '1';
    process.env.CURSOR_CONVERSATION_ID = 'conv';
    process.env.CURSOR_AGENT_STORE_X = 'store';
    process.env.VSCODE_IPC_HOOK = 'hook';
    try {
        const env = store.spawnEnvWithoutInheritedCursor({
            NO_OPEN_BROWSER: '1',
            CURSOR_CONFIG_DIR: '/safe/pending-login',
            BROWSER: 'echo'
        });
        assert.strictEqual(env.CURSOR_API_KEY, undefined);
        assert.strictEqual(env.CURSOR_AUTH_TOKEN, undefined);
        assert.strictEqual(env.CURSOR_AGENT, undefined);
        assert.strictEqual(env.CURSOR_CONVERSATION_ID, undefined);
        assert.strictEqual(env.CURSOR_AGENT_STORE_X, undefined);
        assert.strictEqual(env.VSCODE_IPC_HOOK, undefined);
        assert.strictEqual(env.CURSOR_CONFIG_DIR, '/safe/pending-login');
        assert.strictEqual(env.PATH, process.env.PATH);
        assert.strictEqual(env.NO_OPEN_BROWSER, '1');
    } finally {
        Object.keys(previous).forEach((key) => {
            if (previous[key] == null) delete process.env[key];
            else process.env[key] = previous[key];
        });
    }
}

async function testNamedApiKeyLogin() {
    cleanup();
    const calls = [];
    const session = jwt({ email: 'new@example.com' });
    const fetchImpl = async (url, opts) => {
        calls.push({ url, body: JSON.parse(opts.body), auth: opts.headers.Authorization });
        if (url.endsWith('/ListUserApiKeys')) {
            return mockResponse(200, {
                apiKeys: [
                    { id: 1, name: 'cli' },
                    { id: 9, name: store.dreamscapeApiKeyName(ACCOUNT_ID) },
                    { id: 10, name: store.dreamscapeApiKeyName(ACCOUNT_ID) }
                ]
            });
        }
        if (url.endsWith('/RevokeUserApiKey')) return mockResponse(200, {});
        if (url.endsWith('/CreateUserApiKey')) return mockResponse(200, { apiKey: MINTED_KEY });
        throw new Error(`unexpected ${url}`);
    };

    const cursorData = {
        accounts: [{
            id: ACCOUNT_ID,
            name: 'Primary Heavy',
            email: 'old@example.com',
            token: 'eyJold.token.expired',
            isEmpty: false
        }]
    };
    const recorded = await store.recordGuidedLogin(cursorData, ACCOUNT_ID, {
        accessToken: session,
        email: ''
    }, { fetchImpl });

    assert.strictEqual(recorded.provisionError, null);
    assert.strictEqual(recorded.token, MINTED_KEY);
    assert.strictEqual(recorded.account.token, MINTED_KEY);
    assert.notStrictEqual(recorded.account.token, 'eyJold.token.expired');
    assert.strictEqual(recorded.account.tokenKind, 'apiKey');
    assert.strictEqual(recorded.account.isEmpty, false);
    assert.strictEqual(recorded.account.email, 'new@example.com');

    const auth = readAuth(ACCOUNT_ID);
    assert.strictEqual(auth.apiKey, MINTED_KEY);
    assert.strictEqual(auth.accessToken, session, 'browser session kept beside the minted key for usage');

    store.saveAccountAuthFiles(ACCOUNT_ID, recorded.account, recorded.account.token);
    const restored = readAuth(ACCOUNT_ID);
    assert.strictEqual(restored.apiKey, MINTED_KEY, 'restore must keep the new API key');
    assert.strictEqual(restored.accessToken, session, 're-saving the same key keeps the session');

    const methods = calls.map((call) => call.url.split('/').pop());
    assert.deepStrictEqual(methods, ['ListUserApiKeys', 'RevokeUserApiKey', 'RevokeUserApiKey', 'CreateUserApiKey']);
    assert.deepStrictEqual(calls.filter((call) => call.url.endsWith('/RevokeUserApiKey')).map((call) => call.body.id), [9, 10]);
    assert.strictEqual(calls.find((call) => call.url.endsWith('/CreateUserApiKey')).body.name, `dreamscape-${ACCOUNT_ID}`);
    calls.forEach((call) => {
        assert.strictEqual(call.auth, `Bearer ${session}`);
    });
    cleanup();
}

async function testLoginKeepsFreshSessionWhenMintFails() {
    cleanup();
    const session = jwt({ email: 'fresh@example.com' });
    const cursorData = {
        accounts: [{
            id: ACCOUNT_ID,
            name: 'Primary Heavy',
            email: 'old@example.com',
            token: 'expired-session-token',
            isEmpty: false
        }]
    };
    const recorded = await store.recordGuidedLogin(cursorData, ACCOUNT_ID, {
        accessToken: session
    }, {
        fetchImpl: async () => {
            throw new Error('dashboard unavailable');
        }
    });
    assert.ok(recorded.provisionError);
    assert.strictEqual(recorded.account.token, session);
    assert.notStrictEqual(recorded.account.token, 'expired-session-token');
    const auth = readAuth(ACCOUNT_ID);
    assert.strictEqual(auth.accessToken, session);
    assert.strictEqual(auth.apiKey, undefined);
    cleanup();
}

async function testAccountsResponseOmitsTokens() {
    const secret = 'crsr_response_secret_00000000000000';
    let secureConfigData = {
        cursorAccounts: {
            wren: { activeAccountId: 'default', customToken: secret },
            xi: { activeAccountId: ACCOUNT_ID, customToken: secret },
            accounts: [
                { id: 'default', name: 'Host Account (Default)', email: 'host@example.com', isDefault: true },
                {
                    id: ACCOUNT_ID,
                    name: 'Primary Heavy',
                    email: 'heavy@example.com',
                    token: secret,
                    tokenKind: 'apiKey',
                    isEmpty: false
                }
            ]
        }
    };
    const mockHandlers = {
        globalResources: {
            getSecureConfig: () => secureConfigData,
            modifyConfig: () => ({ assign: () => {} })
        },
        sendToClient: (ws, payload) => { ws._lastResponse = payload; },
        sendError: (ws, msg, code, reqId) => { ws._lastError = { msg, code, reqId }; }
    };
    adminHandler.registerPackets(mockHandlers);
    const handler = wsPacketRegistry.getWsPacketHandler('get_cursor_accounts');
    const ws = {};
    await handler({
        handlers: mockHandlers,
        ws,
        message: { requestId: 'r-strip' },
        clientInfo: { userType: 'admin', sessionId: 'sess' },
        wsServer: null
    });
    const encoded = JSON.stringify(ws._lastResponse);
    assert.strictEqual(ws._lastResponse.type, 'get_cursor_accounts_response');
    assert.ok(!encoded.includes(secret), 'account tokens must not be sent to the client');
    assert.strictEqual(ws._lastResponse.data.wren.customToken, undefined);
    assert.strictEqual(ws._lastResponse.data.xi.customToken, undefined);
    assert.strictEqual(ws._lastResponse.data.xi.activeAccountId, ACCOUNT_ID);
    const heavy = ws._lastResponse.data.accounts.find((row) => row.id === ACCOUNT_ID);
    assert.ok(heavy);
    assert.strictEqual(heavy.token, undefined);
    assert.strictEqual(heavy.name, 'Primary Heavy');
}

async function main() {
    await testCredentialStorage();
    testLoginSpawnEnv();
    await testNamedApiKeyLogin();
    await testLoginKeepsFreshSessionWhenMintFails();
    await testAccountsResponseOmitsTokens();
    console.log('cursor account API key tests passed');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
