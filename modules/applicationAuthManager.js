const crypto = require('crypto');
const { getDb } = require('./applicationAuthDatabase');
const { OMEGASEARCH_QUERY_PACKET_SCHEMA } = require('./omegasearchFilters');
const { parseCidr, ipInCidrs } = require('./clientAddress');

const APP_KEY_PREFIX = 'sfapp_';
const TEMP_TOKEN_PREFIX = 'sftok_';

/** Scope → WebSocket packet types (subset; universal bypasses). */
const SCOPE_WS_PACKETS = {
    gallery: [
        'request_gallery', 'request_image_metadata', 'delete_images_bulk',
        'delete_unupscaled_original',
        'gallery_position_hint', 'send_to_sequenzia_bulk', 'update_image_preset_bulk',
        'get_similar_image_groups', 'scrap_similar_images'
    ],
    generation: [
        'generate_image', 'generate_preset', 'cancel_generation', 'upscale_image',
        'enhance_image', 'max_enhance_image',
        'expand_image', 'preview_expand_image_prompt', 'reroll_expanded_image',
        'reroll_image', 'resolve_dynamic_context', 'compile_dynamic_generation',
        'apply_tendai_preview', 'resolve_text_replacements',
        'get_persona_settings', 'save_persona_settings', 'update_persona_settings',
        'list_memory_image_links', 'link_memory_image', 'unlink_memory_image'
    ],
    workspace: [
        'workspace_list', 'workspace_get', 'workspace_create', 'workspace_delete', 'workspace_activate',
        'workspace_update', 'workspace_dump', 'workspace_get_files', 'workspace_move_files',
        'workspace_get_scraps', 'workspace_get_pinned',
        'workspace_add_pinned', 'workspace_remove_pinned', 'workspace_add_scrap',
        'workspace_remove_scrap', 'workspace_bulk_add_scrap', 'workspace_bulk_remove_scrap',
        'workspace_bulk_pinned',
        'workspace_get_groups', 'workspace_get_group', 'workspace_get_image_groups',
        'desktop_add_shortcut', 'desktop_update_shortcut',
        'desktop_remove_shortcut', 'desktop_update_positions'
    ],
    search: [
        'search_tags', 'search_dataset_tags', 'search_files', 'search_characters',
        // omegasearch_query — see OMEGASEARCH_QUERY_PACKET_SCHEMA in omegasearchFilters.js
        'omegasearch_query',
        'search_index_status', 'search_index_pause', 'search_index_resume',
        'search_index_rebuild', 'spellcheck_add_word'
    ],
    vfs: [
        'vfs_list', 'vfs_read', 'vfs_write', 'vfs_delete', 'vfs_mkdir', 'vfs_move',
        'vfs_copy', 'vfs_stat', 'vfs_search',
        'vfs_list_directory', 'vfs_get_path_stats', 'vfs_resolve_path',
        'vfs_read_system_file', 'vfs_download_file', 'vfs_download_system_file',
        'vfs_upload_file', 'vfs_replace_file', 'vfs_delete_entry', 'vfs_delete_file',
        'vfs_rename_file', 'vfs_rename_folder', 'vfs_rename_entry', 'vfs_move_to_trash',
        'vfs_create_folder', 'vfs_create_shortcut', 'vfs_update_shortcut_entry', 'vfs_move_items', 'vfs_copy_items',
        'desktop_get_shortcuts', 'desktop_get_settings'
    ],
    presets: [
        'get_presets', 'search_presets', 'load_preset', 'save_preset', 'update_preset',
        'delete_preset', 'get_preset_groups', 'save_preset_group', 'delete_preset_group',
        'regenerate_preset_uuid'
    ],
    chat: [
        'create_chat_session', 'send_chat_message', 'get_chat_history', 'delete_chat_session',
        'get_persona_settings', 'save_persona_settings', 'update_persona_settings'
    ],
    references: [
        'get_references', 'upload_reference', 'delete_reference', 'encode_vibe',
        'get_vibe_bundle', 'delete_vibe'
    ],
    wiki: [
        'search_tag_wiki', 'get_tag_wiki_page', 'refresh_tag_wiki_page',
        'get_static_wiki_site_index', 'get_static_wiki_page', 'get_wiki_home',
        'resolve_grimoire_url', 'get_apocrypha_zine',
        'import_fandom_wiki_page', 'import_static_wiki', 'update_wiki_import',
        'delete_fandom_wiki_import'
    ],
    autofill: [
        'get_autofill_ranking', 'test_autofill_ranking', 'update_autofill_ranking',
        'fetch_autofill_wiki_previews',
        'search_tag_wiki', 'get_tag_wiki_page', 'refresh_tag_wiki_page',
        'get_static_wiki_site_index', 'get_static_wiki_page', 'get_wiki_home',
        'resolve_grimoire_url', 'get_apocrypha_zine'
    ],
    notes: [
        'notes_create', 'notes_get', 'notes_get_by_workspace', 'notes_get_all',
        'notes_get_all_metadata', 'notes_update', 'notes_save_content', 'notes_delete'
    ],
    knowledge: [
        'list_knowledge_memories', 'get_knowledge_memory', 'delete_knowledge_memory',
        'delete_knowledge_memories_bulk', 'count_knowledge_memories_by_filter',
        'delete_knowledge_memories_by_filter', 'update_knowledge_memory',
        'list_memory_image_links', 'link_memory_image', 'unlink_memory_image'
    ],
    nax: [
        'get_nax_galleries', 'get_nax_tags', 'get_nax_marked_tags', 'get_nax_expander_presets',
        'set_nax_favorite', 'set_nax_try', 'set_nax_hidden', 'generate_nax_custom_tag',
        'delete_nax_custom_tag', 'get_nax_vibes_gallery', 'clear_nax_vibes_gallery_cache'
    ],
    explore: [
        'get_novelai_explore_gallery', 'get_studio_explore_feed', 'get_novelai_explore_user', 'get_novelai_explore_post',
        'set_novelai_explore_post_like', 'downvote_novelai_explore_post', 'block_novelai_explore_creator',
        'list_novelai_explore_blocked_creators', 'clear_novelai_explore_gallery_cache',
        'ensure_novelai_explore_image', 'check_novelai_explore_upload', 'upload_novelai_explore_image'
    ],
    infrastructure: ['ping', 'pong', 'server_status', 'check_updates', 'version_check']
};

