'use strict';

/**
 * Remote Control for every Claude account at once (#1154, Yukimi Nov 24 2026: "all accounts are placed in
 * a separate config folder and such so they can all be open and running at the same time and all have
 * remote access working independently").
 *
 * An account moved to its own folder (moveToOwnFolder) runs its own `claude remote-control` server on its
 * own config dir (claudeAccountRuntime: .cache/secrets/claude-accounts/<id>/config), next to every other
 * account's:
 *
 *   claude-remote@<id>.service   systemd user template instance (enabled: starts with the user manager)
 *     tmux -L claude-rc-<id>     its own tmux server and socket, session claude-rc-<id> (so stopping one
 *                                account's unit never takes another's server or sessions with it; the
 *                                CLI's session records say tmux "claude-rc-<id>:..." = origin server)
 *     <id>/rc.sh                 CLAUDE_CONFIG_DIR=<id>/config claude remote-control --name
 *                                "Dreamscape (<account>)" --permission-mode <mode>  (no secrets in it)
 *
 * The legacy unit claude-remote.service (the host's ~/.claude login) keeps running for the account that is
 * on the host until that account is moved too - last, because it restarts every session that Remote
 * Control server runs (Yukimi: "move the other 2 accounts and then once we see they're working we can
 * move the active account last"). Moving the host's account stops and disables the legacy unit, keeps
 * the host's login file as a link to the account's own login (one login, held once: plain `claude` in a
 * terminal and the account's sessions rotate the same token), and starts the account's own unit.
 *
 * A switch (CardSpace "Use this account" / the phone) never installs a moved account's login on the host
 * (claudeAccountHost.onSelectionChanged asks blocksLegacySwitch): it would hold one refresh token twice.
 *
 * Status: status(gr) per account; changes are pushed as claude_remote_fleet_status (admin sockets) when
 * an action changes them. Nothing here returns or logs a token. Overrides (tests):
 * DREAMSCAPE_SYSTEMD_USER_DIR, DREAMSCAPE_CLAUDE_CLI, DREAMSCAPE_CLAUDE_RC_READONLY, _setRunner(fn).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const spawnHelper = require('./spawnHelper');
const claudeHost = require('./claudeAccountHost');
const runtime = require('./claudeAccountRuntime');
const claudeSessions = require('./claudeSessions');

const STATUS_TYPE = 'claude_remote_fleet_status';
const TEMPLATE = 'claude-remote@.service';
const LEGACY_UNIT = 'claude-remote.service';
const CONNECT_TIMEOUT_MS = 60 * 1000;
const POLL_MS = 1500;
const DEFAULT_MODE = 'bypassPermissions';
const TRUST_RE = /Do you trust the files in this folder|Is this a project you (?:created|trust)|Enable Remote Control\?/i;

const unitOf = (id) => `claude-remote@${id}.service`;
const tmuxOf = (id) => `claude-rc-${id}`;
const readOnly = () => process.env.DREAMSCAPE_CLAUDE_RC_READONLY === '1';
const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

function claudeHome() { return process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir(); }
function unitDir() { return process.env.DREAMSCAPE_SYSTEMD_USER_DIR || path.join(claudeHome(), '.config', 'systemd', 'user'); }
function cliPath() { return process.env.DREAMSCAPE_CLAUDE_CLI || path.join(claudeHome(), '.local', 'bin', 'claude'); }
function repoRoot() { return path.join(__dirname, '..'); }
function hostCredsFile() { return path.join(claudeHome(), '.claude', '.credentials.json'); }

// ---------------------------------------------------------------- commands

function userEnv() {
    const env = Object.assign({}, process.env);
    const uid = typeof process.getuid === 'function' ? process.getuid() : null;
    if (uid != null && !env.XDG_RUNTIME_DIR) env.XDG_RUNTIME_DIR = `/run/user/${uid}`;
    if (env.XDG_RUNTIME_DIR && !env.DBUS_SESSION_BUS_ADDRESS) env.DBUS_SESSION_BUS_ADDRESS = `unix:path=${env.XDG_RUNTIME_DIR}/bus`;
    return env;
}
function defaultRunner(cmd, args, opts) {
    if (readOnly() && cmd === 'systemctl' && args.some((a) => ['start', 'stop', 'restart', 'enable', 'disable'].includes(a))) {
        return Promise.resolve({ code: 1, stdout: '', stderr: 'Remote Control is read-only on this instance' });
    }
    // through the spawn helper process (modules/spawnHelper.js): forking the server itself blocked its loop
    return spawnHelper.run(cmd, args, { env: userEnv(), timeout: (opts && opts.timeout) || 15000, maxBuffer: 256 * 1024 });
}
let runner = defaultRunner;
function _setRunner(fn) { runner = typeof fn === 'function' ? fn : defaultRunner; probeCache.clear(); probeGen += 1; }

// What a status read (the screens' push, every poke of the desk feed) learns from systemctl show / tmux
// capture-pane is kept 20 s so a poke does not respawn them; every action of this module that changes a unit
// or a pane, and every journal line about a unit, drops it at once (waitConnected reads fresh, uncached).
const PROBE_TTL_MS = 20 * 1000;
const probeCache = new Map();   // key -> { at, value } | { promise }
let probeGen = 0;
function invalidateProbes() { probeCache.clear(); probeGen += 1; }
function cachedProbe(key, fn) {
    const hit = probeCache.get(key);
    if (hit && hit.promise) return hit.promise.then((v) => Object.assign({}, v));
    if (hit && Date.now() - hit.at < PROBE_TTL_MS) return Promise.resolve(Object.assign({}, hit.value));
    const gen = probeGen;
    const promise = fn().then((value) => {
        if (gen === probeGen) probeCache.set(key, { at: Date.now(), value });
        return value;
    }, (error) => {
        if (gen === probeGen) probeCache.delete(key);
        throw error;
    });
    probeCache.set(key, { promise });
    return promise.then((v) => Object.assign({}, v));
}
const systemctl = (args, timeout) => {
    if (args[0] !== 'show') invalidateProbes();
    return runner('systemctl', ['--user', ...args], { timeout: timeout || 30000 });
};
const tmux = (id, args) => {
    if (args[0] !== 'capture-pane') invalidateProbes();
    return runner('tmux', ['-L', tmuxOf(id), ...args]);
};

// ---------------------------------------------------------------- unit template + per-account script

function templateText() {
    const store = claudeHost.storeDir();
    return [
        '# Written by Dreamscape (modules/claudeRemoteFleet.js): one Claude Code Remote Control server per',
        '# Claude account, each on its own config dir and its own tmux socket. Instance = the account id.',
        '#   tmux -L claude-rc-<id> attach -t claude-rc-<id>',
        '[Unit]',
        'Description=Claude Code Remote Control for one Claude account (%i)',
        'After=network-online.target',
        'Wants=network-online.target',
        '',
        '[Service]',
        'Type=forking',
        `WorkingDirectory=${repoRoot()}`,
        `Environment=PATH=${path.dirname(cliPath())}:/usr/local/bin:/usr/bin:/bin`,
        `ExecStart=/usr/bin/tmux -L claude-rc-%i new-session -d -s claude-rc-%i -x 200 -y 50 -c ${repoRoot()} ${store}/%i/rc.sh`,
        'ExecStop=/usr/bin/tmux -L claude-rc-%i kill-server',
        'Restart=always',
        'RestartSec=30',
        '',
        '[Install]',
        'WantedBy=default.target',
        ''
    ].join('\n');
}

let templateChecked = false;
async function ensureTemplate() {
    if (templateChecked) return false;
    const file = path.join(unitDir(), TEMPLATE);
    const want = templateText();
    let cur = '';
    try { cur = await fs.promises.readFile(file, 'utf8'); } catch (_) { cur = ''; }
    if (cur === want) { templateChecked = true; return false; }
    await fs.promises.mkdir(unitDir(), { recursive: true });
    await fs.promises.writeFile(file, want);
    await systemctl(['daemon-reload']);
    templateChecked = true;
    return true;
}

function rcName(acc) {
    return `Dreamscape (${String(acc.name || 'Claude').replace(/[^\w .@()+-]/g, '').slice(0, 40)})`;
}

async function writeScript(acc, mode) {
    const file = path.join(runtime.accountDir(acc.id), 'rc.sh');
    const body = [
        '#!/bin/sh',
        `# Remote Control for the Claude account ${rcName(acc)} (written by modules/claudeRemoteFleet.js on every start).`,
        'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN',
        `export CLAUDE_CONFIG_DIR=${shq(runtime.configDir(acc.id))}`,
        `${shq(cliPath())} remote-control --name ${shq(rcName(acc))} --spawn same-dir --permission-mode ${mode || DEFAULT_MODE}`,
        'sleep 2',
        ''
    ].join('\n');
    let cur = '';
    try { cur = await fs.promises.readFile(file, 'utf8'); } catch (_) { cur = ''; }
    if (cur !== body) await fs.promises.writeFile(file, body, { mode: 0o700 });
    await fs.promises.chmod(file, 0o700);
    return file;
}

// ---------------------------------------------------------------- state

const states = new Map(); // id -> { state, message, at, source }
const busy = new Map();   // id -> promise
let gResources = null;

let usageHooked = false;
function bind(gr) {
    if (gr) gResources = gr;
    // banners follow usage: every new usage read pushes the fleet again (claudeUsage reads on its own feed)
    if (!usageHooked && gResources) {
        usageHooked = true;
        try { require('./claudeUsage').onRead(() => broadcast()); } catch (_) { usageHooked = false; }
        watchUnits();
    }
}

// Unit changes no action caused (a crash, a systemd restart) reach the screens without polling: the user
// journal logs every start / stop / failure of the units, and `journalctl -f` wakes us only on those lines.
let unitWatch = null;
let unitWatchDelay = 2000;
function watchUnits() {
    if (unitWatch || readOnly()) return;
    let child;
    try {
        child = require('child_process').spawn('journalctl', ['--user', '-f', '-n0', '-o', 'cat', '-u', TEMPLATE.replace('@.', '@*.'), '-u', LEGACY_UNIT], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (_) { return; }
    unitWatch = child;
    child.stdout.on('data', () => { unitWatchDelay = 2000; invalidateProbes(); broadcast(); });
    const again = () => {
        if (unitWatch !== child) return;
        unitWatch = null;
        const t = setTimeout(watchUnits, unitWatchDelay);
        unitWatchDelay = Math.min(unitWatchDelay * 2, 300000);
        if (t.unref) t.unref();
    };
    child.on('error', again);
    child.on('exit', again);
    if (child.unref) child.unref();
    if (child.stdout.unref) child.stdout.unref();
}

function setState(id, state, message) {
    states.set(id, { state, message: message || '', at: new Date().toISOString(), source: 'action' });
    broadcast();
}

let broadcastTimer = null;
function broadcast() {
    // several state changes in one action go out as one push
    if (broadcastTimer) return;
    broadcastTimer = setTimeout(async () => {
        broadcastTimer = null;
        try {
            const srv = gResources && (gResources.getWebSocketServer ? gResources.getWebSocketServer() : gResources.webSocketServer);
            if (!srv || typeof srv.broadcast !== 'function') return;
            const data = await status(gResources);
            const admin = (info) => !!(info && info.authenticated !== false && /^(admin|dev_admin)$/.test(String(info.userType || '')));
            srv.broadcast({ type: STATUS_TYPE, data, timestamp: new Date().toISOString() }, admin);
        } catch (e) {
            console.warn(`[claudeFleet] status push skipped: ${e.message}`);
        }
    }, 250);
    if (broadcastTimer.unref) broadcastTimer.unref();
}

async function unitInfo(unit) {
    const r = await systemctl(['show', unit, '-p', 'LoadState,ActiveState,SubState,MainPID,ActiveEnterTimestamp,NRestarts,UnitFileState'], 10000);
    const info = {};
    r.stdout.split('\n').forEach((line) => { const i = line.indexOf('='); if (i > 0) info[line.slice(0, i)] = line.slice(i + 1); });
    return {
        unit,
        installed: r.code === 0 && info.LoadState === 'loaded',
        active: info.ActiveState || 'unknown',
        sub: info.SubState || '',
        enabled: info.UnitFileState === 'enabled',
        pid: Number(info.MainPID) || null,
        since: info.ActiveEnterTimestamp || '',
        restarts: info.NRestarts ? Number(info.NRestarts) : 0
    };
}

async function paneInfo(id) {
    const r = await tmux(id, ['capture-pane', '-p', '-t', `=${tmuxOf(id)}:`]);
    if (r.code !== 0) return { state: 'unknown', statusLine: '', sessions: null, capacity: null, errorLine: '', tail: [], attached: false, raw: '' };
    return Object.assign(claudeHost.parsePane(r.stdout), { attached: true, raw: r.stdout });
}

/** The live sessions running on an account (by their CLI's CLAUDE_CONFIG_DIR; null = the host's login). */
function sessionsOn(dir) {
    const want = dir ? path.resolve(dir) : null;
    return claudeSessions.liveSessions().filter((s) => (s.configDir || null) === want);
}

