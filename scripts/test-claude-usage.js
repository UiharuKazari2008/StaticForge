'use strict';

// Claude plan usage for every Claude account (modules/claudeUsage.js), its statusHub feed
// (315-claudeUsageHandler.js), wallet_status's claude.accounts (walletStatus.js) and the Account Manager
// rows (walletTray.js claudeRows; Melaton Mobile's Accounts draws the same rows). Sandboxed: a temp home
// for ~/.claude, a temp account store and a stubbed fetch, so no real login, account folder or
// claude.ai call is touched.
// Run: node scripts/test-claude-usage.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-claude-usage-test-'));
const HOME = path.join(SANDBOX, 'home');
process.env.HOME = HOME;
process.env.DREAMSCAPE_CLAUDE_HOME = HOME;
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = path.join(SANDBOX, 'store');
process.env.DREAMSCAPE_CLAUDE_RC_UNIT = 'claude-remote-test.service';
process.env.DREAMSCAPE_CLAUDE_RC_TMUX = 'claude-rc-test';
process.env.API_KEY_HEALTH_CACHE = path.join(SANDBOX, 'api-key-health.json');
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) { /* gone */ } });

const host = require('../modules/claudeAccountHost');
const usage = require('../modules/claudeUsage');

assert.ok(host._paths().store.startsWith(SANDBOX) && host._paths().credentials.startsWith(SANDBOX), 'test must stay in its sandbox');

const NOW = Date.now();
const HOUR = 3600 * 1000;
const ACCESS_A = 'sk-ant-oat01-ACCESS-A-1111111111111111111111';
const ACCESS_B = 'sk-ant-oat01-ACCESS-B-3333333333333333333333';
const ACCESS_B2 = 'sk-ant-oat01-ACCESS-B-4444444444444444444444';
const REFRESH_B2 = 'sk-ant-ort01-REFRESH-B-5555555555555555555555';
const KEY_A = 'sk-ant-oat01-ENGINE-A-aaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'sk-ant-oat01-ENGINE-B-bbbbbbbbbbbbbbbbbbbbbbbb';
const KEY_C = 'sk-ant-oat01-ENGINE-C-cccccccccccccccccccccccc';
const SECRETS = [ACCESS_A, ACCESS_B, ACCESS_B2, REFRESH_B2, `${ACCESS_A}-r`, `${ACCESS_B}-r`, KEY_A, KEY_B, KEY_C];

