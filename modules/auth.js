const fs = require('fs');

function createAuthMiddleware(globalResources) {
    return (req, res, next) => {
        res.setHeader('Cache-Control', 'blocked, no-store, no-cache, must-revalidate, private, max-age=0');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.setHeader('Last-Modified', new Date().toUTCString());
        res.setHeader('ETag', `"${Date.now()}"`);

        const loginKey = globalResources.getConfig({ path: 'loginKey' });
        if (loginKey === null) {
            return next();
        }

        const authToken = req.query.auth || req.headers.authorization?.replace('Bearer ', '');
        if (authToken) {
            if (authToken !== loginKey) {
                return res.status(403).json({ error: 'Invalid authentication token' });
            }
            req.userType = 'admin';
            if (req.session) {
                req.session.authenticated = true;
                req.session.userType = 'admin';
            }
            return next();
        }

        if (req.session && req.session.authenticated) {
            req.userType = req.session.userType || 'admin';
            req.sessionId = req.session.id;
            return next();
        }

        return res.status(401).json({ error: 'Authentication required' });
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
    createDevAuthMiddleware,
    isReadOnlyUser,
    isAdminUser
};
