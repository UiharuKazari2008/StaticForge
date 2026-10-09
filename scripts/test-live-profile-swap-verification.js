'use strict';

const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');
const cursorDirector = require('../modules/cursorDirector');
const path = require('path');
const fs = require('fs');
const assert = require('assert');

function runSwapVerification() {
    console.log('🧪 Testing Live Account Profile Swapping & Jail Auth File State...');

    const jailHome = cursorDirector.layout().home;
    const wrenConfigDir = path.join(jailHome, '.config', 'cursor');
    const cliConfigPath = path.join(wrenConfigDir, 'cli-config.json');

    // 1. Restore 'default' (Primary Heavy)
    console.log('🔄 Restoring "default" profile...');
    cursorAccountAuthStore.restoreAccountAuthFiles('default', wrenConfigDir);
    const cliData1 = JSON.parse(fs.readFileSync(cliConfigPath, 'utf8'));
    console.log('   Restored Email in Jail:', cliData1.authInfo.email);
    assert.strictEqual(cliData1.authInfo.email, 'github|user_01JYFMM59SFXNDHN6ZPCFBTHAS', 'Jail config email must match Primary Heavy');

    // 2. Restore 'acc_1791508939761_butfk' (Alt Lite)
    console.log('🔄 Restoring "acc_1791508939761_butfk" (Alt Lite) profile...');
    cursorAccountAuthStore.restoreAccountAuthFiles('acc_1791508939761_butfk', wrenConfigDir);
    const cliData2 = JSON.parse(fs.readFileSync(cliConfigPath, 'utf8'));
    console.log('   Restored Email in Jail:', cliData2.authInfo.email);
    assert.strictEqual(cliData2.authInfo.email, 'grok|user_01M2GW7N52BM568D8XHFRBD25M', 'Jail config email must match Alt Lite');

    console.log('🎉 Account Profile Swapping Verification PASSED 100%!');
}

runSwapVerification();
