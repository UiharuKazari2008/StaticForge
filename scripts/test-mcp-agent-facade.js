const assert = require('assert');
const { createMcpAuthMiddleware } = require('../modules/auth');
const { _test } = require('../modules/mcpAgentFacade');

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

    console.log('test-mcp-agent-facade: ok');
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
