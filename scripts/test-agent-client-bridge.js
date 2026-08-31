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

const assembled = _test.assembleStudioChangeFromToolArgs({
    prompt: '1girl',
    uc: 'lowres',
    steps: 28,
    sampler: 'k_euler_ancestral',
    characters: [{ index: 0, action: 'replace', prompt: 'alice', uc: '' }]
});
assert.strictEqual(assembled.dreamscape, 'change');
assert.strictEqual(assembled.params.steps, 28);
assert.strictEqual(assembled.params.sampler, 'k_euler_ancestral');
assert.ok(assembled.fields.some((f) => f.id === 'prompt' && f.chunks[0].text === '1girl'));
assert.ok(assembled.fields.some((f) => f.id === 'uc'));
assert.strictEqual(assembled.characters.length, 1);
assert.strictEqual(_test.assembleStudioChangeFromToolArgs({ autoApply: true }), null);
assert.strictEqual(_test.assembleStudioChangeFromToolArgs({ params: { guidance: 5 } }).params.guidance, 5);

const nested = _test.assembleStudioChangeFromToolArgs({
    change: { dreamscape: 'change', v: 1, params: { steps: 23 } },
    guidance: 6
});
assert.strictEqual(nested.params.steps, 23);
assert.strictEqual(nested.params.guidance, 6);

const flatGen = _test.flattenGenerateToolArgs({
    prompt: '1girl',
    params: { steps: 28, rescale: 0.3 },
    characters: [{ prompt: 'alice', uc: 'lowres', name: 'Alice', position: { x: 0.3, y: 0.1 } }]
});
assert.strictEqual(flatGen.steps, 28);
assert.strictEqual(flatGen.rescale, 0.3);
assert.strictEqual(flatGen.params, undefined);
assert.strictEqual(flatGen.allCharacterPrompts[0].chara_name, 'Alice');
assert.strictEqual(flatGen.allCharacterPrompts[0].center.x, 0.3);
assert.strictEqual(flatGen.use_coords, true);

const expandMerged = _test.mergeExpansionOverrideParams({
    filename: 'a.png',
    resolution: 'large_landscape',
    imageBias: 2,
    steps: 28,
    sampler: 'k_euler_ancestral',
    overrideParams: { guidance: 5 }
});
assert.strictEqual(expandMerged.overrideParams.guidance, 5);
assert.strictEqual(expandMerged.overrideParams.steps, 28);
assert.strictEqual(expandMerged.overrideParams.sampler, 'k_euler_ancestral');


assert.strictEqual(_test.readBoolFlag(undefined, true), true);
assert.strictEqual(_test.readBoolFlag(undefined, false), false);
assert.strictEqual(_test.readBoolFlag(null, true), true);
assert.strictEqual(_test.readBoolFlag(true, false), true);
assert.strictEqual(_test.readBoolFlag(false, true), false);
assert.strictEqual(_test.readBoolFlag('true', false), true);
assert.strictEqual(_test.readBoolFlag('false', true), false);
assert.strictEqual(_test.readBoolFlag(1, false), true);
assert.strictEqual(_test.readBoolFlag(0, true), false);
assert.strictEqual(_test.readBoolFlag('nope', true), true);

assert.deepStrictEqual(_test.resolveStudioAutoFlags({}), { autoApply: true, autoGenerate: false });
assert.deepStrictEqual(_test.resolveStudioAutoFlags({ autoApply: false }), { autoApply: false, autoGenerate: false });
assert.deepStrictEqual(
    _test.resolveStudioAutoFlags({ autoApply: true, autoGenerate: true }),
    { autoApply: true, autoGenerate: true }
);
let threw = false;
try {
    _test.resolveStudioAutoFlags({ autoApply: false, autoGenerate: true });
} catch (err) {
    threw = true;
    assert.strictEqual(err.status, 400);
    assert.strictEqual(err.message, 'autoGenerate requires autoApply');
}
assert.strictEqual(threw, true);

const stripped = _test.studioChangePayloadWithoutFlags({
    dreamscape: 'change',
    v: 1,
    autoApply: false,
    autoGenerate: true,
    fields: []
});
assert.strictEqual(stripped.dreamscape, 'change');
assert.strictEqual(stripped.autoApply, undefined);
assert.strictEqual(stripped.autoGenerate, undefined);
assert.strictEqual(_test.studioChangePayloadWithoutFlags({ prompt: 'hi' }), null);

function expectFlagError(body, message) {
    let threwNested = false;
    try {
        _test.resolveStudioAutoFlags(body);
    } catch (err) {
        threwNested = true;
        assert.strictEqual(err.status, 400);
        assert.strictEqual(err.message, message);
    }
    assert.strictEqual(threwNested, true);
}

