/**
 * MCP rate limiter extracted from mcpAgentFacade.js
 */

const { ipKeyGenerator } = require('express-rate-limit');

// Copied as-is from mcpAgentFacade.js (required by extracted bytes)
const MCP_RATE_WINDOW_MS = 15 * 60 * 1000;
const ADVANCED_TOOL_NAME = 'advanced_tools';

function mcpTextResult(obj, isError) {
    return {
        content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj) }],
        isError: !!isError
    };
}

function mcpMethodFromReq(req) {
    const body = req && req.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return '';
    return String(body.method || '');
}

function isCheapMcpRequest(req) {
    const method = mcpMethodFromReq(req);
    return method === 'ping'
        || method === 'initialize'
        || method === 'tools/list'
        || method.startsWith('notifications/');
}

const MCP_RATE_GROUP_LIMITS = {
    free: { max: 0, windowMs: MCP_RATE_WINDOW_MS },
    search: { max: 240, windowMs: MCP_RATE_WINDOW_MS },
    gallery: { max: 90, windowMs: MCP_RATE_WINDOW_MS },
    write: { max: 60, windowMs: MCP_RATE_WINDOW_MS },
    studio: { max: 60, windowMs: MCP_RATE_WINDOW_MS },
    generate: { max: 20, windowMs: MCP_RATE_WINDOW_MS },
    rpc: { max: 300, windowMs: MCP_RATE_WINDOW_MS }
};

const TOOL_RATE_GROUPS = {
    advanced_tools: 'free',
    get_workspaces: 'free',
    list_clients: 'free',
    bind_session: 'free',
    list_notes: 'free',
    list_notes_by_workspace: 'free',
    get_note: 'free',
    list_presets: 'free',
    search_presets: 'free',
    get_preset: 'free',
    list_static_wiki_sites: 'free',
    list_static_wiki_pages: 'free',
    list_references: 'free',
    list_workspace_references: 'free',
    get_references_by_ids: 'free',
    search_autofill: 'search',
    search_nax: 'search',
    list_nax_galleries: 'free',
    search_wiki: 'search',
    get_wiki_page: 'search',
    search_static_wiki: 'search',
    get_static_wiki_page: 'search',
    omegasearch: 'search',
    get_images: 'gallery',
    get_generated_image: 'gallery',
    get_latest_image: 'gallery',
    create_note: 'write',
    update_note: 'write',
    save_note_content: 'write',
    save_preset: 'write',
    upload_reference: 'write',
    get_studio_state: 'studio',
    get_open_windows: 'studio',
    get_session_state: 'studio',
    get_prompt_guide: 'free',
    list_memories: 'free',
    listKnowledgeMemories: 'free',
    search_memories: 'search',
    searchKnowledgeMemories: 'search',
    get_memory: 'free',
    retrieveKnowledgeMemory: 'free',
    save_memory: 'write',
    saveKnowledgeMemory: 'write',
    get_client_physics: 'studio',
    apply_studio_changes: 'studio',
    apply_preset_to_studio: 'studio',
    get_linkxi_persona: 'free',
    save_linkxi_persona: 'write',
    generate_image: 'generate',
    get_generation_job: 'free',
    await_generation_job: 'free',
    generate_preset: 'generate',
    upscale_image: 'generate',
    expand_image: 'generate',
    delete_images: 'write',
    scrap_images: 'write',
    toggle_favorite: 'write',
    open_in_lumen: 'free',
    open_in_glancewell: 'free',
    compare_images: 'gallery',
    evaluate_workspace_themes: 'search',
    vfs_list: 'free',
    vfs_read: 'gallery',
    vfs_stat: 'free',
    vfs_write: 'write',
    vfs_delete: 'write',
    list_desktop_items: 'free'
};

const rateGroupHits = new Map();

function rateGroupForTool(name) {
    return TOOL_RATE_GROUPS[name] || 'rpc';
}

function rateGroupForCall(name, args) {
    if (name === ADVANCED_TOOL_NAME) {
        const target = args && (args.name || args.tool);
        const runName = String(target || '').trim();
        if (runName && runName !== ADVANCED_TOOL_NAME) {
            return rateGroupForTool(runName);
        }
        return 'free';
    }
    return rateGroupForTool(name);
}

