/**
 * Public MCP facade for Grok connectors.
 * Streamable HTTP on /{mcpPathUuid}. Wraps existing /agent + WS only.
 * Auth is createMcpAuthMiddleware (per-agent sfapp_ + exact UA) — not loopback /agent.
 */

const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const { createMcpAuthMiddleware } = require('./auth');
const { scopesAllowPacket } = require('./applicationAuthManager');
const {
    dispatchAgentPacket,
    sendBoundCommand,
    listClients,
    bindClient,
    getBoundClientId,
    getBoundRecord,
    resolveStudioAutoFlags,
    coerceStudioChangeObject,
    stripStudioAutoFlagsDeep,
    studioChangePayloadWithoutFlags,
    isStudioChangePayload,
    resolveAgentPacketMessage,
    resolveAgentAuthScopes,
    agentHasNamedScope,
    buildAgentScopePayload
} = require('./agentClientBridge');

const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_RATE_WINDOW_MS = 15 * 60 * 1000;
const MCP_RATE_MAX = 120;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const MCP_CORS_ORIGINS = new Set([
    'https://grok.com',
    'https://www.grok.com',
    'https://x.ai',
    'https://console.x.ai'
]);

const TOOL_DEFS = [
    {
        name: 'generate_image',
        description: 'Server-side generate via existing WS generate_image (POST /agent/packet). Not the bound-tab Generate button.',
        scope: 'generation',
        packet: 'generate_image',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                prompt: { type: 'string' },
                uc: { type: 'string' },
                model: { type: 'string' },
                resolution: { type: 'string' },
                steps: { type: 'number' },
                guidance: { type: 'number' },
                sampler: { type: 'string' },
                workspace: { type: 'string' },
                seed: { type: ['string', 'number'] }
            }
        }
    },
    {
        name: 'get_generated_image',
        description: 'Gallery metadata (request_image_metadata) plus bytes from the existing GET /images/:filename file. Basename only.',
        scope: 'gallery',
        packet: 'request_image_metadata',
        inputSchema: {
            type: 'object',
            required: ['filename'],
            properties: {
                filename: { type: 'string', description: 'Gallery filename basename' }
            }
        }
    },
    {
        name: 'get_images',
        description: 'List gallery images via existing request_gallery packet.',
        scope: 'gallery',
        packet: 'request_gallery',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                workspaceId: { type: 'string' },
                offset: { type: 'number' },
                limit: { type: 'number' },
                viewType: { type: 'string' },
                afterCursor: { type: 'string' }
            }
        }
    },
    {
        name: 'get_workspaces',
        description: 'List workspaces via existing workspace_list packet.',
        scope: 'workspace',
        packet: 'workspace_list',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'list_clients',
        description: 'List connected Studio websocket clients (same as GET /agent/clients). Needed before public bind.',
        scope: 'generation',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'bind_session',
        description: 'Bind one connected Studio tab (same as POST /agent/bind). clientId or share code.',
        scope: 'generation',
        inputSchema: {
            type: 'object',
            properties: {
                clientId: { type: 'string' },
                code: { type: 'string' }
            }
        }
    },
    {
        name: 'apply_studio_changes',
        description: 'Apply Change-JSON on the bound tab (same as POST /agent/session/studio). autoApply/autoGenerate are siblings of change. autoGenerate clicks the existing Studio Generate button after a successful apply.',
        scope: 'generation',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                change: { type: ['object', 'string'] },
                prompt: { type: 'string' },
                uc: { type: 'string' },
                autoApply: { type: 'boolean', description: 'Default true. Silent apply on the bound tab.' },
                autoGenerate: { type: 'boolean', description: 'Default false. After apply, click bound-tab Generate.' }
            }
        }
    }
];

function isAllowedMcpOrigin(origin) {
    if (origin == null || origin === '') return true;
    return MCP_CORS_ORIGINS.has(String(origin));
}

function applyMcpCors(req, res) {
    const origin = req.headers.origin;
    if (origin && MCP_CORS_ORIGINS.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept, X-StaticForge-App-Key, Mcp-Session-Id');
        res.setHeader('Access-Control-Max-Age', '600');
    }
}

