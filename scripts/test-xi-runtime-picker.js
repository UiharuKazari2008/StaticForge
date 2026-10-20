'use strict';

// Runtime picker: chosen once at session creation, exposed on the public
// session, and immutable afterward. Unit-level — handleDirectorCreateSession /
// handleDirectorSendMessage read and write the real ~/.cache/dreamscape-xi
// index.json, so they are not exercised here; this tests the pure logic they
// both call through (sanitizeRuntime / assertRuntimeUnchanged / publicXiSession).

const assert = require('assert');
const xiDirector = require('../modules/xiDirector');
const tokenRouter = require('../modules/tokenRouterBridge');

function main() {
    const {
        sanitizeRuntime, assertRuntimeUnchanged, publicXiSession,
        usesClaudeCli, xiIdentityLine, XI_TOKENROUTER_DEFAULT_MODEL
    } = xiDirector._test;

    // sanitizeRuntime: 'cursor' | 'claude' | 'tokenrouter' survive. Everything
    // else (including unset) defaults to 'cursor' so existing sessions without
    // a runtime field stay on Cursor.
    assert.strictEqual(sanitizeRuntime('claude'), 'claude');
    assert.strictEqual(sanitizeRuntime('cursor'), 'cursor');
    assert.strictEqual(sanitizeRuntime('tokenrouter'), 'tokenrouter');
    assert.strictEqual(sanitizeRuntime('TOKENROUTER'), 'tokenrouter');
    assert.strictEqual(sanitizeRuntime('CLAUDE'), 'claude');
    assert.strictEqual(sanitizeRuntime(undefined), 'cursor');
    assert.strictEqual(sanitizeRuntime(null), 'cursor');
    assert.strictEqual(sanitizeRuntime('grok'), 'cursor');
    assert.strictEqual(sanitizeRuntime(''), 'cursor');
    assert.strictEqual(sanitizeRuntime('custom:sloproxy'), 'custom:sloproxy');
    assert.strictEqual(sanitizeRuntime('CUSTOM:SloProxy'), 'custom:sloproxy');
    assert.strictEqual(sanitizeRuntime('custom:bad id'), 'cursor');
    assert.strictEqual(usesClaudeCli('custom:sloproxy'), true);

    assert.strictEqual(usesClaudeCli('claude'), true);
    assert.strictEqual(usesClaudeCli('tokenrouter'), true);
    assert.strictEqual(usesClaudeCli('cursor'), false);
    assert.strictEqual(XI_TOKENROUTER_DEFAULT_MODEL, tokenRouter.DEFAULT_MODEL);
    assert.strictEqual(XI_TOKENROUTER_DEFAULT_MODEL, 'deepseek/deepseek-v4.1-flash');
    assert.ok(xiIdentityLine('tokenrouter').includes('TokenRouter'));
    assert.ok(xiIdentityLine('claude').includes('Claude Code'));
    assert.ok(xiIdentityLine('cursor').includes('Cursor'));

    // Picker persists: whatever was chosen at creation comes back on the public
    // session shape, unaffected by anything else on the chat.
    const chat = {
        id: 'xi_test1',
        runtime: 'claude',
        name: 'Xi',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        messages: []
    };
    assert.strictEqual(publicXiSession(chat).runtime, 'claude');
    assert.strictEqual(publicXiSession(chat).persona, 'xi');

    const cursorChat = Object.assign({}, chat, { id: 'xi_test2', runtime: 'cursor' });
    assert.strictEqual(publicXiSession(cursorChat).runtime, 'cursor');

    const routerChat = Object.assign({}, chat, { id: 'xi_test4', runtime: 'tokenrouter' });
    assert.strictEqual(publicXiSession(routerChat).runtime, 'tokenrouter');

    // A session created before this feature existed (no runtime field at all)
    // reads back as 'cursor', the pre-existing default behavior.
    const legacyChat = Object.assign({}, chat, { id: 'xi_test3', runtime: undefined });
    assert.strictEqual(publicXiSession(legacyChat).runtime, 'cursor');

    // Immutable: a message that doesn't mention runtime is always fine (this is
    // the common case — the client only sends it back for display, not to change).
    assertRuntimeUnchanged(chat, {});
    assertRuntimeUnchanged(chat, { runtime: undefined });
    // Echoing the session's own runtime back is also fine (not a change).
    assertRuntimeUnchanged(chat, { runtime: 'claude' });
    assertRuntimeUnchanged(cursorChat, { runtime: 'cursor' });
    assertRuntimeUnchanged(routerChat, { runtime: 'tokenrouter' });

    // An explicit attempt to switch runtime mid-session is rejected.
    assert.throws(() => assertRuntimeUnchanged(chat, { runtime: 'cursor' }), /cannot change after creation/);
    assert.throws(() => assertRuntimeUnchanged(cursorChat, { runtime: 'claude' }), /cannot change after creation/);
    assert.throws(() => assertRuntimeUnchanged(routerChat, { runtime: 'cursor' }), /cannot change after creation/);
    assert.throws(() => assertRuntimeUnchanged(cursorChat, { runtime: 'tokenrouter' }), /cannot change after creation/);
    try {
        assertRuntimeUnchanged(chat, { runtime: 'cursor' });
        assert.fail('expected RUNTIME_LOCKED');
    } catch (err) {
        assert.strictEqual(err.code, 'RUNTIME_LOCKED');
    }

    console.log('xi runtime picker tests passed');
}

main();
