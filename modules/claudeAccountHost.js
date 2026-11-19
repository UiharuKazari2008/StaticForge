'use strict';

/**
 * Claude accounts and the host they run on (Yukimi, Nov 19: "an app in the mobile view to switch Claude
 * accounts and on each switch it reconnects the remote control connection ... this does link to the
 * account the Claude engine uses"; "the desktop will still use CardSpace to change, this is the interface
 * for that with extra host management").
 *
 * One backend for both:
 *   - The accounts ARE CardSpace's Claude service keys (apiKeyManager service 'claude', a
 *     `claude setup-token` OAuth token each). Selecting one (CardSpace "Use this account" or the phone's
 *     Claude Accounts) goes through apiKeyManager.applySelectionUpdates, which writes the engine's token
 *     file (syncClaudeTokenFile -> xiLaunch.MANAGED_CLAUDE_TOKEN_FILE, read by every Director / Xi /
 *     Rentan Claude CLI launch) and then calls onSelectionChanged() here.
 *   - Remote Control (`claude remote-control`, the systemd user unit claude-remote.service running it in
 *     tmux session claude-rc) does not use the setup token: it needs the full claude.ai login of
 *     ~/.claude/.credentials.json (+ oauthAccount in ~/.claude.json). Each account can carry a linked copy
 *     of that login (linkHostLogin: taken from the host as it is signed in now). On a switch the unit is
 *     stopped, the live login is saved back into the account it belongs to (its refresh token rotates),
 *     the new account's linked login is put in place, and the unit is started again; the status goes
 *     reconnecting -> connected (the tmux pane says "Connected") or error.
 *
 * Shared, never per account (Yukimi, Nov 19: "make sure permissons and auto allow rules are common"):
 * the permission rules and mode (~/.claude/settings.json permissions + defaultMode, a project's
 * .claude/settings.local.json, ~/.claude.json projects' trust and allowedTools) and every transcript
 * (~/.claude/projects/<cwd>/<session>.jsonl) live once on the host. A switch only replaces
 * .credentials.json's claudeAiOauth and ~/.claude.json's oauthAccount; a linked login stores those two
 * and nothing else (normalizeStore strips anything more). permissionSummary() is the Host tab's line.
 *
 * Bring over (Yukimi, Nov 19: "can we also bring over selected sessions"): a restart ends every Remote
 * Control session (the server's children, and rc-* ones: they hold the old login). Sessions picked on
 * the phone start again under the new login once Remote Control says Connected, through
 * claudeSessions.resume (the Sessions tab's Reconnect) with fork: a copy with the whole history
 * (--fork-session) in its own cwd, tmux rc-<id8> on claudeSessions' own socket, --permission-mode the
 * unit's own (else settings' defaultMode). CardSpace's switch brings none over.
 *
 * Nothing here returns, logs or broadcasts a token. Linked logins are kept 0600 under
 * .cache/secrets/claude-accounts/<id>/ (dir 0700), <id> = sha256 of the account's setup token (16 hex).
 *
 * Overrides (tests): DREAMSCAPE_CLAUDE_HOME (instead of the home dir), DREAMSCAPE_CLAUDE_ACCOUNTS_DIR,
 * DREAMSCAPE_CLAUDE_RC_UNIT, DREAMSCAPE_CLAUDE_RC_TMUX, DREAMSCAPE_CLAUDE_CARRY_SOCKET, DREAMSCAPE_CLAUDE_CLI,
 * _setRunner(fn) for systemctl / tmux, _setPidAlive(fn).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const sessions = require('./claudeSessions');

const SERVICE = 'claude';
const STATUS_TYPE = 'claude_remote_control_status';
const CONNECT_TIMEOUT_MS = 45 * 1000;
const POLL_MS = 1500;
const CARRY_GONE_MS = 15 * 1000;
const PENDING_CARRY_MS = 30 * 1000;
const { SESSION_ID_RE, MODES } = sessions;

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }
function credentialsFile() { return path.join(claudeHome(), '.claude', '.credentials.json'); }
function claudeJsonFile() { return path.join(claudeHome(), '.claude.json'); }
function storeRoot() { return process.env.DREAMSCAPE_CLAUDE_ACCOUNTS_DIR || path.join(__dirname, '..', '.cache', 'secrets', 'claude-accounts'); }
function unitName() { return process.env.DREAMSCAPE_CLAUDE_RC_UNIT || 'claude-remote.service'; }
function tmuxSession() { return process.env.DREAMSCAPE_CLAUDE_RC_TMUX || 'claude-rc'; }
function settingsFile() { return path.join(claudeHome(), '.claude', 'settings.json'); }

// ---------------------------------------------------------------- commands (systemctl --user, tmux)

function userEnv() {
    const env = Object.assign({}, process.env);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid != null && !env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    if (env.XDG_RUNTIME_DIR && !env.DBUS_SESSION_BUS_ADDRESS) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
    return env;
}

function defaultRunner(cmd, args, opts) {
    return new Promise((resolve) => {
        execFile(cmd, args, { env: userEnv(), timeout: (opts && opts.timeout) || 15000, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
            resolve({ code: error ? (typeof error.code === 'number' ? error.code : 1) : 0, stdout: String(stdout || ''), stderr: String(stderr || '') });
        });
    });
}
function guardedRunner(cmd, args, opts) {
    // a dev / test instance may look at the host's Remote Control but never stop or start it
    if (process.env.DREAMSCAPE_CLAUDE_RC_READONLY === '1' && cmd === 'systemctl' && (args.includes('stop') || args.includes('start') || args.includes('restart'))) {
        return Promise.resolve({ code: 1, stdout: '', stderr: 'Remote Control is read-only on this instance' });
    }
    return defaultRunner(cmd, args, opts);
}
let runner = guardedRunner;
function _setRunner(fn) { runner = typeof fn === 'function' ? fn : guardedRunner; sessions._setRunner(typeof fn === 'function' ? fn : null); }

// ---------------------------------------------------------------- files

function readJson(file) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function writeJsonAtomic(file, value, mode) {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: mode || 0o600 });
    fs.chmodSync(tmp, mode || 0o600);
    fs.renameSync(tmp, file);
}

function accountId(key) {
    const token = key && key.apiKey ? String(key.apiKey).trim() : '';
    return token ? crypto.createHash('sha256').update(token).digest('hex').slice(0, 16) : '';
}

function accountDir(id) {
    if (!/^[0-9a-f]{16}$/.test(String(id || ''))) throw new Error('Invalid Claude account id');
    return path.join(storeRoot(), id);
}

/** The login facts that are safe to show: never a token. */
function describeLogin(creds, oauthAccount) {
    const o = (creds && creds.claudeAiOauth) || {};
    const a = oauthAccount || {};
    if (!o.accessToken && !o.refreshToken && !a.emailAddress) return null;
    return {
        email: a.emailAddress || '',
        displayName: a.displayName || '',
        organization: a.organizationName || '',
        accountUuid: a.accountUuid || '',
        plan: o.subscriptionType || '',
        rateLimitTier: o.rateLimitTier || '',
        expiresAt: Number(o.expiresAt) || null,
        remoteControlCapable: Array.isArray(o.scopes) ? o.scopes.includes('user:sessions:claude_code') : null
    };
}

