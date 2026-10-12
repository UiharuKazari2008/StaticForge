#!/usr/bin/env node
// Wallet tray (Yozora #430). Server: modules/walletStatus.js gathers Cursor, Claude, TokenRouter,
// OpenAI and RunPod figures for the wallet_status packet (fetch stubbed, HOME in a temp dir).
// Client: public/scripts/comp/walletTray.js turns them plus NovelAI optionsData into status rows
// (dot + lines) and alerts, and remembers which alerts this session has shown.
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

    assert.strictEqual(t.sumCosts({ data: [{ results: [{ amount: { value: 1.234 } }, { amount: { value: '2' } }] }, { results: [] }] }), 3.23);
    assert.strictEqual(t.sumCosts(null), 0);
    assert.strictEqual(t.monthStartSeconds(Date.UTC(2026, 9, 12, 9)), Date.UTC(2026, 9, 1) / 1000);

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
        if (String(url).includes('/v1/organization/costs')) {
            return json(403, { error: 'Missing scopes: api.usage.read.' });
        }
        if (String(url).includes('/api/management/self/wallet')) {
            return json(200, { success: true, data: { topUpBalance: 19.4, voucherEfficientAmount: 4.82, toppedUpSpent: 0.5, voucherSpent: 0.27 } });
        }
        throw new Error(`unexpected fetch ${url}`);
    };
    const keys = { runpod: 'rp-key', openai: 'sk-test', tokenrouter: 'tr-key' };
    const gr = {
        getSecureConfig: () => null,
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
    assert.strictEqual(status.cursor, null, 'no Cursor profiles and no host login: no Cursor block');
    assert.strictEqual(status.claude.fiveHour.percent, 92);
    assert.deepStrictEqual(
        { remaining: status.tokenrouter.remaining, managementKey: status.tokenrouter.managementKey },
        { remaining: 24.22, managementKey: true }
    );
    assert.strictEqual(status.openai.balance, null);
    assert.match(status.openai.spendError, /api\.usage\.read/);
    assert.strictEqual(status.runpod.balance, 5.09);
    assert.strictEqual(status.runpod.running, 1);
    // Cached: a second call inside the floor does not fetch again
    const before = calls.length;
    await wallet.getWalletStatus(gr, { refresh: true });
    assert.strictEqual(calls.length, before);
    // A key with no RunPod or OpenAI key configured: those blocks are null
    t.reset();
    const bare = await wallet.getWalletStatus({ ...gr, getApiKeyManager: () => ({ getActiveApiKey: () => null, getActiveSecondaryKey: () => null }), getRunpodPodManager: () => ({ getCachedSnapshot: () => ({ pods: [] }) }) });
    assert.strictEqual(bare.openai, null);
    assert.strictEqual(bare.runpod, null);
    assert.strictEqual(bare.tokenrouter, null);

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
            { id: 'b', name: 'Alt', personas: ['Wren'], percent: null, error: 'Cursor login expired' }
        ] },
        claude: { at: NOW - 600000, fiveHour: { percent: 100, resetsAt: NOW + 1800000 }, sevenDay: { percent: 48, resetsAt: NOW - 60000 } },
        tokenrouter: { managementKey: true, remaining: 1.5, topUp: 1, vouchers: 0.5, spent: 9 },
        openai: { keyState: 'ok', balance: null, spendError: 'Spend needs a key with the Usage read permission (api.usage.read)' },
        runpod: { balance: 5, spendPerHr: 0.69, pods: [{ id: 'p1', name: 'Naturalizer', status: 'running', costPerHr: 0.69, lastStartedAt: new Date(NOW - 3600000).toISOString() }] }
    });
    const { rows, alerts } = ui.model(NOW);
    const row = (key) => rows.find((r) => r.key === key);

    const nai = row('novelai');
    assert.strictEqual(nai.name, 'NovelAI Opus');
    assert.strictEqual(nai.value, '2,500 Anlas');
    assert.strictEqual(nai.dot, 'warn', 'V5 meter at 3% left and renewal in 3 days');
    assert.ok(nai.lines.includes('Anlas: 2,400 fixed, 100 paid'), nai.lines.join(' | '));
    assert.ok(nai.lines.some((l) => /^Opus: renews in 3 days$/.test(l)), nai.lines.join(' | '));
    assert.ok(nai.lines.some((l) => /^V5 usage: 97% used, refills 12% a day$/.test(l)), nai.lines.join(' | '));

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

    assert.strictEqual(row('cursor:a').dot, 'warn');
    assert.strictEqual(row('cursor:a').value, '95%');
    assert.strictEqual(row('cursor:a').name, 'Cursor: Main (Xi)');
    assert.strictEqual(row('cursor:b').dot, 'off');
    assert.strictEqual(row('cursor:b').lines[0], 'Usage unavailable: Cursor login expired');
    assert.strictEqual(row('claude').dot, 'bad');
    assert.strictEqual(row('claude').value, '100%');
    assert.ok(/^7 days: reset 1 minute ago$/.test(row('claude').lines[1]), row('claude').lines[1]);
    assert.strictEqual(row('tokenrouter').value, '$1.50');
    assert.strictEqual(row('openai').dot, 'ok');
    assert.strictEqual(row('openai').lines[1], 'Balance is not reported to API keys');
    assert.strictEqual(row('runpod').value, '$5.00');
    assert.strictEqual(row('runpod').lines[0], '1 of 1 pod running');
    assert.match(row('runpod').lines[1], /^Naturalizer: running, \$0\.69 an hour, \$0\.69 this run$/);

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
    c.setServer({ tokenrouter: { managementKey: true, remaining: 1, topUp: 1, vouchers: 0, spent: 20 } });
    assert.strictEqual(c.unseen(ui.model(NOW).alerts).length, 1);

    // Restricted users: NovelAI only, plus the RunPod pods the tray snapshot has
    c.setServer(null);
    c.setRestricted(true);
    global.getRunpodTraySnapshot = () => ({ fetchedAt: NOW, pods: [{ id: 'p1', name: 'Naturalizer', status: 'stopped' }] });
    const limited = ui.model(NOW);
    assert.deepStrictEqual(limited.rows.map((r) => r.key), ['novelai', 'runpod']);
    assert.strictEqual(limited.rows[1].value, '');

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('wallet tray: ok');
    process.exit(0);
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
