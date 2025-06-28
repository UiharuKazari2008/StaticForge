const fs = require('fs');
const config = require('./../config.json');

// Authentication middleware
const authMiddleware = (req, res, next) => {
    // Check if authentication is required
    if (config.loginKey === null) {
        return next();
    }
    
    // Get auth token from query parameter or header
    const authToken = req.query.auth || req.headers.authorization?.replace('Bearer ', '');
    
    if (!authToken) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    
    // Check if token matches
    if (authToken !== config.loginKey) {
        return res.status(403).json({ error: 'Invalid authentication token' });
    }
    
    next();
};

module.exports = {
    authMiddleware
}; 