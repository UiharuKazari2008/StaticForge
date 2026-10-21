#!/usr/bin/env node
// Wallet tray (Yozora #430). Server: modules/walletStatus.js gathers Cursor, Claude, TokenRouter
// and RunPod figures for the wallet_status packet (fetch stubbed, HOME in a temp dir).
// Client: public/scripts/comp/walletTray.js turns them plus NovelAI optionsData into status rows
// (dot + lines, V5 usage in a side column) and alerts (Log in buttons for Cursor profiles), and
// remembers which alerts this session has shown. OpenAI is not part of the wallet.
// Run: node scripts/test-wallet-tray.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-tray-'));
process.env.HOME = tmp;
process.env.API_KEY_HEALTH_CACHE = path.join(tmp, 'api-key-health.json');
const NOW = Date.now();

(async () => {
    // ---- server ----
    const wallet = require('../modules/walletStatus');
    const t = wallet._test;

    assert.deepStrictEqual(t.summarizeClaude(null), { at: null, status: null, fiveHour: null, sevenDay: null });
    const claude = t.summarizeClaude({
        at: 1000,
        info: { status: 'rejected', resetsAt: 50, unifiedWindows: { five_hour: { utilization: 1, resetsAt: 50 }, seven_day: { utilization: 0.48, resetsAt: 90 } } }
    });
    assert.deepStrictEqual(claude.fiveHour, { percent: 100, resetsAt: 50000 });
    assert.deepStrictEqual(claude.sevenDay, { percent: 48, resetsAt: 90000 });
    assert.strictEqual(claude.status, 'rejected');

    // Same rule as Security Center's Login button
    for (const text of ['Cursor login expired', 'No credentials for this profile', 'Not logged in', 'Unauthorized']) {
        assert.ok(t.LOGIN_NEEDED_RE.test(text), text);
    }
    for (const text of ['Cursor usage returned 500', 'Usage needs a browser session (API key is active)']) {
        assert.ok(!t.LOGIN_NEEDED_RE.test(text), text);
    }

    // Claude usage as the Director saved it
    const director = path.join(tmp, '.cache', 'dreamscape-director');
    fs.mkdirSync(director, { recursive: true });
    fs.writeFileSync(path.join(director, 'claude-usage.json'), JSON.stringify({
        at: NOW - 60000,
        info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.92, resetsAt: Math.floor(NOW / 1000) + 3600 } } }
    }));

    const calls = [];
    global.fetch = async (url, init = {}) => {
        calls.push(String(url));
        const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body), headers: { get: () => null } });
        if (String(url).startsWith('https://api.runpod.io/graphql')) {
            assert.match(init.headers.authorization, /^Bearer rp-key$/);
            return json(200, { data: { myself: { clientBalance: 5.09, currentSpendPerHr: 0.69, spendLimit: 80 } } });
        }
        if (String(url).includes('/api/management/self/wallet')) {
            return json(200, { success: true, data: { topUpBalance: 19.4, voucherEfficientAmount: 4.82, toppedUpSpent: 0.5, voucherSpent: 0.27 } });
        }
        throw new Error(`unexpected fetch ${url}`);
    };
    const keys = { runpod: 'rp-key', openai: 'sk-test', tokenrouter: 'tr-key' };
    // A profile created in Security Center but never logged in: no usage call, needs a login
    const cursorAccounts = { wren: { activeAccountId: 'fresh' }, accounts: [{ id: 'fresh', name: 'Fresh', isEmpty: true }] };
    const gr = {
        getSecureConfig: (opts) => (opts && opts.path === 'cursorAccounts' ? cursorAccounts : null),
        getConfig: () => ({}),
        getApiKeyManager: () => ({
            getActiveApiKey: (s) => keys[s] || null,
            getActiveSecondaryKey: (s) => (s === 'tokenrouter' ? 'tr-mgmt' : null),
            SERVICE_METADATA: {},
            getServiceKeys: () => []
        }),
        getRunpodPodManager: () => ({
            getCachedSnapshot: () => ({ pods: [{ id: 'p1', name: 'Naturalizer', status: 'running', costPerHr: 0.69, lastStartedAt: new Date(NOW - 3600000).toISOString() }] })
        })
    };
    const status = await wallet.getWalletStatus(gr, { refresh: true });
    assert.strictEqual(status.cursor.accounts.length, 1);
    assert.deepStrictEqual(
        (({ id, needsLogin, personas, percent, error }) => ({ id, needsLogin, personas, percent, error }))(status.cursor.accounts[0]),
        { id: 'fresh', needsLogin: true, personas: ['Wren'], percent: null, error: 'Not logged in yet' }
    );
    assert.ok(!('openai' in status), 'OpenAI is not part of the wallet');
    assert.strictEqual(status.claude.fiveHour.percent, 92);
    assert.deepStrictEqual(
        { remaining: status.tokenrouter.remaining, managementKey: status.tokenrouter.managementKey },
        { remaining: 24.22, managementKey: true }
    );
    assert.strictEqual(status.runpod.balance, 5.09);
    assert.strictEqual(status.runpod.running, 1);
    // Cached: a second call inside the floor does not fetch again
    const before = calls.length;
    await wallet.getWalletStatus(gr, { refresh: true });
    assert.strictEqual(calls.length, before);
    // A newer Claude turn: refresh inside the floor still shows the old figures, fresh reads again
    fs.writeFileSync(path.join(director, 'claude-usage.json'), JSON.stringify({
        at: NOW, info: { status: 'allowed', unifiedWindows: { five_hour: { utilization: 0.4, resetsAt: Math.floor(NOW / 1000) + 3600 } } }
    }));
    assert.strictEqual((await wallet.getWalletStatus(gr, { refresh: true })).claude.fiveHour.percent, 92, 'refresh inside the floor reuses the snapshot');
    assert.strictEqual((await wallet.getWalletStatus(gr, { fresh: true })).claude.fiveHour.percent, 40, 'fresh collects a new snapshot');
    assert.deepStrictEqual(status.keys, { locks: [], failed: [] });

    // Service keys: tripwire locks (Grok left out) and keys the Security Center check refused
    const health = require('../modules/apiKeyHealth');
    fs.writeFileSync(process.env.API_KEY_HEALTH_CACHE, JSON.stringify({ version: 1, entries: {
        [health._test.fingerprint('tokenrouter', 'managementKey', 'tr-mgmt')]: { state: 'fail', message: 'Management key refused', checkedAt: '2026-10-12T10:00:00.000Z' },
        [health._test.fingerprint('novelai', 'apiKey', 'pst-ok')]: { state: 'ok', message: 'Key accepted' }
    } }));
    const keyGr = {
        getApiKeyManager: () => ({
            SERVICE_METADATA: { novelai: { label: 'NovelAI' }, grok: { label: 'Grok (xAI)' }, tokenrouter: { label: 'TokenRouter', secondary: { field: 'managementKey' } } },
            TRIPWIRE_SERVICES: new Set(['novelai', 'grok']),
            getServiceLock: (svc) => ({ service: svc, locked: true, failureCount: 3, lastStatus: 401, lastMessage: 'Unauthorized', lockedAt: 1700 }),
            getServiceKeys: (svc) => (svc === 'tokenrouter' ? [{ name: 'Main', apiKey: 'tr-key', managementKey: 'tr-mgmt' }] : svc === 'novelai' ? [{ name: 'NAI', apiKey: 'pst-ok' }] : [])
        })
    };
    assert.deepStrictEqual(t.keyStatus(keyGr), {
        locks: [{ service: 'novelai', label: 'NovelAI', failureCount: 3, lastStatus: 401, lastMessage: 'Unauthorized', lockedAt: 1700 }],
        failed: [{ service: 'tokenrouter', label: 'TokenRouter', slot: 'managementKey', index: 0, keyName: 'Main', message: 'Management key refused', checkedAt: '2026-10-12T10:00:00.000Z' }]
    });
    // No RunPod or TokenRouter key, no Cursor profile or host login: those blocks are null
    t.reset();
    const bare = await wallet.getWalletStatus({ ...gr, getSecureConfig: () => null, getApiKeyManager: () => ({ getActiveApiKey: () => null, getActiveSecondaryKey: () => null }), getRunpodPodManager: () => ({ getCachedSnapshot: () => ({ pods: [] }) }) });
    assert.strictEqual(bare.cursor, null);
    assert.strictEqual(bare.runpod, null);
    assert.strictEqual(bare.tokenrouter, null);

    // Custom Director engines: API status for every one, a balance only where the host has one
    t.reset();
    const customFetches = [];
    global.fetch = async (url, init = {}) => {
        customFetches.push(String(url));
        const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
        if (String(url) === 'https://slop.example/v1/models') return json(200, { data: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] });
        // The refused key is echoed back; it must not reach the wallet
        if (String(url) === 'https://bad.example/v1/models') return json(401, { error: { message: `Invalid key ${init.headers.authorization}` } });
        if (String(url) === 'https://openrouter.ai/api/v1/key') return json(200, { data: { label: 'k' } });
        if (String(url) === 'https://openrouter.ai/api/v1/credits') return json(200, { data: { total_credits: 10, total_usage: 9.4 } });
        if (String(url) === 'https://down.example/v1/models') throw new Error('getaddrinfo ENOTFOUND down.example');
        throw new Error(`unexpected fetch ${url}`);
    };
    const customGr = {
        ...gr,
        getConfig: (opts) => (opts && opts.path === 'customModelProviders' ? [
            { id: 'slop', name: 'SloProxy', baseUrl: 'https://slop.example', defaultModel: 'a' },
            { id: 'bad', name: 'Bad Host', baseUrl: 'https://bad.example' },
            { id: 'orouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api' },
            { id: 'down', name: 'Down Host', baseUrl: 'https://down.example' },
            { id: 'nokey', name: 'No Key', baseUrl: 'https://nokey.example' }
        ] : {}),
        getSecureConfig: (opts) => (opts && opts.path === 'customModelProviders'
            ? { keys: [{ name: 'slop', apiKey: 'sk-slop' }, { name: 'bad', apiKey: 'sk-bad' }, { name: 'orouter', apiKey: 'sk-or' }, { name: 'down', apiKey: 'sk-down' }] }
            : null),
        getApiKeyManager: () => ({ getActiveApiKey: () => null }),
        getRunpodPodManager: () => ({ getCachedSnapshot: () => ({ pods: [] }) })
    };
    const withCustom = await wallet.getWalletStatus(customGr, { fresh: true });
    const byId = Object.fromEntries(withCustom.custom.providers.map((p) => [p.id, p]));
    assert.deepStrictEqual(
        (({ state, status, models }) => ({ state, status, models }))(byId.slop.api),
        { state: 'ok', status: 200, models: 3 }
    );
    assert.strictEqual(byId.slop.balance, null, 'a generic host has no balance');
    assert.strictEqual(byId.slop.host, 'slop.example');
    assert.strictEqual(byId.bad.api.state, 'fail');
    assert.ok(!JSON.stringify(withCustom.custom).includes('sk-bad'), 'the key never reaches the wallet');
    assert.strictEqual(byId.orouter.api.state, 'ok');
    assert.strictEqual(byId.orouter.api.models, null, 'OpenRouter is checked on its key endpoint');
    assert.strictEqual(byId.orouter.balance.balance, 0.6);
    assert.strictEqual(byId.down.api.state, 'warn');
    assert.match(byId.down.api.message, /Could not reach the host/);
    assert.deepStrictEqual({ hasKey: byId.nokey.hasKey, state: byId.nokey.api.state }, { hasKey: false, state: 'off' });
    assert.ok(!customFetches.some((u) => u.includes('nokey')), 'no key, no call');
    // Each provider is checked at most once a minute, even on a fresh collect
    const customBefore = customFetches.length;
    await wallet.getWalletStatus(customGr, { fresh: true });
    assert.strictEqual(customFetches.length, customBefore);

    // ---- client ----
    const store = {};
    global.sessionStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
    const ui = require('../public/scripts/comp/walletTray.js');
    const c = ui._test;

    assert.strictEqual(c.usd(24.226), '$24.23');
    assert.strictEqual(c.usd(0.004), '$0.004');
    assert.strictEqual(c.span(12 * 60000), '12 minutes');
    assert.strictEqual(c.span(5 * 3600000), '5 hours');
    assert.strictEqual(c.span(3 * 86400000), '3 days');

    const unix = (ms) => Math.floor(ms / 1000);
    global.optionsData = {
        balance: { fixedTrainingStepsLeft: 2400, purchasedTrainingSteps: 100, totalCredits: 2500 },
        user: { subscription: { tier: 3, active: true, expiresAt: unix(NOW + 3 * 86400000 + 3600000) } },
        opusUsage: { percent: 3, isNegative: false, timeUntilNextPercent: 7200 }
    };
    c.setServer({
        cursor: { accounts: [
            { id: 'a', name: 'Main', personas: ['Xi'], plan: 'Ultra', percent: 95, autoPercent: 1, apiPercent: 95, daysLeft: 9, costLabel: '$15.80' },
            { id: 'd', name: 'Green', personas: [], color: '#2ac644', plan: 'Pro', percent: 10 },
            { id: 'b', name: 'Alt', personas: ['Wren'], percent: null, error: 'Cursor login expired', needsLogin: true },
            { id: 'c', name: 'Spare', personas: [], percent: null, error: 'Cursor usage returned 500' }
        ] },
        claude: { at: NOW - 600000, fiveHour: { percent: 100, resetsAt: NOW + 1800000 }, sevenDay: { percent: 48, resetsAt: NOW - 60000 } },
        tokenrouter: { managementKey: true, remaining: 0.8, topUp: 0.3, vouchers: 0.5, spent: 9 },
        runpod: { balance: 5, spendPerHr: 0.69, pods: [{ id: 'p1', name: 'Naturalizer', status: 'running', costPerHr: 0.69, lastStartedAt: new Date(NOW - 3600000).toISOString() }] }
    });
    const { rows, alerts } = ui.model(NOW);
    const row = (key) => rows.find((r) => r.key === key);

    const sideOf = (r, label) => (r.sides || []).find((x) => x.label === label);
    const nai = row('novelai');
    assert.strictEqual(nai.name, 'NovelAI Opus');
    assert.strictEqual(nai.value, '', 'no combined Anlas total');
    assert.deepStrictEqual(nai.sides.map((x) => x.label), ['Anlas', 'V5 usage'], 'Anlas column before V5 usage');
    assert.deepStrictEqual(
        (({ level, figures }) => ({ level, figures }))(sideOf(nai, 'Anlas')),
        { level: 'ok', figures: [{ value: '2,400', unit: 'fixed' }, { value: '100', unit: 'paid' }] }
    );
    assert.strictEqual(nai.dot, 'bad', 'V5 meter at 3% left is red');
    assert.ok(!nai.lines.some((l) => /Anlas/.test(l)), nai.lines.join(' | '));
    assert.ok(nai.lines.some((l) => /^Opus: renews in 3 days$/.test(l)), nai.lines.join(' | '));
    assert.strictEqual(nai.lines[nai.lines.length - 1], 'V5 refills 12% a day', 'the refill line stays on the left');
    const v5 = sideOf(nai, 'V5 usage');
    assert.deepStrictEqual(
        { label: v5.label, value: v5.value, meter: v5.meter, level: v5.level, lines: v5.lines },
        { label: 'V5 usage', value: '97%', meter: 97, level: 'bad', lines: ['~52 images left'] }
    );

    const ids = alerts.map((a) => a.id);
    assert.ok(ids.some((id) => id.startsWith('novelai:renewal:')), ids.join(', '));
    assert.ok(ids.some((id) => id.startsWith('novelai:fixed-expiring:')), ids.join(', '));
    assert.ok(ids.includes('novelai:v5:high'));
    assert.ok(ids.includes('cursor:a:high'));
    assert.ok(ids.some((id) => /^claude:five_hour:\d+:out$/.test(id)));
    assert.ok(!ids.some((id) => id.startsWith('claude:seven_day')), 'a window past its reset never alerts');
    assert.ok(ids.includes('tokenrouter:low'));
    assert.ok(ids.includes('runpod:low'), 'about 7 hours of balance at $0.69 an hour');
    assert.strictEqual(alerts[0].level, 'critical', 'critical alerts first');

    assert.strictEqual(row('cursor:a').dot, 'bad', '95% used is nearly empty: red');
    assert.strictEqual(row('cursor:a').value, '');
    const bars = (side) => side.bars.map(({ caption, value, meter, level }) => ({ caption, value, meter, level }));
    assert.strictEqual(row('cursor:a').side.level, 'bad');
    assert.deepStrictEqual(bars(row('cursor:a').side), [
        { caption: 'Auto', value: '1%', meter: 1, level: 'ok' },
        { caption: 'Other', value: '95%', meter: 95, level: 'bad' }
    ], 'Auto and other models side by side');
    assert.deepStrictEqual(row('cursor:a').lines, ['Ultra, 9 days left, $15.80 API', '95% of included usage']);
    assert.strictEqual(row('cursor:d').side.value, '10%', 'one figure: one bar');
    // The fullest pool raises the alert: other models at 100% while the total is 77%
    const poolAlerts = [];
    c.cursorRows({ accounts: [{ id: 'w', name: 'Alt Lite', personas: ['Wren'], plan: 'Pro', percent: 77, autoPercent: 76, apiPercent: 100, daysLeft: 28 }] }, poolAlerts);
    assert.deepStrictEqual(poolAlerts.map((a) => [a.id, a.level, a.title, a.text]), [[
        'cursor:w:out', 'critical', 'Alt Lite: other-model usage used up',
        'Auto 76%, other models 100%; 28 days left in the cycle. Further requests may not be processed until the cycle resets.'
    ]]);
    assert.ok(!row('cursor:d').side.bars);
    assert.strictEqual(row('cursor:a').name, 'Cursor: Main (Xi)');
    // Row fades: provider colours, a Cursor profile's own colour when it has one
    assert.strictEqual(nai.accent, '#4f46c8');
    assert.strictEqual(row('claude').accent, '#d97757');
    assert.strictEqual(row('tokenrouter').accent, '#0086ff');
    assert.strictEqual(row('runpod').accent, '#7046e0');
    assert.strictEqual(row('cursor:a').accent, '#555555');
    assert.strictEqual(row('cursor:d').accent, '#2ac644');
    assert.strictEqual(row('cursor:b').dot, 'warn');
    assert.deepStrictEqual(row('cursor:b').lines[0], { text: 'Login expired.', link: { label: 'Log in', name: 'login', arg: 'b' } });
    const login = alerts.find((a) => a.id === 'cursor:b:login');
    assert.strictEqual(login.title, 'Alt: Cursor login expired');
    assert.strictEqual(login.text, 'Wren uses this profile.');
    assert.deepStrictEqual(login.action, { label: 'Log in', name: 'login', arg: 'b' });
    assert.strictEqual(row('cursor:c').dot, 'off', 'a usage error that is not a login stays grey');
    assert.ok(!ids.includes('cursor:c:login'));
    assert.ok(!rows.some((r) => r.key === 'openai'));
    assert.strictEqual(row('claude').dot, 'bad');
    assert.strictEqual(row('claude').side.level, 'bad');
    assert.deepStrictEqual(bars(row('claude').side), [
        { caption: '5 hours', value: '100%', meter: 100, level: 'bad' },
        { caption: '7 days', value: '-', meter: 0, level: 'ok' }
    ], 'both windows side by side; one past its reset has no figure');
    assert.strictEqual(row('claude').lines[0], '5 hours: resets in 30 minutes');
    assert.ok(!row('cursor:b').side, 'a profile that needs a login has no usage column');
    assert.ok(/^7 days: reset 1 minute ago$/.test(row('claude').lines[1]), row('claude').lines[1]);
    assert.deepStrictEqual(
        (({ label, value, meter, level }) => ({ label, value, meter, level }))(row('tokenrouter').side),
        { label: 'Balance', value: '$0.80', meter: null, level: 'bad' },
        'balances sit in the right-hand column without a meter'
    );
    assert.strictEqual(row('tokenrouter').dot, 'bad');
    assert.deepStrictEqual((({ value, level }) => ({ value, level }))(row('runpod').side), { value: '$5.00', level: 'bad' }, 'about 7 hours left is red');
    assert.strictEqual(row('runpod').lines[0], '1 of 1 pod running');
    assert.match(row('runpod').lines[1], /^Naturalizer: running, \$0\.69 an hour, \$0\.69 this run$/);

    // Balance colours: orange when low, red when empty or nearly empty, no alert for orange
    const tr = (remaining) => c.tokenRouterRow({ managementKey: true, remaining, topUp: remaining, vouchers: 0, spent: 0 }, []);
    assert.deepStrictEqual([0, 1, 1.5, 4.99, 5, 24].map((v) => tr(v).side.level), ['bad', 'bad', 'warn', 'warn', 'ok', 'ok']);
    const trAlerts = [];
    c.tokenRouterRow({ managementKey: true, remaining: 3, topUp: 3, vouchers: 0, spent: 0 }, trAlerts);
    assert.deepStrictEqual(trAlerts, [], 'orange is not an alert');
    const rp = (balance, spendPerHr) => c.runpodRow({ pods: [], balance, spendPerHr }, []).side.level;
    assert.deepStrictEqual([rp(5.09, 0.004), rp(4, 0.004), rp(0.5, 0.004), rp(20, 0.5), rp(20, 1)], ['ok', 'warn', 'bad', 'warn', 'warn']);
    assert.strictEqual(rp(5, 0.69), 'bad', 'under 12 hours at the current spend');
    global.optionsData.balance = { fixedTrainingStepsLeft: 600, purchasedTrainingSteps: 0, totalCredits: 600 };
    assert.strictEqual(sideOf(ui.model(NOW).rows[0], 'Anlas').level, 'warn', 'under 1,000 Anlas is orange');
    global.optionsData.balance = { fixedTrainingStepsLeft: 100, purchasedTrainingSteps: 0, totalCredits: 100 };
    assert.strictEqual(sideOf(ui.model(NOW).rows[0], 'Anlas').level, 'bad', 'under 250 Anlas is red');

    // V5 trend: a lower reading than a while ago means usage outran the refill (yellow)
    store.sf_wallet_v5_samples = '[]';
    const T = NOW + 86400000;
    assert.deepStrictEqual(c.v5Trend(50, T), { draining: false });
    assert.deepStrictEqual(c.v5Trend(48, T + 10 * 60000), { draining: true, drop: 2, minutes: 10 });
    assert.strictEqual(c.v5Trend(49, T + 20 * 60000).draining, true, 'still under the reading 20 minutes ago');
    assert.strictEqual(c.v5Trend(51, T + 25 * 60000).draining, false, 'refilled past the old reading');
    store.sf_wallet_v5_samples = '[]';
    global.optionsData = {
        balance: { fixedTrainingStepsLeft: 9000, purchasedTrainingSteps: 0, totalCredits: 9000 },
        user: { subscription: { tier: 3, active: true, expiresAt: unix(NOW + 25 * 86400000) } },
        opusUsage: { percent: 70, isNegative: false, timeUntilNextPercent: 6048 }
    };
    c.setServer(null);
    ui.model(T);
    global.optionsData.opusUsage = { percent: 66, isNegative: false, timeUntilNextPercent: 6048 };
    const drain = ui.model(T + 30 * 60000).rows[0];
    assert.strictEqual(sideOf(drain, 'V5 usage').level, 'drain');
    assert.strictEqual(drain.dot, 'ok', 'yellow is a hint, not a problem');
    assert.match(sideOf(drain, 'V5 usage').title, /down 4% in 30 minutes$/);
    assert.ok(drain.lines.includes('V5 refills 14.3% a day (using faster)'), drain.lines.join(' | '));
    store.sf_wallet_v5_samples = '[]';

    // Renewal failed: a red alert that stays while the flag is set
    global.optionsData.subscriptionRenewalFailed = true;
    const failed = ui.model(NOW);
    const renewal = failed.alerts.find((a) => a.id === 'novelai:renewal-failed');
    assert.strictEqual(renewal.level, 'critical');
    assert.deepStrictEqual(renewal.action, { label: 'NovelAI', name: 'novelai-site' });
    assert.strictEqual(failed.rows[0].dot, 'bad');
    assert.ok(failed.rows[0].lines.includes('Subscription inactive: renewal failed'));
    delete global.optionsData.subscriptionRenewalFailed;

    // Service keys: a blocked service gets Unlock, a refused key gets Service keys; rows turn red
    c.setServer({
        tokenrouter: { managementKey: true, remaining: 24, topUp: 24, vouchers: 0, spent: 1 },
        keys: {
            locks: [{ service: 'novelai', label: 'NovelAI', failureCount: 3, lastStatus: 401, lastMessage: 'Unauthorized', lockedAt: 1700 }],
            failed: [{ service: 'tokenrouter', label: 'TokenRouter', slot: 'managementKey', index: 0, keyName: 'Main', message: 'Management key refused', checkedAt: 'x' }]
        }
    });
    const keyed = ui.model(NOW);
    const lock = keyed.alerts.find((a) => a.id === 'keys:lock:novelai:1700');
    assert.strictEqual(lock.title, 'NovelAI calls are blocked');
    assert.strictEqual(lock.text, 'Stopped after 3 key errors (last HTTP 401). Fix the key, then unlock.');
    assert.deepStrictEqual(lock.action, { label: 'Unlock', name: 'unlock', arg: 'novelai' });
    const refused = keyed.alerts.find((a) => a.id === 'keys:fail:tokenrouter:managementKey:0:x');
    assert.strictEqual(refused.title, 'TokenRouter management key "Main" refused');
    assert.deepStrictEqual(refused.action, { label: 'Service keys', name: 'keys' });
    assert.strictEqual(keyed.rows[0].dot, 'bad');
    assert.ok(keyed.rows[0].lines.includes('Calls blocked after key errors'));
    assert.strictEqual(keyed.rows[1].dot, 'bad');
    assert.ok(keyed.rows[1].lines.includes('Management key refused'));

    // Out of everything
    global.optionsData.balance = { fixedTrainingStepsLeft: 0, purchasedTrainingSteps: 0, totalCredits: 0 };
    global.optionsData.opusUsage = { percent: 0, isNegative: true, timeUntilNextPercent: 7200 };
    const out = ui.model(NOW);
    assert.ok(out.alerts.some((a) => a.id === 'novelai:anlas:out' && a.level === 'critical'));
    assert.ok(out.alerts.some((a) => a.id === 'novelai:v5:out' && a.level === 'critical'));
    assert.ok(!out.alerts.some((a) => a.id.startsWith('novelai:fixed-expiring')), 'no fixed Anlas, nothing to expire');

    // Healthy NovelAI, far from renewal: green, no NovelAI alerts
    global.optionsData = {
        balance: { fixedTrainingStepsLeft: 9000, purchasedTrainingSteps: 0, totalCredits: 9000 },
        user: { subscription: { tier: 3, active: true, expiresAt: unix(NOW + 25 * 86400000) } },
        opusUsage: { percent: 80, isNegative: false, timeUntilNextPercent: 7200 }
    };
    c.setServer(null);
    const calm = ui.model(NOW);
    assert.strictEqual(calm.rows.length, 1);
    assert.strictEqual(calm.rows[0].dot, 'ok');
    assert.deepStrictEqual(calm.alerts, []);

    // Seen this session
    const first = ui.model(NOW).alerts;
    c.setServer({ tokenrouter: { managementKey: true, remaining: 0, topUp: 0, vouchers: 0, spent: 20 } });
    const one = ui.model(NOW).alerts;
    assert.deepStrictEqual(one.map((a) => a.id), ['tokenrouter:out']);
    assert.strictEqual(c.unseen(one).length, 1);
    c.markSeen(one);
    assert.strictEqual(c.unseen(ui.model(NOW).alerts).length, 0);
    assert.deepStrictEqual(first, []);
    // A different alert (low instead of out) is new again
    c.setServer({ tokenrouter: { managementKey: true, remaining: 0.5, topUp: 0.5, vouchers: 0, spent: 20 } });
    assert.strictEqual(c.unseen(ui.model(NOW).alerts).length, 1);

    // Restricted users: NovelAI only, plus the RunPod pods the tray snapshot has
    c.setServer(null);
    c.setRestricted(true);
    global.getRunpodTraySnapshot = () => ({ fetchedAt: NOW, pods: [{ id: 'p1', name: 'Naturalizer', status: 'stopped' }] });
    const limited = ui.model(NOW);
    assert.deepStrictEqual(limited.rows.map((r) => r.key), ['novelai', 'runpod']);
    assert.strictEqual(limited.rows[1].value, '');

    fs.rmSync(tmp, { recursive: true, force: true });
    // Custom engines: API status in the right-hand column, a balance first where there is one
    {
        const alerts = [];
        const rows = c.customRows(withCustom.custom, alerts);
        const row = (id) => rows.find((r) => r.key === `custom:${id}`);
        assert.strictEqual(row('slop').dot, 'ok');
        assert.deepStrictEqual(row('slop').sides.map((x) => `${x.label} ${x.value}`), ['API Online']);
        assert.strictEqual(row('slop').lines[0], 'API online, 3 models');
        assert.strictEqual(row('bad').dot, 'bad');
        assert.deepStrictEqual(row('orouter').sides.map((x) => `${x.label} ${x.value}`), ['Balance $0.60', 'API Online']);
        assert.strictEqual(row('orouter').dot, 'bad', '$0.60 left is red');
        assert.strictEqual(row('down').dot, 'warn');
        assert.strictEqual(row('down').sides[0].value, 'Offline');
        assert.strictEqual(row('nokey').dot, 'off');
        assert.strictEqual(row('nokey').sides[0].value, 'No key');
        assert.deepStrictEqual(alerts.map((a) => a.id).sort(), ['custom:bad:refused', 'custom:down:down', 'custom:orouter:low']);
        // TokenRouter host without a management key: no balance column, the reason as a line
        const noBalance = c.customRows({ providers: [{ id: 'tr', name: 'Router Box', kind: 'tokenrouter', hasKey: true,
            api: { state: 'ok', status: 200, ms: 5, models: 4 }, balance: { balance: null, title: 'Router Box: add a management key to show the balance' } }] }, []);
        assert.deepStrictEqual(noBalance[0].sides.map((x) => x.label), ['API']);
        assert.strictEqual(noBalance[0].lines[1], 'Add a management key to show the balance');
    }
    console.log('wallet tray: ok');
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
