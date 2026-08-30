/**
 * MCP OAuth consent session: PIN gate, CSRF cookie, named-scope key pick/create.
 * PIN is only for UUID /oauth/authorize. Not MCP / token / DCR / well-known.
 * applicationAuthManager.js — key list/create
 */

const crypto = require('crypto');
const { AVAILABLE_SCOPES } = require('./applicationAuthManager');

const CONSENT_COOKIE_NAME = 'mcp_oauth_consent';
const CONSENT_SESSION_TTL_MS = 5 * 60 * 1000;
const CONSENT_PIN_MAX_FAILS = 5;
const CONSENT_PIN_LOCKOUT_MS = 15 * 60 * 1000;
const DEFAULT_CREATE_SCOPES = ['generation', 'gallery', 'workspace'];
const NAMED_SCOPE_IDS = AVAILABLE_SCOPES.map((s) => s.id).filter((id) => id !== 'universal');
const TIMING_PAD = crypto.randomBytes(32).toString('hex');

const sessions = new Map();
const pinFailures = new Map();

function credentialsMatch(received, expected) {
    if (typeof received !== 'string' || typeof expected !== 'string') return false;
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function clientIp(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
}

function namedScopesForCreate(requestedScopes) {
    const named = (requestedScopes || [])
        .map((s) => String(s).trim())
        .filter((s) => NAMED_SCOPE_IDS.includes(s));
    return named.length > 0 ? named : DEFAULT_CREATE_SCOPES.slice();
}

function keyMatchesRequestedScopes(keyScopes, requestedScopes) {
    if (!Array.isArray(keyScopes) || keyScopes.length === 0) return false;
    if (keyScopes.includes('universal')) return true;
    const requested = (requestedScopes || []).filter(Boolean);
    if (requested.length === 0) return true;
    return requested.every((scope) => keyScopes.includes(scope));
}

function scopesMissingFromKey(keyScopes, requestedScopes) {
    if (!Array.isArray(keyScopes) || keyScopes.includes('universal')) return [];
    return (requestedScopes || [])
        .map((s) => String(s).trim())
        .filter((s) => NAMED_SCOPE_IDS.includes(s) && !keyScopes.includes(s));
}

function pruneExpiredSessions(now = Date.now()) {
    for (const [id, session] of sessions) {
        if (session.expiresAt <= now) sessions.delete(id);
    }
}

function prunePinFailures(now = Date.now()) {
    for (const [ip, row] of pinFailures) {
        if (row.lockedUntil && row.lockedUntil <= now && row.count < CONSENT_PIN_MAX_FAILS) {
            pinFailures.delete(ip);
        } else if (!row.lockedUntil && now - (row.lastAt || 0) > CONSENT_PIN_LOCKOUT_MS) {
            pinFailures.delete(ip);
        }
    }
}

function isPinLocked(ip, now = Date.now()) {
    prunePinFailures(now);
    const row = pinFailures.get(ip);
    return !!(row && row.lockedUntil && row.lockedUntil > now);
}

function recordPinFailure(ip, now = Date.now()) {
    const row = pinFailures.get(ip) || { count: 0, lastAt: now, lockedUntil: 0 };
    row.count += 1;
    row.lastAt = now;
    if (row.count >= CONSENT_PIN_MAX_FAILS) {
        row.lockedUntil = now + CONSENT_PIN_LOCKOUT_MS;
    }
    pinFailures.set(ip, row);
    return row;
}

function clearPinFailures(ip) {
    pinFailures.delete(ip);
}

function verifyConsentPin(pin, globalResources) {
    const secureConfig = globalResources.getSecureConfig() || {};
    const config = globalResources.getConfig() || {};
    const adminPin = typeof secureConfig.loginPin === 'string' ? secureConfig.loginPin : '';
    const userPin = typeof secureConfig.readOnlyPin === 'string' ? secureConfig.readOnlyPin : '';
    const userEnabled = config.userPinLoginEnabled !== false;
    const presented = String(pin || '');

    const adminOk = credentialsMatch(presented, adminPin || TIMING_PAD) && adminPin.length > 0;
    const userOk = credentialsMatch(presented, userPin || TIMING_PAD) && userEnabled && userPin.length > 0;
    if (adminOk) return { ok: true, userType: 'admin' };
    if (userOk) return { ok: true, userType: 'readonly' };
    return { ok: false };
}

function createConsentSession({ clientId, userType }) {
    pruneExpiredSessions();
    const sessionId = crypto.randomBytes(24).toString('base64url');
    const csrf = crypto.randomBytes(24).toString('base64url');
    const session = {
        sessionId,
        csrf,
        clientId,
        userType: userType === 'readonly' ? 'readonly' : 'admin',
        expiresAt: Date.now() + CONSENT_SESSION_TTL_MS
    };
    sessions.set(sessionId, session);
    return session;
}

function getConsentSession(sessionId) {
    if (!sessionId) return null;
    pruneExpiredSessions();
    const session = sessions.get(sessionId);
    if (!session || session.expiresAt <= Date.now()) {
        if (session) sessions.delete(sessionId);
        return null;
    }
    return session;
}

function destroyConsentSession(sessionId) {
    if (sessionId) sessions.delete(sessionId);
}

function readConsentCookie(req) {
    return req.cookies && req.cookies[CONSENT_COOKIE_NAME];
}

function setConsentCookie(res, sessionId, { path, secure }) {
    res.cookie(CONSENT_COOKIE_NAME, sessionId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: !!secure,
        path,
        maxAge: CONSENT_SESSION_TTL_MS
    });
}

function clearConsentCookie(res, path) {
    res.clearCookie(CONSENT_COOKIE_NAME, { path });
}

function csrfMatches(session, posted) {
    if (!session || typeof posted !== 'string' || !session.csrf) return false;
    return credentialsMatch(posted, session.csrf);
}

function filterKeysForConsent(keys, requestedScopes) {
    return (keys || [])
        .filter((key) => key && key.status === 'active')
        .sort((a, b) => {
            const aMatch = keyMatchesRequestedScopes(a.scopes, requestedScopes) ? 0 : 1;
            const bMatch = keyMatchesRequestedScopes(b.scopes, requestedScopes) ? 0 : 1;
            return aMatch - bMatch;
        });
}

function generatedKeyName(clientName) {
    const base = String(clientName || '').trim() || 'Connector';
    return `MCP ${base}`.slice(0, 80);
}

module.exports = {
    CONSENT_COOKIE_NAME,
    CONSENT_SESSION_TTL_MS,
    CONSENT_PIN_MAX_FAILS,
    CONSENT_PIN_LOCKOUT_MS,
    DEFAULT_CREATE_SCOPES,
    credentialsMatch,
    clientIp,
    namedScopesForCreate,
    keyMatchesRequestedScopes,
    scopesMissingFromKey,
    isPinLocked,
    recordPinFailure,
    clearPinFailures,
    verifyConsentPin,
    createConsentSession,
    getConsentSession,
    destroyConsentSession,
    readConsentCookie,
    setConsentCookie,
    clearConsentCookie,
    csrfMatches,
    filterKeysForConsent,
    generatedKeyName
};
