const fs = require('fs');
const crypto = require('crypto');
const { isApplicationKeyFormat, isTempTokenFormat, redactApplicationRequestPath, describeKeylessPacket } = require('./applicationAuthManager');
const { isOAuthAccessTokenFormat } = require('./mcpOAuthProvider');
const { resolveRequestClientIp, trustedProxiesFromResources } = require('./clientAddress');
const {
    queryCarriesLoginKey,
    readHeaderLoginKey,
    auditWebLogin,
    describeClientForAudit
} = require('./approvedIpAccess');

function noteApplicationRequest(req, res, globalResources, source) {
    if (!req || !res || req._appRequestNoted) return;
    const auth = req.applicationAuth;
    if (!auth || !auth.applicationKeyId) return;
    req._appRequestNoted = true;
    res.on('finish', () => {
        let manager = null;
        try {
            manager = globalResources.getApplicationAuthManager();
        } catch (_) {
            return;
        }
        if (!manager || typeof manager.recordApplicationRequest !== 'function') return;
        const rawPath = req.originalUrl || req.url || req.path || '/';
        manager.recordApplicationRequest({
            applicationKeyId: auth.applicationKeyId,
            appName: auth.appName || '',
            httpMethod: req.method || '',
            path: redactApplicationRequestPath(rawPath),
            statusCode: res.statusCode || 0,
            source: source || 'http',
            ip: req.realClientIp || req.socket?.remoteAddress || '',
            userAgent: req.headers && req.headers['user-agent']
        }).catch(() => {});
    });
}

function applyAuthContext(req, context) {
    req.userType = context.userType;
    req.authMethod = context.authMethod;
    req.applicationAuth = context;
    req.sessionId = context.sessionId || req.sessionId;
    if (req.session) {
        req.session.authenticated = true;
        req.session.userType = context.userType;
    }
}

async function resolveApplicationAuth(req, globalResources, options = {}) {
    let manager = null;
    try {
        manager = globalResources.getApplicationAuthManager();
    } catch (_) {
        return null;
    }
    if (!manager) return null;

    const extracted = manager.extractAuthFromRequest(req);
    if (!extracted) return null;

    const userAgent = req.headers['user-agent'] || '';
    const ipInfo = resolveRequestClientIp(req, trustedProxiesFromResources(globalResources));
    if (ipInfo.ip && ipInfo.ip !== 'unknown') req.realClientIp = ipInfo.ip;
    const keyValidateOptions = {
        allowRefreshOverdue: options.allowRefreshOverdue === true,
        skipUserAgent: options.skipUserAgent === true,
        clientIp: ipInfo.keylessIp || ipInfo.ip || null
    };
    if (options.unknownUserAgentBypass === true) {
        keyValidateOptions.unknownUserAgentBypass = true;
    }

    if (extracted.type === 'temp_token') {
        const result = await manager.validateTempToken(extracted.token);
        if (!result.valid) {
            return { rejected: true, status: 403, body: { error: result.message, code: result.code } };
        }
        return {
            userType: result.userType,
            authMethod: 'temp_token',
            applicationKeyId: result.applicationKeyId,
            applicationScopes: result.scopes,
            appName: result.appName || null,
            skipUserAgentCheck: true,
            sessionId: `apptok:${result.tempTokenId}`
        };
    }

    if (extracted.type === 'application_key') {
        const result = await manager.validateApplicationKey(extracted.token, userAgent, keyValidateOptions);
        if (!result.valid) {
            return { rejected: true, status: 403, body: { error: result.message, code: result.code } };
        }
        return {
            userType: result.userType,
            authMethod: 'application_key',
            applicationKeyId: result.applicationKeyId,
            applicationScopes: result.scopes,
            appName: result.appName || null,
            applicationUserAgent: userAgent,
            sessionId: `appkey:${result.applicationKeyId}`,
            userAgentMatched: result.userAgentMatched === true,
            userAgentBypassed: result.userAgentBypassed === true
        };
    }

    return null;
}

function acceptLoginKey(req, globalResources, source) {
    req.userType = 'admin';
    req.authMethod = 'login_key';
    if (req.session) {
        req.session.authenticated = true;
        req.session.userType = 'admin';
    }
    const client = describeClientForAudit(req, globalResources);
    if (client.client) req.realClientIp = client.client;
    else if (client.peer) req.realClientIp = client.peer;
    const headerSource = source === 'x-dreamscape-login-key' || source === 'bearer';
    auditWebLogin(globalResources, {
        event: headerSource ? 'header_login_key' : 'login_key',
        ip: client.ip,
        userAgent: (req.headers && req.headers['user-agent']) || '',
        user: 'admin',
        source: source || 'header'
    });
    req._headerLoginAccepted = true;
}

