'use strict';

const cursorDirector = require('../modules/cursorDirector');
const globalResources = require('../modules/globalResources');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');
const fs = require('fs');
const path = require('path');

async function testAgentRun() {
    console.log('🧪 Testing Live cursor-agent execution inside bubblewrap jail...');

    const activeId = cursorAccountAuthStore.getActiveAccountId('wren');
    console.log(`👤 Active Wren account profile ID: "${activeId}"`);

    const wrenConfigDir = path.join(cursorDirector.layout().home, '.config', 'cursor');
    const authFile = path.join(wrenConfigDir, 'auth.json');
    const cliFile = path.join(wrenConfigDir, 'cli-config.json');

    const project = await cursorDirector.prepareDirector(globalResources);
    console.log('⚙️ prepareDirector ready status:', project.ready);

    console.log('📄 Wren config auth.json exists:', fs.existsSync(authFile));
    if (fs.existsSync(authFile)) {
        console.log('📄 Wren config auth.json content:', fs.readFileSync(authFile, 'utf8'));
    }
    console.log('📄 Wren config cli-config.json content:', fs.existsSync(cliFile) ? fs.readFileSync(cliFile, 'utf8') : 'missing');

    const cliData = JSON.parse(fs.readFileSync(cliFile, 'utf8'));
    console.log('👤 Active cli-config authInfo:', cliData.authInfo);

    if (cliData.authInfo && cliData.authInfo.authId === activeId) {
        console.log('✅ PASS: Active account profile matches activeAccountId!');
    } else {
        console.error('❌ FAIL: Active account profile diverged from activeAccountId!');
        process.exit(1);
    }
}

testAgentRun().catch(err => {
    console.error('Test error:', err);
    process.exit(1);
});
