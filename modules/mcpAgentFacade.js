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
    assembleStudioChangeFromToolArgs,
    flattenGenerateToolArgs,
    mergeExpansionOverrideParams,
    resolveAgentPacketMessage,
    resolveAgentAuthScopes,
    agentHasNamedScope,
    buildAgentScopePayload
} = require('./agentClientBridge');
const { isGenerateTool, summarizeArgs, summarizeResult, recordActivity } = require('./mcpActivity');
const { compareImageFiles, evaluateThemeRows } = require('./mcpInsights');
const { buildStudioSettingsCatalog, applyCatalogToListedTool } = require('./studioSettingsCatalog');
const { buildMcpServerInfo, hashMcpToolsRevision } = require('./mcpServerInfo');

const MCP_PROTOCOL_VERSION = '2024-11-05';
const MCP_RATE_WINDOW_MS = 15 * 60 * 1000;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const GROK_IMAGE_MAX_EDGE = 1280;
const GROK_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const MCP_INSTRUCTIONS = [
    'Known or last gallery image: call get_generated_image. Pass filename, seed, or omit filename for the latest image in that workspace (default workspace if omitted). It returns NovelAI metadata plus a small webp. Never page a directory listing to find a file.',
    'A specific workspace: get_workspaces for the id, then pass workspace on get_generated_image or omegasearch.',
    'Make a preset from this image or Studio tab: get_generated_image or get_studio_state, then save_preset with presetName and config (name, prompt, model).',
    'Delivery priority: apply_studio_changes is the default (autoApply true; autoGenerate if they asked to generate now). Else generate_image (no Studio tab / server-side run). Else emit Change-JSON. Else the prompt-text block. Do not dump Positive/UC when Studio MCP works.',
    'On every Studio edit: get_studio_state first. Compare to the last state you saw this chat. Keep their intervening edits; apply only this message\'s delta.',
    'Studio prompt / compare / edit: call get_studio_state (auto-binds if exactly one tab is connected), then get_generated_image with state.filename. Write back with apply_studio_changes. Full Change-JSON or top-level prompt/uc/params/characters/expanders/vibes all apply. autoGenerate clicks the bound Studio Generate button.',
    'generate_image is a server-side generate and returns the new filename plus a small webp. Pass the same Studio settings as the editor (steps, guidance, rescale, sampler, noiseScheduler, seed, resolution, characters, vibes, pipeline, …) as top-level keys or inside params. Do not page the gallery afterward. The matching-workspace gallery updates itself.',
    'Quality and UC presets: set append_quality / append_uc. Do not paste those live strings into prompt or uc (the server prepends them). If you must change a tag inside a preset, turn that preset off and put the edited string in prompt/uc — never leave the preset on and also paste a variant. NSFW: set dataset_config.nsfw, do not paste that level\'s add/remove tags. In-image text: keep append_quality on and set dataset_config.settings.__quality__.no_text.enabled false (default on). tools/list and get_studio_state.settings list each preset id, name, and true value from prompt.config.',
    'Gallery actions: delete_images, scrap_images, toggle_favorite, open_in_lumen (one image), open_in_glancewell (a group).',
    'compare_images diffs two same-seed files. evaluate_workspace_themes counts overused characters/tags in a folder.',
    'VFS: vfs_list path (use @desktop for the workspace desktop), vfs_read, or advanced_tools for write/delete/stat.',
    'omegasearch finds names; then call get_generated_image.',
    'If you cannot do the job with the listed tools, call advanced_tools with a query. To run a hidden tool, call advanced_tools again with that name and arguments.',
    'If a tool is rate limited, wait retryAfter seconds for that group (free/search/gallery/write/studio/generate).'
].join(' ');

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

const STUDIO_PARAM_SCHEMA = {
    steps: { type: 'number', description: 'Sampler steps (typical 23–28)' },
    guidance: { type: 'number', description: 'CFG / prompt guidance (typical 5)' },
    rescale: { type: 'number', description: 'CFG rescale 0–1' },
    sampler: { type: 'string', description: 'k_euler_ancestral (Euler Ancestral), k_dpmpp_sde (DPM++ SDE), k_dpmpp_2m (DPM++ 2M), k_dpmpp_2m_sde (DPM++ 2M SDE), k_euler (Euler), k_dpmpp_2s_ancestral (DPM++ 2S Ancestral)', enum: ['k_euler_ancestral', 'k_dpmpp_sde', 'k_dpmpp_2m', 'k_dpmpp_2m_sde', 'k_euler', 'k_dpmpp_2s_ancestral'] },
    noiseScheduler: { type: 'string', description: 'karras, exponential, or polyexponential', enum: ['karras', 'exponential', 'polyexponential'] },
    model: { type: 'string', description: 'e.g. v5, v5_cur, v4_5, v4_5_cur, v4, v4_cur, v3, furry. Live ids are on tools/list and get_studio_state.settings.models' },
    seed: { type: ['string', 'number'], description: 'Specific seed, or "last" to lock last used' },
    seedLock: { type: 'boolean', description: 'true locks last used seed (Studio sprout). false rolls a new variation' },
    resolution: { type: 'string', description: 'Named size (normal_portrait=832x1216, normal_landscape=1216x832, normal_square=1024x1024, large_*, xlarge_*, wallpaper_*, small_*) or custom plus width/height. Live px sizes are on tools/list and get_studio_state.settings.resolutions' },
    width: { type: 'number', description: 'Only with resolution custom' },
    height: { type: 'number', description: 'Only with resolution custom' },
    variety: { type: 'boolean', description: 'Variety+ (model-dependent)' },
    upscale: { type: 'boolean', description: 'Request 2x upscale after generate' },
    strength: { type: 'number', description: 'img2img strength 0–1 (only in a strength-capable mode)' },
    noise: { type: 'number', description: 'img2img noise 0–1' },
    append_quality: { type: 'boolean', description: 'If true, server prepends the live quality string for the model from prompt.config. Prefer this over pasting quality tags. If you need to edit those tags, set false and put the edited string in prompt. Do not leave this true and also paste a variant. tools/list and get_studio_state.settings list the true strings per model.' },
    append_uc: { type: 'number', description: '0 None, 1 Human Focus, 2 Light, 3 Heavy, 4 Curated, 5 Furry Focus. Server prepends the live UC string from prompt.config. Prefer this over pasting those tags. If you need to edit that UC, set 0 and put the edited string in uc. Do not leave a preset on and also paste a variant. tools/list and get_studio_state.settings list the true strings per model.' },
    append_transparency: { type: 'boolean', description: 'If true, server prepends "transparent background". Do not also add that tag by hand.' }
};

