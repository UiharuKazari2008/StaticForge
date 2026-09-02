/**
 * MCP CORS helpers extracted from mcpAgentFacade.js
 */

const MCP_CORS_ORIGINS = new Set([
    'https://grok.com',
    'https://www.grok.com',
    'https://x.ai',
    'https://console.x.ai'
]);

const OAUTH_CORS_ORIGINS = new Set([
    ...MCP_CORS_ORIGINS,
    'https://cursor.com',
    'https://www.cursor.com'
]);

function isAbsentOrigin(origin) {
    return origin == null || origin === '' || String(origin).toLowerCase() === 'null';
}

function isAllowedMcpOrigin(origin) {
    if (origin == null || origin === '') return true;
    return MCP_CORS_ORIGINS.has(String(origin));
}

function isLoopbackBrowserOrigin(origin) {
    try {
        const parsed = new URL(origin);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:')
            && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost');
    } catch (_) {
        return false;
    }
}

function requestSelfOrigin(req) {
    const host = typeof req.get === 'function' ? req.get('host') : req.headers?.host;
    if (!host) return null;
    const proto = req.protocol || 'http';
    return `${proto}://${host}`;
}

function isSameOriginDocumentPost(req) {
    const dest = String(req?.headers?.['sec-fetch-dest'] || '');
    const mode = String(req?.headers?.['sec-fetch-mode'] || '');
    const site = String(req?.headers?.['sec-fetch-site'] || '');
    return dest === 'document' && mode === 'navigate' && (site === 'same-origin' || site === 'none');
}

function isAllowedOAuthOrigin(origin, req, provider) {
    if (isAbsentOrigin(origin)) return true;
    if (req && isSameOriginDocumentPost(req)) return true;
    const value = String(origin);
    if (MCP_CORS_ORIGINS.has(value) || OAUTH_CORS_ORIGINS.has(value)) return true;
    if (isLoopbackBrowserOrigin(value)) return true;
    if (provider && value === provider.getMcpBaseUrl()) return true;
    const selfOrigin = req ? requestSelfOrigin(req) : null;
    return !!(selfOrigin && value === selfOrigin);
}

function applyCorsHeaders(req, res, allowed) {
    const origin = req.headers.origin;
    if (origin && allowed) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-StaticForge-App-Key, Mcp-Session-Id');
        res.setHeader('Access-Control-Max-Age', '600');
    }
}

function applyMcpCors(req, res) {
    applyCorsHeaders(req, res, isAllowedMcpOrigin(req.headers.origin));
}

function applyOAuthCors(req, res, provider) {
    applyCorsHeaders(req, res, isAllowedOAuthOrigin(req.headers.origin, req, provider));
}

module.exports = {
    MCP_CORS_ORIGINS,
    OAUTH_CORS_ORIGINS,
    isAbsentOrigin,
    isAllowedMcpOrigin,
    isLoopbackBrowserOrigin,
    requestSelfOrigin,
    isSameOriginDocumentPost,
    isAllowedOAuthOrigin,
    applyCorsHeaders,
    applyMcpCors,
    applyOAuthCors
};
