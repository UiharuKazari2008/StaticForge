#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const KEY_DIR = path.join(os.homedir(), '.config', 'dreamscape-agent-client');
const KEY_PATH = path.join(KEY_DIR, 'app-key');
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 DreamscapeDedicatedAgentClient/1.0';

async function main() {
    fs.mkdirSync(KEY_DIR, { recursive: true, mode: 0o700 });
    try {
        const existing = fs.readFileSync(KEY_PATH, 'utf8').trim();
        if (existing.startsWith('sfapp_')) {
            console.log('Dedicated agent client key already provisioned');
            return;
        }
        throw new Error('Existing dedicated client key has an invalid format');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const globalResources = require('../modules/globalResources');
    await require('../modules/applicationAuthDatabase').initializeApplicationAuthDatabase(path.join(ROOT, '.cache'));
    await globalResources.initializeApplicationAuthManager();
    const manager = globalResources.getApplicationAuthManager();
    const created = await manager.createApplicationKey({
        appName: 'Dedicated Server Agent Client',
        userAgent: USER_AGENT,
        scopes: ['infrastructure'],
        userType: 'admin',
        persistent: true
    });

    const temporaryPath = `${KEY_PATH}.${process.pid}.tmp`;
    fs.writeFileSync(temporaryPath, `${created.key}\n`, { mode: 0o600, flag: 'wx' });
    fs.renameSync(temporaryPath, KEY_PATH);
    fs.chmodSync(KEY_PATH, 0o600);
    console.log('Provisioned dedicated agent client key');
}

main().then(
    () => process.exit(0),
    (error) => {
        console.error(`Failed to provision dedicated agent client key: ${error.message}`);
        process.exit(1);
    }
);
