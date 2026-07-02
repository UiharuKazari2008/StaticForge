const fs = require('fs');
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

async function resolveApplicationAuth(req, globalResources) {
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
        const result = await manager.validateApplicationKey(extracted.token, userAgent);
        if (!result.valid) {
            return { rejected: true, status: 403, body: { error: result.message, code: result.code } };
        }
        return {
            userType: result.userType,
            authMethod: 'application_key',
            applicationKeyId: result.applicationKeyId,
            applicationScopes: result.scopes,
            applicationUserAgent: userAgent,
            sessionId: `appkey:${result.applicationKeyId}`
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

        const loginKey = globalResources.getConfig({ path: 'loginKey' });
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

function createDevAuthMiddleware(globalResources) {
    return (req, res, next) => {
        res.setHeader('Cache-Control', 'blocked, no-store, no-cache, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Last-Modified', new Date().toUTCString());
        res.setHeader('ETag', `"${Date.now()}"`);

        const enableDev = globalResources.getConfig({ path: 'enable_dev' });
        if (!enableDev) {
            return res.status(404).json({ error: 'Development mode not enabled' });
        }

        const devLoginKey = globalResources.getSecureConfig({ path: 'devLoginKey' });
        if (!devLoginKey) {
            return res.status(500).json({ error: 'Development login key not configured' });
        }

        const authToken = req.query.auth || req.headers.authorization?.replace('Bearer ', '');
        if (authToken) {
            if (authToken !== devLoginKey) {
                return res.status(403).json({ error: 'Invalid development authentication token' });
            }
            req.userType = 'dev_admin';
            if (req.session) {
                req.session.authenticated = true;
                req.session.userType = 'dev_admin';
            }
            return next();
        }

        if (req.session && req.session.authenticated) {
            if (req.session.userType === 'admin' || req.session.userType === 'dev_admin') {
                req.userType = req.session.userType;
                req.sessionId = req.session.id;
                return next();
            }
        }

        return res.status(401).json({ error: 'Development authentication required' });
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
    createDevAuthMiddleware,
    isReadOnlyUser,
    isAdminUser,
    resolveApplicationAuth,
    applyAuthContext
};