/**
 * Header login key (X-Dreamscape-Login-Key or Authorization: Bearer).
 * Query-string copies are refused. Constant-time compare. Does not read ?auth=.
 * A second call after success does not audit again.
 */
function applyHeaderLoginKey(req, globalResources) {
    if (req && req._headerLoginAccepted && req.authMethod === 'login_key') {
        return { accepted: true, already: true };
    }
    if (queryCarriesLoginKey(req)) return { forbiddenQuery: true };
    let loginKey = null;
    try {
        loginKey = globalResources.getSecureConfig({ path: 'loginKey' });
    } catch (_err) {
        loginKey = null;
    }
    if (loginKey === null || typeof loginKey !== 'string') return { absent: true };
    const headerKey = readHeaderLoginKey(req);
    if (headerKey.invalid) return { invalidHeader: true };
    if (!headerKey.token) return { absent: true };
    if (isApplicationKeyFormat(headerKey.token) || isTempTokenFormat(headerKey.token)) {
        return { appCredential: true };
    }
    if (!credentialsMatch(headerKey.token, loginKey)) return { rejected: true };
    acceptLoginKey(req, globalResources, headerKey.source);
    return { accepted: true };
}

function createAuthMiddleware(globalResources) {
    return async (req, res, next) => {
        res.setHeader('Cache-Control', 'blocked, no-store, no-cache, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Last-Modified', new Date().toUTCString());
        res.setHeader('ETag', `"${Date.now()}"`);

        try {
            const appAuth = await resolveApplicationAuth(req, globalResources);
            if (appAuth?.rejected) {
                return res.status(appAuth.status).json(appAuth.body);
            }
            if (appAuth && !appAuth.rejected) {
                applyAuthContext(req, appAuth);
                noteApplicationRequest(req, res, globalResources, 'http');
                return next();
            }
        } catch (err) {
            console.error('Application auth resolution error:', err.message);
        }

        const headerAuth = applyHeaderLoginKey(req, globalResources);
        if (headerAuth.forbiddenQuery) {
            return res.status(400).json({
                error: 'Do not put the login key in the query string',
                code: 'QUERY_AUTH_FORBIDDEN'
            });
        }
        if (headerAuth.invalidHeader) {
            return res.status(400).json({ error: 'Invalid login key header', code: 'INVALID_LOGIN_KEY_HEADER' });
        }
        if (headerAuth.appCredential) {
            return res.status(403).json({ error: 'Use X-StaticForge-App-Key or X-StaticForge-App-Token headers for application credentials' });
        }
        if (headerAuth.rejected) {
            return res.status(403).json({ error: 'Invalid authentication token' });
        }
        if (headerAuth.accepted) return next();

        const loginKey = globalResources.getSecureConfig({ path: 'loginKey' });
        if (loginKey === null) {
            return next();
        }

        const legacyAuth = req.query ? req.query.auth : undefined;
        if (legacyAuth != null && legacyAuth !== '') {
            if (typeof legacyAuth !== 'string'
                || isApplicationKeyFormat(legacyAuth)
                || isTempTokenFormat(legacyAuth)
                || !credentialsMatch(legacyAuth, loginKey)) {
                return res.status(403).json({ error: 'Invalid authentication token' });
            }
            acceptLoginKey(req, globalResources, 'legacy_query');
            return next();
        }

        if (req.session && req.session.authenticated) {
            req.userType = req.session.userType || 'admin';
            req.authMethod = 'session';
            req.sessionId = req.session.id;
            return next();
        }

        return res.status(401).json({ error: 'Authentication required' });
    };
}

/** Lightweight resolver for rate limiting — sets req.applicationAuth when valid. */
function createApplicationAuthEarlyMiddleware(globalResources) {
    return async (req, res, next) => {
        try {
            const appAuth = await resolveApplicationAuth(req, globalResources);
            if (appAuth && !appAuth.rejected) {
                applyAuthContext(req, appAuth);
                noteApplicationRequest(req, res, globalResources, 'http');
            }
        } catch (_) {
            // Non-fatal for early middleware
        }
        next();
    };
}

function isLoopbackAddress(address) {
    return address === '::1'
        || address?.startsWith('127.')
        || address?.startsWith('::ffff:127.');
}

