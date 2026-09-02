'use strict';

/**
 * MCP Module Registry
 * 
 * Breaks existing MCP tools into registered module sets. Clients select which
 * modules they use via application key scopes (sfapp_cake_pantry, etc.).
 * 
 * Example: Grok web must not get cake feeding. A bot may have deliver without consume.
 */

/**
 * Module definitions. Each module maps to a set of tool names.
 * Core tools (generation, gallery, etc.) use existing scope-based filtering.
 * These modules add specialized tool groups on top.
 */
const MODULE_DEFS = {
    // Core modules (map to existing scopes)
    core_generation: {
        id: 'core_generation',
        scope: 'generation',
        label: 'Core Generation',
        description: 'Image generation, Studio control, presets',
        tools: [
            'generate_image', 'get_generation_job', 'await_generation_job',
            'get_session_state', 'get_studio_state', 'get_open_windows', 'get_client_physics',
            'list_clients', 'bind_session', 'apply_studio_changes',
            'get_linkxi_persona', 'save_linkxi_persona',
            'get_prompt_guide', 'list_memories', 'search_memories', 'get_memory', 'save_memory',
            'upscale_image', 'expand_image'
        ]
    },
    core_gallery: {
        id: 'core_gallery',
        scope: 'gallery',
        label: 'Core Gallery',
        description: 'Gallery browse and image retrieval',
        tools: [
            'get_generated_image', 'get_latest_image', 'get_images',
            'delete_images', 'open_in_lumen', 'open_in_glancewell',
            'compare_images', 'evaluate_workspace_themes'
        ]
    },
    core_workspace: {
        id: 'core_workspace',
        scope: 'workspace',
        label: 'Core Workspace',
        description: 'Workspace and desktop management',
        tools: ['get_workspaces', 'scrap_images', 'toggle_favorite']
    },
    core_search: {
        id: 'core_search',
        scope: 'search',
        label: 'Core Search',
        description: 'Tag and file search, NAX',
        tools: ['search_nax', 'list_nax_galleries', 'omegasearch']
    },
    core_autofill: {
        id: 'core_autofill',
        scope: 'autofill',
        label: 'Core Autofill',
        description: 'Autocomplete and tag lookup',
        tools: ['search_autofill']
    },
    core_wiki: {
        id: 'core_wiki',
        scope: 'wiki',
        label: 'Core Wiki',
        description: 'Tag wiki and Grimoire',
        tools: [
            'search_wiki', 'get_wiki_page',
            'list_static_wiki_sites', 'list_static_wiki_pages', 'search_static_wiki', 'get_static_wiki_page'
        ]
    },
    core_presets: {
        id: 'core_presets',
        scope: 'presets',
        label: 'Core Presets',
        description: 'Preset management',
        tools: ['list_presets', 'search_presets', 'get_preset', 'save_preset', 'apply_preset_to_studio', 'generate_preset']
    },
    core_references: {
        id: 'core_references',
        scope: 'references',
        label: 'Core References',
        description: 'Reference images and vibes',
        tools: ['list_references', 'get_references_by_ids', 'list_workspace_references', 'upload_reference']
    },
    core_notes: {
        id: 'core_notes',
        scope: 'notes',
        label: 'Core Notes',
        description: 'Notepad read/write',
        tools: ['list_notes', 'list_notes_by_workspace', 'get_note', 'create_note', 'update_note', 'save_note_content']
    },
    core_vfs: {
        id: 'core_vfs',
        scope: 'vfs',
        label: 'Core VFS',
        description: 'Virtual file system',
        tools: ['vfs_list', 'vfs_read', 'vfs_stat', 'vfs_write', 'vfs_delete', 'list_desktop_items']
    },

    // Specialized modules
    cake_pantry: {
        id: 'cake_pantry',
        scope: 'sfapp_cake_pantry',
        label: 'Cake Pantry',
        description: 'Account-based cake tracking (deliver, feed, inspect, consume)',
        tools: ['deliver_cake', 'feed_cake', 'inspect_pantry', 'consume_cake'],
        submodules: {
            deliver: ['deliver_cake'],
            feed: ['feed_cake'],
            inspect: ['inspect_pantry'],
            consume: ['consume_cake']
        }
    },
    report_issue: {
        id: 'report_issue',
        scope: 'sfapp_report_issue',
        label: 'Report Issue',
        description: 'Development QA reporting (tool failures, errors, reviews)',
        tools: ['report_issue'],
        config: {
            levels: {
                0: 'critical',     // Recurring failure/confusion only
                1: 'errors',       // Misunderstandings and errors
                2: 'detailed',     // More detailed level 1
                3: 'all'           // All good and bad reviews
            },
            defaultLevel: 1
        }
    }
};