const GENERATE_IMAGE_PROPERTIES = {
    prompt: { type: 'string', description: 'Positive prompt. If append_quality is true, do not also paste the quality preset string — the server prepends it.' },
    uc: { type: 'string', description: 'Undesired content. If append_uc > 0, do not also paste that UC preset string — the server prepends it.' },
    promptNegative: { type: 'string' },
    input_prompt_negative: { type: 'string' },
    workspace: { type: 'string' },
    pipeline: {
        type: 'array',
        description: 'Staged generation stages (same payload as Studio pipeline). Omit for a single image.'
    },
    params: {
        type: 'object',
        additionalProperties: true,
        description: 'Same keys as Studio params (also accepted top-level)',
        properties: STUDIO_PARAM_SCHEMA
    },
    characters: {
        type: 'array',
        description: 'Character slots (prompt, uc, name, position/center). Mapped to allCharacterPrompts.'
    },
    allCharacterPrompts: { type: 'array' },
    use_coords: { type: 'boolean' },
    expanders: { type: 'array', description: 'Request !prefix text replacements' },
    text_replacements: { type: 'array' },
    vibes: { type: 'array', description: 'Vibe transfer ids Studio already knows' },
    vibe_transfer: { type: 'array' },
    normalize_vibes: { type: 'boolean' },
    dataset_config: {
        type: 'object',
        description: 'dataset_config.nsfw: 3 Nude, 2 Skimpy, 1 Allow, 0 Neutral, -1 Remove, -2 Clense. Set the level; do not paste that level\'s add/remove tags. Live strings are on tools/list and get_studio_state.settings.nsfw.',
        properties: {
            nsfw: { type: 'number', description: '3 Nude, 2 Skimpy, 1 Allow, 0 Neutral, -1 Remove, -2 Clense' },
            include: { type: 'array', items: { type: 'string' } },
            bias: { type: 'object' },
            settings: { type: 'object' }
        }
    },
    auto_clean_uc: { type: 'boolean' },
    keep_newlines: { type: 'boolean' },
    auto_char_numerize: { type: 'boolean' },
    prompt_normalize: { type: 'boolean' },
    deduplicate_tags: { type: 'boolean' },
    save_base_output: { type: 'boolean' },
    skip_pipeline_stages: { type: 'boolean' },
    append_transparency: { type: 'boolean', description: 'If true, server prepends "transparent background". Do not also add that tag by hand.' },
    image: { type: 'string', description: 'img2img source: file:filename or omitted if Studio already has one' },
    image_bias: { type: 'number' },
    ...STUDIO_PARAM_SCHEMA
};

