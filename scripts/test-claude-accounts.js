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
    addApiKey(service, name, apiKey) {
        if (service !== 'claude' || keys.some((k) => k.name === name)) throw new Error('name taken');
        keys.push({ name, apiKey });
        return { success: true, index: keys.length - 1 };
    },
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

    // 5b. a host login no account has linked is kept before another goes in
    putHost(login('sk-ant-oat01-STRAY-0000000000000000000000', 'stray@example.com', 'uuid-s', 'pro'));
    await host.reconnect(gr, { index: 1, pollMs: 20 });
    assert.strictEqual(hostCreds().claudeAiOauth.accessToken, ACCESS_B, 'B went in');
    const backup = JSON.parse(fs.readFileSync(path.join(paths.store, 'host-backup', 'credentials.json'), 'utf8'));
    assert.strictEqual(backup.claudeAiOauth.accessToken, 'sk-ant-oat01-STRAY-0000000000000000000000', 'the unlinked host login was backed up');
    assert.strictEqual(fs.statSync(path.join(paths.store, 'host-backup', 'credentials.json')).mode & 0o777, 0o600);
    console.log('✓ unlinked host login backed up before a switch replaces it');

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

    await addAccountBySignIn(handler, src);

    console.log('\nClaude accounts tests passed');
}

// ---- Add Account by signing in (modules/claudeAccountLogin.js) with a fake `claude` CLI in a pty
const NEW_TOKEN = 'sk-ant-oat01-NEWENGINE-cccccccccccccccccccccccccccccc';
const NEW_ACCESS = 'sk-ant-oat01-NEWACCESS-dddddddddddddddddddddddddddddd';
const LOGIN_CODE = 'LoginCodeAbcdefghijklmnopqrstuvwxyz0123#state1';
const TOKEN_CODE = 'TokenCodeAbcdefghijklmnopqrstuvwxyz0123#state2';
const FAKE_DIR = path.join(SANDBOX, 'fakecli');
const FAKE_CLI = path.join(FAKE_DIR, 'claude');
const FAKE_SRC = `#!/usr/bin/env node
const fs = require('fs'); const path = require('path');
const dir = ${JSON.stringify(FAKE_DIR)};
const mode = (() => { try { return fs.readFileSync(path.join(dir, 'mode'), 'utf8').trim(); } catch (_) { return 'ok'; } })();
const args = process.argv.slice(2).join(' ');
const leaked = Object.keys(process.env).filter((k) => /TOKEN|API_KEY|DREAMSCAPE|XDG_|DISPLAY|DBUS/.test(k));
fs.appendFileSync(path.join(dir, 'calls.log'), JSON.stringify({ args, home: process.env.HOME, cfg: process.env.CLAUDE_CONFIG_DIR, browser: process.env.BROWSER, leaked, tty: process.stdin.isTTY === true }) + '\\n');
const out = (t) => process.stdout.write(t);
let buf = '';
const onCode = (fn) => process.stdin.on('data', (d) => { buf += d.toString(); const m = /^([^\\r\\n]*)[\\r\\n]/.exec(buf); if (m) { process.stdin.pause(); fn(m[1].trim()); } });
if (mode === 'nolink') { out('Starting...\\r\\n'); setInterval(() => {}, 1000); }
else if (args === 'auth login --claudeai') {
    out('Opening browser to sign in…\\r\\nIf the browser didn\\'t open, visit: https://claude.com/cai/oauth/authorize?code=true&client_id=x&response_type=code&scope=user%3Ainference+user%3Asessions%3Aclaude_code&state=state1\\r\\nPaste code here if prompted > ');
    onCode((code) => {
        if (code !== ${JSON.stringify(LOGIN_CODE)}) { out('\\r\\nOAuth error: Invalid code ' + code + '\\r\\n'); process.exit(1); }
        const cfg = process.env.CLAUDE_CONFIG_DIR;
        fs.writeFileSync(path.join(cfg, '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: ${JSON.stringify(NEW_ACCESS)}, refreshToken: ${JSON.stringify(NEW_ACCESS + '-r')}, expiresAt: 1795115747356, scopes: ['user:inference', 'user:profile', 'user:sessions:claude_code'], subscriptionType: 'max', rateLimitTier: 'default_claude_max_20x' } }));
        fs.writeFileSync(path.join(cfg, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'new@example.com', accountUuid: 'uuid-new', displayName: 'new' } }));
        out('\\r\\nLogin successful.\\r\\n');
        process.exit(0);
    });
} else if (args === 'setup-token') {
    out('\\x1b[?2004h\\x1b[2GThis\\x1b[7Gwill guide you\\r\\n\\x1b]8;id=1;https://claude.com/cai/oauth/authorize?code=true&scope=user%3Ainference&state=state2\\x07https://claude.com/cai/oauth/authorize?code=true&scope=user%3Ainference&state=state2\\x1b]8;;\\x07\\r\\n\\x1b[2GPaste\\x1b[8Gcode\\x1b[13Ghere\\x1b[18Gif\\x1b[21Gprompted\\r\\n> ');
    onCode((code) => {
        if (code !== ${JSON.stringify(TOKEN_CODE)}) { out('\\r\\nError: invalid code\\r\\n'); process.exit(1); }
        out('\\r\\n\\x1b[32m✓\\x1b[39m Long-lived authentication token created successfully!\\r\\n\\r\\nYour OAuth token (valid for 1 year):\\r\\n\\r\\n\\x1b[33m' + ${JSON.stringify(NEW_TOKEN)} + '\\x1b[39m\\r\\n\\r\\nStore this token securely.\\r\\n');
        if (mode === 'hang') setInterval(() => {}, 1000); else process.exit(0);
    });
} else { out('unknown ' + args); process.exit(2); }
`;