const AVAILABLE_SCOPES = [
    { id: 'universal', label: 'Universal', description: 'Full API access (admin keys only for destructive ops)' },
    { id: 'gallery', label: 'Gallery', description: 'Browse and manage gallery images' },
    { id: 'generation', label: 'Generation', description: 'Image generation, upscale, expand' },
    { id: 'workspace', label: 'Workspaces', description: 'Workspace and desktop management' },
    { id: 'search', label: 'Search', description: 'Tag and file search' },
    { id: 'vfs', label: 'VFS', description: 'Virtual file system access' },
    { id: 'presets', label: 'Presets', description: 'Preset and spellbook management' },
    { id: 'chat', label: 'Chat', description: 'Director and persona chat' },
    { id: 'references', label: 'References', description: 'Reference images and vibes' },
    { id: 'wiki', label: 'Wiki / Grimoire', description: 'Tag wiki and documentation' },
    { id: 'autofill', label: 'Autofill / Grimoire', description: 'Autofill ranking and tag wiki / Grimoire (not search)' },
    { id: 'notes', label: 'Notes', description: 'Notepad create, read, and update' },
    { id: 'knowledge', label: 'Knowledge', description: 'Knowledge memory read and update' },
    { id: 'nax', label: 'NAX', description: 'NovelAI Explore tags database and galleries' },
    { id: 'explore', label: 'Explore', description: 'NovelAI Explore (Agora) gallery and post operations' },
    { id: 'infrastructure', label: 'Infrastructure', description: 'Ping, status, version checks' },
    // Module-based scopes (sfapp_ prefix)
    { id: 'sfapp_cake_pantry', label: 'Cake Pantry', description: 'Account-based cake tracking (deliver, feed, inspect, consume)' },
    { id: 'sfapp_cake_pantry:deliver', label: 'Cake Pantry (Deliver)', description: 'Deliver cake slices only' },
    { id: 'sfapp_cake_pantry:feed', label: 'Cake Pantry (Feed)', description: 'Feed cake slices only' },
    { id: 'sfapp_cake_pantry:inspect', label: 'Cake Pantry (Inspect)', description: 'Inspect pantry only' },
    { id: 'sfapp_cake_pantry:consume', label: 'Cake Pantry (Consume)', description: 'Consume cake slices only' },
    { id: 'sfapp_report_issue', label: 'Report Issue', description: 'Development QA reporting (tool failures, errors, reviews)' },
    { id: 'sfapp_usage', label: 'Usage', description: 'NovelAI account usage data (Anlas, Opus meter, generation count)' },
    { id: 'sfapp_apocrypha', label: 'Apocrypha Publish', description: 'Publish Apocrypha zine content directly' }
];

const APPLICATION_AUTH_WS_PACKETS = new Set([
    'authenticate_application',
    'refresh_application_key',
    'request_temp_access_token',
    'request_application_authorization',
    'check_application_authorization',
    'claim_application_authorization'
]);

const ADMIN_MANAGEMENT_WS_PACKETS = new Set([
    'list_application_keys',
    'get_application_auth_scopes',
    'create_application_key',
    'update_application_key',
    'revoke_application_key',
    'list_application_auth_requests',
    'approve_application_auth_request',
    'deny_application_auth_request'
]);

function hashSecret(value) {
    return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function generateAppKey() {
    return APP_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
}

function generateTempToken() {
    return TEMP_TOKEN_PREFIX + crypto.randomBytes(24).toString('base64url');
}

function generateRequestCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

function isApplicationKeyFormat(token) {
    return typeof token === 'string' && token.startsWith(APP_KEY_PREFIX);
}

function isTempTokenFormat(token) {
    return typeof token === 'string' && token.startsWith(TEMP_TOKEN_PREFIX);
}

function parseScopesJson(raw) {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : ['universal'];
    } catch (_) {
        return ['universal'];
    }
}

/** Loopback hosts implied for every allowKeyless application. Not the whole /8. */
const KEYLESS_IMPLIED_CIDRS = Object.freeze(['127.0.0.1/32', '::1/128']);
const PERSISTENT_REFRESH_DAYS = 36500;

function parseTrustedCidrsJson(raw) {
    try {
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.map((entry) => String(entry)) : [];
    } catch (_) {
        return [];
    }
}

function canonicalCidr(parsed) {
    return `${parsed.ip}/${parsed.prefix}`;
}

function normalizeTrustedCidrList(value) {
    const raw = Array.isArray(value) ? value : String(value == null ? '' : value).split(/[\s,]+/);
    const cidrs = [];
    const seen = new Set();
    for (const entry of raw) {
        const token = String(entry || '').trim();
        if (!token) continue;
        const parsed = parseCidr(token);
        if (!parsed) {
            return { ok: false, error: `Invalid trusted CIDR: ${token}`, cidrs: [] };
        }
        const canonical = canonicalCidr(parsed);
        if (seen.has(canonical)) continue;
        seen.add(canonical);
        cidrs.push(canonical);
    }
    return { ok: true, cidrs };
}

function trustedAccessFlag(value) {
    return value === true || value === 1 || value === '1' || value === 'on' || value === 'true';
}

/**
 * allowKeyless, persistent, and trusted CIDRs.
 * Readonly consent sessions cannot set them (admin approval required).
 */
function parseTrustedAccessOptions(input, { admin = false } = {}) {
    if (!admin) {
        return { allowKeyless: false, persistent: false, trustedCidrs: [] };
    }
    const src = input && typeof input === 'object' ? input : {};
    const rawCidrs = src.trustedCidrs != null ? src.trustedCidrs : src.trusted_cidrs;
    const cidrs = normalizeTrustedCidrList(rawCidrs);
    if (!cidrs.ok) {
        const err = new Error(cidrs.error);
        err.code = 'INVALID_TRUSTED_CIDR';
        throw err;
    }
    const allowKeyless = trustedAccessFlag(src.allowKeyless != null ? src.allowKeyless : src.allow_keyless);
    const persistent = trustedAccessFlag(src.persistent);
    return { allowKeyless, persistent, trustedCidrs: cidrs.cidrs };
}

function keylessCidrsForRow(row) {
    return KEYLESS_IMPLIED_CIDRS.concat(parseTrustedCidrsJson(row && row.trusted_cidrs));
}

function actorFromKeyRow(row) {
    const userType = row && row.user_type === 'admin' ? 'admin' : 'readonly';
    return {
        userType,
        readOnly: userType !== 'admin',
        allowDelete: userType === 'admin',
        scopes: parseScopesJson(row && row.scopes),
        applicationKeyId: row ? row.id : null,
        appName: row && row.app_name ? row.app_name : null,
        persistent: !!(row && Number(row.persistent) === 1),
        allowKeyless: !!(row && Number(row.allow_keyless) === 1)
    };
}

function redactLoggedSecrets(value) {
    return String(value == null ? '' : value)
        .replace(/sfapp_[A-Za-z0-9_-]+/g, '[redacted]')
        .replace(/sftok_[A-Za-z0-9_-]+/g, '[redacted]');
}

function describeKeylessPacket(req) {
    const body = req && req.body;
    const item = Array.isArray(body) ? body[0] : body;
    let packet = '';
    let tool = '';
    if (item && typeof item === 'object' && !Array.isArray(item)) {
        if (typeof item.method === 'string') packet = item.method;
        if (typeof item.type === 'string' && !packet) packet = item.type;
        if (packet === 'tools/call' && item.params && typeof item.params.name === 'string') {
            tool = item.params.name;
        }
    }
    if (!packet && req) {
        packet = String(req.path || req.url || '').split('?')[0];
    }
    return {
        packet: redactLoggedSecrets(packet).slice(0, 120) || '-',
        tool: redactLoggedSecrets(tool).slice(0, 120) || '-'
    };
}

// JULES: Pre-compute static reverse lookup Map O(1) from packetType to scopes array
const PACKET_TO_SCOPES_MAP = new Map();
for (const [scopeId, packets] of Object.entries(SCOPE_WS_PACKETS)) {
    if (Array.isArray(packets)) {
        for (const packet of packets) {
            let scopes = PACKET_TO_SCOPES_MAP.get(packet);
            if (!scopes) {
                scopes = [];
                PACKET_TO_SCOPES_MAP.set(packet, scopes);
            }
            scopes.push(scopeId);
        }
    }
}