expectFlagError(
    { change: { dreamscape: 'change', v: 1, autoApply: false, autoGenerate: true } },
    'autoGenerate requires autoApply'
);
expectFlagError(
    { change: { dreamscape: 'change', v: 1, autoApply: true, autoGenerate: true } },
    'autoApply/autoGenerate must be siblings of change, not inside change'
);
expectFlagError(
    { change: { dreamscape: 'change', v: 1, autoApply: false } },
    'autoApply/autoGenerate must be siblings of change, not inside change'
);
assert.deepStrictEqual(
    _test.resolveStudioAutoFlags({
        change: { dreamscape: 'change', v: 1, autoApply: true },
        autoApply: true,
        autoGenerate: false
    }),
    { autoApply: true, autoGenerate: false }
);
const cleaned = _test.stripStudioAutoFlags({ dreamscape: 'change', autoApply: false, autoGenerate: true, v: 1 });
assert.strictEqual(cleaned.dreamscape, 'change');
assert.strictEqual(cleaned.autoApply, undefined);
assert.strictEqual(cleaned.autoGenerate, undefined);

expectFlagError(
    { change: JSON.stringify({ dreamscape: 'change', v: 1, autoApply: true, autoGenerate: true }) },
    'autoApply/autoGenerate must be siblings of change, not inside change'
);
expectFlagError(
    { change: JSON.stringify({ dreamscape: 'change', v: 1, autoApply: false, autoGenerate: true }) },
    'autoGenerate requires autoApply'
);
expectFlagError(
    { change: { dreamscape: 'change', v: 1, fields: { autoApply: true, autoGenerate: true, prompt: 'hi' } } },
    'autoApply/autoGenerate must be siblings of change, not inside change'
);
expectFlagError(
    { change: { dreamscape: 'change', v: 1, fields: { autoApply: false, autoGenerate: true } } },
    'autoGenerate requires autoApply'
);
expectFlagError(
    {
        change: {
            dreamscape: 'change',
            v: 1,
            fields: [
                { id: 'autoApply', value: false },
                { id: 'autoGenerate', value: true },
                { id: 'prompt', action: 'replace', chunks: [{ name: 'Prompt', text: 'hi' }] }
            ]
        }
    },
    'autoGenerate requires autoApply'
);
expectFlagError(
    {
        change: JSON.stringify({
            dreamscape: 'change',
            v: 1,
            fields: { autoApply: true, prompt: 'hi' }
        })
    },
    'autoApply/autoGenerate must be siblings of change, not inside change'
);
assert.deepStrictEqual(
    _test.resolveStudioAutoFlags({
        change: JSON.stringify({ dreamscape: 'change', v: 1, autoApply: true }),
        autoApply: true,
        autoGenerate: false
    }),
    { autoApply: true, autoGenerate: false }
);
const parsed = _test.coerceStudioChangeObject('{"dreamscape":"change","v":1,"autoApply":true}');
assert.strictEqual(parsed.dreamscape, 'change');
assert.strictEqual(parsed.autoApply, true);
const deep = _test.stripStudioAutoFlagsDeep({
    dreamscape: 'change',
    v: 1,
    fields: { autoApply: true, autoGenerate: false, prompt: 'hi' }
});
assert.strictEqual(deep.fields.prompt, 'hi');
assert.strictEqual(deep.fields.autoApply, undefined);
assert.strictEqual(deep.fields.autoGenerate, undefined);

_test.shareCodes.set('EXPIRED', { clientId: 'abc', expiresAt: Date.now() - 10 });
_test.shareCodes.set('LIVEONE', { clientId: 'def', expiresAt: Date.now() + 60000 });
_test.pruneShareCodes();
assert.strictEqual(_test.shareCodes.has('EXPIRED'), false);
assert.strictEqual(_test.shareCodes.has('LIVEONE'), true);
_test.shareCodes.delete('LIVEONE');


assert.strictEqual(_test.UPDATE_COMMAND_TIMEOUT_MS, 20000);

const packet = _test.resolveAgentPacketMessage({
    type: 'get_autofill_ranking',
    data: { extra: 1 }
});
assert.strictEqual(packet.type, 'get_autofill_ranking');
assert.strictEqual(packet.extra, 1);
assert.ok(String(packet.requestId).startsWith('agent-'));
assert.strictEqual(_test.resolveAgentPacketMessage({}), null);
assert.strictEqual(_test.agentHasNamedScope(['autofill'], 'vfs'), false);
assert.strictEqual(_test.agentHasNamedScope(['universal'], 'vfs'), true);
assert.deepStrictEqual(
    _test.resolveAgentAuthScopes({ authMethod: 'dev_login_key', userType: 'dev_admin' }),
    ['universal']
);
assert.deepStrictEqual(
    _test.resolveAgentAuthScopes({
        authMethod: 'application_key',
        applicationAuth: { applicationScopes: ['generation', 'vfs', 'autofill'] }
    }),
    ['generation', 'vfs', 'autofill']
);

console.log('test-agent-client-bridge: ok');
