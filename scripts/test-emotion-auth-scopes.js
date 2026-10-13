'use strict';

// JULES: Regression test to ensure animate and upscale status are allowed in the generation scope
const assert = require('assert');
const { scopesAllowPacket } = require('../modules/applicationAuthManager');

function main() {
    // Generate scopes mock
    const scopes = ['generation'];

    // Before the fix, emotion_current_job, local_animate_status, local_upscale_status would return false
    // We expect them to return true with the fix.

    assert.ok(scopesAllowPacket(scopes, 'emotion_current_job'), 'emotion_current_job is rejected by scopesAllowPacket for generation scope');
    assert.ok(scopesAllowPacket(scopes, 'local_animate_status'), 'local_animate_status is rejected by scopesAllowPacket for generation scope');
    assert.ok(scopesAllowPacket(scopes, 'local_upscale_status'), 'local_upscale_status is rejected by scopesAllowPacket for generation scope');

    console.log('✅ test-emotion-auth-scopes.js passed');
}

main();
