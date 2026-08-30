const assert = require('assert');
const crypto = require('crypto');
const { createMcpAuthMiddleware } = require('../modules/auth');
const { _test, McpOAuthProvider } = require('../modules/mcpAgentFacade');
const { validateRedirectUri, verifyPkceChallenge, parseScopes, ALLOWED_REDIRECT_URI_HOSTS } = require('../modules/mcpOAuthProvider');

assert.strictEqual(_test.isAllowedMcpOrigin(undefined), true);
assert.strictEqual(_test.isAllowedMcpOrigin(''), true);
assert.strictEqual(_test.isAllowedMcpOrigin('https://grok.com'), true);
assert.strictEqual(_test.isAllowedMcpOrigin('https://console.x.ai'), true);
assert.strictEqual(_test.isAllowedMcpOrigin('https://evil.example'), false);

assert.strictEqual(_test.sanitizeGalleryFilename('shot.png'), 'shot.png');
assert.strictEqual(_test.sanitizeGalleryFilename('  shot.png  '), 'shot.png');
assert.strictEqual(_test.sanitizeGalleryFilename('../etc/passwd'), null);
assert.strictEqual(_test.sanitizeGalleryFilename('a/b.png'), null);
assert.strictEqual(_test.sanitizeGalleryFilename(''), null);

const genOnly = _test.listToolsForScopes(['generation']);
assert.ok(genOnly.some((t) => t.name === 'generate_image'));
assert.ok(genOnly.some((t) => t.name === 'apply_studio_changes'));
assert.ok(genOnly.some((t) => t.name === 'bind_session'));
assert.ok(!genOnly.some((t) => t.name === 'get_images'));

const galleryOnly = _test.listToolsForScopes(['gallery']);
assert.ok(galleryOnly.some((t) => t.name === 'get_images'));
assert.ok(galleryOnly.some((t) => t.name === 'get_generated_image'));
assert.ok(!galleryOnly.some((t) => t.name === 'generate_image'));

const workspaceOnly = _test.listToolsForScopes(['workspace']);
assert.ok(workspaceOnly.some((t) => t.name === 'get_workspaces'));
assert.ok(!workspaceOnly.some((t) => t.name === 'generate_image'));

assert.ok(_test.TOOL_DEFS.every((t) => t.scope !== 'universal'));