function createMcpRateLimiter() {
    return rateLimit({
        windowMs: MCP_RATE_WINDOW_MS,
        max: MCP_RATE_MAX,
        skipSuccessfulRequests: false,
        keyGenerator: (req) => {
            const keyId = req.applicationAuth && req.applicationAuth.applicationKeyId;
            return keyId ? `mcp-key:${keyId}` : `mcp-ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
        },
        handler: (req, res) => {
            res.status(429).json({
                success: false,
                error: 'Too many requests',
                code: 'RATE_LIMIT_EXCEEDED'
            });
        },
        standardHeaders: true,
        legacyHeaders: false
    });
}

function sanitizeGalleryFilename(filename) {
    const raw = String(filename || '').trim();
    if (!raw) return null;
    if (raw.includes('..') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
        return null;
    }
    return path.basename(raw);
}

function readGalleryImage(globalResources, filename) {
    const safe = sanitizeGalleryFilename(filename);
    if (!safe) {
        const err = new Error('filename must be a gallery basename');
        err.status = 400;
        throw err;
    }
    const imagesDir = path.resolve(globalResources.getPath('images'));
    const filePath = path.resolve(imagesDir, safe);
    if (!filePath.startsWith(imagesDir + path.sep) && filePath !== imagesDir) {
        const err = new Error('filename must be a gallery basename');
        err.status = 400;
        throw err;
    }
    if (!fs.existsSync(filePath)) {
        const err = new Error('Image not found');
        err.status = 404;
        throw err;
    }
    const stat = fs.statSync(filePath);
    if (stat.size > MAX_IMAGE_BYTES) {
        const err = new Error('Image exceeds MCP size limit; use GET /images/:filename with the same app key');
        err.status = 413;
        throw err;
    }
    const ext = path.extname(safe).toLowerCase();
    const mimeType = (ext === '.jpg' || ext === '.jpeg') ? 'image/jpeg' : 'image/png';
    return {
        filename: safe,
        mimeType,
        bytes: fs.readFileSync(filePath)
    };
}

function listToolsForScopes(scopes) {
    return TOOL_DEFS.filter((tool) => agentHasNamedScope(scopes, tool.scope)).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
    }));
}

function requireToolScope(scopes, scopeId) {
    if (agentHasNamedScope(scopes, scopeId)) return;
    const err = new Error('Application key does not have scope for this operation');
    err.status = 403;
    err.code = 'INSUFFICIENT_SCOPE';
    throw err;
}

async function dispatchPacketTool(globalResources, req, type, args) {
    const message = resolveAgentPacketMessage({ type, ...(args && typeof args === 'object' ? args : {}) });
    if (!message) {
        const err = new Error('type is required');
        err.status = 400;
        throw err;
    }
    if (!scopesAllowPacket(resolveAgentAuthScopes(req), message.type)) {
        const err = new Error('Application key does not have scope for this operation');
        err.status = 403;
        err.code = 'INSUFFICIENT_SCOPE';
        throw err;
    }
    const replies = await dispatchAgentPacket(globalResources, req, message);
    const first = replies[0] || null;
    return {
        success: !(first && first.type === 'error'),
        type: first && first.type ? first.type : null,
        requestId: message.requestId,
        data: first && first.data !== undefined ? first.data : null,
        reply: first,
        replies
    };
}

async function applyStudioChanges(globalResources, body) {
    if (!body || typeof body !== 'object') {
        const err = new Error('change JSON or prompt/uc fields are required');
        err.status = 400;
        throw err;
    }
    if (!body.change && body.prompt == null && body.uc == null && !isStudioChangePayload(body)) {
        const err = new Error('change JSON or prompt/uc fields are required');
        err.status = 400;
        throw err;
    }
    const { autoApply, autoGenerate } = resolveStudioAutoFlags(body);
    const changeSource = coerceStudioChangeObject(body.change) || body.change;
    return sendBoundCommand(globalResources, 'apply_studio', {
        change: stripStudioAutoFlagsDeep(changeSource) || null,
        prompt: body.prompt,
        uc: body.uc,
        payload: studioChangePayloadWithoutFlags(body),
        autoApply,
        autoGenerate
    });
}

function mcpTextResult(obj, isError) {
    return {
        content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
        isError: !!isError
    };
}

function mcpImageResult(meta, image) {
    const content = [{ type: 'text', text: JSON.stringify(meta) }];
    if (image) {
        content.push({
            type: 'image',
            mimeType: image.mimeType,
            data: image.bytes.toString('base64')
        });
    }
    return { content, isError: false };
}

async function callTool(globalResources, req, name, args) {
    const scopes = resolveAgentAuthScopes(req);
    const def = TOOL_DEFS.find((tool) => tool.name === name);
    if (!def) {
        const err = new Error(`Unknown tool: ${name}`);
        err.status = 404;
        throw err;
    }
    requireToolScope(scopes, def.scope);
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

    if (def.packet && name !== 'get_generated_image') {
        return mcpTextResult(await dispatchPacketTool(globalResources, req, def.packet, input));
    }

    if (name === 'get_generated_image') {
        const filename = sanitizeGalleryFilename(input.filename);
        if (!filename) {
            const err = new Error('filename is required');
            err.status = 400;
            throw err;
        }
        const packet = await dispatchPacketTool(globalResources, req, 'request_image_metadata', { filename });
        let image = null;
        try {
            image = readGalleryImage(globalResources, filename);
        } catch (error) {
            if (error.status === 404) {
                return mcpTextResult({ ...packet, filename, image: null, error: 'Image file not found' }, !packet.success);
            }
            throw error;
        }
        return mcpImageResult({ ...packet, filename }, image);
    }

    if (name === 'list_clients') {
        return mcpTextResult({
            success: true,
            boundClientId: getBoundClientId(),
            clients: listClients(globalResources)
        });
    }

    if (name === 'bind_session') {
        return mcpTextResult(bindClient(globalResources, {
            clientId: input.clientId || input.client_id,
            code: input.code
        }));
    }

    if (name === 'apply_studio_changes') {
        const data = await applyStudioChanges(globalResources, input);
        return mcpTextResult({ success: true, ...data });
    }

    const err = new Error(`Unknown tool: ${name}`);
    err.status = 404;
    throw err;
}

function jsonRpcError(id, code, message, status) {
    return { jsonrpc: '2.0', id: id == null ? null : id, error: { code, message, data: { status } } };
}

async function handleJsonRpc(globalResources, req, message) {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
        return { status: 400, body: jsonRpcError(null, -32600, 'Invalid Request', 400) };
    }
    const id = Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : undefined;
    const method = String(message.method || '');
    const params = message.params && typeof message.params === 'object' ? message.params : {};

    if (id === undefined && method.startsWith('notifications/')) {
        return { status: 202, body: null };
    }

    if (method === 'initialize') {
        return {
            status: 200,
            body: {
                jsonrpc: '2.0',
                id,
                result: {
                    protocolVersion: MCP_PROTOCOL_VERSION,
                    capabilities: { tools: { listChanged: false } },
                    serverInfo: { name: 'dreamscape', version: '1.0.0' }
                }
            }
        };
    }

    if (method === 'ping') {
        return { status: 200, body: { jsonrpc: '2.0', id, result: {} } };
    }

    if (method === 'tools/list') {
        const scopes = resolveAgentAuthScopes(req);
        return {
            status: 200,
            body: {
                jsonrpc: '2.0',
                id,
                result: { tools: listToolsForScopes(scopes) }
            }
        };
    }

    if (method === 'tools/call') {
        const name = String(params.name || '').trim();
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        try {
            const result = await callTool(globalResources, req, name, args);
            return { status: 200, body: { jsonrpc: '2.0', id, result } };
        } catch (error) {
            const status = error && error.status ? error.status : 500;
            const messageText = status >= 500 ? 'Tool call failed' : (error.message || 'Tool call failed');
            return {
                status: 200,
                body: {
                    jsonrpc: '2.0',
                    id,
                    result: mcpTextResult({
                        success: false,
                        error: messageText,
                        code: error && error.code ? error.code : undefined,
                        status
                    }, true)
                }
            };
        }
    }

    return { status: 200, body: jsonRpcError(id, -32601, `Method not found: ${method}`, 404) };
}

function sendMcpResponse(req, res, status, body) {
    if (status === 202 && body == null) {
        return res.status(202).end();
    }
    const accept = String(req.headers.accept || '');
    if (accept.includes('text/event-stream') && !accept.includes('application/json')) {
        res.status(status);
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-store');
        res.write(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
        return res.end();
    }
    return res.status(status).json(body);
}

function registerRoutes(app, { globalResources }) {
    const prefix = `/${globalResources.getMcpPathUuid()}`;
    const mcpAuth = createMcpAuthMiddleware(globalResources);
    const mcpLimiter = createMcpRateLimiter();

    function mcpMiddleware(req, res, next) {
        applyMcpCors(req, res);
        if (req.method === 'OPTIONS') {
            if (req.headers.origin && !isAllowedMcpOrigin(req.headers.origin)) {
                return res.status(403).json({ error: 'Origin not allowed', code: 'CORS_LOCKED' });
            }
            return res.status(204).end();
        }
        if (req.headers.origin && !isAllowedMcpOrigin(req.headers.origin)) {
            return res.status(403).json({ error: 'Origin not allowed', code: 'CORS_LOCKED' });
        }
        return next();
    }

    async function handleMcpPost(req, res) {
        try {
            const body = req.body;
            if (Array.isArray(body)) {
                const results = [];
                for (const item of body) {
                    const handled = await handleJsonRpc(globalResources, req, item);
                    if (handled.body) results.push(handled.body);
                }
                return sendMcpResponse(req, res, 200, results);
            }
            const handled = await handleJsonRpc(globalResources, req, body);
            return sendMcpResponse(req, res, handled.status, handled.body);
        } catch (error) {
            return res.status(500).json({
                jsonrpc: '2.0',
                id: null,
                error: { code: -32603, message: 'Internal error' }
            });
        }
    }

    function handleMcpGet(_req, res) {
        res.setHeader('Allow', 'POST, OPTIONS');
        return res.status(405).json({ error: 'Use POST for Streamable HTTP MCP', code: 'METHOD_NOT_ALLOWED' });
    }

    const stack = [mcpMiddleware, mcpAuth, mcpLimiter];
    app.options(prefix, mcpMiddleware);
    app.options(`${prefix}/mcp`, mcpMiddleware);
    app.get(prefix, ...stack, handleMcpGet);
    app.get(`${prefix}/mcp`, ...stack, handleMcpGet);
    app.post(prefix, ...stack, handleMcpPost);
    app.post(`${prefix}/mcp`, ...stack, handleMcpPost);
}

module.exports = {
    registerRoutes,
    _test: {
        TOOL_DEFS,
        MCP_CORS_ORIGINS,
        MCP_PROTOCOL_VERSION,
        isAllowedMcpOrigin,
        sanitizeGalleryFilename,
        listToolsForScopes,
        handleJsonRpc,
        applyStudioChanges,
        getBoundRecord
    }
};
