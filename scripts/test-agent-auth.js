const assert = require('assert');
const { createDevAuthMiddleware, isLoopbackAddress } = require('../modules/auth');

const TEST_KEY = 'test-only-agent-key';

async function runMiddleware({
    remoteAddress,
    authorization,
    forwardedFor,
    queryAuth,
    appKeyHeader,
    enableDev = true,
    devLoginKey = TEST_KEY,
    session = {},
    applicationAuthManager
}) {
    const globalResources = {
        getConfig: ({ path }) => path === 'enable_dev' ? enableDev : undefined,
        getSecureConfig: ({ path }) => path === 'devLoginKey' ? devLoginKey : undefined
    };
    if (applicationAuthManager) {
        globalResources.getApplicationAuthManager = () => applicationAuthManager;
    }
    const req = {
        socket: { remoteAddress },
        headers: {
            ...(authorization ? { authorization } : {}),
            ...(appKeyHeader ? { 'x-staticforge-app-key': appKeyHeader } : {}),
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
    await createDevAuthMiddleware(globalResources)(req, response, () => {
        continued = true;
    });
    return { req, response, continued };
}

async function main() {
    assert.strictEqual(isLoopbackAddress('127.0.0.1'), true);
    assert.strictEqual(isLoopbackAddress('::1'), true);
    assert.strictEqual(isLoopbackAddress('::ffff:127.0.0.1'), true);
    assert.strictEqual(isLoopbackAddress('192.0.2.10'), false);

    const remoteWithKey = await runMiddleware({
        remoteAddress: '192.0.2.10',
        authorization: 'Bearer ' + TEST_KEY
    });
    assert.strictEqual(remoteWithKey.response.statusCode, 403);
    assert.strictEqual(remoteWithKey.continued, false);

    const spoofedForward = await runMiddleware({
        remoteAddress: '198.51.100.20',
        authorization: 'Bearer ' + TEST_KEY,
        forwardedFor: '127.0.0.1'
    });
    assert.strictEqual(spoofedForward.response.statusCode, 403);
    assert.strictEqual(spoofedForward.continued, false);

    const existingSessionWithoutKey = await runMiddleware({
        remoteAddress: '127.0.0.1',
        session: { authenticated: true, userType: 'admin' }
    });
    assert.strictEqual(existingSessionWithoutKey.response.statusCode, 401);
    assert.strictEqual(existingSessionWithoutKey.continued, false);

    const disabled = await runMiddleware({
        remoteAddress: '127.0.0.1',
        authorization: 'Bearer ' + TEST_KEY,
        enableDev: false
    });
    assert.strictEqual(disabled.response.statusCode, 404);
    assert.strictEqual(disabled.continued, false);

    const missingKey = await runMiddleware({
        remoteAddress: '127.0.0.1',
        authorization: 'Bearer ' + TEST_KEY,
        devLoginKey: null
    });
    assert.strictEqual(missingKey.response.statusCode, 500);
    assert.strictEqual(missingKey.response.body.code, 'DEV_LOGIN_KEY_NOT_CONFIGURED');
    assert.strictEqual(missingKey.response.body.configPath, 'secure.config.json:devLoginKey');
    assert.strictEqual(missingKey.continued, false);

    const accepted = await runMiddleware({
        remoteAddress: '127.0.0.1',
        authorization: 'Bearer ' + TEST_KEY
    });
    assert.strictEqual(accepted.continued, true);
    assert.strictEqual(accepted.req.session.authenticated, true);
    assert.strictEqual(accepted.req.session.userType, 'dev_admin');

    let seenOptions = null;
    const loopbackAppKey = await runMiddleware({
        remoteAddress: '127.0.0.1',
        appKeyHeader: 'sfapp_placeholder_not_a_real_key',
        applicationAuthManager: {
            extractAuthFromRequest() {
                return { type: 'application_key', token: 'sfapp_placeholder_not_a_real_key' };
            },
            async validateApplicationKey(_token, _userAgent, options) {
                seenOptions = options;
                return {
                    valid: true,
                    userType: 'admin',
                    applicationKeyId: 1,
                    scopes: ['universal']
                };
            }
        }
    });
    assert.strictEqual(loopbackAppKey.continued, true);
    assert.strictEqual(loopbackAppKey.req.authMethod, 'application_key');
    assert.deepStrictEqual(seenOptions, { allowRefreshOverdue: true, skipUserAgent: true });

    const remoteAppKey = await runMiddleware({
        remoteAddress: '192.0.2.10',
        appKeyHeader: 'sfapp_placeholder_not_a_real_key',
        applicationAuthManager: {
            extractAuthFromRequest() {
                return { type: 'application_key', token: 'sfapp_placeholder_not_a_real_key' };
            },
            async validateApplicationKey() {
                throw new Error('validateApplicationKey must not run for non-loopback');
            }
        }
    });
    assert.strictEqual(remoteAppKey.response.statusCode, 403);
    assert.strictEqual(remoteAppKey.continued, false);

    console.log('Agent auth regression checks passed.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
