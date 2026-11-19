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

    // 7b. shared permissions + Bring over + Sessions tab (modules/claudeSessions.js), all in the sandbox
    await sharedPermissionsAndSessions(handler, ctx, sent);

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

// ---- shared permissions, Bring over on a switch, the Sessions tab: fake ~/.claude/sessions + transcripts,
// fake tmux (Remote Control's default socket and claudeSessions' own -L socket)
const SOCK = 'ds-claude-carry-test';
process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET = SOCK;
process.env.DREAMSCAPE_CLAUDE_CLI = '/opt/fake/claude';
const sessions = require('../modules/claudeSessions');
const uuid = (n) => `${String(n).repeat(8).slice(0, 8)}-1111-4111-8111-${String(n).repeat(12).slice(0, 12)}`;

async function sharedPermissionsAndSessions(handler, ctx, sent) {
    const H = process.env.DREAMSCAPE_CLAUDE_HOME;
    const PROJ = path.join(H, 'proj');
    const OTHER = path.join(H, 'other');
    fs.mkdirSync(path.join(PROJ, '.claude'), { recursive: true });
    fs.mkdirSync(OTHER, { recursive: true });
    // A linked again (5. unlinked it), B on the host
    putHost(login(ACCESS_A2, 'a@example.com', 'uuid-a', 'max'));
    host.linkHostLogin(gr, 0);
    putHost(login(ACCESS_B, 'b@example.com', 'uuid-b', 'pro'));
    const settings = { permissions: { allow: ['Bash(ssh ruiko:*)', 'Bash(curl http://127.0.0.1:18791/*)', 'Read(//x/**)'], deny: ['Bash(rm -rf /*)'], defaultMode: 'bypassPermissions' }, skipDangerousModePermissionPrompt: true, theme: 'dark' };
    const settingsText = JSON.stringify(settings, null, 2);
    fs.writeFileSync(path.join(H, '.claude', 'settings.json'), settingsText);
    const localText = JSON.stringify({ permissions: { allow: ['Bash(node /p/*)', 'Bash(bash /p/*)'] } });
    fs.writeFileSync(path.join(PROJ, '.claude', 'settings.local.json'), localText);
    const cj = hostJson();
    cj.projects = { [PROJ]: { allowedTools: ['Edit'], hasTrustDialogAccepted: true }, [OTHER]: { allowedTools: [], hasTrustDialogAccepted: true } };
    fs.writeFileSync(paths.claudeJson, JSON.stringify(cj));
    const projectsBefore = JSON.stringify(hostJson().projects);
    // the host's credentials file keeps more than the login (MCP logins): a switch keeps those
    const hc = hostCreds();
    hc.mcpOAuth = { 'srv|1': { accessToken: 'sk-ant-oat01-MCP-eeeeeeeeeeeeeeeeeeeeeeeeeee' } };
    fs.writeFileSync(paths.credentials, JSON.stringify(hc));
    // a linked login from before Nov 19 that carries extra state: stripped to the login
    const listed = host.listAccounts(gr);
    const dirB = path.join(paths.store, listed[1].id);
    const sb = JSON.parse(fs.readFileSync(path.join(dirB, 'credentials.json'), 'utf8'));
    sb.mcpOAuth = { stale: true };
    fs.writeFileSync(path.join(dirB, 'credentials.json'), JSON.stringify(sb), { mode: 0o600 });
    fs.writeFileSync(path.join(dirB, 'account.json'), JSON.stringify(Object.assign(JSON.parse(fs.readFileSync(path.join(dirB, 'account.json'), 'utf8')), { permissions: { allow: ['Bash(*)'] } })), { mode: 0o600 });
    assert.strictEqual(host._normalizeStore(), 2, 'old linked login normalized');
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dirB, 'credentials.json'), 'utf8'))), ['claudeAiOauth']);
    assert.ok(!('permissions' in JSON.parse(fs.readFileSync(path.join(dirB, 'account.json'), 'utf8'))), 'no permission state in a linked login');

    // ---- live sessions: two of Remote Control's children, one rc- session started by hand, one dead, one terminal
    const S1 = uuid(1); const S2 = uuid(2); const S3 = uuid(3); const S4 = uuid(4); const S5 = uuid(5); const S6 = uuid(6);
    const alive = new Set([101, 102, 103, 105]);
    host._setPidAlive((pid) => alive.has(pid));
    const slug = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');
    const writeTranscript = (cwd, id, prompts) => {
        const dir = path.join(H, '.claude', 'projects', slug(cwd));
        fs.mkdirSync(dir, { recursive: true });
        const lines = [];
        prompts.forEach((p, i) => {
            lines.push(JSON.stringify({ type: 'user', cwd, sessionId: id, timestamp: `2026-11-19T1${i}:00:00.000Z`, message: { role: 'user', content: p } }));
            lines.push(JSON.stringify({ type: 'user', cwd, sessionId: id, timestamp: `2026-11-19T1${i}:00:01.000Z`, message: { role: 'user', content: [{ type: 'tool_result', content: 'x' }] } }));
            lines.push(JSON.stringify({ type: 'assistant', cwd, sessionId: id, timestamp: `2026-11-19T1${i}:00:02.000Z`, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] } }));
        });
        fs.writeFileSync(path.join(dir, `${id}.jsonl`), `${lines.join('\n')}\n`);
    };
    writeTranscript(PROJ, S1, ['Fix the phone tap menu', `then ship it ${SECRET_A}`]);
    writeTranscript(PROJ, S2, ['Studio settings parity']);
    writeTranscript(OTHER, S3, ['Mobile IE pass-through', 'and the 6.5 bars']);
    writeTranscript(PROJ, S4, ['An old finished one']);
    writeTranscript(PROJ, S5, ['Running in a terminal']);
    writeTranscript(PROJ, S6, ['Idle, not running']);
    const sdir = path.join(H, '.claude', 'sessions');
    fs.mkdirSync(sdir, { recursive: true });
    const rec = (pid, id, cwd, tmux, bridge, extra) => fs.writeFileSync(path.join(sdir, `${pid}.json`), JSON.stringify(Object.assign({ pid, sessionId: id, cwd, tmux, bridgeSessionId: bridge, name: 'staticforge-2b', nameSource: 'derived', status: 'idle', updatedAt: Date.now(), startedAt: Date.now() - 60000 }, extra || {})));
    rec(101, S1, PROJ, 'claude-rc-test:@0.%0', 'session_01AAAAAAAAAAAAAAAAAAAAAAAA', { status: 'busy' });
    rec(102, S2, PROJ, 'claude-rc-test:@0.%0', 'session_01BBBBBBBBBBBBBBBBBBBBBBBB');
    rec(103, S3, OTHER, 'rc-mobileie:@0.%0', 'session_01CCCCCCCCCCCCCCCCCCCCCCCC', { name: 'mobile ie', nameSource: 'user' });
    rec(104, S4, PROJ, 'claude-rc-test:@0.%0', 'session_01DDDDDDDDDDDDDDDDDDDDDDDD');
    rec(105, S5, PROJ, '', null);

    // fake tmux: own socket sessions with scripted panes; default socket rc-* sessions; Remote Control's pane
    const own = new Map();
    const panes = {}; // name -> [texts...] (the last one repeats)
    const ACTIVE = (bridge) => `❯ \n  /remote-control is active · Continue here, on your phone, or at https://claude.ai/code/${bridge}?x=1\n  ⏵⏵ bypass permissions on`;
    const defaultRc = new Set(['rc-mobileie']);
    let execStart = "{ path=/usr/bin/tmux ; argv[]=/usr/bin/tmux new-session -d -s claude-rc -c /home/k/staticforge \"/home/k/.local/bin/claude remote-control --name Dreamscape --permission-mode bypassPermissions; sleep 2\" ; }";
    const log = [];
    host._setRunner(async (cmd, args) => {
        log.push(`${cmd} ${args.join(' ')}`);
        if (cmd === 'systemctl' && args[1] === 'show') return { code: 0, stderr: '', stdout: `ActiveState=${unit.active}\nSubState=${unit.sub}\nMainPID=4242\nNRestarts=0\nDescription=Claude Code Remote Control server\nExecStart=${execStart}\nWorkingDirectory=${PROJ}\n` };
        if (cmd === 'systemctl' && args[1] === 'stop') { unit = { active: 'inactive', sub: 'dead' }; [101, 102, 104].forEach((p) => alive.delete(p)); return { code: 0, stdout: '', stderr: '' }; }
        if (cmd === 'systemctl' && args[1] === 'start') { unit = { active: 'active', sub: 'running' }; return { code: 0, stdout: '', stderr: '' }; }
        if (cmd !== 'tmux') return { code: 1, stdout: '', stderr: 'unexpected' };
        if (args[0] === '-L') {
            assert.strictEqual(args[1], SOCK, 'own socket only');
            const a = args.slice(2);
            const name = (t) => String(t || '').replace(/^=/, '').replace(/:.*$/, '');
            const ti = a.indexOf('-t'); const si = a.indexOf('-s');
            if (a[0] === 'has-session') return { code: own.has(name(a[ti + 1])) ? 0 : 1, stdout: '', stderr: '' };
            if (a[0] === 'new-session') { const n = a[si + 1]; own.set(n, { cwd: a[a.indexOf('-c') + 1], cmd: a[a.length - 1] }); return { code: 0, stdout: '', stderr: '' }; }
            if (a[0] === 'capture-pane') { const n = name(a[ti + 1]); if (!own.has(n)) return { code: 1, stdout: '', stderr: 'no' }; const q = panes[n] || [ACTIVE('session_01NEWNEWNEWNEWNEWNEWNEWNEW')]; return { code: 0, stdout: q.length > 1 ? q.shift() : q[0], stderr: '' }; }
            if (a[0] === 'send-keys') return { code: 0, stdout: '', stderr: '' };
            if (a[0] === 'kill-session') { const n = name(a[ti + 1]); return { code: own.delete(n) ? 0 : 1, stdout: '', stderr: '' }; }
            return { code: 1, stdout: '', stderr: 'unexpected own tmux' };
        }
        if (args[0] === 'kill-session') {
            const n = String(args[args.indexOf('-t') + 1]).replace(/^=/, '');
            assert.notStrictEqual(n, 'claude-rc-test', 'never kills Remote Control\'s own tmux');
            if (defaultRc.delete(n)) { if (n === 'rc-mobileie') alive.delete(103); return { code: 0, stdout: '', stderr: '' }; }
            return { code: 1, stdout: '', stderr: 'no' };
        }
        if (args[0] === 'capture-pane') return { code: 0, stdout: '·✔︎· Connected · proj · main\n    Capacity: 2/32\n', stderr: '' };
        return { code: 1, stdout: '', stderr: 'unexpected tmux' };
    });

    // Host tab: live Remote Control sessions (Bring over list) + the shared permission line
    let hs = await host.hostStatus(gr);
    assert.deepStrictEqual(hs.sessions.map((x) => x.id).sort(), [S1, S2, S3].sort(), 'live Remote Control sessions only (no dead pid, no terminal)');
    const s3row = hs.sessions.find((x) => x.id === S3);
    assert.strictEqual(s3row.title, 'mobile ie', 'a given name wins');
    assert.strictEqual(s3row.origin, 'rc');
    assert.strictEqual(hs.sessions.find((x) => x.id === S1).title, 'Fix the phone tap menu', 'else the first prompt');
    assert.strictEqual(hs.permissions.mode, 'bypassPermissions');
    assert.strictEqual(hs.permissions.remoteControlMode, 'bypassPermissions', "the unit's --permission-mode");
    assert.strictEqual(hs.permissions.allow, 3);
    assert.strictEqual(hs.permissions.deny, 1);
    assert.strictEqual(hs.permissions.projectAllow, 2);
    assert.strictEqual(hs.permissions.trustedFolders, 2);
    assert.ok(hs.permissions.skipBypassPrompt);
    assert.strictEqual(hs.remoteControl.sessionName, 'Dreamscape');
    noSecrets(hs, 'hostStatus with sessions');
    console.log('✓ Host tab: live Remote Control sessions + shared permission summary');

    // ---- switch B -> A from the phone, bringing over S1 (server child) and S3 (rc- by hand); S2 ends
    log.length = 0;
    await handler.handleSwitch(ctx, {}, { index: 0, carry: [S1, S3, 'not-an-id; rm -rf /'], requestId: 'c1' }, { userType: 'admin' });
    assert.strictEqual(sent.pop().type, 'switch_claude_account_response');
    let st = await host.reconnect(gr, {});
    assert.strictEqual(st.state, 'connected', `connected (${st.message})`);
    assert.strictEqual(hostCreds().claudeAiOauth.accessToken.startsWith('sk-ant-oat01-ACCESS-A'), true, 'A signed in');
    assert.ok(hostCreds().mcpOAuth && hostCreds().mcpOAuth['srv|1'], "the host's other credentials (MCP logins) stay");
    assert.strictEqual(fs.readFileSync(path.join(H, '.claude', 'settings.json'), 'utf8'), settingsText, 'settings.json untouched');
    assert.strictEqual(fs.readFileSync(path.join(PROJ, '.claude', 'settings.local.json'), 'utf8'), localText, 'project allow rules untouched');
    assert.strictEqual(JSON.stringify(hostJson().projects), projectsBefore, "~/.claude.json projects' trust + allowedTools untouched");
    assert.strictEqual(st.permissionsKept, true);
    fs.readdirSync(paths.store).forEach((d) => {
        const f = path.join(paths.store, d, 'credentials.json');
        if (fs.existsSync(f)) assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(f, 'utf8'))), ['claudeAiOauth'], `${d}: linked login holds the login only`);
    });
    assert.ok(log.some((l) => l === 'tmux kill-session -t =rc-mobileie'), 'the rc- session (old login) ended before the switch');
    const started = [...own.entries()];
    assert.deepStrictEqual(started.map(([n]) => n).sort(), [`rc-${S1.slice(0, 8)}`, `rc-${S3.slice(0, 8)}`].sort(), 'only the picked ones start again');
    const c1 = own.get(`rc-${S1.slice(0, 8)}`);
    assert.strictEqual(c1.cwd, PROJ, 'in its own folder');
    assert.ok(c1.cmd.startsWith(`'/opt/fake/claude' --resume ${S1} --fork-session --remote-control 'Fix the phone tap menu' --permission-mode bypassPermissions`), c1.cmd);
    assert.strictEqual(own.get(`rc-${S3.slice(0, 8)}`).cwd, OTHER);
    assert.ok(!log.some((l) => l.includes(S2) && l.includes('--resume')), 'S2 not brought over');
    assert.ok(!log.some((l) => l.includes('rm -rf')), 'a bad id never reaches a command');
    assert.deepStrictEqual(st.carry.results.map((r) => r.state), ['carried', 'carried']);
    assert.ok(st.carry.results.every((r) => r.link === 'https://claude.ai/code/session_01NEWNEWNEWNEWNEWNEWNEWNEW'), 'link read back from the pane');
    assert.deepStrictEqual(st.carry.ending.map((x) => x.id), [S2]);
    assert.ok(/2 of 2 sessions brought over/.test(st.message), st.message);
    assert.ok(log.indexOf('systemctl --user start claude-remote-test.service') < log.findIndex((l) => l.includes('new-session')), 'resumed after Remote Control is back');
    noSecrets(st, 'switch status with carry');
    console.log('✓ switch: picked sessions brought over (fork, own folder, bypassPermissions), the rest end; permissions + trust + MCP logins kept');

    // ---- CardSpace's "Use this account": brings none over
    own.clear();
    alive.add(101); alive.add(102);
    log.length = 0;
    await fakeAkm.applySelectionUpdates([{ service: 'claude', index: 1 }]);
    st = await host.reconnect(gr, {});
    assert.strictEqual(st.state, 'connected');
    assert.strictEqual(own.size, 0, 'CardSpace switch: nothing brought over');
    assert.strictEqual(st.carry.selected.length, 0);
    console.log('✓ CardSpace switch brings none over');

    // ---- the CLI could not reattach: nudged with /remote-control once
    alive.add(101);
    rec(101, S1, PROJ, 'claude-rc-test:@0.%0', 'session_01AAAAAAAAAAAAAAAAAAAAAAAA');
    panes[`rc-${S1.slice(0, 8)}`] = ['Resuming…', 'Previous session is unavailable — run /remote-control to start a new one', ACTIVE('session_01NUDGEDNUDGEDNUDGEDNUDGE')];
    log.length = 0;
    st = await host.reconnect(gr, { index: 1, carry: [S1], pollMs: 5 });
    assert.ok(log.includes(`tmux -L ${SOCK} send-keys -t =rc-${S1.slice(0, 8)}: /remote-control Enter`), 'nudged');
    assert.strictEqual(st.carry.results[0].state, 'carried');
    assert.ok(/reconnected with \/remote-control/.test(st.carry.results[0].message));
    console.log('✓ resume nudges /remote-control when the CLI could not reattach');

    // ---- Sessions tab: every transcript, counts, last prompt, live flags, links
    own.clear();
    alive.clear(); [102, 103, 105].forEach((p) => alive.add(p));
    defaultRc.add('rc-mobileie');
    fs.rmSync(path.join(sdir, '101.json'));
    await handler.handleSessions(ctx, {}, { requestId: 's1' }, { userType: 'user' });
    assert.strictEqual(sent.pop().code, 'INSUFFICIENT_PERMISSIONS');
    await handler.handleSessions(ctx, {}, { requestId: 's2', limit: 50 }, { userType: 'admin' });
    let r = sent.pop();
    assert.strictEqual(r.type, 'get_claude_sessions_response');
    const all = r.data;
    const forked = all.sessions.filter((x) => ![S1, S2, S3, S4, S5, S6].includes(x.id));
    assert.strictEqual(forked.length, 0);
    assert.strictEqual(all.total, 6);
    const row1 = all.sessions.find((x) => x.id === S1);
    assert.strictEqual(row1.messages, 4, 'two prompts + two replies (tool results are not messages)');
    assert.strictEqual(row1.userMessages, 2);
    assert.ok(row1.lastPrompt.startsWith('then ship it'), row1.lastPrompt);
    assert.strictEqual(row1.lastPromptAt, '2026-11-19T11:00:00.000Z');
    assert.strictEqual(row1.folder, 'proj');
    assert.strictEqual(row1.live, false);
    noSecrets(all, 'Sessions list');
    const row2 = all.sessions.find((x) => x.id === S2);
    assert.ok(row2.live && row2.remoteControl && row2.origin === 'server');
    assert.strictEqual(row2.link, 'https://claude.ai/code/session_01BBBBBBBBBBBBBBBBBBBBBBBB');
    assert.strictEqual(row2.canDisconnect, false, "Remote Control's own children are not disconnected from here");
    const row3 = all.sessions.find((x) => x.id === S3);
    assert.ok(row3.remoteControl && row3.canDisconnect && row3.tmuxSession === 'rc-mobileie');
    const row5 = all.sessions.find((x) => x.id === S5);
    assert.ok(row5.live && !row5.remoteControl);
    const page = await sessions.listAll({ limit: 2 });
    assert.strictEqual(page.sessions.length, 2);
    assert.strictEqual(page.total, 6);
    console.log('✓ Sessions tab list: all transcripts, counts, last prompt + time, live / Remote Control / link');

    // Reconnect a session that is not running: no fork, own socket, its folder, the link read back
    log.length = 0;
    await handler.handleSessionAction(ctx, {}, { action: 'reconnect', id: S6, requestId: 'a1' }, { userType: 'admin' });
    r = sent.pop();
    assert.strictEqual(r.type, 'claude_session_action_response', JSON.stringify(r));
    assert.strictEqual(r.data.result.state, 'connected');
    assert.strictEqual(r.data.result.link, 'https://claude.ai/code/session_01NEWNEWNEWNEWNEWNEWNEWNEW');
    const c6 = own.get(`rc-${S6.slice(0, 8)}`);
    assert.ok(c6 && c6.cmd.startsWith(`'/opt/fake/claude' --resume ${S6} --remote-control 'Idle, not running' --permission-mode bypassPermissions; sleep 3600`), c6 && c6.cmd);
    assert.ok(!c6.cmd.includes('--fork-session'), 'Reconnect does not fork');
    // already live in Remote Control: its link, no second copy
    const before = own.size;
    const live = await sessions.resume(S3, { mode: 'bypassPermissions' });
    assert.strictEqual(live.state, 'live');
    assert.strictEqual(live.link, 'https://claude.ai/code/session_01CCCCCCCCCCCCCCCCCCCCCCCC');
    assert.strictEqual(own.size, before, 'no second copy');
    // running in a terminal without Remote Control: refused, nothing started
    await assert.rejects(() => sessions.resume(S5, {}), /running already/);
    await assert.rejects(() => sessions.resume('../../etc', {}), /No such Claude session/);
    // Disconnect: rc- on the own socket, an rc- started by hand on the default socket; never Remote Control's own
    rec(106, S6, PROJ, `rc-${S6.slice(0, 8)}:@0.%0`, 'session_01NEWNEWNEWNEWNEWNEWNEWNEW');
    alive.add(106);
    let d = await sessions.disconnect(S6);
    assert.strictEqual(d.state, 'disconnected');
    assert.ok(!own.has(`rc-${S6.slice(0, 8)}`));
    await handler.handleSessionAction(ctx, {}, { action: 'disconnect', id: S3, requestId: 'a2' }, { userType: 'admin' });
    r = sent.pop();
    assert.strictEqual(r.data.result.tmuxSession, 'rc-mobileie');
    assert.ok(!defaultRc.has('rc-mobileie'));
    await assert.rejects(() => sessions.disconnect(S2), /inside Remote Control itself/);
    // read-only instance: no resume / disconnect
    process.env.DREAMSCAPE_CLAUDE_RC_READONLY = '1';
    await assert.rejects(() => sessions.resume(S4, {}), /read-only/);
    delete process.env.DREAMSCAPE_CLAUDE_RC_READONLY;
    console.log('✓ Sessions tab: Reconnect (no fork, link back, live = link only), Disconnect rc- only');

    // Add Account's isolated sign-in links the login only (no settings / permission state from its config dir)
    host.linkLogin(gr, 1, { claudeAiOauth: login(ACCESS_B, 'b@example.com', 'uuid-b', 'pro').creds.claudeAiOauth, mcpOAuth: { x: 1 } }, login(ACCESS_B, 'b@example.com', 'uuid-b', 'pro').oauthAccount);
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(path.join(dirB, 'credentials.json'), 'utf8'))), ['claudeAiOauth']);
    const ui = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmClaudeAccounts.js'), 'utf8');
    assert.ok(ui.includes("'get_claude_sessions'") && ui.includes("'claude_session_action'") && ui.includes('data-tab="sessions"') && ui.includes('Bring over') && ui.includes('Permissions (shared by every account)'), 'phone UI wired');
    assert.ok(fs.readFileSync(path.join(ROOT, 'modules/websocketHandlers.js'), 'utf8').includes("'claude_session_action'"), 'claude_session_action is destructive for read-only clients');
    host._setPidAlive(null);
    console.log('✓ linked logins hold the login only; UI wiring');
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
