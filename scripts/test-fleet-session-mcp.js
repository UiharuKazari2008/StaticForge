'use strict';

// Fleet sessions' own Dreamscape MCP identity (#1199): modules/claudeSessionLauncher.js writes a per-session
// --mcp-config (the `dreamscape` server with a headersHelper, agent-coord only as the fallback) and
// scripts/fleet-mcp-headers.js prints the request headers. Sandboxed: a temp state dir, a fake tmux runner, a
// stubbed fleetMcpIdentity and stubbed account runtime helpers, so nothing real runs.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-fleet-mcp-test-'));
const HOME = path.join(SANDBOX, 'home');
const STATE = path.join(SANDBOX, 'state');
process.env.DREAMSCAPE_CLAUDE_HOME = HOME;
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = path.join(SANDBOX, 'store');
process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET = 'ds-fleet-mcp-test';
process.env.DREAMSCAPE_CLAUDE_DESK_STATE = STATE;
process.env.DREAMSCAPE_CLAUDE_CLI = '/opt/test/claude';
process.env.AGENT_COORD_DB = path.join(SANDBOX, 'coord', 'coord.db');
delete process.env.DREAMSCAPE_CLAUDE_RC_READONLY;
process.on('exit', () => { try { fs.rmSync(SANDBOX, { recursive: true, force: true }); } catch (_) { /* gone */ } });

const runtime = require('../modules/claudeAccountRuntime');
const launcher = require('../modules/claudeSessionLauncher');
const claudeSessions = require('../modules/claudeSessions');
const misaka = require('../modules/misakaSessions');

const RAW_KEY = 'ds_mcp_RAWKEYMATERIAL0123456789abcdef';
const URL_OK = 'http://127.0.0.1:3000/11111111-2222-4333-8444-555555555555/mcp';
const HELPER = path.join(__dirname, 'fleet-mcp-headers.js');
let coordOk = false;
let mcpUrlValue = URL_OK;
let ensureFails = false;
const ensured = [];
const kindOf = { 'bbbbbbbb-0000-4000-8000-000000000002': 'item' };
const stub = {
    FLEET_SESSION_HEADER: 'x-fleet-session',
    keyFile: (kind) => path.join(SANDBOX, `${kind}.key`),
    async ensureFleetKey(gr, kind) {
        ensured.push(kind);
        if (ensureFails) throw new Error('no key today');
        return { kind, label: `Fleet ${kind}`, keyFile: path.join(SANDBOX, `${kind}.key`) };
    },
    mcpUrl: () => mcpUrlValue,
    // like the real one: a session id of a work item is 'item' also when only the id is asked (resume)
    sessionKind: (id, workId) => { if (workId) kindOf[id] = 'item'; return kindOf[id] || 'fleet'; }
};
launcher._setFleetIdentity(stub);
runtime.ensureCoordMcp = async () => coordOk;
runtime.ensureGiteaMcp = async () => false;
runtime.ensureAskHook = async () => false;

const calls = [];
const up = new Set();
launcher._setRunner(async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'systemd-run') return { code: 0, stdout: '', stderr: '' };
    if (cmd !== 'tmux') return { code: 1, stdout: '', stderr: 'unexpected' };
    const a = args[0] === '-L' ? args.slice(2) : args;
    if (a[0] === 'show') return { code: 0, stdout: 'exit-empty off', stderr: '' };
    if (['set', 'start-server', 'send-keys', 'list-sessions'].includes(a[0])) return { code: 0, stdout: '', stderr: '' };
    if (a[0] === 'has-session') return { code: up.has(a[2].replace(/^=/, '')) ? 0 : 1, stdout: '', stderr: '' };
    if (a[0] === 'new-session') { up.add(a[a.indexOf('-s') + 1]); return { code: 0, stdout: '', stderr: '' }; }
    if (a[0] === 'kill-session') { up.delete(a[2].replace(/^=/, '')); return { code: 0, stdout: '', stderr: '' }; }
    if (a[0] === 'capture-pane') return { code: 0, stdout: 'Remote Control is active. Continue at https://claude.ai/code/session_01TESTabcdefgh', stderr: '' };
    return { code: 1, stdout: '', stderr: 'unexpected tmux' };
});

const cwd = path.join(HOME, 'repo');
fs.mkdirSync(cwd, { recursive: true });
fs.mkdirSync(path.join(HOME, '.claude', 'sessions'), { recursive: true });
const sessionFile = (id) => path.join(STATE, 'fleet-mcp-sessions', `${id}.json`);
const lastCommand = () => { const ns = calls.filter((c) => c[0] === 'tmux' && c.includes('new-session')).pop(); return ns[ns.length - 1]; };
const mcpConfigOf = (cmd) => { const m = /--mcp-config (?:'([^']+)'|([^\s;]+))/.exec(cmd); return m ? (m[1] || m[2]) : null; };
const opts = (extra) => Object.assign({ cwd, host: 'dreamscape', pollMs: 5, timeoutMs: 500, remoteControl: true }, extra);
function writeTranscript(id) {
    const dir = path.join(HOME, '.claude', 'projects', '-test-repo');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), JSON.stringify({ type: 'user', cwd, sessionId: id, message: { role: 'user', content: 'hi' } }) + '\n');
}

