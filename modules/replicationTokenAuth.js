/**
 * Replication token validation — read vs cargo-write scopes.
 * modules/replication/replicationContracts.js — REPLICATION_TOKEN_SCOPES
 */

const { REPLICATION_TOKEN_SCOPES } = require('./replication/replicationContracts');

function getTokens(config) {
    const writeToken = config && config.replicationToken ? String(config.replicationToken) : null;
    const readToken = config && config.replicationReadToken
        ? String(config.replicationReadToken)
        : writeToken;
    return { writeToken, readToken };
}

/**
 * Validate replication token for a scope.
 * When only replicationToken is set (v1), all scopes accept that token.
 * When replicationReadToken is set, read routes accept read or write token;
 * cargo-write routes require replicationToken (write scope).
 */
function validateReplicationToken(config, token, { scope = REPLICATION_TOKEN_SCOPES.READ } = {}) {
    const { writeToken, readToken } = getTokens(config);
    if (!writeToken && !readToken) {
        return true;
    }
    if (!token) {
        return false;
    }
    const normalized = String(token);
    if (scope === REPLICATION_TOKEN_SCOPES.CARGO_WRITE) {
        return !!writeToken && normalized === writeToken;
    }
    return normalized === writeToken || normalized === readToken;
}

function getReplicationTokenFromRequest(req) {
    return req.headers['x-replication-token']
        || req.body?.replicationToken
        || req.query?.replicationToken
        || req.query?.token
        || null;
}

module.exports = {
    validateReplicationToken,
    getReplicationTokenFromRequest,
    getTokens
};