/** The host's login file is a link into a moved account's config dir: the host's account has moved. */
function hostMigrated() {
    try {
        const st = fs.lstatSync(hostCredsFile());
        if (!st.isSymbolicLink()) return null;
        const target = path.resolve(path.dirname(hostCredsFile()), fs.readlinkSync(hostCredsFile()));
        const m = new RegExp(`${claudeHost.storeDir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([0-9a-f]{16})/config/\\.credentials\\.json$`).exec(target);
        return m ? m[1] : null;
    } catch (_) { return null; }
}

/**
 * A CardSpace / phone switch must not put this account's login on the host (claudeAccountHost asks):
 * the account runs its own Remote Control on its own login already, or the host's account has moved and
 * the host's login file is that account's own.
 */
function blocksLegacySwitch(accountIdToInstall) {
    if (hostMigrated()) return 'The host\'s account runs in its own folder: Remote Control no longer switches logins';
    if (accountIdToInstall && runtime.isMoved(accountIdToInstall)) return 'That account runs its own Remote Control in its own folder';
    return '';
}

async function rowFor(acc, legacy) {
    const moved = runtime.fleetInfo(acc.id);
    const fs8 = require('./claudeFleetSettings');
    const settings = fs8.get(gResources, acc.id);
    const usage = fs8.usageFor(acc.index);
    const row = {
        settings,
        usage,
        availability: fs8.availability(usage, settings),
        index: acc.index,
        id: acc.id,
        name: acc.name,
        email: acc.remoteLogin ? acc.remoteLogin.email : '',
        plan: acc.remoteLogin ? acc.remoteLogin.plan : '',
        hasLogin: !!acc.remoteLogin,
        onHost: acc.onHost,
        active: acc.active,
        moved: !!moved,
        movedAt: moved ? moved.movedAt : null,
        remoteName: rcName(acc),
        unit: null,
        state: 'not-moved',
        message: '',
        statusLine: '',
        sessions: [],
        capacity: null,
        canMove: !moved && !!acc.remoteLogin,
        moveRestartsHost: !moved && acc.onHost
    };
    if (!moved) {
        // still on the legacy unit (the host's login) or not running Remote Control at all
        if (acc.onHost && legacy) {
            row.unit = legacy.unit;
            row.state = legacy.state;
            row.statusLine = legacy.statusLine;
            row.message = 'On the host\'s login (claude-remote.service); move it last';
            row.sessions = sessionsOn(null).map(brief);
        } else {
            row.message = acc.remoteLogin ? 'No Remote Control of its own yet: Move to Own Folder' : 'No claude.ai login linked: Add Account or Link Host Login first';
        }
        return row;
    }
    const [unit, pane] = await Promise.all([cachedProbe(`unit:${unitOf(acc.id)}`, () => unitInfo(unitOf(acc.id))), cachedProbe(`pane:${acc.id}`, () => paneInfo(acc.id))]);
    row.unit = unit;
    row.statusLine = pane.statusLine;
    row.capacity = pane.capacity;
    const live = unit.active !== 'active' ? (unit.active === 'failed' ? 'error' : 'stopped') : pane.state;
    const cur = states.get(acc.id);
    const sticky = cur && cur.source === 'action' && (busy.has(acc.id) || (cur.state === 'error' && Date.now() - Date.parse(cur.at) < 2 * 60 * 1000));
    if (sticky) { row.state = cur.state; row.message = cur.message; } else {
        row.state = live === 'unknown' ? (unit.active === 'active' ? 'starting' : 'stopped') : live;
        row.message = live === 'error' ? (pane.errorLine || `${unit.unit} ${unit.active}`) : '';
    }
    row.sessions = sessionsOn(runtime.configDir(acc.id)).map(brief);
    return row;
}

