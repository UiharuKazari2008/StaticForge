'use strict';
// DeepInfra as a supported custom provider: config, chat-only model list, the billing reads
// (/payment/checklist + /payment/usage) behind the balance line, and the 402 / 429 handling on
// the bridge. fetch is replaced; nothing leaves the machine.
//   node scripts/test-director-deepinfra-provider.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const custom = require('../modules/customModelProviders');
const bridge = require('../modules/tokenRouterBridge');

const realFetch = global.fetch;
let routes = {};
const calls = [];

function reply(status, body, headers) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return new Response(text, { status, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) });
}

global.fetch = async (url, init = {}) => {
    const key = `${(init.method || 'GET').toUpperCase()} ${url}`;
    calls.push({ key, auth: init.headers && init.headers.authorization });
    const route = routes[key];
    if (!route) throw new Error(`unexpected fetch ${key}`);
    return typeof route === 'function' ? route(init) : route();
};

function memoryGr(providers, keys) {
    const stored = { providers, keys: { keys } };
    return {
        stored,
        getConfig: (opts) => (opts && opts.path === 'customModelProviders' ? stored.providers : []),
        getSecureConfig: (opts) => (opts && opts.path === 'customModelProviders' ? stored.keys : {}),
        updateConfigValue(type, keyPath, value) {
            if (type === 'config') stored.providers = value;
            if (type === 'secureConfig') stored.keys = value;
        }
    };
}

const CHECKLIST = 'GET https://api.deepinfra.com/payment/checklist';
const USAGE = 'GET https://api.deepinfra.com/payment/usage?from=current';

function checklist(fields) {
    return Object.assign({
        email: true, billing_address: true, payment_method: false, suspended: false, overdue_invoices: 0,
        stripe_balance: -12.5, recent: 0.75, limit: null, suspend_reason: null, scoped_credits: []
    }, fields);
}

function testConfig() {
    const preset = custom.PRESETS.find((item) => item.id === 'deepinfra');
    assert.deepStrictEqual(preset, {
        id: 'deepinfra', name: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', defaultModel: 'deepseek-ai/DeepSeek-V4.1-Flash'
    });
    assert.strictEqual(custom.hostKind(preset.baseUrl), 'deepinfra');
    assert.strictEqual(custom.hostKind('https://deepinfra.example.com/v1/openai'), 'generic');

    // Opt-in: nothing exists until it is saved, and the Director's own default stays TokenRouter's.
    const gr = memoryGr([], []);
    assert.strictEqual(custom.lookup(gr, 'custom:deepinfra'), null);
    assert.strictEqual(bridge.DEFAULT_MODEL, 'deepseek/deepseek-v4.1-flash');

    const saved = custom.saveProvider(gr, {
        id: 'deepinfra', name: preset.name, baseUrl: preset.baseUrl, defaultModel: '', apiKey: 'di-secret-456'
    });
    assert.strictEqual(saved.kind, 'deepinfra');
    assert.strictEqual(saved.baseUrl, 'https://api.deepinfra.com/v1/openai', 'the /v1/openai path is kept');
    assert.strictEqual(saved.hasKey, true);
    assert.ok(!JSON.stringify(saved).includes('di-secret'), 'the admin row says set, never the key');
    assert.ok(!JSON.stringify(gr.stored.providers).includes('di-secret'), 'config.json never holds the key');
    assert.deepStrictEqual(gr.stored.keys, { keys: [{ name: 'deepinfra', apiKey: 'di-secret-456' }] });
    assert.ok(!JSON.stringify(custom.publicList(gr)).includes('di-secret'), 'the client engine list has no key');

    const row = custom.lookup(gr, 'custom:deepinfra');
    assert.strictEqual(row.chatUrl, 'https://api.deepinfra.com/v1/openai/chat/completions');
    assert.strictEqual(row.modelsUrl, 'https://api.deepinfra.com/v1/openai/models');
    assert.strictEqual(custom.preferredModel(row), 'deepseek-ai/DeepSeek-V4.1-Flash');

    custom.saveProvider(gr, { id: 'deepinfra', name: 'DeepInfra', baseUrl: preset.baseUrl, apiKey: '' });
    assert.strictEqual(custom.lookup(gr, 'deepinfra').apiKey, 'di-secret-456', 'a blank key keeps the stored one');
    return gr;
}