const TOOL_DEFS = [
    {
        name: 'generate_image',
        core: true,
        description: 'Generate on the server and return the new filename plus a Grok-sized webp and metadata. Accepts the full Studio settings set (steps, guidance, rescale, sampler, noiseScheduler, seed, resolution, characters, vibes, pipeline, …) as top-level keys or inside params. Tags the file as MCP-generated. Matching-workspace galleries update themselves. Not the Studio Generate button (use apply_studio_changes autoGenerate for that).',
        scope: 'generation',
        packet: 'generate_image',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: GENERATE_IMAGE_PROPERTIES
        }
    },
    {
        name: 'get_generated_image',
        core: true,
        description: 'Get one gallery image as NovelAI metadata plus a Grok-sized webp. Pass filename, seed, or omit filename for the latest image. workspace default is "default". Do not page get_images.',
        scope: 'gallery',
        packet: 'request_image_metadata',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                filename: { type: 'string', description: 'Basename, partial name, or omit for latest' },
                seed: { type: ['string', 'number'], description: 'Find by seed when filename is unknown' },
                workspace: { type: 'string', description: 'Workspace id or "default"' },
                workspaceId: { type: 'string' },
                full: { type: 'boolean', description: 'Original PNG only if under the size cap. Default false.' }
            }
        }
    },
    {
        name: 'get_latest_image',
        description: 'Newest image in a workspace (default workspace if omitted) as metadata plus a Grok-sized webp. Same as get_generated_image with no filename.',
        scope: 'gallery',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                workspace: { type: 'string' },
                workspaceId: { type: 'string' }
            }
        }
    },
    {
        name: 'get_images',
        description: 'Directory listing of the gallery (paged). Not for a known or last file — use get_generated_image or get_latest_image.',
        scope: 'gallery',
        packet: 'request_gallery',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
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
        core: true,
        description: 'List workspaces. The default workspace id is "default". Use the id as workspace on get_generated_image or omegasearch.',
        scope: 'workspace',
        packet: 'workspace_list',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'list_clients',
        description: 'List open Studio tabs. Only needed when more than one tab is connected; get_studio_state auto-binds a single tab.',
        scope: 'generation',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'bind_session',
        description: 'Pick which Studio tab to drive when more than one is connected. clientId from list_clients, or a share code.',
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
        core: true,
        description: 'Current Studio prompt, UC, characters, params, and open filename. Also returns settings: live sampler/resolution/model enums plus quality, UC, and NSFW preset id, name, and true prompt.config strings so you can enable append_quality / append_uc instead of pasting those tags. Auto-binds if exactly one tab is connected. Then use get_generated_image on filename to see the picture.',
        scope: 'generation',
        inputSchema: { type: 'object', properties: {} }
    },
    {
        name: 'apply_studio_changes',
        core: true,
        description: 'Write Change-JSON into the bound Studio tab. Auto-binds if one tab is connected. Accepts full Change-JSON or top-level prompt/uc/params/characters/expanders/vibes (same keys as Studio). autoGenerate (default false) clicks Studio Generate after apply. Characters must be action replace + index.',
        scope: 'generation',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                change: { type: ['object', 'string'], description: 'Change-JSON v1 object or string' },
                prompt: { type: 'string', description: 'Positive prompt. If append_quality is true, do not also paste the quality preset string.' },
                uc: { type: 'string', description: 'Undesired content. If append_uc > 0, do not also paste that UC preset string.' },
                promptNegative: { type: 'string' },
                params: {
                    type: 'object',
                    additionalProperties: true,
                    description: 'Studio params to change. Same keys also accepted top-level.',
                    properties: STUDIO_PARAM_SCHEMA
                },
                characters: {
                    type: 'array',
                    description: 'Existing slots only. Always action replace + index.'
                },
                expanders: { type: 'array', description: '!prefix text replacements (replaces current list if sent)' },
                text_replacements: { type: 'array' },
                vibes: { type: 'array' },
                fields: { type: 'array' },
                autoApply: { type: 'boolean', description: 'Default true. Silent apply on the bound tab.' },
                autoGenerate: { type: 'boolean', description: 'Default false. After apply, click bound-tab Generate.' },
                ...STUDIO_PARAM_SCHEMA
            }
        }
    },
    {
        name: 'search_autofill',
        core: true,
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
        core: true,
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
        core: true,
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
        core: true,
        description: 'Save this image or Studio state as a preset. Requires presetName and config with name, prompt, and model (from get_generated_image metadata or get_studio_state).',
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
        core: true,
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
                allow_paid: { type: 'boolean' },
                params: {
                    type: 'object',
                    additionalProperties: true,
                    properties: STUDIO_PARAM_SCHEMA
                },
                ...STUDIO_PARAM_SCHEMA
            }
        }
    },
    {
        name: 'upscale_image',
        core: true,
        description: 'NovelAI 2x upscale of a gallery image. Wraps upscale_image. Pass filename from get_generated_image / generate_image.',
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
        core: true,
        description: 'Expand canvas (letterbox + generate into the new area). Wraps expand_image. Requires filename, target resolution, and imageBias 0–4 (0=start edge, 2=center, 4=end edge). Optional Studio param overrides (model, steps, guidance, rescale, sampler, noiseScheduler, noise, seed) as overrideParams or top-level.',
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
                sourceFilename: { type: 'string' },
                overrideParams: {
                    type: 'object',
                    additionalProperties: true,
                    description: 'Model/steps/guidance/rescale/sampler/noiseScheduler/noise/seed overrides',
                    properties: {
                        model: { type: 'string' },
                        steps: { type: 'number' },
                        guidance: { type: 'number' },
                        rescale: { type: 'number' },
                        sampler: { type: 'string' },
                        noiseScheduler: { type: 'string' },
                        noise_schedule: { type: 'string' },
                        noise: { type: 'number' },
                        seed: { type: ['string', 'number'] }
                    }
                },
                model: { type: 'string' },
                steps: { type: 'number' },
                guidance: { type: 'number' },
                rescale: { type: 'number' },
                sampler: { type: 'string' },
                noiseScheduler: { type: 'string' },
                noise: { type: 'number' },
                seed: { type: ['string', 'number'] }
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
        core: true,
        description: 'Search gallery prompts/tags. An exact filename query returns that row — then call get_generated_image. Pass workspace to stay in one folder. Do not use this to download pixels.',
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
        core: true,
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
        core: true,
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
        core: true,
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
    },
    {
        name: 'delete_images',
        core: true,
        description: 'Permanently delete one or more gallery images. Pass filename or filenames. Wraps delete_images_bulk.',
        scope: 'gallery',
        packet: 'delete_images_bulk',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                filename: { type: 'string' },
                filenames: { type: 'array', items: { type: 'string' } },
                workspace: { type: 'string' }
            }
        }
    },
    {
        name: 'scrap_images',
        core: true,
        description: 'Move images to workspace scraps (or unscrap). Pass filename or filenames and workspace (default workspace if omitted).',
        scope: 'workspace',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                filename: { type: 'string' },
                filenames: { type: 'array', items: { type: 'string' } },
                workspace: { type: 'string' },
                workspaceId: { type: 'string' },
                remove: { type: 'boolean', description: 'If true, take them out of scraps' }
            }
        }
    },
    {
        name: 'toggle_favorite',
        core: true,
        description: 'Pin or unpin gallery images (Studio favorite). Pass filename or filenames and workspace.',
        scope: 'workspace',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                filename: { type: 'string' },
                filenames: { type: 'array', items: { type: 'string' } },
                workspace: { type: 'string' },
                workspaceId: { type: 'string' },
                pinned: { type: 'boolean', description: 'Force pin (true) or unpin (false). Omit to toggle.' }
            }
        }
    },
    {
        name: 'open_in_lumen',
        core: true,
        description: 'Open one gallery image in Lumen (the single-image viewer) on a connected client.',
        scope: 'gallery',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                filename: { type: 'string' },
                filenames: { type: 'array', items: { type: 'string' } },
                workspace: { type: 'string' }
            }
        }
    },
    {
        name: 'open_in_glancewell',
        core: true,
        description: 'Open one image or a group in Glancewell (lightbox). Pass filenames for a swipeable set.',
        scope: 'gallery',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                filename: { type: 'string' },
                filenames: { type: 'array', items: { type: 'string' } },
                workspace: { type: 'string' }
            }
        }
    },
    {
        name: 'compare_images',
        core: true,
        description: 'Pixel-diff two gallery images (same seed preferred). Returns change stats plus a magenta difference webp.',
        scope: 'gallery',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                filenameA: { type: 'string' },
                filenameB: { type: 'string' },
                a: { type: 'string' },
                b: { type: 'string' },
                workspace: { type: 'string' },
                workspaceId: { type: 'string' }
            }
        }
    },
    {
        name: 'evaluate_workspace_themes',
        core: true,
        description: 'Count overused characters and tags in a workspace so you can suggest new subjects, scenes, or kinks. Does not generate.',
        scope: 'gallery',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                workspace: { type: 'string' },
                workspaceId: { type: 'string' },
                limit: { type: 'number', description: 'Sample size, default 80, max 120' }
            }
        }
    },
    {
        name: 'vfs_list',
        core: true,
        description: 'List a VFS directory. Path default is /. Use @desktop for the workspace desktop. Wraps vfs_list_directory.',
        scope: 'vfs',
        packet: 'vfs_list_directory',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                path: { type: 'string' },
                offset: { type: 'number' },
                limit: { type: 'number' },
                search: { type: 'string' }
            }
        }
    },
    {
        name: 'vfs_read',
        core: true,
        description: 'Read a VFS system file or download a user file. Pass path / systemFileKey / fileId.',
        scope: 'vfs',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                path: { type: 'string' },
                systemFileKey: { type: 'string' },
                fileId: { type: 'string' }
            }
        }
    },
    {
        name: 'vfs_stat',
        description: 'Path stats for a VFS entry. Wraps vfs_get_path_stats.',
        scope: 'vfs',
        packet: 'vfs_get_path_stats',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: { path: { type: 'string' } }
        }
    },
    {
        name: 'vfs_write',
        description: 'Upload a VFS user file. Wraps vfs_upload_file. Pass path, fileData (base64), mimeType.',
        scope: 'vfs',
        packet: 'vfs_upload_file',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                path: { type: 'string' },
                fileData: { type: 'string' },
                mimeType: { type: 'string' },
                name: { type: 'string' }
            }
        }
    },
    {
        name: 'vfs_delete',
        description: 'Delete a VFS entry. Wraps vfs_delete_entry. Pass id or path.',
        scope: 'vfs',
        packet: 'vfs_delete_entry',
        inputSchema: {
            type: 'object',
            additionalProperties: true,
            properties: {
                id: { type: 'string' },
                path: { type: 'string' }
            }
        }
    },
    {
        name: 'list_desktop_items',
        description: 'List desktop shortcuts for a workspace. Wraps desktop_get_shortcuts. Also try vfs_list path @desktop.',
        scope: 'vfs',
        packet: 'desktop_get_shortcuts',
        inputSchema: {
            type: 'object',
            additionalProperties: false,
            properties: {
                workspace: { type: 'string' },
                workspaceId: { type: 'string' }
            }
        }
    }
];

