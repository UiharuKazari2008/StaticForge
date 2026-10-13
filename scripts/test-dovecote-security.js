const assert = require('assert');
const fs = require('fs');
const path = require('path');

console.log('Running dovecote security tests...');

// 1. Verify 250-dovecoteHandler.js registers dovecote_set_image_pref with DOVECOTE_DESTRUCTIVE
const dovecoteHandlerContent = fs.readFileSync(
    path.join(__dirname, '../modules/ws/handlers/250-dovecoteHandler.js'),
    'utf8'
);

assert.ok(
    dovecoteHandlerContent.includes("reg('dovecote_set_image_pref', handleSetImagePref, DOVECOTE_DESTRUCTIVE);"),
    'Expected dovecote_set_image_pref to be registered with DOVECOTE_DESTRUCTIVE in 250-dovecoteHandler.js'
);

// 2. Verify modules/websocketHandlers.js includes all dovecote write packets in destructiveOperations
const websocketHandlersContent = fs.readFileSync(
    path.join(__dirname, '../modules/websocketHandlers.js'),
    'utf8'
);

const match = websocketHandlersContent.match(/const destructiveOperations = \[\s*([\s\S]*?)\s*\];/);
assert.ok(match, 'Expected to find destructiveOperations array in websocketHandlers.js');

const arrayText = match[1];
const inDestructiveOps = new Set(
    arrayText.split('\n')
        .map(s => s.trim().replace(/['",]/g, '').split('//')[0].trim())
        .filter(Boolean)
);

const expectedDestructivePackets = [
    'dovecote_mark_mail',
    'dovecote_send_mail',
    'dovecote_forward_mail',
    'dovecote_set_image_pref'
];

for (const packet of expectedDestructivePackets) {
    assert.strictEqual(
        inDestructiveOps.has(packet),
        true,
        `Expected ${packet} to be included in destructiveOperations array in websocketHandlers.js`
    );
}

console.log('✅ All dovecote security tests passed successfully!');
