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
assert.strictEqual(_test.isAllowedMcpOrigin('https://cursor.com'), false);
assert.strictEqual(_test.isAllowedMcpOrigin('https://staticforge.737.jp.net'), false);

const oauthReq = { protocol: 'https', get: (name) => name === 'host' ? 'staticforge.737.jp.net' : undefined };
const oauthProviderForCors = { getMcpBaseUrl: () => 'https://staticforge.737.jp.net' };
assert.strictEqual(_test.isAllowedOAuthOrigin(undefined), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://grok.com', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://cursor.com', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://staticforge.737.jp.net', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('http://127.0.0.1:9220', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://evil.example', oauthReq, oauthProviderForCors), false);
assert.strictEqual(_test.isAllowedOAuthOrigin('null', oauthReq, oauthProviderForCors), true);
assert.strictEqual(_test.isAbsentOrigin('null'), true);
assert.strictEqual(_test.isAllowedOAuthOrigin('https://evil.example', {
    protocol: 'https',
    get: () => 'staticforge.737.jp.net',
    headers: { 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate', 'sec-fetch-site': 'same-origin' }
}, oauthProviderForCors), true);

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

const autofillOnly = _test.listToolsForScopes(['autofill']);
assert.ok(autofillOnly.some((t) => t.name === 'search_autofill'));
assert.ok(autofillOnly.some((t) => t.name === 'search_wiki'), 'autofill keys already include wiki packets');
assert.ok(autofillOnly.some((t) => t.name === 'get_wiki_page'));
assert.ok(!autofillOnly.some((t) => t.name === 'generate_image'));

const wikiOnly = _test.listToolsForScopes(['wiki']);
assert.ok(wikiOnly.some((t) => t.name === 'search_wiki'));
assert.ok(wikiOnly.some((t) => t.name === 'get_wiki_page'));
assert.ok(wikiOnly.some((t) => t.name === 'list_static_wiki_sites'));
assert.ok(wikiOnly.some((t) => t.name === 'search_static_wiki'));
assert.ok(wikiOnly.some((t) => t.name === 'get_static_wiki_page'));
assert.ok(!wikiOnly.some((t) => t.name === 'search_autofill'));

const presetsOnly = _test.listToolsForScopes(['presets']);
assert.ok(presetsOnly.some((t) => t.name === 'list_presets'));
assert.ok(presetsOnly.some((t) => t.name === 'save_preset'));
assert.ok(presetsOnly.some((t) => t.name === 'apply_preset_to_studio'));
assert.ok(!presetsOnly.some((t) => t.name === 'generate_preset'));

const generationTools = _test.listToolsForScopes(['generation']);
assert.ok(generationTools.some((t) => t.name === 'generate_preset'));

const refsOnly = _test.listToolsForScopes(['references']);
assert.ok(refsOnly.some((t) => t.name === 'list_references'));
assert.ok(refsOnly.some((t) => t.name === 'upload_reference'));

const searchOnly = _test.listToolsForScopes(['search']);
assert.ok(searchOnly.some((t) => t.name === 'omegasearch'));
assert.ok(!searchOnly.some((t) => t.name === 'search_autofill'));

const notesOnly = _test.listToolsForScopes(['notes']);
assert.ok(notesOnly.some((t) => t.name === 'list_notes'));
assert.ok(notesOnly.some((t) => t.name === 'create_note'));
assert.ok(notesOnly.some((t) => t.name === 'save_note_content'));
assert.ok(!notesOnly.some((t) => t.name === 'omegasearch'));

assert.deepStrictEqual(_test.collectOmegasearchBlocks({ query: '1girl sunset' }), ['1girl sunset']);
assert.deepStrictEqual(
    _test.collectOmegasearchBlocks({ terms: ['asuka', 'rei'] }),
    [{ terms: ['asuka', 'rei'], matchMode: 'substring', orWithinBlock: true }]
);
assert.deepStrictEqual(_test.collectOmegasearchBlocks({ blocks: ['keep'] }), ['keep']);

const presetChange = _test.studioChangeFromPreset({
    preset_name: 'test-spell',
    prompt: '1girl',
    negative_prompt: 'blurry',
    model: 'v5',
    steps: 28
});
assert.strictEqual(presetChange.dreamscape, 'change');
assert.strictEqual(presetChange.params.model, 'v5');
assert.ok(presetChange.fields.some((f) => f.id === 'prompt' && f.chunks[0].text === '1girl'));
assert.ok(presetChange.fields.some((f) => f.id === 'uc' && f.chunks[0].text === 'blurry'));

assert.deepStrictEqual(_test.collectAutofillTerms({ query: '  asuka  ' }), ['asuka']);
assert.deepStrictEqual(_test.collectAutofillTerms({ terms: ['rei', 'asuka', 'rei', ''] }), ['rei', 'asuka']);
assert.deepStrictEqual(_test.collectAutofillTerms({ terms: ['rei'], query: 'asuka' }), ['rei', 'asuka']);
assert.strictEqual(_test.collectAutofillTerms({ terms: Array.from({ length: 30 }, (_, i) => `t${i}`) }).length, 20);
assert.deepStrictEqual(_test.collectAutofillTerms({}), []);

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

    const autofillListed = await _test.handleJsonRpc(
        {},
        { applicationAuth: { applicationScopes: ['autofill'] }, authMethod: 'application_key' },
        { jsonrpc: '2.0', id: 3, method: 'tools/list' }
    );
    const autofillNames = autofillListed.body.result.tools.map((t) => t.name);
    assert.ok(autofillNames.includes('search_autofill'));
    assert.ok(autofillNames.includes('get_wiki_page'));
    assert.ok(!autofillNames.includes('generate_image'));

    // OAuth 2.1 tests
    // modules/mcpOAuthProvider.js
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('grok.com'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('x.ai'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('127.0.0.1'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('localhost'));
    assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('cursor.com'));

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
    assert.ok(protectedMeta.scopes_supported.includes('notes'));

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
