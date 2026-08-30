/**
 * OAuth 2.1 + PKCE provider for MCP Grok connector.
 * Tokens are bound to existing sfapp_ application keys (not a new principal).
 * Endpoints stay under /{mcpPathUuid}/oauth/* to remain unlisted.
 * Well-known metadata at domain root points at UUID endpoints.
 */

const crypto = require('crypto');

const APP_KEY_PREFIX = 'sfapp_';

function isApplicationKeyFormat(token) {
    return typeof token === 'string' && token.startsWith(APP_KEY_PREFIX);
}

function parseScopesJson(raw) {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : ['universal'];
    } catch (_) {
        return ['universal'];
    }
}

function getDb() {
    // Lazy load to avoid loading native modules at import time
    // applicationAuthDatabase.js
    return require('./applicationAuthDatabase').getDb();
}

const OAUTH_ACCESS_TOKEN_PREFIX = 'mcoat_';
const OAUTH_REFRESH_TOKEN_PREFIX = 'mcort_';
const OAUTH_CODE_TTL_SECONDS = 300;
const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 3600;
const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 86400 * 30;

const ALLOWED_REDIRECT_URI_HOSTS = new Set([
    'grok.com',
    'www.grok.com',
    'x.ai',
    'console.x.ai',
    '127.0.0.1',
    'localhost'
]);

