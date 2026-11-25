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
let onKeys = null; // a test's view of keys sent to a pane (a menu that goes away on Enter)
launcher._setRunner(async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'systemd-run') return { code: 0, stdout: '', stderr: '' };
    if (cmd !== 'tmux') return { code: 1, stdout: '', stderr: 'unexpected' };
    const a = args[0] === '-L' ? args.slice(2) : args;
    if (a[0] === 'show') return { code: calls.some((c) => c[0] === 'systemd-run') ? 0 : 1, stdout: 'exit-empty off', stderr: '' };
    if (a[0] === 'send-keys' && onKeys) onKeys(a);
    if (a[0] === 'display-message') return { code: 0, stdout: 'rc-11111111\n', stderr: '' };
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
    const started = await launcher.start(gr, { cwd: path.join(HOME, 'repo'), prompt: 'Do the thing', account: 1, pollMs: 5, timeoutMs: 500, remoteControl: true });
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
    // Remote Control is a choice (#1191): the default is off, with no /remote-control typed and no wait for its banner
    {
        const keep = paneText;
        paneText = 'Welcome to Claude Code\n\u2502 > Try "fix the bug" \u2502\n  ? for shortcuts';
        calls.length = 0;
        const t0 = Date.now();
        const plain = await launcher.start(gr, { cwd: path.join(HOME, 'repo'), prompt: 'No RC', account: 1, pollMs: 5, timeoutMs: 5000 });
        assert.strictEqual(plain.state, 'running');
        assert.strictEqual(plain.link, '');
        assert.match(plain.message, /no Remote Control/);
        assert.ok(Date.now() - t0 < 2000, 'running as soon as the prompt shows, not after the whole wait');
        const plainCmd = calls.find((c) => c[0] === 'tmux' && c.includes('new-session')).pop();
        assert.ok(!plainCmd.includes('--remote-control') && plainCmd.includes(`--session-id ${plain.id}`), plainCmd);
        // a pane that asks to be nudged is never sent /remote-control without it
        paneText = 'Previous session is unavailable\n? for shortcuts';
        calls.length = 0;
        await launcher.start(gr, { cwd: path.join(HOME, 'repo'), account: 1, pollMs: 5, timeoutMs: 300 });
        assert.ok(!calls.some((c) => c.includes('send-keys') && c.includes('/remote-control')), 'no /remote-control nudge without Remote Control');
        paneText = keep;
    }
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
    // resume (bringing a session back) keeps Remote Control, as takeover does
    assert.ok(rcmd[rcmd.length - 1].includes('--remote-control'), 'a resume is back in Remote Control');
    // the args builder: --remote-control only when asked for
    {
        const B = launcher._test.buildArgs;
        const base = { id: '44444444-4444-4444-8444-444444444444', title: 't' };
        assert.ok(!B(base, { title: 't' }).includes('--remote-control'), 'off by default');
        assert.ok(!B(Object.assign({ remoteControl: false }, base), { title: 't' }).includes('--remote-control'));
        assert.ok(!B(Object.assign({ remoteControl: 'yes' }, base), { title: 't' }).includes('--remote-control'), 'only true turns it on');
        const on = B(Object.assign({ remoteControl: true }, base), { title: 'My title' });
        assert.deepStrictEqual(on.slice(0, 4), ['--session-id', base.id, '--remote-control', 'My title']);
        const rs = B({ id: base.id, resume: true, remoteControl: true }, { title: 't' });
        assert.deepStrictEqual(rs.slice(0, 4), ['--resume', base.id, '--remote-control', 't']);
    }
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
    // a menu on its screen owns the keys (its Enter would pick the highlighted choice)
    {
        const before = paneText;
        const menu = (on) => ['● Ready for your first request.', '─'.repeat(40), '  Make auto mode your default permission mode?', '',
            '  Auto mode lets Claude handle permission prompts automatically.', '',
            on === 0 ? '  ❯ Yes, set auto mode as my default permission mode' : '    Yes, set auto mode as my default permission mode',
            on === 1 ? '  ❯ No, keep bypass permissions' : '    No, keep bypass permissions', '', '  Not answered yet · ↑/↓ to choose · Esc to cancel'].join('\n');
        const box = ['● Ready for your first request.', '─'.repeat(40), '❯ ', '─'.repeat(40), '  ⏵⏵ bypass permissions on (shift+tab to cycle)'].join('\n');
        // Claude Code's own offer: declined with its no-change choice, then the message goes in
        let on = 0;
        paneText = menu(0);
        onKeys = (a) => { const k = a[a.length - 1]; if (paneText === box) return; if (k === 'Down') { on = 1; paneText = menu(1); } else if (k === 'Enter') { assert.strictEqual(on, 1, 'Enter only on "No, keep"'); paneText = box; } };
        calls.length = 0;
        assert.strictEqual((await launcher.steer(SID, 'are you there')).sent, true);
        const keys = calls.filter((c) => c.includes('send-keys')).map((c) => c[c.length - 1]);
        assert.deepStrictEqual(keys, ['Down', 'Enter', 'are you there', 'Enter'], keys.join(','));
        // an offer with its own "esc not now" (the autocompact size offer): dismissed with Esc, then the message goes in
        paneText = ['✻ Worked for 18m 50s · done 1:05 PM', '─'.repeat(40), '  We recommend compacting earlier',
            "  Want to autocompact at 400k tokens instead? Your model doesn't change. Switch", '  back any time with /autocompact.',
            '    Keep auto (1m tokens)', '    Autocompact at ‹ 400k › tokens', '  ↑/↓ choose · ←/→ change size · enter confirm · esc not now'].join('\n');
        onKeys = (a) => { if (a[a.length - 1] === 'Escape') paneText = box; else assert.strictEqual(paneText, box, 'no key but Esc goes into the offer'); };
        calls.length = 0;
        assert.strictEqual((await launcher.steer(SID, 'the sent back icon')).sent, true);
        assert.deepStrictEqual(calls.filter((c) => c.includes('send-keys')).map((c) => c[c.length - 1]), ['Escape', 'the sent back icon', 'Enter']);
        // a question the agent's work raised is never answered for her: refused, named, no keys
        onKeys = null;
        paneText = [' Bash command', '   rm -rf build', ' Do you want to proceed?', ' ❯ 1. Yes', "   2. Yes, and don't ask again", '   3. No, and tell Claude what to do differently (esc)', ' Esc to cancel'].join('\n');
        calls.length = 0;
        await assert.rejects(() => launcher.steer(SID, 'hello'), (e) => e.code === 'SESSION_DIALOG' && /Do you want to proceed\?/.test(e.message));
        assert.ok(!calls.some((c) => c.includes('send-keys') || c.includes('paste-buffer')), 'no keys go into a permission prompt');
        // a busy session's own footer ("esc to interrupt") is not a menu
        paneText = ['✽ Churning… (7s)', '─'.repeat(40), '❯ ', '─'.repeat(40), '  ⏵⏵ bypass permissions on (shift+tab to cycle) · esc to interrupt'].join('\n');
        assert.strictEqual((await launcher.steer(SID, 'still sends')).sent, true);
        paneText = before;
        // Show Screen's live terminal: tmux attached to the session's own tmux session
        const at = await launcher.attachCommand(SID);
        assert.strictEqual(at.file, 'tmux');
        assert.deepStrictEqual(at.args.slice(-3), ['attach-session', '-t', '=rc-11111111'], at.args.join(' '));
    }
    await assert.rejects(() => launcher.steer(SID, '   '), /Nothing to send/);
    await assert.rejects(() => launcher.steer('33333333-2222-4333-8444-555555555555', 'hi'), /not running/);
    const live = await launcher.resume(gr, SID, {});
    assert.strictEqual(live.state, 'live', 'a live Remote Control session is not started twice');
    // a session started without Remote Control: in the live list with remoteControl false, steerable through its tmux pane
    {
        const rec = path.join(HOME, '.claude', 'sessions', `${process.pid}.json`);
        write(rec, { pid: process.pid, sessionId: SID, cwd: path.join(HOME, 'repo'), status: 'idle', tmux: 'rc-11111111:@1.%7' });
        const l = claudeSessions.liveSessions().find((x) => x.id === SID);
        assert.ok(l && l.remoteControl === false && l.origin === 'rc' && l.tmuxSession === 'rc-11111111', JSON.stringify(l));
        calls.length = 0;
        const s2 = await launcher.steer(SID, 'steer without Remote Control');
        assert.strictEqual(s2.sent, true);
        assert.ok(calls.some((c) => c.includes('send-keys') && c.includes('-l') && c.includes('steer without Remote Control') && c.includes('%7')));
        write(rec, { pid: process.pid, sessionId: SID, cwd: path.join(HOME, 'repo'), status: 'busy', tmux: 'rc-11111111:@1.%7', bridgeSessionId: 'session_01TESTabcdefgh' });
    }
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

    // 9b: the workflow map (claude_desk_supervisor work_map): Supervisor -> session -> background agents -> their tasks, from transcripts
    {
        const J = (o) => `${JSON.stringify(o)}\n`;
        const file = await launcher.findFile(SID);
        assert.ok(file, 'the fixture session has a transcript');
        const sub = path.join(path.dirname(file), SID, 'subagents');
        fs.mkdirSync(sub, { recursive: true });
        fs.writeFileSync(path.join(sub, 'agent-a9999999999999999.meta.json'), JSON.stringify({ agentType: 'general-purpose', description: 'Build the thing', requestShape: 'background', model: 'sonnet' }));
        const side = (o) => Object.assign({ isSidechain: true }, o);
        fs.writeFileSync(path.join(sub, 'agent-a9999999999999999.jsonl'), [
            side({ type: 'user', timestamp: '2026-11-24T10:00:00.000Z', message: { role: 'user', content: 'build' } }),
            side({ type: 'assistant', timestamp: '2026-11-24T10:00:05.000Z', effort: 'medium', message: { id: 'x1', model: 'claude-sonnet-5-5', usage: { input_tokens: 5, output_tokens: 40, cache_read_input_tokens: 900, cache_creation_input_tokens: 100 }, content: [{ type: 'tool_use', id: 'tb1', name: 'Bash', input: { command: 'npm run build', description: 'Build it', run_in_background: true } }, { type: 'tool_use', id: 'tb2', name: 'Bash', input: { command: 'sleep 99', description: 'Wait', run_in_background: true } }] } }),
            { type: 'attachment', timestamp: '2026-11-24T10:00:30.000Z', attachment: { type: 'queued_command', prompt: '<task-notification>\n<task-id>b1</task-id>\n<tool-use-id>tb1</tool-use-id>\n<status>completed</status>\n</task-notification>', commandMode: 'task-notification' } }
        ].map(J).join(''));
        const map = await desk._workMap(gr, { sessionId: SID });
        const byKind = (k) => map.nodes.filter((n) => n.kind === k);
        assert.strictEqual(byKind('supervisor').length, 1);
        const sn = byKind('session')[0];
        assert.ok(sn && sn.sessionId === SID && sn.col === 1 && sn.parent === 'sup', JSON.stringify(sn));
        const an = byKind('agent')[0];
        assert.ok(an && an.parent === sn.key && an.col === 2 && an.label === 'Build the thing' && an.model === 'sonnet', JSON.stringify(an));
        assert.strictEqual(an.effort, 'medium');
        assert.strictEqual(an.tokens, 145, 'input + output + cache written, sidechain lines counted');
        const tasks = byKind('task');
        assert.deepStrictEqual(tasks.map((t) => [t.parent, t.col, t.state]), [[an.key, 3, 'done'], [an.key, 3, 'working']], 'the finished command is done by its notification, the other still runs');
        assert.ok(map.nodes.every((n) => n.key && typeof n.col === 'number'));
        console.log('ok 9b workflow map');
    }

    {
        // Last 30 days: the daily usage store keeps the max per account and day, trims to 90 days, and joins the Supervisor's cost
        const hist = require('../modules/claudeUsageHistory');
        const DAY = 86400000;
        const now = new Date(2026, 10, 24, 12, 0, 0).getTime();
        const snap = (sess, week) => ({ at: now, accounts: [{ id: 'acc1', name: 'Main', limits: [{ kind: 'session', percent: sess }, { kind: 'weekly_all', percent: week }] }, { id: 'acc2', name: 'Other', limits: [] }] });
        assert.strictEqual(hist.record(snap(30, 10), now), 1, 'an account with no limits is not stored');
        hist.record(snap(80, 12), now);
        hist.record(snap(20, 15), now + 1000);
        hist.record(snap(55, 5), now - 3 * DAY);
        hist.record(snap(5, 1), now - 100 * DAY);
        const d = store.open();
        d.exec('CREATE TABLE IF NOT EXISTS supervisor_usage (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, engine TEXT NOT NULL, model TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, cost REAL, ok INTEGER NOT NULL, error TEXT, failover_from TEXT)');
        const ins = d.prepare('INSERT INTO supervisor_usage (at, kind, engine, model, prompt_tokens, completion_tokens, cost, ok) VALUES (?, ?, ?, ?, ?, ?, ?, 1)');
        ins.run(now, 'review', 'tokenrouter', 'm', 1000, 500, 0.0042);
        ins.run(now, 'review', 'tokenrouter', 'm', 100, 50, null);
        ins.run(now - 2 * DAY, 'review', 'tokenrouter', 'm', 10, 5, 0.5);
        const h = hist.history(30, now);
        assert.strictEqual(h.days.length, 30);
        assert.strictEqual(h.days[29], '2026-11-24');
        assert.strictEqual(h.accounts.length, 1);
        const today = h.accounts[0].days['2026-11-24'];
        assert.deepStrictEqual([today.session, today.week], [80, 15], 'the highest percent of the day is kept');
        assert.strictEqual(h.accounts[0].days['2026-11-21'].session, 55);
        assert.ok(!d.prepare("SELECT 1 FROM claude_usage_daily WHERE day < '2026-08-01'").get(), 'older than 90 days is dropped');
        assert.ok(Math.abs(h.supervisor['2026-11-24'].cost - 0.0042) < 1e-9 && h.supervisor['2026-11-24'].unpriced === 1 && h.supervisor['2026-11-24'].tokens === 1650, JSON.stringify(h.supervisor));
        assert.strictEqual(h.supervisor['2026-11-22'].cost, 0.5);
        assert.strictEqual(hist.history(1, now).days.length, 1, 'only today is fine');
        // spend formatting (the client's own functions, run out of its source)
        const vm = require('vm');
        const src = fs.readFileSync(path.join(__dirname, '..', 'apps', 'claudedesk', 'client', 'claudedesk.js'), 'utf8');
        const grab = (name) => { const i = src.indexOf(`    function ${name}(`); const j = src.indexOf('\n    }\n', i); return src.slice(i, j + 6); };
        const ctx = vm.createContext({});
        vm.runInContext(`${grab('moneyText')}\nconst countText = (n) => (Number(n) || 0).toLocaleString('en-US');\n${grab('spendFigures')}`, ctx);
        assert.strictEqual(vm.runInContext('moneyText(0.0042)', ctx), '$0.0042');
        assert.strictEqual(vm.runInContext('moneyText(0.000123)', ctx), '$0.00012');
        assert.strictEqual(vm.runInContext('moneyText(0.056)', ctx), '$0.056');
        assert.strictEqual(vm.runInContext('moneyText(12.3456)', ctx), '$12.35');
        assert.strictEqual(vm.runInContext('moneyText(0)', ctx), '$0.00');
        assert.strictEqual(vm.runInContext('countText(1234567)', ctx), '1,234,567');
        assert.strictEqual(vm.runInContext("JSON.stringify(spendFigures([{ cost: 0.1, calls: 2, prompt: 1000, completion: 500, unpriced: 1 }, { cost: 0.2, calls: 1, prompt: 10, completion: 5 }]))", ctx), '{"cost":0.30000000000000004,"calls":3,"prompt":1010,"completion":505,"tokens":1515,"unpriced":1}');
        console.log('ok 10 daily usage history store and spend formatting');
    }

    // 11. Markdown in the chat (the client's renderer, run out of its source) and the files Claude sent
    {
        const vm = require('vm');
        const src = fs.readFileSync(path.join(__dirname, '..', 'apps', 'claudedesk', 'client', 'claudedesk.js'), 'utf8');
        const block = (name) => { const i = src.indexOf(`    // -- ${name} begin`); const j = src.indexOf(`    // -- ${name} end`); assert.ok(i > 0 && j > i, `${name} block`); return src.slice(i, j); };
        const ctx = vm.createContext({});
        vm.runInContext(`const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));\n${block('markdown')}`, ctx);
        const md = (t) => { ctx.t = t; return vm.runInContext('mdHtml(t)', ctx); };
        const has = (t, re, what) => assert.ok(re.test(md(t)), `${what}: ${md(t)}`);
        has('# Title\n## Two', /<h1 class="cd-md-h">Title<\/h1><h2 class="cd-md-h">Two<\/h2>/, 'headings');
        has('a **bold** and *it* and ~~gone~~ and `x < y`', /<strong>bold<\/strong>.*<em>it<\/em>.*<del>gone<\/del>.*<code>x &lt; y<\/code>/, 'inline');
        has('snake_case_word and 2*3*4', /^<p class="cd-md-p">snake_case_word and 2\*3\*4<\/p>$/, 'underscores and stars inside words stay');
        has('```js\nconst a = "<b>";\n\nb();\n```\nafter', /<pre class="cd-md-code" data-lang="js"><code>const a = &quot;&lt;b&gt;&quot;;\n\nb\(\);<\/code><\/pre><p class="cd-md-p">after/, 'fenced code keeps blank lines');
        has('```\nunclosed *x*', /<pre class="cd-md-code"><code>unclosed \*x\*<\/code>/, 'an unclosed fence');
        has('- a\n- b\n  - c\n  - d\n- e', /<ul class="cd-md-l"><li>a<\/li><li>b<ul class="cd-md-l"><li>c<\/li><li>d<\/li><\/ul><\/li><li>e<\/li><\/ul>/, 'nested bullets');
        has('1. one\n2. two\n   - x\n3. three', /<ol class="cd-md-l"><li>one<\/li><li>two<ul class="cd-md-l"><li>x<\/li><\/ul><\/li><li>three<\/li><\/ol>/, 'numbered with a nested bullet');
        has('3. x\n4. y', /<ol class="cd-md-l" start="3">/, 'a numbered list keeps its start');
        has('- [x] done\n- [ ] todo', /☑ done.*☐ todo/, 'task items');
        has('| A | B |\n|---|:-:|\n| 1 | **2** |\n| 3 |', /<table class="cd-md-table"><thead><tr><th>A<\/th><th class="cd-md-c">B<\/th><\/tr><\/thead><tbody><tr><td>1<\/td><td class="cd-md-c"><strong>2<\/strong><\/td><\/tr><tr><td>3<\/td><td class="cd-md-c"><\/td><\/tr>/, 'a GFM table');
        has('> quoted *line*\n> more\n\nafter', /<blockquote class="cd-md-q"><p class="cd-md-p">quoted <em>line<\/em><br>more<\/p><\/blockquote><p class="cd-md-p">after/, 'block quote');
        has('one\n\n---\n\ntwo', /<p class="cd-md-p">one<\/p><hr class="cd-md-hr"><p class="cd-md-p">two<\/p>/, 'horizontal rule');
        has('line one\nline two', /line one<br>line two/, 'line breaks');
        has('[Site](https://example.com/a?b=1&c=2) and https://x.org/p.', /<a class="cd-md-a" href="https:\/\/example.com\/a\?b=1&amp;c=2" rel="noopener noreferrer">Site<\/a> and <a class="cd-md-a" href="https:\/\/x.org\/p"[^>]*>https:\/\/x.org\/p<\/a>\./, 'links');
        // nothing from the text becomes markup or an attribute
        const evil = md('<script>alert(1)</script> <img src=x onerror=alert(1)> [x](javascript:alert(1)) [y](https://a.com/"onmouseover="alert(1)) `<b>` **<i>**');
        const tags = evil.match(/<[^>]*>/g) || [];
        assert.ok(tags.every((t) => /^<\/?(p|code|strong|a)( class="cd-md-p"| class="cd-md-a" href="[^"<>]*" rel="noopener noreferrer")?>$/.test(t)), `only our own tags: ${tags.join(' ')}`);
        assert.ok(!/<a [^>]*href="javascript/i.test(evil) && !/<(script|img)/i.test(evil), evil);
        assert.ok(/&lt;script&gt;/.test(evil));
        assert.ok(!/<a [^>]*href="javascript/i.test(md('[z](JavaScript:alert(1)) [d](data:text/html,x) [m](mailto:a@b.c)')), 'only http(s) and mailto links');
        assert.ok(/mailto:a@b.c/.test(md('[m](mailto:a@b.c)')));

        // SendUserFile: a user-facing row even with every view option off
        const FSID = '33333333-3333-4333-8333-333333333333';
        const out = path.join(SANDBOX, 'outbox');
        fs.mkdirSync(out, { recursive: true });
        const png = path.join(out, 'icons.png');
        const pdf = path.join(out, 'doc.pdf');
        const secret = path.join(out, 'secret.txt');
        const big = path.join(out, 'big.bin');
        fs.writeFileSync(png, Buffer.from('89504e470d0a1a0a', 'hex'));
        fs.writeFileSync(pdf, '%PDF-1.4');
        fs.writeFileSync(secret, 'not sent');
        fs.writeFileSync(big, '');
        fs.truncateSync(big, 50 * 1024 * 1024 + 1);
        const fproj = path.join(HOME, '.claude', 'projects', '-repo');
        const ffile = path.join(fproj, `${FSID}.jsonl`);
        const sent = (id, input) => line({ type: 'assistant', cwd: out, uuid: id, timestamp: '2026-11-24T10:00:00.000Z', message: { role: 'assistant', model: 'claude-sonnet-5-5', content: [{ type: 'tool_use', id, name: 'SendUserFile', input }] } });
        fs.writeFileSync(ffile, line({ type: 'user', message: { role: 'user', content: 'send it' } })
            + sent('toolu_1', { files: [png, pdf, 'relative.txt'], caption: 'The **icons**', display: 'render' })
            + sent('toolu_2', { files: [big] })
            + line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Sent' }] } }));
        const view = transcript.viewFrom({});
        const fp = await transcript.readPage(ffile, { limit: 50, view });
        const rows = fp.messages.filter((m) => m.kind === 'sendfile');
        assert.strictEqual(rows.length, 2, 'SendUserFile rows show with tool calls hidden');
        assert.deepStrictEqual(rows[0].files.map((f) => [f.name, f.type, f.size, f.missing]), [['icons.png', 'image', 8, false], ['doc.pdf', 'pdf', 8, false], ['relative.txt', 'text', 0, true]]);
        assert.strictEqual(rows[0].files[0].path, png);
        assert.strictEqual(rows[0].caption, 'The **icons**');
        assert.strictEqual(rows[0].sid, FSID);
        const since = await transcript.readSince(ffile, 0, { view });
        assert.strictEqual(since.messages.filter((m) => m.kind === 'sendfile').length, 2, 'the live path carries them too');
        assert.ok(!/base64|data:/.test(JSON.stringify(rows)), 'no inline picture data');

        // the file route: only a path this session sent, regular file, size cap
        const files = require('../modules/claudeDeskFiles');
        const refuse = async (id, p, status) => { try { await files.resolve(id, p); } catch (e) { assert.strictEqual(e.status, status, `${p}: ${e.message}`); return; } assert.fail(`${p} was served`); };
        assert.strictEqual((await files.resolve(FSID, png)).size, 8);
        assert.strictEqual((await files.resolve(FSID, `${out}/./icons.png`)).name, 'icons.png', 'a path is compared normalised');
        await refuse(FSID, secret, 403); // exists, but this session never sent it
        await refuse(FSID, path.join(out, '..', 'outbox', 'secret.txt'), 403);
        await refuse(FSID, '/etc/passwd', 403);
        await refuse(FSID, 'icons.png', 404);
        await refuse(FSID, big, 413);
        await refuse('44444444-4444-4444-8444-444444444444', png, 404); // no such session
        await refuse(SID, png, 403); // another session did not send it
        await refuse('../../etc', png, 404);
        // a file sent later is served after the transcript grows
        await refuse(FSID, secret, 403);
        fs.appendFileSync(ffile, sent('toolu_3', { files: [secret] }));
        assert.strictEqual((await files.resolve(FSID, secret)).size, 8);
        // a path that became a directory or a link to one is not a file
        const dir = path.join(out, 'adir');
        fs.mkdirSync(dir);
        fs.appendFileSync(ffile, sent('toolu_4', { files: [dir] }));
        await refuse(FSID, dir, 404);
        // the handler streams the bytes with a type and no script rights
        const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(o) { this.body = o; this.done = true; }, chunks: [], write(c) { this.chunks.push(c); return true; }, end() { this.done = true; }, on() { return this; }, once() { return this; }, emit() { return true; }, removeListener() { return this; } };
        const ok = new Promise((resolve) => { res.end = () => resolve(); res.on = (ev, fn) => { if (ev === 'finish') resolve(); return res; }; });
        await files.handle({ params: { id: FSID }, query: { path: png } }, res);
        await Promise.race([ok, new Promise((r) => setTimeout(r, 500))]);
        assert.strictEqual(res.headers['Content-Type'], 'image/png');
        assert.ok(/sandbox/.test(res.headers['Content-Security-Policy']) && res.headers['X-Content-Type-Options'] === 'nosniff');
        assert.strictEqual(Buffer.concat(res.chunks.map((c) => Buffer.from(c))).length, 8);
        const bad = { code: 0, status(c) { this.code = c; return this; }, json() {}, setHeader() {} };
        await files.handle({ params: { id: FSID }, query: { path: '/etc/hostname' } }, bad);
        assert.strictEqual(bad.code, 403);
        console.log('ok 11 Markdown rendering, SendUserFile rows and the file route');
    }

    // 12. the Tasks panel: both lists and the counts the status bar shows, edits, and the push while a transcript is watched
    {
        const T = require('../modules/sessionTasks');
        const TS = '44444444-4444-4444-8444-444444444444';
        const out = [];
        const tctx = { globalResources: gr, sendToClient: (ws, m) => out.push(m), sendError: (ws, msg) => out.push({ error: msg }) };
        const admin = { userType: 'admin' };
        const call = async (message) => { const n = out.length; await desk._handlers.handleTasks(tctx, {}, Object.assign({ requestId: 'tk' }, message), admin); return out.slice(n).find((m) => m.type === 'claude_desk_tasks_response'); };
        let r = await call({ id: TS, action: 'add', text: 'Make the icons 16 px' });
        assert.deepStrictEqual([r.data.counts.asksTotal, r.data.counts.asksDone, r.data.counts.tasksTotal], [1, 0, 0]);
        T.add(TS, 'agent', 'Redraw the sprite sheet', { by: 'agent' });
        r = await call({ id: TS, action: 'list' });
        assert.deepStrictEqual([r.data.counts.asksTotal, r.data.counts.tasksTotal], [1, 1]);
        const ask = r.data.asks[0];
        r = await call({ id: TS, action: 'update', taskId: ask.id, done: true });
        assert.ok(r.data.asks[0].done && r.data.asks[0].doneBy === 'user' && r.data.counts.asksDone === 1);
        r = await call({ id: TS, action: 'update', taskId: ask.id, text: 'Make the icons 24 px', done: false });
        assert.strictEqual(r.data.asks[0].text, 'Make the icons 24 px');
        r = await call({ id: TS, action: 'rename', title: 'Icons work' });
        assert.strictEqual(r.data.title, 'Icons work');
        assert.strictEqual(claudeSessions.titleOf(TS, null, { title: 'Auto', firstPrompt: 'x' }), 'Icons work');
        const bad = await call({ id: TS, action: 'update', taskId: 999999, done: true });
        assert.ok(!bad && out.some((m) => /No such task/.test(m.error || '')), 'an id of another session is refused');
        r = await call({ id: TS, action: 'remove', taskId: ask.id });
        assert.strictEqual(r.data.asks.length, 0);
        // watched: a change is pushed to the socket that watches the session
        const tf = path.join(HOME, '.claude', 'projects', '-home-test', `${TS}.jsonl`);
        write(tf, JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-11-24T10:00:00Z', message: { role: 'user', content: 'hello' } }) + '\n');
        const ws = { readyState: 1, once() {} };
        await desk._handlers.handleWatch(tctx, ws, { requestId: 'w1', id: TS }, admin);
        const before = out.length;
        T.add(TS, 'user', 'A new ask', { by: 'user' });
        const push = out.slice(before).find((m) => m.type === 'claude_desk_tasks');
        assert.ok(push && push.data.asks.some((a) => a.text === 'A new ask'), 'the change is pushed to the watching socket');
        await desk._handlers.handleUnwatch(tctx, ws, { requestId: 'w2' }, admin);
        const after = out.length;
        T.add(TS, 'user', 'Not pushed', { by: 'user' });
        assert.ok(!out.slice(after).some((m) => m.type === 'claude_desk_tasks'), 'no push after unwatch');
        console.log('ok 12 task panel data');
    }

    store.close();
    console.log('all claude desk tests passed');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