const ADVANCED_TOOL_NAME = 'advanced_tools';
const ADVANCED_TOOL_DEF = {
    name: ADVANCED_TOOL_NAME,
    description: 'Find or run tools that are not in the main list (bind a second Studio tab, page the gallery, static wiki, references, extra note/preset actions). Pass query to search. Pass name + arguments to run one.',
    inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
            query: { type: 'string', description: 'Find hidden tools by job or name (e.g. bind tab, static wiki, references, new note)' },
            name: { type: 'string', description: 'Hidden tool to run, from a previous advanced_tools query' },
            arguments: { type: 'object', description: 'Arguments for that hidden tool' }
        }
    }
};

function currentMcpToolsRevision() {
    return hashMcpToolsRevision([
        ...TOOL_DEFS.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
        })),
        {
            name: ADVANCED_TOOL_DEF.name,
            description: ADVANCED_TOOL_DEF.description,
            inputSchema: ADVANCED_TOOL_DEF.inputSchema
        },
        MCP_INSTRUCTIONS
    ]);
}

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
    apply_studio_changes: 'studio',
    apply_preset_to_studio: 'studio',
    generate_image: 'generate',
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

function sanitizeGalleryFilename(filename) {
    const raw = String(filename || '').trim();
    if (!raw) return null;
    if (raw.includes('..') || raw.includes('/') || raw.includes('\\') || raw.includes('\0')) {
        return null;
    }
    return path.basename(raw);
}

function collectFilenames(input) {
    const names = [];
    const push = (value) => {
        const safe = sanitizeGalleryFilename(typeof value === 'string' ? value : value && value.filename);
        if (safe && !names.includes(safe)) names.push(safe);
    };
    if (!input || typeof input !== 'object') return names;
    if (Array.isArray(input.filenames)) input.filenames.forEach(push);
    if (input.filename) push(input.filename);
    if (Array.isArray(input.images)) input.images.forEach(push);
    return names;
}

function workspaceRecord(globalResources, workspaceId) {
    const manager = globalResources.getWorkspaceManager && globalResources.getWorkspaceManager();
    if (!manager || typeof manager.getWorkspaces !== 'function') return null;
    const all = manager.getWorkspaces() || {};
    return all[workspaceId] || all.default || null;
}

function liveBroadcast(globalResources, payload) {
    const wsServer = globalResources.getWebSocketServer && globalResources.getWebSocketServer();
    if (!wsServer || typeof wsServer.broadcast !== 'function') return false;
    wsServer.broadcast(payload);
    return true;
}

