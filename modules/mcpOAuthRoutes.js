/**
 * OAuth 2.1 + PKCE HTTP routes for MCP Grok connector.
 * Mounted under /{mcpPathUuid}/oauth/* by mcpAgentFacade.js
 * ui-review: consent page HTML below — Yukimi approves chrome before done.
 */

const { McpOAuthProvider, validateRedirectUri, parseScopes, isApplicationKeyFormat } = require('./mcpOAuthProvider');

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
.buttons{display:flex;gap:12px}
button{flex:1;padding:14px;border:none;border-radius:8px;font-size:1rem;font-weight:600;cursor:pointer;transition:opacity 0.2s}
.approve{background:#8b8bff;color:#fff}
.approve:hover{opacity:0.9}
.deny{background:#3a3a5c;color:#e0e0e0}
.deny:hover{opacity:0.8}
.error{color:#ff6b6b;background:#3a2a2a;padding:16px;border-radius:8px;margin-bottom:20px}
.app-key-section{margin-bottom:20px}
.app-key-section label{display:block;color:#888;font-size:0.9rem;margin-bottom:8px}
.app-key-section input{width:100%;padding:12px;background:#1a1a2e;border:1px solid #3a3a5c;border-radius:8px;color:#e0e0e0;font-family:monospace;font-size:0.95rem}
.app-key-section input:focus{outline:none;border-color:#8b8bff}
.note{font-size:0.85rem;color:#666;margin-top:8px}
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
{{APP_KEY_INPUT}}
<div class="scopes">
<h3>Requested permissions</h3>
<ul class="scope-list">
{{SCOPE_LIST}}
</ul>
</div>
<form method="POST" action="{{FORM_ACTION}}">
<input type="hidden" name="client_id" value="{{CLIENT_ID}}">
<input type="hidden" name="redirect_uri" value="{{REDIRECT_URI}}">
<input type="hidden" name="state" value="{{STATE}}">
<input type="hidden" name="scope" value="{{SCOPE}}">
<input type="hidden" name="code_challenge" value="{{CODE_CHALLENGE}}">
<input type="hidden" name="code_challenge_method" value="{{CODE_CHALLENGE_METHOD}}">
<input type="hidden" name="resource" value="{{RESOURCE}}">
<input type="hidden" name="response_type" value="code">
{{APP_KEY_HIDDEN}}
<div class="buttons">
<button type="submit" name="action" value="deny" class="deny">Deny</button>
<button type="submit" name="action" value="approve" class="approve">Approve</button>
</div>
</form>
</div>
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

function renderConsentPage({ clientName, clientId, redirectUri, state, scope, codeChallenge, codeChallengeMethod, resource, formAction, error, applicationKeyId }) {
    const scopes = parseScopes(scope);
    const scopeListHtml = scopes.length > 0
        ? scopes.map(s => `<li>${escapeHtml(s)}</li>`).join('\n')
        : '<li>No specific scopes requested</li>';

    const errorBlock = error
        ? `<div class="error">${escapeHtml(error)}</div>`
        : '';

    const appKeyInput = applicationKeyId
        ? ''
        : `<div class="app-key-section">
<label for="application_key">Your Application Key (sfapp_...)</label>
<input type="password" id="application_key" name="application_key" placeholder="sfapp_..." required autocomplete="off">
<p class="note">Enter your StaticForge application key to bind this authorization</p>
</div>`;

    const appKeyHidden = applicationKeyId
        ? `<input type="hidden" name="application_key_id" value="${escapeHtml(applicationKeyId)}">`
        : '';

    return CONSENT_PAGE_HTML
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
        .replace('{{RESOURCE}}', escapeHtml(resource || ''))
        .replace('{{APP_KEY_INPUT}}', appKeyInput)
        .replace('{{APP_KEY_HIDDEN}}', appKeyHidden);
}

function redirectWithError(res, redirectUri, error, errorDescription, state) {
    const url = new URL(redirectUri);
    url.searchParams.set('error', error);
    if (errorDescription) url.searchParams.set('error_description', errorDescription);
    if (state) url.searchParams.set('state', state);
    res.redirect(302, url.toString());
}

function createOAuthRoutes(globalResources) {
    const provider = new McpOAuthProvider(globalResources);

    async function handleRegister(req, res) {
        // RFC 7591 DCR: application_key is optional (public client, PKCE).
        // If omitted, app key is bound at consent approve time.
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

            const formAction = `${provider.getOAuthEndpointPrefix()}/authorize`;
            const html = renderConsentPage({
                clientName: client.clientName,
                clientId: client_id,
                redirectUri: redirect_uri,
                state,
                scope: scope || '',
                codeChallenge: code_challenge,
                codeChallengeMethod: code_challenge_method || 'S256',
                resource: resource || '',
                formAction,
                applicationKeyId: client.applicationKeyId
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
                action, client_id, redirect_uri, state, scope,
                code_challenge, code_challenge_method, resource,
                application_key, application_key_id
            } = req.body || {};

            if (!redirect_uri) {
                return res.status(400).send('redirect_uri required');
            }

            const uriValidation = validateRedirectUri(redirect_uri);
            if (!uriValidation.valid) {
                return res.status(400).send(uriValidation.error);
            }

            if (action === 'deny') {
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

            let applicationKeyId = application_key_id || client.applicationKeyId;
            if (application_key && isApplicationKeyFormat(application_key)) {
                const manager = globalResources.getApplicationAuthManager();
                const validation = await manager.validateApplicationKey(application_key, '', {
                    allowRefreshOverdue: false,
                    skipUserAgent: true
                });
                if (!validation.valid) {
                    const formAction = `${provider.getOAuthEndpointPrefix()}/authorize`;
                    const html = renderConsentPage({
                        clientName: client.clientName,
                        clientId: client_id,
                        redirectUri: redirect_uri,
                        state,
                        scope: scope || '',
                        codeChallenge: code_challenge,
                        codeChallengeMethod: code_challenge_method || 'S256',
                        resource: resource || '',
                        formAction,
                        error: `Invalid application key: ${validation.message}`
                    });
                    res.setHeader('Content-Type', 'text/html; charset=utf-8');
                    return res.status(400).send(html);
                }
                applicationKeyId = validation.applicationKeyId;
            }

            if (!applicationKeyId) {
                return redirectWithError(res, redirect_uri, 'invalid_request', 'Application key required', state);
            }

            const requestedScopes = parseScopes(scope);
            const keyScopes = await provider.getAppKeyScopes(applicationKeyId);
            if (!keyScopes) {
                return redirectWithError(res, redirect_uri, 'server_error', 'Application key no longer valid', state);
            }

            const grantedScopes = keyScopes.includes('universal')
                ? requestedScopes
                : requestedScopes.filter(s => keyScopes.includes(s));

            const code = await provider.createAuthorizationCode({
                clientId: client_id,
                applicationKeyId,
                redirectUri: redirect_uri,
                scopes: grantedScopes,
                codeChallenge: code_challenge,
                codeChallengeMethod: code_challenge_method || 'S256',
                resource: resource || null
            });

            const redirectUrl = new URL(redirect_uri);
            redirectUrl.searchParams.set('code', code);
            if (state) redirectUrl.searchParams.set('state', state);

            return res.redirect(302, redirectUrl.toString());
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
