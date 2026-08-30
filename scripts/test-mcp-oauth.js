/**
 * Standalone OAuth tests for MCP Grok connector.
 * Tests OAuth provider logic without requiring native dependencies.
 */

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { 
    validateRedirectUri, 
    verifyPkceChallenge, 
    parseScopes, 
    ALLOWED_REDIRECT_URI_HOSTS,
    OAUTH_ACCESS_TOKEN_PREFIX,
    isOAuthAccessTokenFormat
} = require('../modules/mcpOAuthProvider');

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

// Read the source file directly to test structure without importing full module
// (avoids native sqlite3 dependency chain)
const routesSource = fs.readFileSync(
    path.join(__dirname, '../modules/mcpOAuthRoutes.js'),
    'utf8'
);

console.log('Testing PIN step HTML structure...');
assert.ok(routesSource.includes('const PIN_STEP_HTML'), 'Should define PIN_STEP_HTML');
assert.ok(routesSource.includes('Authorize Application'));
assert.ok(routesSource.includes('Enter your PIN'));
assert.ok(routesSource.includes('name="pin"'));
assert.ok(routesSource.includes('type="password"'));
assert.ok(routesSource.includes('name="step" value="pin"'));
assert.ok(routesSource.includes('step-indicator'));

console.log('Testing key picker HTML structure...');
assert.ok(routesSource.includes('const KEY_PICKER_HTML'), 'Should define KEY_PICKER_HTML');
assert.ok(routesSource.includes('Select Application Key'));
assert.ok(routesSource.includes('{{CSRF_TOKEN}}'));
assert.ok(routesSource.includes('{{KEY_OPTIONS}}'));
assert.ok(routesSource.includes('{{USER_TYPE}}'));
assert.ok(routesSource.includes('name="step" value="select"'));
assert.ok(routesSource.includes('name="selected_key"'));
assert.ok(routesSource.includes('Create New Key'));
assert.ok(routesSource.includes('new_key_name'));

console.log('Testing consent session cookie name...');
assert.ok(routesSource.includes("CONSENT_SESSION_COOKIE = 'mcp_consent_session'"));

console.log('Testing PIN HTML does not expose authentication secrets...');
const pinHtmlMatch = routesSource.match(/PIN_STEP_HTML = `[\s\S]*?`;/);
assert.ok(pinHtmlMatch, 'Should find PIN_STEP_HTML template');
const pinHtml = pinHtmlMatch[0];
assert.ok(!pinHtml.includes('loginKey'));
assert.ok(!pinHtml.includes('devLoginKey'));
assert.ok(!pinHtml.includes('loginPin'));
assert.ok(!pinHtml.includes('readOnlyPin'));
assert.ok(!pinHtml.includes('sfapp_'), 'PIN step should not reference sfapp_ format');

console.log('Testing key picker HTML does not expose secrets...');
const keyPickerMatch = routesSource.match(/KEY_PICKER_HTML = `[\s\S]*?`;/);
assert.ok(keyPickerMatch, 'Should find KEY_PICKER_HTML template');
const keyPickerHtml = keyPickerMatch[0];
assert.ok(!keyPickerHtml.includes('loginKey'));
assert.ok(!keyPickerHtml.includes('devLoginKey'));
assert.ok(!keyPickerHtml.includes('loginPin'));
assert.ok(!keyPickerHtml.includes('readOnlyPin'));
assert.ok(!keyPickerHtml.includes('sfapp_'), 'Key picker should not reference sfapp_ format');

console.log('Testing constant-time comparison is in use...');
assert.ok(routesSource.includes('timingSafeEqual'), 'PIN comparison should use timingSafeEqual');
assert.ok(routesSource.includes('constantTimeCompare'), 'Should have constantTimeCompare function');
assert.ok(!routesSource.match(/pin\s*===\s*[^=]/) && !routesSource.match(/===\s*pin[^a-zA-Z]/), 
    'PIN should not use direct equality');

console.log('Testing rate limiting constants...');
assert.ok(routesSource.includes('PIN_LOCKOUT_THRESHOLD'));
assert.ok(routesSource.includes('PIN_LOCKOUT_DURATION_MS'));
assert.ok(routesSource.includes('PIN_ATTEMPT_WINDOW_MS'));
assert.ok(routesSource.includes('checkPinRateLimit'));
assert.ok(routesSource.includes('recordPinAttempt'));

console.log('Testing CSRF protection...');
assert.ok(routesSource.includes('csrf_token'));
assert.ok(routesSource.includes('csrfToken'));
assert.ok(routesSource.includes('generateCsrfToken'));

console.log('Testing session management...');
assert.ok(routesSource.includes('CONSENT_SESSION_TTL_MS'));
assert.ok(routesSource.includes('createConsentSession'));
assert.ok(routesSource.includes('getConsentSession'));
assert.ok(routesSource.includes('invalidateConsentSession'));
assert.ok(routesSource.includes('cleanupExpiredSessions'));

console.log('Testing no PIN logging...');
assert.ok(!routesSource.includes('console.log(pin)'));
assert.ok(!routesSource.includes('console.log(secureConfig.loginPin)'));
assert.ok(!routesSource.includes('console.log(secureConfig.readOnlyPin)'));

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
