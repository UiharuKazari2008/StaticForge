const fs = require('fs');
const crypto = require('crypto');
const { isApplicationKeyFormat, isTempTokenFormat } = require('./applicationAuthManager');

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
    const keyValidateOptions = {
        allowRefreshOverdue: options.allowRefreshOverdue === true,
        skipUserAgent: options.skipUserAgent === true
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
            applicationUserAgent: userAgent,
            sessionId: `appkey:${result.applicationKeyId}`,
            userAgentMatched: result.userAgentMatched === true,
            userAgentBypassed: result.userAgentBypassed === true
        };
    }

    return null;
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
                return next();
            }
        } catch (err) {
            console.error('Application auth resolution error:', err.message);
        }

        const loginKey = globalResources.getSecureConfig({ path: 'loginKey' });
        if (loginKey === null) {
            return next();
        }

        const authToken = req.query.auth || req.headers.authorization?.replace('Bearer ', '');
        if (authToken) {
            if (isApplicationKeyFormat(authToken) || isTempTokenFormat(authToken)) {
                return res.status(403).json({ error: 'Use X-StaticForge-App-Key or X-StaticForge-App-Token headers for application credentials' });
            }
            if (authToken !== loginKey) {
                return res.status(403).json({ error: 'Invalid authentication token' });
            }
            req.userType = 'admin';
            req.authMethod = 'login_key';
            if (req.session) {
                req.session.authenticated = true;
                req.session.userType = 'admin';
            }
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

function createMcpAuthMiddleware(globalResources) {
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
                return next();
            }
        } catch (err) {
            console.error('MCP application auth resolution error:', err.message);
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
    applyAuthContext
};
