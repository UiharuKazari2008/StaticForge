const assert = require('assert');
const { _test } = require('../modules/agentClientBridge');

assert.strictEqual(_test.SHARE_ALPHABET.includes('0'), false);
assert.strictEqual(_test.SHARE_ALPHABET.includes('O'), false);
assert.strictEqual(_test.SHARE_ALPHABET.includes('1'), false);
assert.strictEqual(_test.SHARE_ALPHABET.includes('I'), false);
assert.strictEqual(_test.SHARE_TTL_MS, 5 * 60 * 1000);

const codes = new Set();
for (let i = 0; i < 40; i++) {
    const code = _test.generateShareCode();
    assert.strictEqual(code.length, 6);
    assert.ok(/^[A-Z2-9]+$/.test(code));
    for (const ch of code) {
        assert.ok(_test.SHARE_ALPHABET.includes(ch));
    }
    codes.add(code);
}
assert.ok(codes.size > 1);

const id = _test.generateClientId();
assert.strictEqual(id.length, 12);
assert.ok(/^[0-9a-f]+$/.test(id));

assert.strictEqual(_test.snippetUserAgent('  Mozilla/5.0   Extra  '), 'Mozilla/5.0 Extra');
assert.ok(_test.snippetUserAgent('x'.repeat(200)).length <= 80);

assert.strictEqual(_test.isStudioChangePayload({ dreamscape: 'change', v: 1 }), true);
assert.strictEqual(_test.isStudioChangePayload({ type: 'dreamscape-change' }), true);
assert.strictEqual(_test.isStudioChangePayload({ prompt: 'hi' }), false);

_test.shareCodes.set('EXPIRED', { clientId: 'abc', expiresAt: Date.now() - 10 });
_test.shareCodes.set('LIVEONE', { clientId: 'def', expiresAt: Date.now() + 60000 });
_test.pruneShareCodes();
assert.strictEqual(_test.shareCodes.has('EXPIRED'), false);
assert.strictEqual(_test.shareCodes.has('LIVEONE'), true);
_test.shareCodes.delete('LIVEONE');

console.log('test-agent-client-bridge: ok');