function readHostLogin() {
    const creds = readJson(credentialsFile());
    const cj = readJson(claudeJsonFile());
    return { creds, oauthAccount: (cj && cj.oauthAccount) || null };
}

function readLinked(id) {
    const dir = accountDir(id);
    const creds = readJson(path.join(dir, 'credentials.json'));
    if (!creds) return null;
    const meta = readJson(path.join(dir, 'account.json')) || {};
    return { creds, oauthAccount: meta.oauthAccount || null, linkedAt: meta.linkedAt || null };
}

/** A linked login is the claude.ai OAuth login only: no MCP logins, settings or permission state. */
function loginOnly(creds) {
    return creds && creds.claudeAiOauth ? { claudeAiOauth: creds.claudeAiOauth } : null;
}

function writeLinked(id, creds, oauthAccount) {
    const dir = accountDir(id);
    const only = loginOnly(creds);
    if (!only) throw new Error('No claude.ai login to store');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.chmodSync(dir, 0o700);
    writeJsonAtomic(path.join(dir, 'credentials.json'), only, 0o600);
    writeJsonAtomic(path.join(dir, 'account.json'), { oauthAccount: oauthAccount || null, linkedAt: new Date().toISOString() }, 0o600);
}

function removeLinked(id) {
    fs.rmSync(accountDir(id), { recursive: true, force: true });
}

