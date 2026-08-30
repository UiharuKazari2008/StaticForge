/**
 * OAuth 2.1 + PKCE HTTP routes for MCP Grok connector.
 * Mounted under /{mcpPathUuid}/oauth/* by mcpAgentFacade.js
 * ui-review: PIN + key picker chrome — Yukimi preview before land.
 */

const { McpOAuthProvider, validateRedirectUri, parseScopes } = require('./mcpOAuthProvider');
const consent = require('./mcpOAuthConsent');

const CONSENT_PAGE_HTML = `<!DOCTYPE html>
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
.buttons{display:flex;flex-direction:row-reverse;gap:12px;flex-wrap:wrap}
button{flex:1;padding:14px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer}
.approve{background:#8b8bff;color:#fff}
.deny{background:#3a3a5c;color:#e0e0e0}
.create{background:#3a3a5c;color:#e0e0e0;flex:1 1 100%}
.error{color:#ff6b6b;background:#3a2a2a;padding:16px;border-radius:8px;margin-bottom:20px}
.field{margin-bottom:20px}
.field label{display:block;color:#888;font-size:0.9rem;margin-bottom:8px}
.field input{width:100%;padding:12px;background:#1a1a2e;border:1px solid #3a3a5c;border-radius:8px;color:#e0e0e0;font-size:0.95rem}
.field input:focus{outline:none;border-color:#8b8bff}
.note{font-size:0.85rem;color:#666;margin-top:8px}
.bound-note{background:#1a1a2e;border-radius:8px;padding:12px;margin-bottom:20px;color:#bbb}
.custom-dropdown{position:relative;margin-bottom:12px}
.custom-dropdown-btn{width:100%;text-align:left;background:#1a1a2e;color:#e0e0e0;border:1px solid #3a3a5c;border-radius:8px;padding:12px}
.custom-dropdown-menu{position:absolute;left:0;right:0;top:100%;z-index:2;background:#1a1a2e;border:1px solid #3a3a5c;border-radius:8px;margin-top:4px;max-height:220px;overflow:auto}
.custom-dropdown-menu.hidden{display:none}
.custom-dropdown-menu button{width:100%;text-align:left;background:transparent;color:#e0e0e0;border-radius:0;font-weight:500;padding:10px 12px}
.custom-dropdown-menu button:hover{background:#252542}
</style>
</head>
<body>
<div class="card">
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
{{STEP_BODY}}
</div>
{{STEP_SCRIPT}}
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

function hiddenOAuthFields(params) {
    return [
        `<input type="hidden" name="client_id" value="${escapeHtml(params.clientId)}">`,
        `<input type="hidden" name="redirect_uri" value="${escapeHtml(params.redirectUri)}">`,
        `<input type="hidden" name="state" value="${escapeHtml(params.state || '')}">`,
        `<input type="hidden" name="scope" value="${escapeHtml(params.scope || '')}">`,
        `<input type="hidden" name="code_challenge" value="${escapeHtml(params.codeChallenge)}">`,
        `<input type="hidden" name="code_challenge_method" value="${escapeHtml(params.codeChallengeMethod || 'S256')}">`,
        `<input type="hidden" name="resource" value="${escapeHtml(params.resource || '')}">`,
        `<input type="hidden" name="response_type" value="code">`
    ].join('\n');
}

function renderPinStep(params) {
    return `<form method="POST" action="${escapeHtml(params.formAction)}" autocomplete="off">
${hiddenOAuthFields(params)}
<div class="field">
<label for="consent_pin">Your Dreamscape PIN</label>
<input type="password" id="consent_pin" name="pin" inputmode="numeric" autocomplete="one-time-code" required>
<p class="note">Same PIN you use to sign in. Keys stay on the server — you will pick one next.</p>
</div>
<div class="buttons">
<button type="submit" name="action" value="pin" class="approve">Continue</button>
<button type="submit" name="action" value="deny" class="deny" formnovalidate>Deny</button>
</div>
</form>`;
}

function renderKeyOptions(keys, selectedKeyId, requestedScopes) {
    if (!keys.length) {
        return '<p class="note">No keys yet. Create one below.</p>';
    }
    return keys.map((key) => {
        const missing = consent.scopesMissingFromKey(key.scopes, requestedScopes);
        const upgrade = missing.length ? ` · upgrade +${missing.join(', ')}` : '';
        const label = `${key.appName} · ${key.keyPrefix}… · ${(key.scopes || []).join(', ')}${upgrade}`;
        const selected = key.id === selectedKeyId ? ' data-selected="1"' : '';
        return `<button type="button" class="key-option" data-value="${escapeHtml(key.id)}"${selected}>${escapeHtml(label)}</button>`;
    }).join('\n');
}

function renderPickStep(params) {
    const requestedScopes = parseScopes(params.scope);
    const selected = (params.keys || []).find((k) => k.id === params.selectedKeyId);
    const selectedMissing = selected
        ? consent.scopesMissingFromKey(selected.scopes, requestedScopes)
        : [];
    const selectedLabel = selected
        ? `${selected.appName} · ${selected.keyPrefix}…${selectedMissing.length ? ` · upgrade +${selectedMissing.join(', ')}` : ''}`
        : ((params.keys || []).length ? 'Select a key' : 'Create a key first');
    const boundBlock = params.boundKeyLabel
        ? `<div class="bound-note">This client is already bound to <strong>${escapeHtml(params.boundKeyLabel)}</strong>. Approve adds any newly requested named scopes to the selected key.</div>`
        : '';

    return `<form method="POST" action="${escapeHtml(params.formAction)}" autocomplete="off">