async function openViewerFromMcp(globalResources, input, target) {
    const filenames = collectFilenames(input);
    if (!filenames.length) {
        return mcpTextResult({ success: false, error: 'filename or filenames is required' }, true);
    }
    const payload = { target, filenames };
    if (getBoundRecord(globalResources)) {
        try {
            const data = await sendBoundCommand(globalResources, 'open_viewer', payload, 8000);
            return mcpTextResult({ success: true, bound: true, target, filenames, ...data });
        } catch (_err) { /* fall through to broadcast */ }
    }
    const sent = liveBroadcast(globalResources, {
        type: 'mcp_open_viewer',
        data: payload,
        timestamp: new Date().toISOString()
    });
    if (!sent) {
        return mcpTextResult({ success: false, error: 'No Studio client is connected.' }, true);
    }
    return mcpTextResult({ success: true, broadcast: true, target, filenames });
}

function resolveWorkspaceId(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw || raw.toLowerCase() === 'default') return 'default';
    return raw;
}

function flattenPacket(packet) {
    const data = packet && packet.data && typeof packet.data === 'object' && !Array.isArray(packet.data)
        ? packet.data
        : {};
    const skip = new Set(['image', 'buffer', 'reply', 'replies', 'preview']);
    const out = { success: !!(packet && packet.success) };
    Object.keys(data).forEach((key) => {
        if (skip.has(key)) return;
        const value = data[key];
        if (typeof value === 'string' && value.length > 200000) return;
        out[key] = value;
    });
    if (packet && packet.type) out.packetType = packet.type;
    if (!out.success) {
        out.error = data.error || data.message || data.error_description || 'request failed';
    }
    return out;
}

function galleryFileExists(globalResources, filename) {
    const safe = sanitizeGalleryFilename(filename);
    if (!safe) return null;
    try {
        resolveGalleryImagePath(globalResources, safe);
        return safe;
    } catch (_) {
        return null;
    }
}

function autoBindIfNeeded(globalResources) {
    if (getBoundRecord(globalResources)) {
        return { bound: true, auto: false, clientId: getBoundClientId() };
    }
    const clients = listClients(globalResources);
    if (clients.length === 1 && clients[0].clientId) {
        bindClient(globalResources, { clientId: clients[0].clientId });
        return { bound: true, auto: true, clientId: clients[0].clientId };
    }
    return { bound: false, auto: false, clients };
}

async function lookupFilenameViaSearch(globalResources, req, query, workspaceId) {
    const q = String(query || '').trim();
    if (!q) return null;
    const packet = await dispatchPacketTool(globalResources, req, 'omegasearch_query', {
        blocks: [q],
        workspaceId,
        viewType: 'images',
        offset: 0,
        limit: 8
    });
    const rows = packet.data && Array.isArray(packet.data.results) ? packet.data.results : [];
    const exact = rows.find((row) => row && (row.filename === q || row.filename === path.basename(q)));
    if (exact && exact.filename) return exact.filename;
    if (rows.length === 1 && rows[0].filename) return rows[0].filename;
    return null;
}

async function latestGalleryFilename(globalResources, req, workspaceId) {
    const packet = await dispatchPacketTool(globalResources, req, 'request_gallery', {
        workspaceId,
        offset: 0,
        limit: 1,
        viewType: 'images'
    });
    const gallery = packet.data && Array.isArray(packet.data.gallery) ? packet.data.gallery : [];
    const row = gallery[0];
    return row && row.filename ? row.filename : null;
}

