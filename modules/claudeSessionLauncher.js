'use strict';

/**
 * Starting, resuming and steering Claude sessions from Claude Accounts on the desktop (apps/claudedesk).
 * Shares claudeSessions.js (the phone's Sessions tab): the same tmux socket, the same rc-<id8> session
 * names, the same live-session records, so either app sees and ends what the other started.
 *
 *   start({ cwd, prompt, title, account, mode })   a new session: `claude --session-id <new uuid>
 *                                       --remote-control <title> --permission-mode <mode> [prompt]`
 *   resume(id, { account, mode, title })          a session that is not running, back in Remote Control
 *                                       (`--resume <uuid>`, no fork)
 *   steer(id, text)                    types a message into a running session's terminal (tmux); Claude
 *                                       Code takes it as the next prompt, or as steering while it works
 *   interrupt(id)                      Esc in its terminal (stops the current turn)
 *
 * Every session started here: Remote Control on (Yukimi watches them on claude.ai/code), the agent-coord
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
const { execFile } = require('child_process');
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
function defaultRunner(cmd, args, opts) {
    return new Promise((resolve) => {
        execFile(cmd, args, { env: userEnv(), timeout: (opts && opts.timeout) || 15000, maxBuffer: 512 * 1024 }, (error, stdout, stderr) => {
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
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
    const unset = STRIP_ENV.filter((k) => !(k in (parts.env || {}))).map((k) => `-u ${k}`);
    const args = parts.args.map((a) => (/^[A-Za-z0-9_./:=@%+-]+$/.test(a) ? a : shq(a))).join(' ');
    return `env ${unset.join(' ')} ${envs.join(' ')} ${shq(parts.bin)} ${args}; sleep 3600`.replace(/\s+/g, ' ');
}

async function watch(name, opts = {}) {
    const until = Date.now() + (opts.timeoutMs || WAIT_MS);
    let nudged = false;
    let trusted = false;
    let link = '';
    while (Date.now() < until) {
        await new Promise((res) => setTimeout(res, opts.pollMs || POLL_MS));
        const p = await tmux(['capture-pane', '-p', '-J', '-t', `=${name}:`, '-S', '-80']);
        if (p.code !== 0) return { state: 'failed', link: '', message: 'It ended right after starting' };
        const text = p.stdout || '';
        link = claudeSessions._text.paneLink(text) || link;
        if (FAIL_RE.test(text)) {
            await tmux(['kill-session', '-t', `=${name}`]);
            return { state: 'failed', link: '', message: cleanTitle(text.split('\n').find((l) => FAIL_RE.test(l)), 160) };
        }
        if (RC_ACTIVE_RE.test(text)) {
            if (!link) link = linkOf(name);
            return { state: 'connected', link, message: nudged ? 'In Remote Control (reconnected with /remote-control)' : 'In Remote Control' };
        }
        if (!trusted && /Do you trust the files in this folder|Is this a project you (?:created|trust)/i.test(text)) {
            // a folder this account has not trusted yet (its first option is Yes): started here on purpose
            trusted = true;
            await tmux(['send-keys', '-t', `=${name}:`, 'Enter']);
            continue;
        }
        if (!nudged && RC_NUDGE_RE.test(text)) {
            nudged = true;
            await tmux(['send-keys', '-t', `=${name}:`, '/remote-control', 'Enter']);
        }
    }
    return { state: 'started', link: link || linkOf(name), message: 'Running, but Remote Control did not say it is active yet' };
}

function linkOf(name) {
    const l = claudeSessions.liveSessions().find((s) => s.tmuxSession === name && s.link);
    return l ? l.link : '';
}

async function launch(gr, o) {
    if (readOnly()) throw new Error('Sessions are read-only on this instance');
    const cwd = String(o.cwd || '');
    let isDir = false;
    try { isDir = path.isAbsolute(cwd) && (await fs.promises.stat(cwd)).isDirectory(); } catch (_) { isDir = false; }
    if (!isDir) throw new Error(`The folder ${cwd || '(none)'} is not on the host`);
    const mode = MODES.has(o.mode) ? o.mode : DEFAULT_MODE;
    const { env, account } = await accountEnv(gr, o.account);
    if (account) env.AGENT_COORD_ACCOUNT = account.name;
    const title = cleanTitle(o.title, 60) || o.id.slice(0, 8);
    const args = [o.resume ? '--resume' : '--session-id', o.id, '--remote-control', title, '--permission-mode', mode, '--mcp-config', await mcpConfigFile()];
    if (!o.resume && o.prompt) args.push('--', String(o.prompt).slice(0, 20000));
    const name = tmuxName(o.id);
    await ensureServer();
    if ((await tmux(['has-session', '-t', `=${name}`])).code === 0) {
        if (claudeSessions.liveSessions().some((s) => s.tmuxSession === name)) return Object.assign({ id: o.id, tmuxSession: name, account }, await watch(name, o));
        await tmux(['kill-session', '-t', `=${name}`]);
    }
    const r = await tmux(['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, commandLine({ env, bin: cliPath(), args })]);
    if (r.code !== 0) return { id: o.id, tmuxSession: name, account, state: 'failed', link: '', message: `Could not start it: ${cleanTitle(r.stderr, 120) || 'tmux failed'}` };
    coordNote({ id: `claude-${o.id.slice(0, 8)}`, kind: 'claude', name: title, sessionId: o.id, account: account ? account.name : 'host', task: o.task || title, cwd, tmux: `${name} (${socket()})` });
    return Object.assign({ id: o.id, tmuxSession: name, account }, await watch(name, o));
}

/** A new session in a folder, with an optional first prompt. */
async function start(gr, opts = {}) {
    const id = crypto.randomUUID();
    const title = opts.title || (opts.prompt ? String(opts.prompt).split('\n')[0] : '') || path.basename(String(opts.cwd || '')) || 'Claude session';
    return launch(gr, { id, cwd: opts.cwd, prompt: opts.prompt, title, task: opts.prompt ? cleanTitle(opts.prompt, 200) : title, account: opts.account, mode: opts.mode, timeoutMs: opts.timeoutMs, pollMs: opts.pollMs });
}

