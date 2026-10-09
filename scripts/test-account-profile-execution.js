'use strict';

const cursorDirector = require('../modules/cursorDirector');
const globalResources = require('../modules/globalResources');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function testAccountExecution() {
    console.log('🧪 Starting Account Profile Isolation & Execution Test...');

    const layout = cursorDirector.layout();
    const wrenConfigDir = path.join(layout.home, '.config', 'cursor');
    const authFile = path.join(wrenConfigDir, 'auth.json');
    const cliConfigFile = path.join(wrenConfigDir, 'cli-config.json');

    // 1. Test Alt Lite profile
    console.log('\n--- Testing Profile: acc_1791508939761_butfk (Alt Lite) ---');
    cursorAccountAuthStore.restoreAccountAuthFiles('acc_1791508939761_butfk', wrenConfigDir);

    console.log('Wren auth.json content:', fs.readFileSync(authFile, 'utf8'));
    const altCli = JSON.parse(fs.readFileSync(cliConfigFile, 'utf8'));
    console.log('Wren cli-config.json authInfo:', altCli.authInfo);

    const bwrapBin = cursorDirector.findBwrap();
    const agentBin = cursorDirector.findAgent();
    const mounts = cursorDirector.buildDirectorMounts ? cursorDirector.buildDirectorMounts(globalResources) : { args: [] };
    const jail = cursorDirector._test.buildJail(bwrapBin, agentBin, layout, mounts);

    console.log('Running cursor-agent inside jail for Alt Lite...');
    const altWhoami = spawnSync(jail.bin, jail.args.concat([jail.agent, 'whoami']), { encoding: 'utf8' });
    console.log('Alt Lite whoami status:', altWhoami.status);
    console.log('Alt Lite whoami stdout:', altWhoami.stdout ? altWhoami.stdout.trim() : '');
    console.log('Alt Lite whoami stderr:', altWhoami.stderr ? altWhoami.stderr.trim() : '');

    // 2. Test Primary Heavy profile
    console.log('\n--- Testing Profile: default (Primary Heavy) ---');
    cursorAccountAuthStore.restoreAccountAuthFiles('default', wrenConfigDir);

    console.log('Wren auth.json content:', fs.readFileSync(authFile, 'utf8'));
    const defaultCli = JSON.parse(fs.readFileSync(cliConfigFile, 'utf8'));
    console.log('Wren cli-config.json authInfo:', defaultCli.authInfo);

    const jail2 = cursorDirector._test.buildJail(bwrapBin, agentBin, layout, mounts);
    console.log('Running cursor-agent inside jail for Primary Heavy...');
    const defaultWhoami = spawnSync(jail2.bin, jail2.args.concat([jail2.agent, 'whoami']), { encoding: 'utf8' });
    console.log('Primary Heavy whoami status:', defaultWhoami.status);
    console.log('Primary Heavy whoami stdout:', defaultWhoami.stdout ? defaultWhoami.stdout.trim() : '');
    console.log('Primary Heavy whoami stderr:', defaultWhoami.stderr ? defaultWhoami.stderr.trim() : '');

    // 3. Switch back to Alt Lite and verify no leakage
    console.log('\n--- Switching back to Alt Lite ---');
    cursorAccountAuthStore.restoreAccountAuthFiles('acc_1791508939761_butfk', wrenConfigDir);
    const altCliCheck = JSON.parse(fs.readFileSync(cliConfigFile, 'utf8'));
    console.log('Wren cli-config.json authInfo after switch back:', altCliCheck.authInfo);

    if (altCliCheck.authInfo.authId === 'acc_1791508939761_butfk' && altCliCheck.authInfo.email === 'grok|user_01M2GW7N52BM568D8XHFRBD25M') {
        console.log('\n✅ SUCCESS: Account profiles are strictly isolated and credentials stay matched!');
    } else {
        console.error('\n❌ FAILURE: Credentials leaked or diverged across profile switches!');
        process.exit(1);
    }
}

testAccountExecution().catch(err => {
    console.error('Test threw error:', err);
    process.exit(1);
});