async function waitFor(fn, what, ms) {
    const until = Date.now() + (ms || 15000);
    for (;;) {
        const v = fn();
        if (v) return v;
        if (Date.now() > until) throw new Error(`timed out waiting for ${what} (${JSON.stringify(require('../modules/claudeAccountLogin').status())})`);
        await new Promise((r) => setTimeout(r, 50));
    }
}

async function addAccountBySignIn(handler, src) {
    const signIn = require('../modules/claudeAccountLogin');
    fs.mkdirSync(FAKE_DIR, { recursive: true });
    fs.writeFileSync(FAKE_CLI, FAKE_SRC, { mode: 0o755 });
    process.env.DREAMSCAPE_CLAUDE_LOGIN_CLI = FAKE_CLI;
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-ant-oat01-SERVER-ENV-eeeeeeeeeeeeeeeeeeeeeeee'; // must not reach the CLI
    const setMode = (m) => fs.writeFileSync(path.join(FAKE_DIR, 'mode'), m);
    const calls = () => fs.readFileSync(path.join(FAKE_DIR, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    const secrets = [NEW_TOKEN, NEW_ACCESS, LOGIN_CODE, TOKEN_CODE, LOGIN_CODE.split('#')[0], TOKEN_CODE.split('#')[0], process.env.CLAUDE_CODE_OAUTH_TOKEN];
    const clean = (v, what) => { const t = JSON.stringify(v); secrets.forEach((x) => assert.ok(!t.includes(x), `${what} must not carry a token or code`)); };
    const pendingDirs = () => fs.readdirSync(paths.store).filter((n) => n.startsWith('pending-'));
    const hostBefore = fs.readFileSync(paths.credentials, 'utf8');
    const sent = [];
    const ctx = { globalResources: gr, sendToClient: (ws, m) => sent.push(m), sendError: (ws, msg, code) => sent.push({ type: 'error', msg, code }) };
    const ask = async (payload, who) => { await handler.handleLogin(ctx, {}, Object.assign({ requestId: 'x' }, payload), { userType: who || 'admin' }); return sent.pop(); };
    const st = () => signIn.status();
    setMode('ok');
    broadcasts.length = 0;

    // non-admins are refused
    assert.strictEqual((await ask({ action: 'start' }, 'user')).code, 'INSUFFICIENT_PERMISSIONS');
    assert.strictEqual(st().state, 'idle');

    // step 1: the login link, isolated dir, one at a time
    const first = await ask({ action: 'start', name: '' });
    assert.strictEqual(first.type, 'claude_account_login_response');
    const id = first.data.login.id;
    await waitFor(() => st().state === 'waiting_code', 'login link');
    assert.ok(/^https:\/\/claude\.com\/cai\/oauth\/authorize\?code=true&.*state=state1$/.test(st().url), `login link (${st().url})`);
    assert.strictEqual(st().stepNumber, 1);
    assert.strictEqual((await ask({ action: 'start' })).data.login.id, id, 'a second Add picks the running sign-in back up');
    const dirs = pendingDirs();
    assert.strictEqual(dirs.length, 1);
    assert.strictEqual(fs.statSync(path.join(paths.store, dirs[0])).mode & 0o777, 0o700, 'pending dir 0700');
    const c1 = calls()[0];
    assert.strictEqual(c1.args, 'auth login --claudeai');
    assert.ok(c1.home.startsWith(path.join(paths.store, dirs[0])) && c1.cfg === path.join(c1.home, '.claude'), 'CLI runs in the pending dir');
    assert.deepStrictEqual(c1.leaked, [], 'no server token / session env reaches the CLI');
    assert.strictEqual(c1.browser, 'true');
    assert.ok(c1.tty, 'the CLI gets a terminal');

    // a wrong code: error without the code, Try Again redoes the step
    await ask({ action: 'code', code: 'WrongCodeAbcdefghijklmnopqrstuvwxyz#state1' });
    await waitFor(() => st().state === 'error', 'bad code error');
    assert.ok(/did not accept/.test(st().message) && !st().message.includes('WrongCode'), `bad code message cleaned (${st().message})`);
    assert.strictEqual(pendingDirs().length, 0, 'error cleans the pending dir');
    await ask({ action: 'retry' });
    await waitFor(() => st().state === 'waiting_code', 'login link again');
    assert.strictEqual(st().stepNumber, 1);
    assert.strictEqual((await ask({ action: 'code', code: 'x' })).code, 'CLAUDE_ACCOUNTS_FAILED', 'junk code refused');

    // step 1 code -> step 2 link -> code -> account
    await ask({ action: 'code', code: `  ${LOGIN_CODE} ` });
    await waitFor(() => st().step === 'token' && st().state === 'waiting_code', 'token link');
    assert.ok(/scope=user%3Ainference&state=state2$/.test(st().url), `token link from the OSC 8 / Ink output (${st().url})`);
    assert.strictEqual(st().signedInAs.email, 'new@example.com');
    const before = keys.length;
    await ask({ action: 'code', code: TOKEN_CODE });
    await waitFor(() => st().state === 'done', 'account added');
    assert.strictEqual(keys.length, before + 1, 'one CardSpace key added');
    const added = keys[keys.length - 1];
    assert.strictEqual(added.apiKey, NEW_TOKEN, 'the setup token is the engine key');
    assert.strictEqual(added.name, 'new@example.com', 'named after the email when no name was given');
    assert.deepStrictEqual(Object.assign({}, st().account), { index: keys.length - 1, name: 'new@example.com', email: 'new@example.com', plan: 'max', linked: true });
    const row = host.listAccounts(gr).find((a) => a.index === keys.length - 1);
    assert.strictEqual(row.remoteLogin.email, 'new@example.com', 'its Remote Control login is linked');
    assert.strictEqual(fs.statSync(path.join(paths.store, row.id, 'credentials.json')).mode & 0o777, 0o600);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(paths.store, row.id, 'credentials.json'), 'utf8')).claudeAiOauth.accessToken, NEW_ACCESS);
    assert.strictEqual(fs.readFileSync(paths.credentials, 'utf8'), hostBefore, "the host's own login is untouched");
    assert.strictEqual(pendingDirs().length, 0, 'pending dir removed');
    assert.ok(calls().every((c) => c.leaked.length === 0 && c.home.includes(`${path.sep}pending-`)), 'every CLI run isolated');
    clean(sent, 'responses'); clean(broadcasts, 'broadcasts'); clean(st(), 'status');
    assert.ok(broadcasts.some((b) => b.msg.type === signIn.STATUS_TYPE) && broadcasts.filter((b) => b.msg.type === signIn.STATUS_TYPE).every((b) => b.admin && !b.user), 'sign-in status to admins only');
    console.log('✓ add account by sign-in: link, isolated CLI, code, CardSpace key + linked login, no tokens out');

    // a CLI that shows the token and then waits is finished anyway; cancel kills and cleans
    keys.pop();
    setMode('hang');
    await ask({ action: 'start', name: 'Claude New' });
    await waitFor(() => st().state === 'waiting_code', 'link (hang)');
    await ask({ action: 'code', code: LOGIN_CODE });
    await waitFor(() => st().step === 'token' && st().state === 'waiting_code', 'token link (hang)');
    await ask({ action: 'code', code: TOKEN_CODE });
    await waitFor(() => st().state === 'done', 'done (hang)');
    assert.strictEqual(keys[keys.length - 1].name, 'Claude New', 'given name kept');
    assert.strictEqual(pendingDirs().length, 0);
    keys.pop();
    setMode('ok');
    await ask({ action: 'start' });
    await waitFor(() => st().state === 'waiting_code', 'link (cancel)');
    assert.strictEqual(pendingDirs().length, 1);
    assert.strictEqual((await ask({ action: 'cancel' })).data.login.state, 'idle');
    assert.strictEqual(pendingDirs().length, 0, 'cancel removes the pending dir');
    console.log('✓ token-then-wait CLI, cancel');

    // timeouts: no link, no code
    setMode('nolink');
    process.env.DREAMSCAPE_CLAUDE_LOGIN_STEP_MS = '800';
    await ask({ action: 'start' });
    await waitFor(() => st().state === 'error', 'no-link error');
    assert.ok(/no sign-in link/.test(st().message));
    setMode('ok');
    await ask({ action: 'start' });
    await waitFor(() => st().state === 'error', 'step timeout', 8000);
    assert.ok(/timed out/.test(st().message), st().message);
    assert.strictEqual(pendingDirs().length, 0, 'timeout cleans up');
    delete process.env.DREAMSCAPE_CLAUDE_LOGIN_STEP_MS;
    console.log('✓ timeouts');

    // a read-only (preview) instance runs the flow but saves nothing
    process.env.DREAMSCAPE_CLAUDE_RC_READONLY = '1';
    const n = keys.length;
    await ask({ action: 'start' });
    await waitFor(() => st().state === 'waiting_code', 'link (read-only)');
    await ask({ action: 'code', code: LOGIN_CODE });
    await waitFor(() => st().step === 'token' && st().state === 'waiting_code', 'token (read-only)');
    await ask({ action: 'code', code: TOKEN_CODE });
    await waitFor(() => st().state === 'done', 'done (read-only)');
    assert.strictEqual(keys.length, n, 'read-only: no key added');
    assert.ok(/not saved/.test(st().message));
    delete process.env.DREAMSCAPE_CLAUDE_RC_READONLY;
    signIn.cancel();
    console.log('✓ read-only instance saves nothing');

    // text helpers + wiring
    const t = signIn._text;
    assert.strictEqual(t.cleanMessage(`> ${LOGIN_CODE}\nOAuth error: Invalid code ${LOGIN_CODE}`, LOGIN_CODE).includes('LoginCode'), false);
    assert.ok(!t.cleanMessage(`token ${NEW_TOKEN} https://claude.com/x?y=z`).includes('sk-ant'));
    assert.ok(src('modules/websocketHandlers.js').includes("'claude_account_login'"), 'claude_account_login is destructive for read-only clients');
    assert.ok(/PHONE_ONLY_TYPES = new Set\(\[[^\]]*'claude_account_login_status'/.test(src('modules/websocket.js')), 'sign-in push classified');
    const ui = src('public/scripts/comp/wmClaudeAccounts.js');
    assert.ok(ui.includes('Open in Alchemy') && ui.includes('openGrimoireUrl') && ui.includes('data-wca-add="open"') && ui.includes("'claude_account_login_status'"), 'phone Add Account wired');
    assert.ok(!/applicationAuthManager/.test(src('modules/claudeAccountLogin.js')), 'no application-key scope changes');
    console.log('✓ sign-in wiring');
}

main().catch((error) => { console.error(error); process.exit(1); });
