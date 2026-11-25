'use strict';

/**
 * Two Claude accounts at once (Claude Accounts on the desktop, Yukimi via Menma Nov 19: "run BOTH Claude
 * accounts at once for load balancing big build-outs"). The host's own login (~/.claude, the one Remote
 * Control and a plain `claude` use) is one account; any other account that has a linked claude.ai login
 * (claudeAccountHost) runs its sessions with CLAUDE_CONFIG_DIR set to its own config dir:
 *
 *   .cache/secrets/claude-accounts/<id>/config/     (0700, beside the account's linked login)
 *     .credentials.json   that account's claude.ai login (0600): the fresher of the linked copy and the
 *                         one the CLI keeps here (it rotates the refresh token as it runs)
 *     .claude.json        onboarding done, oauthAccount, and the host's per-project trust / tools / MCP
 *                         servers (merged in on every prepare; the CLI's own keys are kept)
 *     projects, sessions, settings.json, CLAUDE.md, skills, plugins, agents, commands
 *                         symlinks to ~/.claude: one set of transcripts and live-session records for the
 *                         whole host (Claude Accounts' Sessions lists both accounts' sessions as one), one
 *                         set of settings, skills and memory
 *
 * The refresh token rotates: whenever the CLI writes a newer login into a config dir, it is copied back
 * into the account's linked login (claudeHost.linkLogin), so a switch that puts this account on the host
 * signs in with the current token (watch()). The account that is on the host never gets a config dir
 * launch: its sessions use the host's login (configFor answers null), so one login is never held twice.
 *
 * Own folder (#1154, Yukimi Nov 24 2026: "all accounts are placed in a separate config folder ... so they
 * can all be open and running at the same time and all have remote access working independently"): an
 * account moved to its own folder (claudeRemoteFleet.moveToOwnFolder) has <id>/fleet.json and its own
 * Remote Control server on its config dir. Its sessions always use that dir, on the host or not
 * (configFor), and the host's ~/.claude login of a moved host account is a link to the dir's login, so
 * the one login is still held once. remote/, bridge-spawn/ and the policy-limit files are the account's
 * own (Remote Control's registration), never shared. Every config dir, and the host's, carries the
 * agent-coord MCP server at user scope (ensureCoordMcp), so every session on every account takes the
 * same locks.
 *
 * Nothing here returns or logs a token. Overrides (tests): DREAMSCAPE_CLAUDE_HOME (claudeAccountHost's),
 * DREAMSCAPE_CLAUDE_ACCOUNTS_DIR.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const claudeHost = require('./claudeAccountHost');

const SHARED = ['projects', 'sessions', 'settings.json', 'CLAUDE.md', 'skills', 'plugins', 'agents', 'commands', 'file-history'];
const PROJECT_KEYS = ['hasTrustDialogAccepted', 'allowedTools', 'mcpServers', 'enabledMcpjsonServers', 'disabledMcpjsonServers', 'hasClaudeMdExternalIncludesApproved', 'hasClaudeMdExternalIncludesWarningShown'];
const GLOBAL_KEYS = ['hasCompletedOnboarding', 'lastOnboardingVersion', 'installMethod', 'autoUpdates', 'remoteDialogSeen', 'hasUsedRemoteControl', 'bypassPermissionsModeAccepted', 'theme'];

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }
function hostDir() { return path.join(claudeHome(), '.claude'); }
function hostJson() { return path.join(claudeHome(), '.claude.json'); }

function accountDir(id) {
    if (!/^[0-9a-f]{16}$/.test(String(id || ''))) throw new Error('Invalid Claude account id');
    return path.join(claudeHost.storeDir(), id);
}
const configDir = (id) => path.join(accountDir(id), 'config');
const fleetFile = (id) => path.join(accountDir(id), 'fleet.json');

/** The account's own-folder record ({ movedAt, name, wasOnHost }), or null when it was never moved. */
function fleetInfo(id) {
    try {
        const v = JSON.parse(fs.readFileSync(fleetFile(id), 'utf8'));
        return v && v.movedAt ? v : null;
    } catch (_) { return null; }
}
const isMoved = (id) => !!fleetInfo(id);