/**
 * Scope name to module id mapping for quick lookup
 */
const SCOPE_TO_MODULE = {};
for (const [moduleId, def] of Object.entries(MODULE_DEFS)) {
    SCOPE_TO_MODULE[def.scope] = moduleId;
}

/**
 * Tool name to module id(s) mapping
 */
const TOOL_TO_MODULES = {};
for (const [moduleId, def] of Object.entries(MODULE_DEFS)) {
    for (const toolName of def.tools) {
        if (!TOOL_TO_MODULES[toolName]) {
            TOOL_TO_MODULES[toolName] = [];
        }
        TOOL_TO_MODULES[toolName].push(moduleId);
    }
}

/**
 * Get module definition by id
 */
function getModule(moduleId) {
    return MODULE_DEFS[moduleId] || null;
}

/**
 * Get module by scope name
 */
function getModuleByScope(scope) {
    const moduleId = SCOPE_TO_MODULE[scope];
    return moduleId ? MODULE_DEFS[moduleId] : null;
}

/**
 * List all available modules
 */
function listModules() {
    return Object.values(MODULE_DEFS).map((def) => ({
        id: def.id,
        scope: def.scope,
        label: def.label,
        description: def.description,
        toolCount: def.tools.length,
        hasSubmodules: !!def.submodules
    }));
}

/**
 * Get all tools for a module (including submodule filtering)
 */
function getModuleTools(moduleId, submodule = null) {
    const def = MODULE_DEFS[moduleId];
    if (!def) return [];
    if (submodule && def.submodules && def.submodules[submodule]) {
        return def.submodules[submodule].slice();
    }
    return def.tools.slice();
}

/**
 * Check if a tool belongs to a module
 */
function toolInModule(toolName, moduleId) {
    const modules = TOOL_TO_MODULES[toolName];
    return modules && modules.includes(moduleId);
}

/**
 * Check if scopes allow access to a module
 */
function scopesAllowModule(scopes, moduleId) {
    if (!Array.isArray(scopes) || !scopes.length) return false;
    if (scopes.includes('universal')) return true;
    const def = MODULE_DEFS[moduleId];
    if (!def) return false;
    return scopes.includes(def.scope);
}

/**
 * Check if scopes allow access to a tool via any module
 */
function scopesAllowModuleTool(scopes, toolName) {
    if (!Array.isArray(scopes) || !scopes.length) return false;
    if (scopes.includes('universal')) return true;
    const modules = TOOL_TO_MODULES[toolName];
    if (!modules || !modules.length) return true; // Not module-controlled
    return modules.some((moduleId) => scopesAllowModule(scopes, moduleId));
}

/**
 * Filter tools list based on scopes and requested modules
 * @param {string[]} scopes - Application key scopes
 * @param {string[]} requestedModules - Explicitly requested modules (optional)
 * @param {string[]} tools - List of tool names to filter
 * @returns {string[]} - Filtered tool names
 */
function filterToolsByModules(scopes, requestedModules, tools) {
    if (!Array.isArray(tools)) return [];
    if (!Array.isArray(scopes) || scopes.includes('universal')) {
        // Universal scope gets all tools unless modules explicitly limit
        if (!Array.isArray(requestedModules) || !requestedModules.length) {
            return tools.slice();
        }
    }
    return tools.filter((toolName) => {
        // Check existing scope-based permissions
        const modules = TOOL_TO_MODULES[toolName];
        if (!modules || !modules.length) {
            // Tool not in any module - allow if not scope-restricted elsewhere
            return true;
        }
        // Check if any module allows this tool
        const allowed = modules.some((moduleId) => {
            const def = MODULE_DEFS[moduleId];
            if (!def) return false;
            // Check scope permission
            if (!scopes.includes('universal') && !scopes.includes(def.scope)) {
                return false;
            }
            // Check explicit module request (if specified)
            if (Array.isArray(requestedModules) && requestedModules.length) {
                return requestedModules.includes(moduleId);
            }
            return true;
        });
        return allowed;
    });
}

/**
 * Parse module specifiers from scopes
 * Scopes like "sfapp_cake_pantry" or "sfapp_cake_pantry:deliver" map to modules
 * @param {string[]} scopes
 * @returns {{ modules: string[], submodules: Map<string, string[]> }}
 */