const brief = (s) => ({ id: s.id, title: s.givenName || s.name || s.id.slice(0, 8), status: s.status, origin: s.origin, folder: s.cwd ? path.basename(s.cwd) : '', link: s.link, remoteControl: s.remoteControl });

/** Every account's Remote Control: its own (moved) or the legacy host unit. */
async function status(gr) {
    bind(gr);
    const accounts = claudeHost.listAccounts(gr || gResources);
    let legacy = null;
    if (accounts.some((a) => a.onHost && !runtime.isMoved(a.id))) {
        const st = claudeHost.publicStatus();
        const u = await cachedProbe(`unit:${LEGACY_UNIT}`, () => unitInfo(LEGACY_UNIT));
        legacy = { unit: u, state: u.active === 'active' ? (st.state && st.state !== 'unknown' ? st.state : 'connected') : (u.active === 'failed' ? 'error' : 'stopped'), statusLine: st.message || '' };
    }
    const rows = [];
    for (const acc of accounts) rows.push(await rowFor(acc, legacy));
    return { at: new Date().toISOString(), hostMigrated: !!hostMigrated(), accounts: rows };
}

// ---------------------------------------------------------------- actions

function findAcc(gr, index) {
    const acc = claudeHost.listAccounts(gr).find((a) => a.index === Number(index));
    if (!acc) throw new Error('No such Claude account');
    return acc;
}

