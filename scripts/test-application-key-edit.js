'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { initializeApplicationAuthDatabase, getDb } = require('../modules/applicationAuthDatabase');
const { ApplicationAuthManager, scopesAllowPacket } = require('../modules/applicationAuthManager');
const {
    LEGACY_DIRECTOR_SCOPES,
    DIRECTOR_MCP_SCOPES,
    DIRECTOR_SCOPE_ADDITIONS,
    directorScopeReport,
    widenDirectorApplicationKeys
} = require('../modules/directorAppKeyScopes');
const { MCP_SCOPES } = require('../modules/cursorDirector');

function toolScopesFromFacade() {
    const src = fs.readFileSync(path.join(__dirname, '../modules/mcpAgentFacade.js'), 'utf8');
    const start = src.indexOf('const TOOL_DEFS = [');
    const end = src.indexOf('const MEMORY_TOOL_ALIASES');
    const body = src.slice(start, end);
    const tools = [];
    body.split(/\n    \{\n/).forEach((chunk) => {
        const name = (chunk.match(/name:\s*'([^']+)'/) || [])[1];
        const scope = (chunk.match(/scope:\s*'([^']+)'/) || [])[1];
        if (name && scope) tools.push({ name, scope });
    });
    return tools;
}

async function main() {
    const report = directorScopeReport();
    assert.deepStrictEqual(report.before, [
        'generation', 'gallery', 'workspace', 'search', 'references',
        'wiki', 'autofill', 'notes', 'knowledge', 'presets', 'chat', 'vfs'
    ]);
    assert.deepStrictEqual(report.before, LEGACY_DIRECTOR_SCOPES);
    assert.deepStrictEqual(MCP_SCOPES, DIRECTOR_MCP_SCOPES);
    DIRECTOR_SCOPE_ADDITIONS.forEach((scope) => {
        assert.ok(!report.before.includes(scope), scope);
        assert.ok(report.after.includes(scope), scope);
    });
    ['explore', 'nax', 'sfapp_cake_pantry', 'sfapp_apocrypha', 'sfapp_report_issue', 'sfapp_usage'].forEach((scope) => {
        assert.ok(report.added.includes(scope));
    });

    const tools = toolScopesFromFacade();
    const scopeOf = (name) => {
        const tool = tools.find((row) => row.name === name);
        assert.ok(tool, name);
        return tool.scope;
    };
    const needed = {
        generate_image: 'generation',
        get_studio_state: 'generation',
        apply_studio_changes: 'generation',
        request_workspace_switch: 'generation',
        deliver_rentan: 'generation',
        await_rentan_attempt: 'generation',
        finish_rentan: 'generation',
        link_memory_image: 'generation',
        save_memory: 'generation',
        get_generation_job: 'generation',
        await_generation_job: 'generation',
        get_generated_image: 'gallery',
        get_images: 'gallery',
        get_latest_image: 'gallery',
        vfs_read: 'vfs',
        vfs_write: 'vfs',
        list_notes: 'notes',
        search_explore: 'explore',
        get_explore_image: 'explore',
        get_work_pile: 'sfapp_cake_pantry',
        add_work_item: 'sfapp_cake_pantry',
        deliver_cake: 'sfapp_cake_pantry',
        publish_apocrypha: 'sfapp_apocrypha',
        report_issue: 'sfapp_report_issue',
        get_usage: 'sfapp_usage'
    };
    Object.entries(needed).forEach(([name, scope]) => {
        assert.strictEqual(scopeOf(name), scope);
        assert.ok(report.after.includes(scope), `${name} needs ${scope}`);
    });
    const uncovered = [...new Set(tools.map((tool) => tool.scope))].filter((scope) => !report.after.includes(scope));
    assert.deepStrictEqual(uncovered, []);

    assert.strictEqual(scopesAllowPacket(report.before, 'link_memory_image'), true);
    assert.strictEqual(scopesAllowPacket(report.before, 'get_novelai_explore_gallery'), false);
    assert.strictEqual(scopesAllowPacket(report.after, 'get_novelai_explore_gallery'), true);
    assert.strictEqual(scopesAllowPacket(report.before, 'get_nax_galleries'), false);
    assert.strictEqual(scopesAllowPacket(report.after, 'get_nax_galleries'), true);

    const cursorSrc = fs.readFileSync(path.join(__dirname, '../modules/cursorDirector.js'), 'utf8');
    const xiSrc = fs.readFileSync(path.join(__dirname, '../modules/xiDirector.js'), 'utf8');
    const mcpJson = fs.readFileSync(path.join(__dirname, '../.cursor/mcp.json'), 'utf8');
    assert.ok(cursorSrc.includes("headers: { Authorization: `Bearer ${appKey}` }"));
    assert.ok(cursorSrc.includes("path.join(cursorDir, 'mcp.json')"));
    assert.ok(cursorSrc.includes('updateApplicationKey'));
    assert.ok(!cursorSrc.includes('mergeNamedScopes'));
    assert.ok(xiSrc.includes("ensureAppKey(gr, path.join(layout().root, 'key'), 'Xi')"));
    assert.ok(xiSrc.includes('DREAMSCAPE_MCP_KEY'));
    assert.ok(mcpJson.includes('${env:DREAMSCAPE_MCP_KEY}'));
    assert.ok(!/sfapp_[A-Za-z0-9_-]{20,}/.test(mcpJson));

    const handlerSrc = fs.readFileSync(path.join(__dirname, '../modules/ws/handlers/195-applicationAuthHandler.js'), 'utf8');
    const uiSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/securityCenterDsapApplet.js'), 'utf8');
    const wsSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');
    const destructiveSrc = fs.readFileSync(path.join(__dirname, '../modules/websocketHandlers.js'), 'utf8');
    const bootSrc = fs.readFileSync(path.join(__dirname, '../modules/bootstrap/databases.js'), 'utf8');
    const updateFn = handlerSrc.slice(handlerSrc.indexOf('async function handleUpdateApplicationKey'), handlerSrc.indexOf('async function handleRevokeApplicationKey'));
    assert.ok(handlerSrc.includes("reg('update_application_key', handleUpdateApplicationKey, ADMIN_DESTRUCTIVE)"));
    assert.ok(updateFn.includes('reissued: false'));
    assert.ok(!updateFn.includes('applicationKey'));
    assert.ok(uiSrc.includes('data-sec-action="edit-appkey"'));
    assert.ok(uiSrc.includes('updateApplicationKey(payload)'));
    assert.ok(uiSrc.includes('The secret is not reissued'));
    assert.ok(wsSrc.includes("sendMessage('update_application_key', payload)"));
    assert.ok(destructiveSrc.includes("'update_application_key'"));
    assert.ok(bootSrc.includes('widenDirectorApplicationKeys'));

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-appkey-edit-'));
    const ok = await initializeApplicationAuthDatabase(tmp);
    assert.strictEqual(ok, true);
    const authAuditLog = [];
    const manager = new ApplicationAuthManager({ authAuditLog });

    const created = await manager.createApplicationKey({
        appName: 'Desk',
        userAgent: 'Desk/1.0',
        scopes: ['gallery'],
        userType: 'admin',
        expiresAt: Date.now() + 10 * 86400000,
        refreshIntervalDays: 30,
        allowKeyless: false,
        persistent: false,
        trustedCidrs: []
    });
    const rawKey = created.key;
    const keyId = created.summary.id;
    const hashBefore = (await getDb().get('SELECT key_hash, key_prefix FROM application_keys WHERE id = ?', [keyId]));

    const bad = await manager.updateApplicationKey(keyId, { trustedCidrs: ['not-a-cidr'] });
    assert.strictEqual(bad.success, false);
    assert.strictEqual(bad.code, 'INVALID_TRUSTED_CIDR');
    const stillGallery = await getDb().get('SELECT scopes, key_hash FROM application_keys WHERE id = ?', [keyId]);
    assert.strictEqual(stillGallery.scopes, '["gallery"]');
    assert.strictEqual(stillGallery.key_hash, hashBefore.key_hash);

    const edited = await manager.updateApplicationKey(keyId, {
        label: 'Desk edited',
        scopes: ['gallery', 'notes', 'explore'],
        allowKeyless: true,
        persistent: true,
        trustedCidrs: ['203.0.113.10/32'],
        allowDelete: false
    }, { source: 'update_application_key', actor: 'admin', ip: '203.0.113.8' });
    assert.strictEqual(edited.success, true);
    assert.strictEqual(edited.reissued, false);
    assert.strictEqual(edited.unchanged, false);
    assert.ok(!edited.key);
    assert.strictEqual(edited.summary.appName, 'Desk edited');
    assert.deepStrictEqual(edited.summary.scopes, ['gallery', 'notes', 'explore']);
    assert.strictEqual(edited.summary.allowKeyless, true);
    assert.strictEqual(edited.summary.persistent, true);
    assert.strictEqual(edited.summary.allowDelete, false);
    assert.strictEqual(edited.summary.userType, 'readonly');
    assert.deepStrictEqual(edited.summary.trustedCidrs, ['203.0.113.10/32']);
    assert.strictEqual(edited.summary.expiresAt, null);
    assert.ok(edited.audit.fields.includes('scopes'));
    assert.ok(edited.audit.fields.includes('label'));
    assert.ok(edited.audit.fields.includes('allowDelete'));

    const rowAfter = await getDb().get('SELECT key_hash, key_prefix FROM application_keys WHERE id = ?', [keyId]);
    assert.strictEqual(rowAfter.key_hash, hashBefore.key_hash);
    assert.strictEqual(rowAfter.key_prefix, hashBefore.key_prefix);
    const stillValid = await manager.validateApplicationKey(rawKey, 'Desk/1.0', { skipUserAgent: true });
    assert.strictEqual(stillValid.valid, true);
    assert.strictEqual(stillValid.applicationKeyId, keyId);

    const again = await manager.updateApplicationKey(keyId, {
        label: 'Desk edited',
        scopes: ['gallery', 'notes', 'explore'],
        allowKeyless: true,
        persistent: true,
        trustedCidrs: ['203.0.113.10/32'],
        allowDelete: false
    });
    assert.strictEqual(again.unchanged, true);
    assert.strictEqual(again.reissued, false);

    const audits = await getDb().all('SELECT event, changes, source FROM application_key_audit WHERE application_key_id = ?', [keyId]);
    assert.strictEqual(audits.length, 1);
    assert.strictEqual(audits[0].event, 'application_key_edited');
    assert.strictEqual(audits[0].source, 'update_application_key');
    assert.ok(audits[0].changes.includes('explore'));
    assert.ok(audits[0].changes.includes('notes'));
    assert.ok(!audits[0].changes.includes(rawKey));
    assert.ok(!/sfapp_[A-Za-z0-9_-]{20,}/.test(audits[0].changes));
    assert.strictEqual(authAuditLog.length, 1);
    assert.strictEqual(authAuditLog[0].event, 'application_key_edited');
    assert.ok(!JSON.stringify(authAuditLog[0]).includes(rawKey));

    const refresh = await manager.refreshApplicationKey(rawKey, 'Desk/1.0');
    assert.strictEqual(refresh.code, 'PERSISTENT_NO_REFRESH');
    const stillSame = await getDb().get('SELECT key_hash FROM application_keys WHERE id = ?', [keyId]);
    assert.strictEqual(stillSame.key_hash, hashBefore.key_hash);

    const rotating = await manager.createApplicationKey({
        appName: 'Rotate me',
        userAgent: 'Rotate/1.0',
        scopes: ['gallery'],
        userType: 'admin',
        expiresAt: Date.now() + 86400000,
        refreshIntervalDays: 1
    });
    const labeled = await manager.updateApplicationKey(rotating.summary.id, { label: 'Rotate me edited' });
    assert.strictEqual(labeled.reissued, false);
    const oldStill = await manager.validateApplicationKey(rotating.key, 'Rotate/1.0', { skipUserAgent: true });
    assert.strictEqual(oldStill.valid, true);
    const reissued = await manager.refreshApplicationKey(rotating.key, 'Rotate/1.0');
    assert.strictEqual(reissued.valid, true);
    assert.notStrictEqual(reissued.key, rotating.key);
    const oldDead = await manager.validateApplicationKey(rotating.key, 'Rotate/1.0', { skipUserAgent: true, allowRefreshOverdue: true });
    assert.strictEqual(oldDead.valid, false);

    const revoked = await manager.createApplicationKey({
        appName: 'Gone',
        userAgent: 'Gone/1.0',
        scopes: ['gallery'],
        userType: 'admin'
    });
    await manager.revokeApplicationKey(revoked.summary.id);
    const denied = await manager.updateApplicationKey(revoked.summary.id, { label: 'nope' });
    assert.strictEqual(denied.success, false);
    assert.strictEqual(denied.code, 'NOT_EDITABLE');

    const wren = await manager.createApplicationKey({
        appName: 'Dreamscape Director',
        userAgent: 'DreamscapeDirector/1.0',
        scopes: LEGACY_DIRECTOR_SCOPES.concat(['infrastructure']),
        userType: 'admin',
        expiresAt: null,
        refreshIntervalDays: 3650
    });
    const xi = await manager.createApplicationKey({
        appName: 'Xi',
        userAgent: 'DreamscapeDirector/1.0',
        scopes: LEGACY_DIRECTOR_SCOPES.slice(),
        userType: 'admin',
        expiresAt: null,
        refreshIntervalDays: 3650
    });
    const xiUniversal = await manager.createApplicationKey({
        appName: 'Xi',
        userAgent: 'DreamscapeDirector/1.0',
        scopes: ['universal'],
        userType: 'admin',
        expiresAt: null,
        refreshIntervalDays: 3650
    });
    const other = await manager.createApplicationKey({
        appName: 'Grok Bot',
        userAgent: 'GrokBot/1.0',
        scopes: ['gallery'],
        userType: 'admin'
    });
    const deadDirector = await manager.createApplicationKey({
        appName: 'Dreamscape Director',
        userAgent: 'DreamscapeDirector/1.0',
        scopes: ['gallery'],
        userType: 'admin'
    });
    await manager.revokeApplicationKey(deadDirector.summary.id);

    const first = await widenDirectorApplicationKeys(manager);
    assert.ok(first.updated >= 2);
    const wrenRow = first.keys.find((key) => key.id === wren.summary.id);
    const xiRow = first.keys.find((key) => key.id === xi.summary.id);
    const uniRow = first.keys.find((key) => key.id === xiUniversal.summary.id);
    assert.deepStrictEqual(wrenRow.before, LEGACY_DIRECTOR_SCOPES.concat(['infrastructure']));
    assert.ok(wrenRow.after.includes('infrastructure'));
    assert.ok(wrenRow.after.includes('explore'));
    assert.ok(wrenRow.after.includes('sfapp_cake_pantry'));
    assert.strictEqual(wrenRow.changed, true);
    assert.deepStrictEqual(xiRow.before, LEGACY_DIRECTOR_SCOPES);
    DIRECTOR_MCP_SCOPES.forEach((scope) => assert.ok(xiRow.after.includes(scope), scope));
    assert.deepStrictEqual(uniRow.after, ['universal']);
    assert.strictEqual(uniRow.changed, false);
    assert.ok(first.keys.some((key) => key.id === deadDirector.summary.id && key.changed === false));

    const wrenHash = await getDb().get('SELECT key_hash FROM application_keys WHERE id = ?', [wren.summary.id]);
    const xiHash = await getDb().get('SELECT key_hash FROM application_keys WHERE id = ?', [xi.summary.id]);
    const createdWrenHash = require('crypto').createHash('sha256').update(wren.key).digest('hex');
    const createdXiHash = require('crypto').createHash('sha256').update(xi.key).digest('hex');
    assert.strictEqual(wrenHash.key_hash, createdWrenHash);
    assert.strictEqual(xiHash.key_hash, createdXiHash);
    const wrenStill = await manager.validateApplicationKey(wren.key, 'DreamscapeDirector/1.0', { skipUserAgent: true });
    const xiStill = await manager.validateApplicationKey(xi.key, 'DreamscapeDirector/1.0', { skipUserAgent: true });
    assert.strictEqual(wrenStill.valid, true);
    assert.strictEqual(xiStill.valid, true);
    assert.ok(wrenStill.scopes.includes('sfapp_cake_pantry'));
    assert.ok(xiStill.scopes.includes('explore'));

    const otherRow = await getDb().get('SELECT scopes FROM application_keys WHERE id = ?', [other.summary.id]);
    assert.strictEqual(otherRow.scopes, '["gallery"]');

    const second = await widenDirectorApplicationKeys(manager);
    assert.strictEqual(second.updated, 0);
    const wrenAudits = await getDb().all(
        `SELECT source, changes FROM application_key_audit WHERE application_key_id = ? AND source = 'director_scope_migration'`,
        [wren.summary.id]
    );
    assert.strictEqual(wrenAudits.length, 1);
    assert.ok(wrenAudits[0].changes.includes('sfapp_cake_pantry'));
    assert.ok(!wrenAudits[0].changes.includes(wren.key));
    assert.ok(!/sfapp_[A-Za-z0-9_-]{20,}/.test(wrenAudits[0].changes));

    if (typeof getDb().close === 'function') await getDb().close();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('test-application-key-edit: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
