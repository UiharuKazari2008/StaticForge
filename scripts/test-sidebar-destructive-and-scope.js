const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Module = require('module');

// Mock optional native/external modules missing in sandbox environment
const origLoad = Module._load;
Module._load = function(request, parent, isMain) {
    try {
        return origLoad.apply(this, arguments);
    } catch (err) {
        return {};
    }
};

// Verify sidebar_save in modules/websocketHandlers.js destructiveOperations
const wsHandlersContent = fs.readFileSync(path.join(__dirname, '../modules/websocketHandlers.js'), 'utf8');
const match = wsHandlersContent.match(/const destructiveOperations = \[([\s\S]*?)\];/);
assert(match, 'Could not find destructiveOperations array in websocketHandlers.js');

const lines = match[1].split('\n');
const destructiveOps = lines
    .map((l) => l.replace(/\/\/.*/, '').trim().replace(/['",]/g, ''))
    .filter(Boolean);

assert(destructiveOps.includes('sidebar_save'), 'sidebar_save should be listed in destructiveOperations array');

const { WebSocketMessageHandlers } = require('../modules/websocketHandlers');
const inst = Object.create(WebSocketMessageHandlers.prototype);
assert.strictEqual(inst.isDestructiveOperation('sidebar_save'), true, 'sidebar_save should return true for isDestructiveOperation');

// Verify sidebar packets in modules/applicationAuthManager.js SCOPE_WS_PACKETS
const { SCOPE_WS_PACKETS, scopesAllowPacket } = require('../modules/applicationAuthManager');
const workspacePackets = SCOPE_WS_PACKETS.workspace;

assert(Array.isArray(workspacePackets), 'SCOPE_WS_PACKETS.workspace should be an array');
const expectedSidebarPackets = [
    'sidebar_get',
    'sidebar_save',
    'sidebar_random_image',
    'sidebar_weather',
    'sidebar_host_metrics'
];

for (const packet of expectedSidebarPackets) {
    assert(workspacePackets.includes(packet), `SCOPE_WS_PACKETS.workspace should include ${packet}`);
    assert(scopesAllowPacket(['workspace'], packet), `workspace scope should allow packet ${packet}`);
}

console.log('✅ test-sidebar-destructive-and-scope.js passed!');
