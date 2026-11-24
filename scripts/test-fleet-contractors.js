'use strict';

// Fleet Contractors (#1154): modules/fleetContractors.js, modules/ws/handlers/317-fleetContractorsHandler.js and
// the agent scripts/contractor/agent.js over a REAL local WebSocket. Sandboxed: a temp store, a temp HOME for
// the agent (its ~/.claude, config and credential), a fake `claude` CLI, and its own tmux socket.
//
//   pairing    code single use, expiry, only hashes at rest, code / secret never in the store or the log
//   the door   no knock / no contractor -> 404; bad credential, junk before auth, auth timeout -> 4401
//   the agent  `agent.js pair` (code from the environment) + `agent.js run` as child processes: hello, session
//              pushes, list / transcript (a session outside the project folders is refused), start / steer /
//              interrupt / stop on the pipe runner (Windows' path), revoke -> 4403 and the agent exits
//   tmux       start / steer / stop through the agent's tmux runner (Linux's path) with Remote Control's link
//   handler    admin only; list / invite / installer (and the installer's dry run into a temp prefix)
//
// node scripts/test-fleet-contractors.js

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-fleet-contractors-test-'));
const HOME = path.join(SANDBOX, 'home');
const PROJECT = path.join(SANDBOX, 'work', 'app');
const OUTSIDE = path.join(SANDBOX, 'elsewhere');
const AGENT_HOME = path.join(HOME, '.config', 'fleet-contractor');
const TMUX_SOCKET = `fleet-contractor-test-${process.pid}`;
process.env.FLEET_CONTRACTORS_DB = path.join(SANDBOX, 'store', 'fleet-contractors.db');
process.env.FLEET_CONTRACTOR_HOME = AGENT_HOME;
process.env.FLEET_CONTRACTOR_CLAUDE_HOME = HOME;
process.env.FLEET_CONTRACTOR_TMUX_SOCKET = TMUX_SOCKET;
delete process.env.CLAUDE_CONFIG_DIR;
process.env.HOME = HOME; // the tmux runner's fake CLI writes under $HOME/.claude
[HOME, PROJECT, OUTSIDE, path.join(HOME, '.claude', 'sessions'), path.join(HOME, '.claude', 'projects')].forEach((d) => fs.mkdirSync(d, { recursive: true }));

const ROOT = path.join(__dirname, '..');
const AGENT = path.join(ROOT, 'scripts', 'contractor', 'agent.js');
const fc = require('../modules/fleetContractors');
const handler = require('../modules/ws/handlers/317-fleetContractorsHandler');
const WebSocket = require('ws');

const children = [];
let server = null;
function cleanup() {
    children.forEach((c) => { try { c.kill('SIGKILL'); } catch (_) { /* gone */ } });
    try { execFileSync('tmux', ['-L', TMUX_SOCKET, 'kill-server'], { stdio: 'ignore' }); } catch (_) { /* none */ }
    try { fc._reset(); } catch (_) { /* closed */ }
    try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) { /* gone */ }
}
process.on('exit', cleanup);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms = 15000) {
    const end = Date.now() + ms;
    for (;;) {
        const v = await fn();
        if (v) return v;
        if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
        await sleep(100);
    }
}
const mangle = (p) => p.replace(/[^A-Za-z0-9]/g, '-');