async function testModelList(gr) {
    custom._test.resetCatalogs();
    routes = {
        'GET https://api.deepinfra.com/v1/openai/models': () => reply(200, {
            object: 'list',
            data: [
                { id: 'thenlper/gte-base', object: 'model', metadata: { pricing: { input_tokens: 0.005 }, tags: ['embed'] } },
                { id: 'deepseek-ai/DeepSeek-V4.1-Flash', object: 'model', metadata: { pricing: { input_tokens: 0.14, output_tokens: 0.28, cache_read_tokens: 0.02 }, tags: ['chat'] } },
                { id: 'black-forest-labs/FLUX-2-pro', object: 'model', metadata: { pricing: { per_image_unit: 3 }, tags: ['image-gen'] } },
                { id: 'Qwen/Qwen3.8-Max', object: 'model', metadata: { pricing: { input_tokens: 1.2, output_tokens: 6 }, tags: ['chat', 'reasoning'] } },
                { id: 'hexgrad/Kokoro-82M', object: 'model', metadata: { pricing: { input_characters: 0.8 }, tags: ['tts'] } },
                { id: 'no-metadata/model', object: 'model' }
            ]
        })
    };
    const cacheFile = path.join(os.tmpdir(), `deepinfra-models-${process.pid}.json`);
    const families = await custom.listModels(gr, 'custom:deepinfra', { cacheFile, force: true });
    assert.deepStrictEqual(families.map((item) => [item.id, item.input, item.output]), [
        ['deepseek-ai/DeepSeek-V4.1-Flash', 0.14, 0.28],
        ['Qwen/Qwen3.8-Max', 1.2, 6]
    ], 'only chat models (priced per output token) are listed');
    assert.strictEqual(calls[calls.length - 1].auth, 'Bearer di-secret-456');
    const run = custom.resolveRun(families, { model: '', effort: 'low' }, custom.lookup(gr, 'deepinfra'));
    assert.strictEqual(run.model, 'deepseek-ai/DeepSeek-V4.1-Flash');
    fs.rmSync(cacheFile, { force: true });
}

function testParsers() {
    assert.deepStrictEqual(custom.parseDeepInfraChecklist(checklist({ limit: 50 })), {
        currency: 'USD', balance: 11.75, recent: 0.75, limit: 50, suspended: false, suspendReason: '', paymentMethod: false
    });
    // Positive stripe_balance is money owed; a negative limit means no limit.
    assert.deepStrictEqual(custom.parseDeepInfraChecklist(checklist({
        stripe_balance: 3.1, recent: 3.1, limit: -1, payment_method: true, suspended: true, suspend_reason: 'bad-cc'
    })), { currency: 'USD', balance: -6.2, recent: 3.1, limit: null, suspended: true, suspendReason: 'bad-cc', paymentMethod: true });
    assert.strictEqual(custom.parseDeepInfraChecklist(checklist({ stripe_balance: -10, recent: -1 })).balance, 10,
        'a negative recent (credit) never adds to the spendable balance');
    assert.strictEqual(custom.parseDeepInfraChecklist(checklist({ limit: 0 })).limit, null, 'limit 0 is no limit');
    assert.strictEqual(custom.parseDeepInfraChecklist({ detail: 'Not authenticated' }), null);
    assert.strictEqual(custom.parseDeepInfraChecklist(null), null);

    assert.strictEqual(custom.parseDeepInfraUsage({ months: [{ period: '2026.10', items: [], total_cost: 1234 }], initial_month: '2026.01' }), 12.34,
        'total_cost is cents');
    assert.strictEqual(custom.parseDeepInfraUsage({ months: [], initial_month: '2026.01' }), null);
    assert.strictEqual(custom.parseDeepInfraUsage({ detail: [{ msg: 'field required' }] }), null);
}