async function waitConnected(id, timeoutMs) {
    const until = Date.now() + (timeoutMs || CONNECT_TIMEOUT_MS);
    let last = null;
    let answered = false;
    while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const unit = await unitInfo(unitOf(id));
        last = await paneInfo(id);
        if (unit.active === 'failed') return { ok: false, message: `${unit.unit} failed to start` };
        if (!answered && TRUST_RE.test(last.raw || '')) {
            // first start on this config dir: our own repo folder, and Remote Control is wanted on purpose
            answered = true;
            await tmux(id, ['send-keys', '-t', `=${tmuxOf(id)}:`, 'Enter']);
            continue;
        }
        if (unit.active === 'active' && last.state === 'connected') return { ok: true, message: last.statusLine || 'Connected' };
        if (unit.active === 'active' && last.state === 'error') return { ok: false, message: last.errorLine };
    }
    return { ok: false, message: (last && (last.errorLine || last.tail.join(' · '))) || 'Remote Control did not say Connected in time' };
}

function once(id, fn) {
    if (busy.has(id)) return busy.get(id);
    const p = (async () => fn())().finally(() => { busy.delete(id); broadcast(); });
    busy.set(id, p);
    return p;
}

async function startUnit(gr, acc, opts = {}) {
    await runtime.prepare(acc.id);
    await writeScript(acc, opts.mode);
    await ensureTemplate();
    const unit = unitOf(acc.id);
    const en = await systemctl(['enable', unit]);
    if (en.code !== 0) throw new Error(`Could not enable ${unit}: ${(en.stderr || '').trim().slice(0, 160)}`);
    const r = await systemctl([opts.restart ? 'restart' : 'start', unit]);
    if (r.code !== 0) throw new Error(`Could not start ${unit}: ${(r.stderr || '').trim().slice(0, 160)}`);
    return waitConnected(acc.id, opts.timeoutMs);
}

