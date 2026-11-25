'use strict';

// Claude Accounts on the desktop: transcripts (modules/claudeTranscript.js), parallel accounts
// (claudeAccountRuntime.js), launching / steering (claudeSessionLauncher.js), the coordination store and
// MCP server (modules/agentCoord/), and 314-claudeDeskHandler. Sandboxed: a temp home for ~/.claude, a
// temp account store, a temp coordination DB and a fake tmux / systemd-run runner, so no real account
// folder, login, tmux server or session is touched.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-claude-desk-test-'));
const HOME = path.join(SANDBOX, 'home');
process.env.DREAMSCAPE_CLAUDE_HOME = HOME;
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = path.join(SANDBOX, 'store');
process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET = 'ds-claude-desk-test';
process.env.DREAMSCAPE_CLAUDE_DESK_STATE = path.join(SANDBOX, 'state');
process.env.DREAMSCAPE_CLAUDE_CLI = '/opt/test/claude';
process.env.DREAMSCAPE_CLAUDE_COORD_MCP = '0'; // agent-coord via --mcp-config here (user-scope registration runs the CLI)
process.env.AGENT_COORD_DB = path.join(SANDBOX, 'coord', 'coord.db');
process.env.DREAMSCAPE_CLAUDE_RC_UNIT = 'claude-remote-test.service';
process.env.DREAMSCAPE_CLAUDE_RC_TMUX = 'claude-rc-test';
delete process.env.DREAMSCAPE_CLAUDE_RC_READONLY;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) { /* gone */ } });

const host = require('../modules/claudeAccountHost');
const transcript = require('../modules/claudeTranscript');
const runtime = require('../modules/claudeAccountRuntime');
const launcher = require('../modules/claudeSessionLauncher');
const claudeSessions = require('../modules/claudeSessions');
const store = require('../modules/agentCoord/store');

assert.ok(host._paths().store.startsWith(SANDBOX) && host._paths().credentials.startsWith(SANDBOX), 'test must stay in its sandbox');
assert.ok(store.dbPath().startsWith(SANDBOX), 'coordination DB must be the temp one');

const ACCESS_A = 'sk-ant-oat01-ACCESS-A-1111111111111111111111';
const ACCESS_B = 'sk-ant-oat01-ACCESS-B-3333333333333333333333';
const ACCESS_B2 = 'sk-ant-oat01-ACCESS-B-4444444444444444444444';
const KEY_A = 'sk-ant-oat01-ENGINE-A-aaaaaaaaaaaaaaaaaaaaaaaa';
const KEY_B = 'sk-ant-oat01-ENGINE-B-bbbbbbbbbbbbbbbbbbbbbbbb';
const UUID_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const UUID_B = 'bbbbbbbb-0000-4000-8000-000000000002';

function login(access, email, uuid, expiresAt) {
    return {
        creds: { claudeAiOauth: { accessToken: access, refreshToken: `${access}-r`, expiresAt: expiresAt || 1795115747356, scopes: ['user:inference', 'user:sessions:claude_code'], subscriptionType: 'max' } },
        oauthAccount: { emailAddress: email, accountUuid: uuid, displayName: email.split('@')[0] }
    };
}
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value)); };

// ---- a fake host: ~/.claude with settings, a project trust entry, and account A signed in
write(path.join(HOME, '.claude', 'settings.json'), { skipDangerousModePermissionPrompt: true });
write(path.join(HOME, '.claude', 'CLAUDE.md'), '# test');
fs.mkdirSync(path.join(HOME, '.claude', 'projects'), { recursive: true });
fs.mkdirSync(path.join(HOME, '.claude', 'sessions'), { recursive: true });
fs.mkdirSync(path.join(HOME, 'repo'), { recursive: true });
const A = login(ACCESS_A, 'a@example.com', UUID_A);
write(host._paths().credentials, A.creds);
write(host._paths().claudeJson, { hasCompletedOnboarding: true, oauthAccount: A.oauthAccount, userID: 'host-user', projects: { [path.join(HOME, 'repo')]: { hasTrustDialogAccepted: true, allowedTools: ['Bash'], lastCost: 3 } } });

const keys = [{ name: 'Claude Max', apiKey: KEY_A }, { name: 'Claude Work', apiKey: KEY_B }];
const fakeAkm = {
    getServiceKeys: (s) => (s === 'claude' ? keys : []),
    getSelectedIndex: () => 0,
    keyFingerprint: (s, k) => `${k.apiKey.slice(0, 8)}...`,
    async applySelectionUpdates() { return { updated: [] }; }
};
const gr = { getApiKeyManager: () => fakeAkm, getWebSocketServer: () => ({ broadcast() {} }) };