async function writeFleetInfo(id, info) {
    await writeJsonAtomic(fleetFile(id), info, 0o600);
}

async function readJson(file) {
    try { return JSON.parse(await fs.promises.readFile(file, 'utf8')); } catch (_) { return null; }
}

async function writeJsonAtomic(file, value, mode) {
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.promises.writeFile(tmp, JSON.stringify(value, null, 2), { mode });
    await fs.promises.chmod(tmp, mode);
    await fs.promises.rename(tmp, file);
}

const expiresOf = (creds) => Number(creds && creds.claudeAiOauth && creds.claudeAiOauth.expiresAt) || 0;

/** The fresher of two logins (the later expiry: the CLI refreshed it). */
function fresher(a, b) {
    if (!(a && a.claudeAiOauth)) return b && b.claudeAiOauth ? b : null;
    if (!(b && b.claudeAiOauth)) return a;
    return expiresOf(b) > expiresOf(a) ? b : a;
}

async function ensureLink(target, link) {
    let cur = null;
    try { cur = await fs.promises.readlink(link); } catch (e) {
        if (e.code !== 'ENOENT' && e.code !== 'EINVAL') throw e;
        if (e.code === 'EINVAL') return; // a real file / dir the CLI made: kept
    }
    if (cur === target) return;
    if (cur !== null) await fs.promises.unlink(link);
    try { await fs.promises.access(target); } catch (_) { return; } // nothing on the host to share
    await fs.promises.symlink(target, link);
}

/**
 * Makes (or refreshes) the account's config dir. Answers { dir, email } or throws when the account has
 * no linked claude.ai login.
 */
async function prepare(id) {
    const dir = accountDir(id);
    const cdir = configDir(id);
    const linkedCreds = await readJson(path.join(dir, 'credentials.json'));
    const meta = (await readJson(path.join(dir, 'account.json'))) || {};
    const own = await readJson(path.join(cdir, '.credentials.json'));
    const creds = fresher(linkedCreds, own);
    if (!creds) throw new Error('This account has no linked claude.ai login: link one (Add Account or Link Host Login) first');
    await fs.promises.mkdir(cdir, { recursive: true, mode: 0o700 });
    await fs.promises.chmod(cdir, 0o700);
    if (creds !== own) await writeJsonAtomic(path.join(cdir, '.credentials.json'), { claudeAiOauth: creds.claudeAiOauth }, 0o600);
    for (const name of SHARED) await ensureLink(path.join(hostDir(), name), path.join(cdir, name));
    const host = (await readJson(hostJson())) || {};
    const cj = (await readJson(path.join(cdir, '.claude.json'))) || {};
    const before = JSON.stringify(cj);
    GLOBAL_KEYS.forEach((k) => { if (k in host && !(k in cj)) cj[k] = host[k]; });
    cj.hasCompletedOnboarding = true;
    if (meta.oauthAccount) cj.oauthAccount = meta.oauthAccount;
    cj.projects = cj.projects && typeof cj.projects === 'object' ? cj.projects : {};
    Object.entries(host.projects || {}).forEach(([p, v]) => {
        if (!v || typeof v !== 'object') return;
        const mine = cj.projects[p] && typeof cj.projects[p] === 'object' ? cj.projects[p] : {};
        PROJECT_KEYS.forEach((k) => { if (k in v) mine[k] = v[k]; });
        cj.projects[p] = mine;
    });
    // only when something changed: the account's own Remote Control CLI writes this file as it runs
    if (JSON.stringify(cj) !== before) await writeJsonAtomic(path.join(cdir, '.claude.json'), cj, 0o600);
    await ensureCoordMcp(cdir).catch((e) => console.warn(`[claudeRuntime] agent-coord: ${e.message}`));
    await ensureGiteaMcp(cdir).catch((e) => console.warn(`[claudeRuntime] yozora MCP: ${e.message}`));
    watch(id);
    return { dir: cdir, email: (meta.oauthAccount && meta.oauthAccount.emailAddress) || '' };
}