async function testBalances(gr) {
    custom._test.resetBalances();
    let reads = 0;
    let body = checklist({ limit: 50 });
    routes = {
        [CHECKLIST]: (init) => {
            reads++;
            assert.strictEqual(init.headers.authorization, 'Bearer di-secret-456');
            return reply(200, body);
        },
        [USAGE]: () => reply(200, { months: [{ period: '2026.10', items: [], total_cost: 420 }], initial_month: '2026.01' })
    };
    const ok = await custom.balanceSummary(gr, 'custom:deepinfra');
    assert.strictEqual(ok.state, 'ok');
    assert.strictEqual(ok.balance, 11.75, 'spendable = -(stripe_balance + recent)');
    assert.strictEqual(ok.currency, 'USD');
    assert.strictEqual(ok.balanceText, '$11.75');
    assert.strictEqual(ok.recent, 0.75);
    assert.strictEqual(ok.monthSpend, 4.2);
    assert.strictEqual(ok.limit, 50);
    assert.strictEqual(ok.suspended, false);
    assert.deepStrictEqual(ok.title.split('\n'), [
        'DeepInfra balance: $11.75',
        'Spent since the last invoice: $0.75',
        'Spent this month: $4.20',
        'Spending limit: $50.00'
    ]);
    assert.ok(!JSON.stringify(ok).includes('di-secret'), 'a balance row never carries the key');

    body = checklist({ stripe_balance: -0.4, recent: 0 });
    await custom.balanceSummary(gr, 'custom:deepinfra');
    assert.strictEqual(reads, 1, 'a second read inside the cache window does not call DeepInfra');
    const low = await custom.balanceInfo(custom.lookup(gr, 'deepinfra'), { force: true });
    assert.strictEqual(reads, 2);
    assert.strictEqual(low.balance, 0.4);
    assert.strictEqual((await custom.balanceSummary(gr, 'custom:deepinfra')).state, 'low');

    // Owed with a card on file: billed later, the engine keeps running.
    body = checklist({ stripe_balance: 2, recent: 0, payment_method: true });
    await custom.balanceInfo(custom.lookup(gr, 'deepinfra'), { force: true });
    const owed = await custom.balanceSummary(gr, 'custom:deepinfra');
    assert.strictEqual(owed.state, 'ok');
    assert.strictEqual(owed.balance, -2);
    assert.strictEqual(owed.balanceText, '$2.00 owed');
    const badge = await custom.usageSummary(Object.assign({}, gr, {
        getConfig: (opts) => (opts && opts.path === 'customModelProviders'
            ? gr.stored.providers.map((item) => Object.assign({}, item, { monitorUsage: true }))
            : [])
    }), 'custom:deepinfra');
    assert.strictEqual(badge.limited, false, 'a card-billed account is not shown as used up');

    // Owed and no card: out.
    body = checklist({ stripe_balance: 2, payment_method: false });
    await custom.balanceInfo(custom.lookup(gr, 'deepinfra'), { force: true });
    assert.strictEqual((await custom.balanceSummary(gr, 'custom:deepinfra')).state, 'out');

    // Suspended wins over everything, and the reason is named.
    body = checklist({ stripe_balance: -30, suspended: true, suspend_reason: 'limit-reached' });
    await custom.balanceInfo(custom.lookup(gr, 'deepinfra'), { force: true });
    const suspended = await custom.balanceSummary(gr, 'custom:deepinfra');
    assert.strictEqual(suspended.state, 'out');
    assert.strictEqual(suspended.suspended, true);
    assert.strictEqual(suspended.title.split('\n').pop(), 'Suspended: spending limit reached');

    // The usage read failing does not hide the balance; it only drops the month line.
    custom._test.resetBalances();
    routes = { [CHECKLIST]: () => reply(200, checklist({})), [USAGE]: () => reply(500, { detail: 'oops' }) };
    const noMonth = await custom.balanceSummary(gr, 'custom:deepinfra');
    assert.strictEqual(noMonth.state, 'ok');
    assert.strictEqual(noMonth.monthSpend, null);
    assert.ok(!noMonth.title.includes('this month'));

    // A key without billing access: no number is made up.
    custom._test.resetBalances();
    routes = { [CHECKLIST]: () => reply(403, { detail: 'Forbidden' }), [USAGE]: () => reply(403, { detail: 'Forbidden' }) };
    const refused = await custom.balanceSummary(gr, 'custom:deepinfra');
    assert.strictEqual(refused.state, 'error');
    assert.strictEqual(refused.balance, null);
    assert.strictEqual(refused.balanceText, '');
    assert.strictEqual(refused.title, 'DeepInfra balance unavailable (HTTP 403)');
}

