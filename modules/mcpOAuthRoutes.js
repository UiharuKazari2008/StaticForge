/**
 * OAuth 2.1 + PKCE HTTP routes for MCP Grok connector.
 * Mounted under /{mcpPathUuid}/oauth/* by mcpAgentFacade.js
 * ui-review: consent page HTML below — Yukimi approves chrome before done.
 *
 * PIN-based consent flow (#40):
 * 1. User visits consent page → sees PIN entry
 * 2. User enters PIN → validated with constant-time compare, rate-limited
 * 3. After PIN → list matching keys or create new
 * 4. User selects/creates key → Approve/Deny
 */

const crypto = require('crypto');
const { McpOAuthProvider, validateRedirectUri, parseScopes, isApplicationKeyFormat } = require('./mcpOAuthProvider');
const { normalizeScopes, AVAILABLE_SCOPES } = require('./applicationAuthManager');

// Consent session store (in-memory, short-lived)
// Key: sessionId, Value: { userType, csrfToken, expiresAt, oauthParams }
const consentSessions = new Map();
const CONSENT_SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes
const CONSENT_SESSION_COOKIE = 'mcp_consent_session';

// Rate limiting for PIN attempts (in-memory cache, backed by DB for persistence)
const pinAttemptCache = new Map();
const PIN_LOCKOUT_THRESHOLD = 5;
const PIN_LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const PIN_ATTEMPT_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function generateSessionId() {
    return crypto.randomBytes(32).toString('base64url');
}

function generateCsrfToken() {
    return crypto.randomBytes(24).toString('base64url');
}

function constantTimeCompare(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    if (bufA.length !== bufB.length) {
        crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
        return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
}

function cleanupExpiredSessions() {
    const now = Date.now();
    for (const [id, session] of consentSessions) {
        if (session.expiresAt <= now) {
            consentSessions.delete(id);
        }
    }
}

setInterval(cleanupExpiredSessions, 60000);

function createConsentSession(userType, oauthParams) {
    const sessionId = generateSessionId();
    const csrfToken = generateCsrfToken();
    consentSessions.set(sessionId, {
        userType,
        csrfToken,
        expiresAt: Date.now() + CONSENT_SESSION_TTL_MS,
        oauthParams
    });
    return { sessionId, csrfToken };
}

function getConsentSession(sessionId) {
    if (!sessionId) return null;
    const session = consentSessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= Date.now()) {
        consentSessions.delete(sessionId);
        return null;
    }
    return session;
}

function invalidateConsentSession(sessionId) {
    if (sessionId) consentSessions.delete(sessionId);
}

async function checkPinRateLimit(db, ipAddress) {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);

    let cached = pinAttemptCache.get(ipAddress);
    if (!cached) {
        const row = await db.get(
            'SELECT * FROM consent_pin_attempts WHERE ip_address = ?',
            [ipAddress]
        );
        if (row) {
            cached = {
                count: row.attempt_count,
                lastAttempt: row.last_attempt_at * 1000,
                lockedUntil: row.locked_until ? row.locked_until * 1000 : null
            };
        } else {
            cached = { count: 0, lastAttempt: 0, lockedUntil: null };
        }
        pinAttemptCache.set(ipAddress, cached);
    }

    if (cached.lockedUntil && cached.lockedUntil > now) {
        const remainingSec = Math.ceil((cached.lockedUntil - now) / 1000);
        return { allowed: false, lockedOut: true, remainingSec };
    }

    if (cached.lockedUntil && cached.lockedUntil <= now) {
        cached.lockedUntil = null;
        cached.count = 0;
    }

    if (cached.lastAttempt && (now - cached.lastAttempt) > PIN_ATTEMPT_WINDOW_MS) {
        cached.count = 0;
    }

    return { allowed: true, lockedOut: false };
}