async function findFile(id) {
    if (!SESSION_ID_RE.test(String(id || ''))) return null;
    const dir = path.join(process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(), '.claude', 'projects');
    let dirs = [];
    try { dirs = await fs.promises.readdir(dir); } catch (_) { return null; }
    for (const d of dirs) {
        const file = path.join(dir, d, `${id}.jsonl`);
        try { await fs.promises.access(file); return file; } catch (_) { /* next */ }
    }
    return null;
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
    return launch(gr, { id, resume: true, cwd, title: opts.title || id.slice(0, 8), task: opts.title, account: opts.account, mode: opts.mode, timeoutMs: opts.timeoutMs, pollMs: opts.pollMs });
}

// ---------------------------------------------------------------- steering

async function parentOf(pid) {
    try {
        const stat = await fs.promises.readFile(`/proc/${pid}/stat`, 'utf8');
        return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]) || 0;
    } catch (_) { return 0; }
}

/** The tmux pane a running session's claude process sits in: { args (socket), pane }. */
async function paneFor(id) {
    const live = claudeSessions.liveSessions().find((s) => s.id === id);
    if (!live) throw new Error('It is not running: resume it first');
    const chain = new Set([live.pid]);
    let p = live.pid;
    for (let i = 0; i < 4; i += 1) { p = await parentOf(p); if (p > 1) chain.add(p); }
    for (const sock of [['-L', socket()], []]) {
        const r = await runner('tmux', [...sock, 'list-panes', '-a', '-F', '#{pane_id} #{pane_pid}']);
        if (r.code !== 0) continue;
        const hit = r.stdout.trim().split('\n').map((l) => l.split(' ')).find(([, pid]) => chain.has(Number(pid)));
        if (hit) return { sock, pane: hit[0], live };
    }
    throw new Error(live.origin === 'server' ? 'It runs inside Remote Control itself: steer it from claude.ai/code' : 'It does not run in tmux: type into its own terminal');
}

/** Types text into a running session and presses Enter. */
async function steer(id, text) {
    if (readOnly()) throw new Error('Sessions are read-only on this instance');
    const body = String(text || '').replace(/\r\n?/g, '\n').trim();
    if (!body) throw new Error('Nothing to send');
    if (body.length > 20000) throw new Error('That message is too long (20,000 characters at most)');
    const { sock, pane, live } = await paneFor(id);
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

module.exports = { ensureServer, start, resume, steer, interrupt, screen, mcpConfigFile, findFile, _setRunner, _commandLine: commandLine, DEFAULT_MODE };
