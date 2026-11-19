'use strict';

// Claude Accounts (phone) + Remote Control reconnect: modules/claudeAccountHost.js,
// modules/ws/handlers/313-claudeAccountsHandler.js. Sandboxed: a temp home for ~/.claude, a temp store,
// and a fake systemctl / tmux runner, so the host's real Remote Control and login are never touched.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-claude-accounts-test-'));
process.env.DREAMSCAPE_CLAUDE_HOME = path.join(SANDBOX, 'home');
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = path.join(SANDBOX, 'store');
process.env.DREAMSCAPE_CLAUDE_RC_UNIT = 'claude-remote-test.service';
process.env.DREAMSCAPE_CLAUDE_RC_TMUX = 'claude-rc-test';
delete process.env.DREAMSCAPE_CLAUDE_RC_READONLY;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) { /* gone */ } });

const ROOT = path.join(__dirname, '..');
const host = require('../modules/claudeAccountHost');
const paths = host._paths();
assert.ok(paths.credentials.startsWith(SANDBOX) && paths.claudeJson.startsWith(SANDBOX) && paths.store.startsWith(SANDBOX), 'test must stay in its sandbox');

const SECRET_A = 'sk-ant-oat01-ENGINE-A-aaaaaaaaaaaaaaaaaaaaaaaa';
const SECRET_B = 'sk-ant-oat01-ENGINE-B-bbbbbbbbbbbbbbbbbbbbbbbb';
const ACCESS_A = 'sk-ant-oat01-ACCESS-A-1111111111111111111111';
const REFRESH_A = 'sk-ant-ort01-REFRESH-A-111111111111111111111';
const ACCESS_A2 = 'sk-ant-oat01-ACCESS-A-2222222222222222222222';
const ACCESS_B = 'sk-ant-oat01-ACCESS-B-3333333333333333333333';
const ALL_SECRETS = [SECRET_A, SECRET_B, ACCESS_A, REFRESH_A, ACCESS_A2, ACCESS_B];

