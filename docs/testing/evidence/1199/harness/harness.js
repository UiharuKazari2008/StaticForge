'use strict';
// #1199 acceptance harness. Run on the rack host as root:
//   NODE_PATH=$SP/deps/node_modules node harness.js --work-id <W> [--new-sessions]
// The REAL claudeSessionLauncher.start + the REAL fleetMcpIdentity (keys, per-session MCP config, headersHelper)
// against the replica's own application auth database. Only the account runtime helpers and tmux are stubbed.
// Never prints or writes key material anywhere but the 0600 key files the real code writes.

const fs = require('fs');
const path = require('path');

const SP = '/tmp/claude-1001/-srv-rack-replicas-fleet-37a93128-src/37a93128-a5db-44f8-9fb4-243b69174959/scratchpad';
const ACC = path.join(SP, 'acc');
const SRC = '/srv/rack/replicas/fleet-37a93128/src';
const DATA = '/srv/rack/replicas/fleet-37a93128/data';

process.env.DREAMSCAPE_CLAUDE_DESK_STATE = path.join(ACC, 'state');
process.env.DREAMSCAPE_CLAUDE_HOME = path.join(ACC, 'home');
process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR = path.join(ACC, 'store');
process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET = 'acc1199';
process.env.DREAMSCAPE_CLAUDE_CLI = '/home/agents/.local/bin/claude';
process.env.AGENT_COORD_DB = path.join(ACC, 'coord', 'coord.db');
delete process.env.DREAMSCAPE_CLAUDE_RC_READONLY;
delete process.env.DREAMSCAPE_REPLICA;

const STATE = process.env.DREAMSCAPE_CLAUDE_DESK_STATE;
const HOME = process.env.DREAMSCAPE_CLAUDE_HOME;
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const workId = arg('--work-id');
const newSessions = flag('--new-sessions');
const SESSIONS_FILE = path.join(ACC, 'sessions.json');
const KEYS_FILE = path.join(ACC, 'keys.json');
const CREATED_FILE = path.join(ACC, 'created-keys.json');

const log = (...a) => process.stderr.write(`${a.join(' ')}\n`);

(async () => {
    const runtime = require(path.join(SRC, 'modules/claudeAccountRuntime'));
    const launcher = require(path.join(SRC, 'modules/claudeSessionLauncher'));
    const { initializeApplicationAuthDatabase } = require(path.join(SRC, 'modules/applicationAuthDatabase'));

    // 1. the replica's application auth database, then the manager (in that order)
    const okDb = await initializeApplicationAuthDatabase(path.join(DATA, '.cache'));
    if (!okDb) throw new Error('application auth database did not initialise');
    const { ApplicationAuthManager } = require(path.join(SRC, 'modules/applicationAuthManager'));
    const manager = new ApplicationAuthManager({});

    // 2. gr
    const secure = JSON.parse(fs.readFileSync(path.join(DATA, 'secure.config.json'), 'utf8'));
    const mcpPathUuid = secure.mcpPathUuid;
    if (!mcpPathUuid || typeof mcpPathUuid !== 'string') throw new Error('no mcpPathUuid in secure.config.json');
    const gr = {
        getApplicationAuthManager: () => manager,
        getMcpPathUuid: () => mcpPathUuid,
        getConfig: ({ path: p }) => (p === 'port' ? 9302 : undefined)
    };

    // 3. stubs (no Claude config folder touched), fake tmux
    runtime.ensureCoordMcp = async () => true;
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
    const opts = (extra) => Object.assign({ cwd, host: 'dreamscape', pollMs: 5, timeoutMs: 500, remoteControl: true }, extra);
    const lastCommand = () => { const ns = calls.filter((c) => c[0] === 'tmux' && c.includes('new-session')).pop(); return ns ? ns[ns.length - 1] : ''; };
    const mcpConfigOf = (cmd) => { const m = /--mcp-config (?:'([^']+)'|([^\s;]+))/.exec(cmd); return m ? (m[1] || m[2]) : null; };

    // 4. the two sessions (kept across runs unless --new-sessions)
    let sessions = null;
    if (!newSessions) {
        try { sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8')); } catch (_) { sessions = null; }
    }
    if (sessions && sessions.fleet && sessions.item && fs.existsSync(sessions.fleet.config) && fs.existsSync(sessions.item.config)) {
        log('sessions.json kept; config files exist');
        // re-run the real key check: reuses the key files when valid, mints only when they are gone
        const identKeep = require(path.join(SRC, 'modules/fleetMcpIdentity'));
        for (const kind of ['fleet', 'item']) { const r = await identKeep.ensureFleetKey(gr, kind); log('ensureFleetKey', kind, r.label); }
    } else {
        if (!workId) throw new Error('--work-id <W> is required to start the sessions');
        const s1 = await launcher.start(gr, opts({ title: 'Fix the tray clock', prompt: 'acceptance run for #1199' }));
        if (s1.state !== 'connected') throw new Error(`fleet start: ${s1.state} ${s1.message}`);
        const cmd1 = lastCommand();
        const cfg1 = mcpConfigOf(cmd1);
        const s2 = await launcher.start(gr, opts({ title: 'Remote Access notice says Fleet', prompt: 'acceptance run for #1199', workId: Number(workId) }));
        if (s2.state !== 'connected') throw new Error(`item start: ${s2.state} ${s2.message}`);
        const cmd2 = lastCommand();
        const cfg2 = mcpConfigOf(cmd2);
        if (!cfg1 || !cfg2) throw new Error('a launch command carries no --mcp-config');
        sessions = {
            fleet: { id: s1.id, title: 'Fix the tray clock', config: cfg1, commandLine: cmd1 },
            item: { id: s2.id, title: 'Remote Access notice says Fleet', workId: Number(workId), config: cfg2, commandLine: cmd2 }
        };
        fs.writeFileSync(SESSIONS_FILE, `${JSON.stringify(sessions, null, 2)}\n`, { mode: 0o600 });
        log('started', s1.id, s2.id);
    }

    // 5. the comparison key
    const ident = require(path.join(SRC, 'modules/fleetMcpIdentity'));
    const CC_UA = 'claude-code/2.1.332 (sdk-cli)';
    const ccFile = path.join(STATE, 'compare', 'claude-code.key');
    let ccId = null;
    try {
        const raw = fs.readFileSync(ccFile, 'utf8').trim();
        if (raw) {
            const v = await manager.validateApplicationKey(raw, CC_UA, { skipUserAgent: true });
            if (v.valid && v.appName === 'Claude Code') ccId = v.applicationKeyId;
        }
    } catch (_) { /* mint below */ }
    if (!ccId) {
        const c = await manager.createApplicationKey({
            appName: 'Claude Code', userAgent: CC_UA,
            scopes: require(path.join(SRC, 'modules/directorAppKeyScopes')).FLEET_MCP_SCOPES.slice(),
            userType: 'admin', expiresAt: null, refreshIntervalDays: 3650
        });
        fs.mkdirSync(path.dirname(ccFile), { recursive: true, mode: 0o700 });
        fs.writeFileSync(ccFile, c.key, { mode: 0o600 });
        ccId = c.summary.id;
        log('comparison key minted');
    } else {
        log('comparison key reused');
    }
    fs.chmodSync(ccFile, 0o600);

    // key ids of the two Fleet keys (from the key files the real code wrote; ids are not secrets)
    const idOf = async (file, ua) => {
        const raw = fs.readFileSync(file, 'utf8').trim();
        const v = await manager.validateApplicationKey(raw, ua, { skipUserAgent: true });
        return v.valid ? v.applicationKeyId : null;
    };
    const created = {
        fleet: await idOf(ident.keyFile('fleet'), ident.FLEET_KEY_UA),
        item: await idOf(ident.keyFile('item'), ident.FLEET_KEY_UA),
        compare: ccId
    };
    fs.writeFileSync(CREATED_FILE, `${JSON.stringify(created, null, 2)}\n`, { mode: 0o600 });

    // 6. keys.json (safe fields only)
    const all = await manager.listApplicationKeys({ includeExpired: true });
    const safe = all.map((k) => ({ id: k.id, appName: k.appName, userAgent: k.userAgent, scopes: k.scopes, status: k.status, userType: k.userType, createdAt: k.createdAt }));
    fs.writeFileSync(KEYS_FILE, `${JSON.stringify(safe, null, 2)}\n`, { mode: 0o600 });

    log('keys', safe.length, 'fleet', String(created.fleet).slice(0, 8), 'item', String(created.item).slice(0, 8), 'compare', String(ccId).slice(0, 8));
    for (const f of [ident.keyFile('fleet'), ident.keyFile('item'), ccFile]) log(path.basename(f), (fs.statSync(f).mode & 0o777).toString(8));
    setTimeout(() => process.exit(0), 300);
})().catch((e) => { process.stderr.write(`failed ${e.stack}\n`); process.exit(1); });