function hashSecret(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateOAuthCode() {
    return crypto.randomBytes(32).toString('base64url');
}

function generateOAuthAccessToken() {
    return OAUTH_ACCESS_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function generateOAuthRefreshToken() {
    return OAUTH_REFRESH_TOKEN_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function generateClientId() {
    return 'mcp_' + crypto.randomBytes(16).toString('base64url');
}

function isOAuthAccessTokenFormat(token) {
    return typeof token === 'string' && token.startsWith(OAUTH_ACCESS_TOKEN_PREFIX);
}

function isOAuthRefreshTokenFormat(token) {
    return typeof token === 'string' && token.startsWith(OAUTH_REFRESH_TOKEN_PREFIX);
}

function validateRedirectUri(uri) {
    try {
        const parsed = new URL(uri);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
            return { valid: false, error: 'redirect_uri must use http or https' };
        }
        if (parsed.protocol === 'http:' && parsed.hostname !== '127.0.0.1' && parsed.hostname !== 'localhost') {
            return { valid: false, error: 'http redirect_uri only allowed for localhost' };
        }
        if (!ALLOWED_REDIRECT_URI_HOSTS.has(parsed.hostname)) {
            return { valid: false, error: 'redirect_uri host not allowed' };
        }
        return { valid: true };
    } catch (_) {
        return { valid: false, error: 'Invalid redirect_uri format' };
    }
}

function verifyPkceChallenge(verifier, challenge) {
    const computed = crypto.createHash('sha256')
        .update(verifier, 'ascii')
        .digest('base64url');
    return computed === challenge;
}

function parseScopes(scopeString) {
    if (!scopeString) return [];
    return String(scopeString).split(/\s+/).filter(Boolean);
}

class McpOAuthProvider {
    constructor(globalResources) {
        this.globalResources = globalResources;
    }

    getMcpBaseUrl() {
        const publicHost = this.globalResources.getConfig({ path: 'public_hostname' }) || 'localhost:9220';
        const protocol = publicHost.startsWith('localhost') || publicHost.startsWith('127.0.0.1') ? 'http' : 'https';
        return `${protocol}://${publicHost}`;
    }

    getMcpPathUuid() {
        return this.globalResources.getMcpPathUuid();
    }

    getOAuthEndpointPrefix() {
        return `/${this.getMcpPathUuid()}/oauth`;
    }

    getProtectedResourceMetadata() {
        const baseUrl = this.getMcpBaseUrl();
        const mcpPathUuid = this.getMcpPathUuid();
        return {
            resource: `${baseUrl}/${mcpPathUuid}`,
            authorization_servers: [baseUrl],
            scopes_supported: [
                'generation', 'gallery', 'workspace', 'search',
                'vfs', 'presets', 'chat', 'references', 'wiki', 'autofill'
            ],
            bearer_methods_supported: ['header'],
            resource_name: 'Dreamscape MCP Server'
        };
    }

    getAuthorizationServerMetadata() {
        const baseUrl = this.getMcpBaseUrl();
        const prefix = this.getOAuthEndpointPrefix();
        return {
            issuer: baseUrl,
            authorization_endpoint: `${baseUrl}${prefix}/authorize`,
            token_endpoint: `${baseUrl}${prefix}/token`,
            registration_endpoint: `${baseUrl}${prefix}/register`,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            token_endpoint_auth_methods_supported: ['none'],
            code_challenge_methods_supported: ['S256'],
            scopes_supported: [
                'generation', 'gallery', 'workspace', 'search',
                'vfs', 'presets', 'chat', 'references', 'wiki', 'autofill'
            ],
            service_documentation: `${baseUrl}/docs/client-api/mcp-connector.md`
        };
    }

    async registerClient({ applicationKey, clientName, redirectUris }) {
        const manager = this.globalResources.getApplicationAuthManager();
        const validation = await manager.validateApplicationKey(applicationKey, '', {
            allowRefreshOverdue: false,
            skipUserAgent: true
        });
        if (!validation.valid) {
            return { success: false, error: validation.message, code: validation.code };
        }

        if (!Array.isArray(redirectUris) || redirectUris.length === 0) {
            return { success: false, error: 'redirect_uris required', code: 'INVALID_REDIRECT_URI' };
        }
        for (const uri of redirectUris) {
            const v = validateRedirectUri(uri);
            if (!v.valid) {
                return { success: false, error: v.error, code: 'INVALID_REDIRECT_URI' };
            }
        }

        const clientId = generateClientId();
        const nowSec = Math.floor(Date.now() / 1000);

        await getDb().run(
            `INSERT INTO oauth_clients
             (client_id, application_key_id, client_name, redirect_uris, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [clientId, validation.applicationKeyId, clientName || 'MCP Client', JSON.stringify(redirectUris), nowSec]
        );

        return {
            success: true,
            client_id: clientId,
            client_name: clientName || 'MCP Client',
            redirect_uris: redirectUris,
            token_endpoint_auth_method: 'none',
            grant_types: ['authorization_code', 'refresh_token'],
            response_types: ['code']
        };
    }

    async getClientByIdAndAppKey(clientId, applicationKeyId) {
        const row = await getDb().get(
            `SELECT * FROM oauth_clients WHERE client_id = ? AND application_key_id = ?`,
            [clientId, applicationKeyId]
        );
        if (!row) return null;
        return {
            clientId: row.client_id,
            applicationKeyId: row.application_key_id,
            clientName: row.client_name,
            redirectUris: JSON.parse(row.redirect_uris || '[]')
        };
    }

    async getClientById(clientId) {
        const row = await getDb().get(
            `SELECT * FROM oauth_clients WHERE client_id = ?`,
            [clientId]
        );
        if (!row) return null;
        return {
            clientId: row.client_id,
            applicationKeyId: row.application_key_id,
            clientName: row.client_name,
            redirectUris: JSON.parse(row.redirect_uris || '[]')
        };
    }

    async getAppKeyScopes(applicationKeyId) {
        const row = await getDb().get(
            `SELECT scopes FROM application_keys WHERE id = ? AND status = 'active' AND revoked_at IS NULL`,
            [applicationKeyId]
        );
        if (!row) return null;
        return parseScopesJson(row.scopes);
    }

    async createAuthorizationCode({ clientId, applicationKeyId, redirectUri, scopes, codeChallenge, codeChallengeMethod, resource }) {
        const code = generateOAuthCode();
        const codeHash = hashSecret(code);
        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAt = nowSec + OAUTH_CODE_TTL_SECONDS;

        await getDb().run(
            `INSERT INTO oauth_authorization_codes
             (code_hash, client_id, application_key_id, redirect_uri, scopes, code_challenge, code_challenge_method, resource, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [codeHash, clientId, applicationKeyId, redirectUri, JSON.stringify(scopes), codeChallenge, codeChallengeMethod || 'S256', resource || null, expiresAt, nowSec]
        );

        return code;
    }

    async exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier, resource }) {
        const codeHash = hashSecret(code);
        const nowSec = Math.floor(Date.now() / 1000);

        const row = await getDb().get(
            `SELECT * FROM oauth_authorization_codes
             WHERE code_hash = ? AND client_id = ? AND redirect_uri = ? AND expires_at > ? AND used_at IS NULL`,
            [codeHash, clientId, redirectUri, nowSec]
        );

        if (!row) {
            return { success: false, error: 'invalid_grant', error_description: 'Invalid or expired authorization code' };
        }

        if (!verifyPkceChallenge(codeVerifier, row.code_challenge)) {
            return { success: false, error: 'invalid_grant', error_description: 'PKCE verification failed' };
        }

        if (resource && row.resource && resource !== row.resource) {
            return { success: false, error: 'invalid_grant', error_description: 'Resource mismatch' };
        }

        await getDb().run(
            `UPDATE oauth_authorization_codes SET used_at = ? WHERE code_hash = ?`,
            [nowSec, codeHash]
        );

        const keyScopes = await this.getAppKeyScopes(row.application_key_id);
        if (!keyScopes) {
            return { success: false, error: 'invalid_grant', error_description: 'Application key no longer valid' };
        }

        const requestedScopes = JSON.parse(row.scopes || '[]');
        const grantedScopes = keyScopes.includes('universal')
            ? requestedScopes
            : requestedScopes.filter(s => keyScopes.includes(s));

        const accessToken = generateOAuthAccessToken();
        const refreshToken = generateOAuthRefreshToken();
        const accessTokenHash = hashSecret(accessToken);
        const refreshTokenHash = hashSecret(refreshToken);
        const accessExpiresAt = nowSec + OAUTH_ACCESS_TOKEN_TTL_SECONDS;

        await getDb().run(
            `INSERT INTO oauth_access_tokens
             (token_hash, client_id, application_key_id, scopes, resource, expires_at, refresh_token_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [accessTokenHash, clientId, row.application_key_id, JSON.stringify(grantedScopes), row.resource || null, accessExpiresAt, refreshTokenHash, nowSec]
        );

        return {
            success: true,
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            refresh_token: refreshToken,
            scope: grantedScopes.join(' ')
        };
    }

    async refreshAccessToken({ refreshToken, clientId, scope }) {
        const refreshTokenHash = hashSecret(refreshToken);
        const nowSec = Math.floor(Date.now() / 1000);

        const row = await getDb().get(
            `SELECT * FROM oauth_access_tokens
             WHERE refresh_token_hash = ? AND client_id = ? AND revoked_at IS NULL`,
            [refreshTokenHash, clientId]
        );

        if (!row) {
            return { success: false, error: 'invalid_grant', error_description: 'Invalid refresh token' };
        }

        const keyScopes = await this.getAppKeyScopes(row.application_key_id);
        if (!keyScopes) {
            return { success: false, error: 'invalid_grant', error_description: 'Application key no longer valid' };
        }

        const currentScopes = JSON.parse(row.scopes || '[]');
        let grantedScopes = currentScopes;
        if (scope) {
            const requestedScopes = parseScopes(scope);
            grantedScopes = requestedScopes.filter(s => currentScopes.includes(s));
        }

        await getDb().run(
            `UPDATE oauth_access_tokens SET revoked_at = ? WHERE token_hash = ?`,
            [nowSec, row.token_hash]
        );

        const newAccessToken = generateOAuthAccessToken();
        const newRefreshToken = generateOAuthRefreshToken();
        const newAccessTokenHash = hashSecret(newAccessToken);
        const newRefreshTokenHash = hashSecret(newRefreshToken);
        const accessExpiresAt = nowSec + OAUTH_ACCESS_TOKEN_TTL_SECONDS;

        await getDb().run(
            `INSERT INTO oauth_access_tokens
             (token_hash, client_id, application_key_id, scopes, resource, expires_at, refresh_token_hash, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [newAccessTokenHash, clientId, row.application_key_id, JSON.stringify(grantedScopes), row.resource || null, accessExpiresAt, newRefreshTokenHash, nowSec]
        );

        return {
            success: true,
            access_token: newAccessToken,
            token_type: 'Bearer',
            expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
            refresh_token: newRefreshToken,
            scope: grantedScopes.join(' ')
        };
    }

    async validateAccessToken(accessToken) {
        if (!isOAuthAccessTokenFormat(accessToken)) {
            return { valid: false, code: 'INVALID_TOKEN_FORMAT' };
        }

        const tokenHash = hashSecret(accessToken);
        const nowSec = Math.floor(Date.now() / 1000);

        const row = await getDb().get(
            `SELECT t.*, k.user_type, k.app_name
             FROM oauth_access_tokens t
             JOIN application_keys k ON k.id = t.application_key_id
             WHERE t.token_hash = ? AND t.expires_at > ? AND t.revoked_at IS NULL
               AND k.status = 'active' AND k.revoked_at IS NULL`,
            [tokenHash, nowSec]
        );

        if (!row) {
            return { valid: false, code: 'INVALID_TOKEN' };
        }

        const keyScopes = await this.getAppKeyScopes(row.application_key_id);
        if (!keyScopes) {
            return { valid: false, code: 'KEY_INVALID' };
        }

        return {
            valid: true,
            userType: row.user_type || 'admin',
            scopes: JSON.parse(row.scopes || '[]'),
            applicationKeyId: row.application_key_id,
            clientId: row.client_id,
            resource: row.resource,
            expiresAt: row.expires_at * 1000
        };
    }

    async revokeAccessToken(accessToken) {
        const tokenHash = hashSecret(accessToken);
        const nowSec = Math.floor(Date.now() / 1000);
        const result = await getDb().run(
            `UPDATE oauth_access_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
            [nowSec, tokenHash]
        );
        return { success: (result?.changes || 0) > 0 };
    }

    async cleanupExpiredCodes() {
        const nowSec = Math.floor(Date.now() / 1000);
        await getDb().run(
            `DELETE FROM oauth_authorization_codes WHERE expires_at < ? OR used_at IS NOT NULL`,
            [nowSec - 86400]
        );
    }
}

module.exports = {
    McpOAuthProvider,
    OAUTH_ACCESS_TOKEN_PREFIX,
    OAUTH_REFRESH_TOKEN_PREFIX,
    isOAuthAccessTokenFormat,
    isOAuthRefreshTokenFormat,
    isApplicationKeyFormat,
    validateRedirectUri,
    verifyPkceChallenge,
    parseScopes,
    ALLOWED_REDIRECT_URI_HOSTS
};