async function recordPinAttempt(db, ipAddress, success) {
    const now = Date.now();
    const nowSec = Math.floor(now / 1000);

    let cached = pinAttemptCache.get(ipAddress) || { count: 0, lastAttempt: 0, lockedUntil: null };

    if (success) {
        cached.count = 0;
        cached.lockedUntil = null;
        await db.run(
            'DELETE FROM consent_pin_attempts WHERE ip_address = ?',
            [ipAddress]
        );
    } else {
        cached.count += 1;
        cached.lastAttempt = now;

        if (cached.count >= PIN_LOCKOUT_THRESHOLD) {
            cached.lockedUntil = now + PIN_LOCKOUT_DURATION_MS;
        }

        const lockedUntilSec = cached.lockedUntil ? Math.floor(cached.lockedUntil / 1000) : null;
        await db.run(
            `INSERT INTO consent_pin_attempts (ip_address, attempt_count, last_attempt_at, locked_until)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(ip_address) DO UPDATE SET
               attempt_count = excluded.attempt_count,
               last_attempt_at = excluded.last_attempt_at,
               locked_until = excluded.locked_until`,
            [ipAddress, cached.count, nowSec, lockedUntilSec]
        );
    }

    pinAttemptCache.set(ipAddress, cached);
    return cached;
}

