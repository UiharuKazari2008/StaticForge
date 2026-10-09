'use strict';

const cursorDirector = require('../modules/cursorDirector');
const globalResources = require('../modules/globalResources');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');
const path = require('path');
const fs = require('fs');

async function testPromptWithActiveAccount() {
    console.log('🧪 Testing Live cursor-agent prompt execution with active account profile...');

    const secureConfigPath = path.join(process.cwd(), 'secure.config.json');
    const secureConfig = JSON.parse(fs.readFileSync(secureConfigPath, 'utf8'));
    const activeWrenId = secureConfig.cursorAccounts?.wren?.activeAccountId || 'default';
    const activeAccount = (secureConfig.cursorAccounts?.accounts || []).find(a => a.id === activeWrenId);

    console.log('👤 Active Wren Account Profile:', activeAccount ? `${activeAccount.name} (${activeAccount.email})` : activeWrenId);

    // Ensure computer tree and restore auth files
    const prep = await cursorDirector.prepareDirector(globalResources);
    console.log('⚙️ Director ready:', prep.ready);

    // Read cli-config.json inside jail to inspect authInfo
    const jailHome = cursorDirector.layout().home;
    const cliConfigPath = path.join(jailHome, '.config', 'cursor', 'cli-config.json');

    if (fs.existsSync(cliConfigPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(cliConfigPath, 'utf8'));
            console.log('🔑 Jail cli-config.json authInfo:', JSON.stringify(data.authInfo, null, 2));
        } catch (e) {
            console.error('Error reading cli-config:', e.message);
        }
    } else {
        console.log('❌ Jail cli-config.json does not exist');
    }
}

testPromptWithActiveAccount()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Error:', err);
        process.exit(1);
    });