/**
 * Puts a linked login on the host: .credentials.json's claudeAiOauth and ~/.claude.json's oauthAccount,
 * nothing else (whatever else the host keeps there, its MCP logins, projects' trust and allowedTools, stays).
 */
function installLogin(linked) {
    const only = loginOnly(linked && linked.creds);
    if (!only) throw new Error('The linked login has no claude.ai login');
    const cur = readJson(credentialsFile());
    writeJsonAtomic(credentialsFile(), Object.assign({}, cur && typeof cur === 'object' ? cur : {}, only), 0o600);
    const file = claudeJsonFile();
    const cj = readJson(file);
    if (cj && typeof cj === 'object') {
        let mode = 0o600;
        try { mode = fs.statSync(file).mode & 0o777; } catch (_) { /* new */ }
        cj.oauthAccount = linked.oauthAccount || cj.oauthAccount;
        writeJsonAtomic(file, cj, mode);
    }
}

/**
 * Linked logins made before Nov 19 may hold more than the login: keep the login only (it never was
 * installed from here past claudeAiOauth / oauthAccount, so nothing to merge back). Once per process.
 */
let normalized = false;
function normalizeStore() {
    if (normalized) return 0;
    normalized = true;
    let fixed = 0;
    let dirs = [];
    try { dirs = fs.readdirSync(storeRoot()); } catch (_) { return 0; }
    dirs.forEach((name) => {
        if (!/^[0-9a-f]{16}$/.test(name) && name !== 'host-backup') return;
        const dir = path.join(storeRoot(), name);
        const credFile = path.join(dir, 'credentials.json');
        const creds = readJson(credFile);
        if (creds && Object.keys(creds).some((k) => k !== 'claudeAiOauth') && loginOnly(creds)) { writeJsonAtomic(credFile, loginOnly(creds), 0o600); fixed += 1; }
        const metaFile = path.join(dir, 'account.json');
        const meta = readJson(metaFile);
        if (meta && Object.keys(meta).some((k) => !['oauthAccount', 'linkedAt', 'savedAt'].includes(k))) {
            const keep = {};
            ['oauthAccount', 'linkedAt', 'savedAt'].forEach((k) => { if (k in meta) keep[k] = meta[k]; });
            writeJsonAtomic(metaFile, keep, 0o600);
            fixed += 1;
        }
    });
    if (fixed) console.log(`[claudeAccounts] linked logins now hold the login only (${fixed} file${fixed === 1 ? '' : 's'})`);
    return fixed;
}

const sameLogin = (a, b) => !!(a && b && ((a.accountUuid && a.accountUuid === b.accountUuid) || (!a.accountUuid && a.email && a.email === b.email)));

// ---------------------------------------------------------------- accounts (CardSpace's Claude keys)

function akm(gr) { return gr.getApiKeyManager(); }

function keyList(gr) {
    const m = akm(gr);
    const keys = m.getServiceKeys(SERVICE) || [];
    const selected = keys.length ? m.getSelectedIndex(SERVICE) : -1;
    return { m, keys, selected: keys[selected] ? selected : (keys.length ? 0 : -1) };
}

function listAccounts(gr) {
    try { normalizeStore(); } catch (e) { console.warn(`[claudeAccounts] store not normalized: ${e.message}`); }
    const { m, keys, selected } = keyList(gr);
    const host = readHostLogin();
    const hostLogin = describeLogin(host.creds, host.oauthAccount);
    return keys.map((key, index) => {
        const id = accountId(key);
        let linked = null;
        try { linked = id ? readLinked(id) : null; } catch (_) { linked = null; }
        const login = linked ? describeLogin(linked.creds, linked.oauthAccount) : null;
        return {
            index,
            id,
            name: key.name || `Claude ${index + 1}`,
            fingerprint: m.keyFingerprint(SERVICE, key),
            active: index === selected,
            remoteLogin: login ? Object.assign({ linkedAt: linked.linkedAt }, login) : null,
            onHost: !!(login && hostLogin && sameLogin(login, hostLogin))
        };
    });
}