/**
 * Moves an account to its own folder and starts its own Remote Control. The account on the host's login
 * needs confirmHost (its move stops claude-remote.service and every session it runs); opts.carry: ids
 * of that server's sessions to resume on the account's own folder once it is connected.
 */
function moveToOwnFolder(gr, index, opts = {}) {
    bind(gr);
    if (readOnly()) return Promise.reject(new Error('Remote Control is read-only on this instance'));
    const acc = findAcc(gr, index);
    if (runtime.isMoved(acc.id)) return Promise.reject(new Error(`${acc.name} has its own folder already`));
    if (!acc.remoteLogin) return Promise.reject(new Error(`${acc.name} has no claude.ai login linked: Add Account or Link Host Login first`));
    if (acc.onHost && opts.confirmHost !== true) {
        return Promise.reject(new Error(`${acc.name} is the host's account: moving it restarts Remote Control and ends every session it runs (this one too). Move the other accounts first, then confirm.`));
    }
    return once(acc.id, async () => {
        const out = { index: acc.index, name: acc.name, carried: [] };
        try {
            setState(acc.id, 'reconnecting', `Moving ${acc.name} to its own folder`);
            let carry = [];
            if (acc.onHost) {
                const want = new Set((Array.isArray(opts.carry) ? opts.carry : []).map(String));
                carry = claudeSessions.listRemoteSessions().filter((s) => want.has(s.id) && s.resumable && s.cwd);
                claudeHost.saveLiveLoginBack(gr);
                const stop = await systemctl(['stop', LEGACY_UNIT]);
                if (stop.code !== 0) throw new Error(`Could not stop ${LEGACY_UNIT}: ${(stop.stderr || '').trim().slice(0, 160)}`);
                await systemctl(['disable', LEGACY_UNIT]);
                // the CLI may have rotated the login as it stopped: the freshest goes into the account's dir
                claudeHost.saveLiveLoginBack(gr);
            }
            await runtime.prepare(acc.id);
            if (acc.onHost) await linkHostLogin(acc.id);
            await runtime.writeFleetInfo(acc.id, { movedAt: new Date().toISOString(), name: acc.name, wasOnHost: !!acc.onHost });
            const done = await startUnit(gr, acc, opts);
            if (!done.ok) { setState(acc.id, 'error', done.message); return Object.assign(out, { state: 'error', message: done.message }); }
            if (carry.length) {
                const launcher = require('./claudeSessionLauncher');
                const until = Date.now() + 15000;
                while (carry.some((x) => claudeSessions.pidAlive(x.pid)) && Date.now() < until) await new Promise((r) => setTimeout(r, 250));
                for (const x of carry) {
                    try {
                        const r = await launcher.resume(gr, x.id, { account: acc.index, title: x.title });
                        out.carried.push({ id: x.id, title: x.title, state: r.state, link: r.link || '' });
                    } catch (e) { out.carried.push({ id: x.id, title: x.title, state: 'failed', message: e.message }); }
                }
            }
            setState(acc.id, 'connected', `${done.message}${carry.length ? ` · ${out.carried.filter((c) => c.state !== 'failed').length} of ${carry.length} sessions brought over` : ''}`);
            return Object.assign(out, { state: 'connected', message: done.message });
        } catch (e) {
            setState(acc.id, 'error', e.message);
            return Object.assign(out, { state: 'error', message: e.message });
        }
    });
}