async function testCallUpstream(gr) {
    bridge.bindGlobalResources(Object.assign({}, gr, { getConfig: (opts) => gr.getConfig(opts) }));
    const body = { model: 'deepseek-ai/DeepSeek-V4.1-Flash', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] };
    let sent = null;
    routes = {
        'POST https://api.deepinfra.com/v1/openai/chat/completions': (init) => {
            sent = JSON.parse(init.body);
            return reply(200, { choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] });
        }
    };
    const ok = await bridge._test.callUpstream(body, { model: body.model, providerId: 'deepinfra' }, undefined, false);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(sent.model, 'deepseek-ai/DeepSeek-V4.1-Flash');
    assert.strictEqual(calls[calls.length - 1].auth, 'Bearer di-secret-456');

    // 402: not retried, named, and the reply says what to do.
    let paidCalls = 0;
    routes = {
        'POST https://api.deepinfra.com/v1/openai/chat/completions': () => {
            paidCalls++;
            return reply(402, { detail: { error: 'Insufficient balance' } });
        }
    };
    const paid = await bridge._test.callUpstream(body, { model: body.model, providerId: 'deepinfra' }, undefined, false);
    assert.strictEqual(paid.status, 402);
    assert.strictEqual(paid.label, 'DeepInfra');
    assert.strictEqual(paidCalls, 1, '402 is not retried');
    assert.strictEqual(bridge._test.upstreamMessage(paid.text, paid.status, paid.label),
        'DeepInfra 402: insufficient balance. Top up the DeepInfra account, then send again. (Insufficient balance)');
    assert.strictEqual(bridge._test.upstreamMessage(JSON.stringify({ error: { message: 'Not enough funds' } }), 402, 'DeepInfra'),
        'DeepInfra 402: insufficient balance. Top up the DeepInfra account, then send again. (Not enough funds)');

    // 429: backed off (Retry-After), then sent again and answered.
    let limitedCalls = 0;
    routes = {
        'POST https://api.deepinfra.com/v1/openai/chat/completions': () => {
            limitedCalls++;
            if (limitedCalls === 1) return reply(429, { detail: 'Rate limit exceeded' }, { 'retry-after': '0.01' });
            return reply(200, { choices: [{ message: { content: 'again' }, finish_reason: 'stop' }] });
        }
    };
    const retried = await bridge._test.callUpstream(body, { model: body.model, providerId: 'deepinfra' }, undefined, false);
    assert.strictEqual(retried.status, 200);
    assert.strictEqual(limitedCalls, 2, 'the 429 was sent again after the backoff');

    const limited = bridge._test.upstreamMessage(JSON.stringify({ detail: 'Rate limit exceeded' }), 429, 'DeepInfra');
    assert.strictEqual(limited, 'DeepInfra 429: rate limit reached and still limited after waiting. Wait a minute, then send again. (Rate limit exceeded)');
}

async function testHandler(gr) {
    const director = require('../modules/cursorDirector');
    const sent = [];
    const handler = {
        globalResources: Object.assign({}, gr, { getApiKeyManager: () => ({ getActiveApiKey: () => null, getServiceKeys: () => [] }) }),
        sendToClient: (ws, packet) => sent.push(packet),
        sendError: (ws, message) => sent.push({ type: 'error', message })
    };
    custom._test.resetBalances();
    routes = {
        [CHECKLIST]: () => reply(200, checklist({ stripe_balance: -7, recent: 0 })),
        [USAGE]: () => reply(200, { months: [{ period: '2026.10', items: [], total_cost: 99 }], initial_month: '2026.01' })
    };
    await director.handleDirectorCustomProvidersBalance(handler, null, { requestId: 'r1', engine: 'custom:deepinfra' }, { userType: 'admin' });
    const one = sent.pop();
    assert.strictEqual(one.type, 'director_custom_providers_balance_response');
    assert.deepStrictEqual(one.data.balances.map((item) => [item.engine, item.state, item.balanceText, item.monthSpend]),
        [['custom:deepinfra', 'ok', '$7.00', 0.99]]);
    assert.ok(!JSON.stringify(one).includes('di-secret'));

    await director.handleDirectorCustomProvidersGet(handler, null, { requestId: 'r2' }, { userType: 'admin' });
    const got = sent.pop();
    assert.ok(got.data.presets.some((item) => item.id === 'deepinfra' && item.baseUrl === 'https://api.deepinfra.com/v1/openai'));
    assert.ok(!JSON.stringify(got).includes('di-secret'));
}

(async () => {
    const gr = testConfig();
    await testModelList(gr);
    testParsers();
    await testBalances(gr);
    await testCallUpstream(gr);
    await testHandler(gr);
    global.fetch = realFetch;
    console.log('director deepinfra provider: ok');
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
