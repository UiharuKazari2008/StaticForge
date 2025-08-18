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
        // For API tokens, assume admin access
        req.userType = 'admin';
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

module.exports = {
    authMiddleware,
    isReadOnlyUser,
    isAdminUser
}; 