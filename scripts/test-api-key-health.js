#!/usr/bin/env node
'use strict';

// Security Center key status (#409): paired TokenRouter management key, cached
// checks (modules/apiKeyHealth.js), and the keychain dots. No network: fetch is stubbed.
//   node scripts/test-api-key-health.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'api-key-health-'));
process.env.API_KEY_HEALTH_CACHE = path.join(scratch, 'api-key-health.json');
delete process.env.TOKENROUTER_MANAGEMENT_KEY;

const ApiKeyManager = require('../modules/apiKeyManager');
const health = require('../modules/apiKeyHealth');
// Mock upstreams: lift the account's 8-a-minute gate (modules/tokenRouterGate.js).
require('../modules/tokenRouterGate').configure({ limit: 1000 });

const calls = [];
let replies = {};
global.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, init });
    const hit = Object.keys(replies).find((part) => u.includes(part));
    const reply = hit ? replies[hit] : { status: 200, body: {} };
    return {
        status: reply.status,
        ok: reply.status >= 200 && reply.status < 300,
        text: async () => (typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body))
    };
};

function fakeGr(secure, config) {
    const broadcasts = [];
    const gr = {
        broadcasts,
        getSecureConfig: ({ path: p } = {}) => {
            if (!p) return secure;
            const parts = Array.isArray(p) ? p : String(p).split('.');
            return parts.reduce((node, key) => (node == null ? undefined : node[key]), secure);
        },
        getConfig: ({ path: p } = {}) => (p ? config[p] : config),
        modifyConfig: (type, fn) => {
            const store = type === 'config' ? config : secure;
            if (type !== 'secureConfig' && type !== 'config') throw new Error(`unexpected config ${type}`);
            const helper = {
                append: (keyPath, value) => {
                    const [service, field] = keyPath;
                    store[service] = store[service] || {};
                    store[service][field] = (store[service][field] || []).concat([value]);
                    return true;
                },
                replace: (keyPath, index, value) => {
                    const [service, field] = keyPath;
                    store[service][field][index] = value;
                    return true;
                },
                delete: (keyPath, index) => {
                    if (Number.isInteger(index)) {
                        const [service, field] = keyPath;
                        store[service][field].splice(index, 1);
                        return true;
                    }
                    const [parent, key] = keyPath;
                    delete store[parent][key];
                    return true;
                },
                assign: (keyPath, value) => {
                    const [parent, key] = keyPath;
                    store[parent] = store[parent] || {};
                    store[parent][key] = value;
                    return true;
                }
            };
            if (!fn) return helper;
            assert.strictEqual(type, 'secureConfig');
            const next = fn(JSON.parse(JSON.stringify(secure)));
            Object.keys(secure).forEach((k) => delete secure[k]);
            Object.assign(secure, next);
            return Promise.resolve(true);
        },
        webSocketServer: {
            broadcastToAll: (msg, filter) => broadcasts.push({ msg, admin: filter({ userType: 'admin' }), readonly: filter({ userType: 'readonly' }) })
        }
    };
    gr.getApiKeyManager = () => gr.manager;
    return gr;
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

(async () => {
    try {
        // ---- migration: the separate management service lands on the TokenRouter key ----
        const secure = {
            novelai: { keys: [{ name: 'Main', apiKey: 'pst-novel' }] },
            exa: { keys: [{ name: 'Exa', apiKey: 'exa-key' }] },
            grok: { keys: [{ name: 'Old', apiKey: 'xai-old' }] },
            google: { keys: [{ name: 'Gemini', apiKey: 'goog-key' }] },
            openweather: { keys: [{ name: 'Weather', apiKey: 'ow-key' }] },
            tokenrouter: { keys: [{ name: 'Primary', apiKey: 'sk-router' }] },
            tokenrouter_management: { keys: [{ name: 'Mgmt', apiKey: 'mk-router' }] }
        };
        const gr = fakeGr(secure, { selectedApiKeys: {} });
        gr.manager = new ApiKeyManager(gr);
        assert.strictEqual(secure.tokenrouter_management, undefined, 'old service removed');
        assert.strictEqual(secure.tokenrouter.keys[0].managementKey, 'mk-router', 'paired onto the API key entry');
        assert.ok(!gr.manager.SERVICE_METADATA.tokenrouter_management);
        assert.strictEqual(gr.manager.getActiveSecondaryKey('tokenrouter'), 'mk-router');
        assert.strictEqual(gr.manager.getActiveSecondaryKey('novelai'), null);
        new ApiKeyManager(gr); // second boot: nothing left to migrate
        assert.strictEqual(secure.tokenrouter.keys[0].managementKey, 'mk-router');

        // ---- listing reads the cache only ----
        let summaries = gr.manager.listServiceSummaries();
        const router = summaries.find((s) => s.id === 'tokenrouter');
        assert.deepStrictEqual(router.secondary && router.secondary.field, 'managementKey');
        assert.strictEqual(router.secondary.optional, true);
        assert.ok(router.keys[0].secondaryFingerprint.endsWith('uter'));
        assert.strictEqual(router.keys[0].status.state, 'unchecked');
        assert.strictEqual(router.keys[0].secondaryStatus.state, 'unchecked');
        assert.strictEqual(summaries.find((s) => s.id === 'novelai').keys[0].secondaryStatus, undefined);
        assert.strictEqual(calls.length, 0, 'loading the list never checks a key');

        // ---- sweep: one free read per credential, results by fingerprint ----
        replies = {
            'image.novelai.net': { status: 200, body: { tier: 3 } },
            'api.exa.ai/search': { status: 400, body: { error: 'Invalid request body | Validation error: expected string at "query"' } },
            'api.openweathermap.org': { status: 429, body: { message: 'limit' } },
            '/v1/models': { status: 200, body: { data: [] } },
            '/api/management/self/wallet': { status: 401, body: { success: false, message: 'management key is invalid' } }
        };
        const first = await health.sweep(gr, { reason: 'boot' });
        assert.strictEqual(first.checked, 5);
        const exaCall = calls.find((c) => c.url.includes('api.exa.ai'));
        assert.strictEqual(exaCall.init.method, 'POST', 'Exa check is an empty search that never runs');
        assert.strictEqual(exaCall.init.body, '{}');
        summaries = gr.manager.listServiceSummaries();
        const state = (id, field) => {
            const row = summaries.find((s) => s.id === id).keys[0];
            return (field ? row.secondaryStatus : row.status).state;
        };
        assert.strictEqual(state('novelai'), 'ok');
        assert.strictEqual(state('exa'), 'ok', 'Exa: validation error after the key check means the key works');
        assert.strictEqual(state('openweather'), 'warn');
        assert.strictEqual(state('grok'), 'unchecked', 'xAI is stored and not probed');
        assert.strictEqual(state('google'), 'unchecked', 'Google is stored and not probed');
        assert.strictEqual(health.checksService('grok'), false);
        assert.strictEqual(health.checksService('google'), false);
        assert.ok(!calls.some((c) => c.url.includes('api.x.ai') || c.url.includes('generativelanguage.googleapis.com')));
        assert.strictEqual(state('tokenrouter'), 'ok');
        assert.strictEqual(state('tokenrouter', 'managementKey'), 'fail');
        const mgmt = summaries.find((s) => s.id === 'tokenrouter').keys[0].secondaryStatus;
        assert.ok(/management key is invalid/.test(mgmt.message));
        assert.ok(mgmt.checkedAt);
        const cacheText = fs.readFileSync(process.env.API_KEY_HEALTH_CACHE, 'utf8');
        ['pst-novel', 'exa-key', 'xai-old', 'goog-key', 'ow-key', 'sk-router', 'mk-router'].forEach((secret) => {
            assert.ok(!cacheText.includes(secret), 'no secret on disk');
        });
        const last = gr.broadcasts[gr.broadcasts.length - 1];
        assert.strictEqual(last.msg.type, 'api_key_status_changed');
        assert.strictEqual(last.admin, true);
        assert.strictEqual(last.readonly, false, 'admins only');
        assert.strictEqual(last.msg.data.statuses.tokenrouter[0].managementKey.state, 'fail');

        // ---- second sweep: only the 'warn' one is tried again ----
        calls.length = 0;
        const again = await health.sweep(gr, { reason: 'boot' });
        assert.strictEqual(again.checked, 1);
        assert.ok(calls[0].url.includes('api.openweathermap.org'));
        assert.ok(!calls.some((c) => c.url.includes('api.x.ai') || c.url.includes('generativelanguage.googleapis.com')));

        // ---- editing the management key re-checks just that credential ----
        calls.length = 0;
        replies['/api/management/self/wallet'] = { status: 200, body: { success: true, data: { topUpBalance: 1, voucherEfficientAmount: 2 } } };
        gr.manager.updateApiKey('tokenrouter', 0, undefined, undefined, { secondaryKey: 'mk-router-2' });
        assert.strictEqual(secure.tokenrouter.keys[0].apiKey, 'sk-router', 'API key kept');
        assert.strictEqual(secure.tokenrouter.keys[0].managementKey, 'mk-router-2');
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.deepStrictEqual(calls.map((c) => c.url.replace(/^https:\/\/[^/]+/, '')), ['/api/management/self/wallet']);
        assert.strictEqual(gr.manager.listServiceSummaries().find((s) => s.id === 'tokenrouter').keys[0].secondaryStatus.state, 'ok');

        // Renaming changes no secret: nothing to check.
        calls.length = 0;
        gr.manager.updateApiKey('tokenrouter', 0, 'Renamed');
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.strictEqual(calls.length, 0);
        assert.strictEqual(secure.tokenrouter.keys[0].managementKey, 'mk-router-2', 'rename keeps the pair');

        // Removing the management key leaves the API key alone.
        gr.manager.updateApiKey('tokenrouter', 0, undefined, undefined, { clearSecondary: true });
        assert.strictEqual(secure.tokenrouter.keys[0].managementKey, undefined);
        assert.strictEqual(gr.manager.listServiceSummaries().find((s) => s.id === 'tokenrouter').keys[0].secondaryStatus.state, 'none');

        // A new key with its pair, both checked.
        calls.length = 0;
        gr.manager.addApiKey('tokenrouter', 'Second', 'sk-router-b', { secondaryKey: 'mk-router-b' });
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.strictEqual(calls.length, 2);
        assert.deepStrictEqual(secure.tokenrouter.keys[1], { name: 'Second', apiKey: 'sk-router-b', managementKey: 'mk-router-b' });

        // Deleting the active key leaves the next one selected. Deleting a later key keeps the selection.
        gr.getConfig({ path: 'selectedApiKeys' }).tokenrouter = 0;
        await gr.manager.removeApiKey('tokenrouter', 0);
        assert.strictEqual(secure.tokenrouter.keys.length, 1);
        assert.strictEqual(secure.tokenrouter.keys[0].name, 'Second');
        assert.strictEqual(gr.manager.getSelectedIndex('tokenrouter'), 0);
        gr.manager.addApiKey('tokenrouter', 'Third', 'sk-router-c');
        await gr.manager.removeApiKey('tokenrouter', 1);
        assert.deepStrictEqual(secure.tokenrouter.keys.map((k) => k.name), ['Second']);
        assert.strictEqual(gr.manager.getSelectedIndex('tokenrouter'), 0);
        await gr.manager.removeApiKey('exa', 0);
        assert.deepStrictEqual(secure.exa.keys, []);
        assert.strictEqual(gr.getConfig({ path: 'selectedApiKeys' }).exa, undefined);

        // ---- classification ----
        const c = health._test.classify;
        assert.strictEqual(c(401, null, 'nope').state, 'fail');
        assert.strictEqual(c(400, { error: { message: 'API key not valid. Please pass a valid API key.' } }, '').state, 'fail');
        assert.strictEqual(c(429, null, '').state, 'warn');
        assert.strictEqual(c(503, null, '').state, 'warn');
        assert.strictEqual(c(200, {}, '').state, 'ok');

        // ---- Security Center dots ----
        const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/securityCenterDsapApplet.js'), 'utf8');
        const createElement = () => {
            const el = { _text: '' };
            Object.defineProperty(el, 'textContent', { set(v) { el._text = String(v); }, get() { return el._text; } });
            Object.defineProperty(el, 'innerHTML', { get() { return el._text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); } });
            return el;
        };
        const ctx = { console, window: {}, localStorage: { getItem: () => null }, document: { createElement } };
        vm.createContext(ctx);
        vm.runInContext(`${src}\nthis.driver = securityDsapDriver;`, ctx);
        const driver = ctx.driver;
        const service = {
            id: 'tokenrouter',
            secondary: { field: 'managementKey', label: 'Management key', optional: true },
            keys: [{ index: 0, fingerprint: '••••uter', secondaryFingerprint: '••••er-2', status: { state: 'ok', checkedAt: '2026-10-12T00:00:00Z' }, secondaryStatus: { state: 'fail', message: 'management key is invalid <x>' } }]
        };
        const html = driver._keychainStatusHtml(service, 0);
        assert.ok(html.includes('sec-key-dot-ok') && html.includes('sec-key-dot-fail'), 'two dots for a paired key');
        assert.ok(html.includes('>API<') && html.includes('>Mgmt<'));
        assert.ok(!html.includes('<x>'), 'messages are escaped');
        assert.strictEqual(driver._keychainFingerprint(service, 0), '••••uter + Management key ••••er-2');
        const single = driver._keychainStatusHtml({ id: 'exa', keys: [{ index: 0, status: { state: 'warn' } }] }, 0);
        assert.ok(single.includes('sec-key-dot-warn') && !single.includes('sec-key-dot-label'));
        assert.ok(driver._keychainStatusHtml({ id: 'x', missingKeys: true, keys: [] }, null).includes('sec-key-dot-none'));
        assert.strictEqual(driver._keychainStatusHtml({ id: 'grok', statusCheck: false, keys: [{ index: 0, status: { state: 'unchecked' } }] }, 0), '');
        assert.strictEqual(driver._keychainStatusHtml({ id: 'google', statusCheck: false, keys: [{ index: 0, status: { state: 'unchecked' } }] }, 0), '');
        assert.ok(driver._keychainDot({ state: '"><img>' }, '').includes('sec-key-dot-unchecked'), 'unknown state never reaches the class');

        console.log('api key health: ok');
    } finally {
        fs.rmSync(scratch, { recursive: true, force: true });
    }
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
