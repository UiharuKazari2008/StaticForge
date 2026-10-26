'use strict';
// Supported custom providers (NVIDIA NIM, DeepSeek): config, balance reads per host, and the
// 402 / 429 handling on the bridge. fetch is replaced; nothing leaves the machine.
//   node scripts/test-director-nim-providers.js
const assert = require('assert');
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

function testConfig() {
    const preset = custom.PRESETS.find((item) => item.id === 'nvidia');
    assert.deepStrictEqual(preset, {
        id: 'nvidia', name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', defaultModel: 'deepseek-ai/deepseek-v4.1-flash'
    });
    assert.strictEqual(custom.hostKind('https://integrate.api.nvidia.com/v1'), 'nvidia');
    assert.strictEqual(custom.hostKind('https://api.deepseek.com'), 'deepseek');
    assert.strictEqual(custom.hostKind('https://nvidia.example.com'), 'generic');

    const gr = memoryGr([], []);
    // The preset fills the form; the model is left blank to show the host default applies.
    const saved = custom.saveProvider(gr, {
        id: 'nvidia', name: preset.name, baseUrl: preset.baseUrl, defaultModel: '', apiKey: 'nvapi-secret-123'
    });
    assert.strictEqual(saved.kind, 'nvidia');
    assert.strictEqual(saved.baseUrl, 'https://integrate.api.nvidia.com');
    assert.strictEqual(saved.hasKey, true);
    assert.ok(!JSON.stringify(saved).includes('nvapi-secret'), 'the admin row says set, never the key');
    assert.ok(!JSON.stringify(gr.stored.providers).includes('nvapi-secret'), 'config.json never holds the key');
    assert.deepStrictEqual(gr.stored.keys, { keys: [{ name: 'nvidia', apiKey: 'nvapi-secret-123' }] });
    assert.ok(!JSON.stringify(custom.publicList(gr)).includes('nvapi'), 'the client engine list has no key');

    const row = custom.lookup(gr, 'custom:nvidia');
    assert.strictEqual(row.chatUrl, 'https://integrate.api.nvidia.com/v1/chat/completions');
    assert.strictEqual(row.modelsUrl, 'https://integrate.api.nvidia.com/v1/models');
    assert.strictEqual(custom.preferredModel(row), 'deepseek-ai/deepseek-v4.1-flash');

    // Saving again with a blank key keeps the stored one (the form shows "Leave blank to keep").
    custom.saveProvider(gr, { id: 'nvidia', name: 'NVIDIA', baseUrl: preset.baseUrl, apiKey: '' });
    assert.strictEqual(custom.lookup(gr, 'nvidia').apiKey, 'nvapi-secret-123');

    const catalog = [
        { id: 'meta/llama-4-maverick-17b-128e-instruct' },
        { id: 'deepseek-ai/deepseek-v4.1-flash' }
    ];
    const run = custom.resolveRun(catalog, { model: '', effort: 'low' }, row);
    assert.strictEqual(run.model, 'deepseek-ai/deepseek-v4.1-flash', 'NVIDIA defaults to DeepSeek V4.1 Flash');
    const picked = custom.resolveRun(catalog, { model: 'meta/llama-4-maverick-17b-128e-instruct' }, row);
    assert.strictEqual(picked.model, 'meta/llama-4-maverick-17b-128e-instruct', 'a listed model the user picked wins');

    custom.saveProvider(gr, { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-ds' });
    const ds = custom.lookup(gr, 'deepseek');
    assert.strictEqual(ds.chatUrl, 'https://api.deepseek.com/chat/completions');
    assert.strictEqual(ds.modelsUrl, 'https://api.deepseek.com/models');
    assert.strictEqual(custom.preferredModel(ds), '', 'DeepSeek has no forced default; the first listed model runs');
    return gr;
}

async function testModelList(gr) {
    custom._test.resetCatalogs();
    routes = {
        'GET https://integrate.api.nvidia.com/v1/models': () => reply(200, {
            object: 'list',
            data: [{ id: 'deepseek-ai/deepseek-v4.1-flash', object: 'model', owned_by: 'deepseek-ai' }, { id: 'nvidia/nemotron-5-ultra' }]
        })
    };
    const os = require('os');
    const path = require('path');
    const cacheFile = path.join(os.tmpdir(), `nim-models-${process.pid}.json`);
    const families = await custom.listModels(gr, 'custom:nvidia', { cacheFile, force: true });
    assert.deepStrictEqual(families.map((item) => item.id), ['deepseek-ai/deepseek-v4.1-flash', 'nvidia/nemotron-5-ultra']);
    assert.strictEqual(calls[calls.length - 1].auth, 'Bearer nvapi-secret-123');
    require('fs').rmSync(cacheFile, { force: true });
}

function testParsers() {
    const both = custom.parseDeepSeekBalance({
        is_available: true,
        balance_infos: [
            { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
            { currency: 'USD', total_balance: '15.25', granted_balance: '0.25', topped_up_balance: '15.00' }
        ]
    });
    assert.deepStrictEqual(both, { currency: 'USD', balance: 15.25, granted: 0.25, toppedUp: 15, available: true });
    const cny = custom.parseDeepSeekBalance({
        is_available: false,
        balance_infos: [{ currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }]
    });
    assert.deepStrictEqual(cny, { currency: 'CNY', balance: 0, granted: 0, toppedUp: 0, available: false });
    assert.strictEqual(custom.parseDeepSeekBalance({ is_available: true, balance_infos: [] }), null);
    assert.strictEqual(custom.parseDeepSeekBalance({ error: { message: 'Authentication Fails' } }), null);
    assert.strictEqual(custom.moneyText(110, 'CNY'), '¥110.00');
    assert.strictEqual(custom.moneyText(-2.5, 'USD'), '-$2.50');
    assert.strictEqual(custom.moneyText(3, 'EUR'), '3.00 EUR');

    assert.deepStrictEqual(custom.parseRateLimitHeaders(new Headers({
        'x-ratelimit-limit-requests': '40', 'x-ratelimit-remaining-requests': '37', 'x-ratelimit-reset-requests': '1m30s'
    })), { limit: 40, remaining: 37, resetMs: 90000 });
    assert.deepStrictEqual(custom.parseRateLimitHeaders({ 'X-RateLimit-Remaining': '5', 'X-RateLimit-Reset': '12' }),
        { limit: null, remaining: 5, resetMs: 12000 });
    assert.strictEqual(custom.parseRateLimitHeaders(new Headers({ 'content-type': 'application/json' })), null,
        'no headers, no made-up numbers');
}

async function testBalances(gr) {
    custom._test.resetBalances();
    let reads = 0;
    let deepseekBody = {
        is_available: true,
        balance_infos: [{ currency: 'USD', total_balance: '4.20', granted_balance: '1.00', topped_up_balance: '3.20' }]
    };
    routes = {
        'GET https://api.deepseek.com/user/balance': (init) => {
            reads++;
            assert.strictEqual(init.headers.authorization, 'Bearer sk-ds');
            return reply(200, deepseekBody);
        }
    };
    const ds = await custom.balanceSummary(gr, 'custom:deepseek');
    assert.strictEqual(ds.state, 'ok');
    assert.strictEqual(ds.balance, 4.2);
    assert.strictEqual(ds.balanceText, '$4.20');
    assert.strictEqual(ds.granted, 1);
    assert.strictEqual(ds.toppedUp, 3.2);
    assert.ok(!JSON.stringify(ds).includes('sk-ds'), 'a balance row never carries the key');
    deepseekBody = { is_available: false, balance_infos: [{ currency: 'USD', total_balance: '0.00' }] };
    const cached = await custom.balanceSummary(gr, 'custom:deepseek');
    assert.strictEqual(reads, 1, 'a second read inside the cache window does not call DeepSeek');
    assert.strictEqual(cached.balanceText, '$4.20');

    const [first, second] = await Promise.all([
        custom.balanceInfo(custom.lookup(gr, 'deepseek'), { force: true }),
        custom.balanceInfo(custom.lookup(gr, 'deepseek'), { force: true })
    ]);
    assert.strictEqual(reads, 2, 'one read in flight at a time');
    assert.strictEqual(first, second);
    const out = await custom.balanceSummary(gr, 'custom:deepseek');
    assert.strictEqual(out.state, 'out', 'is_available false is out of balance');

    custom._test.resetBalances();
    routes = { 'GET https://api.deepseek.com/user/balance': () => reply(401, { error: { message: 'Authentication Fails (no such user)' } }) };
    const refused = await custom.balanceSummary(gr, 'custom:deepseek');
    assert.strictEqual(refused.state, 'error');
    assert.strictEqual(refused.balance, null);
    assert.ok(refused.title.includes('HTTP 401'));

    // NVIDIA: nothing to fetch. Free tier until a chat response brings rate-limit headers.
    routes = {};
    const before = calls.length;
    const free = await custom.balanceSummary(gr, 'custom:nvidia');
    assert.strictEqual(calls.length, before, 'no NVIDIA call for a balance it does not have');
    assert.strictEqual(free.state, 'free');
    assert.strictEqual(free.balance, null);
    assert.strictEqual(free.balanceText, 'Free tier');
    assert.strictEqual(free.rateLimit, null);
    assert.strictEqual(free.title, 'NVIDIA: free tier, rate-limited');
    custom.noteRateLimit('nvidia', new Headers({ 'x-ratelimit-limit-requests': '40', 'x-ratelimit-remaining-requests': '12' }));
    const seen = await custom.balanceSummary(gr, 'custom:nvidia');
    assert.deepStrictEqual(seen.rateLimit, { limit: 40, remaining: 12, resetMs: null });
    assert.strictEqual(seen.title, 'NVIDIA: free tier, rate-limited\n12 of 40 requests left');

    // OpenRouter credits and a TokenRouter URL with no management key, through the same summary.
    const other = memoryGr([
        { id: 'orouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api' },
        { id: 'trouter', name: 'TokenRouter', baseUrl: 'https://api.tokenrouter.com' },
        { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimax.io' },
        { id: 'nokey', name: 'No Key', baseUrl: 'https://nokey.example' }
    ], [{ name: 'orouter', apiKey: 'sk-or' }, { name: 'trouter', apiKey: 'sk-tr' }, { name: 'minimax', apiKey: 'sk-mm' }]);
    routes = { 'GET https://openrouter.ai/api/v1/credits': () => reply(200, { data: { total_credits: 10, total_usage: 9.5 } }) };
    const list = await custom.balanceSummaries(other);
    const byId = Object.fromEntries(list.map((item) => [item.id, item]));
    assert.strictEqual(byId.orouter.state, 'low');
    assert.strictEqual(byId.orouter.balanceText, '$0.50');
    assert.strictEqual(byId.trouter.state, 'error');
    assert.ok(byId.trouter.title.includes('management key'));
    assert.strictEqual(byId.minimax.state, 'none', 'MiniMax has no balance API, so no number is shown');
    assert.strictEqual(byId.minimax.balanceText, '');
    assert.strictEqual(byId.nokey.state, 'nokey');
}

function testErrorText() {
    const paid = bridge._test.upstreamMessage(JSON.stringify({ error: { message: 'Insufficient Balance' } }), 402, 'DeepSeek');
    assert.strictEqual(paid, 'DeepSeek 402: insufficient balance. Top up the DeepSeek account, then send again. (Insufficient Balance)');
    const limited = bridge._test.upstreamMessage(JSON.stringify({ status: 429, title: 'Too Many Requests', detail: 'Rate limit exceeded' }), 429, 'NVIDIA NIM');
    assert.strictEqual(limited, 'NVIDIA NIM 429: rate limit reached and still limited after waiting. Wait a minute, then send again. (Rate limit exceeded)');
    assert.strictEqual(bridge._test.upstreamMessage('', 500), 'TokenRouter 500: request failed');

    const wait = bridge._test.rateLimitWaitMs;
    assert.deepStrictEqual([0, 1, 2].map((attempt) => wait(attempt, 0)), [2000, 4000, 8000]);
    assert.strictEqual(wait(0, 5000), 5000, 'Retry-After wins');
    assert.strictEqual(wait(0, 600000), 30000, 'a long Retry-After is capped');
}

async function testBackoff() {
    const waits = [];
    const sleep = async (ms) => { waits.push(ms); };
    let n = 0;
    const res = await bridge._test.withRateLimitBackoff(async () => {
        n++;
        if (n === 1) return reply(429, { error: { message: 'slow' } }, { 'retry-after': '3' });
        if (n === 2) return reply(429, { error: { message: 'slow' } });
        return reply(200, { ok: true });
    }, { sleep, label: 'test' });
    assert.strictEqual(res.status, 200);
    assert.strictEqual(n, 3);
    assert.deepStrictEqual(waits, [3000, 4000], 'Retry-After first, then the doubling backoff');

    waits.length = 0;
    let tries = 0;
    const gaveUp = await bridge._test.withRateLimitBackoff(async () => {
        tries++;
        return reply(429, { error: { message: 'slow' } });
    }, { sleep, label: 'test' });
    assert.strictEqual(gaveUp.status, 429);
    assert.strictEqual(tries, 4, 'three retries, then the 429 is passed on');
    assert.deepStrictEqual(waits, [2000, 4000, 8000]);

    const paid = await bridge._test.withRateLimitBackoff(async () => reply(402, { error: { message: 'Insufficient Balance' } }), { sleep });
    assert.strictEqual(paid.status, 402, '402 is not retried');
}

async function testCallUpstream(gr) {
    custom._test.resetBalances();
    bridge.bindGlobalResources(Object.assign({}, gr, { getConfig: (opts) => gr.getConfig(opts) }));
    const body = { model: 'deepseek-ai/deepseek-v4.1-flash', max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] };
    let sent = null;
    routes = {
        'POST https://integrate.api.nvidia.com/v1/chat/completions': (init) => {
            sent = JSON.parse(init.body);
            return reply(200, { choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }] }, {
                'x-ratelimit-limit-requests': '40', 'x-ratelimit-remaining-requests': '39'
            });
        }
    };
    const ok = await bridge._test.callUpstream(body, { model: body.model, providerId: 'nvidia' }, undefined, false);
    assert.strictEqual(ok.status, 200);
    assert.strictEqual(sent.model, 'deepseek-ai/deepseek-v4.1-flash');
    assert.strictEqual(calls[calls.length - 1].auth, 'Bearer nvapi-secret-123');
    const after = await custom.balanceSummary(gr, 'custom:nvidia');
    assert.strictEqual(after.rateLimit.remaining, 39, 'the chat response headers reach the NVIDIA balance line');

    routes = { 'POST https://api.deepseek.com/chat/completions': () => reply(402, { error: { message: 'Insufficient Balance', type: 'unknown_error' } }) };
    const paid = await bridge._test.callUpstream(
        { ...body, model: 'deepseek-chat' }, { model: 'deepseek-chat', providerId: 'deepseek' }, undefined, false
    );
    assert.strictEqual(paid.status, 402);
    assert.strictEqual(paid.label, 'DeepSeek');
    assert.ok(bridge._test.upstreamMessage(paid.text, paid.status, paid.label).startsWith('DeepSeek 402: insufficient balance.'));
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
    routes = { 'GET https://api.deepseek.com/user/balance': () => reply(200, { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '8.80' }] }) };
    await director.handleDirectorCustomProvidersBalance(handler, null, { requestId: 'r1', engine: 'custom:deepseek' }, { userType: 'admin' });
    const one = sent.pop();
    assert.strictEqual(one.type, 'director_custom_providers_balance_response');
    assert.strictEqual(one.requestId, 'r1');
    assert.deepStrictEqual(one.data.balances.map((item) => [item.engine, item.state, item.balanceText]), [['custom:deepseek', 'ok', '¥8.80']]);
    assert.ok(!JSON.stringify(one).includes('sk-ds'));

    await director.handleDirectorCustomProvidersBalance(handler, null, { requestId: 'r2' }, { userType: 'restricted' });
    assert.deepStrictEqual(sent.pop().data.balances, [], 'restricted users see no balances');

    await director.handleDirectorCustomProvidersGet(handler, null, { requestId: 'r3' }, { userType: 'admin' });
    const got = sent.pop();
    assert.deepStrictEqual(got.data.presets.map((item) => item.id), custom.PRESETS.map((item) => item.id));
    assert.ok(!JSON.stringify(got).includes('nvapi-secret'));
}

(async () => {
    const gr = testConfig();
    await testModelList(gr);
    testParsers();
    await testBalances(gr);
    testErrorText();
    await testBackoff();
    await testCallUpstream(gr);
    await testHandler(gr);
    global.fetch = realFetch;
    console.log('director nim providers: ok');
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