function findAccount(gr, index) {
    const { keys } = keyList(gr);
    const i = Number(index);
    if (!Number.isInteger(i) || !keys[i]) throw new Error('No such Claude account');
    const id = accountId(keys[i]);
    if (!id) throw new Error('That Claude account has no token');
    return { index: i, id, key: keys[i] };
}

/**
 * Makes a claude.ai login (credentials + oauthAccount) this account's Remote Control login. The same
 * login may belong to one account only: it is moved off any other. Used by linkHostLogin and by the
 * phone's Add Account sign-in (claudeAccountLogin.js), which brings a login that was never on the host.
 */
function linkLogin(gr, index, creds, oauthAccount) {
    const acc = findAccount(gr, index);
    const login = describeLogin(creds, oauthAccount);
    if (!login || !creds || !creds.claudeAiOauth) throw new Error('No claude.ai login to link');
    listAccounts(gr).forEach((row) => {
        if (row.index !== acc.index && row.remoteLogin && sameLogin(row.remoteLogin, login)) removeLinked(row.id);
    });
    writeLinked(acc.id, creds, oauthAccount);
    return { index: acc.index, remoteLogin: login };
}

/** Saves the host's current claude.ai login as this account's Remote Control login. */
function linkHostLogin(gr, index) {
    const host = readHostLogin();
    const login = describeLogin(host.creds, host.oauthAccount);
    if (!login || !host.creds || !host.creds.claudeAiOauth) throw new Error('The host has no claude.ai login to link (sign in with `claude` on the host first)');
    return linkLogin(gr, index, host.creds, host.oauthAccount);
}

function unlinkLogin(gr, index) {
    const acc = findAccount(gr, index);
    removeLinked(acc.id);
    return { index: acc.index };
}

/** The live login's refresh token rotates: keep the linked copy of whichever account it is current. */
function saveLiveLoginBack(gr) {
    const host = readHostLogin();
    const login = describeLogin(host.creds, host.oauthAccount);
    if (!login || !host.creds || !host.creds.claudeAiOauth) return null;
    const owner = listAccounts(gr).find((row) => row.remoteLogin && sameLogin(row.remoteLogin, login));
    if (!owner) {
        // a login no account has linked is never just overwritten: kept (0600) beside the accounts
        const dir = path.join(storeRoot(), 'host-backup');
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        fs.chmodSync(dir, 0o700);
        writeJsonAtomic(path.join(dir, 'credentials.json'), loginOnly(host.creds), 0o600);
        writeJsonAtomic(path.join(dir, 'account.json'), { oauthAccount: host.oauthAccount || null, savedAt: new Date().toISOString() }, 0o600);
        return 'backup';
    }
    writeLinked(owner.id, host.creds, host.oauthAccount);
    return owner.index;
}

// ---------------------------------------------------------------- Remote Control on this host

let rc = { state: 'unknown', source: 'observed', message: '', at: null, account: null, attempt: 0 };
let gResources = null;
let busy = null;
// Only the running server (its WS handlers' registerPackets) arms the switch hook: a script that loads
// apiKeyManager on its own (a test) never stops the host's Remote Control.
let armed = false;
function arm(gr) { armed = true; if (gr) gResources = gr; }

function publicStatus() { return Object.assign({}, rc); }

function broadcast() {
    try {
        const srv = gResources && (gResources.getWebSocketServer ? gResources.getWebSocketServer() : gResources.webSocketServer);
        const admin = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));
        if (srv && typeof srv.broadcast === 'function') srv.broadcast({ type: STATUS_TYPE, data: publicStatus(), timestamp: new Date().toISOString() }, admin);
    } catch (error) {
        console.warn(`[claudeAccounts] status broadcast skipped: ${error.message}`);
    }
}

