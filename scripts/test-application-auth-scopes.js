const assert = require('assert');
const {
    AVAILABLE_SCOPES,
    normalizeScopes,
    getPacketScopes,
    scopesAllowPacket
} = require('../modules/applicationAuthManager');

assert.ok(AVAILABLE_SCOPES.some((s) => s.id === 'autofill'));
assert.ok(AVAILABLE_SCOPES.some((s) => s.id === 'generation'));
assert.ok(AVAILABLE_SCOPES.some((s) => s.id === 'vfs'));
assert.ok(AVAILABLE_SCOPES.some((s) => s.id === 'notes'));
assert.ok(!AVAILABLE_SCOPES.some((s) => s.id === 'wiki' && s.id === 'autofill'));

assert.deepStrictEqual(
    normalizeScopes(['gallery', 'autofill', 'generation', 'vfs']),
    ['gallery', 'autofill', 'generation', 'vfs']
);
assert.deepStrictEqual(normalizeScopes(['autofill', 'not-a-scope']), ['autofill']);
assert.deepStrictEqual(normalizeScopes(['universal', 'autofill']), ['universal']);

assert.ok(getPacketScopes('get_autofill_ranking').includes('autofill'));
assert.ok(!getPacketScopes('get_autofill_ranking').includes('search'));
assert.ok(getPacketScopes('search_tag_wiki').includes('autofill'));
assert.ok(getPacketScopes('search_tag_wiki').includes('wiki'));
assert.ok(getPacketScopes('search_tags').includes('search'));
assert.ok(!getPacketScopes('search_tags').includes('autofill'));
assert.ok(getPacketScopes('generate_image').includes('generation'));
assert.ok(getPacketScopes('vfs_list').includes('vfs'));
assert.ok(getPacketScopes('vfs_list_directory').includes('vfs'));
assert.ok(getPacketScopes('workspace_bulk_add_scrap').includes('workspace'));
assert.ok(getPacketScopes('notes_create').includes('notes'));
assert.ok(getPacketScopes('get_wiki_home').includes('wiki'));
assert.ok(getPacketScopes('get_wiki_home').includes('autofill'));

const ivory = ['gallery', 'workspace', 'search', 'infrastructure', 'generation', 'vfs', 'autofill'];
assert.strictEqual(scopesAllowPacket(ivory, 'get_autofill_ranking'), true);
assert.strictEqual(scopesAllowPacket(ivory, 'test_autofill_ranking'), true);
assert.strictEqual(scopesAllowPacket(ivory, 'search_tag_wiki'), true);
assert.strictEqual(scopesAllowPacket(ivory, 'get_tag_wiki_page'), true);
assert.strictEqual(scopesAllowPacket(ivory, 'generate_image'), true);
assert.strictEqual(scopesAllowPacket(ivory, 'vfs_list'), true);
assert.strictEqual(scopesAllowPacket(ivory, 'search_tags'), true);

assert.strictEqual(scopesAllowPacket(['search'], 'get_autofill_ranking'), false);
assert.strictEqual(scopesAllowPacket(['search'], 'search_tag_wiki'), false);
assert.strictEqual(scopesAllowPacket(['wiki'], 'search_tag_wiki'), true);
assert.strictEqual(scopesAllowPacket(['autofill'], 'search_tag_wiki'), true);
assert.strictEqual(scopesAllowPacket(['autofill'], 'search_tags'), false);
assert.strictEqual(scopesAllowPacket(['generation'], 'vfs_list'), false);
assert.strictEqual(scopesAllowPacket(['notes'], 'notes_create'), true);
assert.strictEqual(scopesAllowPacket(['notes'], 'notes_save_content'), true);
assert.strictEqual(scopesAllowPacket(['wiki'], 'notes_create'), false);
assert.strictEqual(scopesAllowPacket(['universal'], 'get_autofill_ranking'), true);
assert.strictEqual(scopesAllowPacket([], 'generate_image'), false);

assert.strictEqual(scopesAllowPacket(['workspace_vfs:read'], 'workspace_get_files'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:read'], 'vfs_list'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:write'], 'workspace_create'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:write'], 'vfs_upload_file'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:soft_delete'], 'workspace_remove_pinned'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:soft_delete'], 'workspace_bulk_remove_scrap'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:soft_delete'], 'workspace_bulk_remove_scrap'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:soft_delete'], 'vfs_move_to_trash'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:delete'], 'workspace_delete'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:delete'], 'vfs_permanently_delete'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:move'], 'workspace_move_files'), true);
assert.strictEqual(scopesAllowPacket(['workspace_vfs:move'], 'vfs_rename_file'), true);

assert.strictEqual(scopesAllowPacket(['root_vfs:read'], 'vfs_list'), true);
assert.strictEqual(scopesAllowPacket(['root_vfs:read'], 'workspace_get_files'), false);
assert.strictEqual(scopesAllowPacket(['root_vfs:write'], 'vfs_upload_file'), true);
assert.strictEqual(scopesAllowPacket(['root_vfs:write'], 'workspace_create'), false);
assert.strictEqual(scopesAllowPacket(['root_vfs:soft_delete'], 'vfs_move_to_trash'), true);
assert.strictEqual(scopesAllowPacket(['root_vfs:soft_delete'], 'workspace_remove_pinned'), false);
assert.strictEqual(scopesAllowPacket(['root_vfs:delete'], 'vfs_permanently_delete'), true);
assert.strictEqual(scopesAllowPacket(['root_vfs:delete'], 'workspace_delete'), false);
assert.strictEqual(scopesAllowPacket(['root_vfs:move'], 'vfs_rename_file'), true);
assert.strictEqual(scopesAllowPacket(['root_vfs:move'], 'workspace_move_files'), false);

console.log('test-application-auth-scopes: ok');