/**
 * The CLAUDE_CONFIG_DIR a session on this account runs with: null for the account that is on the host
 * (and for "host"), the prepared dir for any other.
 */
async function configFor(gr, index) {
    if (index === null || index === undefined || index === 'host') return null;
    const acc = claudeHost.listAccounts(gr).find((a) => a.index === Number(index));
    if (!acc) throw new Error('No such Claude account');
    if (acc.onHost && !isMoved(acc.id)) return null;
    if (!acc.remoteLogin) throw new Error(`${acc.name} has no linked claude.ai login: link one first (Remote Control and parallel sessions need it)`);
    const p = await prepare(acc.id);
    return Object.assign({ index: acc.index, name: acc.name, id: acc.id }, p);
}

// ---------------------------------------------------------------- agent-coord for every session

const COORD_NAME = 'agent-coord';
function coordServer() {
    return { type: 'stdio', command: process.execPath, args: [path.join(__dirname, 'agentCoord', 'mcpServer.js')], env: {} };
}

/**
 * agent-coord at user scope in a config dir's .claude.json (null: the host's ~/.claude.json), so every
 * session there has it (Remote Control's own sessions included). Added through the CLI (`claude mcp add
 * --scope user`), which writes .claude.json under its own lock while other CLIs run; skipped when it is
 * there already with this command. Answers true when it is (now) registered.
 */
async function ensureCoordMcp(dir, opts = {}) {
    if (process.env.DREAMSCAPE_CLAUDE_COORD_MCP === '0') return false; // tests: the launcher passes --mcp-config instead
    const file = dir ? path.join(dir, '.claude.json') : hostJson();
    const cj = (await readJson(file)) || {};
    const want = coordServer();
    const cur = cj.mcpServers && cj.mcpServers[COORD_NAME];
    if (cur && cur.command === want.command && JSON.stringify(cur.args) === JSON.stringify(want.args)) return true;
    const run = opts.runner || cliRunner;
    const env = dir ? { CLAUDE_CONFIG_DIR: dir } : {};
    if (cur) await run(['mcp', 'remove', '--scope', 'user', COORD_NAME], env);
    const r = await run(['mcp', 'add', '--scope', 'user', COORD_NAME, '--', want.command, ...want.args], env);
    if (r.code !== 0) console.warn(`[claudeRuntime] agent-coord not registered in ${dir || '~/.claude.json'}: ${String(r.stderr || r.stdout || '').trim().slice(0, 160)}`);
    return r.code === 0;
}

// ---------------------------------------------------------------- Yozora (gitea-mcp) for every session

const GITEA_NAME = 'yozora';
let giteaMissingLogged = false;
function giteaBin() { return process.env.DREAMSCAPE_GITEA_MCP_BIN || path.join(os.homedir(), '.local', 'bin', 'gitea-mcp'); }
function giteaServer() {
    // the wrapper picks the token file per session (FLEET_SESSION) at start; no token is ever in the config
    return { command: path.join(__dirname, '..', 'scripts', 'gitea-mcp.sh'), args: [] };
}

/** Gitea's official MCP server (scripts/install-gitea-mcp.sh) as "yozora" at user scope, like ensureCoordMcp. */
async function ensureGiteaMcp(dir, opts = {}) {
    if (process.env.DREAMSCAPE_CLAUDE_GITEA_MCP === '0' || process.env.DREAMSCAPE_CLAUDE_COORD_MCP === '0') return false;
    if (!fs.existsSync(giteaBin())) {
        if (!giteaMissingLogged) { giteaMissingLogged = true; console.warn(`[claudeRuntime] yozora MCP skipped: ${giteaBin()} is missing (run scripts/install-gitea-mcp.sh)`); }
        return false;
    }
    const file = dir ? path.join(dir, '.claude.json') : hostJson();
    const cj = (await readJson(file)) || {};
    const want = giteaServer();
    const cur = cj.mcpServers && cj.mcpServers[GITEA_NAME];
    if (cur && cur.command === want.command && JSON.stringify(cur.args || []) === JSON.stringify(want.args)) return true;
    const run = opts.runner || cliRunner;
    const env = dir ? { CLAUDE_CONFIG_DIR: dir } : {};
    if (cur) await run(['mcp', 'remove', '--scope', 'user', GITEA_NAME], env);
    const r = await run(['mcp', 'add', '--scope', 'user', GITEA_NAME, '--', want.command, ...want.args], env);
    if (r.code !== 0) console.warn(`[claudeRuntime] yozora MCP not registered in ${dir || '~/.claude.json'}: ${String(r.stderr || r.stdout || '').trim().slice(0, 160)}`);
    return r.code === 0;
}