function setState(state, message, extra) {
    rc = Object.assign({}, rc, { state, source: 'action', message: message || '', at: new Date().toISOString() }, extra || {});
    broadcast();
}

/** Lines of the tmux pane without links or anything token-shaped. */
function cleanPane(text) {
    return String(text || '').split('\n')
        .map((l) => l.replace(/https?:\/\/\S+/g, '<link>').replace(/\b[A-Za-z0-9_-]{24,}\b/g, '…').replace(/\s+$/, ''))
        .filter((l) => l.trim());
}

function parsePane(text) {
    const lines = cleanPane(text);
    const statusLine = lines.find((l) => /\b(Connected|Connecting|Reconnecting|Disconnected)\b/i.test(l)) || '';
    const cap = lines.map((l) => /Capacity:\s*(\d+)\s*\/\s*(\d+)/i.exec(l)).find(Boolean);
    const errorLine = lines.find((l) => /\b(error|failed|not logged in|log ?in|unauthori[sz]ed|expired)\b/i.test(l)) || '';
    let state = 'unknown';
    if (/\bConnected\b/.test(statusLine) && !/Disconnected/i.test(statusLine)) state = 'connected';
    else if (/Connecting|Reconnecting/i.test(statusLine)) state = 'reconnecting';
    else if (errorLine) state = 'error';
    return {
        state,
        statusLine: statusLine.replace(/^[^A-Za-z]+/, '').trim(),
        sessions: cap ? Number(cap[1]) : null,
        capacity: cap ? Number(cap[2]) : null,
        errorLine: errorLine.trim(),
        tail: lines.slice(-3)
    };
}

