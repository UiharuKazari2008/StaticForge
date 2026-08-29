const crypto = require('crypto');
const { getDb } = require('./applicationAuthDatabase');
const { OMEGASEARCH_QUERY_PACKET_SCHEMA } = require('./omegasearchFilters');

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
        'expand_image', 'preview_expand_image_prompt', 'reroll_expanded_image',
        'reroll_image', 'resolve_dynamic_context', 'compile_dynamic_generation',
        'apply_tendai_preview', 'resolve_text_replacements'
    ],
    workspace: [
        'workspace_list', 'workspace_create', 'workspace_delete', 'workspace_activate',
        'workspace_update', 'workspace_dump', 'workspace_move_files',
        'workspace_add_pinned', 'workspace_remove_pinned', 'workspace_add_scrap',
        'workspace_remove_scrap', 'desktop_add_shortcut', 'desktop_update_shortcut',
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
        'vfs_copy', 'vfs_stat', 'vfs_search'
    ],
    presets: [
        'get_presets', 'search_presets', 'load_preset', 'save_preset', 'update_preset',
        'delete_preset', 'get_preset_groups', 'save_preset_group', 'delete_preset_group',
        'regenerate_preset_uuid'
    ],
    chat: [
        'create_chat_session', 'send_chat_message', 'get_chat_history', 'delete_chat_session',
        'get_persona_settings', 'update_persona_settings'
    ],
    references: [
        'get_references', 'upload_reference', 'delete_reference', 'encode_vibe',
        'get_vibe_bundle', 'delete_vibe'
    ],
    wiki: [
        'search_tag_wiki', 'get_tag_wiki_page', 'refresh_tag_wiki_page',
        'get_static_wiki_site_index', 'get_static_wiki_page', 'resolve_grimoire_url'
    ],
    autofill: [
        'get_autofill_ranking', 'test_autofill_ranking', 'update_autofill_ranking',
        'fetch_autofill_wiki_previews',
        'search_tag_wiki', 'get_tag_wiki_page', 'refresh_tag_wiki_page',
        'get_static_wiki_site_index', 'get_static_wiki_page', 'resolve_grimoire_url'
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
    { id: 'infrastructure', label: 'Infrastructure', description: 'Ping, status, version checks' }
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

function getPacketScopes(packetType) {
    const type = String(packetType || '').trim();
    if (!type) return [];
    const out = [];
    for (const [scopeId, packets] of Object.entries(SCOPE_WS_PACKETS)) {
        if (packets.includes(type)) out.push(scopeId);
    }
    return out;
}

function scopesAllowPacket(scopes, packetType) {
    if (!Array.isArray(scopes) || scopes.length === 0) return false;
    if (scopes.includes('universal')) return true;
    const required = getPacketScopes(packetType);
    if (!required.length) return false;
    return required.some((scopeId) => scopes.includes(scopeId));
}

function rowToKeySummary(row, includeExpired = false) {
    if (!row) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresAt = row.expires_at != null ? row.expires_at * 1000 : null;
    const refreshBeforeAt = row.refresh_before_at * 1000;
    let status = row.status;
    if (status === 'active' && row.revoked_at) {
        status = 'revoked';
    } else if (status === 'active' && expiresAt && expiresAt <= Date.now()) {
        status = 'expired';
    } else if (status === 'active' && refreshBeforeAt <= Date.now()) {
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
        revokedAt: row.revoked_at ? row.revoked_at * 1000 : null,
        status,
        isPerpetual: row.expires_at == null,
        refreshOverdue: status === 'refresh_required' || (refreshBeforeAt <= Date.now() && status === 'active')
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

    async validateApplicationKey(rawKey, userAgent, { allowRefreshOverdue = false, skipUserAgent = false } = {}) {
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

        if (!skipUserAgent && !this.validateUserAgent(row.user_agent, userAgent)) {
            return { valid: false, code: 'USER_AGENT_MISMATCH', message: 'User-Agent does not match registered application' };
        }

        const nowSec = Math.floor(Date.now() / 1000);
        if (row.expires_at != null && row.expires_at <= nowSec) {
            await getDb().run('UPDATE application_keys SET status = ? WHERE id = ?', ['expired', row.id]);
            return { valid: false, code: 'KEY_EXPIRED', message: 'Application key expired — re-authorize via login' };
        }

        if (row.refresh_before_at <= nowSec && !allowRefreshOverdue) {
            return {
                valid: false,
                code: 'REFRESH_REQUIRED',
                message: 'Application key must be refreshed before use',
                refreshBeforeAt: row.refresh_before_at * 1000
            };
        }

        await getDb().run('UPDATE application_keys SET last_used_at = ? WHERE id = ?', [nowSec, row.id]);

        return {
            valid: true,
            keyRecord: row,
            scopes: parseScopesJson(row.scopes),
            userType: row.user_type || 'admin',
            applicationKeyId: row.id,
            expiresAt: row.expires_at != null ? row.expires_at * 1000 : null,
            refreshBeforeAt: row.refresh_before_at * 1000,
            originalExpiresAt: row.original_expires_at != null ? row.original_expires_at * 1000 : null
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
        refreshIntervalDays = 30
    }) {
        const id = crypto.randomUUID();
        const rawKey = generateAppKey();
        const keyHash = hashSecret(rawKey);
        const keyPrefix = rawKey.slice(0, 12);
        const nowSec = Math.floor(Date.now() / 1000);
        const normalizedScopes = normalizeScopes(scopes);
        const refreshBeforeAt = nowSec + Math.max(1, refreshIntervalDays) * 86400;
        const expiresAtSec = expiresAt != null ? Math.floor(expiresAt / 1000) : null;

        await getDb().run(
            `INSERT INTO application_keys
             (id, key_hash, key_prefix, app_name, user_agent, scopes, user_type,
              expires_at, refresh_before_at, original_expires_at, created_at, last_refreshed_at, status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id, keyHash, keyPrefix, String(appName).trim(), String(userAgent).trim(),
                JSON.stringify(normalizedScopes), userType === 'readonly' ? 'readonly' : 'admin',
                expiresAtSec, refreshBeforeAt, expiresAtSec, nowSec, nowSec, 'active'
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
                  expires_at, refresh_before_at, original_expires_at, created_at, last_refreshed_at, status)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    newId, newHash, newPrefix, oldRow.app_name, oldRow.user_agent, oldRow.scopes,
                    oldRow.user_type, oldRow.expires_at, newRefreshBefore, oldRow.original_expires_at,
                    oldRow.created_at, nowSec, 'active'
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

    async listApplicationKeys({ includeExpired = true } = {}) {
        const rows = await getDb().all(
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
    OMEGASEARCH_QUERY_PACKET_SCHEMA
};
