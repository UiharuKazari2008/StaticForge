const assert = require('assert');
const fs = require('fs');
const path = require('path');

async function testAnimateImageSecurity() {
    console.log('Testing animate_image security configurations...');

    // 1. Check websocketHandlers.js
    const wsHandlersPath = path.join(__dirname, '../modules/websocketHandlers.js');
    const wsHandlersContent = fs.readFileSync(wsHandlersPath, 'utf8');

    const destOpsMatch = wsHandlersContent.match(/const destructiveOperations = \[([\s\S]*?)\];/);
    assert.ok(destOpsMatch, 'Could not locate destructiveOperations in modules/websocketHandlers.js');

    const destOpsStr = destOpsMatch[1];
    assert.ok(
        destOpsStr.includes("'animate_image'") || destOpsStr.includes('"animate_image"'),
        'Expected animate_image to be in destructiveOperations list in modules/websocketHandlers.js'
    );
    console.log('✓ Verified animate_image in destructiveOperations in modules/websocketHandlers.js');

    // 2. Check applicationAuthManager.js
    const appAuthPath = path.join(__dirname, '../modules/applicationAuthManager.js');
    const appAuthContent = fs.readFileSync(appAuthPath, 'utf8');

    const scopeMatch = appAuthContent.match(/generation:\s*\[([\s\S]*?)\]/);
    assert.ok(scopeMatch, 'SCOPE_WS_PACKETS.generation should exist in applicationAuthManager.js');

    const scopeOpsStr = scopeMatch[1];
    assert.ok(
        scopeOpsStr.includes("'animate_image'") || scopeOpsStr.includes('"animate_image"'),
        'Expected animate_image to be in SCOPE_WS_PACKETS.generation in modules/applicationAuthManager.js'
    );
    console.log('✓ Verified animate_image in SCOPE_WS_PACKETS.generation in modules/applicationAuthManager.js');

    console.log('\nAll animate_image security tests passed!');
}

testAnimateImageSecurity().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
});