/**
 * Moving the account that was on the host: the host's ~/.claude login is taken off the host (backed up first; anything
 * else the file held, such as MCP logins, is merged into the account's own file). It never becomes a link to the
 * account's login: a Claude run on the host would refresh it, replace the link with a copy, and the two copies of
 * one login would log each other out (Nov 26 2026: Douglas). Nothing runs on a host login any more.
 */
async function linkHostLogin(id) {
    const file = hostCredsFile();
    const target = path.join(runtime.configDir(id), '.credentials.json');
    let st = null;
    try { st = await fs.promises.lstat(file); } catch (_) { st = null; }
    if (st && st.isSymbolicLink()) { await fs.promises.unlink(file); return; }
    if (st && !st.isSymbolicLink()) {
        // keep whatever else the host's file holds (MCP logins): merge it into the account's own file
        const cur = (await runtime.readJson(file)) || {};
        const own = (await runtime.readJson(target)) || {};
        const merged = Object.assign({}, cur, own, { claudeAiOauth: (runtime.fresher(cur, own) || own).claudeAiOauth });
        await runtime.writeJsonAtomic(target, merged, 0o600);
        const backup = path.join(claudeHost.storeDir(), 'host-backup');
        await fs.promises.mkdir(backup, { recursive: true, mode: 0o700 });
        await fs.promises.copyFile(file, path.join(backup, `credentials-before-move-${Date.now()}.json`));
        await fs.promises.unlink(file);
    } else if (st) await fs.promises.unlink(file);
}