function credentialsMatch(received, expected) {
    if (typeof received !== 'string' || typeof expected !== 'string') return false;
    const receivedBuffer = Buffer.from(received);
    const expectedBuffer = Buffer.from(expected);
    return receivedBuffer.length === expectedBuffer.length
        && crypto.timingSafeEqual(receivedBuffer, expectedBuffer);
}

function createMcpAuthMiddleware(globalResources, options = {}) {
    const { resourceMetadataUrl } = options;

    return async (req, res, next) => {
        res.setHeader('Cache-Control', 'blocked, no-store, no-cache, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        if (req.query.auth != null || req.query.loginKey != null) {
            return res.status(400).json({
                error: 'Do not put credentials in the query string',
                code: 'QUERY_AUTH_FORBIDDEN'
            });
        }

        try {
            const appAuth = await resolveApplicationAuth(req, globalResources, {
                allowRefreshOverdue: false,
                skipUserAgent: false,
                unknownUserAgentBypass: true
            });
            if (appAuth && appAuth.rejected) {
                return res.status(appAuth.status).json(appAuth.body);
            }
            if (appAuth && !appAuth.rejected && appAuth.authMethod === 'application_key') {
                applyAuthContext(req, appAuth);
                noteApplicationRequest(req, res, globalResources, 'mcp');
                return next();
            }
        } catch (err) {
            console.error('MCP application auth resolution error:', err.message);
        }

        // OAuth 2.1 access token validation
        // modules/mcpOAuthProvider.js
        try {
            const authHeader = req.headers.authorization;
            if (authHeader && authHeader.startsWith('Bearer ')) {
                const token = authHeader.slice(7).trim();
                if (isOAuthAccessTokenFormat(token)) {
                    const oauthProvider = req.mcpOAuthProvider || globalResources.getMcpOAuthProvider?.();
                    if (oauthProvider) {
                        const validation = await oauthProvider.validateAccessToken(token);
                        if (validation.valid) {
                            applyAuthContext(req, {
                                userType: validation.userType,
                                authMethod: 'oauth_access_token',
                                applicationKeyId: validation.applicationKeyId,
                                applicationScopes: validation.scopes,
                                appName: validation.appName || null,
                                oauthClientId: validation.clientId,
                                oauthResource: validation.resource,
                                sessionId: `oauth:${validation.applicationKeyId}`
                            });
                            noteApplicationRequest(req, res, globalResources, 'mcp');
                            return next();
                        }
                    }
                }
            }
        } catch (err) {
            console.error('MCP OAuth auth resolution error:', err.message);
        }

        try {
            const keyless = await resolveMcpKeyless(req, globalResources);
            if (keyless) {
                applyAuthContext(req, keyless);
                noteApplicationRequest(req, res, globalResources, 'keyless');
                return next();
            }
        } catch (err) {
            console.error('MCP keyless auth error:', err.message);
        }

        if (resourceMetadataUrl) {
            res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadataUrl}"`);
        }
        return res.status(401).json({
            error: 'Application key required',
            code: 'APP_KEY_REQUIRED'
        });
    };
}

function createDevAuthMiddleware(globalResources) {
    return async (req, res, next) => {
        res.setHeader('Cache-Control', 'blocked, no-store, no-cache, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Last-Modified', new Date().toUTCString());
        res.setHeader('ETag', `"${Date.now()}"`);

        // Only the direct TCP peer is authoritative; forwarded headers are intentionally ignored.
        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
            return res.status(403).json({ error: 'Development access is loopback-only' });
        }

        const enableDev = globalResources.getConfig({ path: 'enable_dev' });
        if (!enableDev) {
            return res.status(404).json({ error: 'Development mode not enabled' });
        }

        try {
            const appAuth = await resolveApplicationAuth(req, globalResources, {
                allowRefreshOverdue: true,
                skipUserAgent: true
            });
            if (appAuth && appAuth.rejected) {
                return res.status(appAuth.status).json(appAuth.body);
            }
            if (appAuth && !appAuth.rejected) {
                applyAuthContext(req, appAuth);
                noteApplicationRequest(req, res, globalResources, 'dev');
                return next();
            }
        } catch (err) {
            console.error('Development application auth resolution error:', err.message);
        }

        const devLoginKey = globalResources.getSecureConfig({ path: 'devLoginKey' });
        if (!devLoginKey) {
            return res.status(500).json({
                error: 'Development login key not configured',
                code: 'DEV_LOGIN_KEY_NOT_CONFIGURED',
                configPath: 'secure.config.json:devLoginKey'
            });
        }

        const authorizationMatch = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i);
        const authToken = req.query.auth || authorizationMatch?.[1];
        if (!authToken) {
            return res.status(401).json({ error: 'Development authentication required' });
        }
        if (!credentialsMatch(authToken, devLoginKey)) {
            return res.status(403).json({ error: 'Invalid development authentication token' });
        }

        req.userType = 'dev_admin';
        req.authMethod = 'dev_login_key';
        if (req.session) {
            req.session.authenticated = true;
            req.session.userType = 'dev_admin';
        }
        return next();
    };
}

