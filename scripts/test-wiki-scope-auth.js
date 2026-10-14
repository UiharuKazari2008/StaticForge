// JULES: Regression test for wiki scope authorization of get_fandom_wiki_index and get_fandom_wiki_manager
const assert = require('assert');
const { getPacketScopes, scopesAllowPacket } = require('../modules/applicationAuthManager');

console.log('Running test-wiki-scope-auth.js...');

// Verify get_fandom_wiki_index
const indexScopes = getPacketScopes('get_fandom_wiki_index');
assert(indexScopes.includes('wiki'), 'get_fandom_wiki_index should map to wiki scope');
assert(scopesAllowPacket(['wiki'], 'get_fandom_wiki_index') === true, 'wiki scope should allow get_fandom_wiki_index');
assert(scopesAllowPacket(['gallery'], 'get_fandom_wiki_index') === false, 'gallery scope should not allow get_fandom_wiki_index');

// Verify get_fandom_wiki_manager
const managerScopes = getPacketScopes('get_fandom_wiki_manager');
assert(managerScopes.includes('wiki'), 'get_fandom_wiki_manager should map to wiki scope');
assert(scopesAllowPacket(['wiki'], 'get_fandom_wiki_manager') === true, 'wiki scope should allow get_fandom_wiki_manager');
assert(scopesAllowPacket(['gallery'], 'get_fandom_wiki_manager') === false, 'gallery scope should not allow get_fandom_wiki_manager');

console.log('✅ All wiki scope authorization tests passed successfully!');
