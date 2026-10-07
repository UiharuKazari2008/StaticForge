const assert = require('assert');
const {
    getPacketScopes,
    scopesAllowPacket
} = require('../modules/applicationAuthManager');

// Verify get_studio_explore_feed is mapped to explore scope
const scopes = getPacketScopes('get_studio_explore_feed');
assert.ok(scopes.includes('explore'), 'get_studio_explore_feed should be included in explore scope');

// Verify scopesAllowPacket behavior
assert.strictEqual(scopesAllowPacket(['explore'], 'get_studio_explore_feed'), true);
assert.strictEqual(scopesAllowPacket(['gallery'], 'get_studio_explore_feed'), false);
assert.strictEqual(scopesAllowPacket(['universal'], 'get_studio_explore_feed'), true);

console.log('test-explore-feed-scope: ok');