${hiddenOAuthFields(params)}
<input type="hidden" name="csrf" value="${escapeHtml(params.csrf)}">
${boundBlock}
<div class="field">
<label>Application key</label>
<div class="custom-dropdown">
<button type="button" class="custom-dropdown-btn" id="keyDropdownBtn">
<span id="keyDropdownSelected">${escapeHtml(selectedLabel)}</span>
</button>
<div id="keyDropdownMenu" class="custom-dropdown-menu hidden">
${renderKeyOptions(params.keys || [], params.selectedKeyId, requestedScopes)}
</div>
</div>
<input type="hidden" name="selected_key_id" id="selectedKeyId" value="${escapeHtml(params.selectedKeyId || '')}">
<p class="note">Keys for your PIN. Approve adds missing requested named scopes to the selected key. Never universal.</p>
</div>
<div class="buttons">
<button type="submit" name="action" value="approve" class="approve">Approve</button>
<button type="submit" name="action" value="deny" class="deny">Deny</button>
</div>
<div class="field">
<label for="new_key_name">Or create a new key</label>
<input type="text" id="new_key_name" name="new_key_name" maxlength="80" placeholder="${escapeHtml(params.generatedName)}" autocomplete="off">
</div>
<button type="submit" name="action" value="create_key" class="create">Create new key</button>
</form>`;
}

function renderPickScript(hasPicker) {
    if (!hasPicker) return '';
    return `<script>
