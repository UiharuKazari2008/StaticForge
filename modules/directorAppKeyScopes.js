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
 *
 * Dovecote (sfapp_dovecote) is also widened onto the named bot MCP keys
 * (Menma, Guren, Chiyo, Ivory, Hoshino) so mail tools appear in their tool lists.
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
    'sfapp_usage',
    'sfapp_dovecote'
]);

const DIRECTOR_MCP_SCOPES = Object.freeze(LEGACY_DIRECTOR_SCOPES.concat(DIRECTOR_SCOPE_ADDITIONS));

const DIRECTOR_KEY_TARGETS = Object.freeze([
    { persona: 'wren', label: 'Dreamscape Director' },
    { persona: 'xi', label: 'Xi' }
]);

/** Bot MCP keys that need Dovecote mail tools after the module shipped. */
const DOVECOTE_BOT_KEY_TARGETS = Object.freeze([
    { persona: 'menma', label: 'Menma' },
    { persona: 'guren', label: 'Guren' },
    { persona: 'chiyo', label: 'Chiyo' },
    { persona: 'ivory', label: 'Ivory' },
    { persona: 'hoshino', label: 'Hoshino' }
]);

const DOVECOTE_SCOPE = 'sfapp_dovecote';

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
        personas: DIRECTOR_KEY_TARGETS.map((target) => ({ persona: target.persona, label: target.label })),
        dovecoteBots: DOVECOTE_BOT_KEY_TARGETS.map((target) => ({ persona: target.persona, label: target.label }))
    };
}

/**
 * Widen labeled keys by app_name, ensuring each has the given scopes.
 * Idempotent. Does not reissue. Leaves every other key alone.
 * Universal keys already cover the tools and are not rewritten.
 */
async function widenLabeledApplicationKeys(manager, targets, scopesToEnsure, source) {
    if (!manager || typeof manager.updateApplicationKey !== 'function') {
        throw new Error('Application auth manager is not ready');
    }
    const { getDb } = require('./applicationAuthDatabase');
    const rows = await getDb().all(
        `SELECT id, app_name, scopes, status, revoked_at FROM application_keys`
    );
    const byLabel = new Map(targets.map((target) => [target.label, target.persona]));
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
        const missing = scopesToEnsure.filter((scope) => !before.includes(scope));
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
            source,
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
    return { updated, keys };
}

/**
 * Widen Wren and Xi keys to the full director MCP scope list, then add
 * sfapp_dovecote onto the named bot MCP keys. Idempotent; audit-logged.
 */
async function widenDirectorApplicationKeys(manager) {
    const director = await widenLabeledApplicationKeys(
        manager,
        DIRECTOR_KEY_TARGETS,
        DIRECTOR_MCP_SCOPES,
        'director_scope_migration'
    );
    const bots = await widenLabeledApplicationKeys(
        manager,
        DOVECOTE_BOT_KEY_TARGETS,
        [DOVECOTE_SCOPE],
        'dovecote_scope_migration'
    );
    return {
        updated: director.updated + bots.updated,
        keys: director.keys.concat(bots.keys),
        beforeScopes: LEGACY_DIRECTOR_SCOPES.slice(),
        afterScopes: DIRECTOR_MCP_SCOPES.slice(),
        directorUpdated: director.updated,
        dovecoteBotUpdated: bots.updated
    };
}

module.exports = {
    LEGACY_DIRECTOR_SCOPES,
    DIRECTOR_SCOPE_ADDITIONS,
    DIRECTOR_MCP_SCOPES,
    DIRECTOR_KEY_TARGETS,
    DOVECOTE_BOT_KEY_TARGETS,
    DOVECOTE_SCOPE,
    directorScopeReport,
    widenLabeledApplicationKeys,
    widenDirectorApplicationKeys
};