async function unitInfo() {
    const r = await runner('systemctl', ['--user', 'show', unitName(), '-p', 'ActiveState,SubState,MainPID,ActiveEnterTimestamp,NRestarts,Description,ExecStart,WorkingDirectory']);
    const info = {};
    r.stdout.split('\n').forEach((line) => {
        const i = line.indexOf('=');
        if (i > 0) info[line.slice(0, i)] = line.slice(i + 1);
    });
    const name = /--name\s+(\S+?)['";\s]/.exec(`${info.ExecStart || ''} `);
    const pmode = /--permission-mode[\s=]+(\w+)/.exec(info.ExecStart || '');
    return {
        unit: unitName(),
        installed: r.code === 0 && !!info.ActiveState && info.LoadState !== 'not-found' && !!info.Description,
        active: info.ActiveState || 'unknown',
        sub: info.SubState || '',
        pid: Number(info.MainPID) || null,
        since: info.ActiveEnterTimestamp || '',
        restarts: info.NRestarts != null && info.NRestarts !== '' ? Number(info.NRestarts) : null,
        sessionName: name ? name[1] : '',
        permissionMode: pmode && MODES.has(pmode[1]) ? pmode[1] : '',
        workingDirectory: info.WorkingDirectory && info.WorkingDirectory !== '!' ? info.WorkingDirectory.replace(/^!/, '').replace(/^~/, claudeHome()) : ''
    };
}

async function paneInfo() {
    const r = await runner('tmux', ['capture-pane', '-p', '-t', tmuxSession()]);
    if (r.code !== 0) return { state: 'unknown', statusLine: '', sessions: null, capacity: null, errorLine: '', tail: [], attached: false };
    return Object.assign(parsePane(r.stdout), { attached: true });
}

let versionCache = { at: 0, value: null };
async function cliVersion() {
    if (versionCache.value && Date.now() - versionCache.at < 10 * 60 * 1000) return versionCache.value;
    let bin = null;
    try { bin = require('./cursorDirector').findClaude(); } catch (_) { bin = null; }
    if (!bin) return null;
    const r = await runner(bin, ['--version'], { timeout: 10000 });
    const m = r.code === 0 ? /(\d+\.\d+\.\d+)/.exec(r.stdout) : null;
    versionCache = { at: Date.now(), value: m ? m[1] : null };
    return versionCache.value;
}

/** Everything the phone's Host page shows. */
async function hostStatus(gr) {
    if (gr) gResources = gr;
    const [unit, pane, version] = await Promise.all([unitInfo(), paneInfo(), cliVersion()]);
    const host = readHostLogin();
    const login = describeLogin(host.creds, host.oauthAccount);
    let engineAccount = null;
    let tokenFile = false;
    try {
        const { keys, selected } = keyList(gr);
        engineAccount = keys[selected] ? { index: selected, name: keys[selected].name || `Claude ${selected + 1}` } : null;
        const file = require('./xiLaunch').MANAGED_CLAUDE_TOKEN_FILE;
        tokenFile = fs.existsSync(file) && fs.statSync(file).size > 0;
    } catch (_) { /* no key manager yet */ }
    // what the pane says when no switch is in progress
    // (a reconnect that just failed stays an error for 2 minutes, even with the old connection still up,
    // so the phone shows the failure and its Retry)
    const sticky = rc.source === 'action' && rc.state === 'error' && Date.now() - Date.parse(rc.at) < 2 * 60 * 1000;
    if (!busy && !sticky) {
        const live = unit.active !== 'active' ? (unit.active === 'failed' ? 'error' : 'stopped') : pane.state;
        if (live !== rc.state && live !== 'unknown') rc = Object.assign({}, rc, { state: live, source: 'observed', message: live === 'error' ? (pane.errorLine || `${unit.unit} ${unit.active}`) : '', at: new Date().toISOString() });
    }
    return {
        hostname: os.hostname(),
        cliVersion: version,
        engine: { account: engineAccount, tokenFile },
        login,
        remoteControl: Object.assign({}, unit, { pane, status: publicStatus() }),
        sessions: sessions.listRemoteSessions(),
        permissions: permissionSummary(unit)
    };
}

// ---------------------------------------------------------------- shared permissions (one set, every account)

function permissionFiles(cwd) {
    const files = [settingsFile()];
    if (cwd) files.push(path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json'));
    return files;
}

/** What decides what Claude may do, in a stable form: none of it belongs to an account. */
function permissionState(cwd) {
    const out = { files: {}, projects: {} };
    permissionFiles(cwd).forEach((f) => {
        const j = readJson(f);
        if (j) out.files[f] = { permissions: j.permissions || null, skipDangerousModePermissionPrompt: j.skipDangerousModePermissionPrompt === true };
    });
    const cj = readJson(claudeJsonFile());
    const projects = (cj && cj.projects) || {};
    Object.keys(projects).sort().forEach((k) => {
        const p = projects[k] || {};
        out.projects[k] = { allowedTools: p.allowedTools || [], trusted: p.hasTrustDialogAccepted === true };
    });
    return out;
}
function permissionFingerprint(cwd) {
    return crypto.createHash('sha256').update(JSON.stringify(permissionState(cwd))).digest('hex').slice(0, 12);
}

/** The Host tab's "Permissions (shared by every account)" line. Counts only: no rule text. */
function permissionSummary(unit) {
    const cwd = (unit && unit.workingDirectory) || '';
    const user = readJson(settingsFile()) || {};
    const perms = user.permissions || {};
    const len = (a) => (Array.isArray(a) ? a.length : 0);
    let projectAllow = 0;
    [path.join(cwd, '.claude', 'settings.json'), path.join(cwd, '.claude', 'settings.local.json')].forEach((f) => {
        if (!cwd) return;
        const j = readJson(f);
        projectAllow += len(j && j.permissions && j.permissions.allow);
    });
    const cj = readJson(claudeJsonFile());
    const projects = Object.values((cj && cj.projects) || {});
    return {
        shared: true,
        mode: perms.defaultMode || 'default',
        remoteControlMode: (unit && unit.permissionMode) || '',
        skipBypassPrompt: user.skipDangerousModePermissionPrompt === true,
        allow: len(perms.allow),
        deny: len(perms.deny),
        ask: len(perms.ask),
        projectAllow,
        project: cwd ? path.basename(cwd) : '',
        trustedFolders: projects.filter((p) => p && p.hasTrustDialogAccepted === true).length,
        projectAllowedTools: projects.reduce((n, p) => n + len(p && p.allowedTools), 0),
        fingerprint: permissionFingerprint(cwd)
    };
}

/** The mode carried sessions run in: Remote Control's own (--permission-mode on the unit), else settings'. */
function carryMode(unit) {
    if (unit && MODES.has(unit.permissionMode)) return unit.permissionMode;
    const m = ((readJson(settingsFile()) || {}).permissions || {}).defaultMode;
    return MODES.has(m) ? m : '';
}

const briefSession = (x) => ({ id: x.id, title: x.title, folder: x.folder, origin: x.origin, status: x.status });

/** The phone's Switch carries its picks to the key manager's onSelectionChanged (one switch, 30 s). */
let pendingCarry = null;
function setPendingCarry(ids) {
    pendingCarry = Array.isArray(ids) && ids.length ? { ids: ids.slice(), at: Date.now() } : null;
}
function takePendingCarry() {
    const p = pendingCarry;
    pendingCarry = null;
    return p && Date.now() - p.at < PENDING_CARRY_MS ? p.ids : [];
}

async function waitConnected(timeoutMs, pollMs) {
    const until = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, pollMs || POLL_MS));
        const unit = await unitInfo();
        last = await paneInfo();
        if (unit.active === 'failed') return { ok: false, message: `${unit.unit} failed to start` };
        if (unit.active === 'active' && last.state === 'connected') return { ok: true, message: last.statusLine };
        if (unit.active === 'active' && last.state === 'error') return { ok: false, message: last.errorLine };
    }
    return { ok: false, message: (last && (last.errorLine || last.tail.join(' · '))) || 'Remote Control did not say Connected in time' };
}

