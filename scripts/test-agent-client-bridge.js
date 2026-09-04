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
const dynOnly = _test.assembleStudioChangeFromToolArgs({
    dynamicGeneration: { enabled: true, directive: 'golden hour' }
});
assert.strictEqual(dynOnly.dreamscape, 'change');
assert.strictEqual(dynOnly.dynamicGeneration.enabled, true);
assert.strictEqual(dynOnly.dynamicGeneration.directive, 'golden hour');
const directorOnly = _test.assembleStudioChangeFromToolArgs({
    director: { sessionId: 's1', prompt: 'tighten tags' }
});
assert.strictEqual(directorOnly.director.sessionId, 's1');
assert.strictEqual(_test.assembleStudioChangeFromToolArgs({ params: { guidance: 5 } }).params.guidance, 5);

const nested = _test.assembleStudioChangeFromToolArgs({
    change: { dreamscape: 'change', v: 1, params: { steps: 23 } },
    guidance: 6
});
assert.strictEqual(nested.params.steps, 23);
assert.strictEqual(nested.params.guidance, 6);
assert.strictEqual(_test.assembleStudioChangeFromToolArgs({
    dataset_config: { nsfw: 3 }
}).params.nsfw, 3);
assert.strictEqual(_test.assembleStudioChangeFromToolArgs({
    params: { nsfw: 2 }
}).params.nsfw, 2);
assert.strictEqual(_test.assembleStudioChangeFromToolArgs({
    nsfw: 1
}).params.nsfw, 1);
assert.strictEqual(_test.assembleStudioChangeFromToolArgs({
    params: { dataset_config: { nsfw: '-2' } }
}).params.nsfw, -2);
assert.strictEqual(_test.pickNsfwFromStudioArgs({ nsfw: 9 }, {}), undefined);

const liftedFlags = _test.assembleStudioChangeFromToolArgs({
    append_transparency: true,
    n: 2,
    normalize_vibes: true,
    use_coords: true,
    dataset_config: {
        include: ['ds_foo'],
        settings: { __quality__: { no_text: { enabled: false } } }
    }
});
assert.strictEqual(liftedFlags.params.append_transparency, true);
assert.strictEqual(liftedFlags.params.n, 2);
assert.strictEqual(liftedFlags.params.normalize_vibes, true);
assert.strictEqual(liftedFlags.params.use_coords, true);
assert.strictEqual(liftedFlags.dataset_config.settings.__quality__.no_text.enabled, false);
assert.deepStrictEqual(liftedFlags.params.dataset_config.include, ['ds_foo']);
assert.ok(_test.STUDIO_CHANGE_PARAM_KEYS.includes('append_transparency'));
assert.ok(_test.STUDIO_CHANGE_PARAM_KEYS.includes('n'));
assert.ok(_test.STUDIO_CHANGE_PARAM_KEYS.includes('auto_clean_uc'));

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

const flatDyn = _test.flattenGenerateToolArgs({
    prompt: '1girl',
    dynamicGeneration: { enabled: true, directive: 'rain' },
    director: { sessionId: 's1', messageId: 'm1', prompt: 'use rain' }
});
assert.strictEqual(flatDyn.dynamic_generation.enabled, true);
assert.strictEqual(flatDyn.director_session_id, 's1');
assert.strictEqual(flatDyn.director_message_id, 'm1');
assert.strictEqual(flatDyn.dynamic_generation.directive, 'rain');
assert.strictEqual(_test.flattenGenerateToolArgs({
    prompt: '1girl',
    userApprovedPaidRequest: true
}).allow_paid, true);
assert.strictEqual(_test.dynagenShouldCompile({ enabled: false, integrated: true }), false);
assert.strictEqual(_test.dynagenShouldCompile({ enabled: true, tod: true }), true);
assert.strictEqual(_test.dynagenShouldCompile(null), false);

const flatPrints = _test.flattenGenerateToolArgs({
    prompt: '1girl',
    params: { n: 3 }
});
assert.strictEqual(flatPrints.n, 3);
assert.strictEqual(_test.flattenGenerateToolArgs({ prompt: '1girl', n: 1 }).n, undefined);
assert.strictEqual(_test.flattenGenerateToolArgs({ prompt: '1girl', n: 9 }).n, 8);

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
const expandPromptOverride = _test.mergeExpansionOverrideParams({
    filename: 'a.png',
    resolution: 'normal_landscape',
    imageBias: 1,
    prompt: 'sunset continues to the right',
    uc: 'border, frame'
});
assert.strictEqual(expandPromptOverride.overrideParams.expansionPromptOverride, 'sunset continues to the right');
assert.strictEqual(expandPromptOverride.overrideParams.expansionUcOverride, 'border, frame');


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
assert.strictEqual(_test.BIND_IDLE_MS, 15 * 60 * 1000);
assert.strictEqual(_test.resolveBindKey({
    applicationAuth: { applicationKeyId: 'key-a' },
    authMethod: 'application_key'
}), 'appkey:key-a');
assert.strictEqual(_test.resolveBindKey({
    applicationAuth: { applicationKeyId: 'key-b' },
    authMethod: 'application_key'
}), 'appkey:key-b');
assert.strictEqual(_test.resolveBindKey({ authMethod: 'dev_login_key' }), 'dev_login_key');
assert.notStrictEqual(
    _test.resolveBindKey({ applicationAuth: { applicationKeyId: 'key-a' } }),
    _test.resolveBindKey({ applicationAuth: { applicationKeyId: 'key-b' } })
);
_test.bindSessions.set('appkey:key-a', { clientId: 'aaa', lastInteractionAt: Date.now() - (_test.BIND_IDLE_MS + 5), boundAt: Date.now() });
assert.strictEqual(_test.expireIdleBind('appkey:key-a'), null);
assert.strictEqual(_test.bindSessions.has('appkey:key-a'), false);
_test.bindSessions.set('appkey:key-a', { clientId: 'tab-a', lastInteractionAt: Date.now(), boundAt: Date.now() });
_test.bindSessions.set('appkey:key-b', { clientId: 'tab-b', lastInteractionAt: Date.now(), boundAt: Date.now() });
assert.strictEqual(_test.bindSessions.get('appkey:key-a').clientId, 'tab-a');
assert.strictEqual(_test.bindSessions.get('appkey:key-b').clientId, 'tab-b');
_test.bindSessions.clear();

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

