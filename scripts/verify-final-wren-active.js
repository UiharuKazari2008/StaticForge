'use strict';

const cursorDirector = require('../modules/cursorDirector');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');
const cursorUsage = require('../modules/cursorUsage');
const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function verifyFinal() {
    console.log('🧪 Verifying Final Wren Account State...');

    const secureConfigPath = path.join(process.cwd(), 'secure.config.json');
    if (fs.existsSync(secureConfigPath)) {
        const secureConfig = JSON.parse(fs.readFileSync(secureConfigPath, 'utf8'));
        secureConfig.cursorAccounts = secureConfig.cursorAccounts || {};
        secureConfig.cursorAccounts.wren = { activeAccountId: 'acc_1791508939761_butfk', customToken: '' };
        fs.writeFileSync(secureConfigPath, JSON.stringify(secureConfig, null, 2), 'utf8');
    }

    const activeId = cursorAccountAuthStore.getActiveAccountId('wren');
    console.log('👤 Active Wren Account ID from Store:', activeId);

    const layout = cursorDirector.layout();
    const wrenConfigDir = path.join(layout.home, '.config', 'cursor');
    cursorAccountAuthStore.restoreAccountAuthFiles('acc_1791508939761_butfk', wrenConfigDir);
    cursorDirector.syncCursorCliLogin(layout.home);

    cursorUsage.invalidateCursorUsage('wren');
    const usage = await cursorUsage.getCursorUsage('wren');
    console.log('📊 Active Wren Verified Usage:', usage);

    const bwrapBin = cursorDirector.findBwrap();
    const agentBin = cursorDirector.findAgent();
    const mounts = { args: [] };
    const jail = cursorDirector._test.buildJail(bwrapBin, agentBin, layout, mounts);

    const res = spawnSync(jail.bin, jail.args.concat([jail.agent, 'whoami']), { encoding: 'utf8' });
    console.log('🚀 Jail cursor-agent whoami status:', res.status);
    console.log('🚀 Jail cursor-agent whoami stdout:', res.stdout ? res.stdout.trim() : '');

    if (usage.activeAccountId === 'acc_1791508939761_butfk' && usage.percent === 0 && res.status === 0) {
        console.log('\n🎉 VERIFICATION COMPLETE: Wren is active on Alt Lite (0% usage)!');
    } else {
        console.error('\n❌ VERIFICATION FAILED!');
        process.exit(1);
    }
}

verifyFinal().catch(err => {
    console.error('Verification error:', err);
    process.exit(1);
});