// HTML Templates
const PIN_STEP_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Authorize MCP Client</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#252542;border-radius:12px;padding:32px;max-width:420px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3)}
h1{font-size:1.5rem;margin-bottom:8px;color:#fff}
.subtitle{color:#888;margin-bottom:24px}
.client-name{background:#1a1a2e;border-radius:8px;padding:16px;margin-bottom:20px}
.client-name strong{color:#8b8bff;font-size:1.1rem}
.scopes{margin-bottom:24px}
.scopes h3{font-size:0.9rem;color:#888;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px}
.scope-list{list-style:none}
.scope-list li{padding:8px 12px;background:#1a1a2e;border-radius:6px;margin-bottom:6px;display:flex;align-items:center}
.scope-list li::before{content:"✓";color:#4ade80;margin-right:10px;font-weight:bold}
.buttons{display:flex;gap:12px}
button{flex:1;padding:14px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity 0.2s}
.approve{background:#8b8bff;color:#fff}
.approve:hover{opacity:0.9}
.deny{background:#3a3a5c;color:#e0e0e0}
.deny:hover{opacity:0.8}
.error{color:#ff6b6b;background:#3a2a2a;padding:16px;border-radius:8px;margin-bottom:20px}
.pin-section{margin-bottom:20px}
.pin-section label{display:block;color:#888;font-size:0.9rem;margin-bottom:8px}
.pin-section input{width:100%;padding:12px;background:#1a1a2e;border:1px solid #3a3a5c;border-radius:8px;color:#e0e0e0;font-size:1rem;text-align:center;letter-spacing:0.2em}
.pin-section input:focus{outline:none;border-color:#8b8bff}
.note{font-size:0.85rem;color:#666;margin-top:8px}
.step-indicator{display:flex;gap:8px;margin-bottom:20px;justify-content:center}
.step{width:12px;height:12px;border-radius:50%;background:#3a3a5c}
.step.active{background:#8b8bff}
.step.done{background:#4ade80}
</style>
</head>
<body>
<div class="card">
<div class="step-indicator">
<div class="step active"></div>
<div class="step"></div>
</div>
<h1>Authorize Application</h1>
<p class="subtitle">An MCP client wants to access your Dreamscape</p>
{{ERROR_BLOCK}}
<div class="client-name">
<strong>{{CLIENT_NAME}}</strong>
</div>
<div class="scopes">
<h3>Requested permissions</h3>
<ul class="scope-list">
{{SCOPE_LIST}}
</ul>
</div>
<form method="POST" action="{{FORM_ACTION}}">
<input type="hidden" name="step" value="pin">
<input type="hidden" name="client_id" value="{{CLIENT_ID}}">
<input type="hidden" name="redirect_uri" value="{{REDIRECT_URI}}">
<input type="hidden" name="state" value="{{STATE}}">
<input type="hidden" name="scope" value="{{SCOPE}}">
<input type="hidden" name="code_challenge" value="{{CODE_CHALLENGE}}">
<input type="hidden" name="code_challenge_method" value="{{CODE_CHALLENGE_METHOD}}">
<input type="hidden" name="resource" value="{{RESOURCE}}">
<input type="hidden" name="response_type" value="code">
<div class="pin-section">
<label for="pin">Enter your PIN to continue</label>
<input type="password" id="pin" name="pin" placeholder="••••••" required autocomplete="off" inputmode="numeric" maxlength="20">
<p class="note">Use your Dreamscape PIN to authenticate</p>
</div>
<div class="buttons">
<button type="submit" name="action" value="deny" class="deny">Cancel</button>
<button type="submit" name="action" value="continue" class="approve">Continue</button>
</div>
</form>
</div>
</body>
</html>`;

const KEY_PICKER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Select Application Key</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#1a1a2e;color:#e0e0e0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#252542;border-radius:12px;padding:32px;max-width:480px;width:100%;box-shadow:0 8px 32px rgba(0,0,0,0.3)}
h1{font-size:1.5rem;margin-bottom:8px;color:#fff}
.subtitle{color:#888;margin-bottom:24px}
.client-name{background:#1a1a2e;border-radius:8px;padding:16px;margin-bottom:20px}
.client-name strong{color:#8b8bff;font-size:1.1rem}
.scopes{margin-bottom:24px}
.scopes h3{font-size:0.9rem;color:#888;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px}
.scope-list{list-style:none}
.scope-list li{padding:8px 12px;background:#1a1a2e;border-radius:6px;margin-bottom:6px;display:flex;align-items:center}
.scope-list li::before{content:"✓";color:#4ade80;margin-right:10px;font-weight:bold}
.buttons{display:flex;gap:12px}
button{flex:1;padding:14px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity 0.2s}
.approve{background:#8b8bff;color:#fff}
.approve:hover{opacity:0.9}
.deny{background:#3a3a5c;color:#e0e0e0}
.deny:hover{opacity:0.8}
.error{color:#ff6b6b;background:#3a2a2a;padding:16px;border-radius:8px;margin-bottom:20px}
.step-indicator{display:flex;gap:8px;margin-bottom:20px;justify-content:center}
.step{width:12px;height:12px;border-radius:50%;background:#3a3a5c}
.step.active{background:#8b8bff}
.step.done{background:#4ade80}
.key-list{margin-bottom:20px}
.key-list h3{font-size:0.9rem;color:#888;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px}
.key-option{display:block;padding:12px;background:#1a1a2e;border:2px solid #3a3a5c;border-radius:8px;margin-bottom:8px;cursor:pointer;transition:border-color 0.2s}
.key-option:hover{border-color:#6b6bdf}
.key-option.selected{border-color:#8b8bff;background:#2a2a4a}
.key-option input[type="radio"]{display:none}
.key-option .key-name{color:#fff;font-weight:500;margin-bottom:4px}
.key-option .key-prefix{font-family:monospace;color:#888;font-size:0.85rem}
.key-option .key-scopes{font-size:0.8rem;color:#666;margin-top:4px}
.create-new{background:#2a3a2a;border-color:#3a5a3a}
.create-new:hover{border-color:#4ade80}
.create-new.selected{border-color:#4ade80;background:#2a4a2a}
.create-new .key-name{color:#4ade80}
.new-key-name{margin-top:12px;padding:10px;background:#1a1a2e;border:1px solid #3a3a5c;border-radius:6px;color:#e0e0e0;width:100%;font-size:0.9rem;display:none}
.create-new.selected + .new-key-name,.new-key-name.show{display:block}
.note{font-size:0.85rem;color:#666;margin-top:8px}
.user-badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.75rem;margin-left:8px;text-transform:uppercase}
.user-badge.admin{background:#4a3a5a;color:#c4b5fd}
.user-badge.readonly{background:#3a4a5a;color:#93c5fd}
</style>
</head>
<body>
<div class="card">
<div class="step-indicator">
<div class="step done"></div>
<div class="step active"></div>
</div>
<h1>Select Application Key</h1>
<p class="subtitle">Choose an existing key or create a new one<span class="user-badge {{USER_TYPE}}">{{USER_TYPE}}</span></p>
{{ERROR_BLOCK}}
<div class="client-name">
<strong>{{CLIENT_NAME}}</strong>
</div>
<div class="scopes">
<h3>Requested permissions</h3>
<ul class="scope-list">
{{SCOPE_LIST}}
</ul>
</div>
<form method="POST" action="{{FORM_ACTION}}">
<input type="hidden" name="step" value="select">
<input type="hidden" name="csrf_token" value="{{CSRF_TOKEN}}">
<div class="key-list">
<h3>Available Keys</h3>
{{KEY_OPTIONS}}
</div>
<input type="text" name="new_key_name" class="new-key-name" placeholder="Name for new key (optional)" maxlength="100">
<div class="buttons">
<button type="submit" name="action" value="deny" class="deny">Deny</button>
<button type="submit" name="action" value="approve" class="approve">Approve</button>
</div>
</form>
</div>
<script>
document.querySelectorAll('.key-option').forEach(function(el) {
    el.addEventListener('click', function() {
        document.querySelectorAll('.key-option').forEach(function(o) { o.classList.remove('selected'); });
        el.classList.add('selected');
        el.querySelector('input[type="radio"]').checked = true;
        var nameInput = document.querySelector('.new-key-name');
        if (el.classList.contains('create-new')) {
            nameInput.classList.add('show');
        } else {
            nameInput.classList.remove('show');
        }
    });
});
</script>
</body>
</html>`;

function escapeHtml(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function renderPinStep({ clientName, clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, resource, formAction, error }) {
    const scopes = parseScopes(scope);
    const scopeListHtml = scopes.length > 0
        ? scopes.map(s => `<li>${escapeHtml(s)}</li>`).join('\n')
        : '<li>No specific scopes requested</li>';

    const errorBlock = error
        ? `<div class="error">${escapeHtml(error)}</div>`
        : '';

    return PIN_STEP_HTML
        .replace('{{ERROR_BLOCK}}', errorBlock)
        .replace('{{CLIENT_NAME}}', escapeHtml(clientName))
        .replace('{{SCOPE_LIST}}', scopeListHtml)
        .replace('{{FORM_ACTION}}', escapeHtml(formAction))
        .replace('{{CLIENT_ID}}', escapeHtml(clientId))
        .replace('{{REDIRECT_URI}}', escapeHtml(redirectUri))
        .replace('{{STATE}}', escapeHtml(state || ''))
        .replace('{{SCOPE}}', escapeHtml(scope || ''))
        .replace('{{CODE_CHALLENGE}}', escapeHtml(codeChallenge))
        .replace('{{CODE_CHALLENGE_METHOD}}', escapeHtml(codeChallengeMethod || 'S256'))
        .replace('{{RESOURCE}}', escapeHtml(resource || ''));
}

function renderKeyPicker({ clientName, scope, formAction, error, csrfToken, userType, matchingKeys, requestedScopes }) {
    const scopes = parseScopes(scope);
    const scopeListHtml = scopes.length > 0
        ? scopes.map(s => `<li>${escapeHtml(s)}</li>`).join('\n')
        : '<li>No specific scopes requested</li>';

    const errorBlock = error
        ? `<div class="error">${escapeHtml(error)}</div>`
        : '';

    let keyOptionsHtml = '';
    let hasSelected = false;

    for (const key of matchingKeys) {
        const selectedClass = !hasSelected ? ' selected' : '';
        const checkedAttr = !hasSelected ? ' checked' : '';
        hasSelected = true;

        const scopesDisplay = key.scopes.includes('universal')
            ? 'universal'
            : key.scopes.join(', ');

        keyOptionsHtml += `
<label class="key-option${selectedClass}">
<input type="radio" name="selected_key" value="${escapeHtml(key.id)}"${checkedAttr}>
<div class="key-name">${escapeHtml(key.appName)}</div>
<div class="key-prefix">${escapeHtml(key.keyPrefix)}...</div>
<div class="key-scopes">Scopes: ${escapeHtml(scopesDisplay)}</div>
</label>`;
    }

    const createSelectedClass = !hasSelected ? ' selected' : '';
    const createCheckedAttr = !hasSelected ? ' checked' : '';
    const scopesForNew = requestedScopes.length > 0 ? requestedScopes.join(', ') : 'requested scopes';

    keyOptionsHtml += `
<label class="key-option create-new${createSelectedClass}">
<input type="radio" name="selected_key" value="__create_new__"${createCheckedAttr}>
<div class="key-name">+ Create New Key</div>
<div class="key-scopes">Will have: ${escapeHtml(scopesForNew)}</div>
</label>`;

    return KEY_PICKER_HTML
        .replace('{{ERROR_BLOCK}}', errorBlock)
        .replace('{{CLIENT_NAME}}', escapeHtml(clientName))
        .replace('{{SCOPE_LIST}}', scopeListHtml)
        .replace('{{FORM_ACTION}}', escapeHtml(formAction))
        .replace('{{CSRF_TOKEN}}', escapeHtml(csrfToken))
        .replace(/\{\{USER_TYPE\}\}/g, escapeHtml(userType))
        .replace('{{KEY_OPTIONS}}', keyOptionsHtml);
}

function redirectWithError(res, redirectUri, error, errorDescription, state) {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (errorDescription) url.searchParams.set('error_description', errorDescription);
    if (state) url.searchParams.set('state', state);
    res.redirect(302, url.toString());
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded) {
        return String(forwarded).split(',')[0].trim();
    }
    return req.headers['x-real-ip'] || req.ip || req.socket?.remoteAddress || 'unknown';
}

function createOAuthRoutes(globalResources) {
    const provider = new McpOAuthProvider(globalResources);

    function getDb() {
        // modules/applicationAuthDatabase.js
        return require('./applicationAuthDatabase').getDb();
    }

    async function handleRegister(req, res) {
        try {
            const { client_name, redirect_uris, application_key } = req.body || {};

            const result = await provider.registerClient({
                applicationKey: application_key || null,
                clientName: client_name,
                redirectUris: redirect_uris
            });

            if (!result.success) {
                return res.status(400).json({
                    error: 'invalid_request',
                    error_description: result.error
                });
            }

            return res.status(201).json(result);
        } catch (error) {
            console.error('OAuth register error:', error.message);
            return res.status(500).json({ error: 'server_error' });
        }
    }

    async function handleAuthorizeGet(req, res) {
        try {
            const {
                response_type, client_id, redirect_uri, scope, state,
                code_challenge, code_challenge_method, resource
            } = req.query;

            if (response_type !== 'code') {
                return res.status(400).send('Unsupported response_type. Only "code" is supported.');
            }
            if (!client_id) {
                return res.status(400).send('client_id required');
            }
            if (!redirect_uri) {
                return res.status(400).send('redirect_uri required');
            }
            if (!code_challenge) {
                return res.status(400).send('code_challenge required (PKCE)');
            }
            if (code_challenge_method && code_challenge_method !== 'S256') {
                return res.status(400).send('Only S256 code_challenge_method is supported');
            }

            const uriValidation = validateRedirectUri(redirect_uri);
            if (!uriValidation.valid) {
                return res.status(400).send(uriValidation.error);
            }

            const client = await provider.getClientById(client_id);
            if (!client) {
                return res.status(400).send('Unknown client_id');
            }
            if (!client.redirectUris.includes(redirect_uri)) {
                return res.status(400).send('redirect_uri not registered for this client');
            }

            const sessionId = req.cookies?.[CONSENT_SESSION_COOKIE];
            const session = getConsentSession(sessionId);

            if (session && session.oauthParams?.clientId === client_id) {
                const formAction = `${provider.getOAuthEndpointPrefix()}/authorize`;
                const requestedScopes = parseScopes(scope);
                const matchingKeys = await listMatchingKeys(getDb(), session.userType, requestedScopes);

                const html = renderKeyPicker({
                    clientName: client.clientName,
                    scope: scope || '',
                    formAction,
                    csrfToken: session.csrfToken,
                    userType: session.userType,
                    matchingKeys,
                    requestedScopes
                });

                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                return res.send(html);
            }

            const formAction = `${provider.getOAuthEndpointPrefix()}/authorize`;
            const html = renderPinStep({
                clientName: client.clientName,
                clientId: client_id,
                redirectUri: redirect_uri,
                state,
                scope: scope || '',
                codeChallenge: code_challenge,
                codeChallengeMethod: code_challenge_method || 'S256',
                resource: resource || '',
                formAction
            });

            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.setHeader('Cache-Control', 'no-store');
            return res.send(html);
        } catch (error) {
            console.error('OAuth authorize GET error:', error.message);
            return res.status(500).send('Internal error');
        }
    }

    async function handleAuthorizePost(req, res) {
        try {
            const {
                action, step, client_id, redirect_uri, state, scope,
                code_challenge, code_challenge_method, resource,
                pin, csrf_token, selected_key, new_key_name
            } = req.body || {};

            if (!redirect_uri) {
                return res.status(400).send('redirect_uri required');
            }

            const uriValidation = validateRedirectUri(redirect_uri);
            if (!uriValidation.valid) {
                return res.status(400).send(uriValidation.error);
            }

            if (action === 'deny') {
                const sessionId = req.cookies?.[CONSENT_SESSION_COOKIE];
                invalidateConsentSession(sessionId);
                res.clearCookie(CONSENT_SESSION_COOKIE, { httpOnly: true, sameSite: 'lax' });
                return redirectWithError(res, redirect_uri, 'access_denied', 'User denied the request', state);
            }

            const client = await provider.getClientById(client_id);
            if (!client) {
                return redirectWithError(res, redirect_uri, 'invalid_client', 'Unknown client', state);
            }
            if (!client.redirectUris.includes(redirect_uri)) {
                return res.status(400).send('redirect_uri not registered for this client');
            }

            const formAction = `${provider.getOAuthEndpointPrefix()}/authorize`;

            // Step 1: PIN verification
            if (step === 'pin') {
                const ipAddress = getClientIp(req);
                const db = getDb();

                const rateCheck = await checkPinRateLimit(db, ipAddress);
                if (!rateCheck.allowed) {
                    const html = renderPinStep({
                        clientName: client.clientName,
                        clientId: client_id,
                        redirectUri: redirect_uri,
                        state,
                        scope: scope || '',
                        codeChallenge: code_challenge,
                        codeChallengeMethod: code_challenge_method || 'S256',
                        resource: resource || '',
                        formAction,
                        error: `Too many attempts. Try again in ${rateCheck.remainingSec} seconds.`
                    });
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.status(429).send(html);
                }

                const secureConfig = globalResources.getSecureConfig();
                const config = globalResources.getConfig();
                let userType = null;

                const loginPin = secureConfig?.loginPin;
                const readOnlyPin = secureConfig?.readOnlyPin;

                if (loginPin && constantTimeCompare(pin || '', loginPin)) {
                    userType = 'admin';
                } else if (readOnlyPin && constantTimeCompare(pin || '', readOnlyPin)) {
                    if (config?.userPinLoginEnabled === false) {
                        await recordPinAttempt(db, ipAddress, false);
                        const html = renderPinStep({
                            clientName: client.clientName,
                            clientId: client_id,
                            redirectUri: redirect_uri,
                            state,
                            scope: scope || '',
                            codeChallenge: code_challenge,
                            codeChallengeMethod: code_challenge_method || 'S256',
                            resource: resource || '',
                            formAction,
                            error: 'User PIN login is disabled. Admin PIN required.'
                        });
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                        return res.status(403).send(html);
                    }
                    userType = 'readonly';
                } else {
                    constantTimeCompare(pin || '', 'dummy_comparison_for_timing');
                }

                if (!userType) {
                    await recordPinAttempt(db, ipAddress, false);
                    const html = renderPinStep({
                        clientName: client.clientName,
                        clientId: client_id,
                        redirectUri: redirect_uri,
                        state,
                        scope: scope || '',
                        codeChallenge: code_challenge,
                        codeChallengeMethod: code_challenge_method || 'S256',
                        resource: resource || '',
                        formAction,
                        error: 'Invalid PIN'
                    });
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.status(401).send(html);
                }

                await recordPinAttempt(db, ipAddress, true);

                const { sessionId, csrfToken } = createConsentSession(userType, {
                    clientId: client_id,
                    redirectUri: redirect_uri,
                    state,
                    scope: scope || '',
                    codeChallenge: code_challenge,
                    codeChallengeMethod: code_challenge_method || 'S256',
                    resource: resource || ''
                });

                res.cookie(CONSENT_SESSION_COOKIE, sessionId, {
                    httpOnly: true,
                    sameSite: 'lax',
                    maxAge: CONSENT_SESSION_TTL_MS,
                    secure: !formAction.includes('localhost') && !formAction.includes('127.0.0.1')
                });

                const requestedScopes = parseScopes(scope);
                const matchingKeys = await listMatchingKeys(db, userType, requestedScopes);

                const html = renderKeyPicker({
                    clientName: client.clientName,
                    scope: scope || '',
                    formAction,
                    csrfToken,
                    userType,
                    matchingKeys,
                    requestedScopes
                });

                res.setHeader('Content-Type', 'text/html; charset=utf-8');
                res.setHeader('Cache-Control', 'no-store');
                return res.send(html);
            }

            // Step 2: Key selection
            if (step === 'select') {
                const sessionId = req.cookies?.[CONSENT_SESSION_COOKIE];
                const session = getConsentSession(sessionId);

                if (!session) {
                    const html = renderPinStep({
                        clientName: client.clientName,
                        clientId: client_id,
                        redirectUri: redirect_uri,
                        state,
                        scope: scope || '',
                        codeChallenge: code_challenge,
                        codeChallengeMethod: code_challenge_method || 'S256',
                        resource: resource || '',
                        formAction,
                        error: 'Session expired. Please re-authenticate.'
                    });
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.status(401).send(html);
                }

                if (!constantTimeCompare(csrf_token || '', session.csrfToken)) {
                    const requestedScopes = parseScopes(session.oauthParams.scope);
                    const matchingKeys = await listMatchingKeys(getDb(), session.userType, requestedScopes);

                    const html = renderKeyPicker({
                        clientName: client.clientName,
                        scope: session.oauthParams.scope,
                        formAction,
                        csrfToken: session.csrfToken,
                        userType: session.userType,
                        matchingKeys,
                        requestedScopes,
                        error: 'Invalid request. Please try again.'
                    });
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.status(403).send(html);
                }

                const params = session.oauthParams;
                const requestedScopes = parseScopes(params.scope);
                const db = getDb();

                let applicationKeyId;

                if (selected_key === '__create_new__') {
                    const keyResult = await createKeyForConsent(
                        globalResources,
                        session.userType,
                        requestedScopes,
                        new_key_name,
                        client.clientName
                    );
                    applicationKeyId = keyResult.id;
                } else {
                    const keyRow = await db.get(
                        `SELECT id, user_type, scopes FROM application_keys
                         WHERE id = ? AND status = 'active' AND revoked_at IS NULL`,
                        [selected_key]
                    );

                    if (!keyRow) {
                        const matchingKeys = await listMatchingKeys(db, session.userType, requestedScopes);
                        const html = renderKeyPicker({
                            clientName: client.clientName,
                            scope: params.scope,
                            formAction,
                            csrfToken: session.csrfToken,
                            userType: session.userType,
                            matchingKeys,
                            requestedScopes,
                            error: 'Selected key is no longer valid. Please choose another.'
                        });
                        res.setHeader('Content-Type', 'text/html; charset=utf-8');
                        return res.status(400).send(html);
                    }

                    applicationKeyId = keyRow.id;
                }

                invalidateConsentSession(sessionId);
                res.clearCookie(CONSENT_SESSION_COOKIE, { httpOnly: true, sameSite: 'lax' });

                const keyScopes = await provider.getAppKeyScopes(applicationKeyId);
                if (!keyScopes) {
                    return redirectWithError(res, params.redirectUri, 'server_error', 'Application key no longer valid', params.state);
                }

                const grantedScopes = keyScopes.includes('universal')
                    ? requestedScopes
                    : requestedScopes.filter(s => keyScopes.includes(s));

                const code = await provider.createAuthorizationCode({
                    clientId: params.clientId,
                    applicationKeyId,
                    redirectUri: params.redirectUri,
                    scopes: grantedScopes,
                    codeChallenge: params.codeChallenge,
                    codeChallengeMethod: params.codeChallengeMethod,
                    resource: params.resource || null
                });

                const redirectUrl = new URL(params.redirectUri);
                redirectUrl.searchParams.set('code', code);
                if (params.state) redirectUrl.searchParams.set('state', params.state);

                return res.redirect(302, redirectUrl.toString());
            }

            return res.status(400).send('Invalid step');
        } catch (error) {
            console.error('OAuth authorize POST error:', error.message);
            const redirectUri = req.body?.redirect_uri;
            if (redirectUri && validateRedirectUri(redirectUri).valid) {
                return redirectWithError(res, redirectUri, 'server_error', 'Internal error', req.body?.state);
            }
            return res.status(500).send('Internal error');
        }
    }

    async function handleToken(req, res) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');

        try {
            const { grant_type, code, redirect_uri, client_id, code_verifier, refresh_token, scope, resource } = req.body || {};

            if (!client_id) {
                return res.status(400).json({ error: 'invalid_request', error_description: 'client_id required' });
            }

            if (grant_type === 'authorization_code') {
                if (!code) {
                    return res.status(400).json({ error: 'invalid_request', error_description: 'code required' });
                }
                if (!redirect_uri) {
                    return res.status(400).json({ error: 'invalid_request', error_description: 'redirect_uri required' });
                }
                if (!code_verifier) {
                    return res.status(400).json({ error: 'invalid_request', error_description: 'code_verifier required (PKCE)' });
                }

                const result = await provider.exchangeAuthorizationCode({
                    code,
                    clientId: client_id,
                    redirectUri: redirect_uri,
                    codeVerifier: code_verifier,
                    resource: resource || null
                });

                if (!result.success) {
                    return res.status(400).json({ error: result.error, error_description: result.error_description });
                }

                return res.json(result);
            }

            if (grant_type === 'refresh_token') {
                if (!refresh_token) {
                    return res.status(400).json({ error: 'invalid_request', error_description: 'refresh_token required' });
                }

                const result = await provider.refreshAccessToken({
                    refreshToken: refresh_token,
                    clientId: client_id,
                    scope: scope || null
                });

                if (!result.success) {
                    return res.status(400).json({ error: result.error, error_description: result.error_description });
                }

                return res.json(result);
            }

            return res.status(400).json({ error: 'unsupported_grant_type', error_description: 'Only authorization_code and refresh_token are supported' });
        } catch (error) {
            console.error('OAuth token error:', error.message);
            return res.status(500).json({ error: 'server_error' });
        }
    }

    return {
        handleRegister,
        handleAuthorizeGet,
        handleAuthorizePost,
        handleToken,
        provider
    };
}

async function listMatchingKeys(db, userType, requestedScopes) {
    const rows = await db.all(
        `SELECT id, app_name, key_prefix, scopes, user_type
         FROM application_keys
         WHERE status = 'active' AND revoked_at IS NULL
         ORDER BY created_at DESC`
    );

    const matching = [];
    for (const row of rows) {
        if (userType === 'readonly' && row.user_type !== 'readonly') {
            continue;
        }

        const keyScopes = parseScopesJson(row.scopes);

        if (keyScopes.includes('universal')) {
            matching.push({
                id: row.id,
                appName: row.app_name,
                keyPrefix: row.key_prefix,
                scopes: keyScopes,
                userType: row.user_type
            });
            continue;
        }

        const hasAllScopes = requestedScopes.length === 0 ||
            requestedScopes.every(s => keyScopes.includes(s));

        if (hasAllScopes) {
            matching.push({
                id: row.id,
                appName: row.app_name,
                keyPrefix: row.key_prefix,
                scopes: keyScopes,
                userType: row.user_type
            });
        }
    }

    return matching;
}

function parseScopesJson(raw) {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : ['universal'];
    } catch (_) {
        return ['universal'];
    }
}

async function createKeyForConsent(globalResources, userType, requestedScopes, customName, clientName) {
    const manager = globalResources.getApplicationAuthManager();

    const scopes = requestedScopes.length > 0
        ? normalizeScopes(requestedScopes)
        : ['generation', 'gallery', 'workspace'];

    if (scopes.includes('universal')) {
        throw new Error('Cannot create universal scope key via consent');
    }

    const appName = customName?.trim() ||
        `MCP ${clientName || 'Connector'} - ${new Date().toISOString().slice(0, 10)}`;

    const result = await manager.createApplicationKey({
        appName,
        userAgent: 'MCP OAuth Consent',
        scopes,
        userType,
        refreshIntervalDays: 30
    });

    return result.summary;
}

module.exports = {
    createOAuthRoutes,
    CONSENT_SESSION_COOKIE,
    PIN_STEP_HTML,
    KEY_PICKER_HTML
};