function normalizeScopes(scopes) {
    if (!Array.isArray(scopes) || scopes.length === 0) {
        return ['universal'];
    }
    const normalized = scopes.map((s) => String(s).trim()).filter(Boolean);
    if (normalized.includes('universal')) {
        return ['universal'];
    }
    return normalized.filter((s) => AVAILABLE_SCOPES.some((a) => a.id === s));
}

/** Replace a key's scope list. Empty is an error. Universal collapses the rest. */
function scopesForReplace(scopes) {
    if (!Array.isArray(scopes)) {
        const err = new Error('scopes must be a list');
        err.code = 'INVALID_SCOPES';
        throw err;
    }
    const cleaned = scopes.map((s) => String(s).trim()).filter(Boolean);
    if (cleaned.includes('universal')) return ['universal'];
    const allowed = new Set(AVAILABLE_SCOPES.map((s) => s.id));
    const next = [];
    for (const scope of cleaned) {
        if (!allowed.has(scope) || next.includes(scope)) continue;
        next.push(scope);
    }
    if (!next.length) {
        const err = new Error('At least one scope is required');
        err.code = 'EMPTY_SCOPES';
        throw err;
    }
    return next;
}

const EDITABLE_KEY_FIELDS = [
    'label', 'scopes', 'allowKeyless', 'persistent', 'trustedCidrs', 'allowDelete', 'expiresAt'
];

function editableKeySnapshot(row) {
    const summary = rowToKeySummary(row, true) || {};
    return {
        label: summary.appName || '',
        scopes: summary.scopes || [],
        allowKeyless: summary.allowKeyless === true,
        persistent: summary.persistent === true,
        trustedCidrs: summary.trustedCidrs || [],
        allowDelete: summary.allowDelete === true,
        expiresAt: summary.expiresAt == null ? null : summary.expiresAt
    };
}

function changedEditableFields(before, after) {
    return EDITABLE_KEY_FIELDS.filter((key) => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
}

function pickEditableFields(snapshot, fields) {
    const picked = {};
    (fields || []).forEach((key) => {
        picked[key] = snapshot[key];
    });
    return picked;
}

function getPacketScopes(packetType) {
    const type = String(packetType || '').trim();
    if (!type) return [];
    return PACKET_TO_SCOPES_MAP.get(type) || [];
}

function scopesAllowPacket(scopes, packetType) {
    if (!Array.isArray(scopes) || scopes.length === 0) return false;
    if (scopes.includes('universal')) return true;
    const required = getPacketScopes(packetType);
    if (!required.length) return false;
    return required.some((scopeId) => scopes.includes(scopeId));
}

function redactApplicationRequestPath(value) {
    const raw = String(value || '/').split('?')[0];
    const redacted = raw.replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/ig,
        '{id}'
    );
    return redacted.slice(0, 180) || '/';
}

function rowToKeySummary(row, includeExpired = false) {
    if (!row) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const persistent = Number(row.persistent) === 1;
    const allowKeyless = Number(row.allow_keyless) === 1;
    const expiresAt = row.expires_at != null ? row.expires_at * 1000 : null;
    const refreshBeforeAt = row.refresh_before_at * 1000;
    let status = row.status;
    if (status === 'active' && row.revoked_at) {
        status = 'revoked';
    } else if (!persistent && status === 'active' && expiresAt && expiresAt <= Date.now()) {
        status = 'expired';
    } else if (!persistent && status === 'active' && refreshBeforeAt <= Date.now()) {
        status = 'refresh_required';
    }

    if (!includeExpired && (status === 'revoked' || status === 'replaced')) {
        return null;
    }

    return {
        id: row.id,
        appName: row.app_name,
        keyPrefix: row.key_prefix,
        userAgent: row.user_agent,
        scopes: parseScopesJson(row.scopes),
        userType: row.user_type || 'admin',
        expiresAt,
        refreshBeforeAt,
        originalExpiresAt: row.original_expires_at != null ? row.original_expires_at * 1000 : null,
        createdAt: row.created_at * 1000,
        lastRefreshedAt: row.last_refreshed_at ? row.last_refreshed_at * 1000 : null,
        lastUsedAt: row.last_used_at ? row.last_used_at * 1000 : null,
        lastUsedIp: row.last_used_ip || '',
        revokedAt: row.revoked_at ? row.revoked_at * 1000 : null,
        status,
        isPerpetual: persistent || row.expires_at == null,
        persistent,
        allowKeyless,
        trustedCidrs: parseTrustedCidrsJson(row.trusted_cidrs),
        readOnly: (row.user_type || 'admin') !== 'admin',
        allowDelete: (row.user_type || 'admin') === 'admin',
        refreshOverdue: !persistent && (status === 'refresh_required' || (refreshBeforeAt <= Date.now() && status === 'active'))
    };
}

class ApplicationAuthManager {
    constructor(globalResources) {
        this.globalResources = globalResources;
    }

    listAvailableScopes() {
        return AVAILABLE_SCOPES.map((s) => ({ ...s }));
    }

    getScopeWsPackets(scopeId) {
        return SCOPE_WS_PACKETS[scopeId] || [];
    }

    isApplicationAuthPacket(type) {
        return APPLICATION_AUTH_WS_PACKETS.has(type) || ADMIN_MANAGEMENT_WS_PACKETS.has(type);
    }

    isAdminManagementPacket(type) {
        return ADMIN_MANAGEMENT_WS_PACKETS.has(type);
    }

    validateUserAgent(expected, actual) {
        if (!expected || !actual) return false;
        return String(expected).trim() === String(actual).trim();
    }

