// JULES: Regression test for search scope authorization of character database WebSocket packets
const assert = require('assert');
const { getPacketScopes, scopesAllowPacket } = require('../modules/applicationAuthManager');
const fs = require('fs');
const path = require('path');

console.log('Running test-character-db-scope-auth.js...');

const characterDbPackets = [
    'get_character_db',
    'character_db_upsert',
    'character_db_delete',
    'character_db_rename_copyright',
    'character_db_delete_copyright'
];

for (const packet of characterDbPackets) {
    const scopes = getPacketScopes(packet);
    assert(scopes.includes('search'), `${packet} should map to search scope`);
    assert(scopesAllowPacket(['search'], packet) === true, `search scope should allow ${packet}`);
    assert(scopesAllowPacket(['gallery'], packet) === false, `gallery scope should not allow ${packet}`);
}

// Verify mutating packets are in destructiveOperations array in websocketHandlers.js
const wsHandlersPath = path.join(__dirname, '../modules/websocketHandlers.js');
const wsHandlersContent = fs.readFileSync(wsHandlersPath, 'utf8');

const destMatch = wsHandlersContent.match(/const destructiveOperations = \[([\s\S]*?)\];/);
assert(destMatch, 'destructiveOperations array should exist in websocketHandlers.js');
const destArrayStr = destMatch[1];

const mutatingPackets = [
    'character_db_upsert',
    'character_db_delete',
    'character_db_rename_copyright',
    'character_db_delete_copyright'
];

for (const packet of mutatingPackets) {
    assert(
        destArrayStr.includes(`'${packet}'`) || destArrayStr.includes(`"${packet}"`),
        `${packet} must be included in destructiveOperations array`
    );
}

console.log('✅ All character DB scope authorization tests passed successfully!');