// ---- a fake tmux / systemd-run
const calls = [];
let panes = []; // [{ pane, pid }]
let paneText = 'Remote Control is active. Continue at https://claude.ai/code/session_01TESTabcdefgh';
let sessionsUp = new Set();
launcher._setRunner(async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'systemd-run') return { code: 0, stdout: '', stderr: '' };
    if (cmd !== 'tmux') return { code: 1, stdout: '', stderr: 'unexpected' };
    const a = args[0] === '-L' ? args.slice(2) : args;
    if (a[0] === 'show') return { code: calls.some((c) => c[0] === 'systemd-run') ? 0 : 1, stdout: 'exit-empty off', stderr: '' };
    if (a[0] === 'set' || a[0] === 'start-server' || a[0] === 'send-keys' || a[0] === 'set-buffer' || a[0] === 'paste-buffer' || a[0] === 'list-sessions') return { code: 0, stdout: '', stderr: '' };
    if (a[0] === 'has-session') return { code: sessionsUp.has(a[2].replace(/^=/, '')) ? 0 : 1, stdout: '', stderr: '' };
    if (a[0] === 'new-session') { sessionsUp.add(a[a.indexOf('-s') + 1]); return { code: 0, stdout: '', stderr: '' }; }
    if (a[0] === 'kill-session') { sessionsUp.delete(a[2].replace(/^=/, '')); return { code: 0, stdout: '', stderr: '' }; }
    if (a[0] === 'capture-pane') return { code: 0, stdout: paneText, stderr: '' };
    if (a[0] === 'list-panes') return { code: 0, stdout: panes.map((p) => `${p.pane} ${p.pid}`).join('\n'), stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected tmux' };
});
claudeSessions._setPidAlive((pid) => pid === process.pid);
store._setPidAlive((pid) => pid === process.pid || pid === 4242);

function sessionLines(id, cwd, owner) {
    return [
        { type: 'session-owner', accountUuid: owner, sessionId: id },
        { type: 'user', uuid: 'u1', timestamp: '2026-11-19T10:00:00.000Z', cwd, sessionId: id, message: { role: 'user', content: 'Build the desktop app please' } },
        { type: 'assistant', uuid: 'a1', timestamp: '2026-11-19T10:00:05.000Z', message: { role: 'assistant', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: 'secret thoughts' }, { type: 'text', text: 'On it.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls', description: 'List files' } }] } },
        { type: 'user', uuid: 'u2', timestamp: '2026-11-19T10:00:06.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: `a.js\nb.js\ntoken ${ACCESS_B}` }] } },
        { type: 'user', uuid: 'u3', timestamp: '2026-11-19T10:00:07.000Z', isMeta: true, message: { role: 'user', content: 'meta only' } },
        { type: 'user', uuid: 'u4', timestamp: '2026-11-19T10:00:08.000Z', message: { role: 'user', content: '<command-name>/clear</command-name><command-args></command-args>' } },
        { type: 'attachment', uuid: 'x1', attachment: { type: 'environment' } },
        { type: 'custom-title', customTitle: 'Desktop app', sessionId: id }
    ].map((o) => JSON.stringify(o)).join('\n') + '\n';
}

async function rpc(child, msg) {
    return new Promise((resolve, reject) => {
        let buf = '';
        const onData = (d) => {
            buf += d;
            const i = buf.indexOf('\n');
            if (i < 0) return;
            child.stdout.off('data', onData);
            try { resolve(JSON.parse(buf.slice(0, i))); } catch (e) { reject(e); }
        };
        child.stdout.on('data', onData);
        child.stdin.write(`${JSON.stringify(msg)}\n`);
    });
}

