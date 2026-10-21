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
assert.strictEqual(marked.monitorUsage, false);
assert.strictEqual(marked.kind, 'generic');

assert.strictEqual(custom.hostKind('https://api.tokenrouter.com'), 'tokenrouter');
assert.strictEqual(custom.hostKind('https://api.openai.com/v1'), 'openai');
assert.strictEqual(custom.hostKind('https://generativelanguage.googleapis.com/v1beta/openai'), 'google');
assert.strictEqual(custom.hostKind('https://openrouter.ai/api'), 'openrouter');
assert.strictEqual(custom.hostKind('https://sloproxy-10af421.gcti.moe'), 'generic');
assert.deepStrictEqual(custom.PRESETS.map((item) => item.id), ['google', 'openai', 'tokenrouter', 'openrouter']);

const routed = custom.saveProvider(memoryGr, {
    id: 'routerbox',
    name: 'Router Box',
    baseUrl: 'https://api.tokenrouter.com',
    monitorUsage: false,
    apiKey: 'sk-router',
    managementKey: 'mgmt-secret'
});
assert.strictEqual(routed.kind, 'tokenrouter');
assert.strictEqual(routed.monitorUsage, false);
assert.strictEqual(routed.hasManagementKey, true);
assert.strictEqual(JSON.stringify(routed).includes('mgmt-secret'), false);
assert.strictEqual(JSON.stringify(custom.publicList(memoryGr)).includes('mgmt-secret'), false);
const os = require('os');
const fs = require('fs');
const path = require('path');
const logoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'provider-logo-'));
custom._test.setLogoDir(logoDir);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const withLogo = custom.saveProvider(memoryGr, {
    id: 'routerbox',
    name: 'Router Box',
    baseUrl: 'https://api.tokenrouter.com',
    apiKey: '',
    managementKey: '',
    logo: `data:image/png;base64,${png.toString('base64')}`
});
assert.ok(withLogo.logo.startsWith('data:image/png;base64,'));
assert.strictEqual(withLogo.hasManagementKey, true);

const metered = custom.saveProvider(memoryGr, {
    id: 'metered',
    name: 'Metered',
    baseUrl: 'https://api.tokenrouter.com',
    monitorUsage: true,
    apiKey: 'sk-meter'
});
assert.strictEqual(metered.hasManagementKey, false);

Promise.all([
    custom.usageSummary(memoryGr, 'custom:routerbox'),
    custom.usageSummary(memoryGr, 'custom:metered')
]).then(([hidden, shown]) => {
    assert.strictEqual(hidden.hidden, true);
    assert.strictEqual(shown.hidden, false);
    assert.ok(shown.title.includes('add a management key'));
    console.log('custom model provider tests passed');
}).catch((error) => {
    console.error(error);
    process.exit(1);
});
