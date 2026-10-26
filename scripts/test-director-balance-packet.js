#!/usr/bin/env node
'use strict';
// director_custom_providers_balance goes through the real packet registry (Yozora #661 shipped a
// handler directorImpl never exported: every packet threw "fn is not a function"), and the
// handler answers with a balances list no matter what a provider does.
const assert = require('assert');
const custom = require('../modules/customModelProviders');
const impl = require('../modules/ws/handlers/directorImpl');
const registry = require('../modules/ws/wsPacketRegistry');
const realFetch = global.fetch;

function memoryGr(providers, keys) {
    const stored = { providers, keys: { keys } };
    return {
        getConfig: (opts) => (opts && opts.path === 'customModelProviders' ? stored.providers : []),
        getSecureConfig: (opts) => (opts && opts.path === 'customModelProviders' ? stored.keys : {}),
        updateConfigValue(type, _keyPath, value) {
            if (type === 'config') stored.providers = value;
            if (type === 'secureConfig') stored.keys = value;
        },
        getApiKeyManager: () => ({ getActiveApiKey: () => null, getServiceKeys: () => [] })
    };
}

(async () => {
    // every handler 40-directorHandler names is a function in directorImpl
    const src = require('fs').readFileSync(require.resolve('../modules/ws/handlers/40-directorHandler.js'), 'utf8');
    const names = (src.match(/const \{([\s\S]*?)\} = require\('\.\/directorImpl'\)/) || [])[1].split(',').map((s) => s.trim()).filter(Boolean);
    assert.ok(names.includes('handleDirectorCustomProvidersBalance'));
    names.forEach((n) => assert.strictEqual(typeof impl[n], 'function', `directorImpl exports ${n}`));

    require('../modules/ws/handlers/40-directorHandler.js').registerPackets({});
    const run = registry.getWsPacketHandler('director_custom_providers_balance');
    assert.strictEqual(typeof run, 'function', 'balance packet registered');

    const gr = memoryGr([], []);
    custom.saveProvider(gr, { id: 'nokey', name: 'No Key', baseUrl: 'https://api.deepseek.com', apiKey: '' });
    custom.saveProvider(gr, { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', apiKey: 'sk-test' });
    const sent = [];
    const handlers = {
        globalResources: gr,
        sendToClient: (_ws, packet) => sent.push(packet),
        sendError: (_ws, message) => sent.push({ type: 'error', message })
    };
    const call = async (message) => {
        await run({ handlers, ws: null, message, clientInfo: { userType: 'admin' }, wsServer: null });
        const out = sent.pop();
        assert.ok(out, 'a reply was sent');
        assert.strictEqual(out.type, 'director_custom_providers_balance_response', JSON.stringify(out));
        assert.ok(Array.isArray(out.data.balances));
        return out.data.balances;
    };

    // errored fetch + a provider with no key: still a list, one row each, no error packet
    if (custom._test && custom._test.resetBalances) custom._test.resetBalances();
    global.fetch = async () => { throw new Error('connect ECONNREFUSED'); };
    let rows = await call({ requestId: 'a' });
    const byId = Object.fromEntries(rows.map((r) => [r.engine, r]));
    assert.strictEqual(byId.tokenrouter.state, 'nokey');
    assert.strictEqual(byId['custom:nokey'].state, 'nokey');
    assert.strictEqual(byId['custom:nokey'].balance, null);
    assert.strictEqual(byId['custom:deepseek'].balance, null, 'failed read: empty balance');
    assert.ok(!JSON.stringify(rows).includes('sk-test'));
    rows = await call({ requestId: 'b', engine: 'custom:deepseek' });
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].balance, null);

    // a summary that throws outright never becomes a Packet Handler Fault
    const realOne = custom.balanceSummary;
    const realAll = custom.balanceSummaries;
    custom.balanceSummary = async () => { throw new Error('boom'); };
    custom.balanceSummaries = async () => { throw new Error('boom'); };
    try {
        assert.deepStrictEqual(await call({ requestId: 'c', engine: 'custom:deepseek' }), []);
        rows = await call({ requestId: 'd' });
        assert.deepStrictEqual(rows.map((r) => r.engine), ['tokenrouter'], 'TokenRouter survives a custom failure');
    } finally {
        custom.balanceSummary = realOne;
        custom.balanceSummaries = realAll;
        global.fetch = realFetch;
    }
    // no globalResources at all: still a reply, not a throw
    handlers.globalResources = null;
    (await call({ requestId: 'e' })).forEach((r) => assert.strictEqual(r.balance, null));
    console.log('test-director-balance-packet: ok');
})().catch((err) => { console.error(err); process.exit(1); });
