'use strict';

// Xi job identity: the shared "Xi" MCP key (both Cursor- and Claude-runtime
// jobs use it, per #395) maps to the Dovecote mailbox owner of whichever
// runtime is actually driving the call, via xiDirector's own sanitizeRuntime/
// activeRuntime — not a second, possibly-divergent copy of that logic.

const assert = require('assert');
const xiDirector = require('../modules/xiDirector');
const { resolveDovecoteOwnerFromReq } = require('../modules/dovecoteIdentity');

function main() {
    // sanitizeRuntime and activeRuntime are now real top-level exports, not
    // just _test-only — other modules (dovecoteIdentity) depend on them.
    assert.strictEqual(typeof xiDirector.sanitizeRuntime, 'function');
    assert.strictEqual(typeof xiDirector.activeRuntime, 'function');
    assert.strictEqual(xiDirector.sanitizeRuntime('claude'), 'claude');
    assert.strictEqual(xiDirector.sanitizeRuntime('cursor'), 'cursor');
    assert.strictEqual(xiDirector.sanitizeRuntime('nonsense'), 'cursor');

    // No Xi session running in this process, so there is nothing "active" —
    // this is the ordinary state for every non-Xi MCP caller too.
    assert.strictEqual(xiDirector.activeRuntime(), null);

    // Ordinary bot callers resolve by name, case-insensitively, straight from
    // the application key's appName.
    assert.strictEqual(resolveDovecoteOwnerFromReq({ applicationAuth: { appName: 'Menma' } }), 'menma');
    assert.strictEqual(resolveDovecoteOwnerFromReq({ applicationAuth: { appName: 'ROOK' } }), 'rook');
    assert.strictEqual(resolveDovecoteOwnerFromReq({ applicationAuth: { appName: 'Grok' } }), null);
    assert.strictEqual(resolveDovecoteOwnerFromReq({ applicationAuth: { appName: 'Yukimi' } }), null);
    assert.strictEqual(resolveDovecoteOwnerFromReq({}), null);

    // The shared "Xi" key (Cursor- and Claude-runtime jobs both authenticate
    // as this one key) maps to the active session's runtime, defaulting to
    // 'cursor' (the #395 picker's own default) when nothing is actively running.
    assert.strictEqual(resolveDovecoteOwnerFromReq({ applicationAuth: { appName: 'Xi' } }), 'cursor');
    assert.strictEqual(resolveDovecoteOwnerFromReq({ applicationAuth: { appName: 'xi' } }), 'cursor');

    console.log('dovecote runtime plumbing tests passed');
}

main();