function parseModuleScopesFromScopes(scopes) {
    const modules = [];
    const submodules = new Map();
    if (!Array.isArray(scopes)) return { modules, submodules };
    for (const scope of scopes) {
        if (typeof scope !== 'string') continue;
        // Check for submodule specifier (scope:submodule)
        const parts = scope.split(':');
        const baseScope = parts[0];
        const submoduleName = parts[1] || null;
        const moduleId = SCOPE_TO_MODULE[baseScope];
        if (moduleId) {
            if (!modules.includes(moduleId)) {
                modules.push(moduleId);
            }
            if (submoduleName) {
                const def = MODULE_DEFS[moduleId];
                if (def && def.submodules && def.submodules[submoduleName]) {
                    if (!submodules.has(moduleId)) {
                        submodules.set(moduleId, []);
                    }
                    const list = submodules.get(moduleId);
                    if (!list.includes(submoduleName)) {
                        list.push(submoduleName);
                    }
                }
            }
        }
    }
    return { modules, submodules };
}

/**
 * Check if scopes contain a module scope (with or without submodule specifier)
 * @param {string[]} scopes
 * @param {string} moduleScope - The base scope like 'sfapp_cake_pantry'
 * @returns {boolean}
 */
function scopesContainModule(scopes, moduleScope) {
    if (!Array.isArray(scopes)) return false;
    for (const scope of scopes) {
        if (typeof scope !== 'string') continue;
        const baseScope = scope.split(':')[0];
        if (baseScope === moduleScope) return true;
    }
    return false;
}

/**
 * Get effective tools for a set of scopes with module/submodule filtering
 * @param {string[]} scopes
 * @param {string[]} allTools - Full list of available tool names
 * @returns {string[]}
 */
function getEffectiveToolsForScopes(scopes, allTools) {
    if (!Array.isArray(scopes)) return [];
    if (scopes.includes('universal')) return allTools.slice();

    const { modules, submodules } = parseModuleScopesFromScopes(scopes);
    const allowed = new Set();

    for (const toolName of allTools) {
        const toolModules = TOOL_TO_MODULES[toolName];
        if (!toolModules || !toolModules.length) {
            // Not module-controlled - use existing scope check
            allowed.add(toolName);
            continue;
        }
        for (const moduleId of toolModules) {
            const def = MODULE_DEFS[moduleId];
            if (!def) continue;
            // Check if module scope is present (base scope or with submodule specifier)
            if (!scopesContainModule(scopes, def.scope)) continue;
            // Check submodule filtering
            if (submodules.has(moduleId)) {
                const requestedSubs = submodules.get(moduleId);
                // Only allow tools from requested submodules
                const subToolsAllowed = requestedSubs.some((sub) => {
                    const subTools = def.submodules && def.submodules[sub];
                    return subTools && subTools.includes(toolName);
                });
                if (subToolsAllowed) {
                    allowed.add(toolName);
                }
            } else {
                // No submodule filter - allow all tools in module
                allowed.add(toolName);
            }
        }
    }
    return Array.from(allowed);
}

/**
 * Get module config (for modules like report_issue with configurable levels)
 */
function getModuleConfig(moduleId) {
    const def = MODULE_DEFS[moduleId];
    return def && def.config ? { ...def.config } : null;
}

/**
 * List specialized (non-core) modules
 */
function listSpecializedModules() {
    return Object.values(MODULE_DEFS)
        .filter((def) => def.scope.startsWith('sfapp_'))
        .map((def) => ({
            id: def.id,
            scope: def.scope,
            label: def.label,
            description: def.description,
            tools: def.tools.slice(),
            submodules: def.submodules ? Object.keys(def.submodules) : null,
            config: def.config || null
        }));
}

/**
 * Get all sfapp_ scope names for use in AVAILABLE_SCOPES
 */
function getModuleScopeDefinitions() {
    return Object.values(MODULE_DEFS)
        .filter((def) => def.scope.startsWith('sfapp_'))
        .map((def) => ({
            id: def.scope,
            label: def.label,
            description: def.description
        }));
}

module.exports = {
    MODULE_DEFS,
    SCOPE_TO_MODULE,
    TOOL_TO_MODULES,
    getModule,
    getModuleByScope,
    listModules,
    getModuleTools,
    toolInModule,
    scopesAllowModule,
    scopesAllowModuleTool,
    scopesContainModule,
    filterToolsByModules,
    parseModuleScopesFromScopes,
    getEffectiveToolsForScopes,
    getModuleConfig,
    listSpecializedModules,
    getModuleScopeDefinitions
};