async function resolveGalleryFilename(globalResources, req, input) {
    const workspaceId = resolveWorkspaceId(input.workspaceId || input.workspace);
    const seed = input.seed != null ? String(input.seed).trim() : '';
    let name = sanitizeGalleryFilename(input.filename || input.image || '');
    if (name) {
        const existing = galleryFileExists(globalResources, name);
        if (existing) return { filename: existing, workspaceId };
        if (!path.extname(name)) {
            const withPng = galleryFileExists(globalResources, `${name}.png`);
            if (withPng) return { filename: withPng, workspaceId };
        }
        const found = await lookupFilenameViaSearch(globalResources, req, name, workspaceId);
        if (found) return { filename: found, workspaceId };
    }
    if (seed) {
        const found = await lookupFilenameViaSearch(globalResources, req, seed, workspaceId);
        if (found) return { filename: found, workspaceId };
    }
    if (!name && !seed) {
        const latest = await latestGalleryFilename(globalResources, req, workspaceId);
        if (latest) return { filename: latest, workspaceId, latest: true };
    }
    return { filename: null, workspaceId };
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

function serializeListedTool(tool, catalog) {
    const listed = applyCatalogToListedTool({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
        scope: tool.scope
    }, catalog);
    if (listed.scope && !tool.core) return listed;
    return {
        name: listed.name,
        description: listed.description,
        inputSchema: listed.inputSchema
    };
}

function listAdvancedToolDefs(scopes, query, globalResources) {
    const catalog = buildStudioSettingsCatalog(globalResources);
    const q = String(query || '').trim().toLowerCase();
    const words = q ? q.split(/\s+/).filter(Boolean) : [];
    return TOOL_DEFS.filter((tool) => {
        if (tool.core) return false;
        if (!toolAllowedForScopes(scopes, tool)) return false;
        if (!words.length) return true;
        const hay = `${tool.name} ${tool.description} ${tool.scope}`.toLowerCase();
        return hay.includes(q) || words.every((word) => hay.includes(word));
    }).map((tool) => {
        const listed = applyCatalogToListedTool(tool, catalog);
        return {
            name: listed.name,
            description: listed.description,
            scope: tool.scope,
            inputSchema: listed.inputSchema
        };
    });
}

function listToolsForScopes(scopes, globalResources) {
    const catalog = buildStudioSettingsCatalog(globalResources);
    const core = TOOL_DEFS
        .filter((tool) => tool.core && toolAllowedForScopes(scopes, tool))
        .map((tool) => serializeListedTool(tool, catalog));
    core.push(serializeListedTool(ADVANCED_TOOL_DEF, catalog));
    return core;
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
        const err = new Error('change JSON or prompt/uc/params fields are required');
        err.status = 400;
        throw err;
    }
    const { autoApply, autoGenerate } = resolveStudioAutoFlags(body);
    const assembled = assembleStudioChangeFromToolArgs(body);
    if (!assembled) {
        const err = new Error('change JSON or prompt/uc/params fields are required');
        err.status = 400;
        throw err;
    }
    return sendBoundCommand(globalResources, 'apply_studio', {
        change: assembled,
        prompt: body.prompt,
        uc: body.uc,
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

async function handleAdvancedTools(globalResources, req, input) {
    const scopes = resolveAgentAuthScopes(req);
    const runName = String(input.name || input.tool || '').trim();
    if (runName) {
        if (runName === ADVANCED_TOOL_NAME) {
            return mcpTextResult({ success: false, error: 'Cannot nest advanced_tools' }, true);
        }
        const def = TOOL_DEFS.find((tool) => tool.name === runName);
        if (!def) {
            return mcpTextResult({ success: false, error: `Unknown tool: ${runName}` }, true);
        }
        if (def.core) {
            return mcpTextResult({
                success: false,
                error: `${runName} is a core tool. Call it directly, not through advanced_tools.`
            }, true);
        }
        const runArgs = input.arguments && typeof input.arguments === 'object' && !Array.isArray(input.arguments)
            ? input.arguments
            : (input.args && typeof input.args === 'object' && !Array.isArray(input.args) ? input.args : {});
        return callTool(globalResources, req, runName, runArgs);
    }
        const tools = listAdvancedToolDefs(scopes, input.query, globalResources);
    return mcpTextResult({
        success: true,
        tools,
        count: tools.length,
        next: tools.length
            ? 'Call advanced_tools again with name and arguments to run one of these.'
            : 'No hidden tools matched. Try a shorter query, or use the core tools (get_generated_image, get_studio_state, save_preset, omegasearch).'
    });
}

async function callTool(globalResources, req, name, args) {
    if (name === ADVANCED_TOOL_NAME) {
        const input = args && typeof args === 'object' && !Array.isArray(args) ? args : {};
        return handleAdvancedTools(globalResources, req, input);
    }
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
        const bind = autoBindIfNeeded(globalResources);
        if (!getBoundRecord(globalResources)) {
            return mcpTextResult({
                success: false,
                error: bind.clients && bind.clients.length > 1
                    ? 'Several Studio tabs are connected. Call advanced_tools with query "bind", then run bind_session with one clientId.'
                    : 'No Studio client is connected.',
                clients: bind.clients || []
            }, true);
        }
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
        input.workspaceId = resolveWorkspaceId(input.workspaceId || input.workspace);
        input.blocks = collectOmegasearchBlocks(input);
        if (!input.blocks.length && input.filename) {
            input.blocks = [String(input.filename).trim()];
        }
        if (!input.blocks.length) {
            const err = new Error('query, terms, or blocks is required');
            err.status = 400;
            throw err;
        }
        const packet = await dispatchPacketTool(globalResources, req, 'omegasearch_query', input);
        const flat = flattenPacket(packet);
        const q = String(input.query || input.filename || '').trim();
        const results = Array.isArray(flat.results) ? flat.results : [];
        const exact = results.find((row) => row && (row.filename === q || row.filename === path.basename(q)));
        if (exact && exact.filename) {
            flat.filename = exact.filename;
            flat.next = 'Call get_generated_image with this filename. Do not page get_images.';
        } else if (results.length === 1 && results[0].filename) {
            flat.filename = results[0].filename;
            flat.next = 'Call get_generated_image with this filename. Do not page get_images.';
        }
        return mcpTextResult(flat, !flat.success);
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

    if (name === 'delete_images') {
        const filenames = collectFilenames(input);
        if (!filenames.length) {
            return mcpTextResult({ success: false, error: 'filename or filenames is required' }, true);
        }
        return mcpTextResult(flattenPacket(await dispatchPacketTool(globalResources, req, 'delete_images_bulk', { filenames })));
    }

    if (name === 'scrap_images') {
        const filenames = collectFilenames(input);
        if (!filenames.length) {
            return mcpTextResult({ success: false, error: 'filename or filenames is required' }, true);
        }
        const workspaceId = resolveWorkspaceId(input.workspace || input.workspaceId);
        if (input.remove === true) {
            const results = [];
            for (const filename of filenames) {
                results.push(flattenPacket(await dispatchPacketTool(globalResources, req, 'workspace_remove_scrap', {
                    id: workspaceId,
                    filename
                })));
            }
            return mcpTextResult({ success: results.every((row) => row.success), workspaceId, filenames, results });
        }
        return mcpTextResult(flattenPacket(await dispatchPacketTool(globalResources, req, 'workspace_bulk_add_scrap', {
            id: workspaceId,
            filenames
        })));
    }

    if (name === 'toggle_favorite') {
        const filenames = collectFilenames(input);
        if (!filenames.length) {
            return mcpTextResult({ success: false, error: 'filename or filenames is required' }, true);
        }
        const workspaceId = resolveWorkspaceId(input.workspace || input.workspaceId);
        const record = workspaceRecord(globalResources, workspaceId) || {};
        const pinned = Array.isArray(record.pinned) ? record.pinned : [];
        const results = [];
        for (const filename of filenames) {
            const isPinned = pinned.includes(filename);
            const wantPinned = input.pinned === undefined ? !isPinned : !!input.pinned;
            const packetName = wantPinned ? 'workspace_add_pinned' : 'workspace_remove_pinned';
            if (wantPinned === isPinned) {
                results.push({ filename, pinned: isPinned, unchanged: true, success: true });
                continue;
            }
            const packet = await dispatchPacketTool(globalResources, req, packetName, {
                id: workspaceId,
                filename
            });
            results.push({ filename, pinned: wantPinned, ...flattenPacket(packet) });
        }
        return mcpTextResult({
            success: results.every((row) => row.success),
            workspaceId,
            results
        });
    }

    if (name === 'open_in_lumen') {
        return openViewerFromMcp(globalResources, input, 'lumen');
    }
    if (name === 'open_in_glancewell') {
        return openViewerFromMcp(globalResources, input, 'glancewell');
    }

    if (name === 'compare_images') {
        const workspaceId = resolveWorkspaceId(input.workspace || input.workspaceId);
        const lookedA = await resolveGalleryFilename(globalResources, req, {
            filename: input.filenameA || input.a || input.filename,
            workspace: workspaceId
        });
        const lookedB = await resolveGalleryFilename(globalResources, req, {
            filename: input.filenameB || input.b,
            workspace: workspaceId
        });
        if (!lookedA.filename || !lookedB.filename) {
            return mcpTextResult({
                success: false,
                error: 'Two gallery filenames are required (filenameA and filenameB).'
            }, true);
        }
        if (lookedA.filename === lookedB.filename) {
            return mcpTextResult({ success: false, error: 'Pick two different files to compare.' }, true);
        }
        const pathA = resolveGalleryImagePath(globalResources, lookedA.filename);
        const pathB = resolveGalleryImagePath(globalResources, lookedB.filename);
        const metaA = flattenPacket(await dispatchPacketTool(globalResources, req, 'request_image_metadata', {
            filename: lookedA.filename
        }));
        const metaB = flattenPacket(await dispatchPacketTool(globalResources, req, 'request_image_metadata', {
            filename: lookedB.filename
        }));
        const seedA = metaA.seed != null ? String(metaA.seed) : null;
        const seedB = metaB.seed != null ? String(metaB.seed) : null;
        const diff = await compareImageFiles(pathA.filePath, pathB.filePath);
        return mcpImageResult({
            success: true,
            filenameA: lookedA.filename,
            filenameB: lookedB.filename,
            seedA,
            seedB,
            sameSeed: !!(seedA && seedB && seedA === seedB),
            sameSeedWarning: (seedA && seedB && seedA !== seedB)
                ? 'Seeds differ — the diff includes composition change, not only the prompt edit.'
                : undefined,
            width: diff.width,
            height: diff.height,
            changedPercent: diff.changedPercent,
            meanDelta: diff.meanDelta,
            changedPixels: diff.changedPixels,
            imageKind: 'grok'
        }, diff.image);
    }

    if (name === 'evaluate_workspace_themes') {
        const workspaceId = resolveWorkspaceId(input.workspace || input.workspaceId);
        const metadataDb = globalResources.getMetadataDatabase && globalResources.getMetadataDatabase();
        if (!metadataDb || typeof metadataDb.listWorkspaceGalleryImageRows !== 'function') {
            return mcpTextResult({ success: false, error: 'Metadata database is not ready' }, true);
        }
        const limit = Math.min(120, Math.max(1, Number(input.limit) || 80));
        const rows = await metadataDb.listWorkspaceGalleryImageRows(workspaceId);
        const sample = rows.slice(0, limit);
        const metas = typeof metadataDb.getMultipleMetadata === 'function'
            ? await metadataDb.getMultipleMetadata(sample.map((row) => row.filename))
            : {};
        const themeRows = sample.map((row) => metas[row.filename] || row);
        const report = evaluateThemeRows(themeRows);
        return mcpTextResult({ ...report, workspaceId });
    }

    if (name === 'vfs_read') {
        if (input.fileId) {
            return mcpTextResult(await dispatchPacketTool(globalResources, req, 'vfs_download_file', {
                fileId: input.fileId
            }));
        }
        return mcpTextResult(await dispatchPacketTool(globalResources, req, 'vfs_read_system_file', {
            systemFileKey: input.systemFileKey || input.path,
            path: input.path
        }));
    }

    if (name === 'list_desktop_items') {
        input.workspaceId = resolveWorkspaceId(input.workspace || input.workspaceId);
        input.id = input.workspaceId;
    }

    if (name === 'vfs_list' && !input.path) {
        input.path = '/';
    }

    const generateNames = ['generate_image', 'generate_preset', 'upscale_image', 'expand_image'];
    if (generateNames.includes(name)) {
        let payload = flattenGenerateToolArgs(input);
        if (name === 'expand_image') {
            payload = mergeExpansionOverrideParams(payload);
        }
        if (payload.workspace || payload.workspaceId) {
            payload.workspace = resolveWorkspaceId(payload.workspace || payload.workspaceId);
        }
        payload.mcp_generated = true;
        const packet = await dispatchPacketTool(globalResources, req, def.packet, payload);
        const flat = flattenPacket(packet);
        const filename = sanitizeGalleryFilename(
            flat.filename || (Array.isArray(flat.filenames) ? flat.filenames[0] : '')
        );
        if (filename && packet.success) {
            try {
                const resolved = resolveGalleryImagePath(globalResources, filename);
                const image = await resizeImageForGrok(resolved.filePath);
                if (image) {
                    image.filename = filename;
                    return mcpImageResult({ ...flat, filename, imageKind: 'grok' }, image);
                }
            } catch (_) { /* metadata-only fallback */ }
        }
        return mcpTextResult({ ...flat, filename: filename || null }, !flat.success);
    }

    if (def.packet && name !== 'get_generated_image') {
        if (input.workspaceId || input.workspace) {
            input.workspaceId = resolveWorkspaceId(input.workspaceId || input.workspace);
            input.workspace = input.workspaceId;
        }
        const packet = await dispatchPacketTool(globalResources, req, def.packet, input);
        return mcpTextResult(flattenPacket(packet), !packet.success);
    }

    if (name === 'get_generated_image' || name === 'get_latest_image') {
        const lookedUp = await resolveGalleryFilename(globalResources, req, name === 'get_latest_image'
            ? { workspace: input.workspace, workspaceId: input.workspaceId }
            : input);
        const filename = lookedUp.filename;
        if (!filename) {
            return mcpTextResult({
                success: false,
                error: 'No gallery image matched. Pass filename, seed, or use get_latest_image.',
                workspaceId: lookedUp.workspaceId
            }, true);
        }
        const wantFull = input.full === true;
        const packet = await dispatchPacketTool(globalResources, req, 'request_image_metadata', { filename });
        const meta = flattenPacket(packet);
        let image = null;
        let imageKind = null;
        if (wantFull) {
            try {
                image = readGalleryImage(globalResources, filename);
                imageKind = 'full';
            } catch (error) {
                if (error.status === 404) {
                    return mcpTextResult({ ...meta, filename, image: null, error: 'Image file not found' }, !packet.success);
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
                    return mcpTextResult({ ...meta, filename, image: null, error: 'Image file not found' }, !packet.success);
                }
                throw error;
            }
        }
        if (!image) {
            return mcpTextResult({
                ...meta,
                filename,
                image: null,
                imageKind: null,
                error: 'Could not resize image for Grok'
            }, !packet.success);
        }
        return mcpImageResult({
            ...meta,
            filename,
            imageKind,
            workspaceId: lookedUp.workspaceId,
            latest: !!lookedUp.latest
        }, image);
    }

    if (name === 'list_clients') {
        return mcpTextResult({
            success: true,
            boundClientId: getBoundClientId(),
            clients: listClients(globalResources)
        });
    }

    if (name === 'get_studio_state') {
        const bind = autoBindIfNeeded(globalResources);
        const bound = getBoundRecord(globalResources);
        if (!bound) {
            return mcpTextResult({
                success: false,
                error: bind.clients && bind.clients.length > 1
                    ? 'Several Studio tabs are connected. Call advanced_tools with query "bind", then run bind_session with one clientId.'
                    : 'No Studio client is connected. Open Studio in the browser, then retry.',
                clients: bind.clients || []
            }, true);
        }
        const scopePayload = buildAgentScopePayload(req, globalResources);
        try {
            const data = await sendBoundCommand(globalResources, 'get_state', {}, 8000);
            const change = (data && data.change && typeof data.change === 'object' && !Array.isArray(data.change))
                ? data.change
                : null;
            const settings = buildStudioSettingsCatalog(globalResources, data.model);
            return mcpTextResult({
                success: true,
                bound: true,
                autoBound: !!bind.auto,
                workspaceId: data.workspaceId || null,
                filename: data.filename || null,
                model: data.model || null,
                clientId: getBoundClientId(),
                change,
                settings,
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
                    settings: buildStudioSettingsCatalog(globalResources),
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
        const bind = autoBindIfNeeded(globalResources);
        if (!getBoundRecord(globalResources)) {
            return mcpTextResult({
                success: false,
                error: bind.clients && bind.clients.length > 1
                    ? 'Several Studio tabs are connected. Call advanced_tools with query "bind", then run bind_session with one clientId.'
                    : 'No Studio client is connected.',
                clients: bind.clients || []
            }, true);
        }
        const data = await applyStudioChanges(globalResources, input);
        return mcpTextResult({ success: true, autoBound: !!bind.auto, ...data });
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
                    serverInfo: buildMcpServerInfo(globalResources, currentMcpToolsRevision()),
                    instructions: MCP_INSTRUCTIONS
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
                result: { tools: listToolsForScopes(scopes, globalResources) }
            }
        };
    }

    if (method === 'tools/call') {
        const name = String(params.name || '').trim();
        const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
        const generating = isGenerateTool(name, args);
        const argsSummary = summarizeArgs(args);
        if (generating) {
            recordActivity(globalResources, {
                tool: name,
                argsSummary,
                resultSummary: { started: true },
                success: true,
                generating: true
            });
        }
        try {
            const result = await callTool(globalResources, req, name, args);
            recordActivity(globalResources, {
                tool: name,
                argsSummary,
                resultSummary: summarizeResult(result),
                success: !result || result.isError !== true,
                generating: generating ? false : undefined
            });
            return { status: 200, body: { jsonrpc: '2.0', id, result } };
        } catch (error) {
            const status = error && error.status ? error.status : 500;
            const messageText = status >= 500 ? 'Tool call failed' : (error.message || 'Tool call failed');
            const failResult = mcpTextResult({
                success: false,
                error: messageText,
                code: error && error.code ? error.code : undefined,
                status
            }, true);
            recordActivity(globalResources, {
                tool: name,
                argsSummary,
                resultSummary: summarizeResult(failResult),
                success: false,
                generating: generating ? false : undefined
            });
            return {
                status: 200,
                body: {
                    jsonrpc: '2.0',
                    id,
                    result: failResult
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
        collectFilenames,
        isCheapMcpRequest,
        resizeImageForGrok,
        GROK_IMAGE_MAX_EDGE,
        rateGroupForTool,
        rateGroupForCall,
        ADVANCED_TOOL_NAME,
        ADVANCED_TOOL_DEF,
        listAdvancedToolDefs,
        handleAdvancedTools,
        callTool,
        consumeRateGroup,
        resetRateGroupHits,
        MCP_RATE_GROUP_LIMITS,
        TOOL_RATE_GROUPS,
        MCP_INSTRUCTIONS,
        resolveWorkspaceId,
        flattenPacket,
        listToolsForScopes,
        toolAllowedForScopes,
        collectAutofillTerms,
        collectOmegasearchBlocks,
        studioChangeFromPreset,
        searchStaticWikiPages,
        handleJsonRpc,
        applyStudioChanges,
        getBoundRecord,
        currentMcpToolsRevision,
        buildMcpServerInfo
    }
};