/**
 * Stops Remote Control, puts the account's linked login in place (when it has one) and starts it again.
 * opts.carry: ids (listRemoteSessions) to bring over: started again under the new login once Remote
 * Control is Connected; every other Remote Control session ends. One at a time; a second call while one
 * runs gets the running one's promise.
 */
function reconnect(gr, opts = {}) {
    if (gr) gResources = gr;
    if (busy) return busy;
    const run = (async () => {
        const running = sessions.listRemoteSessions();
        const want = new Set((Array.isArray(opts.carry) ? opts.carry : []).map(String).filter((id) => SESSION_ID_RE.test(id)));
        const chosen = running.filter((x) => want.has(x.id) && x.resumable && x.cwd);
        const ending = running.filter((x) => !chosen.includes(x));
        const carry = { selected: chosen.map(briefSession), ending: ending.map(briefSession), results: [] };
        setState('reconnecting', opts.reason || 'Reconnecting Remote Control', { account: opts.account || rc.account, attempt: rc.attempt + 1, carry, permissionsKept: null });
        try {
            const unit0 = await unitInfo();
            const permsBefore = permissionFingerprint(unit0.workingDirectory);
            const stop = await runner('systemctl', ['--user', 'stop', unitName()], { timeout: 30000 });
            if (stop.code !== 0) throw new Error(`Could not stop ${unitName()}: ${(stop.stderr || '').trim().slice(0, 160)}`);
            // carried sessions are Remote Control sessions too, still signed in as before: they end as well
            await sessions.endRemote(running);
            let note = '';
            if (opts.index != null && gResources) {
                const acc = findAccount(gResources, opts.index);
                const linked = readLinked(acc.id);
                try { saveLiveLoginBack(gResources); } catch (e) { console.warn(`[claudeAccounts] live login not saved back: ${e.message}`); }
                if (linked) installLogin(readLinked(acc.id) || linked);
                else note = 'This account has no linked Remote Control login: Remote Control stays signed in as before';
            }
            const permissionsKept = permissionFingerprint(unit0.workingDirectory) === permsBefore;
            if (!permissionsKept) console.warn('[claudeAccounts] permission settings changed during the switch (not by it: only the login is replaced)');
            const start = await runner('systemctl', ['--user', 'start', unitName()], { timeout: 30000 });
            if (start.code !== 0) throw new Error(`Could not start ${unitName()}: ${(start.stderr || '').trim().slice(0, 160)}`);
            const done = await waitConnected(opts.timeoutMs || CONNECT_TIMEOUT_MS, opts.pollMs);
            if (!done.ok) {
                carry.results = chosen.map((x) => ({ id: x.id, title: x.title, folder: x.folder, state: 'failed', message: 'Not brought over: Remote Control did not connect' }));
                setState('error', done.message, { carry, permissionsKept });
                return publicStatus();
            }
            if (chosen.length) {
                setState('reconnecting', `Bringing over ${chosen.length} session${chosen.length === 1 ? '' : 's'}`, { carry, permissionsKept });
                // the old processes have to be gone first (the transcript is final, nothing holds the id)
                const until = Date.now() + (opts.goneMs || CARRY_GONE_MS);
                while (chosen.some((x) => sessions.pidAlive(x.pid)) && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
                const unit = await unitInfo();
                const mode = carryMode(unit);
                for (const x of chosen) {
                    let res;
                    try {
                        const r = await sessions.resume(x.id, { fork: true, mode, title: x.title, timeoutMs: opts.carryTimeoutMs, pollMs: opts.pollMs });
                        res = { id: x.id, title: x.title, folder: x.folder, state: r.state === 'connected' ? 'carried' : r.state, link: r.link || '', tmuxSession: r.tmuxSession, message: r.message };
                    } catch (e) { res = { id: x.id, title: x.title, folder: x.folder, state: 'failed', message: e.message }; }
                    carry.results.push(res);
                    setState('reconnecting', `Bringing over ${chosen.length} session${chosen.length === 1 ? '' : 's'} (${carry.results.length} done)`, { carry, permissionsKept });
                }
            }
            const ok = carry.results.filter((r) => r.state !== 'failed').length;
            const carriedMsg = chosen.length ? ` · ${ok} of ${chosen.length} session${chosen.length === 1 ? '' : 's'} brought over` : '';
            setState('connected', `${note || done.message || 'Connected'}${carriedMsg}`, { carry, permissionsKept });
        } catch (error) {
            setState('error', error.message, { carry });
        }
        return publicStatus();
    })();
    busy = run.finally(() => { busy = null; });
    return busy;
}

async function stop(gr) {
    if (gr) gResources = gr;
    if (busy) throw new Error('Remote Control is reconnecting');
    const r = await runner('systemctl', ['--user', 'stop', unitName()], { timeout: 30000 });
    if (r.code !== 0) throw new Error(`Could not stop ${unitName()}`);
    try { saveLiveLoginBack(gResources); } catch (_) { /* kept as it is */ }
    setState('stopped', 'Remote Control stopped');
    return publicStatus();
}

/**
 * apiKeyManager.applySelectionUpdates calls this after the engine's token file follows a new Claude
 * selection (CardSpace "Use this account" or the phone). Remote Control reconnects in the background;
 * the selection's answer does not wait for it.
 */
function onSelectionChanged(gr, index) {
    if (!armed || process.env.DREAMSCAPE_CLAUDE_RC_DISABLED === '1') return null;
    if (gr) gResources = gr;
    let account = null;
    try {
        const { keys } = keyList(gr);
        account = keys[index] ? { index, name: keys[index].name || `Claude ${index + 1}` } : null;
    } catch (_) { /* listed later */ }
    // the phone's Switch leaves its picks here; CardSpace's "Use this account" brings none over
    const carry = takePendingCarry();
    const p = reconnect(gr, { index, account, carry, reason: account ? `Switching to ${account.name}` : 'Switching account' });
    p.catch(() => { /* status carries it */ });
    return p;
}

module.exports = {
    STATUS_TYPE,
    arm,
    listAccounts,
    linkHostLogin,
    linkLogin,
    unlinkLogin,
    describeLogin,
    storeDir: storeRoot,
    hostStatus,
    reconnect,
    stop,
    onSelectionChanged,
    parsePane,
    publicStatus,
    listRemoteSessions: () => sessions.listRemoteSessions(),
    permissionSummary,
    carryMode,
    setPendingCarry,
    _setRunner,
    _setPidAlive: (fn) => sessions._setPidAlive(fn),
    _normalizeStore: () => { normalized = false; return normalizeStore(); },
    _accountId: accountId,
    _paths: () => ({ credentials: credentialsFile(), claudeJson: claudeJsonFile(), store: storeRoot() })
};