async function runMcpAuth(options) {
    const seen = [];
    const manager = options.manager || {
        extractAuthFromRequest: (req) => {
            const header = req.headers['x-staticforge-app-key'] || '';
            const bearer = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
            const token = header || bearer;
            if (token && token.startsWith('sfapp_')) return { type: 'application_key', token };
            return null;
        },
        async validateApplicationKey(rawKey, userAgent, opts) {
            if (rawKey !== 'sfapp_testkey') {
                return { valid: false, code: 'INVALID_KEY', message: 'Invalid or revoked application key' };
            }
            const matched = String(userAgent || '').trim() === 'DreamscapeTest/1.0';
            if (opts && opts.unknownUserAgentBypass) {
                seen.push({ userAgent, matched, bypass: true });
            }
            if (!matched && !(opts && opts.unknownUserAgentBypass)) {
                return { valid: false, code: 'USER_AGENT_MISMATCH', message: 'User-Agent does not match registered application' };
            }
            return {
                valid: true,
                userType: 'admin',
                applicationKeyId: 'key-1',
                scopes: ['generation', 'gallery', 'workspace'],
                userAgentMatched: matched,
                userAgentBypassed: !matched
            };
        }
    };
    const globalResources = {
        getApplicationAuthManager: () => manager
    };
    const req = {
        headers: {
            ...(options.authorization ? { authorization: options.authorization } : {}),
            ...(options.appKey ? { 'x-staticforge-app-key': options.appKey } : {}),
            ...(options.userAgent ? { 'user-agent': options.userAgent } : {})
        },
        query: options.query || {},
        session: {}
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
    await createMcpAuthMiddleware(globalResources)(req, response, () => {
        continued = true;
    });
    return { req, response, continued, seen };
}

async function main() {
    const noKey = await runMcpAuth({});
    assert.strictEqual(noKey.continued, false);
    assert.strictEqual(noKey.response.statusCode, 401);
    assert.strictEqual(noKey.response.body.code, 'APP_KEY_REQUIRED');

    const queryAuth = await runMcpAuth({
        appKey: 'sfapp_testkey',
        userAgent: 'DreamscapeTest/1.0',
        query: { auth: 'sfapp_testkey' }
    });
    assert.strictEqual(queryAuth.continued, false);
    assert.strictEqual(queryAuth.response.statusCode, 400);
    assert.strictEqual(queryAuth.response.body.code, 'QUERY_AUTH_FORBIDDEN');

    const matched = await runMcpAuth({
        authorization: 'Bearer sfapp_testkey',
        userAgent: 'DreamscapeTest/1.0'
    });
    assert.strictEqual(matched.continued, true);
    assert.strictEqual(matched.req.authMethod, 'application_key');
    assert.strictEqual(matched.req.applicationAuth.userAgentMatched, true);
    assert.strictEqual(matched.req.applicationAuth.userAgentBypassed, false);
    assert.strictEqual(matched.seen.length, 1);
    assert.strictEqual(matched.seen[0].matched, true);

    const unknownUa = await runMcpAuth({
        authorization: 'Bearer sfapp_testkey',
        userAgent: 'Grok-Connector/0.0'
    });
    assert.strictEqual(unknownUa.continued, true, 'unknown UA must bypass, not 403');
    assert.strictEqual(unknownUa.req.applicationAuth.userAgentBypassed, true);
    assert.strictEqual(unknownUa.seen.length, 1);
    assert.strictEqual(unknownUa.seen[0].matched, false);
    assert.strictEqual(unknownUa.seen[0].userAgent, 'Grok-Connector/0.0');

    const init = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['generation'] } },
        { jsonrpc: '2.0', id: 1, method: 'initialize' }
    );
    assert.strictEqual(init.status, 200);
    assert.strictEqual(init.body.result.protocolVersion, _test.MCP_PROTOCOL_VERSION);
    assert.strictEqual(init.body.result.serverInfo.name, 'dreamscape');

    const listed = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['gallery'] }, authMethod: 'application_key' },
        { jsonrpc: '2.0', id: 2, method: 'tools/list' }
    );
    const names = listed.body.result.tools.map((t) => t.name);
    assert.ok(names.includes('get_images'));
    assert.ok(!names.includes('generate_image'));

    // OAuth 2.1 tests
    // modules/mcpOAuthProvider.js
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('grok.com'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('x.ai'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('127.0.0.1'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('localhost'));

    assert.deepStrictEqual(validateRedirectUri('https://grok.com/callback'), { valid: true });
    assert.deepStrictEqual(validateRedirectUri('https://x.ai/oauth'), { valid: true });
    assert.deepStrictEqual(validateRedirectUri('http://127.0.0.1:39123/callback'), { valid: true });
    assert.deepStrictEqual(validateRedirectUri('http://localhost:8080/cb'), { valid: true });
    assert.strictEqual(validateRedirectUri('https://evil.example/cb').valid, false);
    assert.strictEqual(validateRedirectUri('http://grok.com/cb').valid, false);
    assert.strictEqual(validateRedirectUri('ftp://grok.com/cb').valid, false);

    const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
    assert.strictEqual(verifyPkceChallenge(verifier, challenge), true);
    assert.strictEqual(verifyPkceChallenge('wrongverifier', challenge), false);

    assert.deepStrictEqual(parseScopes('generation gallery'), ['generation', 'gallery']);
    assert.deepStrictEqual(parseScopes('  generation   gallery  workspace '), ['generation', 'gallery', 'workspace']);
    assert.deepStrictEqual(parseScopes(''), []);
    assert.deepStrictEqual(parseScopes(null), []);

    const mockGlobalResources = {
        getMcpPathUuid: () => 'test-uuid-1234',
        getConfig: ({ path }) => path === 'public_hostname' ? 'staticforge.737.jp.net' : null,
        getApplicationAuthManager: () => ({
            validateApplicationKey: async () => ({ valid: true, applicationKeyId: 'key-1', scopes: ['generation', 'gallery'] })
        })
    };
    const oauthProvider = new McpOAuthProvider(mockGlobalResources);

    const protectedMeta = oauthProvider.getProtectedResourceMetadata();
    assert.strictEqual(protectedMeta.resource, 'https://staticforge.737.jp.net/test-uuid-1234');
    assert.ok(Array.isArray(protectedMeta.authorization_servers));
    assert.ok(protectedMeta.authorization_servers.includes('https://staticforge.737.jp.net'));
    assert.ok(Array.isArray(protectedMeta.scopes_supported));
    assert.ok(protectedMeta.scopes_supported.includes('generation'));

    const asMeta = oauthProvider.getAuthorizationServerMetadata();
    assert.strictEqual(asMeta.issuer, 'https://staticforge.737.jp.net');
    assert.strictEqual(asMeta.authorization_endpoint, 'https://staticforge.737.jp.net/test-uuid-1234/oauth/authorize');
    assert.strictEqual(asMeta.token_endpoint, 'https://staticforge.737.jp.net/test-uuid-1234/oauth/token');
    assert.strictEqual(asMeta.registration_endpoint, 'https://staticforge.737.jp.net/test-uuid-1234/oauth/register');
    assert.deepStrictEqual(asMeta.response_types_supported, ['code']);
    assert.deepStrictEqual(asMeta.code_challenge_methods_supported, ['S256']);
    assert.deepStrictEqual(asMeta.token_endpoint_auth_methods_supported, ['none']);

    console.log('test-mcp-agent-facade: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
