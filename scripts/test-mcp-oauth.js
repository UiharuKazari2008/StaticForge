/**
 * Standalone OAuth tests for MCP Grok connector.
 * Tests OAuth provider logic without requiring native dependencies.
 */

const assert = require('assert');
const crypto = require('crypto');

const { 
    validateRedirectUri, 
    verifyPkceChallenge, 
    parseScopes, 
    ALLOWED_REDIRECT_URI_HOSTS,
    OAUTH_ACCESS_TOKEN_PREFIX,
    isOAuthAccessTokenFormat
} = require('../modules/mcpOAuthProvider');

const { renderConsentPage, CONSENT_PAGE_HTML } = require('../modules/mcpOAuthRoutes');

console.log('Testing OAuth redirect URI validation...');
assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('grok.com'));
assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('www.grok.com'));
assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('x.ai'));
assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('console.x.ai'));
assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('127.0.0.1'));
assert.ok(ALLOWED_REDIRECT_URI_HOSTS.has('localhost'));

assert.deepStrictEqual(validateRedirectUri('https://grok.com/callback'), { valid: true });
assert.deepStrictEqual(validateRedirectUri('https://www.grok.com/oauth/cb'), { valid: true });
assert.deepStrictEqual(validateRedirectUri('https://x.ai/oauth'), { valid: true });
assert.deepStrictEqual(validateRedirectUri('https://console.x.ai/callback'), { valid: true });
assert.deepStrictEqual(validateRedirectUri('http://127.0.0.1:39123/callback'), { valid: true });
assert.deepStrictEqual(validateRedirectUri('http://localhost:8080/cb'), { valid: true });

assert.strictEqual(validateRedirectUri('https://evil.example/cb').valid, false);
assert.strictEqual(validateRedirectUri('http://grok.com/cb').valid, false);
assert.strictEqual(validateRedirectUri('http://x.ai/cb').valid, false);
assert.strictEqual(validateRedirectUri('ftp://grok.com/cb').valid, false);
assert.strictEqual(validateRedirectUri('not-a-url').valid, false);

console.log('Testing PKCE verification...');
const verifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const challenge = crypto.createHash('sha256').update(verifier, 'ascii').digest('base64url');
assert.strictEqual(verifyPkceChallenge(verifier, challenge), true);
assert.strictEqual(verifyPkceChallenge('wrongverifier', challenge), false);
assert.strictEqual(verifyPkceChallenge('', challenge), false);

const testVerifier2 = crypto.randomBytes(32).toString('base64url');
const testChallenge2 = crypto.createHash('sha256').update(testVerifier2, 'ascii').digest('base64url');
assert.strictEqual(verifyPkceChallenge(testVerifier2, testChallenge2), true);

console.log('Testing scope parsing...');
assert.deepStrictEqual(parseScopes('generation gallery'), ['generation', 'gallery']);
assert.deepStrictEqual(parseScopes('  generation   gallery  workspace '), ['generation', 'gallery', 'workspace']);
assert.deepStrictEqual(parseScopes('generation'), ['generation']);
assert.deepStrictEqual(parseScopes(''), []);
assert.deepStrictEqual(parseScopes(null), []);
assert.deepStrictEqual(parseScopes(undefined), []);

console.log('Testing OAuth token format detection...');
assert.strictEqual(OAUTH_ACCESS_TOKEN_PREFIX, 'mcoat_');
assert.strictEqual(isOAuthAccessTokenFormat('mcoat_abc123'), true);
assert.strictEqual(isOAuthAccessTokenFormat('sfapp_abc123'), false);
assert.strictEqual(isOAuthAccessTokenFormat('sftok_abc123'), false);
assert.strictEqual(isOAuthAccessTokenFormat(''), false);
assert.strictEqual(isOAuthAccessTokenFormat(null), false);

console.log('Testing consent page rendering...');
assert.ok(CONSENT_PAGE_HTML.includes('Authorize Application'));
assert.ok(CONSENT_PAGE_HTML.includes('{{CLIENT_NAME}}'));
assert.ok(CONSENT_PAGE_HTML.includes('{{SCOPE_LIST}}'));

const rendered = renderConsentPage({
    clientName: 'Test Client',
    clientId: 'mcp_test123',
    redirectUri: 'https://grok.com/callback',
    state: 'abc123',
    scope: 'generation gallery',
    codeChallenge: 'testchallenge',
    codeChallengeMethod: 'S256',
    resource: 'https://example.com/mcp',
    formAction: '/test-uuid/oauth/authorize'
});

assert.ok(rendered.includes('Test Client'));
assert.ok(rendered.includes('mcp_test123'));
assert.ok(rendered.includes('generation'));
assert.ok(rendered.includes('gallery'));
assert.ok(rendered.includes('testchallenge'));
assert.ok(rendered.includes('S256'));
assert.ok(!rendered.includes('{{CLIENT_NAME}}'));
assert.ok(!rendered.includes('{{SCOPE_LIST}}'));

const renderedWithError = renderConsentPage({
    clientName: 'Test Client',
    clientId: 'mcp_test123',
    redirectUri: 'https://grok.com/callback',
    state: 'abc123',
    scope: '',
    codeChallenge: 'testchallenge',
    codeChallengeMethod: 'S256',
    formAction: '/test-uuid/oauth/authorize',
    error: 'Invalid application key'
});
assert.ok(renderedWithError.includes('Invalid application key'));
assert.ok(renderedWithError.includes('class="error"'));

console.log('Testing XSS protection in consent page...');
const xssAttempt = '<script>alert("xss")</script>';
const renderedXss = renderConsentPage({
    clientName: xssAttempt,
    clientId: 'mcp_test',
    redirectUri: 'https://grok.com/cb',
    scope: '',
    codeChallenge: 'test',
    formAction: '/test'
});
assert.ok(!renderedXss.includes('<script>'));
assert.ok(renderedXss.includes('&lt;script&gt;'));

console.log('Testing consent page with no applicationKeyId (consent-bind flow)...');
const renderedNoKey = renderConsentPage({
    clientName: 'Grok Connector',
    clientId: 'mcp_grok123',
    redirectUri: 'https://grok.com/callback',
    state: 'state123',
    scope: 'generation gallery',
    codeChallenge: 'challenge123',
    codeChallengeMethod: 'S256',
    formAction: '/test-uuid/oauth/authorize',
    applicationKeyId: null
});
assert.ok(renderedNoKey.includes('Your Application Key (sfapp_...)'));
assert.ok(renderedNoKey.includes('name="application_key"'));
assert.ok(renderedNoKey.includes('type="password"'));
assert.ok(renderedNoKey.includes('required'));
assert.ok(!renderedNoKey.includes('name="application_key_id"'));

console.log('Testing consent page with pre-bound applicationKeyId...');
const renderedWithKey = renderConsentPage({
    clientName: 'Pre-bound Client',
    clientId: 'mcp_prebound',
    redirectUri: 'https://grok.com/callback',
    state: 'state456',
    scope: 'generation',
    codeChallenge: 'challenge456',
    codeChallengeMethod: 'S256',
    formAction: '/test-uuid/oauth/authorize',
    applicationKeyId: 'key-abc-123'
});
assert.ok(!renderedWithKey.includes('Your Application Key (sfapp_...)'));
assert.ok(!renderedWithKey.includes('name="application_key"'));
assert.ok(renderedWithKey.includes('name="application_key_id"'));
assert.ok(renderedWithKey.includes('value="key-abc-123"'));

console.log('Testing McpOAuthProvider metadata...');
const { McpOAuthProvider } = require('../modules/mcpOAuthProvider');
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

console.log('test-mcp-oauth: ok');