function consumeRateGroup(keyId, groupId, now = Date.now()) {
    const spec = MCP_RATE_GROUP_LIMITS[groupId] || MCP_RATE_GROUP_LIMITS.rpc;
    if (!spec.max) {
        return { ok: true, group: groupId, unlimited: true };
    }
    const mapKey = `${keyId}:${groupId}`;
    let row = rateGroupHits.get(mapKey);
    if (!row || row.resetAt <= now) {
        row = { count: 0, resetAt: now + spec.windowMs };
    }
    if (row.count >= spec.max) {
        const retryAfterSec = Math.max(1, Math.ceil((row.resetAt - now) / 1000));
        return {
            ok: false,
            group: groupId,
            retryAfterSec,
            retryAfterMs: retryAfterSec * 1000,
            limit: spec.max,
            windowMs: spec.windowMs
        };
    }
    row.count += 1;
    rateGroupHits.set(mapKey, row);
    return {
        ok: true,
        group: groupId,
        remaining: spec.max - row.count,
        retryAfterSec: Math.max(1, Math.ceil((row.resetAt - now) / 1000)),
        limit: spec.max,
        windowMs: spec.windowMs
    };
}

function resetRateGroupHits() {
    rateGroupHits.clear();
}

function rateLimitPrincipal(req) {
    const keyId = req.applicationAuth && req.applicationAuth.applicationKeyId;
    if (keyId) return `mcp-key:${keyId}`;
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    return `mcp-ip:${ipKeyGenerator(ip)}`;
}

function sendRateLimitResponse(req, res, denied) {
    const retryAfterSec = denied.retryAfterSec;
    res.setHeader('Retry-After', String(retryAfterSec));
    res.setHeader('X-RateLimit-Group', denied.group);
    res.setHeader('X-RateLimit-Limit', String(denied.limit));
    res.setHeader('X-RateLimit-Remaining', '0');
    const id = req.body && !Array.isArray(req.body) && Object.prototype.hasOwnProperty.call(req.body, 'id')
        ? req.body.id
        : null;
    return res.status(429).json({
        jsonrpc: '2.0',
        id,
        error: {
            code: -32000,
            message: `Rate limited (${denied.group}). Retry in ${retryAfterSec} seconds.`,
            data: {
                code: 'RATE_LIMIT_EXCEEDED',
                group: denied.group,
                retryAfter: retryAfterSec,
                retryAfterMs: denied.retryAfterMs,
                limit: denied.limit,
                windowMs: denied.windowMs
            }
        }
    });
}

function createMcpRateLimiter() {
    return function mcpGroupedRateLimit(req, res, next) {
        if (isCheapMcpRequest(req)) return next();
        const method = mcpMethodFromReq(req);
        let groupId = 'rpc';
        if (method === 'tools/call') {
            const params = req.body && req.body.params ? req.body.params : {};
            const name = String(params.name || '').trim();
            const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
            groupId = rateGroupForCall(name, args);
        }
        const denied = consumeRateGroup(rateLimitPrincipal(req), groupId);
        if (denied.ok) return next();
        if (method === 'tools/call') {
            const retryAfterSec = denied.retryAfterSec;
            res.setHeader('Retry-After', String(retryAfterSec));
            res.setHeader('X-RateLimit-Group', denied.group);
            res.setHeader('X-RateLimit-Limit', String(denied.limit));
            const id = req.body && !Array.isArray(req.body) && Object.prototype.hasOwnProperty.call(req.body, 'id')
                ? req.body.id
                : null;
            return res.status(200).json({
                jsonrpc: '2.0',
                id,
                result: mcpTextResult({
                    success: false,
                    error: `Rate limited (${denied.group}). Retry in ${retryAfterSec} seconds.`,
                    code: 'RATE_LIMIT_EXCEEDED',
                    group: denied.group,
                    retryAfter: retryAfterSec,
                    retryAfterMs: denied.retryAfterMs,
                    limit: denied.limit,
                    windowMs: denied.windowMs
                }, true)
            });
        }
        return sendRateLimitResponse(req, res, denied);
    };
}

module.exports = {
    MCP_RATE_WINDOW_MS,
    mcpMethodFromReq,
    isCheapMcpRequest,
    MCP_RATE_GROUP_LIMITS,
    TOOL_RATE_GROUPS,
    rateGroupForTool,
    rateGroupForCall,
    consumeRateGroup,
    resetRateGroupHits,
    rateLimitPrincipal,
    sendRateLimitResponse,
    createMcpRateLimiter
};
