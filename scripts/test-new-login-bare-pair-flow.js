'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const cursorAccountAuthStore = require('../modules/cursorAccountAuthStore');

function runTest() {
    console.log('🧪 Testing New Bare Login & Pair Credentials Flow...');

    const testDirA = cursorAccountAuthStore.getAccountDir('test_profile_a');
    const testDirB = cursorAccountAuthStore.getAccountDir('test_profile_b');

    // 1. Seed live Wren directory with Profile A credentials
    const cursorDirector = require('../modules/cursorDirector');
    const jailHome = cursorDirector.layout().home;
    const wrenLiveConfig = path.join(jailHome, '.config', 'cursor');
    fs.mkdirSync(wrenLiveConfig, { recursive: true });

    const tokenA = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InVzZXJBQGRvbWFpbi5jb20ifQ.testsignature';
    fs.writeFileSync(path.join(wrenLiveConfig, 'auth.json'), JSON.stringify({ accessToken: tokenA }));
    fs.writeFileSync(path.join(wrenLiveConfig, 'cli-config.json'), JSON.stringify({ authInfo: { email: 'userA@domain.com' } }));

    // 2. Capture Profile A
    cursorAccountAuthStore.captureLivePersonaAuthFiles('wren', 'test_profile_a');
    const authA = JSON.parse(fs.readFileSync(path.join(testDirA, 'auth.json'), 'utf8'));
    assert.strictEqual(authA.accessToken, tokenA, 'Profile A auth.json should have userA token');

    // 3. Now simulate user creating a NEW login profile B (which should copy out A and leave live bare)
    cursorAccountAuthStore.captureLivePersonaAuthFiles('wren', 'test_profile_a'); // Copy out active
    cursorAccountAuthStore.logoutCursorAccount('wren', null); // Leave live bare

    const liveAuthBare = JSON.parse(fs.readFileSync(path.join(wrenLiveConfig, 'auth.json'), 'utf8'));
    const liveCliBare = JSON.parse(fs.readFileSync(path.join(wrenLiveConfig, 'cli-config.json'), 'utf8'));
    assert.strictEqual(Object.keys(liveAuthBare).length, 0, 'Live auth.json must be bare/empty for new login');
    assert.strictEqual(liveCliBare.authInfo.email, '(Logged Out)', 'Live cli-config.json must be pending/logged out');

    // 4. Now simulate user authenticating as userB in live directory
    const tokenB = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJlbWFpbCI6InVzZXJCQGRvbWFpbi5jb20ifQ.testsignature';
    fs.writeFileSync(path.join(wrenLiveConfig, 'auth.json'), JSON.stringify({ accessToken: tokenB }));
    fs.writeFileSync(path.join(wrenLiveConfig, 'cli-config.json'), JSON.stringify({ authInfo: { email: 'userB@domain.com' } }));

    // 5. Capture & Pair to Profile B
    const capB = cursorAccountAuthStore.captureLivePersonaAuthFiles('wren', 'test_profile_b');
    assert.strictEqual(capB.email, 'userB@domain.com', 'Captured email for B must be userB@domain.com');

    const authB = JSON.parse(fs.readFileSync(path.join(testDirB, 'auth.json'), 'utf8'));
    assert.strictEqual(authB.accessToken, tokenB, 'Profile B auth.json must have userB token');

    // 6. Test restoring A vs restoring B
    cursorAccountAuthStore.restoreAccountAuthFiles('test_profile_a', wrenLiveConfig);
    const restoredLiveA = JSON.parse(fs.readFileSync(path.join(wrenLiveConfig, 'auth.json'), 'utf8'));
    assert.strictEqual(restoredLiveA.accessToken, tokenA, 'Restored live auth must match userA');

    cursorAccountAuthStore.restoreAccountAuthFiles('test_profile_b', wrenLiveConfig);
    const restoredLiveB = JSON.parse(fs.readFileSync(path.join(wrenLiveConfig, 'auth.json'), 'utf8'));
    assert.strictEqual(restoredLiveB.accessToken, tokenB, 'Restored live auth must match userB');

    // Cleanup
    cursorAccountAuthStore.deleteAccountAuthFiles('test_profile_a');
    cursorAccountAuthStore.deleteAccountAuthFiles('test_profile_b');

    console.log('✅ New bare login & pair credentials test passed successfully!');
}

runTest();