    async recordSeenUserAgent({ userAgent, applicationKeyId, matched, source = 'mcp' }) {
        const ua = String(userAgent || '').trim();
        const keyId = String(applicationKeyId || '').trim();
        if (!keyId) return;
        const nowSec = Math.floor(Date.now() / 1000);
        const matchedInt = matched ? 1 : 0;
        const existing = await getDb().get(
            `SELECT user_agent FROM application_user_agents_seen
             WHERE user_agent = ? AND application_key_id = ? AND source = ?`,
            [ua, keyId, source]
        );
        if (existing) {
            await getDb().run(
                `UPDATE application_user_agents_seen
                 SET last_seen_at = ?, seen_count = seen_count + 1, matched = ?
                 WHERE user_agent = ? AND application_key_id = ? AND source = ?`,
                [nowSec, matchedInt, ua, keyId, source]
            );
            return;
        }
        await getDb().run(
            `INSERT INTO application_user_agents_seen
             (user_agent, application_key_id, source, matched, first_seen_at, last_seen_at, seen_count)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [ua, keyId, source, matchedInt, nowSec, nowSec]
        );
    }

    async listSeenUserAgents({ applicationKeyId = null, source = 'mcp' } = {}) {
        if (applicationKeyId) {
            return getDb().all(
                `SELECT user_agent, application_key_id, source, matched, first_seen_at, last_seen_at, seen_count
                 FROM application_user_agents_seen
                 WHERE application_key_id = ? AND source = ?
                 ORDER BY last_seen_at DESC`,
                [applicationKeyId, source]
            );
        }
        return getDb().all(
            `SELECT user_agent, application_key_id, source, matched, first_seen_at, last_seen_at, seen_count
             FROM application_user_agents_seen
             WHERE source = ?
             ORDER BY last_seen_at DESC`,
            [source]
        );
    }

    async validateApplicationKey(rawKey, userAgent, {
        allowRefreshOverdue = false,
        skipUserAgent = false,
        unknownUserAgentBypass = false,
        clientIp = null
    } = {}) {
        if (!isApplicationKeyFormat(rawKey)) {
            return { valid: false, code: 'INVALID_KEY_FORMAT', message: 'Invalid application key format' };
        }

        const keyHash = hashSecret(rawKey);
        const row = await getDb().get(
            'SELECT * FROM application_keys WHERE key_hash = ? AND status = ? AND revoked_at IS NULL',
            [keyHash, 'active']
        );

        if (!row) {
            return { valid: false, code: 'INVALID_KEY', message: 'Invalid or revoked application key' };
        }

        const uaMatched = this.validateUserAgent(row.user_agent, userAgent);
        if (unknownUserAgentBypass) {
            await this.recordSeenUserAgent({
                userAgent,
                applicationKeyId: row.id,
                matched: uaMatched,
                source: 'mcp'
            });
        }
        if (!skipUserAgent && !uaMatched) {
            if (!unknownUserAgentBypass) {
                return { valid: false, code: 'USER_AGENT_MISMATCH', message: 'User-Agent does not match registered application' };
            }
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const persistent = Number(row.persistent) === 1;
        if (!persistent && row.expires_at != null && row.expires_at <= nowSec) {
            await getDb().run('UPDATE application_keys SET status = ? WHERE id = ?', ['expired', row.id]);
            return { valid: false, code: 'KEY_EXPIRED', message: 'Application key expired — re-authorize via login' };
        }

        if (!persistent && row.refresh_before_at <= nowSec && !allowRefreshOverdue) {
            return {
                valid: false,
                code: 'REFRESH_REQUIRED',
                message: 'Application key must be refreshed before use',
                refreshBeforeAt: row.refresh_before_at * 1000
            };
        }

        const usedIp = clientIp ? String(clientIp).slice(0, 80) : '';
        await getDb().run(
            'UPDATE application_keys SET last_used_at = ?, last_used_ip = ? WHERE id = ?',
            [nowSec, usedIp, row.id]
        );

        return {
            valid: true,
            keyRecord: row,
            scopes: parseScopesJson(row.scopes),
            userType: row.user_type || 'admin',
            applicationKeyId: row.id,
            appName: row.app_name || null,
            expiresAt: row.expires_at != null ? row.expires_at * 1000 : null,
            refreshBeforeAt: row.refresh_before_at * 1000,
            originalExpiresAt: row.original_expires_at != null ? row.original_expires_at * 1000 : null,
            persistent,
            userAgentMatched: uaMatched,
            userAgentBypassed: !!(unknownUserAgentBypass && !uaMatched)
        };
    }

    async validateTempToken(rawToken) {
        if (!isTempTokenFormat(rawToken)) {
            return { valid: false, code: 'INVALID_TOKEN_FORMAT', message: 'Invalid temp access token format' };
        }

        const tokenHash = hashSecret(rawToken);
        const nowSec = Math.floor(Date.now() / 1000);
        const row = await getDb().get(
            `SELECT t.*, k.user_type, k.app_name, k.scopes AS key_scopes
             FROM temp_access_tokens t
             JOIN application_keys k ON k.id = t.application_key_id
             WHERE t.token_hash = ? AND t.expires_at > ? AND t.uses_remaining > 0`,
            [tokenHash, nowSec]
        );

        if (!row) {
            return { valid: false, code: 'INVALID_TOKEN', message: 'Invalid or expired temp access token' };
        }

        const keyRow = await getDb().get(
            'SELECT * FROM application_keys WHERE id = ? AND status = ? AND revoked_at IS NULL',
            [row.application_key_id, 'active']
        );
        if (!keyRow) {
            return { valid: false, code: 'PARENT_KEY_INVALID', message: 'Parent application key is no longer valid' };
        }

        if (keyRow.expires_at != null && keyRow.expires_at <= nowSec) {
            return { valid: false, code: 'PARENT_KEY_EXPIRED', message: 'Parent application key expired' };
        }

        const usesRemaining = row.uses_remaining - 1;
        await getDb().run(
            'UPDATE temp_access_tokens SET uses_remaining = ? WHERE id = ?',
            [usesRemaining, row.id]
        );

        const keyScopes = parseScopesJson(row.key_scopes);
        const tokenScopes = row.scopes ? parseScopesJson(row.scopes) : keyScopes;

        return {
            valid: true,
            userType: row.user_type || 'admin',
            scopes: tokenScopes,
            applicationKeyId: row.application_key_id,
            appName: row.app_name || null,
            tempTokenId: row.id,
            skipUserAgentCheck: true
        };
    }

    hasScope(scopes, requiredScope) {
        if (!requiredScope) return true;
        if (!Array.isArray(scopes) || scopes.length === 0) return false;
        if (scopes.includes('universal')) return true;
        return scopes.includes(requiredScope);
    }

    getPacketScope(packetType) {
        return getPacketScopes(packetType)[0] || null;
    }

    getPacketScopes(packetType) {
        return getPacketScopes(packetType);
    }

    canAccessWsPacket(scopes, packetType, userType) {
        if (this.isApplicationAuthPacket(packetType)) {
            return true;
        }
        return scopesAllowPacket(scopes, packetType);
    }

    async createApplicationKey({
        appName,
        userAgent,
        scopes,
        userType = 'admin',
        expiresAt = null,
        refreshIntervalDays = 30,
        allowKeyless = false,
        persistent = false,
        trustedCidrs = []
    }) {
        const id = crypto.randomUUID();
        const rawKey = generateAppKey();
        const keyHash = hashSecret(rawKey);
        const keyPrefix = rawKey.slice(0, 12);
        const nowSec = Math.floor(Date.now() / 1000);
        const normalizedScopes = normalizeScopes(scopes);
        const isPersistent = persistent === true;
        const keyless = allowKeyless === true;
        const cidrNorm = normalizeTrustedCidrList(trustedCidrs);
        if (!cidrNorm.ok) {
            const err = new Error(cidrNorm.error);
            err.code = 'INVALID_TRUSTED_CIDR';
            throw err;
        }
        const refreshDays = isPersistent ? PERSISTENT_REFRESH_DAYS : Math.max(1, refreshIntervalDays);
        const refreshBeforeAt = nowSec + refreshDays * 86400;
        const expiresAtSec = isPersistent || expiresAt == null ? null : Math.floor(expiresAt / 1000);

        await getDb().run(
            `INSERT INTO application_keys
             (id, key_hash, key_prefix, app_name, user_agent, scopes, user_type,
              expires_at, refresh_before_at, original_expires_at, created_at, last_refreshed_at, status,
              allow_keyless, persistent, trusted_cidrs)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, keyHash, keyPrefix, String(appName).trim(), String(userAgent).trim(),
                JSON.stringify(normalizedScopes), userType === 'readonly' ? 'readonly' : 'admin',
                expiresAtSec, refreshBeforeAt, expiresAtSec, nowSec, nowSec, 'active',
                keyless ? 1 : 0, isPersistent ? 1 : 0, JSON.stringify(cidrNorm.cidrs)
            ]
        );