function cliRunner(args, extraEnv) {
    const { execFile } = require('child_process');
    let bin = process.env.DREAMSCAPE_CLAUDE_CLI || path.join(os.homedir(), '.local', 'bin', 'claude');
    const env = Object.assign({}, process.env, extraEnv || {});
    // the CLI finds ~/.claude.json from HOME: an overridden home (tests) must never reach the real one
    if (process.env.DREAMSCAPE_CLAUDE_HOME) env.HOME = process.env.DREAMSCAPE_CLAUDE_HOME;
    ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'].forEach((k) => { delete env[k]; });
    if (!extraEnv || !extraEnv.CLAUDE_CONFIG_DIR) delete env.CLAUDE_CONFIG_DIR;
    return new Promise((resolve) => {
        execFile(bin, args, { env, timeout: 30000, maxBuffer: 256 * 1024, cwd: claudeHome() }, (error, stdout, stderr) => {
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}

// ---------------------------------------------------------------- copy rotated logins back

let gResources = null;
const watchers = new Map(); // id -> { watcher, timer }

function bind(gr) { if (gr) gResources = gr; }

/** A newer login in the config dir goes back into the account's linked login. */
async function syncBack(id) {
    const dir = accountDir(id);
    const own = await readJson(path.join(configDir(id), '.credentials.json'));
    const linked = await readJson(path.join(dir, 'credentials.json'));
    if (!own || !own.claudeAiOauth || expiresOf(own) <= expiresOf(linked)) return false;
    if (!gResources) return false;
    const acc = claudeHost.listAccounts(gResources).find((a) => a.id === id);
    if (!acc) return false;
    const meta = (await readJson(path.join(dir, 'account.json'))) || {};
    claudeHost.linkLogin(gResources, acc.index, { claudeAiOauth: own.claudeAiOauth }, meta.oauthAccount || null);
    return true;
}

function watch(id) {
    if (watchers.has(id)) return;
    let w = null;
    const entry = { watcher: null, timer: null };
    try {
        w = fs.watch(configDir(id), { persistent: false }, (ev, name) => {
            if (name && name !== '.credentials.json') return;
            clearTimeout(entry.timer);
            entry.timer = setTimeout(() => {
                syncBack(id).catch((e) => console.warn(`[claudeRuntime] login not copied back: ${e.message}`));
            }, 500);
        });
        w.on('error', () => { try { w.close(); } catch (_) { /* closed */ } watchers.delete(id); });
    } catch (_) { return; }
    entry.watcher = w;
    watchers.set(id, entry);
}

/** At server start: watch every config dir already made (sessions on it may still run). */
async function armAll(gr) {
    bind(gr);
    let names = [];
    try { names = await fs.promises.readdir(claudeHost.storeDir()); } catch (_) { return 0; }
    let n = 0;
    for (const name of names) {
        if (!/^[0-9a-f]{16}$/.test(name)) continue;
        try { await fs.promises.access(configDir(name)); } catch (_) { continue; }
        watch(name);
        await syncBack(name).catch(() => false);
        n += 1;
    }
    return n;
}

function stopAll() {
    watchers.forEach((e) => { clearTimeout(e.timer); try { e.watcher.close(); } catch (_) { /* closed */ } });
    watchers.clear();
}

module.exports = { prepare, configFor, syncBack, armAll, bind, stopAll, configDir, accountDir, fleetInfo, isMoved, writeFleetInfo, ensureCoordMcp, ensureGiteaMcp, giteaServer, coordServer, readJson, writeJsonAtomic, fresher, _fresher: fresher };
