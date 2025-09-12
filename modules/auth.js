const fs = require('fs');
const config = require('./../config.json');

// Authentication middleware
const authMiddleware = (req, res, next) => {
    // Set cache control headers to prevent any caching of authenticated responses
    res.setHeader('Cache-Control', 'blocked, no-store, no-cache, must-revalidate, private, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Last-Modified', new Date().toUTCString());
    res.setHeader('ETag', `"${Date.now()}"`);
    
    // Check if authentication is required
    if (config.loginKey === null) {
        return next();
    }

    // REST API: Bearer or ?auth=...
    const authToken = req.query.auth || req.headers.authorization?.replace('Bearer ', '');
    if (authToken) {
        if (authToken !== config.loginKey) {
            return res.status(403).json({ error: 'Invalid authentication token' });
        }
        // For API tokens, assume admin access and set session
        req.userType = 'admin';
        if (req.session) {
            req.session.authenticated = true;
            req.session.userType = 'admin';
        }
        return next();
    }

    // Browser: session-based
    if (req.session && req.session.authenticated) {
        req.userType = req.session.userType || 'admin'; // Default to admin for backward compatibility
        req.sessionId = req.session.id; // Add session ID for per-session workspace management
        return next();
    }

    // Not authenticated
    return res.status(401).json({ error: 'Authentication required' });
};

// Helper function to check if user is read-only
const isReadOnlyUser = (req) => {
    return req.userType === 'readonly';
};

// Helper function to check if user is admin
const isAdminUser = (req) => {
    return req.userType === 'admin';
};

// Development-specific authentication middleware
const devAuthMiddleware = (req, res, next) => {
    // Set cache control headers to prevent any caching of authenticated responses
    res.setHeader('Cache-Control', 'blocked, no-store, no-cache, must-revalidate, private, max-age=0');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Last-Modified', new Date().toUTCString());
    res.setHeader('ETag', `"${Date.now()}"`);
    
    // Check if development mode is enabled
    if (!config.enable_dev) {
        return res.status(404).json({ error: 'Development mode not enabled' });
    }
    
    // Check if dev login key is configured
    if (!config.devLoginKey) {
        return res.status(500).json({ error: 'Development login key not configured' });
    }

    // REST API: Bearer or ?auth=...
    const authToken = req.query.auth || req.headers.authorization?.replace('Bearer ', '');
    if (authToken) {
        if (authToken !== config.devLoginKey) {
            return res.status(403).json({ error: 'Invalid development authentication token' });
        }
        // For dev API tokens, set as dev admin
        req.userType = 'dev_admin';
        if (req.session) {
            req.session.authenticated = true;
            req.session.userType = 'dev_admin';
        }
        return next();
    }

    // Browser: session-based (check both regular admin and dev admin)
    if (req.session && req.session.authenticated) {
        if (req.session.userType === 'admin' || req.session.userType === 'dev_admin') {
            req.userType = req.session.userType;
            req.sessionId = req.session.id;
            return next();
        }
    }

    // Not authenticated
    return res.status(401).json({ error: 'Development authentication required' });
};

module.exports = {
    authMiddleware,
    devAuthMiddleware,
    isReadOnlyUser,
    isAdminUser
}; 