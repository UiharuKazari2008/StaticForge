const assert = require('assert');
const fs = require('fs');
const path = require('path');

// 1. Verify send_to_sequenzia_bulk is in destructiveOperations in modules/websocketHandlers.js
const wsHandlersContent = fs.readFileSync(path.join(__dirname, '../modules/websocketHandlers.js'), 'utf8');
const destructiveOpsMatch = wsHandlersContent.match(/isDestructiveOperation\s*\([^)]*\)\s*\{[\s\S]*?const destructiveOperations = \[([\s\S]*?)\];/);
assert.ok(destructiveOpsMatch, 'Could not locate destructiveOperations in modules/websocketHandlers.js');
const destructiveOpsList = destructiveOpsMatch[1];
assert.ok(
    destructiveOpsList.includes("'send_to_sequenzia_bulk'") || destructiveOpsList.includes('"send_to_sequenzia_bulk"'),
    'Expected send_to_sequenzia_bulk to be in destructiveOperations list in modules/websocketHandlers.js'
);

// 2. Verify send_to_sequenzia_bulk is registered with GALLERY_DESTRUCTIVE in modules/ws/handlers/120-galleryHandler.js
const galleryHandlerContent = fs.readFileSync(path.join(__dirname, '../modules/ws/handlers/120-galleryHandler.js'), 'utf8');
assert.ok(
    /regFn\s*\(\s*['"]send_to_sequenzia_bulk['"]\s*,\s*handleSendToSequenziaBulk\s*,\s*GALLERY_DESTRUCTIVE\s*\)/.test(galleryHandlerContent),
    'Expected send_to_sequenzia_bulk to be registered with GALLERY_DESTRUCTIVE in modules/ws/handlers/120-galleryHandler.js'
);

console.log('test-sequenzia-destructive-gate: ok');
