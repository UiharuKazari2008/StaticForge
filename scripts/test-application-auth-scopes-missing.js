const assert = require('assert');
const { getPacketScopes, scopesAllowPacket } = require('../modules/applicationAuthManager');

console.log('Testing newly added SCOPE_WS_PACKETS entries...');

// Test text replacement packets under 'presets' scope
const textReplacementPackets = [
    'get_text_replacements',
    'save_text_replacements',
    'get_text_replacement_options',
    'scan_text_replacements',
    'delete_text_replacement',
    'create_text_replacement'
];

for (const packet of textReplacementPackets) {
    const scopes = getPacketScopes(packet);
    assert(scopes.includes('presets'), `Expected packet ${packet} to have 'presets' scope, got: ${scopes}`);
    assert(scopesAllowPacket(['presets'], packet), `Expected scopesAllowPacket(['presets'], '${packet}') to be true`);
    assert(!scopesAllowPacket(['chat'], packet), `Expected scopesAllowPacket(['chat'], '${packet}') to be false`);
}

// Test favorites packets under 'workspace' scope
const favoritesPackets = [
    'favorites_add',
    'favorites_remove',
    'favorites_get'
];

for (const packet of favoritesPackets) {
    const scopes = getPacketScopes(packet);
    assert(scopes.includes('workspace'), `Expected packet ${packet} to have 'workspace' scope, got: ${scopes}`);
    assert(scopesAllowPacket(['workspace'], packet), `Expected scopesAllowPacket(['workspace'], '${packet}') to be true`);
    assert(!scopesAllowPacket(['chat'], packet), `Expected scopesAllowPacket(['chat'], '${packet}') to be false`);
}

console.log('All missing scope tests passed successfully!');