assert.strictEqual(_test.resolveActorName({ applicationAuth: { appName: 'Grok' } }), 'Grok');
assert.strictEqual(_test.resolveActorName({ applicationAuth: { appName: '  ' } }), null);
assert.strictEqual(_test.resolveActorName({}), null);

const emptyWsResources = { getWebSocketServer: () => ({ clients: new Map() }) };
assert.strictEqual(_test.resolveGenerateWorkspaceId(emptyWsResources, {}, { workspace: 'folder-a' }), 'folder-a');
assert.strictEqual(_test.resolveGenerateWorkspaceId(emptyWsResources, {}, { workspace: 'default' }), 'default');
assert.strictEqual(_test.resolveGenerateWorkspaceId(emptyWsResources, {}, {}), 'default');
assert.strictEqual(_test.inferBoundWorkspaceId(emptyWsResources, {}), null);

const dynCfg = _test.dynamicConfigFromSnapshot({ tod: 'night', weather: 'rain', season: true, location: 'TOKYO' });
assert.strictEqual(dynCfg.tod, 'night');
assert.strictEqual(dynCfg.weather, 'rain');
assert.strictEqual(dynCfg.location, 'TOKYO');

assert.strictEqual(_test.dynagenNeedsIntegration(null), false);
assert.strictEqual(_test.dynagenNeedsIntegration({ enabled: false }), false);
assert.strictEqual(_test.dynagenNeedsIntegration({ enabled: true, integrated: true }), false);
assert.strictEqual(_test.dynagenNeedsIntegration({
    compiled_prompt: { success: true, prompt_hash: 'p', request_hash: 'r' }
}), false);
assert.strictEqual(_test.dynagenNeedsIntegration({ tod: true, weather: true }), true);
assert.strictEqual(_test.dynagenNeedsIntegration(true), true);
assert.strictEqual(_test.dynagenNeedsIntegration({
    enabled: true,
    compiled_prompt: { success: false }
}), false);
const nsfwFlat = _test.flattenGenerateToolArgs({ prompt: 'x', nsfw: 3 });
assert.strictEqual(nsfwFlat.dataset_config.nsfw, 3);
assert.deepStrictEqual(_test.pickDynagenFromInput({ dynamic_generation: { tod: 'night' } }), { tod: 'night' });
assert.deepStrictEqual(_test.pickPhysicsOverrides({ location: 'TOKYO', weather: true }), {
    location: 'TOKYO',
    weather: true
});
const sanitized = _test.sanitizeDynagenForGenerate({
    dynamicGeneration: {
        tod: true,
        integrated: true,
        resolved: { weather: 'rain' },
        directorApi: 'noop'
    }
});
assert.strictEqual(sanitized.dynamic_generation.tod, true);
assert.strictEqual(sanitized.dynamic_generation.integrated, undefined);
assert.strictEqual(sanitized.dynamic_generation.resolved, undefined);
assert.strictEqual(sanitized.dynamic_generation.directorApi, undefined);
const bounce = _test.buildDynagenIntegrationPayload({
    enabled: true,
    resolved: { weather: 'rain' },
    directorApi: 'noop'
});
assert.strictEqual(bounce.success, false);
assert.strictEqual(bounce.needsIntegration, true);
assert.ok(bounce.next.includes('integrated=true'));
assert.ok(_test.DYNAGEN_INTEGRATION_NEXT.includes('Director API is nooped'));

const stubResources = { getWebSocketServer: () => ({ clients: new Map() }) };
const bridge = require('../modules/agentClientBridge');

Promise.all([
    _test.enrichDynamicGenerationForMcp(stubResources, 'missing', { enabled: false, tod: 'night' }),
    bridge.getClientPhysics(stubResources, null, { enabled: false })
]).then(([disabledDyn, physics]) => {
    assert.strictEqual(disabledDyn.directorApi, 'noop');
    assert.strictEqual(disabledDyn.enabled, false);
    assert.strictEqual(disabledDyn.resolved, null);
    assert.strictEqual(physics.success, true);
    assert.strictEqual(physics.unbound, true);
    assert.strictEqual(physics.clientId, null);
    assert.strictEqual(physics.resolved, null);
    assert.strictEqual(physics.dynamicGeneration.directorApi, 'noop');
    console.log('test-agent-client-bridge: ok');
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