function login(access, email, uuid, plan) {
    return {
        creds: { claudeAiOauth: { accessToken: access, refreshToken: `${access}-r`, expiresAt: 1795115747356, scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'], subscriptionType: plan, rateLimitTier: `default_claude_${plan}_20x` } },
        oauthAccount: { emailAddress: email, accountUuid: uuid, displayName: email.split('@')[0], organizationName: `${email}'s Organization` }
    };
}
function putHost(l) {
    fs.mkdirSync(path.dirname(paths.credentials), { recursive: true });
    fs.writeFileSync(paths.credentials, JSON.stringify(l.creds), { mode: 0o600 });
    const cj = fs.existsSync(paths.claudeJson) ? JSON.parse(fs.readFileSync(paths.claudeJson, 'utf8')) : { numStartups: 42, projects: { '/x': {} } };
    cj.oauthAccount = l.oauthAccount;
    fs.writeFileSync(paths.claudeJson, JSON.stringify(cj), { mode: 0o600 });
}
const hostCreds = () => JSON.parse(fs.readFileSync(paths.credentials, 'utf8'));
const hostJson = () => JSON.parse(fs.readFileSync(paths.claudeJson, 'utf8'));
const noSecrets = (value, what) => {
    const text = JSON.stringify(value);
    ALL_SECRETS.forEach((s) => assert.ok(!text.includes(s), `${what} must not carry a token`));
};

// ---- fake key manager (CardSpace's Claude keys) and server
const broadcasts = [];
const keys = [{ name: 'Claude Max', apiKey: SECRET_A }, { name: 'Claude Work', apiKey: SECRET_B }];
let selectedIndex = 0;
const fakeAkm = {
    getServiceKeys: (s) => (s === 'claude' ? keys : []),
    getSelectedIndex: () => selectedIndex,
    keyFingerprint: (s, k) => `${k.apiKey.slice(0, 8)}...${k.apiKey.slice(-4)}`,
    async applySelectionUpdates(list) {
        const c = list.find((u) => u.service === 'claude');
        if (c && c.index !== selectedIndex) { selectedIndex = c.index; host.onSelectionChanged(gr, c.index); return { updated: [c], restartedServices: [] }; }
        return { updated: [], restartedServices: [] };
    }
};
const gr = {
    getApiKeyManager: () => fakeAkm,
    getWebSocketServer: () => ({ broadcast: (msg, filter) => broadcasts.push({ msg, admin: filter({ userType: 'admin' }), user: filter({ userType: 'user' }) }) })
};

// ---- fake systemctl / tmux
let unit = { active: 'active', sub: 'running' };
let pane = '·✔︎· Connected · staticforge · main\n    Capacity: 3/32 · New sessions\nContinue in https://claude.ai/code?environment=env_01SfLPyKEK75g7f3orExB26U\n';
const calls = [];
host._setRunner(async (cmd, args) => {
    calls.push(`${cmd} ${args.join(' ')}`);
    if (cmd === 'systemctl' && args[1] === 'show') {
        return { code: 0, stderr: '', stdout: `ActiveState=${unit.active}\nSubState=${unit.sub}\nMainPID=4242\nActiveEnterTimestamp=Tue 2026-11-10 15:47:25 EST\nNRestarts=0\nDescription=Claude Code Remote Control server\nExecStart={ path=/usr/bin/tmux ; argv[]=/usr/bin/tmux new-session -d -s claude-rc '/home/k/.local/bin/claude remote-control --name Dreamscape' }\n` };
    }
    if (cmd === 'systemctl' && args[1] === 'stop') { unit = { active: 'inactive', sub: 'dead' }; return { code: 0, stdout: '', stderr: '' }; }
    if (cmd === 'systemctl' && args[1] === 'start') { unit = { active: 'active', sub: 'running' }; return { code: 0, stdout: '', stderr: '' }; }
    if (cmd === 'tmux') return { code: 0, stdout: pane, stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected' };
});

async function main() {
    // 1. pane parsing keeps no links or ids
    const parsed = host.parsePane(pane);
    assert.strictEqual(parsed.state, 'connected');
    assert.strictEqual(parsed.sessions, 3);
    assert.strictEqual(parsed.capacity, 32);
    assert.ok(!JSON.stringify(parsed).includes('env_01SfLPyKEK75g7f3orExB26U') && !JSON.stringify(parsed).includes('https://'), 'pane text is cleaned');
    assert.strictEqual(host.parsePane('Error: not logged in. Run claude /login').state, 'error');
    console.log('✓ pane parsing');

    // 2. list + link the host login to account A
    putHost(login(ACCESS_A, 'a@example.com', 'uuid-a', 'max'));
    let list = host.listAccounts(gr);
    assert.strictEqual(list.length, 2);
    assert.ok(list[0].active && !list[1].active);
    assert.strictEqual(list[0].remoteLogin, null);
    noSecrets(list, 'listAccounts');
    host.linkHostLogin(gr, 0);
    list = host.listAccounts(gr);
    assert.strictEqual(list[0].remoteLogin.email, 'a@example.com');
    assert.strictEqual(list[0].remoteLogin.plan, 'max');
    assert.ok(list[0].onHost);
    noSecrets(list, 'listAccounts after link');
    const dirA = path.join(paths.store, list[0].id);
    assert.strictEqual(fs.statSync(dirA).mode & 0o777, 0o700, 'store dir 0700');
    assert.strictEqual(fs.statSync(path.join(dirA, 'credentials.json')).mode & 0o777, 0o600, 'linked login 0600');
    console.log('✓ link host login (0700 dir, 0600 file, no tokens out)');

    // link B: sign the host in as B, link, then back to A as live
    putHost(login(ACCESS_B, 'b@example.com', 'uuid-b', 'pro'));
    host.linkHostLogin(gr, 1);
    putHost(login(ACCESS_A2, 'a@example.com', 'uuid-a', 'max')); // A's live token rotated since the link
    host.arm(gr);

    // 3. switch A -> B through the key manager (CardSpace's path): stop, save A back, install B, start
    calls.length = 0; broadcasts.length = 0;
    const handler = require('../modules/ws/handlers/313-claudeAccountsHandler')._handlers;
    const sent = [];
    const ctx = { globalResources: gr, sendToClient: (ws, m) => sent.push(m), sendError: (ws, msg, code) => sent.push({ type: 'error', msg, code }) };
    await handler.handleSwitch(ctx, {}, { index: 1, requestId: 'r1' }, { userType: 'user' });
    assert.strictEqual(sent.pop().code, 'INSUFFICIENT_PERMISSIONS', 'non-admin refused');
    await handler.handleSwitch(ctx, {}, { index: 1, requestId: 'r2' }, { userType: 'admin' });
    const resp = sent.pop();
    assert.strictEqual(resp.type, 'switch_claude_account_response');
    noSecrets(resp, 'switch response');
    assert.strictEqual(selectedIndex, 1, 'the engine account is B');
    const settled = await host.reconnect(gr, {}); // joins the running reconnect
    assert.strictEqual(settled.state, 'connected', `connected after switch (${settled.message})`);
    assert.ok(calls.indexOf(`systemctl --user stop claude-remote-test.service`) < calls.indexOf(`systemctl --user start claude-remote-test.service`), 'stopped before started');
    assert.strictEqual(hostCreds().claudeAiOauth.accessToken, ACCESS_B, 'host signed in as B');
    assert.strictEqual(hostJson().oauthAccount.emailAddress, 'b@example.com');
    assert.strictEqual(hostJson().numStartups, 42, '~/.claude.json keeps its other keys');
    const storedA = JSON.parse(fs.readFileSync(path.join(dirA, 'credentials.json'), 'utf8'));
    assert.strictEqual(storedA.claudeAiOauth.accessToken, ACCESS_A2, "A's rotated login was saved back before B went in");
    const states = broadcasts.map((b) => b.msg.data.state);
    assert.deepStrictEqual([states[0], states[states.length - 1]], ['reconnecting', 'connected']);
    assert.ok(broadcasts.every((b) => b.msg.type === host.STATUS_TYPE && b.admin && !b.user), 'status goes to admins only');
    noSecrets(broadcasts, 'broadcasts');
    console.log('✓ switch: engine account, Remote Control stop -> save back -> install -> start -> Connected');

    // 4. same account again: still reconnects ("on each switch")
    calls.length = 0;
    await handler.handleSwitch(ctx, {}, { index: 1, requestId: 'r3' }, { userType: 'admin' });
    await host.reconnect(gr, {});
    assert.ok(calls.includes('systemctl --user stop claude-remote-test.service'), 'reconnects on a repeat switch');
    console.log('✓ repeat switch reconnects');

    // 5. an account without a linked login leaves the host login alone and says so
    host.unlinkLogin(gr, 0);
    await host.reconnect(gr, { index: 0, pollMs: 20 });
    assert.strictEqual(hostCreds().claudeAiOauth.accessToken, ACCESS_B, 'unlinked target: host login unchanged');
    assert.ok(/no linked Remote Control login/i.test(host.publicStatus().message));
    console.log('✓ unlinked account keeps the host login, with a note');

    // 6. Remote Control errors show as error
    pane = 'Error: Remote Control could not connect: login expired\n';
    const failed = await host.reconnect(gr, { index: 1, pollMs: 20, timeoutMs: 500 });
    assert.strictEqual(failed.state, 'error');
    assert.ok(/login expired/.test(failed.message));
    pane = '·✔︎· Connected · staticforge · main\n';
    console.log('✓ error state');

    // 7. host status for the Host tab
    const hs = await host.hostStatus(gr);
    assert.strictEqual(hs.remoteControl.sessionName, 'Dreamscape');
    assert.strictEqual(hs.login.email, 'b@example.com');
    assert.strictEqual(hs.engine.account.name, 'Claude Work');
    noSecrets(hs, 'hostStatus');
    console.log('✓ host status');

    // 8. read-only instances never stop or start the unit
    host._setRunner(null);
    process.env.DREAMSCAPE_CLAUDE_RC_READONLY = '1';
    await assert.rejects(() => host.stop(gr), /Could not stop/);
    delete process.env.DREAMSCAPE_CLAUDE_RC_READONLY;
    console.log('✓ read-only guard');

    // 9. wiring: shared backend hook, broadcast class, read-only clients, phone program
    const src = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
    assert.ok(/claudeAccountHost'\)\.onSelectionChanged\(this\.globalResources, change\.index\)/.test(src('modules/apiKeyManager.js')), 'CardSpace selection reconnects too');
    assert.ok(/PHONE_ONLY_TYPES = new Set\(\[[^\]]*'claude_remote_control_status'/.test(src('modules/websocket.js')), 'status push classified');
    ['switch_claude_account', 'link_claude_account_login', 'unlink_claude_account_login', 'claude_remote_control'].forEach((t) => assert.ok(src('modules/websocketHandlers.js').includes(`'${t}'`), `${t} is destructive for read-only clients`));
    assert.ok(/id: 'claude-accounts'[^\n]*wmClaudeAccounts\.js/.test(src('public/scripts/comp/wmShell.js')), 'phone program registered');
    assert.ok(src('public/app.html').includes('/css/wm-claude-accounts.css'), 'phone stylesheet');
    assert.ok(!/applicationAuthManager/.test(src('modules/ws/handlers/313-claudeAccountsHandler.js')), 'no application-key scope changes');
    console.log('✓ wiring');

    console.log('\nClaude accounts tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });
