'use strict';

/**
 * Starting, resuming and steering Claude sessions from Claude Accounts on the desktop (apps/claudedesk).
 * Shares claudeSessions.js (the phone's Sessions tab): the same tmux socket, the same rc-<id8> session
 * names, the same live-session records, so either app sees and ends what the other started.
 *
 *   start({ cwd, prompt, title, account, mode, model, effort, remoteControl })   a new session: `claude --session-id
 *                                       <new uuid> [--remote-control <title>] --permission-mode <mode>
 *                                       [--model <model>] [--effort <level>] [prompt]` (Yozora's
 *                                       claude_dispatch picks the model and effort, #1154). Remote Control is a
 *                                       choice (#1191, Yukimi Nov 25 2026): only remoteControl: true adds the flag;
 *                                       a new session without it runs in its tmux terminal (steerable from Fleet,
 *                                       not in claude.ai/code) and the answer is state 'running' with no link
 *   resume(id, { account, mode, title })          a session that is not running, back in Remote Control
 *                                       (`--resume <uuid>`, no fork)
 *   steer(id, text)                    types a message into a running session's terminal (tmux); Claude
 *                                       Code takes it as the next prompt, or as steering while it works
 *   interrupt(id)                      Esc in its terminal (stops the current turn)
 *
 * Every session started here: Remote Control when asked for (resume / takeover always bring it back), the agent-coord
 * MCP server (modules/agentCoord/mcpServer.js, through --mcp-config), registered in the coordination
 * store with its account and title, and run in a detached tmux session owned by this user on the
 * socket dreamscape-claude-carry. That tmux server is started in a systemd user scope of its own
 * (ensureServer), never as a child of the Dreamscape process or inside pm2's or claude-remote.service's
 * cgroup, and with exit-empty off: a Dreamscape restart, a pm2 restart or a Remote Control restart
 * leaves the sessions running.
 *
 * Accounts: account = an account index (CardSpace's Claude keys). The account on the host runs on the
 * host's login; any other runs with CLAUDE_CONFIG_DIR = its own config dir (claudeAccountRuntime.js),
 * so sessions on both accounts run at the same time. API keys in the server's environment never reach
 * a session (env -u).
 *
 * Overrides (tests): DREAMSCAPE_CLAUDE_CARRY_SOCKET (claudeSessions'), DREAMSCAPE_CLAUDE_CLI,
 * DREAMSCAPE_CLAUDE_DESK_STATE (where the MCP config file goes), _setRunner(fn).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const spawnHelper = require('./spawnHelper');
const claudeSessions = require('./claudeSessions');
const runtime = require('./claudeAccountRuntime');

const MODES = claudeSessions.MODES;
const SESSION_ID_RE = claudeSessions.SESSION_ID_RE;
const DEFAULT_MODE = 'bypassPermissions';
const WAIT_MS = 60 * 1000;
const POLL_MS = 1500;
const RC_ACTIVE_RE = claudeSessions._text.RC_ACTIVE_RE;
const RC_NUDGE_RE = claudeSessions._text.RC_NUDGE_RE;
const FAIL_RE = /No conversation found|Session .{0,40}not found|could not resume|Invalid session|Not logged in|Please run \/login|Invalid API key|OAuth token has expired/i;
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const MODEL_RE = /^[A-Za-z0-9][A-Za-z0-9._:\[\]-]{0,79}$/;
// Claude Code's own prompt is up (a session started without Remote Control has no "/remote-control is active" to wait for):
// the footer hints (mode line, shortcuts, "esc to interrupt" once a first prompt is running) or the input box glyph that is
// not a numbered menu choice (the folder-trust dialog's "> 1. Yes")
const READY_RE = /\? for shortcuts|shift\+tab to cycle|esc to interrupt|(?:bypass permissions|accept edits|plan mode|auto mode) on|^\s*[│|]?\s*[>❯]\s*(?!\d+[.)])\S?.*$/m;
const TRUST_RE = /Do you trust the files in this folder|Is this a project you (?:created|trust)/i;
const STRIP_ENV = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR', 'TMUX', 'TMUX_PANE'];

function socket() { return process.env.DREAMSCAPE_CLAUDE_CARRY_SOCKET || 'dreamscape-claude-carry'; }
function stateDir() { return process.env.DREAMSCAPE_CLAUDE_DESK_STATE || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents'); }
const readOnly = () => process.env.DREAMSCAPE_CLAUDE_RC_READONLY === '1';
const tmuxName = (id) => claudeSessions._text.tmuxName(id);
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

// ---------------------------------------------------------------- commands

function userEnv() {
    const env = Object.assign({}, process.env);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid != null && !env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    if (env.XDG_RUNTIME_DIR && !env.DBUS_SESSION_BUS_ADDRESS) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
    STRIP_ENV.forEach((k) => { delete env[k]; });
    return env;
}
// through the spawn helper process (modules/spawnHelper.js): forking the server itself blocked its loop
function defaultRunner(cmd, args, opts) {
    return spawnHelper.run(cmd, args, { env: userEnv(), timeout: (opts && opts.timeout) || 15000, maxBuffer: 512 * 1024 });
}
let runner = defaultRunner;
function _setRunner(fn) { runner = typeof fn === 'function' ? fn : defaultRunner; }
const tmux = (args, opts) => runner('tmux', ['-L', socket(), ...args], opts);

function cliPath() {
    if (process.env.DREAMSCAPE_CLAUDE_CLI) return process.env.DREAMSCAPE_CLAUDE_CLI;
    try { const b = require('./cursorDirector').findClaude(); if (b) return b; } catch (_) { /* below */ }
    return path.join(os.homedir(), '.local', 'bin', 'claude');
}

let serverReady = null;
/**
 * The carry tmux server, up, in a systemd user scope of its own (so no Dreamscape / pm2 / Remote
 * Control restart takes it down) and kept with no sessions (exit-empty off). Once per process unless
 * it went away.
 */
async function ensureServer() {
    if (serverReady) {
        const ok = await serverReady;
        if (ok && (await tmux(['list-sessions'])).code === 0) return true;
        if (ok && (await tmux(['show', '-g', 'exit-empty'])).code === 0) return true;
        serverReady = null;
    }
    serverReady = (async () => {
        if ((await tmux(['show', '-g', 'exit-empty'])).code === 0) {
            await tmux(['set', '-g', 'exit-empty', 'off']);
            return true;
        }
        const unit = `dreamscape-claude-carry-${Date.now().toString(36)}`;
        const r = await runner('systemd-run', ['--user', '--scope', '--quiet', '--collect', `--unit=${unit}`, 'tmux', '-L', socket(), 'start-server', ';', 'set', '-g', 'exit-empty', 'off'], { timeout: 20000 });
        if (r.code !== 0) {
            // no user manager reachable: a plain server (it still outlives the Node process: tmux daemonizes)
            console.warn(`[claudeLauncher] systemd-run failed (${(r.stderr || '').trim().slice(0, 120)}): starting tmux directly`);
            const p = await tmux(['start-server', ';', 'set', '-g', 'exit-empty', 'off']);
            return p.code === 0;
        }
        return true;
    })();
    return serverReady;
}

// ---------------------------------------------------------------- MCP config + coordination

/** The --mcp-config file every launched session gets: agent-coord (and nothing else of ours). */
async function mcpConfigFile() {
    const dir = stateDir();
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'launch-mcp.json');
    const cfg = {
        mcpServers: {
            'agent-coord': {
                type: 'stdio',
                command: process.execPath,
                args: [path.join(__dirname, 'agentCoord', 'mcpServer.js')],
                env: process.env.AGENT_COORD_DB ? { AGENT_COORD_DB: process.env.AGENT_COORD_DB } : {}
            }
        }
    };
    const body = JSON.stringify(cfg, null, 2);
    let cur = '';
    try { cur = await fs.promises.readFile(file, 'utf8'); } catch (_) { cur = ''; }
    if (cur !== body) await fs.promises.writeFile(file, body, { mode: 0o600 });
    return file;
}

function coordNote(fields) {
    try {
        const store = require('./agentCoord/store');
        store.upsertAgent(fields);
    } catch (e) {
        console.warn(`[claudeLauncher] coordination store: ${e.message}`);
    }
}

// ---------------------------------------------------------------- launching

function cleanTitle(t, n) { return claudeSessions.cleanTitle(t, n || 60); }

async function accountEnv(gr, account) {
    if (account === undefined || account === null || account === '' || account === 'host') return { env: {}, account: null };
    const cfg = await runtime.configFor(gr, account);
    if (!cfg) {
        const acc = require('./claudeAccountHost').listAccounts(gr).find((a) => a.index === Number(account));
        return { env: {}, account: acc ? { index: acc.index, name: acc.name, onHost: true } : null };
    }
    return { env: { CLAUDE_CONFIG_DIR: cfg.dir }, account: { index: cfg.index, name: cfg.name, onHost: false } };
}

function commandLine(parts) {
    const envs = Object.entries(parts.env || {}).map(([k, v]) => `${k}=${shq(v)}`);
    const keep = Object.assign({}, parts.env || {}, parts.envFileKeys || {});
    const unset = STRIP_ENV.filter((k) => !(k in keep)).map((k) => `-u ${k}`);
    const args = parts.args.map((a) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : shq(a))).join(' ');
    // an env file (0600) carries what must not be on a command line (another engine's bridge secret)
    const source = parts.envFile ? `set -a; . ${shq(parts.envFile)}; set +a; ` : '';
    // Every CLAUDE* / CLAUDECODE variable the tmux server happens to hold goes first (#1154, Nov 24: the carry
    // server was started from inside a Claude session, so every Fleet session inherited that session's id,
    // messaging token, bridge owner and CLAUDE_CODE_CHILD_SESSION: no transcripts, no session records). Only
    // what Fleet sets on purpose comes back; CLAUDE_CODE_FORCE_SESSION_PERSISTENCE keeps transcripts on.
    const clean = 'for v in $(env | sed -n "s/^\\(CLAUDE[A-Za-z0-9_]*\\)=.*/\\1/p"); do unset "$v"; done; ';
    return `${clean}${source}env ${unset.join(' ')} ${envs.join(' ')} CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 ${shq(parts.bin)} ${args}; sleep 3600`.replace(/\s+/g, ' ');
}

/**
 * Another engine for a session (#1154, Yukimi: "sending a request to another model like SloProxy and or
 * DeepSeek"): the Claude Code CLI talks to the Director's loopback bridge (tokenRouterBridge.js), which relays
 * to TokenRouter (DeepSeek V4.1 Flash by default) or a custom model provider (custom:<id>: SloProxy,
 * DeepInfra, DeepSeek). The account's own folder still carries Remote Control's login. Answers
 * { envFile, keys, model }: the env file (0600, one per session id, rewritten on every start) keeps the
 * bridge secret off the command line.
 */
async function engineEnv(gr, engine, model, effort, id) {
    const cmp = require('./customModelProviders');
    let resolvedModel = model;
    let providerId;
    if (engine === 'tokenrouter') {
        resolvedModel = model && !/^(sonnet|opus|haiku|fable)$/i.test(model) ? model : 'deepseek/deepseek-v4.1-flash';
    } else if (cmp.isEngine(engine)) {
        const row = cmp.requireReady(gr, engine);
        providerId = cmp.providerId(engine);
        resolvedModel = model && !/^(sonnet|opus|haiku|fable)$/i.test(model) ? model : cmp.preferredModel(row);
        if (!resolvedModel) throw new Error(`${row.name} has no default model: pick one`);
    } else throw new Error(`Unknown engine ${engine}`);
    const link = await require('./tokenRouterBridge').ensureBridge();
    const env = require('./cursorDirector')._test.tokenRouterCliEnv(link, { model: resolvedModel, effort: effort || undefined, lane: 'normal', providerId });
    const dir = path.join(stateDir(), 'session-env');
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, `${id}.env`);
    await fs.promises.writeFile(file, Object.entries(env).map(([k, v]) => `${k}=${shq(v)}`).join('\n') + '\n', { mode: 0o600 });
    await fs.promises.chmod(file, 0o600);
    return { envFile: file, keys: env, model: resolvedModel };
}

async function watch(name, opts = {}) {
    const until = Date.now() + (opts.timeoutMs || WAIT_MS);
    const rc = opts.remoteControl === true;
    let nudged = false;
    let trusted = false;
    let link = '';
    let polls = 0;
    while (Date.now() < until) {
        await new Promise((res) => setTimeout(res, opts.pollMs || POLL_MS));
        polls += 1;
        const p = await tmux(['capture-pane', '-p', '-J', '-t', `=${name}:`, '-S', '-80']);
        if (p.code !== 0) return { state: 'failed', link: '', message: 'It ended right after starting' };
        const text = p.stdout || '';
        link = claudeSessions._text.paneLink(text) || link;
        // a resumed session replays its conversation: an old "● Login expired · Please run /login" from history is not this
        // start failing (Nov 25 2026: moving sessions off an account whose login expired killed every resume on the new one)
        const failLine = text.split('\n').find((l) => FAIL_RE.test(l) && !(opts.resume && /^\s*[\u25cf\u23bf\u276f>]/.test(l)));
        if (failLine) {
            await tmux(['kill-session', '-t', `=${name}`]);
            return { state: 'failed', link: '', message: cleanTitle(failLine, 160) };
        }
        if (rc && RC_ACTIVE_RE.test(text)) {
            if (!link) link = linkOf(name);
            return { state: 'connected', link, message: nudged ? 'In Remote Control (reconnected with /remote-control)' : 'In Remote Control' };
        }
        const trustShown = TRUST_RE.test(text);
        if (!trusted && trustShown) {
            // a folder this account has not trusted yet (its first option is Yes): started here on purpose
            trusted = true;
            await tmux(['send-keys', '-t', `=${name}:`, 'Enter']);
            continue;
        }
        if (!rc) {
            // no Remote Control: nothing to wait for or to nudge; running as soon as the CLI shows its prompt (or its
            // session record is there, a few polls in, and no trust dialog is still waiting)
            const recordUp = polls >= 3 && !(trustShown && !trusted) && claudeSessions.liveSessions().some((s) => s.tmuxSession === name || (opts.id && s.id === opts.id));
            if ((READY_RE.test(text) && !(trustShown && !trusted)) || recordUp) return { state: 'running', link: '', message: 'Running (no Remote Control)' };
            continue;
        }
        if (!nudged && RC_NUDGE_RE.test(text)) {
            nudged = true;
            await tmux(['send-keys', '-t', `=${name}:`, '/remote-control', 'Enter']);
        }
    }
    if (!rc) return { state: 'running', link: '', message: 'Running (no Remote Control); its prompt was not seen in time' };
    return { state: 'started', link: link || linkOf(name), message: 'Running, but Remote Control did not say it is active yet' };
}

function linkOf(name) {
    const l = claudeSessions.liveSessions().find((s) => s.tmuxSession === name && s.link);
    return l ? l.link : '';
}

/**
 * The CLI's arguments for a launch (pure; mcpConfig is the --mcp-config file when agent-coord is not registered at user
 * scope). --remote-control <title> only when o.remoteControl === true (a new session's choice; resume / takeover pass true).
 */
function buildArgs(o, extra = {}) {
    const args = [o.resume ? '--resume' : '--session-id', o.id];
    if (o.remoteControl === true) args.push('--remote-control', extra.title);
    args.push('--permission-mode', MODES.has(o.mode) ? o.mode : DEFAULT_MODE);
    if (extra.mcpConfig) args.push('--mcp-config', extra.mcpConfig);
    if (o.model !== undefined && o.model !== null && o.model !== '') {
        if (!MODEL_RE.test(String(o.model))) throw new Error('That is not a model name (an alias like opus / sonnet, or a full model id)');
        args.push('--model', String(o.model));
    }
    if (o.effort !== undefined && o.effort !== null && o.effort !== '') {
        if (!EFFORTS.has(String(o.effort))) throw new Error('effort is low, medium, high, xhigh or max');
        args.push('--effort', String(o.effort));
    }
    if (!o.resume && o.prompt) args.push('--', String(o.prompt).slice(0, 20000));
    return args;
}

async function launch(gr, o) {
    if (readOnly()) throw new Error('Sessions are read-only on this instance');
    const cwd = String(o.cwd || '');
    let isDir = false;
    try { isDir = path.isAbsolute(cwd) && (await fs.promises.stat(cwd)).isDirectory(); } catch (_) { isDir = false; }
    if (!isDir) throw new Error(`The folder ${cwd || '(none)'} is not on the host`);
    const { env, account } = await accountEnv(gr, o.account);
    // Fleet sessions work on Yozora as Yozora (director.yozora), never as claude (Yukimi, Nov 24 2026: "all the
    // fleet system should use Yozora's token not Claude, pretty much only the host session should use that"):
    // git's credential helper for the Yozora host reads her token file at use (no token in the environment)
    const { yozoraGitEnv, YOZORA_LOGIN, YOZORA_TOKEN_FILE } = require('./xiLaunch');
    Object.assign(env, yozoraGitEnv(os.homedir()), { FLEET_SESSION: '1', YOZORA_LOGIN, YOZORA_TOKEN_FILE: path.join(os.homedir(), YOZORA_TOKEN_FILE) });
    if (account) env.AGENT_COORD_ACCOUNT = account.name;
    const title = cleanTitle(o.title, 60) || o.id.slice(0, 8);
    // agent-coord: user scope in the account's config dir / the host's (every session there has it, #1154);
    // a launch-only config only when that could not be registered
    const coordOk = await runtime.ensureCoordMcp(env.CLAUDE_CONFIG_DIR || null).catch(() => false);
    await runtime.ensureGiteaMcp(env.CLAUDE_CONFIG_DIR || null).catch(() => false); // yozora (gitea-mcp), user scope like agent-coord
    await runtime.ensureAskHook(env.CLAUDE_CONFIG_DIR || null).catch(() => false); // AskUserQuestion goes to Fleet / the phone
    const engine = o.engine && o.engine !== 'claude' ? String(o.engine) : '';
    let other = null;
    if (engine) {
        other = await engineEnv(gr, engine, o.model, o.effort, o.id);
        o = Object.assign({}, o, { model: other.model, effort: undefined }); // the bridge carries the effort
    }
    const args = buildArgs(o, { title, mcpConfig: coordOk ? null : await mcpConfigFile() });
    const name = tmuxName(o.id);
    await ensureServer();
    if ((await tmux(['has-session', '-t', `=${name}`])).code === 0) {
        if (claudeSessions.liveSessions().some((s) => s.tmuxSession === name)) return Object.assign({ id: o.id, tmuxSession: name, account }, await watch(name, o));
        await tmux(['kill-session', '-t', `=${name}`]);
    }
    const r = await tmux(['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, commandLine({ env, bin: cliPath(), args, envFile: other ? other.envFile : null, envFileKeys: other ? other.keys : null })]);
    if (r.code !== 0) return { id: o.id, tmuxSession: name, account, state: 'failed', link: '', message: `Could not start it: ${cleanTitle(r.stderr, 120) || 'tmux failed'}` };
    coordNote({ id: `claude-${o.id.slice(0, 8)}`, kind: 'claude', name: title, sessionId: o.id, account: account ? account.name : 'host', task: o.task || title, cwd, tmux: `${name} (${socket()})`, model: engine ? `${engine} ${o.model}` : (o.model || ''), effort: o.effort || '', dispatchedBy: o.dispatchedBy || '' });
    return Object.assign({ id: o.id, tmuxSession: name, account, engine: engine || 'claude', model: o.model || null, effort: o.effort || null }, await watch(name, o));
}

/** A new session in a folder, with an optional first prompt. */
async function start(gr, opts = {}) {
    const id = crypto.randomUUID();
    const title = opts.title || (opts.prompt ? String(opts.prompt).split('\n')[0] : '') || path.basename(String(opts.cwd || '')) || 'Claude session';
    return launch(gr, { id, cwd: opts.cwd, prompt: opts.prompt, title, task: opts.prompt ? cleanTitle(opts.prompt, 200) : title, account: opts.account, mode: opts.mode, model: opts.model, effort: opts.effort, engine: opts.engine, remoteControl: opts.remoteControl === true, dispatchedBy: opts.dispatchedBy, timeoutMs: opts.timeoutMs, pollMs: opts.pollMs });
}

/** A session's transcript file; a conversation handed on to another session id (`continued-in`) is followed (claudeSessions). */
async function findFile(id) {
    if (!SESSION_ID_RE.test(String(id || ''))) return null;
    const t = claudeSessions._findTranscript(String(id));
    return t ? t.file : null;
}

async function cwdOf(file) {
    const fh = await fs.promises.open(file, 'r');
    try {
        const buf = Buffer.alloc(256 * 1024);
        const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
        const m = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(buf.toString('utf8', 0, bytesRead));
        return m ? JSON.parse(`"${m[1]}"`) : '';
    } finally { await fh.close(); }
}

/**
 * A session that is not running, back in Remote Control (no fork: the same session id continues).
 * Live already: its link (in Remote Control) or an error (running without it).
 */
async function resume(gr, id, opts = {}) {
    const file = await findFile(id);
    if (!file) throw new Error('No such Claude session');
    const live = claudeSessions.liveSessions().find((s) => s.id === id);
    if (live && live.remoteControl) return { id, state: 'live', link: live.link, tmuxSession: live.tmuxSession, message: 'Already in Remote Control' };
    if (live) throw new Error(`It is running already (${live.origin === 'server' ? 'Remote Control' : live.tmuxSession || 'a terminal'}) without Remote Control: type /remote-control there, or send it /remote-control from here`);
    const cwd = await cwdOf(file);
    return launch(gr, { id, resume: true, cwd, title: opts.title || id.slice(0, 8), task: opts.title, account: opts.account, mode: opts.mode, remoteControl: true, model: opts.model, effort: opts.effort, timeoutMs: opts.timeoutMs, pollMs: opts.pollMs });
}

/**
 * Takes a session Remote Control's own server spawned (from claude.ai / the app: Fleet cannot type into it)
 * over into Fleet (#1154, Yukimi: "sending a steering message does not seem to work in the session view ...
 * so I can stop using the Claude mobile app"): its process is ended, then the same session id is resumed
 * in a Fleet terminal (tmux rc-<id8>) on the same account, Remote Control still on (a new claude.ai link).
 */
async function takeover(gr, id) {
    if (readOnly()) throw new Error('Sessions are read-only on this instance');
    const live = claudeSessions.liveSessions().find((s) => s.id === id);
    if (!live) throw new Error('It is not running: Resume it instead');
    if (live.origin !== 'server') throw new Error('It already runs in a terminal Fleet can type into');
    // its account: the config dir it runs on (an account's own folder), else the host's login
    let account;
    if (live.configDir) {
        const accId = path.basename(path.dirname(live.configDir));
        const acc = require('./claudeAccountHost').listAccounts(gr).find((a) => a.id === accId);
        if (acc) account = acc.index;
    }
    const title = live.givenName || live.name || id.slice(0, 8);
    try { process.kill(live.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    const until = Date.now() + 15000;
    let killed = false;
    while (claudeSessions.pidAlive(live.pid) && Date.now() < until) {
        await new Promise((r) => setTimeout(r, 250));
        if (!killed && Date.now() > until - 5000) { killed = true; try { process.kill(live.pid, 'SIGKILL'); } catch (_) { /* gone */ } }
    }
    if (claudeSessions.pidAlive(live.pid)) throw new Error('Its Remote Control process did not end');
    const cwd = live.cwd || (await cwdOf(await findFile(id)));
    return launch(gr, { id, resume: true, cwd, title, task: title, account, remoteControl: true });
}

// ---------------------------------------------------------------- steering

async function parentOf(pid) {
    try {
        const stat = await fs.promises.readFile(`/proc/${pid}/stat`, 'utf8');
        return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) || 0;
    } catch (_) { return 0; }
}

async function isRemoteControlServer(pid) {
    try { return /\bremote-control\b/.test((await fs.promises.readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' ')) && !/--remote-control\b/.test((await fs.promises.readFile(`/proc/${pid}/cmdline`, 'utf8')).replace(/\0/g, ' ')); } catch (_) { return false; }
}

const NOT_RUNNING_MSG = 'It is not running: resume it first';
const notRunning = () => Object.assign(new Error(NOT_RUNNING_MSG), { code: 'NOT_RUNNING' });
const HOLDERS = new Set(['sleep', 'bash', 'sh', 'dash', 'zsh', 'fish', 'env']);

/**
 * Right before typing: is the record's pid still that session's claude (#1256)? A claude that exited leaves its tmux
 * pane on the wrapper's `sleep 3600`, and a record can outlive its process (pid reused). Async /proc reads only.
 */
async function claudeRunning(live) {
    let stat;
    try { stat = await fs.promises.readFile(`/proc/${live.pid}/stat`, 'utf8'); } catch (_) { return false; }
    if (live.procStart && stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] !== String(live.procStart)) return false;
    try {
        const argv0 = (await fs.promises.readFile(`/proc/${live.pid}/cmdline`, 'utf8')).split('\0')[0] || '';
        if (HOLDERS.has(path.basename(argv0))) return false;
    } catch (_) { return false; }
    return true;
}

/** The tmux pane a running session's claude process sits in: { args (socket), pane }. */
async function paneFor(id) {
    const live = claudeSessions.liveSessions().find((s) => s.id === id);
    if (!live) throw notRunning();
    // A session Remote Control's own server spawned (from claude.ai / the app) sits under that server's
    // process; the server's tmux pane is the SERVER's terminal (keys there toggle its spawn mode, show a QR
    // code). Never type into it (#1154: steering went to the server): such a session is taken over into
    // Fleet first (claude_desk_session takeover).
    if (live.origin === 'server') throw Object.assign(new Error('It runs inside Remote Control\'s server, which Fleet cannot type into: Take Over in Fleet to steer it from here (it continues the same conversation in a Fleet terminal), or steer it from claude.ai/code'), { code: 'NEEDS_TAKEOVER' });
    if (!(await claudeRunning(live))) throw notRunning();
    const chain = new Set([live.pid]);
    let p = live.pid;
    let underServer = false;
    for (let i = 0; i < 4; i += 1) {
        p = await parentOf(p);
        if (p <= 1) break;
        // the climb stops at a Remote Control server: its pane (and anything above it) is never a session's
        if (await isRemoteControlServer(p)) { underServer = true; break; }
        chain.add(p);
    }
    for (const sock of [['-L', socket()], []]) {
        const r = await runner('tmux', [...sock, 'list-panes', '-a', '-F', '#{pane_id} #{pane_pid}']);
        if (r.code !== 0) continue;
        const hit = r.stdout.trim().split('\n').map((l) => l.split(' ')).find(([, pid]) => chain.has(Number(pid)));
        if (hit) {
            // the pane holding on the wrapper's sleep (or a bare shell) has no claude in it: nothing would read the keys
            const cur = String((await runner('tmux', [...sock, 'display-message', '-p', '-t', hit[0], '#{pane_current_command}'])).stdout || '').trim();
            if (HOLDERS.has(cur)) throw notRunning();
            return { sock, pane: hit[0], live };
        }
    }
    if (underServer) throw Object.assign(new Error('It runs inside Remote Control\'s server: Take Over in Fleet to steer it from here'), { code: 'NEEDS_TAKEOVER' });
    throw new Error('It does not run in tmux: type into its own terminal');
}

/** The key hints Claude Code prints under a menu or confirmation that has taken over its input box. */
const DIALOG_RE = /(↑\/↓|↑↓)\s+(to\s+)?(choose|select|navigate)|\besc\s+(to\s+cancel|not\s+now)\b|\benter\s+(to\s+)?(confirm|select)\b|Not answered yet/i;
/** An offer Claude Code makes itself (autocompact size, tips): its hint line has "esc not now", and Esc keeps everything as it is. */
const OFFER_HINT_RE = /\besc\s+not\s+now\b/i;
/**
 * Menus Claude Code opens on its own (offers, tips, setup nags), answered for Yukimi with the choice that changes
 * nothing, so a message is never stuck behind one nobody sees. A question the agent's own work raised (a tool's
 * permission prompt, AskUserQuestion) is never in this list: those stay for her (Show Screen).
 */
const AUTO_ANSWER = [
    { question: /Make auto mode your default permission mode\?/i, choice: /^No, keep\b/i }
];
/** Any other self-made offer whose menu has a plain decline. */
const DECLINE_RE = /^(No, keep\b|Not now\b|Maybe later\b|Skip\b|No thanks\b|Don'?t show (this )?again\b)/i;
const NEVER_AUTO_RE = /\bDo you want to (proceed|make this edit|create|run|allow)\b|\bpermission to\b|\ballow\b.*\btool\b/i;

/**
 * The menu on a screen (non-empty lines, right-trimmed), or null: { question, options: [{ text, on }] }.
 * Claude Code draws the pointed option as "❯ text" and the others with their text in the same column; the
 * question's explanation sits further left, so the column tells options from prose.
 */
function readDialog(lines) {
    const tail = lines.map((l) => l.replace(/\s+$/, ''));
    const hint = tail.slice(-4).findIndex((l) => DIALOG_RE.test(l));
    if (hint < 0) return null;
    const end = tail.length - Math.min(4, tail.length) + hint;
    const lo = Math.max(0, end - 20);
    const pi = tail.slice(lo, end).findIndex((l) => /^\s*❯\s*\S/.test(l) && !/^\s*❯\s*$/.test(l));
    const options = [];
    let qi = -1;
    if (pi >= 0) {
        const p = lo + pi;
        const k = tail[p].indexOf('❯');
        const col = k + 1 + tail[p].slice(k + 1).search(/\S/);
        const isOpt = (l) => l.search(/\S/) === col;
        let top = p;
        while (top - 1 >= lo && isOpt(tail[top - 1])) top -= 1;
        for (let i = top; i < end && (i === p || isOpt(tail[i])); i += 1) {
            options.push({ text: tail[i].replace(/^\s*❯?\s*/, '').replace(/^\d+[.)]\s+/, '').trim(), on: i === p });
        }
        for (let i = top - 1; i >= lo; i -= 1) { if (/\?\s*$/.test(tail[i])) { qi = i; break; } }
    } else {
        for (let i = end - 1; i >= lo; i -= 1) { if (/\?\s*$/.test(tail[i])) { qi = i; break; } }
    }
    return { question: qi >= 0 ? tail[qi].trim() : '', options, hint: tail[end].trim() };
}

/** Answers a self-made menu with its no-change choice: true when it was answered and the input box is back. */
async function autoAnswer(sock, pane, dlg) {
    if (!dlg || NEVER_AUTO_RE.test(dlg.question)) return false;
    const known = AUTO_ANSWER.find((a) => a.question.test(dlg.question));
    const want = dlg.options.findIndex((o) => (known ? known.choice : DECLINE_RE).test(o.text));
    const at = dlg.options.findIndex((o) => o.on);
    if (want >= 0 && at >= 0) {
        const key = want > at ? 'Down' : 'Up';
        for (let i = 0; i < Math.abs(want - at); i += 1) await runner('tmux', [...sock, 'send-keys', '-t', pane, key]);
        await new Promise((res) => setTimeout(res, 80));
        await runner('tmux', [...sock, 'send-keys', '-t', pane, 'Enter']);
        console.log(`[claudeDesk] answered "${dlg.question.slice(0, 80)}" with "${dlg.options[want].text.slice(0, 60)}" before a message`);
    } else if (OFFER_HINT_RE.test(dlg.hint || '')) {
        // its own "not now": nothing changes (e.g. "Want to autocompact at 400k tokens instead?")
        await runner('tmux', [...sock, 'send-keys', '-t', pane, 'Escape']);
        console.log(`[claudeDesk] dismissed "${dlg.question.slice(0, 80)}" (esc not now) before a message`);
    } else return false;
    for (let i = 0; i < 10; i += 1) {
        await new Promise((res) => setTimeout(res, 150));
        if (!readDialog(await paneTail(sock, pane))) return true;
    }
    return false;
}

async function paneTail(sock, pane) {
    const shot = await runner('tmux', [...sock, 'capture-pane', '-p', '-J', '-t', pane, '-S', '-24']);
    return String(shot.stdout || '').split('\n').filter((l) => l.trim());
}

/** Types text into a running session and presses Enter. */
async function steer(id, text) {
    if (readOnly()) throw new Error('Sessions are read-only on this instance');
    const body = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!body) throw new Error('Nothing to send');
    if (body.length > 20000) throw new Error('That message is too long (20,000 characters at most)');
    const { sock, pane, live } = await paneFor(id);
    // A menu on its screen (such as "Make auto mode your default permission mode?") owns the keys: typed text
    // would be lost and its Enter would pick the highlighted choice. Claude Code's own offers are declined first;
    // anything else is refused with the question named (Show Screen opens the terminal to answer it).
    const dlg = readDialog(await paneTail(sock, pane));
    if (dlg && !(await autoAnswer(sock, pane, dlg))) {
        const q = dlg.question ? `"${require('./claudeTranscript').mask(dlg.question).slice(0, 160)}"` : 'a question';
        throw Object.assign(new Error(`Not sent: the session is showing ${q} in its terminal. Answer it there (Show Screen) first, then send again.`), { code: 'SESSION_DIALOG' });
    }
    // multi-line text goes in as one paste (bracketed), so a newline does not send it early
    const lines = body.split('\n');
    if (lines.length > 1) {
        const buf = `claude-desk-${process.pid}-${Date.now()}`;
        const r = await runner('tmux', [...sock, 'set-buffer', '-b', buf, '--', body]);
        if (r.code !== 0) throw new Error('Could not send it (tmux)');
        await runner('tmux', [...sock, 'paste-buffer', '-p', '-d', '-b', buf, '-t', pane]);
    } else {
        const r = await runner('tmux', [...sock, 'send-keys', '-t', pane, '-l', body]);
        if (r.code !== 0) throw new Error('Could not send it (tmux)');
    }
    await new Promise((res) => setTimeout(res, 120));
    await runner('tmux', [...sock, 'send-keys', '-t', pane, 'Enter']);
    return { id, sent: true, busy: live.status === 'busy', pane };
}

/** Esc: stops the session's current turn (what pressing Esc in its terminal does). */
async function interrupt(id) {
    if (readOnly()) throw new Error('Sessions are read-only on this instance');
    const { sock, pane } = await paneFor(id);
    await runner('tmux', [...sock, 'send-keys', '-t', pane, 'Escape']);
    return { id, interrupted: true };
}

/** The last lines of a running session's terminal, cleaned (what it shows now: a prompt, a question). */
async function screen(id) {
    const { sock, pane } = await paneFor(id);
    const r = await runner('tmux', [...sock, 'capture-pane', '-p', '-J', '-t', pane, '-S', '-40']);
    const lines = String(r.stdout || '').split('\n').map((l) => require('./claudeTranscript').mask(l).replace(/\s+$/, '')).filter((l, i, a) => l || (a[i - 1] && a[i - 1].trim()));
    return { id, lines: lines.slice(-40) };
}

/**
 * The command that attaches a terminal to a running session's tmux pane (Show Screen's live terminal,
 * modules/adminTerminal.js): { file, args, title }. Closing that terminal only detaches; the session runs on.
 */
async function attachCommand(id) {
    const { sock, pane, live } = await paneFor(id);
    const r = await runner('tmux', [...sock, 'display-message', '-p', '-t', pane, '#{session_name}']);
    const name = String(r.stdout || '').trim();
    if (r.code !== 0 || !name) throw new Error('Its terminal could not be found');
    return { file: 'tmux', args: [...sock, 'attach-session', '-t', `=${name}`], title: name, sessionId: live.id };
}

module.exports = { ensureServer, start, resume, takeover, steer, interrupt, screen, attachCommand, mcpConfigFile, findFile, _setRunner, _commandLine: commandLine, DEFAULT_MODE, EFFORTS, _test: { buildArgs, READY_RE, readDialog } };