async function main() {
    // 1. transcript: chat messages only, tokens masked, thinking / meta / attachments left out, paging
    const SID = '11111111-2222-4333-8444-555555555555';
    const projDir = path.join(HOME, '.claude', 'projects', '-repo');
    const file = path.join(projDir, `${SID}.jsonl`);
    write(file, sessionLines(SID, path.join(HOME, 'repo'), UUID_B));
    const page = await transcript.readPage(file, { limit: 50 });
    assert.deepStrictEqual(page.messages.map((m) => `${m.role}:${m.kind}`), ['user:text', 'assistant:text', 'assistant:tool_use', 'tool:tool_result', 'user:command']);
    assert.ok(!JSON.stringify(page).includes('secret thoughts'), 'thinking is left out');
    assert.ok(!JSON.stringify(page).includes(ACCESS_B), 'a token in a tool result is masked');
    assert.ok(page.messages[2].text.includes('$ ls'), 'a tool call shows its command');
    assert.strictEqual(page.more, false);
    const two = await transcript.readPage(file, { limit: 2 });
    assert.deepStrictEqual(two.messages.map((m) => m.kind), ['tool_result', 'command']);
    const earlier = await transcript.readPage(file, { before: two.start, limit: 50 });
    assert.deepStrictEqual(earlier.messages.map((m) => m.kind), ['text', 'text', 'tool_use']);
    fs.appendFileSync(file, `${JSON.stringify({ type: 'assistant', uuid: 'a2', message: { role: 'assistant', content: [{ type: 'text', text: 'Done.' }] } })}\n{"type":"assistant","partial`);
    const since = await transcript.readSince(file, page.end);
    assert.deepStrictEqual(since.messages.map((m) => m.text), ['Done.']);
    assert.ok(since.end < fs.statSync(file).size, 'a line still being written is left for the next read');
    console.log('ok 1 transcript');

    // 2. parallel accounts: B gets its own config dir, A (on the host) none
    host.linkLogin(gr, 0, A.creds, A.oauthAccount);
    const B = login(ACCESS_B, 'b@example.com', UUID_B, 1795115747356);
    host.linkLogin(gr, 1, B.creds, B.oauthAccount);
    assert.strictEqual(await runtime.configFor(gr, 0), null, 'the account on the host uses the host login');
    assert.strictEqual(await runtime.configFor(gr, 'host'), null);
    runtime.bind(gr);
    const cfg = await runtime.configFor(gr, 1);
    assert.ok(cfg && cfg.dir.startsWith(SANDBOX), 'config dir in the sandbox store');
    assert.strictEqual((fs.statSync(cfg.dir).mode & 0o777), 0o700);
    const cdCreds = JSON.parse(fs.readFileSync(path.join(cfg.dir, '.credentials.json'), 'utf8'));
    assert.strictEqual(cdCreds.claudeAiOauth.accessToken, ACCESS_B);
    assert.strictEqual((fs.statSync(path.join(cfg.dir, '.credentials.json')).mode & 0o777), 0o600);
    assert.strictEqual(fs.readlinkSync(path.join(cfg.dir, 'projects')), path.join(HOME, '.claude', 'projects'), 'transcripts are shared');
    assert.strictEqual(fs.readlinkSync(path.join(cfg.dir, 'sessions')), path.join(HOME, '.claude', 'sessions'), 'live records are shared');
    assert.ok(!fs.existsSync(path.join(cfg.dir, 'skills')), 'nothing on the host to share: no dangling link');
    const cj = JSON.parse(fs.readFileSync(path.join(cfg.dir, '.claude.json'), 'utf8'));
    assert.strictEqual(cj.oauthAccount.emailAddress, 'b@example.com');
    assert.strictEqual(cj.projects[path.join(HOME, 'repo')].hasTrustDialogAccepted, true);
    assert.ok(!('lastCost' in cj.projects[path.join(HOME, 'repo')]) && !cj.userID, 'only trust / tools / MCP keys come over');
    // the CLI rotates B's login in its config dir: it goes back into B's linked login
    write(path.join(cfg.dir, '.credentials.json'), login(ACCESS_B2, 'b@example.com', UUID_B, 1795119999999).creds);
    assert.strictEqual(await runtime.syncBack(cfg.id), true);
    const linkedB = JSON.parse(fs.readFileSync(path.join(host.storeDir(), cfg.id, 'credentials.json'), 'utf8'));
    assert.strictEqual(linkedB.claudeAiOauth.accessToken, ACCESS_B2, 'the rotated login is copied back');
    assert.strictEqual(await runtime.syncBack(cfg.id), false, 'nothing newer: no write');
    // an older copy in the config dir never wins over a fresher linked login
    write(path.join(cfg.dir, '.credentials.json'), B.creds);
    await runtime.prepare(cfg.id);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(cfg.dir, '.credentials.json'), 'utf8')).claudeAiOauth.accessToken, ACCESS_B2);
    runtime.stopAll();
    console.log('ok 2 account runtime');

    // 3. launching: a new session on account B in the carry socket, in a user scope, with RC + agent-coord
    const started = await launcher.start(gr, { cwd: path.join(HOME, 'repo'), prompt: 'Do the thing', account: 1, pollMs: 5, timeoutMs: 500 });
    assert.strictEqual(started.state, 'connected');
    assert.strictEqual(started.link, 'https://claude.ai/code/session_01TESTabcdefgh');
    assert.ok(claudeSessions.SESSION_ID_RE.test(started.id));
    assert.strictEqual(started.tmuxSession, `rc-${started.id.slice(0, 8)}`);
    const sr = calls.find((c) => c[0] === 'systemd-run');
    assert.ok(sr && sr.includes('--user') && sr.includes('--scope') && sr.includes('ds-claude-desk-test') && sr.includes('exit-empty'), 'the tmux server starts in a user scope with exit-empty off');
    const ns = calls.find((c) => c[0] === 'tmux' && c.includes('new-session'));
    assert.ok(ns[1] === '-L' && ns[2] === 'ds-claude-desk-test', 'own socket, never the default one');
    const cmd = ns[ns.length - 1];
    assert.ok(cmd.includes(`--session-id ${started.id}`) && cmd.includes('--remote-control') && cmd.includes('--permission-mode bypassPermissions') && cmd.includes('--mcp-config'), cmd);
    assert.ok(cmd.includes(`CLAUDE_CONFIG_DIR='${cfg.dir}'`), 'account B runs in its config dir');
    assert.ok(cmd.includes('-u ANTHROPIC_API_KEY') && cmd.includes('-u CLAUDE_CODE_OAUTH_TOKEN'), 'API keys never reach a session');
    assert.ok(/sleep 3600$/.test(cmd));
    assert.ok(!cmd.includes(ACCESS_B) && !cmd.includes(ACCESS_B2), 'no token on the command line');
    const mcp = JSON.parse(fs.readFileSync(path.join(SANDBOX, 'state', 'launch-mcp.json'), 'utf8'));
    assert.ok(mcp.mcpServers['agent-coord'].args[0].endsWith(path.join('modules', 'agentCoord', 'mcpServer.js')));
    const ag = store.getAgent(`claude-${started.id.slice(0, 8)}`);
    assert.ok(ag && ag.account === 'Claude Work' && ag.sessionId === started.id, 'the launch is in the coordination store with its account');
    // on the host account: no CLAUDE_CONFIG_DIR
    calls.length = 0;
    await launcher.start(gr, { cwd: path.join(HOME, 'repo'), account: 0, pollMs: 5, timeoutMs: 200 });
    const ns2 = calls.find((c) => c[0] === 'tmux' && c.includes('new-session'));
    assert.ok(!ns2[ns2.length - 1].includes('CLAUDE_CONFIG_DIR='), 'the host account runs on the host login');
    await assert.rejects(() => launcher.start(gr, { cwd: path.join(HOME, 'nope') }), /not on the host/);
    // a resume that fails says why and leaves nothing running
    paneText = 'No conversation found with session ID';
    write(path.join(projDir, '22222222-2222-4333-8444-555555555555.jsonl'), sessionLines('22222222-2222-4333-8444-555555555555', path.join(HOME, 'repo'), UUID_A));
    const failed = await launcher.resume(gr, '22222222-2222-4333-8444-555555555555', { pollMs: 5, timeoutMs: 200 });
    assert.strictEqual(failed.state, 'failed');
    assert.ok(!sessionsUp.has('rc-22222222'));
    const rcmd = calls.filter((c) => c[0] === 'tmux' && c.includes('new-session')).pop();
    assert.ok(rcmd[rcmd.length - 1].includes('--resume 22222222-2222-4333-8444-555555555555') && !rcmd[rcmd.length - 1].includes('--fork-session'), 'resume, no fork');
    paneText = 'Remote Control is active.';
    console.log('ok 3 launcher');

    // 4. steering: typed into the session's own pane; multi-line as one paste
    write(path.join(HOME, '.claude', 'sessions', `${process.pid}.json`), { pid: process.pid, sessionId: SID, cwd: path.join(HOME, 'repo'), status: 'busy', tmux: 'rc-11111111:@1.%7', bridgeSessionId: 'session_01TESTabcdefgh' });
    panes = [{ pane: '%7', pid: process.pid }];
    calls.length = 0;
    const st = await launcher.steer(SID, 'Stop and run the tests');
    assert.strictEqual(st.sent, true);
    assert.ok(calls.some((c) => c.includes('send-keys') && c.includes('-l') && c.includes('Stop and run the tests') && c.includes('%7')));
    assert.ok(calls.some((c) => c.includes('send-keys') && c[c.length - 1] === 'Enter'));
    calls.length = 0;
    await launcher.steer(SID, 'line one\nline two');
    assert.ok(calls.some((c) => c.includes('set-buffer')) && calls.some((c) => c.includes('paste-buffer') && c.includes('-p')), 'bracketed paste');
    await assert.rejects(() => launcher.steer(SID, '   '), /Nothing to send/);
    await assert.rejects(() => launcher.steer('33333333-2222-4333-8444-555555555555', 'hi'), /not running/);
    const live = await launcher.resume(gr, SID, {});
    assert.strictEqual(live.state, 'live', 'a live Remote Control session is not started twice');
    console.log('ok 4 steering');

    // 4b. attachments: saved per session (0600), names cleaned, only images / text, size limit
    {
        process.env.DREAMSCAPE_CLAUDE_DESK_ATTACHMENTS = path.join(SANDBOX, 'attachments');
        const att = require('../modules/claudeDeskAttachments');
        const a = att.save(SID, { name: '../../evil name.png', mimeType: 'image/png', bytes: Buffer.from([137, 80, 78, 71]) });
        assert.ok(a.path.startsWith(path.join(SANDBOX, 'attachments', SID) + path.sep) && /^\d+-evil name\.png$/.test(path.basename(a.path)), 'saved under the session folder with a clean name');
        assert.strictEqual(fs.statSync(a.path).mode & 0o777, 0o600, 'attachment is 0600');
        assert.throws(() => att.save(SID, { name: 'x.exe', mimeType: 'application/octet-stream', bytes: Buffer.from('MZ') }), /images and text/);
        assert.throws(() => att.save(SID, { name: 'big.txt', mimeType: 'text/plain', bytes: Buffer.alloc(att.MAX_BYTES + 1) }), /too large/);
        assert.throws(() => att.save('../x', { name: 'a.txt', mimeType: 'text/plain', bytes: Buffer.from('a') }), /session id/);
        console.log('ok 4b attachments');
    }

    // 5. coordination store: claims, conflicts, globs, shared, leases, inbox
    store.upsertAgent({ id: 'claude-aaaa', kind: 'claude', name: 'Desk worker', repo: 'staticforge', task: 'desktop app', pid: process.pid });
    store.upsertAgent({ id: 'claude-bbbb', kind: 'claude', name: 'Mobile worker', repo: 'staticforge', task: 'mobile tab', pid: 4242 });
    let c = store.claim('claude-aaaa', 'staticforge', ['modules/claudeAccountHost.js', 'apps/claudedesk/']);
    assert.strictEqual(c.granted.length, 2);
    c = store.claim('claude-bbbb', 'staticforge', ['modules/claudeAccountHost.js', 'public/scripts/comp/wmClaudeAccounts.js', 'apps/claudedesk/client/x.js', 'modules/*.js']);
    assert.deepStrictEqual(c.granted.map((g) => g.path), ['public/scripts/comp/wmClaudeAccounts.js']);
    assert.strictEqual(new Set(c.conflicts.map((x) => x.path)).size, 3, 'same file, a file in a claimed folder, a glob over a claimed file');
    assert.ok(c.conflicts.every((x) => x.holder === 'Desk worker'));
    assert.strictEqual(store.claim('claude-aaaa', 'staticforge', ['docs/a.md'], { mode: 'shared' }).granted.length, 1);
    assert.strictEqual(store.claim('claude-bbbb', 'staticforge', ['docs/a.md'], { mode: 'shared' }).granted.length, 1, 'shared + shared');
    assert.strictEqual(store.claim('claude-bbbb', 'otherrepo', ['modules/claudeAccountHost.js']).granted.length, 1, 'claims are per repo');
    assert.ok(store.overlaps('public/css/*.css', 'public/css/a.css') && !store.overlaps('public/css/*.css', 'public/css/sub/a.css') && store.overlaps('public/**', 'public/css/sub/a.css'));
    assert.ok(store.overlaps('public/css/*.css', 'public') && !store.overlaps('src/a', 'src/ab'));
    assert.strictEqual(store.normPath('/w/t/apps/x/', '/w/t'), 'apps/x');
    assert.strictEqual(store.check('staticforge', ['modules/claudeAccountHost.js'])[0].heldBy[0].agentId, 'claude-aaaa');
    // the holder's process ends: its claims lapse
    store._setPidAlive((pid) => pid === 4242);
    assert.ok(!store.liveClaims().some((x) => x.agentId === 'claude-aaaa'), 'a gone agent holds nothing');
    assert.strictEqual(store.claim('claude-bbbb', 'staticforge', ['modules/claudeAccountHost.js']).granted.length, 1);
    store._setPidAlive((pid) => pid === process.pid || pid === 4242);
    // messages: to one, to all, inbox cursor, steer
    store.upsertAgent({ id: 'claude-cccc', kind: 'claude', name: 'Third', pid: process.pid });
    store.post('claude-bbbb', 'Third', 'Please stay off modules/claudeAccountHost.js', { kind: 'steer' });
    store.post('claude-bbbb', 'all', 'Rebasing main in 5 min');
    assert.strictEqual(store.unreadCount('claude-cccc'), 2);
    assert.strictEqual(store.unreadCount('claude-bbbb'), 0, 'own posts are not unread');
    const peek = store.inbox('claude-cccc', { peek: true });
    assert.strictEqual(peek.length, 2);
    assert.strictEqual(store.unreadCount('claude-cccc'), 2, 'peek keeps them unread');
    const got = store.inbox('claude-cccc');
    assert.deepStrictEqual(got.map((m) => m.kind), ['steer', 'note']);
    assert.strictEqual(store.unreadCount('claude-cccc'), 0);
    assert.throws(() => store.post('claude-bbbb', 'nobody-here', 'x'), /No agent/);
    store.setStatus('claude-bbbb', 'done');
    assert.ok(!store.liveClaims().some((x) => x.agentId === 'claude-bbbb'), 'done releases claims');
    console.log('ok 5 coordination store');

    // 6. the MCP server over stdio: initialize, tools, a claim conflict, unread hint
    store.close();
    const child = spawn(process.execPath, [path.join(__dirname, '..', 'modules', 'agentCoord', 'mcpServer.js')], {
        env: Object.assign({}, process.env, { AGENT_COORD_ID: 'cursor-test', AGENT_COORD_KIND: 'cursor', AGENT_COORD_NAME: 'Cursor test', AGENT_COORD_CWD: SANDBOX }),
        stdio: ['pipe', 'pipe', 'inherit']
    });
    child.stdout.setEncoding('utf8');
    try {
        const init = await rpc(child, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } });
        assert.strictEqual(init.result.serverInfo.name, 'agent-coord');
        assert.ok(/coord_claim/.test(init.result.instructions));
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        const list = await rpc(child, { jsonrpc: '2.0', id: 2, method: 'tools/list' });
        { const names = list.result.tools.map((t) => t.name); ['coord_agents', 'coord_build_begin', 'coord_build_end', 'coord_build_ready', 'coord_build_request', 'coord_build_status', 'coord_builds', 'coord_check', 'coord_claim', 'coord_claims', 'coord_editors', 'coord_hello', 'coord_inbox', 'coord_inspect', 'coord_locks', 'coord_pause_agent', 'coord_post', 'coord_release', 'coord_request_work', 'coord_resume_agent', 'coord_set_task', 'coord_supervisor_check'].forEach((n) => assert.ok(names.includes(n), `missing tool ${n}`)); }
        const hello = await rpc(child, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'coord_hello', arguments: { task: 'testing the MCP' } } });
        assert.ok(JSON.parse(hello.result.content[0].text).you.id === 'cursor-test');
        // Third claims a file; the Cursor agent's claim on it conflicts
        store.claim('claude-cccc', 'staticforge', ['modules/claudeSessions.js']);
        store.post('claude-cccc', 'cursor-test', 'hello cursor');
        store.close();
        const cl = await rpc(child, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'coord_claim', arguments: { paths: ['modules/claudeSessions.js', 'modules/new.js'], repo: 'staticforge' } } });
        const out = JSON.parse(cl.result.content[0].text.split('\n\nYou have')[0]);
        assert.deepStrictEqual(out.granted.map((g) => g.path), ['modules/new.js']);
        assert.strictEqual(out.conflicts[0].holder, 'Third');
        assert.ok(/You have 1 unread message/.test(cl.result.content[0].text), 'answers carry the unread count');
        const inb = await rpc(child, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'coord_inbox', arguments: {} } });
        assert.strictEqual(JSON.parse(inb.result.content[0].text).messages[0].body, 'hello cursor');
        const bad = await rpc(child, { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'coord_post', arguments: { to: 'ghost', body: 'x' } } });
        assert.strictEqual(bad.result.isError, true);
        const nf = await rpc(child, { jsonrpc: '2.0', id: 7, method: 'nope' });
        assert.strictEqual(nf.error.code, -32601);
    } finally {
        child.stdin.end();
        child.kill();
    }
    console.log('ok 6 MCP server');

    // 7. the desktop handler: the session list says which account each session is on; admin only
    const desk = require('../modules/ws/handlers/314-claudeDeskHandler');
    const page2 = await desk._sessionsPage(gr, { limit: 10 });
    const row = page2.sessions.find((r) => r.id === SID);
    assert.ok(row && row.account && row.account.name === 'Claude Work', 'session-owner maps to the linked account');
    assert.strictEqual(row.live, true);
    const sent = [];
    const errors = [];
    const ctx = { globalResources: gr, sendToClient: (ws, m) => sent.push(m), sendError: (ws, msg, code) => errors.push(code) };
    await desk._handlers.handleSessions(ctx, {}, { requestId: 'r1' }, { userType: 'user' });
    assert.deepStrictEqual(errors, ['INSUFFICIENT_PERMISSIONS']);
    await desk._handlers.handleTranscript(ctx, {}, { requestId: 'r2', id: SID, limit: 10 }, { userType: 'admin' });
    assert.strictEqual(sent[0].type, 'claude_desk_transcript_response');
    assert.ok(sent[0].data.messages.length >= 5);
    assert.ok(!JSON.stringify(sent).includes(ACCESS_B), 'no token in any answer');
    await desk._handlers.handleCoord(ctx, {}, { requestId: 'r3', action: 'post', to: 'Third', body: 'from the desk', kind: 'note' }, { userType: 'admin', username: 'yukimi' });
    assert.strictEqual(sent[1].data.sent.from, 'desk-yukimi');
    console.log('ok 7 desktop handler');

    // 8. background agents of running sessions: the list builder reads a temp subagents folder
    const own = path.join(SANDBOX, 'agents-session');
    const subs = path.join(own, 'subagents');
    fs.mkdirSync(subs, { recursive: true });
    const line = (o) => `${JSON.stringify(o)}\n`;
    const t0 = Date.now();
    fs.writeFileSync(path.join(subs, 'agent-a1111111111111111.meta.json'), JSON.stringify({ agentType: 'Explore', description: 'Find the thing', requestShape: 'background' }));
    fs.writeFileSync(path.join(subs, 'agent-a1111111111111111.jsonl'), line({ type: 'user', message: { role: 'user', content: 'go' } }) + line({ type: 'assistant', message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'text', text: 'ok' }] } }));
    fs.writeFileSync(path.join(subs, 'agent-a2222222222222222.meta.json'), JSON.stringify({ description: 'Old job', finished: true, model: 'haiku' }));
    fs.writeFileSync(path.join(subs, 'agent-a2222222222222222.jsonl'), line({ type: 'user', message: { role: 'user', content: 'x' } }));
    fs.writeFileSync(path.join(subs, 'agent-a3333333333333333.meta.json'), JSON.stringify({ description: 'Stuck job' }));
    fs.writeFileSync(path.join(subs, 'agent-a3333333333333333.jsonl'), line({ type: 'user', message: { role: 'user', content: 'y' } }));
    fs.writeFileSync(path.join(subs, 'notes.txt'), 'not an agent');
    const sessions = [{ id: SID, title: 'Test session', own }, { id: '00000000-0000-4000-8000-000000000000', title: 'No agents', own: path.join(SANDBOX, 'nowhere') }];
    let agents = await desk._buildAgentsList(sessions, { now: t0 });
    assert.deepStrictEqual(agents.map((r) => r.state), ['running', 'running', 'finished']);
    assert.strictEqual(agents[2].agentId, 'a2222222222222222');
    const first = agents.find((r) => r.agentId === 'a1111111111111111');
    assert.strictEqual(first.messages, 2);
    assert.strictEqual(first.model, 'claude-sonnet-5-5');
    assert.strictEqual(first.sessionTitle, 'Test session');
    assert.strictEqual(first.background, true);
    assert.strictEqual(agents.find((r) => r.agentId === 'a2222222222222222').model, 'haiku');
    // quiet for longer than the idle limit: Idle; a finished one older than the keep time drops out; running sort first
    agents = await desk._buildAgentsList(sessions, { now: t0 + 21 * 60 * 1000 });
    assert.ok(agents.every((r) => r.state !== 'running') && agents.some((r) => r.state === 'idle'));
    agents = await desk._buildAgentsList(sessions, { now: t0 + 25 * 3600 * 1000 });
    assert.ok(!agents.some((r) => r.state === 'finished'), 'finished agents drop from the list after a day');
    // lines appended later are counted without reading the file again from the start
    fs.appendFileSync(path.join(subs, 'agent-a1111111111111111.jsonl'), line({ type: 'user', message: { role: 'user', content: 'more' } }));
    agents = await desk._buildAgentsList(sessions, { now: Date.now() });
    assert.strictEqual(agents.find((r) => r.agentId === 'a1111111111111111').messages, 3);
    console.log('ok 8 background agents list');

    // 9: the insight builder (claudeInsight.js) and the hidden-run summary rows / steering rows of claudeTranscript
    {
        const ins = require('../modules/claudeInsight');
        const J = (o) => `${JSON.stringify(o)}\n`;
        const u = (n) => ({ n });
        void u;
        const fx = [
            { type: 'user', uuid: 'u1', timestamp: '2026-11-24T10:00:00.000Z', permissionMode: 'auto', cwd: '/w', gitBranch: 'main', message: { role: 'user', content: 'do it' } },
            { type: 'assistant', uuid: 'a1', timestamp: '2026-11-24T10:00:05.000Z', effort: 'high', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 }, content: [{ type: 'thinking', thinking: 'hmm' }] } },
            { type: 'assistant', uuid: 'a2', timestamp: '2026-11-24T10:00:06.000Z', effort: 'high', message: { id: 'm1', model: 'claude-opus-5-5', usage: { input_tokens: 2, output_tokens: 10, cache_read_input_tokens: 1000, cache_creation_input_tokens: 500 }, content: [{ type: 'tool_use', id: 't1', name: 'Edit', input: { file_path: '/w/a.js', old_string: 'x', new_string: 'y' } }, { type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }, { type: 'tool_use', id: 't3', name: 'Agent', input: { description: 'audit', run_in_background: true } }] } },
            { type: 'user', uuid: 'r1', timestamp: '2026-11-24T10:00:07.000Z', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }, { type: 'tool_result', tool_use_id: 't2', content: 'ok' }] } },
            { type: 'attachment', uuid: 'q1', timestamp: '2026-11-24T10:00:08.000Z', attachment: { type: 'queued_command', prompt: 'please also lint', commandMode: 'prompt', origin: { kind: 'human' } } },
            { type: 'assistant', uuid: 'a3', timestamp: '2026-11-24T10:00:09.000Z', message: { id: 'm2', model: 'claude-sonnet-5-5', stop_reason: 'end_turn', usage: { input_tokens: 3, output_tokens: 20, cache_read_input_tokens: 2000, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: 'done' }] } },
            { type: 'cost-state', totalCostUSD: 1.5 }
        ];
        const file = path.join(SANDBOX, 'insight-fixture.jsonl');
        fs.writeFileSync(file, fx.map(J).join(''));
        const r = await ins.insightOf(file);
        assert.strictEqual(r.model, 'claude-sonnet-5-5');
        assert.strictEqual(r.models.length, 2, 'a model switch is recorded');
        assert.strictEqual(r.effort, 'high');
        assert.strictEqual(r.mode, 'auto');
        assert.strictEqual(r.turns, 1);
        assert.strictEqual(r.turnTools, 3);
        assert.deepStrictEqual(r.turnFiles, ['/w/a.js']);
        assert.strictEqual(r.tokens.output, 30, 'a reply written as several lines counts once');
        assert.strictEqual(r.context.used, 2003);
        assert.strictEqual(r.bgAgents, 1);
        assert.strictEqual(r.costUsd, 1.5);
        assert.strictEqual(r.turnMs, 9000);
        // appended lines are read incrementally
        fs.appendFileSync(file, J({ type: 'user', uuid: 'u2', timestamp: '2026-11-24T10:01:00.000Z', message: { role: 'user', content: 'again' } }));
        assert.strictEqual((await ins.insightOf(file)).turns, 2);
        const live = ins.summarize((function () { const st = ins.createState(); fx.slice(0, 3).forEach((o) => ins.feed(st, JSON.stringify(o))); return st; })(), Date.parse('2026-11-24T10:00:30.000Z'), true);
        assert.ok(/agent|Bash/.test(live.now), 'the current tool is named while it works');
        // the chat: steering shows as a user row; hidden thinking / edits / tool calls fold into one summary row
        const page = await transcript.readPage(file, { limit: 20, view: transcript.viewFrom({}) });
        const kinds = page.messages.map((m) => m.kind);
        assert.ok(kinds.includes('summary'), 'hidden items become a summary row');
        const sum = page.messages.find((m) => m.kind === 'summary');
        assert.ok(/Thinking/.test(sum.label) && /Edited 1 file: a\.js/.test(sum.label) && /tool call/.test(sum.label) && /Background agent started: audit/.test(sum.label), sum.label);
        const steer = page.messages.find((m) => m.origin === 'steering');
        assert.ok(steer && steer.text === 'please also lint' && steer.role === 'user', 'a queued steering message shows as a user row');
        console.log('ok 9 insight summary, hidden-run summaries and steering rows');
    }

    store.close();
    console.log('all claude desk tests passed');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
