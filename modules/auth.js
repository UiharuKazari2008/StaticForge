const fs = require('fs');
const config = require('./../config.json');

// Authentication middleware
const authMiddleware = (req, res, next) => {
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
        return next();
    }

    // Browser: session-based
    if (req.session && req.session.authenticated) {
        return next();
    }

    // Not authenticated
    return res.status(401).json({ error: 'Authentication required' });
};

module.exports = {
    authMiddleware
}; 