function createAgentAssetAuthMiddleware(globalResources) {
    return (req, res, next) => {
        res.setHeader('Cache-Control', 'blocked, no-store, no-cache, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');

        if (!isLoopbackAddress(req.socket?.remoteAddress)) {
            return res.status(403).json({ error: 'Development access is loopback-only' });
        }

        const enableDev = globalResources.getConfig({ path: 'enable_dev' });
        if (!enableDev) {
            return res.status(404).json({ error: 'Development mode not enabled' });
        }

        if (req.session && req.session.authenticated && req.session.userType === 'dev_admin') {
            req.userType = 'dev_admin';
            req.authMethod = 'dev_admin_session';
            return next();
        }

        const devLoginKey = globalResources.getSecureConfig({ path: 'devLoginKey' });
        if (!devLoginKey) {
            return res.status(500).json({
                error: 'Development login key not configured',
                code: 'DEV_LOGIN_KEY_NOT_CONFIGURED',
                configPath: 'secure.config.json:devLoginKey'
            });
        }

        const authorizationMatch = req.headers.authorization?.match(/^Bearer ([^\s]+)$/i);
        const authToken = req.query.auth || authorizationMatch?.[1];
        if (!authToken) {
            return res.status(401).json({ error: 'Development authentication required' });
        }
        if (!credentialsMatch(authToken, devLoginKey)) {
            return res.status(403).json({ error: 'Invalid development authentication token' });
        }

        req.userType = 'dev_admin';
        req.authMethod = 'dev_login_key';
        return next();
    };
}

function presentedMcpCredential(req) {
    if (!req || !req.headers) return false;
    if (req.headers['x-staticforge-app-key'] || req.headers['x-staticforge-app-token']) return true;
    const authorization = req.headers.authorization;
    return typeof authorization === 'string' && /^Bearer\s+\S+/i.test(authorization);
}

/**
 * Keyless Trusted Access runs only when the request did not present a key or bearer.
 * A presented credential stays on the normal auth path, including rejection.
 */
async function resolveMcpKeyless(req, globalResources) {
    if (presentedMcpCredential(req)) return null;
    let manager = null;
    try {
        manager = globalResources.getApplicationAuthManager();
    } catch (_) {
        return null;
    }
    if (!manager || typeof manager.resolveKeylessAccess !== 'function') return null;
    const ipInfo = resolveRequestClientIp(req, trustedProxiesFromResources(globalResources));
    if (ipInfo.ip && ipInfo.ip !== 'unknown') req.realClientIp = ipInfo.ip;
    const userAgent = (req.headers && req.headers['user-agent']) || '';
    const keyless = await manager.resolveKeylessAccess({
        userAgent,
        clientIp: ipInfo.keylessIp
    });
    if (!keyless) return null;
    const described = describeKeylessPacket(req);
    try {
        await manager.auditKeylessRequest({
            applicationKeyId: keyless.applicationKeyId,
            appName: keyless.appName,
            userAgent,
            ip: ipInfo.keylessIp,
            packet: described.packet,
            tool: described.tool
        });
    } catch (err) {
        console.error('keyless audit failed:', err.message);
    }
    return keyless;
}

function isReadOnlyUser(req) {
    return req.userType === 'readonly';
}

function isAdminUser(req) {
    return req.userType === 'admin';
}

module.exports = {
    createAuthMiddleware,
    createApplicationAuthEarlyMiddleware,
    createMcpAuthMiddleware,
    createDevAuthMiddleware,
    createAgentAssetAuthMiddleware,
    isLoopbackAddress,
    isReadOnlyUser,
    isAdminUser,
    resolveApplicationAuth,
    resolveMcpKeyless,
    applyAuthContext,
    applyHeaderLoginKey
};