function start(gr, index, opts = {}) {
    bind(gr);
    const acc = findAcc(gr, index);
    if (!runtime.isMoved(acc.id)) return Promise.reject(new Error(`${acc.name} has no Remote Control of its own: Move to Own Folder first`));
    return once(acc.id, async () => {
        setState(acc.id, 'reconnecting', opts.restart ? 'Reconnecting' : 'Starting');
        try {
            const done = await startUnit(gr, acc, opts);
            setState(acc.id, done.ok ? 'connected' : 'error', done.message);
            return { index: acc.index, state: done.ok ? 'connected' : 'error', message: done.message };
        } catch (e) {
            setState(acc.id, 'error', e.message);
            return { index: acc.index, state: 'error', message: e.message };
        }
    });
}

const reconnect = (gr, index, opts = {}) => start(gr, index, Object.assign({}, opts, { restart: true }));

async function stop(gr, index) {
    bind(gr);
    const acc = findAcc(gr, index);
    if (!runtime.isMoved(acc.id)) throw new Error(`${acc.name} has no Remote Control of its own`);
    if (busy.has(acc.id)) throw new Error('It is starting: wait for it');
    const r = await systemctl(['stop', unitOf(acc.id)]);
    if (r.code !== 0) throw new Error(`Could not stop ${unitOf(acc.id)}`);
    setState(acc.id, 'stopped', 'Remote Control stopped (it starts again with the host; Start to start it now)');
    return { index: acc.index, state: 'stopped' };
}

/**
 * Undo for an account that was not the host's: its unit stops and is disabled, fleet.json goes (the
 * config dir stays, so its sessions can be resumed). The host's account is not moved back from here.
 */
async function leaveOwnFolder(gr, index) {
    bind(gr);
    const acc = findAcc(gr, index);
    const info = runtime.fleetInfo(acc.id);
    if (!info) throw new Error(`${acc.name} is not in its own folder`);
    if (info.wasOnHost || hostMigrated() === acc.id) throw new Error(`${acc.name} is the host's account: it stays in its own folder`);
    await systemctl(['stop', unitOf(acc.id)]);
    await systemctl(['disable', unitOf(acc.id)]);
    await fs.promises.rm(path.join(runtime.accountDir(acc.id), 'fleet.json'), { force: true });
    states.delete(acc.id);
    broadcast();
    return { index: acc.index, state: 'not-moved' };
}

/** At server start: the template is current and every moved account's unit is enabled (systemd runs it). */
async function armAll(gr) {
    bind(gr);
    try { await ensureTemplate(); } catch (e) { console.warn(`[claudeFleet] unit template: ${e.message}`); }
}

module.exports = {
    STATUS_TYPE, status, moveToOwnFolder, leaveOwnFolder, start, stop, reconnect, armAll, bind, broadcast,
    hostMigrated, blocksLegacySwitch, unitOf, tmuxOf, sessionsOn,
    _setRunner, _templateText: templateText, _resetTemplate: () => { templateChecked = false; }, _startUnit: startUnit
};
