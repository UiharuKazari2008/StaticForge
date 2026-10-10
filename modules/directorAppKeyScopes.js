'use strict';

/**
 * Scope list for the Wren and Xi application keys.
 *
 * Wren (modules/cursorDirector.js ensureAppKey) mints "Dreamscape Director"
 * and writes that secret into the jail .cursor/mcp.json Authorization header.
 * Xi (modules/xiDirector.js ensureXiMcp) mints "Xi" with the same user agent
 * and exposes it as DREAMSCAPE_MCP_KEY. The repo .cursor/mcp.json reads
 * ${env:DREAMSCAPE_MCP_KEY}. This module never reads those files or secrets.
 *
 * Tool scopes below are the tool.scope values in modules/mcpAgentFacade.js.
 * Generation history (get_generation_job, await_generation_job, get_images,
 * get_latest_image, get_generated_image) and memory images (link_memory_image)
 * already sit on generation and gallery. Explore, cake, work items, Apocrypha,
 * report, usage, and the NAX packet scope were not on the minted list.
 */

const LEGACY_DIRECTOR_SCOPES = Object.freeze([
    'generation', 'gallery', 'workspace', 'search', 'references',
    'wiki', 'autofill', 'notes', 'knowledge', 'presets', 'chat', 'vfs'
]);

const DIRECTOR_SCOPE_ADDITIONS = Object.freeze([
    'explore',
    'nax',
    'sfapp_cake_pantry',
    'sfapp_apocrypha',
    'sfapp_report_issue',
    'sfapp_usage'
]);

const DIRECTOR_MCP_SCOPES = Object.freeze(LEGACY_DIRECTOR_SCOPES.concat(DIRECTOR_SCOPE_ADDITIONS));

const DIRECTOR_KEY_TARGETS = Object.freeze([
    { persona: 'wren', label: 'Dreamscape Director' },
    { persona: 'xi', label: 'Xi' }
]);

function parseStoredScopes(raw) {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
        return [];
    }
}

function directorScopeReport() {
    return {
        before: LEGACY_DIRECTOR_SCOPES.slice(),
        after: DIRECTOR_MCP_SCOPES.slice(),
        added: DIRECTOR_SCOPE_ADDITIONS.slice(),
        personas: DIRECTOR_KEY_TARGETS.map((target) => ({ persona: target.persona, label: target.label }))
    };
}

/**
 * Widen Wren and Xi keys by label, then update each row by id.
 * Idempotent. Does not reissue. Leaves every other key alone.
 * Universal keys already cover the tools and are not rewritten.
 */
async function widenDirectorApplicationKeys(manager) {
    if (!manager || typeof manager.updateApplicationKey !== 'function') {
        throw new Error('Application auth manager is not ready');
    }
    const { getDb } = require('./applicationAuthDatabase');
    const rows = await getDb().all(
        `SELECT id, app_name, scopes, status, revoked_at FROM application_keys`
    );
    const byLabel = new Map(DIRECTOR_KEY_TARGETS.map((target) => [target.label, target.persona]));
    const keys = [];
    let updated = 0;
    for (const row of rows || []) {
        const persona = byLabel.get(row.app_name);
        if (!persona) continue;
        const before = parseStoredScopes(row.scopes);
        if (row.revoked_at || row.status === 'revoked' || row.status === 'replaced') {
            keys.push({
                id: row.id,
                label: row.app_name,
                persona,
                skipped: row.status || 'revoked',
                before,
                after: before.slice(),
                changed: false
            });
            continue;
        }
        if (before.includes('universal')) {
            keys.push({
                id: row.id,
                label: row.app_name,
                persona,
                before: ['universal'],
                after: ['universal'],
                changed: false
            });
            continue;
        }
        const missing = DIRECTOR_MCP_SCOPES.filter((scope) => !before.includes(scope));
        if (!missing.length) {
            keys.push({
                id: row.id,
                label: row.app_name,
                persona,
                before,
                after: before.slice(),
                changed: false
            });
            continue;
        }
        const result = await manager.updateApplicationKey(row.id, {
            scopes: before.concat(missing)
        }, {
            source: 'director_scope_migration',
            actor: 'startup'
        });
        if (!result || result.success !== true) {
            keys.push({
                id: row.id,
                label: row.app_name,
                persona,
                before,
                after: before.slice(),
                changed: false,
                error: result && (result.code || result.error) || 'UPDATE_FAILED'
            });
            continue;
        }
        const after = (result.summary && result.summary.scopes) || before.concat(missing);
        if (result.unchanged !== true) updated += 1;
        keys.push({
            id: row.id,
            label: row.app_name,
            persona,
            before,
            after,
            changed: result.unchanged !== true
        });
    }
    return {
        updated,
        keys,
        beforeScopes: LEGACY_DIRECTOR_SCOPES.slice(),
        afterScopes: DIRECTOR_MCP_SCOPES.slice()
    };
}

module.exports = {
    LEGACY_DIRECTOR_SCOPES,
    DIRECTOR_SCOPE_ADDITIONS,
    DIRECTOR_MCP_SCOPES,
    DIRECTOR_KEY_TARGETS,
    directorScopeReport,
    widenDirectorApplicationKeys
};
