const assert = require('assert');
const {
    namedScopesForCreate,
    keyMatchesRequestedScopes,
    scopesMissingFromKey,
    verifyConsentPin,
    isPinLocked,
    recordPinFailure,
    clearPinFailures,
    createConsentSession,
    getConsentSession,
    destroyConsentSession,
    csrfMatches,
    filterKeysForConsent,
    generatedKeyName,
    CONSENT_PIN_MAX_FAILS,
    DEFAULT_CREATE_SCOPES
} = require('../modules/mcpOAuthConsent');

console.log('Testing namedScopesForCreate never returns universal...');
assert.deepStrictEqual(namedScopesForCreate(['generation', 'gallery']), ['generation', 'gallery']);
assert.deepStrictEqual(namedScopesForCreate(['universal']), DEFAULT_CREATE_SCOPES);
assert.deepStrictEqual(namedScopesForCreate(['universal', 'generation']), ['generation']);
assert.deepStrictEqual(namedScopesForCreate([]), DEFAULT_CREATE_SCOPES);
assert.ok(!namedScopesForCreate(['universal', 'admin', 'generation']).includes('universal'));

console.log('Testing keyMatchesRequestedScopes...');
assert.strictEqual(keyMatchesRequestedScopes(['generation', 'gallery'], ['generation']), true);
assert.strictEqual(keyMatchesRequestedScopes(['generation'], ['generation', 'gallery']), false);
assert.strictEqual(keyMatchesRequestedScopes(['universal'], ['generation', 'vfs']), true);
assert.strictEqual(keyMatchesRequestedScopes([], ['generation']), false);

console.log('Testing PIN verify + lockout...');
const resources = {
    getSecureConfig: () => ({ loginPin: '2468', readOnlyPin: '1357' }),
    getConfig: () => ({ userPinLoginEnabled: true })
};
assert.deepStrictEqual(verifyConsentPin('2468', resources), { ok: true, userType: 'admin' });
assert.deepStrictEqual(verifyConsentPin('1357', resources), { ok: true, userType: 'readonly' });
assert.deepStrictEqual(verifyConsentPin('0000', resources), { ok: false });
assert.deepStrictEqual(verifyConsentPin('', resources), { ok: false });

const disabledUser = {
    getSecureConfig: () => ({ loginPin: '2468', readOnlyPin: '1357' }),
    getConfig: () => ({ userPinLoginEnabled: false })
};
assert.deepStrictEqual(verifyConsentPin('1357', disabledUser), { ok: false });
assert.deepStrictEqual(verifyConsentPin('2468', disabledUser), { ok: true, userType: 'admin' });

const lockIp = '203.0.113.10';
clearPinFailures(lockIp);
for (let i = 0; i < CONSENT_PIN_MAX_FAILS; i += 1) {
    recordPinFailure(lockIp);
}
assert.strictEqual(isPinLocked(lockIp), true);
clearPinFailures(lockIp);
assert.strictEqual(isPinLocked(lockIp), false);

console.log('Testing consent session CSRF binding...');
const session = createConsentSession({ clientId: 'mcp_abc', userType: 'admin' });
assert.ok(getConsentSession(session.sessionId));
assert.strictEqual(csrfMatches(session, session.csrf), true);
assert.strictEqual(csrfMatches(session, 'wrong'), false);
assert.strictEqual(csrfMatches(session, null), false);
destroyConsentSession(session.sessionId);
assert.strictEqual(getConsentSession(session.sessionId), null);

console.log('Testing scopesMissingFromKey...');
assert.deepStrictEqual(scopesMissingFromKey(['generation'], ['generation', 'notes', 'wiki']), ['notes', 'wiki']);
assert.deepStrictEqual(scopesMissingFromKey(['universal'], ['notes']), []);
assert.deepStrictEqual(scopesMissingFromKey(['generation'], ['universal', 'notes']), ['notes']);
assert.ok(!scopesMissingFromKey(['generation'], ['universal', 'notes']).includes('universal'));
assert.deepStrictEqual(scopesMissingFromKey(['generation', 'notes'], ['generation']), []);
assert.deepStrictEqual(scopesMissingFromKey(['generation'], []), []);

console.log('Testing key list filter shows partial matches for upgrade...');
const filtered = filterKeysForConsent([
    { id: '1', status: 'active', scopes: ['generation'] },
    { id: '2', status: 'revoked', scopes: ['generation'] },
    { id: '3', status: 'active', scopes: ['gallery'] }
], ['generation']);
assert.deepStrictEqual(filtered.map((k) => k.id), ['1', '3']);
assert.strictEqual(keyMatchesRequestedScopes(filtered[0].scopes, ['generation']), true);

assert.strictEqual(generatedKeyName('Grok'), 'MCP Grok');
assert.strictEqual(generatedKeyName(''), 'MCP Connector');

console.log('test-mcp-oauth-consent: ok');
