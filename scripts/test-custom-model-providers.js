'use strict';
// Custom OpenAI providers: catalog parsing drops upstream secrets, and engine ids round-trip.
//   node scripts/test-custom-model-providers.js
const assert = require('assert');
const custom = require('../modules/customModelProviders');

const body = {
    data: [
        {
            id: 'openai/deepseek-ai/DeepSeek-V4.1-Flash-1017',
            name: 'deepseek-ai/DeepSeek-V4.1-Flash-1017',
            _provider: { apiKey: 'sk-upstream-secret', baseUrl: 'https://upstream.example/api/v1' }
        },
        { id: 'not valid', name: 'skip' },
        { id: 'openai/google/gemma-4-31B-it', name: 'google/gemma-4-31B-it' }
    ]
};
const families = custom.catalogFromModels(body, 'SloProxy');
assert.deepStrictEqual(families.map((row) => row.id), [
    'openai/deepseek-ai/DeepSeek-V4.1-Flash-1017',
    'openai/google/gemma-4-31B-it'
]);
assert.strictEqual(families[0].provider, 'SloProxy');
assert.strictEqual(JSON.stringify(families).includes('sk-upstream'), false);
assert.strictEqual(JSON.stringify(families).includes('_provider'), false);

assert.strictEqual(custom.normalizeBaseUrl('https://sloproxy-10af421.gcti.moe/v1/'), 'https://sloproxy-10af421.gcti.moe');
assert.strictEqual(custom.normalizeBaseUrl('http://example.com'), '');
assert.strictEqual(custom.normalizeBaseUrl('https://user:pass@example.com'), '');

assert.strictEqual(custom.isEngine('custom:sloproxy'), true);
assert.strictEqual(custom.isEngine('Custom:SloProxy'), true);
assert.strictEqual(custom.providerId('custom:sloproxy'), 'sloproxy');
assert.strictEqual(custom.isEngine('tokenrouter'), false);
assert.strictEqual(custom.isEngine('custom:Bad Id'), false);

const gr = {
    getConfig() {
        return [{ id: 'sloproxy', name: 'SloProxy', baseUrl: 'https://sloproxy-10af421.gcti.moe', defaultModel: families[0].id }];
    },
    getSecureConfig() {
        return { keys: [{ name: 'sloproxy', apiKey: 'sk-test' }] };
    }
};
assert.strictEqual(custom.lookup(gr, { id: 'sloproxy' }).engine, 'custom:sloproxy');
assert.strictEqual(custom.requireReady(gr, custom.lookup(gr, 'custom:sloproxy')).id, 'sloproxy');

const resolved = custom.resolveRun(families, { model: 'missing', effort: 'high' }, {
    defaultModel: 'openai/google/gemma-4-31B-it'
});
assert.strictEqual(resolved.model, 'openai/google/gemma-4-31B-it');
assert.strictEqual(resolved.effort, 'high');
assert.strictEqual(resolved.fast, false);

const stored = {
    providers: [{ id: 'sloproxy', name: 'SloProxy', baseUrl: 'https://sloproxy-10af421.gcti.moe', defaultModel: families[0].id }],
    keys: { keys: [{ name: 'sloproxy', apiKey: 'sk-test' }] }
};
const memoryGr = {
    getConfig(opts) {
        if (opts && opts.path === 'customModelProviders') return stored.providers;
        return [];
    },
    getSecureConfig(opts) {
        if (opts && opts.path === 'customModelProviders') return stored.keys;
        return {};
    },
    updateConfigValue(type, keyPath, value) {
        if (type === 'config') stored.providers = value;
        if (type === 'secureConfig') stored.keys = value;
    }
};
assert.strictEqual(custom.memoryStoreForEngine(memoryGr, 'custom:sloproxy'), '');
assert.strictEqual(custom.ageToolEnabled(memoryGr, 'custom:sloproxy'), true);
const marked = custom.saveProvider(memoryGr, {
    id: 'sloproxy',
    name: 'SloProxy',
    baseUrl: 'https://sloproxy-10af421.gcti.moe/v1',
    defaultModel: families[0].id,
    obliteratedMemories: true,
    ageTool: false,
    apiKey: ''
});
assert.strictEqual(marked.obliteratedMemories, true);
assert.strictEqual(marked.ageTool, false);
assert.strictEqual(marked.hasKey, true);
assert.strictEqual(marked.baseUrl, 'https://sloproxy-10af421.gcti.moe');
assert.strictEqual(custom.memoryStoreForEngine(memoryGr, 'custom:sloproxy'), 'obliterated');
assert.strictEqual(custom.ageToolEnabled(memoryGr, 'custom:sloproxy'), false);
assert.strictEqual(JSON.stringify(marked).includes('sk-test'), false);

console.log('custom model provider tests passed');
