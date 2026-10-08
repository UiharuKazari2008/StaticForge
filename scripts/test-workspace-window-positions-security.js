const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function testWorkspaceWindowPositionsSecurity() {
    console.log('Testing workspace_update_window_positions security configurations...');

    // Read modules/websocketHandlers.js content
    const wsHandlersPath = path.join(__dirname, '../modules/websocketHandlers.js');
    const wsHandlersContent = fs.readFileSync(wsHandlersPath, 'utf8');

    // Verify workspace_update_window_positions is in destructiveOperations
    const destMatch = wsHandlersContent.match(/const destructiveOperations = \[([\s\S]*?)\];/);
    assert(destMatch, 'destructiveOperations array should exist in websocketHandlers.js');
    const destArrayStr = destMatch[1];
    assert(
        destArrayStr.includes("'workspace_update_window_positions'") || destArrayStr.includes('"workspace_update_window_positions"'),
        'workspace_update_window_positions must be included in destructiveOperations array'
    );
    console.log('✓ Verified workspace_update_window_positions in destructiveOperations array');

    // Read modules/applicationAuthManager.js content
    const appAuthPath = path.join(__dirname, '../modules/applicationAuthManager.js');
    const appAuthContent = fs.readFileSync(appAuthPath, 'utf8');

    // Verify workspace_update_window_positions is in SCOPE_WS_PACKETS.workspace
    const scopeMatch = appAuthContent.match(/workspace:\s*\[([\s\S]*?)\]/);
    assert(scopeMatch, 'SCOPE_WS_PACKETS.workspace should exist in applicationAuthManager.js');
    const scopeArrayStr = scopeMatch[1];
    assert(
        scopeArrayStr.includes("'workspace_update_window_positions'") || scopeArrayStr.includes('"workspace_update_window_positions"'),
        'workspace_update_window_positions must be included in SCOPE_WS_PACKETS.workspace'
    );
    console.log('✓ Verified workspace_update_window_positions in SCOPE_WS_PACKETS.workspace');

    console.log('\nAll security checks for workspace_update_window_positions PASSED!');
}

testWorkspaceWindowPositionsSecurity().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