(async () => {
    // 1. start(): a Fleet session without a work item -> kind fleet; the file, its mode, the args
    calls.length = 0;
    const s1 = await launcher.start({}, opts({ prompt: 'one' }));
    assert.strictEqual(s1.state, 'connected');
    const cmd1 = lastCommand();
    const f1 = sessionFile(s1.id);
    assert.strictEqual(mcpConfigOf(cmd1), f1, cmd1);
    assert.ok(!cmd1.includes('--strict-mcp-config'));
    assert.strictEqual(fs.statSync(f1).mode & 0o777, 0o600);
    assert.strictEqual(fs.statSync(path.dirname(f1)).mode & 0o777, 0o700);
    const cfg1 = JSON.parse(fs.readFileSync(f1, 'utf8'));
    assert.deepStrictEqual(Object.keys(cfg1.mcpServers).sort(), ['agent-coord', 'dreamscape'], 'coord fallback while it is not at user scope');
    const d1 = cfg1.mcpServers.dreamscape;
    assert.strictEqual(d1.type, 'http');
    assert.strictEqual(d1.url, URL_OK);
    assert.strictEqual(d1.headersHelper, [process.execPath, HELPER, path.join(SANDBOX, 'fleet.key'), s1.id].map((p) => `'${p}'`).join(' '));
    assert.deepStrictEqual(ensured, ['fleet']);
    for (const text of [fs.readFileSync(f1, 'utf8'), cmd1, JSON.stringify(calls)]) assert.ok(!text.includes(RAW_KEY), 'no key material anywhere');
    console.log('ok 1 start writes the per-session MCP config (kind fleet)');

    // 2. a work item -> kind item; coordOk true -> no agent-coord entry
    coordOk = true;
    const s2 = await launcher.start({}, opts({ workId: 'w-1' }));
    const cfg2 = JSON.parse(fs.readFileSync(sessionFile(s2.id), 'utf8'));
    assert.deepStrictEqual(Object.keys(cfg2.mcpServers), ['dreamscape']);
    assert.ok(cfg2.mcpServers.dreamscape.headersHelper.includes(`'${path.join(SANDBOX, 'item.key')}'`));
    assert.strictEqual(ensured[ensured.length - 1], 'item');
    assert.strictEqual(mcpConfigOf(lastCommand()), sessionFile(s2.id));
    console.log('ok 2 workId -> kind item, agent-coord only when coordOk is false');

    // 3. unchanged content is not rewritten
    const m0 = fs.statSync(sessionFile(s2.id)).mtimeMs;
    await new Promise((r) => setTimeout(r, 20));
    up.clear();
    await launcher.resume({}, s2.id, { pollMs: 5, timeoutMs: 500 }).catch(() => {}); // no transcript yet: rejects
    writeTranscript(s2.id);
    calls.length = 0;
    const r2 = await launcher.resume({}, s2.id, { pollMs: 5, timeoutMs: 500 });
    assert.strictEqual(r2.state, 'connected');
    assert.strictEqual(mcpConfigOf(lastCommand()), sessionFile(s2.id), 'resume of a Fleet-started session reuses its file');
    assert.strictEqual(fs.statSync(sessionFile(s2.id)).mtimeMs, m0, 'identical content is not rewritten');
    console.log('ok 3 resume of a Fleet session reuses the file');

    // 4. resume() of an item-kind session with no file yet (sessionKind says item) gets one; an unknown session gets none
    const ITEM = 'bbbbbbbb-0000-4000-8000-000000000002';
    const PLAIN = 'cccccccc-0000-4000-8000-000000000003';
    writeTranscript(ITEM);
    writeTranscript(PLAIN);
    up.clear(); calls.length = 0;
    await launcher.resume({}, ITEM, { pollMs: 5, timeoutMs: 500 });
    assert.strictEqual(mcpConfigOf(lastCommand()), sessionFile(ITEM));
    up.clear(); calls.length = 0;
    coordOk = true;
    await launcher.resume({}, PLAIN, { pollMs: 5, timeoutMs: 500 });
    assert.strictEqual(mcpConfigOf(lastCommand()), null, 'an unknown session resumes as before');
    assert.ok(!fs.existsSync(sessionFile(PLAIN)));
    coordOk = false;
    up.clear(); calls.length = 0;
    await launcher.resume({}, PLAIN, { pollMs: 5, timeoutMs: 500 });
    assert.ok(!fs.existsSync(sessionFile(PLAIN)));
    const plainCfg = mcpConfigOf(lastCommand());
    assert.strictEqual(plainCfg, path.join(STATE, 'launch-mcp.json'), 'only today\'s coord fallback file');
    assert.deepStrictEqual(Object.keys(JSON.parse(fs.readFileSync(plainCfg, 'utf8')).mcpServers), ['agent-coord']);
    console.log('ok 4 resume of an item session gets a file, an unknown one does not');

    // 5. takeover(): a Remote Control server's session (Yukimi's) keeps "Claude Code": no fleet file even if the id has one
    const TAKE = s1.id; // has a fleet file from step 1: still none for a takeover
    const child = spawn('sleep', ['60'], { stdio: 'ignore', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'CLAUDE_CONFIG_DIR')) });
    let gone = false;
    child.on('exit', () => { gone = true; });
    claudeSessions._setPidAlive((pid) => (pid === child.pid ? !gone : false));
    fs.writeFileSync(path.join(HOME, '.claude', 'sessions', `${child.pid}.json`), JSON.stringify({ pid: child.pid, sessionId: TAKE, cwd, status: 'idle', tmux: 'claude-rc:@1.%1', bridgeSessionId: 'x' }));
    writeTranscript(TAKE);
    up.clear(); calls.length = 0;
    coordOk = true;
    const t = await launcher.takeover({}, TAKE);
    assert.strictEqual(t.state, 'connected');
    assert.strictEqual(mcpConfigOf(lastCommand()), null, 'takeover gets no Fleet MCP identity');
    claudeSessions._setPidAlive(() => false);
    console.log('ok 5 takeover keeps the shared key');

    // 6. ensureFleetKey throws / no URL: launch still happens, only today's coord fallback
    for (const [why, setup] of [['key failure', () => { ensureFails = true; }], ['empty url', () => { ensureFails = false; mcpUrlValue = ''; }]]) {
        setup();
        coordOk = false;
        const warns = [];
        const w = console.warn; console.warn = (m) => warns.push(String(m));
        calls.length = 0;
        const s = await launcher.start({}, opts({}));
        console.warn = w;
        assert.strictEqual(s.state, 'connected', why);
        assert.ok(!fs.existsSync(sessionFile(s.id)), why);
        assert.strictEqual(mcpConfigOf(lastCommand()), path.join(STATE, 'launch-mcp.json'), why);
        assert.strictEqual(warns.filter((m) => m.includes('Fleet MCP identity')).length, 1, why);
        coordOk = true;
        calls.length = 0;
        await launcher.start({}, opts({}));
        assert.strictEqual(mcpConfigOf(lastCommand()), null, `${why}: nothing at all when coord is registered`);
    }
    ensureFails = false; mcpUrlValue = URL_OK;
    console.log('ok 6 identity failure never fails the launch');

    // 7. a Fat Misaka launch goes straight to misakaSessions: no key, no file, no Dreamscape MCP override
    {
        const before = ensured.length;
        const saw = [];
        const real = { launch: misaka.launch, resolveHost: misaka.resolveHost };
        misaka.resolveHost = async () => ({ host: 'misaka' });
        misaka.launch = async (gr, o) => { saw.push(o); return { id: o.id, state: 'running' }; };
        try {
            calls.length = 0;
            const r = await launcher.start({}, { cwd, host: 'misaka' });
            assert.strictEqual(r.state, 'running');
        } finally { Object.assign(misaka, real); }
        assert.strictEqual(saw.length, 1);
        assert.strictEqual(saw[0].host, 'misaka');
        assert.ok(!fs.existsSync(sessionFile(saw[0].id)));
        assert.strictEqual(ensured.length, before, 'no Fleet key minted for a misaka launch');
        assert.ok(!calls.some((c) => c.includes('new-session')), 'no local tmux session');
    }
    console.log('ok 7 misaka launches are untouched');

    // 8. the header helper, as Claude Code runs it
    {
        const keyFile = path.join(SANDBOX, 'helper.key');
        fs.writeFileSync(keyFile, `${RAW_KEY}\n`, { mode: 0o600 });
        const id = 'dddddddd-0000-4000-8000-000000000004';
        const ok = spawnSync(process.execPath, [HELPER, keyFile, id], { encoding: 'utf8' });
        assert.strictEqual(ok.status, 0, ok.stderr);
        assert.strictEqual(ok.stdout.trim().split('\n').length, 1);
        assert.deepStrictEqual(JSON.parse(ok.stdout), { Authorization: `Bearer ${RAW_KEY}`, 'X-Fleet-Session': id });
        assert.strictEqual(ok.stderr, '');
        for (const args of [[keyFile, 'not-a-uuid'], [path.join(SANDBOX, 'missing.key'), id], [keyFile], []]) {
            const bad = spawnSync(process.execPath, [HELPER, ...args], { encoding: 'utf8' });
            assert.strictEqual(bad.status, 1, args.join(' '));
            assert.strictEqual(bad.stdout, '');
            assert.ok(bad.stderr.length > 0 && !bad.stderr.includes(RAW_KEY));
        }
        fs.writeFileSync(keyFile, '\n');
        const empty = spawnSync(process.execPath, [HELPER, keyFile, id], { encoding: 'utf8' });
        assert.strictEqual(empty.status, 1);
        assert.strictEqual(empty.stdout, '');
    }
    console.log('ok 8 fleet-mcp-headers.js');
    console.log('all fleet session MCP tests passed');
})().catch((e) => { console.error(e); process.exit(1); });