function login(access, email, uuid, expiresAt, tier) {
    return {
        creds: { claudeAiOauth: { accessToken: access, refreshToken: `${access}-r`, expiresAt, scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'], subscriptionType: 'max', rateLimitTier: tier || 'default_claude_max_5x' } },
        oauthAccount: { emailAddress: email, accountUuid: uuid, displayName: email.split('@')[0], organizationName: `${email}'s Organization` }
    };
}
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const noSecret = (what, value) => {
    const text = JSON.stringify(value);
    SECRETS.forEach((s) => assert.ok(!text.includes(s), `${what} carries a token`));
};

// The reply /api/oauth/usage gave on Nov 19 2026 (trimmed)
const REPLY = {
    five_hour: { utilization: 37.0, resets_at: new Date(NOW + 3 * HOUR).toISOString() },
    seven_day: { utilization: 5.0, resets_at: new Date(NOW + 6 * 24 * HOUR).toISOString() },
    seven_day_opus: null,
    seven_day_sonnet: null,
    extra_usage: { is_enabled: false, monthly_limit: null, used_credits: null, utilization: null, currency: null },
    limits: [
        { kind: 'session', group: 'session', percent: 37, severity: 'normal', resets_at: new Date(NOW + 3 * HOUR).toISOString(), scope: null, is_active: true },
        { kind: 'weekly_all', group: 'weekly', percent: 5, severity: 'normal', resets_at: new Date(NOW + 6 * 24 * HOUR).toISOString(), scope: null, is_active: false },
        { kind: 'weekly_scoped', group: 'weekly', percent: 0, severity: 'normal', resets_at: new Date(NOW + 6 * 24 * HOUR).toISOString(), scope: { model: { id: null, display_name: 'Fable' }, surface: null }, is_active: false }
    ]
};

(async () => {
    // ---- parsing ----
    {
        const p = usage.parseUsage(REPLY);
        assert.deepStrictEqual(p.limits.map((l) => [l.kind, l.label, l.short, l.percent]), [
            ['session', 'Current session', '5 hours', 37],
            ['weekly_all', 'Weekly (all models)', 'Week', 5],
            ['weekly_scoped', 'Weekly (Fable)', 'Fable', 0]
        ]);
        assert.strictEqual(p.limits[0].resetsAt, Date.parse(REPLY.limits[0].resets_at));
        assert.strictEqual(p.limits[0].active, true);
        assert.strictEqual(p.extra, null, 'extra usage off: no row');
        // the older shape (no limits[]): the windows themselves; 0.5% stays 0.5% (rounded), never 50%
        const old = usage.parseUsage({ five_hour: { utilization: 0.5, resets_at: REPLY.five_hour.resets_at }, seven_day: { utilization: 81, resets_at: null }, seven_day_opus: { utilization: 12, resets_at: null } });
        assert.deepStrictEqual(old.limits.map((l) => [l.label, l.percent]), [['Current session', 1], ['Weekly (all models)', 81], ['Weekly (Opus)', 12]]);
        const extra = usage.parseUsage({ limits: [], extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1234, utilization: 24.68, currency: 'USD', decimal_places: 2, spend_limit_reached: false } });
        assert.deepStrictEqual(extra.extra, { enabled: true, used: 1234, limit: 5000, currency: 'USD', decimals: 2, percent: 25, limitReached: false });
        assert.strictEqual(usage.planName({ subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' }), 'Max 20x');
        assert.strictEqual(usage.planName({ subscriptionType: 'pro' }), 'Pro');
        assert.strictEqual(usage.planName({}), '');
        console.log('ok parse');
    }

    // ---- a host with three Claude accounts ----
    // A: on the host (Remote Control's login, fresh). B: a linked login whose access token ran out, idle.
    // C: only the engine's setup token (no linked login), not the engine's account.
    const A = login(ACCESS_A, 'a@example.com', 'aaaaaaaa-0000-4000-8000-000000000001', NOW + 6 * HOUR);
    const B = login(ACCESS_B, 'b@example.com', 'bbbbbbbb-0000-4000-8000-000000000002', NOW - 50 * 60 * 1000, 'default_claude_max_20x');
    write(host._paths().credentials, A.creds);
    write(host._paths().claudeJson, { hasCompletedOnboarding: true, oauthAccount: A.oauthAccount });
    const keys = [{ name: 'Claude Max', apiKey: KEY_A }, { name: 'Claude Work', apiKey: KEY_B }, { name: 'Claude Spare', apiKey: KEY_C }];
    const akm = {
        getServiceKeys: (s) => (s === 'claude' ? keys : []),
        getSelectedIndex: () => 0,
        keyFingerprint: (s, k) => `${k.apiKey.slice(0, 8)}...`
    };
    const gr = { getApiKeyManager: () => akm, getWebSocketServer: () => ({ broadcast() {} }) };
    host.linkLogin(gr, 0, A.creds, A.oauthAccount);
    host.linkLogin(gr, 1, B.creds, B.oauthAccount);
    const ids = host.listAccounts(gr).map((a) => a.id);
    assert.deepStrictEqual(host.listAccounts(gr).map((a) => [a.onHost, !!a.remoteLogin]), [[true, true], [false, true], [false, false]]);

    const calls = [];
    let refreshStatus = 200;
    usage._setFetch(async (url, init = {}) => {
        const auth = (init.headers && init.headers.authorization) || '';
        calls.push({ url: String(url), auth, body: init.body ? JSON.parse(init.body) : null });
        const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
        if (String(url) === 'https://platform.claude.com/v1/oauth/token') {
            if (refreshStatus !== 200) return json(refreshStatus, { error: 'invalid_grant' });
            return json(200, { access_token: ACCESS_B2, refresh_token: REFRESH_B2, expires_in: 28800, scope: 'user:inference user:profile user:sessions:claude_code' });
        }
        if (String(url) === 'https://api.anthropic.com/api/oauth/usage') {
            assert.strictEqual(init.headers['anthropic-beta'], 'oauth-2025-04-20');
            if (auth === `Bearer ${ACCESS_A}`) return json(200, REPLY);
            if (auth === `Bearer ${ACCESS_B2}`) return json(200, { ...REPLY, limits: [{ ...REPLY.limits[0], percent: 96 }, { ...REPLY.limits[1], percent: 41 }] });
            return json(401, { error: 'expired' });
        }
        throw new Error(`unexpected fetch ${url}`);
    });

    // ---- B is idle: its expired login is refreshed with its own refresh token and saved back ----
    {
        usage._reset();
        usage._setLiveConfigDirs(async () => new Set());
        // B also has a parallel-session config dir with an older copy: it gets the rotated login too
        const cdirB = path.join(host._paths().store, ids[1], 'config');
        write(path.join(cdirB, '.credentials.json'), { claudeAiOauth: { ...B.creds.claudeAiOauth, expiresAt: NOW - 2 * HOUR }, mcpOAuth: { keep: true } });
        const snap = await usage.read(gr);
        noSecret('snapshot', snap);
        const [a, b, c] = snap.accounts;
        assert.deepStrictEqual([a.name, a.plan, a.onHost, a.engine, a.email], ['Claude Max', 'Max 5x', true, true, 'a@example.com']);
        assert.deepStrictEqual(a.limits.map((l) => l.percent), [37, 5, 0]);
        assert.strictEqual(a.source, 'login');
        assert.strictEqual(a.error, null);
        assert.deepStrictEqual([b.plan, b.limits[0].percent, b.limits[1].percent, b.error], ['Max 20x', 96, 41, null]);
        const refresh = calls.find((x) => x.url.endsWith('/v1/oauth/token'));
        assert.deepStrictEqual(Object.keys(refresh.body).sort(), ['client_id', 'grant_type', 'refresh_token', 'scope']);
        assert.strictEqual(refresh.body.refresh_token, `${ACCESS_B}-r`, 'B refreshed with its own refresh token');
        assert.ok(!calls.some((x) => x.auth === `Bearer ${ACCESS_B}`), 'the expired token is never sent');
        const linked = read(path.join(host._paths().store, ids[1], 'credentials.json')).claudeAiOauth;
        assert.strictEqual(linked.accessToken, ACCESS_B2);
        assert.strictEqual(linked.refreshToken, REFRESH_B2, 'the rotated refresh token is the linked login now');
        assert.strictEqual(linked.subscriptionType, 'max');
        assert.ok(linked.expiresAt > NOW + 7 * HOUR);
        const own = read(path.join(cdirB, '.credentials.json'));
        assert.strictEqual(own.claudeAiOauth.refreshToken, REFRESH_B2, 'the config dir copy follows');
        assert.deepStrictEqual(own.mcpOAuth, { keep: true }, 'the CLI\'s other keys in the config dir stay');
        assert.strictEqual((fs.statSync(path.join(cdirB, '.credentials.json')).mode & 0o777), 0o600);
        // the host's login was not refreshed or rewritten
        assert.strictEqual(read(host._paths().credentials).claudeAiOauth.accessToken, ACCESS_A);
        // C: no linked login, not the engine's account: asks for one, no call made with its setup token
        assert.deepStrictEqual([c.needsLogin, c.limits.length], [true, 0]);
        assert.ok(!calls.some((x) => x.auth.includes(KEY_C)));
        // cached: a second read inside the TTL makes no call
        const n = calls.length;
        await usage.read(gr);
        assert.strictEqual(calls.length, n);
        await usage.read(gr, { force: true });
        assert.strictEqual(calls.length, n, 'force still reuses a snapshot under 20 s');
        console.log('ok per-account read, idle login refreshed and saved back');
    }

    // ---- B's login held by a running session: never refreshed here ----
    {
        usage._reset();
        const B3 = login(ACCESS_B, 'b@example.com', 'bbbbbbbb-0000-4000-8000-000000000002', NOW - 10 * 60 * 1000);
        host.linkLogin(gr, 1, B3.creds, B3.oauthAccount);
        fs.rmSync(path.join(host._paths().store, ids[1], 'config'), { recursive: true, force: true });
        const cdirB = path.join(host._paths().store, ids[1], 'config');
        write(path.join(cdirB, '.credentials.json'), B3.creds);
        usage._setLiveConfigDirs(async () => new Set([path.resolve(cdirB)]));
        calls.length = 0;
        const b = (await usage.read(gr)).accounts[1];
        assert.ok(!calls.some((x) => x.url.endsWith('/v1/oauth/token')), 'a login a live CLI holds is not rotated under it');
        assert.match(b.error, /running session/);
        assert.strictEqual(read(path.join(host._paths().store, ids[1], 'credentials.json')).claudeAiOauth.accessToken, ACCESS_B);
        console.log('ok live session keeps its login');
    }

    // ---- a refused refresh: needs a sign-in, backs off ----
    {
        usage._reset();
        usage._setLiveConfigDirs(async () => new Set());
        refreshStatus = 400;
        calls.length = 0;
        const b = (await usage.read(gr)).accounts[1];
        assert.strictEqual(b.needsLogin, true);
        assert.match(b.error, /sign in again/);
        noSecret('refused row', b);
        const tries = calls.filter((x) => x.url.endsWith('/v1/oauth/token')).length;
        assert.strictEqual(tries, 1);
        await usage.read(gr, { force: true }).catch(() => null);
        console.log('ok refused refresh');
        refreshStatus = 200;
    }

    // ---- the feed: items by account id, pushed on any read ----
    {
        usage._reset();
        const handler = require('../modules/ws/handlers/315-claudeUsageHandler');
        const statusHub = require('../modules/ws/statusHub');
        const sent = [];
        statusHub.setSender((ws, packet) => sent.push(packet));
        handler.registerPackets({ globalResources: gr });
        const feed = statusHub.get('claude_usage');
        assert.ok(feed, 'feed defined');
        await assert.rejects(() => feed.subscribe({ readyState: 1, once() {} }, { userType: 'user' }), /Not allowed/);
        const sock = { readyState: 1, once() {} };
        const first = await feed.subscribe(sock, { userType: 'admin' });
        assert.deepStrictEqual(Object.keys(first.items).sort(), ['_meta', ...ids].sort());
        assert.deepStrictEqual(first.items[ids[0]].limits.map((l) => l.percent), [37, 5, 0]);
        noSecret('feed items', first.items);
        feed.unsubscribe(sock);
        console.log('ok feed');
    }

    // ---- wallet_status carries the accounts ----
    {
        const wallet = require('../modules/walletStatus');
        wallet._test.reset();
        const wgr = {
            ...gr,
            getSecureConfig: () => null,
            getApiKeyManager: () => ({ ...akm, getActiveApiKey: () => null, getActiveSecondaryKey: () => null }),
            getRunpodPodManager: () => ({ getCachedSnapshot: () => ({ pods: [] }) })
        };
        const st = await wallet.getWalletStatus(wgr, { refresh: true });
        assert.ok(st.claude && Array.isArray(st.claude.accounts));
        assert.deepStrictEqual(st.claude.accounts.map((a) => a.name), ['Claude Max', 'Claude Work', 'Claude Spare']);
        noSecret('wallet_status', st);
        console.log('ok wallet_status');
    }

    // ---- the Account Manager rows (tray flyout and Melaton Mobile's Accounts) ----
    {
        const tray = require('../public/scripts/comp/walletTray');
        const snap = usage.cached();
        tray._test.setServer({ claude: { at: null, accounts: snap.accounts } });
        let model = tray.model(NOW);
        const rows = model.rows.filter((r) => r.service === 'claude');
        assert.deepStrictEqual(rows.map((r) => r.name), ['Claude: Claude Max (Director, Remote Control)', 'Claude: Claude Work', 'Claude: Claude Spare']);
        const [ra, rb, rc] = rows;
        assert.strictEqual(ra.lines[0], 'Max 5x, a@example.com');
        assert.ok(ra.lines.some((l) => /^Current session: 37% used, resets in 3 hours$/.test(l)), ra.lines.join(' | '));
        assert.ok(ra.lines.some((l) => /^Weekly \(all models\): 5% used, resets in 6 days$/.test(l)));
        assert.ok(ra.lines.some((l) => /^Weekly \(Fable\): 0% used/.test(l)));
        assert.deepStrictEqual(ra.side.bars.map((b) => [b.caption, b.value]), [['5 hours', '37%'], ['Week', '5%']]);
        assert.strictEqual(ra.dot, 'ok');
        // B at 96% of its session: red bar, a critical alert naming the account
        assert.strictEqual(rb.dot, 'bad');
        assert.ok(model.alerts.some((a) => a.level === 'critical' && a.title === 'Claude Work: current session limit reached') === false);
        assert.ok(model.alerts.some((a) => a.level === 'warning' && /^Claude Work: current session 96% used$/.test(a.title)));
        // C: a login needed, its link opens Claude Accounts
        assert.strictEqual(rc.dot, 'warn');
        const link = rc.lines.find((l) => l && typeof l === 'object');
        assert.deepStrictEqual([link.link.name, link.link.label], ['claude-accounts', 'Claude Accounts']);
        assert.ok(model.alerts.some((a) => a.title === 'Claude Spare: Claude login needed'));
        // a push replaces the wallet_status copy: B's session at 100%
        tray._test.applyClaude({ [ids[1]]: { ...snap.accounts[1], limits: [{ ...snap.accounts[1].limits[0], percent: 100 }] } }, [], true);
        model = tray.model(NOW);
        assert.deepStrictEqual(model.rows.filter((r) => r.service === 'claude').map((r) => r.name), ['Claude: Claude Work'], 'a whole push is the account list');
        assert.ok(model.alerts.some((a) => a.level === 'critical' && a.title === 'Claude Work: current session limit reached'));
        tray._test.applyClaude({}, [ids[1]], false);
        assert.deepStrictEqual(tray.model(NOW).rows.filter((r) => r.service === 'claude').map((r) => r.name), ['Claude'], 'no accounts: the engine\'s last-turn row');
        tray._test.clearClaudeLive();
        // an older server (no accounts): the engine's last-turn row as before
        tray._test.setServer({ claude: { at: NOW - 60000, fiveHour: { percent: 40, resetsAt: NOW + HOUR }, sevenDay: { percent: 10, resetsAt: NOW + 5 * 24 * HOUR } } });
        assert.deepStrictEqual(tray.model(NOW).rows.filter((r) => r.service === 'claude').map((r) => r.name), ['Claude']);
        console.log('ok tray rows');
    }

    console.log('claude usage tests passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
