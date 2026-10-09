'use strict';

const cursorDirector = require('../modules/cursorDirector');
const globalResources = require('../modules/globalResources');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function testLiveBwrap() {
    console.log('=== TEST LIVE BWRAP CURSOR-AGENT ===');
    const activeId = cursorAccountAuthStore.getActiveAccountId('wren');
    console.log('Active Wren account ID:', activeId);

    const prepared = await cursorDirector.prepareDirector(globalResources);
    console.log('Prepared Director:', prepared);

    const layout = cursorDirector.layout();
    const authFile = path.join(layout.home, '.config', 'cursor', 'auth.json');
    const cliConfigFile = path.join(layout.home, '.config', 'cursor', 'cli-config.json');

    console.log('Home auth.json exists:', fs.existsSync(authFile));
    if (fs.existsSync(authFile)) {
        console.log('Home auth.json content:', fs.readFileSync(authFile, 'utf8'));
    }
    console.log('Home cli-config.json exists:', fs.existsSync(cliConfigFile));
    if (fs.existsSync(cliConfigFile)) {
        console.log('Home cli-config.json content:', fs.readFileSync(cliConfigFile, 'utf8'));
    }

    const bwrapBin = cursorDirector.requireBwrap();
    const agentBin = cursorDirector.requireAgent();
    console.log('bwrapBin:', bwrapBin, 'agentBin:', agentBin);

    const mounts = cursorDirector.buildDirectorMounts(globalResources);
    const jail = cursorDirector.buildJail(bwrapBin, agentBin, layout, mounts);

    console.log('Jail args:', jail.args);

    console.log('Executing cursor-agent whoami inside jail...');
    const result = spawnSync(jail.bin, jail.args.concat([jail.agent, 'whoami']), { encoding: 'utf8' });
    console.log('whoami Exit code:', result.status);
    console.log('whoami Stdout:', result.stdout);
    console.log('whoami Stderr:', result.stderr);

    console.log('Executing cursor-agent create-chat inside jail...');
    const chatResult = spawnSync(jail.bin, jail.args.concat([jail.agent, 'create-chat', '--workspace', jail.workspace]), { encoding: 'utf8' });
    console.log('create-chat Exit code:', chatResult.status);
    console.log('create-chat Stdout:', chatResult.stdout);
    console.log('create-chat Stderr:', chatResult.stderr);
}

testLiveBwrap().catch(err => console.error(err));
