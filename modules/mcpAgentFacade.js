/**
 * Public MCP facade for Grok connectors.
 * Streamable HTTP on /{mcpPathUuid}. Wraps existing /agent + WS only.
 * Auth is createMcpAuthMiddleware (per-agent sfapp_ + exact UA + OAuth 2.1) — not loopback /agent.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { createMcpAuthMiddleware } = require('./auth');
const { McpOAuthProvider } = require('./mcpOAuthProvider');
const { createOAuthRoutes } = require('./mcpOAuthRoutes');
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
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const GROK_IMAGE_MAX_EDGE = 1280;
const GROK_IMAGE_MAX_BYTES = 3 * 1024 * 1024;

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
        description: 'Known gallery filename → NovelAI metadata plus a Grok-sized webp (fit-inside resize of the original, never the full PNG). Pass filename only. Do not page get_images. Set full=true only if you need the original bytes.',
        scope: 'gallery',
        packet: 'request_image_metadata',
        inputSchema: {
            type: 'object',
            required: ['filename'],
            properties: {
                filename: { type: 'string', description: 'Gallery filename basename' },
                full: { type: 'boolean', description: 'Return original PNG when under the MCP size cap. Default false (always resize for Grok).' }
            }
        }
    },
    {
        name: 'get_images',
        description: 'Paged gallery list via request_gallery. Do not use this to find a known filename — call get_generated_image with that basename.',
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
        name: 'get_studio_state',
        description: 'Snapshot the bound Studio tab (same as GET /agent/session/state): current change JSON, open filename, model, workspace. Bind first. Do not page the gallery for the open prompt.',
        scope: 'generation',
        inputSchema: { type: 'object', properties: {} }
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
    },
    {
        name: 'search_autofill',
        description: 'Run the live autocomplete / SmartText search for one query or a set of terms. Wraps test_autofill_ranking (same searchCharacters pipeline). Returns characters, tags, text replacements, and spellcheck per term.',
        scope: 'autofill',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                terms: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Search terms to run (max 20). Prefer this when Grok has a list.'
                },
                query: { type: 'string', description: 'Single term; merged with terms if both sent' },
                model: { type: 'string', description: 'Optional model hint, default v4_5' }
            }
        }
    },
    {
        name: 'search_wiki',
        description: 'Search tag wiki titles (local, optional online). Wraps search_tag_wiki.',
        scope: 'wiki',
        packet: 'search_tag_wiki',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['query'],
            properties: {
                query: { type: 'string' },
                category: { type: ['string', 'number'] },
                searchType: { type: 'string', description: 'name (default) or description' },
                source: { type: 'string', description: 'both | danbooru | e621' },
                includeOnline: { type: 'boolean' },
                limit: { type: 'number' }
            }
        }
    },
    {
        name: 'get_wiki_page',
        description: 'Read a tag wiki page (HTML or markdown). Wraps get_tag_wiki_page. Pass tagName from search_wiki.',
        scope: 'wiki',
        packet: 'get_tag_wiki_page',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['tagName'],
            properties: {
                tagName: { type: 'string' },
                source: { type: 'string', description: 'danbooru | e621 | both' },
                format: { type: 'string', description: 'html (default) or markdown' }
            }
        }
    },
    {
        name: 'list_static_wiki_sites',
        description: 'List cached static / Grimoire wiki sites. Same data as get_wiki_home.',
        scope: 'wiki',
        packet: 'get_wiki_home',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    },
    {
        name: 'list_static_wiki_pages',
        description: 'List pages in a static wiki site (grouped). Wraps get_static_wiki_site_index.',
        scope: 'wiki',
        packet: 'get_static_wiki_site_index',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['siteId'],
            properties: {
                siteId: { type: 'string', description: 'Site id from list_static_wiki_sites' }
            }
        }
    },
    {
        name: 'search_static_wiki',
        description: 'Substring search of static wiki page titles/ids from existing site indexes. Optional siteId limits to one site.',
        scope: 'wiki',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            required: ['query'],
            properties: {
                query: { type: 'string' },
                siteId: { type: 'string' },
                limit: { type: 'number', description: 'Default 50, max 200' }
            }
        }
    },
    {
        name: 'get_static_wiki_page',
        description: 'Read a static / Grimoire wiki page HTML. Wraps get_static_wiki_page.',
        scope: 'wiki',
        packet: 'get_static_wiki_page',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['siteId', 'pageId'],
            properties: {
                siteId: { type: 'string' },
                pageId: { type: 'string' }
            }
        }
    },
    {
        name: 'list_presets',
        description: 'List saved presets (paginated). Wraps get_presets.',
        scope: 'presets',
        packet: 'get_presets',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                page: { type: 'number' },
                itemsPerPage: { type: 'number' },
                searchTerm: { type: 'string' }
            }
        }
    },
    {
        name: 'search_presets',
        description: 'Search presets by name/prompt. Wraps search_presets.',
        scope: 'presets',
        packet: 'search_presets',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['query'],
            properties: { query: { type: 'string' } }
        }
    },
    {
        name: 'get_preset',
        description: 'Load one preset by name or uuid. Wraps load_preset.',
        scope: 'presets',
        packet: 'load_preset',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                presetName: { type: 'string' },
                presetUuid: { type: 'string' }
            }
        }
    },
    {
        name: 'save_preset',
        description: 'Create or overwrite a preset. Wraps save_preset. Requires name, prompt, and model on config.',
        scope: 'presets',
        packet: 'save_preset',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['presetName', 'config'],
            properties: {
                presetName: { type: 'string' },
                config: { type: 'object' }
            }
        }
    },
    {
        name: 'apply_preset_to_studio',
        description: 'Load a preset and apply it as Change-JSON on the bound Studio tab. Same apply_studio path as apply_studio_changes. Bind required.',
        scope: 'presets',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                presetName: { type: 'string' },
                presetUuid: { type: 'string' },
                autoApply: { type: 'boolean' },
                autoGenerate: { type: 'boolean' }
            }
        }
    },
    {
        name: 'generate_preset',
        description: 'Generate an image from a saved preset (server generate_preset, not bound-tab Generate). Requires generation scope.',
        scope: 'generation',
        packet: 'generate_preset',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['presetName'],
            properties: {
                presetName: { type: 'string' },
                workspace: { type: 'string' },
                allow_paid: { type: 'boolean' }
            }
        }
    },
    {
        name: 'upscale_image',
        description: 'NovelAI 2x upscale of a gallery image. Wraps upscale_image. Pass filename from get_images / generate_image.',
        scope: 'generation',
        packet: 'upscale_image',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['filename'],
            properties: {
                filename: { type: 'string' },
                workspace: { type: 'string' },
                upscaler: { type: 'string', description: 'Default novelai' },
                scale: { type: 'number', description: 'Passed through; live NAI contract is 2x' }
            }
        }
    },
    {
        name: 'expand_image',
        description: 'Expand canvas (letterbox + generate into the new area). Wraps expand_image. Requires filename, target resolution, and imageBias 0–4 (0=start edge, 2=center, 4=end edge).',
        scope: 'generation',
        packet: 'expand_image',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['filename', 'resolution', 'imageBias'],
            properties: {
                filename: { type: 'string' },
                resolution: { type: 'string', description: 'Named Studio resolution (e.g. large_landscape)' },
                imageBias: { type: 'number', description: '0–4 placement of the original in the new canvas' },
                workspace: { type: 'string' },
                upscaleAfterComplete: { type: 'boolean' },
                enableAI: { type: 'boolean', description: 'Let the server write the expansion prompt' },
                inset: { type: 'boolean' },
                sourceFilename: { type: 'string' }
            }
        }
    },
    {
        name: 'list_references',
        description: 'List reference images. Wraps get_references.',
        scope: 'references',
        packet: 'get_references',
        inputSchema: { type: 'object', additionalProperties: true, properties: {} }
    },
    {
        name: 'get_references_by_ids',
        description: 'Read specific references by id. Wraps get_references_by_ids.',
        scope: 'references',
        packet: 'get_references_by_ids',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['references'],
            properties: {
                references: { type: 'array', items: { type: ['string', 'object'] } }
            }
        }
    },
    {
        name: 'list_workspace_references',
        description: 'List references in a workspace. Wraps get_workspace_references.',
        scope: 'references',
        packet: 'get_workspace_references',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: { workspaceId: { type: 'string' } }
        }
    },
    {
        name: 'upload_reference',
        description: 'Upload a reference image. Wraps upload_reference.',
        scope: 'references',
        packet: 'upload_reference',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                imageData: { type: 'string' },
                workspaceId: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' } }
            }
        }
    },
    {
        name: 'omegasearch',
        description: 'Gallery / prompt OmegaSearch. Wraps omegasearch_query. Send query, terms, or blocks.',
        scope: 'search',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                query: { type: 'string', description: 'Plain text; coerced to one search block' },
                terms: { type: 'array', items: { type: 'string' }, description: 'OR terms in one block' },
                blocks: { type: 'array' },
                workspaceId: { type: ['string', 'null'] },
                viewType: { type: 'string' },
                offset: { type: 'number' },
                limit: { type: 'number' },
                filters: { type: 'object' }
            }
        }
    },
    {
        name: 'list_notes',
        description: 'List notepad metadata (id, name, workspace). Wraps notes_get_all_metadata.',
        scope: 'notes',
        packet: 'notes_get_all_metadata',
        inputSchema: { type: 'object', additionalProperties: false, properties: {} }
    },
    {
        name: 'list_notes_by_workspace',
        description: 'List notes in one workspace. Wraps notes_get_by_workspace.',
        scope: 'notes',
        packet: 'notes_get_by_workspace',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['workspaceId'],
            properties: { workspaceId: { type: 'string' } }
        }
    },
    {
        name: 'get_note',
        description: 'Read one note including content. Wraps notes_get.',
        scope: 'notes',
        packet: 'notes_get',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['noteId'],
            properties: { noteId: { type: 'string' } }
        }
    },
    {
        name: 'create_note',
        description: 'Create a notepad note. Wraps notes_create. Mints id when omitted. workspaceId required unless a Studio tab is bound.',
        scope: 'notes',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['name'],
            properties: {
                name: { type: 'string' },
                content: { type: 'string' },
                workspaceId: { type: 'string' },
                id: { type: 'string' },
                icon: { type: 'string' },
                color: { type: 'string' }
            }
        }
    },
    {
        name: 'update_note',
        description: 'Update note metadata (name, icon, color, workspace). Wraps notes_update.',
        scope: 'notes',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['noteId'],
            properties: {
                noteId: { type: 'string' },
                updates: { type: 'object' },
                name: { type: 'string' },
                icon: { type: 'string' },
                color: { type: 'string' },
                workspaceId: { type: 'string' }
            }
        }
    },
    {
        name: 'save_note_content',
        description: 'Replace or append note body. Wraps notes_save_content (append does notes_get first). Use this for "write the story so far" / "note what we did differently".',
        scope: 'notes',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            required: ['noteId', 'content'],
            properties: {
                noteId: { type: 'string' },
                content: { type: 'string' },
                append: { type: 'boolean', description: 'If true, append after existing body' }
            }
        }
    }
];

const AUTOFILL_TERM_MAX = 20;
const STATIC_WIKI_SEARCH_MAX = 200;

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
    search_wiki: 'search',
    get_wiki_page: 'search',
    search_static_wiki: 'search',
    get_static_wiki_page: 'search',
    omegasearch: 'search',
    get_images: 'gallery',
    get_generated_image: 'gallery',
    create_note: 'write',
    update_note: 'write',
    save_note_content: 'write',
    save_preset: 'write',
    upload_reference: 'write',
    get_studio_state: 'studio',
    apply_studio_changes: 'studio',
    apply_preset_to_studio: 'studio',
    generate_image: 'generate',
    generate_preset: 'generate',
    upscale_image: 'generate',
    expand_image: 'generate'
};

const rateGroupHits = new Map();

function rateGroupForTool(name) {
    return TOOL_RATE_GROUPS[name] || 'rpc';
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
    return `mcp-ip:${req.ip || req.socket?.remoteAddress || 'unknown'}`;
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
            const name = req.body && req.body.params ? String(req.body.params.name || '').trim() : '';
            groupId = rateGroupForTool(name);
        }
        const denied = consumeRateGroup(rateLimitPrincipal(req), groupId);
        if (denied.ok) return next();
        return sendRateLimitResponse(req, res, denied);
    };
}

function sanitizeGalleryFilename(filename) {
    const raw = String(filename || '').trim();
    if (!raw) return null;
    if (raw.includes('..') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
        return null;
    }
    return path.basename(raw);
}

function resolveGalleryImagePath(globalResources, filename) {
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
    return { safe, filePath };
}

async function resizeImageForGrok(source) {
    const sharp = require('sharp');
    let edge = GROK_IMAGE_MAX_EDGE;
    let quality = 72;
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const bytes = await sharp(source, {
            failOnError: false,
            unlimited: true,
            sequentialRead: true
        })
            .rotate()
            .resize(edge, edge, {
                fit: 'inside',
                withoutEnlargement: true,
                kernel: sharp.kernel.lanczos3
            })
            .webp({ quality, effort: 4 })
            .toBuffer();
        if (bytes.length <= GROK_IMAGE_MAX_BYTES && bytes.length <= MAX_IMAGE_BYTES) {
            return { mimeType: 'image/webp', bytes, kind: 'grok' };
        }
        edge = Math.max(512, Math.round(edge * 0.75));
        quality = Math.max(48, quality - 10);
    }
    return null;
}

function readGalleryImage(globalResources, filename) {
    const { safe, filePath } = resolveGalleryImagePath(globalResources, filename);
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

function toolAllowedForScopes(scopes, tool) {
    if (agentHasNamedScope(scopes, tool.scope)) return true;
    // modules/applicationAuthManager.js — autofill already includes wiki packets
    if (tool.scope === 'wiki' && agentHasNamedScope(scopes, 'autofill')) return true;
    return false;
}

function listToolsForScopes(scopes) {
    return TOOL_DEFS.filter((tool) => toolAllowedForScopes(scopes, tool)).map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
    }));
}

function requireToolScope(scopes, tool) {
    if (toolAllowedForScopes(scopes, tool)) return;
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
    requireToolScope(scopes, def);
    const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};

    if (name === 'get_wiki_page' && !input.tagName) {
        input.tagName = input.name || input.title || input.tag;
    }
    if (name === 'list_static_wiki_pages' || name === 'get_static_wiki_page' || name === 'search_static_wiki') {
        input.siteId = input.siteId || input.site;
    }
    if (name === 'get_static_wiki_page') {
        input.pageId = input.pageId || input.page || input.pageName;
    }
    if (name === 'get_preset' || name === 'save_preset' || name === 'apply_preset_to_studio' || name === 'generate_preset') {
        input.presetName = input.presetName || input.name;
    }
    if (name === 'list_notes_by_workspace' || name === 'create_note') {
        input.workspaceId = input.workspaceId || input.workspace;
    }
    if (name === 'get_note' || name === 'update_note' || name === 'save_note_content') {
        input.noteId = input.noteId || input.id;
    }
    if (name === 'upscale_image' || name === 'expand_image') {
        input.filename = input.filename || input.image;
    }
    if (name === 'expand_image' && (input.imageBias === undefined || input.imageBias === null)) {
        input.imageBias = input.image_bias != null ? input.image_bias : input.bias;
    }

    if (name === 'search_autofill') {
        const terms = collectAutofillTerms(input);
        if (!terms.length) {
            return mcpTextResult({ success: true, results: [] });
        }
        const batches = [];
        for (const term of terms) {
            const packet = await dispatchPacketTool(globalResources, req, 'test_autofill_ranking', {
                query: term,
                model: input.model
            });
            const data = packet.data && typeof packet.data === 'object' ? packet.data : {};
            batches.push({
                term,
                success: packet.success,
                results: Array.isArray(data.results) ? data.results : [],
                spellCheck: data.spellCheck || null
            });
        }
        return mcpTextResult({ success: true, results: batches });
    }

    if (name === 'search_static_wiki') {
        return mcpTextResult(searchStaticWikiPages(globalResources, input));
    }

    if (name === 'apply_preset_to_studio') {
        const loaded = await dispatchPacketTool(globalResources, req, 'load_preset', {
            presetName: input.presetName,
            presetUuid: input.presetUuid
        });
        if (!loaded.success || !loaded.data) {
            return mcpTextResult(loaded, true);
        }
        const change = studioChangeFromPreset(loaded.data);
        const applied = await applyStudioChanges(globalResources, {
            change,
            autoApply: input.autoApply,
            autoGenerate: input.autoGenerate
        });
        return mcpTextResult({
            success: true,
            presetName: loaded.data.preset_name || input.presetName,
            change,
            ...applied
        });
    }

    if (name === 'omegasearch') {
        input.blocks = collectOmegasearchBlocks(input);
        if (!input.blocks.length) {
            const err = new Error('query, terms, or blocks is required');
            err.status = 400;
            throw err;
        }
        return mcpTextResult(await dispatchPacketTool(globalResources, req, 'omegasearch_query', input));
    }

    if (name === 'create_note') {
        input.id = input.id || crypto.randomUUID();
        input.workspaceId = resolveNoteWorkspaceId(globalResources, input);
        if (!input.workspaceId) {
            const err = new Error('workspaceId is required (or bind a Studio tab)');
            err.status = 400;
            throw err;
        }
        return mcpTextResult(await dispatchPacketTool(globalResources, req, 'notes_create', input));
    }

    if (name === 'update_note') {
        const updates = input.updates && typeof input.updates === 'object' ? { ...input.updates } : {};
        if (input.name != null) updates.name = input.name;
        if (input.icon != null) updates.icon = input.icon;
        if (input.color != null) updates.color = input.color;
        if (input.workspaceId != null) updates.workspaceId = input.workspaceId;
        return mcpTextResult(await dispatchPacketTool(globalResources, req, 'notes_update', {
            noteId: input.noteId,
            updates
        }));
    }

    if (name === 'save_note_content') {
        let content = input.content;
        if (input.append) {
            const existing = await dispatchPacketTool(globalResources, req, 'notes_get', { noteId: input.noteId });
            const prior = existing.data && existing.data.note && existing.data.note.content
                ? String(existing.data.note.content)
                : '';
            content = prior ? `${prior}\n\n${content}` : content;
        }
        return mcpTextResult(await dispatchPacketTool(globalResources, req, 'notes_save_content', {
            noteId: input.noteId,
            content
        }));
    }

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
        const wantFull = input.full === true;
        const packet = await dispatchPacketTool(globalResources, req, 'request_image_metadata', { filename });
        let image = null;
        let imageKind = null;
        if (wantFull) {
            try {
                image = readGalleryImage(globalResources, filename);
                imageKind = 'full';
            } catch (error) {
                if (error.status === 404) {
                    return mcpTextResult({ ...packet, filename, image: null, error: 'Image file not found' }, !packet.success);
                }
                if (error.status !== 413) throw error;
            }
        }
        if (!image) {
            try {
                const resolved = resolveGalleryImagePath(globalResources, filename);
                image = await resizeImageForGrok(resolved.filePath);
                if (image) {
                    image.filename = filename;
                    imageKind = 'grok';
                }
            } catch (error) {
                if (error.status === 404) {
                    return mcpTextResult({ ...packet, filename, image: null, error: 'Image file not found' }, !packet.success);
                }
                throw error;
            }
        }
        if (!image) {
            return mcpTextResult({
                ...packet,
                filename,
                image: null,
                imageKind: null,
                error: 'Could not resize image for Grok'
            }, !packet.success);
        }
        return mcpImageResult({ ...packet, filename, imageKind }, image);
    }

    if (name === 'list_clients') {
        return mcpTextResult({
            success: true,
            boundClientId: getBoundClientId(),
            clients: listClients(globalResources)
        });
    }

    if (name === 'get_studio_state') {
        const bound = getBoundRecord(globalResources);
        if (!bound) {
            return mcpTextResult({
                success: false,
                error: 'No Studio client is bound. Call list_clients then bind_session.'
            }, true);
        }
        const scopePayload = buildAgentScopePayload(req, globalResources);
        try {
            const data = await sendBoundCommand(globalResources, 'get_state', {}, 8000);
            const change = (data && data.change && typeof data.change === 'object' && !Array.isArray(data.change))
                ? data.change
                : null;
            return mcpTextResult({
                success: true,
                bound: true,
                workspaceId: data.workspaceId || null,
                filename: data.filename || null,
                model: data.model || null,
                clientId: getBoundClientId(),
                change,
                scopes: scopePayload.scopes
            });
        } catch (error) {
            if (error.status === 504) {
                return mcpTextResult({
                    success: true,
                    bound: true,
                    partial: true,
                    filename: null,
                    model: null,
                    clientId: getBoundClientId(),
                    change: null,
                    scopes: scopePayload.scopes,
                    error: 'Bound tab did not answer in time'
                });
            }
            throw error;
        }
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

function collectOmegasearchBlocks(input) {
    if (Array.isArray(input.blocks) && input.blocks.length) {
        return input.blocks;
    }
    const blocks = [];
    if (Array.isArray(input.terms)) {
        const terms = input.terms.map((term) => String(term || '').trim()).filter(Boolean);
        if (terms.length) {
            blocks.push({ terms, matchMode: 'substring', orWithinBlock: true });
        }
    }
    if (input.query) {
        const query = String(input.query).trim();
        if (query) blocks.push(query);
    }
    return blocks;
}

function searchStaticWikiPages(globalResources, input) {
    const query = String(input.query || '').trim().toLowerCase();
    if (!query) {
        const err = new Error('query is required');
        err.status = 400;
        throw err;
    }
    const staticWiki = globalResources.getStaticWiki();
    const home = staticWiki.getWikiHomeData(globalResources);
    const sites = Array.isArray(home && home.sites) ? home.sites : [];
    const wantedSite = input.siteId ? String(input.siteId) : '';
    const limit = Math.min(Math.max(Number(input.limit) || 50, 1), STATIC_WIKI_SEARCH_MAX);
    const results = [];
    for (const site of sites) {
        if (wantedSite && site.id !== wantedSite) continue;
        const index = staticWiki.getSiteIndex(globalResources, site.id);
        if (!index || !Array.isArray(index.groups)) continue;
        for (const group of index.groups) {
            for (const page of group.pages || []) {
                const hay = `${page.id} ${page.title || ''} ${group.name || ''}`.toLowerCase();
                if (!hay.includes(query)) continue;
                results.push({
                    siteId: site.id,
                    siteName: index.name || site.name,
                    group: group.name,
                    pageId: page.id,
                    title: page.title || page.id
                });
                if (results.length >= limit) {
                    return { success: true, results };
                }
            }
        }
    }
    return { success: true, results };
}

function studioChangeFromPreset(preset) {
    const data = preset && typeof preset === 'object' ? preset : {};
    const params = {};
    if (data.model) params.model = data.model;
    if (data.steps != null) params.steps = data.steps;
    if (data.guidance != null) params.guidance = data.guidance;
    if (data.rescale != null) params.rescale = data.rescale;
    if (data.sampler) params.sampler = data.sampler;
    if (data.noiseScheduler || data.noise_schedule) {
        params.noiseScheduler = data.noiseScheduler || data.noise_schedule;
    }
    if (data.resolution) params.resolution = data.resolution;
    if (data.width != null) params.width = data.width;
    if (data.height != null) params.height = data.height;
    if (data.seed != null && data.seed !== '') params.seed = data.seed;
    if (data.request_upscale != null) params.upscale = !!data.request_upscale;
    if (data.append_quality != null) params.append_quality = !!data.append_quality;
    if (data.append_uc != null) params.append_uc = data.append_uc;

    const fields = [];
    if (data.prompt != null) {
        fields.push({
            id: 'prompt',
            action: 'replace',
            chunks: [{ name: 'Prompt', text: String(data.prompt) }]
        });
    }
    const uc = data.uc != null ? data.uc : data.negative_prompt;
    if (uc != null) {
        fields.push({
            id: 'uc',
            action: 'replace',
            chunks: [{ name: 'UC', text: String(uc) }]
        });
    }

    const change = {
        dreamscape: 'change',
        v: 1,
        title: data.preset_name || data.name || 'preset',
        params,
        fields
    };

    if (Array.isArray(data.characterPrompts) && data.characterPrompts.length) {
        change.characters = data.characterPrompts.map((char, index) => ({
            index,
            action: 'replace',
            name: char && (char.name || char.promptName)
                ? String(char.name || char.promptName)
                : `Character ${index + 1}`,
            prompt: char && char.prompt != null ? String(char.prompt) : '',
            uc: char && char.uc != null
                ? String(char.uc)
                : (char && char.negative_prompt != null ? String(char.negative_prompt) : '')
        }));
    }
    return change;
}

function resolveNoteWorkspaceId(globalResources, input) {
    if (input.workspaceId) return String(input.workspaceId);
    const bound = getBoundRecord(globalResources);
    if (!bound || !bound.info || !bound.info.sessionId) return null;
    const workspaceManager = globalResources.getWorkspaceManager();
    return workspaceManager.getActiveWorkspace(bound.info.sessionId) || null;
}

function collectAutofillTerms(input) {
    const terms = [];
    const seen = new Set();
    const push = (value) => {
        const term = String(value || '').trim();
        if (!term || seen.has(term)) return;
        seen.add(term);
        terms.push(term);
    };
    if (Array.isArray(input.terms)) {
        input.terms.forEach(push);
    }
    push(input.query);
    return terms.slice(0, AUTOFILL_TERM_MAX);
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
    const oauthProvider = new McpOAuthProvider(globalResources);
    const oauthRoutes = createOAuthRoutes(globalResources);

    const resourceMetadataUrl = `${oauthProvider.getMcpBaseUrl()}/.well-known/oauth-protected-resource`;
    const mcpAuth = createMcpAuthMiddleware(globalResources, { resourceMetadataUrl });
    const mcpLimiter = createMcpRateLimiter();

    function mcpMiddleware(req, res, next) {
        req.mcpOAuthProvider = oauthProvider;
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

    function oauthMiddleware(req, res, next) {
        req.mcpOAuthProvider = oauthProvider;
        applyOAuthCors(req, res, oauthProvider);
        if (req.method === 'OPTIONS') {
            if (req.headers.origin && !isAllowedOAuthOrigin(req.headers.origin, req, oauthProvider)) {
                return res.status(403).json({ error: 'Origin not allowed', code: 'CORS_LOCKED' });
            }
            return res.status(204).end();
        }
        if (req.headers.origin && !isAllowedOAuthOrigin(req.headers.origin, req, oauthProvider)) {
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

    // OAuth 2.1 well-known endpoints at domain root (RFC 8414, RFC 9728)
    // These point at the actual endpoints under /{mcpPathUuid}/oauth/*
    app.get('/.well-known/oauth-protected-resource', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json(oauthProvider.getProtectedResourceMetadata());
    });

    app.get('/.well-known/oauth-authorization-server', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.json(oauthProvider.getAuthorizationServerMetadata());
    });

    // OAuth routes under /{mcpPathUuid}/oauth/*
    const oauthPrefix = `${prefix}/oauth`;
    const bodyParser = require('express').json();
    const urlEncodedParser = require('express').urlencoded({ extended: true });

    app.options(`${oauthPrefix}/register`, oauthMiddleware);
    app.post(`${oauthPrefix}/register`, oauthMiddleware, bodyParser, oauthRoutes.handleRegister);

    const consentPinLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 20,
        skipSuccessfulRequests: true,
        keyGenerator: (req) => `mcp-consent-pin:${req.ip || req.socket?.remoteAddress || 'unknown'}`,
        handler: (req, res) => {
            res.status(429).send('Too many PIN attempts. Try again later.');
        },
        standardHeaders: true,
        legacyHeaders: false
    });

    app.options(`${oauthPrefix}/authorize`, oauthMiddleware);
    app.get(`${oauthPrefix}/authorize`, oauthMiddleware, oauthRoutes.handleAuthorizeGet);
    app.post(`${oauthPrefix}/authorize`, oauthMiddleware, consentPinLimiter, urlEncodedParser, oauthRoutes.handleAuthorizePost);

    app.options(`${oauthPrefix}/token`, oauthMiddleware);
    app.post(`${oauthPrefix}/token`, oauthMiddleware, urlEncodedParser, oauthRoutes.handleToken);

    // MCP JSON-RPC endpoints
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
    McpOAuthProvider,
    _test: {
        TOOL_DEFS,
        MCP_CORS_ORIGINS,
        OAUTH_CORS_ORIGINS,
        MCP_PROTOCOL_VERSION,
        isAllowedMcpOrigin,
        isAllowedOAuthOrigin,
        isAbsentOrigin,
        sanitizeGalleryFilename,
        isCheapMcpRequest,
        resizeImageForGrok,
        GROK_IMAGE_MAX_EDGE,
        rateGroupForTool,
        consumeRateGroup,
        resetRateGroupHits,
        MCP_RATE_GROUP_LIMITS,
        TOOL_RATE_GROUPS,
        listToolsForScopes,
        toolAllowedForScopes,
        collectAutofillTerms,
        collectOmegasearchBlocks,
        studioChangeFromPreset,
        searchStaticWikiPages,
        handleJsonRpc,
        applyStudioChanges,
        getBoundRecord
    }
};
