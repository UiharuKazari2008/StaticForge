const assert = require('assert');
const { createDevAuthMiddleware, isLoopbackAddress } = require('../modules/auth');

const TEST_KEY = 'test-only-agent-key';

function runMiddleware({ remoteAddress, authorization, forwardedFor, queryAuth, enableDev = true, devLoginKey = TEST_KEY, session = {} }) {
    const globalResources = {
        getConfig: ({ path }) => path === 'enable_dev' ? enableDev : undefined,
        getSecureConfig: ({ path }) => path === 'devLoginKey' ? devLoginKey : undefined
    };
    const req = {
        socket: { remoteAddress },
        headers: {
            ...(authorization ? { authorization } : {}),
            ...(forwardedFor ? { 'x-forwarded-for': forwardedFor } : {})
        },
        query: queryAuth ? { auth: queryAuth } : {},
        session
    };
    const response = {
        statusCode: 200,
        body: null,
        setHeader() {},
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(body) {
            this.body = body;
            return this;
        }
    };
    let continued = false;
    createDevAuthMiddleware(globalResources)(req, response, () => {
        continued = true;
    });
    return { req, response, continued };
}

assert.strictEqual(isLoopbackAddress('127.0.0.1'), true);
assert.strictEqual(isLoopbackAddress('::1'), true);
assert.strictEqual(isLoopbackAddress('::ffff:127.0.0.1'), true);
assert.strictEqual(isLoopbackAddress('192.0.2.10'), false);

const remoteWithKey = runMiddleware({
    remoteAddress: '192.0.2.10',
    authorization: `Bearer ${TEST_KEY}`
});
assert.strictEqual(remoteWithKey.response.statusCode, 403);
assert.strictEqual(remoteWithKey.continued, false);

const spoofedForward = runMiddleware({
    remoteAddress: '198.51.100.20',
    authorization: `Bearer ${TEST_KEY}`,
    forwardedFor: '127.0.0.1'
});
assert.strictEqual(spoofedForward.response.statusCode, 403);
assert.strictEqual(spoofedForward.continued, false);

const existingSessionWithoutKey = runMiddleware({
    remoteAddress: '127.0.0.1',
    session: { authenticated: true, userType: 'admin' }
});
assert.strictEqual(existingSessionWithoutKey.response.statusCode, 401);
assert.strictEqual(existingSessionWithoutKey.continued, false);

const disabled = runMiddleware({
    remoteAddress: '127.0.0.1',
    authorization: `Bearer ${TEST_KEY}`,
    enableDev: false
});
assert.strictEqual(disabled.response.statusCode, 404);
assert.strictEqual(disabled.continued, false);

const missingKey = runMiddleware({
    remoteAddress: '127.0.0.1',
    authorization: `Bearer ${TEST_KEY}`,
    devLoginKey: null
});
assert.strictEqual(missingKey.response.statusCode, 500);
assert.strictEqual(missingKey.response.body.code, 'DEV_LOGIN_KEY_NOT_CONFIGURED');
assert.strictEqual(missingKey.response.body.configPath, 'secure.config.json:devLoginKey');
assert.strictEqual(missingKey.continued, false);

const accepted = runMiddleware({
    remoteAddress: '127.0.0.1',
    authorization: `Bearer ${TEST_KEY}`
});
assert.strictEqual(accepted.continued, true);
assert.strictEqual(accepted.req.session.authenticated, true);
assert.strictEqual(accepted.req.session.userType, 'dev_admin');

console.log('Agent auth regression checks passed.');
