'use strict';

const cursorUsage = require('../modules/cursorUsage');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');

async function testUsage() {
    console.log('🧪 Testing getCursorUsage for active persona account...');
    const activeWrenId = cursorAccountAuthStore.getActiveAccountId('wren');
    console.log(`👤 Active Wren account ID: "${activeWrenId}"`);

    cursorUsage.invalidateCursorUsage('wren');
    const usage = await cursorUsage.getCursorUsage('wren');
    console.log('📊 Active Wren usage output:', usage);

    if (usage.activeAccountId === activeWrenId && usage.accountEmail) {
        console.log('✅ SUCCESS: getCursorUsage queries active account profile!');
    } else {
        console.error('❌ FAILURE: getCursorUsage did not return active account metadata');
        process.exit(1);
    }
}

testUsage().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