(function(){
var btn=document.getElementById('keyDropdownBtn');
var menu=document.getElementById('keyDropdownMenu');
var selected=document.getElementById('keyDropdownSelected');
var hidden=document.getElementById('selectedKeyId');
if(!btn||!menu||!hidden)return;
btn.addEventListener('click',function(e){
e.preventDefault();
menu.classList.toggle('hidden');
});
menu.querySelectorAll('.key-option').forEach(function(opt){
opt.addEventListener('click',function(){
hidden.value=opt.getAttribute('data-value')||'';
selected.textContent=opt.textContent;
menu.classList.add('hidden');
});
});
document.addEventListener('click',function(e){
if(!btn.contains(e.target)&&!menu.contains(e.target))menu.classList.add('hidden');
});
})();
</script>`;
}

function renderConsentPage(params) {
    const scopes = parseScopes(params.scope);
    const scopeListHtml = scopes.length > 0
        ? scopes.map((s) => `<li>${escapeHtml(s)}</li>`).join('\n')
        : '<li>No specific scopes requested</li>';
    const errorBlock = params.error
        ? `<div class="error">${escapeHtml(params.error)}</div>`
        : '';
    const step = params.step || 'pin';
    const stepBody = step === 'pick'
        ? renderPickStep(params)
        : renderPinStep(params);
    const stepScript = step === 'pick'
        ? renderPickScript(true)
        : '';

    return CONSENT_PAGE_HTML
        .replace('{{ERROR_BLOCK}}', errorBlock)
        .replace('{{CLIENT_NAME}}', escapeHtml(params.clientName))
        .replace('{{SCOPE_LIST}}', scopeListHtml)
        .replace('{{STEP_BODY}}', stepBody)
        .replace('{{STEP_SCRIPT}}', stepScript);
}

function redirectWithError(res, redirectUri, error, errorDescription, state) {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (errorDescription) url.searchParams.set('error_description', errorDescription);
    if (state) url.searchParams.set('state', state);
    res.redirect(302, url.toString());
}

function sendConsentHtml(res, html, status) {
    res.status(status || 200);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(html);
}

function oauthCookieSecure(provider) {
    return !String(provider.getMcpBaseUrl() || '').startsWith('http://');
}

function createOAuthRoutes(globalResources) {
    const provider = new McpOAuthProvider(globalResources);

    function consentPageParams(base, extras) {
        return Object.assign({
            clientName: base.clientName,
            clientId: base.clientId,
            redirectUri: base.redirectUri,
            state: base.state,
            scope: base.scope || '',
            codeChallenge: base.codeChallenge,
            codeChallengeMethod: base.codeChallengeMethod || 'S256',
            resource: base.resource || '',
            formAction: `${provider.getOAuthEndpointPrefix()}/authorize`,
            generatedName: consent.generatedKeyName(base.clientName)
        }, extras || {});
    }

    async function loadPickKeys(userType, requestedScopes, boundKeyId) {
        const manager = globalResources.getApplicationAuthManager();
        const keys = consent.filterKeysForConsent(
            await manager.listApplicationKeys({
                includeExpired: false,
                userType
            }),
            requestedScopes
        );
        if (boundKeyId && !keys.some((k) => k.id === boundKeyId)) {
            const all = await manager.listApplicationKeys({ includeExpired: true, userType });
            const bound = all.find((k) => k.id === boundKeyId);
            if (bound) keys.unshift(bound);
        }
        return keys;
    }

    async function boundKeyLabel(applicationKeyId) {
        if (!applicationKeyId) return '';
        const manager = globalResources.getApplicationAuthManager();
        const keys = await manager.listApplicationKeys({ includeExpired: true });
        const row = keys.find((k) => k.id === applicationKeyId);
        return row ? `${row.appName} · ${row.keyPrefix}…` : 'an existing key';
    }

    async function renderAuthorizedStep(req, res, page, { error, selectedKeyId, status } = {}) {
        const session = consent.getConsentSession(consent.readConsentCookie(req));
        if (!session || session.clientId !== page.clientId) {
            return sendConsentHtml(res, renderConsentPage(consentPageParams(page, {
                step: 'pin',
                error: error || null
            })), status);
        }
        const requestedScopes = parseScopes(page.scope);
        const keys = await loadPickKeys(session.userType, requestedScopes, page.applicationKeyId);
        return sendConsentHtml(res, renderConsentPage(consentPageParams(page, {
            step: 'pick',
            csrf: session.csrf,
            keys,
            selectedKeyId: selectedKeyId
                || page.applicationKeyId
                || (keys[0] && keys[0].id)
                || '',
            boundKeyLabel: page.applicationKeyId
                ? await boundKeyLabel(page.applicationKeyId)
                : '',
            error
        })), status);
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

            const page = {
                clientName: client.clientName,
                clientId: client_id,
                redirectUri: redirect_uri,
                state,
                scope: scope || '',
                codeChallenge: code_challenge,
                codeChallengeMethod: code_challenge_method || 'S256',
                resource: resource || '',
                applicationKeyId: client.applicationKeyId
            };
            return renderAuthorizedStep(req, res, page);
        } catch (error) {
            console.error('OAuth authorize GET error:', error.message);
            return res.status(500).send('Internal error');
        }
    }

    async function finishApprove(res, {
        client, clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, resource, applicationKeyId
    }) {
        const requestedScopes = parseScopes(scope);
        const keyScopes = await provider.getAppKeyScopes(applicationKeyId);
        if (!keyScopes) {
            return redirectWithError(res, redirectUri, 'server_error', 'Application key no longer valid', state);
        }
        const grantedScopes = keyScopes.includes('universal')
            ? requestedScopes
            : requestedScopes.filter((s) => keyScopes.includes(s));
        const code = await provider.createAuthorizationCode({
            clientId,
            applicationKeyId,
            redirectUri,
            scopes: grantedScopes,
            codeChallenge,
            codeChallengeMethod: codeChallengeMethod || 'S256',
            resource: resource || null
        });
        if (!client.applicationKeyId) {
            await provider.bindClientApplicationKey(clientId, applicationKeyId);
        }
        const redirectUrl = new URL(redirectUri);
        redirectUrl.searchParams.set('code', code);
        if (state) redirectUrl.searchParams.set('state', state);
        return res.redirect(302, redirectUrl.toString());
    }

    async function handleAuthorizePost(req, res) {
        const cookiePath = provider.getOAuthEndpointPrefix();
        try {
            const {
                action, client_id, redirect_uri, state, scope,
                code_challenge, code_challenge_method, resource,
                pin, csrf, selected_key_id, new_key_name
            } = req.body || {};

            if (!redirect_uri) {
                return res.status(400).send('redirect_uri required');
            }

            const uriValidation = validateRedirectUri(redirect_uri);
            if (!uriValidation.valid) {
                return res.status(400).send(uriValidation.error);
            }

            if (action === 'deny') {
                consent.destroyConsentSession(consent.readConsentCookie(req));
                consent.clearConsentCookie(res, cookiePath);
                return redirectWithError(res, redirect_uri, 'access_denied', 'User denied the request', state);
            }

            if (!client_id) {
                return redirectWithError(res, redirect_uri, 'invalid_request', 'client_id required', state);
            }
            if (!code_challenge) {
                return redirectWithError(res, redirect_uri, 'invalid_request', 'code_challenge required', state);
            }

            const client = await provider.getClientById(client_id);
            if (!client) {
                return redirectWithError(res, redirect_uri, 'invalid_client', 'Unknown client', state);
            }
            if (!client.redirectUris.includes(redirect_uri)) {
                return res.status(400).send('redirect_uri not registered for this client');
            }

            const page = {
                clientName: client.clientName,
                clientId: client_id,
                redirectUri: redirect_uri,
                state,
                scope: scope || '',
                codeChallenge: code_challenge,
                codeChallengeMethod: code_challenge_method || 'S256',
                resource: resource || '',
                applicationKeyId: client.applicationKeyId
            };

            if (action === 'pin') {
                const ip = consent.clientIp(req);
                if (consent.isPinLocked(ip)) {
                    return sendConsentHtml(res, renderConsentPage(consentPageParams(page, {
                        step: 'pin',
                        error: 'Too many PIN attempts. Try again later.'
                    })), 429);
                }
                const verified = consent.verifyConsentPin(pin, globalResources);
                if (!verified.ok) {
                    consent.recordPinFailure(ip);
                    return sendConsentHtml(res, renderConsentPage(consentPageParams(page, {
                        step: 'pin',
                        error: 'Invalid PIN'
                    })), 401);
                }
                consent.clearPinFailures(ip);
                const session = consent.createConsentSession({
                    clientId: client_id,
                    userType: verified.userType
                });
                consent.setConsentCookie(res, session.sessionId, {
                    path: cookiePath,
                    secure: oauthCookieSecure(provider)
                });
                req.cookies = req.cookies || {};
                req.cookies[consent.CONSENT_COOKIE_NAME] = session.sessionId;
                return renderAuthorizedStep(req, res, page);
            }

            const session = consent.getConsentSession(consent.readConsentCookie(req));
            if (!session || session.clientId !== client_id || !consent.csrfMatches(session, csrf)) {
                return sendConsentHtml(res, renderConsentPage(consentPageParams(page, {
                    step: 'pin',
                    error: 'Sign in again to continue'
                })), 401);
            }

            if (action === 'create_key') {
                const requestedScopes = parseScopes(scope);
                const createScopes = consent.namedScopesForCreate(requestedScopes);
                const manager = globalResources.getApplicationAuthManager();
                const created = await manager.createApplicationKey({
                    appName: String(new_key_name || '').trim() || consent.generatedKeyName(client.clientName),
                    userAgent: String(req.headers['user-agent'] || 'mcp-oauth-consent').slice(0, 300),
                    scopes: createScopes,
                    userType: session.userType
                });
                if ((created.summary.scopes || []).includes('universal')) {
                    await manager.revokeApplicationKey(created.summary.id);
                    return renderAuthorizedStep(req, res, page, {
                        error: 'Could not create a scoped key',
                        status: 500
                    });
                }
                return renderAuthorizedStep(req, res, page, {
                    selectedKeyId: created.summary.id
                });
            }

            if (action === 'approve') {
                const requestedScopes = parseScopes(scope);
                const keys = await loadPickKeys(session.userType, requestedScopes, client.applicationKeyId);
                const picked = keys.find((k) => k.id === selected_key_id);
                let applicationKeyId = picked
                    ? picked.id
                    : (client.applicationKeyId || null);
                if (!applicationKeyId) {
                    return renderAuthorizedStep(req, res, page, {
                        error: 'Select a key to approve',
                        status: 400
                    });
                }
                const manager = globalResources.getApplicationAuthManager();
                const merged = await manager.mergeNamedScopes(applicationKeyId, requestedScopes, {
                    userType: session.userType
                });
                if (!merged.success) {
                    const mergeError = merged.error === 'USER_TYPE_MISMATCH'
                        ? 'That key belongs to a different PIN'
                        : 'Could not upgrade that key';
                    return renderAuthorizedStep(req, res, page, {
                        error: mergeError,
                        selectedKeyId: applicationKeyId,
                        status: 400
                    });
                }
                consent.destroyConsentSession(session.sessionId);
                consent.clearConsentCookie(res, cookiePath);
                return finishApprove(res, {
                    client,
                    clientId: client_id,
                    redirectUri: redirect_uri,
                    state,
                    scope,
                    codeChallenge: code_challenge,
                    codeChallengeMethod: code_challenge_method,
                    resource,
                    applicationKeyId
                });
            }

            return sendConsentHtml(res, renderConsentPage(consentPageParams(page, {
                step: 'pin',
                error: 'Invalid action'
            })), 400);
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

module.exports = {
    createOAuthRoutes,
    renderConsentPage,
    CONSENT_PAGE_HTML
};