// ---------------------------------------------------------------- a fake claude CLI
const FAKE = path.join(SANDBOX, 'bin', 'claude');
fs.mkdirSync(path.dirname(FAKE), { recursive: true });
fs.writeFileSync(FAKE, `#!${process.execPath}
'use strict';
const fs = require('fs'); const path = require('path'); const readline = require('readline');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('9.9.9 (Claude Code)'); process.exit(0); }
const id = a[a.indexOf('--session-id') + 1];
const dir = path.join(process.env.HOME, '.claude', 'projects', process.cwd().replace(/[^A-Za-z0-9]/g, '-'));
fs.mkdirSync(dir, { recursive: true });
const file = path.join(dir, id + '.jsonl');
const line = (o) => fs.appendFileSync(file, JSON.stringify(Object.assign({ cwd: process.cwd(), sessionId: id, timestamp: new Date().toISOString(), uuid: String(Math.random()) }, o)) + '\\n');
const out = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
if (a.includes('-p')) {
    readline.createInterface({ input: process.stdin }).on('line', (l) => {
        const m = JSON.parse(l);
        if (m.type === 'control_request') { line({ type: 'assistant', message: { model: 'fake', content: [{ type: 'text', text: 'INTERRUPTED' }] } }); out({ type: 'control_response', response: { subtype: 'success', request_id: m.request_id } }); return; }
        const text = m.message.content[0].text;
        line({ type: 'user', message: { role: 'user', content: text } });
        line({ type: 'assistant', message: { model: 'fake', content: [{ type: 'text', text: 'echo: ' + text }] } });
        out({ type: 'assistant', message: { content: [{ type: 'text', text: 'echo: ' + text }] } });
        out({ type: 'result', subtype: 'success' });
    });
} else {
    const prompt = a[a.length - 1];
    line({ type: 'user', message: { role: 'user', content: prompt } });
    console.log('/remote-control is active https://claude.ai/code/session_TESTabcdefgh12345678');
    readline.createInterface({ input: process.stdin }).on('line', (l) => { console.log('got: ' + l); line({ type: 'user', message: { role: 'user', content: l } }); });
}
`, { mode: 0o755 });
fs.writeFileSync(path.join(HOME, '.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'contractor@example.test', organizationName: 'Test Org', displayName: 'Tester', billingType: 'max' } }));

// a session that was running before the agent: live record (this test's own pid) + transcript, in the project
const EXT_ID = crypto.randomUUID();
const OUT_ID = crypto.randomUUID();
function writeSession(id, cwd, pid, name) {
    fs.writeFileSync(path.join(HOME, '.claude', 'sessions', `${pid}.json`), JSON.stringify({ pid, sessionId: id, cwd, name, status: 'idle', startedAt: Date.now(), updatedAt: Date.now(), bridgeSessionId: 'session_EXTabcdefgh12345678' }));
    const d = path.join(HOME, '.claude', 'projects', mangle(cwd));
    fs.mkdirSync(d, { recursive: true });
    const lines = [
        { type: 'user', cwd, sessionId: id, uuid: 'u1', timestamp: new Date().toISOString(), message: { role: 'user', content: 'hello there' } },
        { type: 'assistant', cwd, sessionId: id, uuid: 'a1', timestamp: new Date().toISOString(), message: { model: 'fake', content: [{ type: 'text', text: 'the key is sk-ant-oat01-SECRETSECRETSECRET' }] } }
    ];
    fs.writeFileSync(path.join(d, `${id}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
}
writeSession(EXT_ID, PROJECT, process.pid, 'existing work');
writeSession(OUT_ID, OUTSIDE, process.ppid, 'private work');

// ---------------------------------------------------------------- tests

const statuses = [];
fc.onStatus((d) => statuses.push(d));
const seen = (reason, pred) => statuses.find((s) => (s.reasons || [s.reason]).includes(reason) && (!pred || pred(s)));

function rawUpgrade(port, headers) {
    return new Promise((resolve) => {
        const req = http.request({ port, path: fc.PATH, headers: Object.assign({ Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': crypto.randomBytes(16).toString('base64'), 'Sec-WebSocket-Version': '13' }, headers) });
        req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101); });
        req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
        req.on('error', () => resolve(0));
        req.end();
    });
}
function wsClose(port, first, opts = {}) {
    return new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}${fc.PATH}`, { headers: { 'X-Dreamscape-Client': 'fleet-contractor/test' } });
        ws.on('open', () => { if (first !== undefined) ws.send(first); });
        ws.on('message', (d) => { if (opts.onMessage) opts.onMessage(ws, JSON.parse(d)); });
        ws.on('close', (code) => resolve(code));
        ws.on('error', () => {});
    });
}

function runAgent(args, env) {
    const c = spawn(process.execPath, [AGENT, ...args], { env: Object.assign({}, process.env, { HOME, FLEET_CONTRACTOR_RUNNER: 'pipe' }, env || {}), stdio: ['ignore', 'pipe', 'pipe'] });
    children.push(c);
    c.log = '';
    c.stdout.on('data', (d) => { c.log += d; });
    c.stderr.on('data', (d) => { c.log += d; });
    c.done = new Promise((r) => c.on('exit', (code) => r(code)));
    return c;
}

async function main() {
    server = http.createServer((req, res) => { res.statusCode = 418; res.end('app'); });
    // the boot's own catch-all upgrade listener (the main socket server behind the site gate): must not see ours
    let otherUpgrades = 0;
    server.on('upgrade', (req, socket) => { otherUpgrades += 1; socket.destroy(); });
    fc.attach(server, null);
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const port = server.address().port;
    const url = `http://127.0.0.1:${port}`;

    // ---- the door with nothing to pair: 404 like the cover, knock or not
    assert.strictEqual(await rawUpgrade(port, { 'X-Dreamscape-Client': 'fleet-contractor/1' }), 404, 'no contractor, no invite: 404');

    // ---- pairing codes
    const inv = fc.createInvite('  Build   box  ', 'tester');
    assert.strictEqual(inv.name, 'Build box');
    assert.match(inv.code, /^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const store = fc._test.store();
    const dump = JSON.stringify(store.prepare('SELECT * FROM invites').all());
    assert.ok(!dump.includes(inv.code) && !dump.includes(inv.code.replace(/-/g, '')), 'the code is not stored');
    assert.ok(dump.includes(fc._test.codeHash(inv.code)), 'its hash is');
    assert.strictEqual(fc.listInvites().length, 1);

    assert.strictEqual(await rawUpgrade(port, {}), 404, 'no knock: 404');
    assert.strictEqual(await rawUpgrade(port, { 'X-Dreamscape-Client': 'dreamscape-bios' }), 404, 'another client\'s knock: 404');
    assert.strictEqual(await rawUpgrade(port, { 'X-Dreamscape-Client': 'fleet-contractor/1' }), 101, 'knock + open invite: upgrade');
    assert.strictEqual(otherUpgrades, 0, 'the contractor path never reaches the other upgrade listeners');

    // expiry: an expired invite cannot be redeemed
    const old = fc.createInvite('Old', 'tester');
    store.prepare('UPDATE invites SET expires_at = ? WHERE id = ?').run(Date.now() - 1000, old.id);
    assert.strictEqual(fc.redeem(old.code), null, 'expired code refused');
    assert.ok(!fc.listInvites().some((i) => i.id === old.id), 'expired invite not listed');

    // ---- auth rejection over the real socket
    assert.strictEqual(await wsClose(port, JSON.stringify({ type: 'auth', id: 'ctr_0000000000000000', secret: 'x'.repeat(43) })), 4401, 'unknown credential: 4401');
    assert.strictEqual(await wsClose(port, JSON.stringify({ type: 'hello', name: 'sneaky' })), 4401, 'anything before auth: 4401');
    assert.strictEqual(await wsClose(port, 'x'.repeat(5000)), 4401, 'a big frame before auth: 4401');
    assert.strictEqual(await wsClose(port, JSON.stringify({ type: 'pair', code: 'AAAA-BBBB-CCCC' })), 4401, 'a wrong code: 4401');

    // ---- the real agent: pair (code from the environment, never an argument)
    const logs = [];
    const origLog = console.log; const origWarn = console.warn;
    console.log = (...a) => { logs.push(a.join(' ')); };
    console.warn = (...a) => { logs.push(a.join(' ')); };
    const pairer = runAgent(['pair', '--server', url, '--name', 'Build box', '--project', PROJECT, '--claude', FAKE], { FLEET_PAIR_CODE: inv.code.toLowerCase() });
    const pairCode = await pairer.done;
    assert.strictEqual(pairCode, 0, `pair failed: ${pairer.log}`);
    assert.ok(!pairer.log.includes(inv.code), 'the agent does not print the code');
    const cred = JSON.parse(fs.readFileSync(path.join(AGENT_HOME, 'credential.json'), 'utf8'));
    assert.match(cred.id, /^ctr_[0-9a-f]{16}$/);
    assert.strictEqual((fs.statSync(path.join(AGENT_HOME, 'credential.json')).mode & 0o777), 0o600, 'credential 0600');
    assert.ok(!pairer.log.includes(cred.secret), 'the agent does not print the secret');
    const rowDump = JSON.stringify(store.prepare('SELECT * FROM contractors').all());
    assert.ok(!rowDump.includes(cred.secret) && rowDump.includes(fc._test.secretHash(cred.secret)), 'only the secret\'s hash is stored');
    assert.ok(fc.verify(cred.id, cred.secret), 'the credential verifies');
    assert.strictEqual(fc.verify(cred.id, `${cred.secret}x`), null);
    assert.strictEqual(fc.redeem(inv.code), null, 'a code works once');
    assert.strictEqual(await wsClose(port, JSON.stringify({ type: 'pair', code: inv.code })), 4401, 'a used code: 4401');
    const cfg = JSON.parse(fs.readFileSync(path.join(AGENT_HOME, 'config.json'), 'utf8'));
    assert.deepStrictEqual(cfg.projects, [PROJECT]);
    await waitFor('paired status', () => seen('paired'));

    // ---- the agent runs: hello + sessions
    const agent = runAgent(['run']);
    await waitFor('connected', () => fc.isOnline(cred.id), 15000).catch((e) => { throw new Error(`${e.message}\n${agent.log}`); });
    await waitFor('hello', () => { const s = fc.summary(cred.id); return s.hello && s.hello.claudeVersion; });
    const sum = fc.summary(cred.id);
    assert.strictEqual(sum.hello.claudeVersion, '9.9.9 (Claude Code)');
    assert.strictEqual(sum.hello.runner, 'pipe');
    assert.strictEqual(sum.hello.accounts[0].email, 'contractor@example.test');
    assert.deepStrictEqual(sum.hello.projects.map((p) => p.path), [PROJECT]);
    assert.ok(sum.sessions.some((s) => s.id === EXT_ID && s.link === 'https://claude.ai/code/session_EXTabcdefgh12345678'), 'the existing session is reported');
    assert.ok(!sum.sessions.some((s) => s.id === OUT_ID), 'a session outside the project folders is not');
    assert.ok(seen('connected'));

    // a session change on the contractor is pushed (fs.watch, debounced)
    statuses.length = 0;
    const rec = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'sessions', `${process.pid}.json`), 'utf8'));
    rec.status = 'busy'; rec.name = 'existing work, renamed';
    fs.writeFileSync(path.join(HOME, '.claude', 'sessions', `${process.pid}.json`), JSON.stringify(rec));
    await waitFor('sessions push', () => seen('sessions', (s) => s.contractor.sessions.some((x) => x.id === EXT_ID && x.status === 'busy')));

    // ---- requests relayed
    const listed = await fc.sessions(cred.id);
    assert.ok(listed.live.some((s) => s.id === EXT_ID));
    const page = await fc.transcript(cred.id, { sessionId: EXT_ID, limit: 10 });
    assert.deepStrictEqual(page.messages.map((m) => m.role), ['user', 'assistant']);
    assert.ok(!JSON.stringify(page).includes('SECRETSECRET'), 'transcript masked');
    await assert.rejects(fc.transcript(cred.id, { sessionId: OUT_ID }), /outside|No such/, 'a session outside the project folders is refused');
    await assert.rejects(fc.startOn(cred.id, { cwd: OUTSIDE, prompt: 'x' }), /project folders/, 'start outside the folders refused');
    await assert.rejects(fc.startOn(cred.id, { cwd: PROJECT, prompt: 'x', mode: 'yolo' }), /permission mode/);

    // start / steer / interrupt / stop on the pipe runner (the Windows path)
    const started = await fc.startOn(cred.id, { cwd: PROJECT, prompt: 'first task', title: 'Fleet test' });
    assert.match(started.sessionId, /^[0-9a-f-]{36}$/);
    await waitFor('started session pushed', () => fc.summary(cred.id).sessions.some((s) => s.id === started.sessionId && s.managed && s.status === 'idle'));
    let p2 = await waitFor('echo', async () => { const p = await fc.transcript(cred.id, { sessionId: started.sessionId }); return p.messages.some((m) => m.text === 'echo: first task') && p; });
    await fc.steer(cred.id, started.sessionId, 'second message');
    p2 = await waitFor('steer echo', async () => { const p = await fc.transcript(cred.id, { sessionId: started.sessionId }); return p.messages.some((m) => m.text === 'echo: second message') && p; });
    assert.ok(p2.messages.length >= 4);
    await fc.interrupt(cred.id, started.sessionId);
    await waitFor('interrupt', async () => (await fc.transcript(cred.id, { sessionId: started.sessionId })).messages.some((m) => m.text === 'INTERRUPTED'));
    await assert.rejects(fc.steer(cred.id, EXT_ID, 'hi'), /started/, 'a session it did not start is not steered');
    await fc.stop(cred.id, started.sessionId);
    await waitFor('stopped session gone', () => !fc.summary(cred.id).sessions.some((s) => s.id === started.sessionId));

    // ---- the admin handler
    const sent = [];
    const ctx = { sendToClient: (ws, m) => sent.push(m), sendError: (ws, error, code) => sent.push({ error, code }) };
    await handler._handlers.handle(ctx, {}, { type: 'claude_fleet_contractors', action: 'list', requestId: 'r1' }, { userType: 'user' });
    assert.strictEqual(sent.pop().code, 'INSUFFICIENT_PERMISSIONS', 'non-admin refused');
    await handler._handlers.handle(ctx, {}, { type: 'claude_fleet_contractors', action: 'list', requestId: 'r2' }, { userType: 'admin' });
    const listMsg = sent.pop();
    assert.strictEqual(listMsg.type, 'claude_fleet_contractors_response');
    assert.ok(listMsg.data.contractors.some((c) => c.id === cred.id && c.online && c.sessions.length));
    assert.ok(!JSON.stringify(listMsg).includes(cred.secret));
    await handler._handlers.handle(ctx, {}, { type: 'claude_fleet_contractors', action: 'transcript', id: cred.id, sessionId: EXT_ID, requestId: 'r3' }, { userType: 'admin' });
    assert.strictEqual(sent.pop().data.messages.length, 2, 'transcript through the handler');
    await handler._handlers.handle(ctx, {}, { type: 'claude_fleet_contractors', action: 'invite', name: 'Win box', serverUrl: url, requestId: 'r4' }, { userType: 'admin', username: 'yukimi' });
    const invMsg = sent.pop();
    assert.ok(invMsg.data.invite.code && /--server/.test(invMsg.data.install.linux) && !invMsg.data.install.linux.includes(invMsg.data.invite.code), 'invite + install line without the code');
    await handler._handlers.handle(ctx, {}, { type: 'claude_fleet_contractors', action: 'revoke', id: invMsg.data.invite.id, requestId: 'r5' }, { userType: 'admin' });
    assert.strictEqual(sent.pop().data.invite, true, 'an invite can be cancelled');
    assert.strictEqual(fc.redeem(invMsg.data.invite.code), null);

    // installers: the agent inside, sh syntax, and a dry run of the generated one into a temp prefix
    const linux = await handler._handlers.installer('linux', url);
    assert.ok(linux.text.includes("embedded_agent() { cat <<'FLEET_AGENT_EOF'") && linux.text.includes('class MiniWs'));
    const inst = path.join(SANDBOX, 'dl', linux.filename);
    fs.mkdirSync(path.dirname(inst), { recursive: true });
    fs.writeFileSync(inst, linux.text);
    execFileSync('sh', ['-n', inst]);
    const prefix = path.join(SANDBOX, 'prefix');
    let dry = '';
    let tmuxThere = true;
    try { execFileSync('tmux', ['-V'], { stdio: 'ignore' }); } catch (_) { tmuxThere = false; }
    if (tmuxThere) {
        dry = execFileSync('sh', [inst, '--dry-run', '--prefix', prefix, '--name', 'Dry', '--project', PROJECT, '--claude', FAKE], { env: Object.assign({}, process.env, { HOME, FLEET_CONTRACTOR_HOME: path.join(SANDBOX, 'dryhome') }), encoding: 'utf8' });
        assert.ok(fs.readFileSync(path.join(prefix, 'agent.js'), 'utf8') === fs.readFileSync(AGENT, 'utf8'), 'the embedded agent is installed byte for byte');
        assert.ok(fs.readFileSync(path.join(prefix, 'claudeTranscript.js'), 'utf8') === fs.readFileSync(path.join(ROOT, 'modules', 'claudeTranscript.js'), 'utf8'));
        assert.ok(/ExecStart=.*agent\.js run/.test(fs.readFileSync(path.join(prefix, 'fleet-contractor.service'), 'utf8')), 'unit written');
        assert.ok(dry.includes(`--server ${url}`), 'the server URL baked into the installer is used');
        assert.ok(!fs.existsSync(path.join(SANDBOX, 'dryhome', 'credential.json')), 'a dry run does not pair');
    }
    const win = await handler._handlers.installer('windows', url);
    assert.ok(win.text.includes("$EmbeddedAgent = @'") && win.text.includes('class MiniWs') && win.text.includes('\r\n'));

    // ---- the tmux runner (Linux): start with Remote Control's link, steer, stop
    if (tmuxThere) {
        const agentMod = require('../scripts/contractor/agent');
        const tcfg = { projects: [PROJECT], claude: FAKE, permissionMode: 'bypassPermissions' };
        const noop = () => {};
        const t = await agentMod.startSession(tcfg, { cwd: PROJECT, prompt: 'tmux task', title: 'tmux test' }, noop);
        assert.strictEqual(t.link, 'https://claude.ai/code/session_TESTabcdefgh12345678', `link read from the pane: ${JSON.stringify(t)}`);
        const tid = t.sessionId;
        // the agent knows it from the transcript (no live record from the fake CLI)
        await agentMod.steer(tcfg, { sessionId: tid, text: 'typed in' }, noop);
        await waitFor('tmux steer', () => /got: typed in/.test(execFileSync('tmux', ['-L', TMUX_SOCKET, 'capture-pane', '-p', '-t', `fc-${tid.slice(0, 8)}`], { encoding: 'utf8' })));
        await agentMod.stopSession(tcfg, { sessionId: tid }, noop);
        let gone = false;
        try { execFileSync('tmux', ['-L', TMUX_SOCKET, 'has-session', '-t', `fc-${tid.slice(0, 8)}`], { stdio: 'ignore' }); } catch (_) { gone = true; }
        assert.ok(gone, 'stop ends the tmux session');
    }

    // ---- disconnect + revoke
    statuses.length = 0;
    const r = fc.revoke(cred.id);
    assert.strictEqual(r.revoked, true);
    const exit = await Promise.race([agent.done, sleep(8000).then(() => 'timeout')]);
    assert.strictEqual(exit, 0, `a revoked agent stops: ${agent.log}`);
    await waitFor('disconnected + revoked pushes', () => seen('revoked') && seen('disconnected'));
    assert.strictEqual(fc.isOnline(cred.id), false);
    assert.strictEqual(await rawUpgrade(port, { 'X-Dreamscape-Client': 'fleet-contractor/1' }), 404, 'no active contractor and no invite: the door is shut');
    const keepOpen = fc.createInvite('Keeps the door open', 'tester');
    assert.strictEqual(await wsClose(port, JSON.stringify({ type: 'auth', id: cred.id, secret: cred.secret })), 4401, 'a revoked credential is refused');
    fc.revoke(keepOpen.id);
    await assert.rejects(fc.sessions(cred.id), /not connected/);

    // ---- nothing secret in what the server logged
    console.log = origLog; console.warn = origWarn;
    const allLogs = logs.join('\n') + agent.log + pairer.log;
    assert.ok(!allLogs.includes(cred.secret), 'the secret is never logged');
    assert.ok(!allLogs.includes(inv.code) && !allLogs.includes(inv.code.toLowerCase()), 'the code is never logged');

    // too many failures from one address: the door answers 404
    fc.createInvite('Another', 'tester');
    for (let i = 0; i < 12; i += 1) await wsClose(port, JSON.stringify({ type: 'pair', code: 'ZZZZ-ZZZZ-ZZZZ' })).catch(() => {});
    assert.strictEqual(await rawUpgrade(port, { 'X-Dreamscape-Client': 'fleet-contractor/1' }), 404, 'rate limited after repeated failures');

    server.close();
    console.log('fleet contractors: all tests passed');
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