        const row = await getDb().get('SELECT * FROM application_keys WHERE id = ?', [id]);
        return {
            key: rawKey,
            summary: rowToKeySummary(row, true)
        };
    }

    async refreshApplicationKey(rawKey, userAgent) {
        const validation = await this.validateApplicationKey(rawKey, userAgent, { allowRefreshOverdue: true });
        if (!validation.valid) {
            return validation;
        }

        const oldRow = validation.keyRecord;
        const nowSec = Math.floor(Date.now() / 1000);

        if (Number(oldRow.persistent) === 1) {
            return {
                valid: false,
                code: 'PERSISTENT_NO_REFRESH',
                message: 'Persistent keys do not expire or refresh'
            };
        }

        if (oldRow.expires_at != null && oldRow.expires_at <= nowSec) {
            await getDb().run('UPDATE application_keys SET status = ? WHERE id = ?', ['expired', oldRow.id]);
            return { valid: false, code: 'KEY_EXPIRED', message: 'Application key expired — re-authorize via login' };
        }

        const newId = crypto.randomUUID();
        const newRawKey = generateAppKey();
        const newHash = hashSecret(newRawKey);
        const newPrefix = newRawKey.slice(0, 12);

        const refreshIntervalSec = Math.max(86400, oldRow.refresh_before_at - (oldRow.last_refreshed_at || oldRow.created_at));
        const newRefreshBefore = nowSec + refreshIntervalSec;

        await getDb().run('BEGIN');
        try {
            await getDb().run(
                'UPDATE application_keys SET status = ?, replaced_by_id = ?, revoked_at = ? WHERE id = ?',
                ['replaced', newId, nowSec, oldRow.id]
            );
            await getDb().run(
                `INSERT INTO application_keys
                 (id, key_hash, key_prefix, app_name, user_agent, scopes, user_type,
                  expires_at, refresh_before_at, original_expires_at, created_at, last_refreshed_at, status,
                  allow_keyless, persistent, trusted_cidrs)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    newId, newHash, newPrefix, oldRow.app_name, oldRow.user_agent, oldRow.scopes,
                    oldRow.user_type, oldRow.expires_at, newRefreshBefore, oldRow.original_expires_at,
                    oldRow.created_at, nowSec, 'active',
                    Number(oldRow.allow_keyless) === 1 ? 1 : 0,
                    0,
                    oldRow.trusted_cidrs || '[]'
                ]
            );
            await getDb().run('COMMIT');
        } catch (err) {
            await getDb().run('ROLLBACK');
            throw err;
        }

        const row = await getDb().get('SELECT * FROM application_keys WHERE id = ?', [newId]);
        return {
            valid: true,
            key: newRawKey,
            summary: rowToKeySummary(row, true),
            previousKeyId: oldRow.id
        };
    }

    async revokeApplicationKey(keyId) {
        const nowSec = Math.floor(Date.now() / 1000);
        const result = await getDb().run(
            'UPDATE application_keys SET status = ?, revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
            ['revoked', nowSec, keyId]
        );
        return { success: (result?.changes || 0) > 0 };
    }

    /**
     * Update one key by id. Does not mint, rotate, or return a secret.
     * Reissue stays on refreshApplicationKey.
     */
    async updateApplicationKey(keyId, patch, options = {}) {
        const src = patch && typeof patch === 'object' ? patch : {};
        const opts = options && typeof options === 'object' ? options : {};
        if (!keyId) return { success: false, error: 'Application key not found', code: 'KEY_NOT_FOUND' };
        const known = ['label', 'appName', 'scopes', 'allowKeyless', 'allow_keyless', 'persistent', 'trustedCidrs', 'trusted_cidrs', 'allowDelete', 'allow_delete', 'userType', 'perpetual', 'expiresAt', 'expiresInDays', 'refreshIntervalDays'];
        if (!known.some((key) => src[key] !== undefined)) {
            return { success: false, error: 'Nothing to update', code: 'NOTHING_TO_UPDATE' };
        }
        const row = await getDb().get('SELECT * FROM application_keys WHERE id = ?', [keyId]);
        if (!row) return { success: false, error: 'Application key not found', code: 'KEY_NOT_FOUND' };
        if (row.revoked_at || row.status === 'revoked' || row.status === 'replaced') {
            return { success: false, error: 'Application key cannot be edited', code: 'NOT_EDITABLE' };
        }
        if (opts.userType && row.user_type && row.user_type !== opts.userType
            && src.allowDelete == null && src.allow_delete == null && src.userType == null) {
            return { success: false, error: 'USER_TYPE_MISMATCH', code: 'USER_TYPE_MISMATCH' };
        }

        let appName = row.app_name;
        let scopesJson = row.scopes;
        let userType = row.user_type === 'readonly' ? 'readonly' : 'admin';
        let allowKeyless = Number(row.allow_keyless) === 1 ? 1 : 0;
        let persistent = Number(row.persistent) === 1 ? 1 : 0;
        let trustedJson = row.trusted_cidrs || '[]';
        let expiresAt = row.expires_at;
        let refreshBefore = row.refresh_before_at;
        let status = row.status === 'expired' ? 'expired' : 'active';
        const nowSec = Math.floor(Date.now() / 1000);

        if (src.label != null || src.appName != null) {
            const label = String(src.label != null ? src.label : src.appName).trim();
            if (!label) return { success: false, error: 'Label is required', code: 'MISSING_LABEL' };
            appName = label.slice(0, 120);
        }
        if (src.scopes != null) {
            try {
                scopesJson = JSON.stringify(scopesForReplace(src.scopes));
            } catch (err) {
                return { success: false, error: err.message, code: err.code || 'INVALID_SCOPES' };
            }
        }
        if (src.allowKeyless != null || src.allow_keyless != null) {
            const flag = src.allowKeyless != null ? src.allowKeyless : src.allow_keyless;
            allowKeyless = trustedAccessFlag(flag) ? 1 : 0;
        }
        if (src.persistent != null) {
            persistent = trustedAccessFlag(src.persistent) ? 1 : 0;
        }
        if (src.trustedCidrs != null || src.trusted_cidrs != null) {
            const cidrs = normalizeTrustedCidrList(src.trustedCidrs != null ? src.trustedCidrs : src.trusted_cidrs);
            if (!cidrs.ok) return { success: false, error: cidrs.error, code: 'INVALID_TRUSTED_CIDR' };
            trustedJson = JSON.stringify(cidrs.cidrs);
        }
        if (src.allowDelete != null || src.allow_delete != null) {
            const flag = src.allowDelete != null ? src.allowDelete : src.allow_delete;
            userType = trustedAccessFlag(flag) ? 'admin' : 'readonly';
        } else if (src.userType != null) {
            userType = src.userType === 'readonly' ? 'readonly' : 'admin';
        }
        if (src.perpetual === true || src.expiresAt === null) {
            expiresAt = null;
        } else if (src.expiresAt != null) {
            const ms = Number(src.expiresAt);
            if (!Number.isFinite(ms)) return { success: false, error: 'Invalid expiry', code: 'INVALID_EXPIRY' };
            expiresAt = Math.floor(ms / 1000);
        } else if (src.expiresInDays != null) {
            const days = parseInt(src.expiresInDays, 10);
            if (!Number.isFinite(days) || days < 1) return { success: false, error: 'Invalid expiry', code: 'INVALID_EXPIRY' };
            expiresAt = nowSec + days * 86400;
        }
        if (persistent === 1) {
            expiresAt = null;
            if (Number(row.persistent) !== 1) {
                refreshBefore = nowSec + PERSISTENT_REFRESH_DAYS * 86400;
            }
        } else if (Number(row.persistent) === 1) {
            const days = src.refreshIntervalDays != null ? Math.max(1, parseInt(src.refreshIntervalDays, 10) || 30) : 30;
            refreshBefore = nowSec + days * 86400;
        } else if (src.refreshIntervalDays != null) {
            const days = Math.max(1, parseInt(src.refreshIntervalDays, 10) || 30);
            refreshBefore = nowSec + days * 86400;
        }
        if (persistent === 1 || expiresAt == null || expiresAt > nowSec) {
            if (status === 'expired') status = 'active';
        } else if (expiresAt != null && expiresAt <= nowSec) {
            status = 'expired';
        }

        const before = editableKeySnapshot(row);
        const preview = Object.assign({}, row, {
            app_name: appName,
            scopes: scopesJson,
            user_type: userType,
            allow_keyless: allowKeyless,
            persistent,
            trusted_cidrs: trustedJson,
            expires_at: expiresAt,
            refresh_before_at: refreshBefore,
            status
        });
        const after = editableKeySnapshot(preview);
        const fields = changedEditableFields(before, after);
        if (!fields.length) {
            return {
                success: true,
                unchanged: true,
                reissued: false,
                summary: rowToKeySummary(row, true)
            };
        }

        const hashBefore = row.key_hash;
        const prefixBefore = row.key_prefix;
        const written = await getDb().run(
            `UPDATE application_keys
             SET app_name = ?, scopes = ?, user_type = ?, expires_at = ?, refresh_before_at = ?,
                 allow_keyless = ?, persistent = ?, trusted_cidrs = ?, status = ?
             WHERE id = ? AND revoked_at IS NULL AND status NOT IN ('revoked', 'replaced')`,
            [appName, scopesJson, userType, expiresAt, refreshBefore, allowKeyless, persistent, trustedJson, status, keyId]
        );
        if (!written || !written.changes) {
            return { success: false, error: 'Application key cannot be edited', code: 'NOT_EDITABLE' };
        }
        const updated = await getDb().get('SELECT * FROM application_keys WHERE id = ?', [keyId]);
        if (!updated || updated.key_hash !== hashBefore || updated.key_prefix !== prefixBefore) {
            return { success: false, error: 'Application key secret was not kept', code: 'KEY_MUTATED' };
        }
        const audit = await this._auditApplicationKeyEdit(updated, {
            before,
            after: editableKeySnapshot(updated),
            fields,
            options: opts
        });
        return {
            success: true,
            unchanged: false,
            reissued: false,
            summary: rowToKeySummary(updated, true),
            audit
        };
    }

    async _auditApplicationKeyEdit(row, { before, after, fields, options }) {
        const opts = options || {};
        const entry = {
            event: 'application_key_edited',
            keyId: String(row.id).slice(0, 80),
            label: redactLoggedSecrets(row.app_name || '').slice(0, 120),
            fields: fields.slice(),
            before: pickEditableFields(before, fields),
            after: pickEditableFields(after, fields),
            source: String(opts.source || 'update_application_key').slice(0, 40),
            actor: String(opts.actor || 'admin').slice(0, 40),
            ip: String(opts.ip || '').slice(0, 80),
            at: new Date().toISOString()
        };
        const changes = JSON.stringify({
            fields: entry.fields,
            before: entry.before,
            after: entry.after
        }).replace(/sfapp_[A-Za-z0-9_-]{20,}/g, '[redacted]')
            .replace(/sftok_[A-Za-z0-9_-]{20,}/g, '[redacted]');
        const nowSec = Math.floor(Date.now() / 1000);
        await getDb().run(
            `INSERT INTO application_key_audit
                (created_at, application_key_id, app_name, event, actor, source, changes)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [nowSec, entry.keyId, entry.label, entry.event, entry.actor, entry.source, changes]
        );
        console.log(
            `🔐 application_key_edited id=${entry.keyId} label=${JSON.stringify(entry.label)} fields=${entry.fields.join(',')} source=${entry.source}`
        );
        const gr = this.globalResources;
        if (gr && Array.isArray(gr.authAuditLog)) {
            gr.authAuditLog.push(entry);
        }
        return { event: entry.event, fields: entry.fields, source: entry.source };
    }

    async mergeNamedScopes(keyId, requestedScopes, { userType = null } = {}) {
        if (!keyId) return { success: false, error: 'KEY_NOT_FOUND' };
        const row = await getDb().get('SELECT * FROM application_keys WHERE id = ?', [keyId]);
        if (!row) return { success: false, error: 'KEY_NOT_FOUND' };
        if (userType && row.user_type && row.user_type !== userType) {
            return { success: false, error: 'USER_TYPE_MISMATCH' };
        }
        const nowSec = Math.floor(Date.now() / 1000);
        if (row.status !== 'active' || row.revoked_at) {
            return { success: false, error: 'NOT_ACTIVE' };
        }
        if (row.expires_at != null && row.expires_at <= nowSec) {
            return { success: false, error: 'NOT_ACTIVE' };
        }
        const current = parseScopesJson(row.scopes);
        if (current.includes('universal')) {
            return { success: true, added: [], scopes: ['universal'], unchanged: true };
        }
        const allowed = new Set(AVAILABLE_SCOPES.map((s) => s.id).filter((id) => id !== 'universal'));
        const added = (requestedScopes || [])
            .map((s) => String(s).trim())
            .filter((s) => allowed.has(s) && !current.includes(s));
        if (!added.length) {
            return { success: true, added: [], scopes: current, unchanged: true };
        }
        const next = current.concat(added);
        if (!next.length || next.includes('universal')) {
            return { success: false, error: 'EMPTY_SCOPES' };
        }
        await getDb().run(
            `UPDATE application_keys SET scopes = ? WHERE id = ? AND revoked_at IS NULL AND status = 'active'`,
            [JSON.stringify(next), keyId]
        );
        return { success: true, added, scopes: next };
    }

    async recordApplicationRequest(entry) {
        const row = entry && typeof entry === 'object' ? entry : {};
        const keyId = row.applicationKeyId != null ? String(row.applicationKeyId).slice(0, 80) : '';
        if (!keyId) return false;
        const nowSec = Math.floor(Date.now() / 1000);
        await getDb().run(
            `INSERT INTO application_request_log
                (created_at, application_key_id, app_name, http_method, path, status_code, source, ip, user_agent)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                nowSec,
                keyId,
                String(row.appName || '').slice(0, 120),
                String(row.httpMethod || '').slice(0, 16),
                redactApplicationRequestPath(row.path),
                Number(row.statusCode) || 0,
                String(row.source || 'http').slice(0, 24),
                String(row.ip || '').slice(0, 80),
                String(row.userAgent || '').slice(0, 180)
            ]
        );
        const cutoff = await getDb().get(
            'SELECT id FROM application_request_log ORDER BY id DESC LIMIT 1 OFFSET 1999'
        );
        if (cutoff && cutoff.id != null) {
            await getDb().run('DELETE FROM application_request_log WHERE id < ?', [cutoff.id]);
        }
        return true;
    }

    async listApplicationRequests({ page = 1, perPage = 25 } = {}) {
        const limit = Math.max(1, Math.min(100, parseInt(perPage, 10) || 25));
        const currentPage = Math.max(1, parseInt(page, 10) || 1);
        const offset = (currentPage - 1) * limit;
        const totalRow = await getDb().get('SELECT COUNT(*) AS n FROM application_request_log');
        const totalCount = totalRow && totalRow.n ? Number(totalRow.n) : 0;
        const rows = await getDb().all(
            `SELECT id, created_at, application_key_id, app_name, http_method, path, status_code, source, ip, user_agent
             FROM application_request_log
             ORDER BY id DESC
             LIMIT ? OFFSET ?`,
            [limit, offset]
        );
        return {
            requests: (rows || []).map((row) => ({
                id: row.id,
                createdAt: row.created_at ? row.created_at * 1000 : null,
                applicationKeyId: row.application_key_id,
                appName: row.app_name || '',
                httpMethod: row.http_method || '',
                path: row.path || '',
                statusCode: row.status_code || 0,
                source: row.source || '',
                ip: row.ip || '',
                userAgent: row.user_agent || ''
            })),
            pagination: {
                totalCount,
                totalPages: Math.max(1, Math.ceil(totalCount / limit)),
                currentPage,
                perPage: limit
            }
        };
    }

    async listApplicationKeys({ includeExpired = true, userType = null } = {}) {
        const rows = userType
            ? await getDb().all(
                `SELECT * FROM application_keys WHERE user_type = ? ORDER BY created_at DESC`,
                [userType]
            )
            : await getDb().all(
                'SELECT * FROM application_keys ORDER BY created_at DESC'
            );
        return rows
            .map((row) => rowToKeySummary(row, includeExpired))
            .filter(Boolean);
    }

    async createTempAccessToken(rawKey, userAgent, { maxUses = 1, ttlSeconds = 300, scopes = null } = {}) {
        const validation = await this.validateApplicationKey(rawKey, userAgent);
        if (!validation.valid) {
            return validation;
        }

        const tokenId = crypto.randomUUID();
        const rawToken = generateTempToken();
        const tokenHash = hashSecret(rawToken);
        const tokenPrefix = rawToken.slice(0, 12);
        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAt = nowSec + Math.max(30, Math.min(ttlSeconds, 86400));
        const uses = Math.max(1, Math.min(maxUses, 100));
        let tokenScopes = null;
        if (Array.isArray(scopes) && scopes.length > 0) {
            const normalized = normalizeScopes(scopes);
            const keyScopes = validation.scopes;
            if (!keyScopes.includes('universal')) {
                tokenScopes = normalized.filter((s) => keyScopes.includes(s));
            } else {
                tokenScopes = normalized;
            }
        }

        await getDb().run(
            `INSERT INTO temp_access_tokens
             (id, application_key_id, token_hash, token_prefix, scopes, max_uses, uses_remaining, expires_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                tokenId, validation.applicationKeyId, tokenHash, tokenPrefix,
                tokenScopes ? JSON.stringify(tokenScopes) : null,
                uses, uses, expiresAt, nowSec
            ]
        );

        return {
            valid: true,
            token: rawToken,
            expiresAt: expiresAt * 1000,
            maxUses: uses,
            scopes: tokenScopes || validation.scopes
        };
    }

    async requestApplicationAuthorization({ appName, userAgent, scopes, userType = 'admin', expiresAt = null, refreshIntervalDays = 30 }) {
        const id = crypto.randomUUID();
        let requestCode = generateRequestCode();
        let attempts = 0;
        while (attempts < 5) {
            const existing = await getDb().get(
                'SELECT id FROM application_auth_requests WHERE request_code = ? AND status = ?',
                [requestCode, 'pending']
            );
            if (!existing) break;
            requestCode = generateRequestCode();
            attempts += 1;
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const expiresAtSec = expiresAt != null ? Math.floor(expiresAt / 1000) : null;
        const normalizedScopes = normalizeScopes(scopes);

        await getDb().run(
            `INSERT INTO application_auth_requests
             (id, request_code, app_name, user_agent, scopes, user_type, expires_at, refresh_interval_days, status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, requestCode, String(appName).trim(), String(userAgent).trim(),
                JSON.stringify(normalizedScopes), userType === 'readonly' ? 'readonly' : 'admin',
                expiresAtSec, Math.max(1, refreshIntervalDays), 'pending', nowSec
            ]
        );

        return {
            requestId: id,
            requestCode,
            expiresAt: expiresAtSec ? expiresAtSec * 1000 : null
        };
    }

    async checkApplicationAuthorization(requestId, userAgent) {
        const row = await getDb().get('SELECT * FROM application_auth_requests WHERE id = ?', [requestId]);
        if (!row) {
            return { status: 'not_found' };
        }
        if (row.status === 'pending') {
            if (!this.validateUserAgent(row.user_agent, userAgent)) {
                return { status: 'user_agent_mismatch' };
            }
            return { status: 'pending', requestCode: row.request_code, appName: row.app_name };
        }
        if (row.status === 'approved' && row.resulting_key_id) {
            return { status: 'approved', keyId: row.resulting_key_id };
        }
        return { status: row.status };
    }

    async listApplicationAuthRequests(status = 'pending') {
        const rows = await getDb().all(
            'SELECT * FROM application_auth_requests WHERE status = ? ORDER BY created_at DESC',
            [status]
        );
        return rows.map((row) => ({
            id: row.id,
            requestCode: row.request_code,
            appName: row.app_name,
            userAgent: row.user_agent,
            scopes: parseScopesJson(row.scopes),
            userType: row.user_type,
            expiresAt: row.expires_at ? row.expires_at * 1000 : null,
            refreshIntervalDays: row.refresh_interval_days,
            status: row.status,
            createdAt: row.created_at * 1000,
            approvedAt: row.approved_at ? row.approved_at * 1000 : null
        }));
    }

    async approveApplicationAuthRequest(requestId) {
        const row = await getDb().get(
            'SELECT * FROM application_auth_requests WHERE id = ? AND status = ?',
            [requestId, 'pending']
        );
        if (!row) {
            return { success: false, error: 'Request not found or already processed' };
        }

        const expiresAt = row.expires_at ? row.expires_at * 1000 : null;
        const created = await this.createApplicationKey({
            appName: row.app_name,
            userAgent: row.user_agent,
            scopes: parseScopesJson(row.scopes),
            userType: row.user_type,
            expiresAt,
            refreshIntervalDays: row.refresh_interval_days
        });

        const nowSec = Math.floor(Date.now() / 1000);
        await getDb().run(
            'UPDATE application_auth_requests SET status = ?, approved_at = ?, resulting_key_id = ?, pending_key_plain = ? WHERE id = ?',
            ['approved', nowSec, created.summary.id, created.key, requestId]
        );

        return { success: true, key: created.key, summary: created.summary, requestId };
    }

    async denyApplicationAuthRequest(requestId) {
        const nowSec = Math.floor(Date.now() / 1000);
        const result = await getDb().run(
            'UPDATE application_auth_requests SET status = ?, approved_at = ? WHERE id = ? AND status = ?',
            ['denied', nowSec, requestId, 'pending']
        );
        return { success: (result?.changes || 0) > 0 };
    }

    async getApprovedKeyForRequest(requestId, userAgent) {
        const row = await getDb().get(
            'SELECT * FROM application_auth_requests WHERE id = ? AND status = ?',
            [requestId, 'approved']
        );
        if (!row || !row.resulting_key_id) {
            return { success: false, code: 'NOT_APPROVED' };
        }
        if (!this.validateUserAgent(row.user_agent, userAgent)) {
            return { success: false, code: 'USER_AGENT_MISMATCH' };
        }
        const keyRow = await getDb().get('SELECT * FROM application_keys WHERE id = ?', [row.resulting_key_id]);
        if (!keyRow || keyRow.status !== 'active') {
            return { success: false, code: 'KEY_UNAVAILABLE' };
        }
        return {
            success: true,
            summary: rowToKeySummary(keyRow, true)
        };
    }

    async claimApplicationAuthorization(requestId, userAgent) {
        const row = await getDb().get(
            'SELECT * FROM application_auth_requests WHERE id = ? AND status = ?',
            [requestId, 'approved']
        );
        if (!row || !row.resulting_key_id) {
            return { success: false, code: 'NOT_APPROVED', message: 'Authorization not approved yet' };
        }
        if (row.key_claimed_at) {
            return { success: false, code: 'ALREADY_CLAIMED', message: 'Key was already retrieved for this request' };
        }
        if (!this.validateUserAgent(row.user_agent, userAgent)) {
            return { success: false, code: 'USER_AGENT_MISMATCH', message: 'User-Agent does not match authorization request' };
        }

        const keyRow = await getDb().get(
            'SELECT * FROM application_keys WHERE id = ? AND status = ?',
            [row.resulting_key_id, 'active']
        );
        if (!keyRow) {
            return { success: false, code: 'KEY_UNAVAILABLE', message: 'Application key is no longer available' };
        }

        const nowSec = Math.floor(Date.now() / 1000);
        const pendingKey = row.pending_key_plain;
        if (!pendingKey) {
            return { success: false, code: 'KEY_UNAVAILABLE', message: 'Application key was already claimed or not retained' };
        }

        await getDb().run(
            'UPDATE application_auth_requests SET key_claimed_at = ?, pending_key_plain = NULL WHERE id = ?',
            [nowSec, requestId]
        );

        return {
            success: true,
            applicationKey: pendingKey,
            summary: rowToKeySummary(keyRow, true),
            message: 'Store this key securely; it cannot be retrieved again'
        };
    }

    async touchKeyUse(keyId, clientIp) {
        const nowSec = Math.floor(Date.now() / 1000);
        const usedIp = clientIp ? String(clientIp).slice(0, 80) : '';
        await getDb().run(
            'UPDATE application_keys SET last_used_at = ?, last_used_ip = ? WHERE id = ?',
            [nowSec, usedIp, keyId]
        );
    }

    /**
     * Keyless MCP actor. Exact User-Agent, allowKeyless, and client IP in the
     * app CIDRs (127.0.0.1 and ::1 are implied). Does not grant admin unless
     * the application user_type is admin.
     */
    async resolveKeylessAccess({ userAgent, clientIp } = {}) {
        const ua = String(userAgent || '').trim();
        if (!ua || !clientIp) return null;
        const rows = await getDb().all(
            `SELECT * FROM application_keys
             WHERE status = 'active' AND revoked_at IS NULL AND allow_keyless = 1 AND user_agent = ?
             ORDER BY created_at ASC`,
            [ua]
        );
        const nowSec = Math.floor(Date.now() / 1000);
        for (const row of rows) {
            if (!this.validateUserAgent(row.user_agent, ua)) continue;
            if (!ipInCidrs(clientIp, keylessCidrsForRow(row))) continue;
            const persistent = Number(row.persistent) === 1;
            if (!persistent && row.expires_at != null && row.expires_at <= nowSec) continue;
            if (!persistent && row.refresh_before_at <= nowSec) continue;
            const actor = actorFromKeyRow(row);
            await this.touchKeyUse(row.id, clientIp);
            return {
                userType: actor.userType,
                readOnly: actor.readOnly,
                allowDelete: actor.allowDelete,
                authMethod: 'trusted_keyless',
                applicationKeyId: actor.applicationKeyId,
                applicationScopes: actor.scopes,
                appName: actor.appName,
                applicationUserAgent: ua,
                sessionId: `keyless:${actor.applicationKeyId}`,
                persistent: actor.persistent,
                allowKeyless: true,
                clientIp: String(clientIp)
            };
        }
        return null;
    }

    async auditKeylessRequest({ applicationKeyId, appName, userAgent, ip, packet, tool } = {}) {
        const id = String(applicationKeyId || '').slice(0, 80);
        if (!id) return false;
        const ua = redactLoggedSecrets(userAgent).slice(0, 180);
        const clientIp = redactLoggedSecrets(ip).slice(0, 80);
        const packetLabel = redactLoggedSecrets(packet).slice(0, 120) || '-';
        const toolLabel = redactLoggedSecrets(tool).slice(0, 120) || '-';
        console.log(`🔑 keyless app=${id} ua=${JSON.stringify(ua)} ip=${clientIp} packet=${packetLabel} tool=${toolLabel}`);
        await this.recordApplicationRequest({
            applicationKeyId: id,
            appName: appName || '',
            httpMethod: 'KEYLESS',
            path: toolLabel !== '-' ? `${packetLabel} ${toolLabel}` : packetLabel,
            statusCode: 0,
            source: 'keyless',
            ip: clientIp,
            userAgent: ua
        });
        return true;
    }

    /**
     * Expires non-persistent keys whose expires_at has passed.
     * Persistent keys are skipped: no expiry and no refresh rotation.
     */
    async runKeyRefreshExpiryJob(nowMs = Date.now()) {
        const nowSec = Math.floor(nowMs / 1000);
        const rows = await getDb().all(
            `SELECT id, persistent, expires_at, refresh_before_at
             FROM application_keys
             WHERE status = 'active' AND revoked_at IS NULL`
        );
        let expired = 0;
        let skippedPersistent = 0;
        let refreshDue = 0;
        for (const row of rows || []) {
            if (Number(row.persistent) === 1) {
                skippedPersistent += 1;
                continue;
            }
            if (row.expires_at != null && row.expires_at <= nowSec) {
                await getDb().run(
                    `UPDATE application_keys SET status = 'expired' WHERE id = ? AND status = 'active' AND revoked_at IS NULL`,
                    [row.id]
                );
                expired += 1;
                continue;
            }
            if (row.refresh_before_at != null && row.refresh_before_at <= nowSec) {
                refreshDue += 1;
            }
        }
        return { expired, skippedPersistent, refreshDue };
    }

    extractAuthFromRequest(req) {
        const appKeyHeader = req.headers['x-staticforge-app-key'];
        if (appKeyHeader) {
            return { type: 'application_key', token: String(appKeyHeader).trim() };
        }
        const tempHeader = req.headers['x-staticforge-app-token'];
        if (tempHeader) {
            return { type: 'temp_token', token: String(tempHeader).trim() };
        }
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const bearer = authHeader.slice(7).trim();
            if (isApplicationKeyFormat(bearer)) {
                return { type: 'application_key', token: bearer };
            }
            if (isTempTokenFormat(bearer)) {
                return { type: 'temp_token', token: bearer };
            }
        }
        return null;
    }
}

module.exports = {
    ApplicationAuthManager,
    APP_KEY_PREFIX,
    TEMP_TOKEN_PREFIX,
    AVAILABLE_SCOPES,
    SCOPE_WS_PACKETS,
    normalizeScopes,
    getPacketScopes,
    scopesAllowPacket,
    isApplicationKeyFormat,
    isTempTokenFormat,
    redactApplicationRequestPath,
    parseTrustedAccessOptions,
    describeKeylessPacket,
    KEYLESS_IMPLIED_CIDRS,
    OMEGASEARCH_QUERY_PACKET_SCHEMA
};
