'use strict';

/**
 * Fleet sessions on Fat Misaka (docs/fleet/sessions-on-misaka.md): the same Claude Code session Fleet starts on Dreamscape, but
 * running in tmux on the rack host, in its own replica worktree, so what an agent builds, tests and runs loads Misaka, not
 * Dreamscape.
 *
 *   resolveHost(gr, opts, ctx)   'misaka' | 'dreamscape' for a new session (opts.host, else Fleet setting sessionHost, falling
 *                                back to Dreamscape when the host cannot be used)
 *   launch(gr, o)                what claudeSessionLauncher.launch does for host 'misaka' (lease + wake, replica, account
 *                                login, config, tmux, watcher, agent-coord registration); answers the launcher's shape
 *   tmux(args)                   tmux on Misaka over ssh (the launcher's runner for a Misaka pane)
 *   recordOf(id) / records()     the launcher's own record of a Misaka session
 *   mirrorLive()                 live-session rows (claudeSessions.liveSessions shape) from the watcher stream's state files
 *   end(id, opts)                ends it: tmux, watcher, claims, replica (wip branch first when unpushed), lease, login copy
 *   endForWork(sessionId)        the Supervisor's hook when a work item ends
 *
 * Accounts: the refresh token never leaves Dreamscape. Misaka gets the access token only (refreshToken removed), pushed again
 * before it expires (accessTimer). Back to Dreamscape: agent-coord, Yozora MCP, the git credential and the AskUserQuestion hook
 * over one forced-command ssh key (scripts/fleet/misaka-gate.js). Nothing here logs or returns a token.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const spawnHelper = require('./spawnHelper');
const sshArgs = require('./misakaSshArgs');

const SERVER = 'misaka';
const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const YOZORA_HOST = 'yozora.bluesteel.737.jp.net';
const REPLICAS = '/srv/rack/replicas';
const LEASE_MINUTES = 1440;
const LIVE_FRESH_MS = 90 * 1000;
const TREE = path.resolve(__dirname, '..');

const shq = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;
const stateDir = () => sshArgs.stateDir();
const recordsFile = () => path.join(stateDir(), 'misaka-sessions.json');
const liveDir = () => path.join(stateDir(), 'misaka-live');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const unavailable = (message) => Object.assign(new Error(message), { code: 'MISAKA_UNAVAILABLE' });

// ---------------------------------------------------------------- records (the launcher's own, one JSON file)

let recCache = { mtime: 0, data: {} };
function records() {
    try {
        const st = fs.statSync(recordsFile());
        if (st.mtimeMs !== recCache.mtime) recCache = { mtime: st.mtimeMs, data: JSON.parse(fs.readFileSync(recordsFile(), 'utf8')) };
    } catch (_) { recCache = { mtime: 0, data: {} }; }
    return recCache.data;
}
function saveRecords(data) {
    fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
    const tmp = `${recordsFile()}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, recordsFile());
    recCache = { mtime: 0, data };
}
function recordOf(id) { const r = records()[String(id || '')]; return r && !r.ended ? r : null; }
function putRecord(rec) { const all = Object.assign({}, records()); all[rec.sessionId] = rec; saveRecords(all); }
function dropRecord(id) { const all = Object.assign({}, records()); delete all[id]; saveRecords(all); }

// ---------------------------------------------------------------- ssh, tmux, rack

function ssh(cmd, opts = {}) {
    return spawnHelper.run('ssh', [...sshArgs.sshOptions(), sshArgs.destination(), cmd], { timeout: opts.timeout || 20000, maxBuffer: 8 * 1024 * 1024, input: opts.input });
}
/** tmux on Misaka, the launcher's runner shape: { code, stdout, stderr }. args are tmux's own (after -L <socket>). */
function tmux(args, opts) {
    return ssh(`tmux -L ${sshArgs.cfg().socket} ${args.map((a) => (a === ';' ? ';' : shq(a))).join(' ')}`, opts);
}

function rack(req, timeoutMs) {
    return new Promise((resolve, reject) => {
        const file = process.env.AGENT_RACK_SOCKET || path.join(stateDir(), 'rack.sock');
        const sock = net.createConnection(file);
        let buf = '';
        const timer = setTimeout(() => { sock.destroy(); reject(new Error('Rack Manager did not answer in time')); }, timeoutMs || 60000);
        sock.setEncoding('utf8');
        sock.on('connect', () => sock.write(`${JSON.stringify(Object.assign({ by: 'fleet' }, req))}\n`));
        sock.on('data', (c) => { buf += c; if (buf.includes('\n')) { clearTimeout(timer); sock.end(); } });
        sock.on('close', () => {
            clearTimeout(timer);
            let out;
            try { out = JSON.parse(buf.split('\n')[0]); } catch (_) { return reject(new Error('Rack Manager answered something unreadable')); }
            if (!out.ok) return reject(new Error(out.error || 'Rack Manager failed'));
            resolve(out.result);
        });
        sock.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' || e.code === 'ECONNREFUSED' ? 'Rack Manager is not running' : e.message)); });
    });
}
const rackExec = async (cmd, user, timeoutS) => {
    const r = await rack({ op: 'exec', server: SERVER, cmd, user: user || 'rack', timeout_s: timeoutS || 120 }, ((timeoutS || 120) + 30) * 1000);
    return (r && r.result) || r;
};

async function powerState() {
    try { const r = await rack({ op: 'power', server: SERVER, action: 'status' }, 20000); return r && (r.state || (r.power && r.power.state)) || 'unknown'; } catch (_) { return 'unknown'; }
}

// ---------------------------------------------------------------- choosing the host

function liveTree() { return process.env.DREAMSCAPE_LIVE_TREE || TREE; }

/**
 * 'misaka' or 'dreamscape' for a session about to start. opts.host: 'misaka' (must work: throws when the host cannot be
 * used), 'dreamscape', or 'auto' / none (Fleet setting sessionHost; Misaka only when usable, else Dreamscape).
 */
async function resolveHost(gr, opts = {}) {
    const wanted = opts.host === 'misaka' || opts.host === 'dreamscape' ? opts.host : 'auto';
    if (wanted === 'dreamscape') return { host: 'dreamscape' };
    const fs8 = require('./claudeFleetSettings');
    const setting = typeof fs8.sessionHost === 'function' ? fs8.sessionHost(gr) : 'dreamscape';
    if (wanted === 'auto' && setting !== 'misaka') return { host: 'dreamscape' };
    const why = (() => {
        if (opts.resume) return 'a resumed session stays where its transcript is';
        if (opts.engine && opts.engine !== 'claude') return 'another engine runs through the Director bridge on Dreamscape';
        const cwd = opts.cwd ? path.resolve(String(opts.cwd)) : liveTree();
        if (cwd !== liveTree()) return 'replicas hold StaticForge only; this folder is another repository';
        if (process.env.DREAMSCAPE_REPLICA === '1') return 'this is a replica';
        return '';
    })();
    if (why) {
        if (wanted === 'misaka') throw unavailable(`Not on Fat Misaka: ${why}`);
        return { host: 'dreamscape', note: `Dreamscape (${why})` };
    }
    const st = await powerState();
    if (['unknown', 'shutting-down'].includes(st)) {
        if (wanted === 'misaka') throw unavailable(`Fat Misaka is ${st === 'unknown' ? 'not reachable through Rack Manager' : 'shutting down'}`);
        return { host: 'dreamscape', note: `Dreamscape (Fat Misaka is ${st})` };
    }
    return { host: 'misaka', power: st, auto: wanted === 'auto' };
}

// ---------------------------------------------------------------- the host: agent account, claude, scripts

let readyFor = '';
async function claudeVersion() {
    const bin = process.env.DREAMSCAPE_CLAUDE_CLI || path.join(os.homedir(), '.local', 'bin', 'claude');
    const real = fs.realpathSync(bin);
    return { file: real, version: path.basename(real) };
}

/** The agent account answers over ssh, runs the same Claude Code version as Dreamscape, and has the watcher script. */
async function ensureHost() {
    const v = await claudeVersion();
    if (readyFor === v.version) return v.version;
    const t = await ssh('echo up; ~/.local/bin/claude --version 2>/dev/null | head -1; node -v', { timeout: 30000 });
    if (t.code !== 0 || !/^up/.test(t.stdout)) throw unavailable(`The Fleet agent account on Fat Misaka does not answer over ssh (${String(t.stderr || '').trim().slice(0, 120) || `exit ${t.code}`})`);
    if (!new RegExp(`^${v.version.replace(/\./g, '\\.')}\\b`).test(String(t.stdout).split('\n')[1] || '')) {
        const dest = `${sshArgs.cfg().home}/.local/share/claude/versions/${v.version}`;
        const mk = await ssh(`mkdir -p ~/.local/share/claude/versions ~/.local/bin ~/fleet/sessions && echo ok`);
        if (!/ok/.test(mk.stdout)) throw unavailable('Could not prepare the agent account on Fat Misaka');
        const e = sshArgs.sshOptions().filter((x) => x !== '-T' && x !== '-q');
        const r = await spawnHelper.run('rsync', ['-e', `ssh ${e.map(shq).join(' ')}`, '--chmod=755', '--inplace', v.file, `${sshArgs.destination()}:${dest}`], { timeout: 600000 });
        if (r.code !== 0) throw unavailable(`Copying Claude Code ${v.version} to Fat Misaka failed (${String(r.stderr).trim().slice(0, 120)})`);
        const ln = await ssh(`ln -sf ${shq(dest)} ~/.local/bin/claude && ~/.local/bin/claude --version | head -1`);
        if (!ln.stdout.includes(v.version)) throw unavailable('The copied Claude Code does not run on Fat Misaka');
    }
    await install([{ p: 'fleet/misaka-watch.js', b64: fs.readFileSync(path.join(TREE, 'scripts', 'fleet', 'misaka-watch.js')).toString('base64'), mode: 0o755 }]);
    readyFor = v.version;
    return v.version;
}

const INSTALL_JS = "const fs=require('fs'),p=require('path');let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s),root=j.root;for(const f of j.files){const t=p.resolve(root,f.p);if(!t.startsWith(root+'/'))throw new Error('path');fs.mkdirSync(p.dirname(t),{recursive:true,mode:0o700});const tmp=t+'.tmp';fs.writeFileSync(tmp,Buffer.from(f.b64,'base64'),{mode:f.mode||0o600});fs.chmodSync(tmp,f.mode||0o600);fs.renameSync(tmp,t);}});";
/** Files into the agent account's home over ssh (paths relative to it, written atomically, modes kept). */
async function install(files) {
    const r = await ssh(`node -e ${shq(INSTALL_JS)}`, { input: JSON.stringify({ root: sshArgs.cfg().home, files }), timeout: 60000 });
    if (r.code !== 0) throw new Error(`Could not write files on Fat Misaka: ${String(r.stderr).trim().slice(0, 160)}`);
}
const file = (p, text, mode) => ({ p, b64: Buffer.from(text).toString('base64'), mode: mode || 0o600 });

// ---------------------------------------------------------------- the account's login (access token only)

async function readJson(f) { try { return JSON.parse(await fs.promises.readFile(f, 'utf8')); } catch (_) { return null; } }

/** { id, name, creds: claudeAiOauth without its refresh token, oauthAccount } for an account index (undefined: the host login). */
async function loginOf(gr, index) {
    const runtime = require('./claudeAccountRuntime');
    const host = require('./claudeAccountHost');
    // a 16-hex account id (scripts, tests): the account's store folder directly, no Fleet config needed
    const byId = /^[0-9a-f]{16}$/.test(String(index || ''));
    const fleetName = byId ? ((runtime.fleetInfo(index) || {}).name || index) : '';
    const acc = byId ? { id: String(index), index: null, name: fleetName } : index === undefined || index === null || index === '' || index === 'host' ? null : host.listAccounts(gr).find((a) => a.index === Number(index));
    if (index !== undefined && index !== null && index !== '' && index !== 'host' && !acc) throw new Error('No such Claude account');
    let creds;
    let oauthAccount = null;
    if (acc) {
        const dir = runtime.accountDir(acc.id);
        const linked = await readJson(path.join(dir, 'credentials.json'));
        const own = await readJson(path.join(runtime.configDir(acc.id), '.credentials.json'));
        creds = runtime.fresher(linked, own);
        const meta = (await readJson(path.join(dir, 'account.json'))) || {};
        oauthAccount = meta.oauthAccount || null;
        if (!oauthAccount) { const cj = await readJson(path.join(runtime.configDir(acc.id), '.claude.json')); oauthAccount = cj && cj.oauthAccount || null; }
    } else {
        creds = await readJson(path.join(os.homedir(), '.claude', '.credentials.json'));
        const cj = await readJson(path.join(os.homedir(), '.claude.json'));
        oauthAccount = cj && cj.oauthAccount || null;
    }
    const o = creds && creds.claudeAiOauth;
    if (!o || !o.accessToken) throw new Error(`${acc ? acc.name : 'The host login'} has no login to lend to Fat Misaka: sign in again in Claude Accounts`);
    const lent = Object.assign({}, o);
    delete lent.refreshToken;
    delete lent.refreshTokenExpiresAt;
    return { id: acc ? acc.id : 'host', index: acc ? acc.index : null, name: acc ? acc.name : 'host', creds: lent, expiresAt: Number(o.expiresAt) || 0, oauthAccount };
}

const loginFiles = (login, projects) => {
    const dir = `accounts/${login.id}/config`;
    const cj = { hasCompletedOnboarding: true, lastOnboardingVersion: '2.1.309', installMethod: 'native', autoUpdates: false, theme: 'dark', bypassPermissionsModeAccepted: true, projects };
    if (login.oauthAccount) cj.oauthAccount = login.oauthAccount;
    return [
        file(`${dir}/.credentials.json`, JSON.stringify({ claudeAiOauth: login.creds })),
        file(`${dir}/.claude.json`, JSON.stringify(cj))
    ];
};

// access tokens are pushed again before they expire (the refresh token stays on Dreamscape: claudeUsage / the local CLI refresh it)
/** A lease is at most 24 h: one that is 20 h old is renewed (same id) while its session lives. */
async function renewLeases() {
    for (const r of Object.values(records())) {
        if (r.ended || !r.leaseId || Date.now() - (r.leaseAt || r.startedAt) < 20 * 3600 * 1000) continue;
        try { await rack({ op: 'lease', server: SERVER, purpose: `Fleet session ${r.sessionId.slice(0, 8)}`, minutes: LEASE_MINUTES, id: r.leaseId, by: `claude-${r.sessionId.slice(0, 8)}` }, 60000); putRecord(Object.assign({}, r, { leaseAt: Date.now() })); } catch (e) { console.warn(`[misakaSessions] lease renew: ${e.message}`); }
    }
}
const accessTimers = new Map(); // account id -> timer
function accessTimer(_gr, _index, id) {
    const index = id === 'host' ? undefined : id; // by account id: no Fleet config needed (also after a server start)
    const gr = null;
    clearTimeout(accessTimers.get(id));
    const wait = async () => {
        let nextMs = 5 * 60 * 1000;
        try {
            if (!Object.values(records()).some((r) => !r.ended && r.accountId === id)) { accessTimers.delete(id); return; }
            await renewLeases();
            const login = await loginOf(gr, index);
            const left = login.expiresAt - Date.now();
            if (left < 60 * 60 * 1000 && !accessTimers.get(`${id}:pushed:${login.expiresAt}`)) {
                await install(loginFiles(login, {}).slice(0, 1));
                accessTimers.set(`${id}:pushed:${login.expiresAt}`, true);
            }
            nextMs = Math.max(60 * 1000, Math.min(10 * 60 * 1000, left - 55 * 60 * 1000));
        } catch (e) { console.warn(`[misakaSessions] access token push: ${e.message}`); }
        const t = setTimeout(wait, nextMs);
        if (t.unref) t.unref();
        accessTimers.set(id, t);
    };
    const t = setTimeout(wait, 60 * 1000);
    if (t.unref) t.unref();
    accessTimers.set(id, t);
}

// ---------------------------------------------------------------- replica

const replicaName = (id) => `fleet-${id.slice(0, 8)}`;
const srcOf = (name) => `${REPLICAS}/${name}/src`;

async function ensureReplica(name, id, title) {
    const st = await rack({ op: 'role', server: SERVER, role: 'replicas' }, 90000);
    const data = (st && st.data) || {};
    if ((data.replicas || []).some((r) => r.name === name)) return;
    // worktree mode checks the ref out of an existing image: the newest image's ref, so no 12-minute image build per session;
    // the session then moves its checkout to origin/main itself (setupCheckout)
    const image = (data.images || []).slice().sort((a, b) => String(b.builtAt).localeCompare(String(a.builtAt)))[0];
    const seed = (data.seeds || []).slice().sort((a, b) => String(b.takenAt).localeCompare(String(a.takenAt)))[0];
    const r = await rack({ op: 'role', server: SERVER, role: 'replicas', action: 'create', params: { name, ref: image ? image.commit : 'main', mode: 'worktree', seed: seed ? seed.id : 'empty', owner: `claude-${id.slice(0, 8)}`, purpose: `Fleet session ${String(title || '').slice(0, 120)}` } }, 90000);
    const jobId = r && r.job && (r.job.id || (r.job.job && r.job.job.id));
    if (!jobId) throw new Error('Rack Manager did not start the replica');
    const until = Date.now() + (image ? 8 : 40) * 60 * 1000;
    while (Date.now() < until) {
        await sleep(3000);
        const j = await rack({ op: 'job', server: SERVER, id: jobId, tail: 8 }, 30000);
        const job = (j && j.job && (j.job.job || j.job)) || {};
        if (job.state && job.state !== 'running') {
            if (job.state === 'done') return;
            throw new Error(`The replica could not be created: ${String(job.log || '').split('\n').filter(Boolean).slice(-2).join(' / ').slice(0, 240)}`);
        }
    }
    throw new Error('The replica took too long to create');
}

async function deleteReplica(name) {
    try { await rack({ op: 'role', server: SERVER, role: 'replicas', action: 'delete', params: { name, confirm: true } }, 120000); return true; } catch (e) { console.warn(`[misakaSessions] replica ${name} delete: ${e.message}`); return false; }
}

// ---------------------------------------------------------------- the session's scripts

const gateOptions = (c) => ['-q', '-T', '-i', c.gateKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${c.gateKnown}`, '-o', 'ServerAliveInterval=30', '-o', 'ServerAliveCountMax=4', '-o', 'ConnectTimeout=10'];
function gateAddress() {
    if (process.env.DREAMSCAPE_GATE_ADDR) return process.env.DREAMSCAPE_GATE_ADDR;
    const m = sshArgs.cfg().host.split('.').slice(0, 3).join('.');
    for (const list of Object.values(os.networkInterfaces())) for (const a of list || []) if (a.family === 'IPv4' && !a.internal && a.address.startsWith(`${m}.`)) return a.address;
    throw unavailable('Dreamscape has no address on the rack network');
}

function gitIdentity() {
    const g = (k) => { try { return require('child_process').execFileSync('git', ['config', '--global', k], { encoding: 'utf8', timeout: 3000 }).trim(); } catch (_) { return ''; } };
    return { name: g('user.name') || 'Fleet agent', email: g('user.email') || 'fleet@dreamscape.invalid' };
}

/** The scripts and config of one session, as install() files. */
function sessionFiles(o, ctx) {
    const c = sshArgs.cfg();
    const addr = gateAddress();
    const gate = `${c.gateUser}@${addr}`;
    const ssh2 = [...gateOptions(c)];
    const id8 = o.id.slice(0, 8);
    const dir = `fleet/sessions/${o.id}`;
    const abs = `${c.home}/${dir}`;
    const cfgDir = `${c.home}/accounts/${ctx.login.id}/config`;
    const coordEnv = [
        `AGENT_COORD_ID=claude-${id8}`, 'AGENT_COORD_KIND=claude', `AGENT_COORD_CWD=${ctx.cwd}`, 'AGENT_COORD_HOST=fat-misaka', 'AGENT_COORD_REPO=staticforge',
        `AGENT_COORD_ROOT=${ctx.cwd}`, `AGENT_COORD_SESSION_ID=${o.id}`, `AGENT_COORD_ACCOUNT=${String(ctx.login.name).replace(/[^A-Za-z0-9._-]/g, '_')}`,
        `AGENT_COORD_TMUX=${ctx.tmuxName}:${c.socket}`, `AGENT_COORD_BRANCH=work/${ctx.replica}`, `AGENT_COORD_NAME_B64=${Buffer.from(String(o.title || id8).slice(0, 120)).toString('base64')}`
    ];
    const ident = o.gitIdentity === 'claude' ? 'claude' : 'fleet';
    const mcp = { mcpServers: {
        'agent-coord': { type: 'stdio', command: 'ssh', args: [...ssh2, gate, `mcp-agent-coord ${coordEnv.join(' ')}`], env: {} },
        yozora: { type: 'stdio', command: 'ssh', args: [...ssh2, gate, `mcp-yozora ident=${ident}`], env: {} }
    } };
    const settings = {
        env: { DISABLE_AUTOUPDATER: '1' }, permissions: { defaultMode: 'bypassPermissions' }, skipDangerousModePermissionPrompt: true, theme: 'dark',
        hooks: { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: `ssh ${ssh2.map(shq).join(' ')} ${shq(gate)} ask-hook`, timeout: 660 }] }] }
    };
    const helperKey = `credential.https://${YOZORA_HOST}.helper`;
    const helper = `!f(){ test "$1" = get || exit 0; ssh ${ssh2.map(shq).join(' ')} ${shq(gate)} 'git-credential ident=${ident}'; }; f`;
    const gi = gitIdentity();
    const envLines = [
        `export HOME=${shq(c.home)}`, `export PATH=${shq(`${c.home}/.local/bin:/usr/local/bin:/usr/bin:/bin`)}`,
        `export CLAUDE_CONFIG_DIR=${shq(cfgDir)}`, 'export CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 DISABLE_AUTOUPDATER=1',
        'export FLEET_SESSION=1 FLEET_HOST=misaka', `export FLEET_REPLICA=${shq(ctx.replica)} FLEET_WORKTREE=${shq(ctx.cwd)}`,
        ...coordEnv.map((kv) => `export ${kv.slice(0, kv.indexOf('='))}=${shq(kv.slice(kv.indexOf('=') + 1))}`),
        'export GIT_CONFIG_COUNT=2', `export GIT_CONFIG_KEY_0=${shq(helperKey)} GIT_CONFIG_VALUE_0=''`, `export GIT_CONFIG_KEY_1=${shq(helperKey)} GIT_CONFIG_VALUE_1=${shq(helper)}`,
        `export GIT_AUTHOR_NAME=${shq(gi.name)} GIT_AUTHOR_EMAIL=${shq(gi.email)} GIT_COMMITTER_NAME=${shq(gi.name)} GIT_COMMITTER_EMAIL=${shq(gi.email)}`
    ].join('\n');
    const run = [
        '#!/bin/bash', `cd ${shq(ctx.cwd)} || exit 1`, 'for v in $(env | sed -n \'s/^\\(CLAUDE[A-Za-z0-9_]*\\)=.*/\\1/p\'); do unset "$v"; done',
        'unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN TMUX TMUX_PANE', `. ${shq(`${abs}/env.sh`)}`,
        `${shq(`${c.home}/.local/bin/claude`)} ${ctx.args.map((a) => shq(a)).join(' ')}; sleep 3600`, ''
    ].join('\n');
    const watch = [
        '#!/bin/bash', `cd ${shq(abs)} || exit 1`, `. ${shq(`${abs}/env.sh`)}`,
        'while [ ! -e done ]; do',
        `  node ${shq(`${c.home}/fleet/misaka-watch.js`)} ${o.id} ${shq(cfgDir)} ${shq(`${abs}/done`)} | ssh ${ssh2.map(shq).join(' ')} ${shq(gate)} ${shq(`ingest ${o.id}`)}`,
        '  [ -e done ] && break', '  sleep 5', 'done', ''
    ].join('\n');
    return { files: [file(`${dir}/env.sh`, `${envLines}\n`), file(`${dir}/mcp.json`, JSON.stringify(mcp, null, 2)), file(`${dir}/run.sh`, run, 0o700), file(`${dir}/watch.sh`, watch, 0o700),
        file(`accounts/${ctx.login.id}/config/settings.json`, JSON.stringify(settings, null, 2))], abs };
}

const MISAKA_NOTE = (ctx) => [
    '## You run on Fat Misaka (the rack host), not on Dreamscape',
    `Your working folder is your own replica worktree ${ctx.cwd} (branch work/${ctx.replica}, started from origin/main) with its own Dreamscape replica server (${ctx.replicaUrl}; its sign-in secrets: rack_role replicas action login {name:"${ctx.replica}"}). Edit, test and run only there.`,
    'The live-tree rules change for you: there is no live tree to edit and no Dreamscape restart from here. Commit your work and push it to main on Yozora (git push origin HEAD:main after git pull --rebase origin main; the git credential is already set up, never ask for a token). Unpushed work is saved to a wip branch when the session ends, but pushed work is the deliverable.',
    'Where the brief below mentions the live tree, reload-server-module, a restart or the server\'s own paths, do it in your replica instead (restart its replica server through rack_role replicas restart; no Dreamscape restart, no live-tree edit).',
    'agent-coord, memory, Fleet and Yozora tools work as usual over a back-channel to Dreamscape (claims name paths in the StaticForge repo, so they conflict with agents editing the live tree). Phones, the Fold and the shared devices are reached through coord_device_request as always.',
    `Your replica and this session end when your work item ends. To keep the replica, run: touch ~/fleet/sessions/${ctx.id}/keep-replica`
].join('\n');

// ---------------------------------------------------------------- launch

async function launch(gr, o) {
    const launcher = require('./claudeSessionLauncher');
    const id = o.id;
    if (!SID_RE.test(id)) throw new Error('Bad session id');
    const name = launcher._tmuxName(id);
    const replica = replicaName(id);
    const cwd = srcOf(replica);
    const rec = { sessionId: id, host: 'fat-misaka', tmux: name, replica, cwd, title: o.title || id.slice(0, 8), startedAt: Date.now(), workId: o.workId || null, gitIdentity: o.gitIdentity === 'claude' ? 'claude' : 'fleet' };
    let leaseId = '';
    let replicaMade = false;
    try {
        // 1. the host is on for the session's life
        const l = await rack({ op: 'lease', server: SERVER, purpose: `Fleet session ${id.slice(0, 8)}`, minutes: LEASE_MINUTES, wait: true, by: `claude-${id.slice(0, 8)}` }, 660000)
            .catch((e) => { throw unavailable(`Fat Misaka could not be woken: ${e.message}`); });
        leaseId = (l && l.lease && l.lease.id) || '';
        rec.leaseId = leaseId;
        rec.leaseAt = Date.now();
        // 2. the agent account, its Claude Code, the watcher script
        await ensureHost();
        // 3. the replica worktree
        await ensureReplica(replica, id, o.title);
        replicaMade = true;
        rec.replicaUrl = '';
        try {
            const rs = await rack({ op: 'role', server: SERVER, role: 'replicas' }, 60000);
            const mine = ((rs && rs.data && rs.data.replicas) || []).find((r) => r.name === replica);
            rec.replicaUrl = mine ? (mine.urlDirect || mine.url || '') : '';
        } catch (_) { /* the note goes without it */ }
        const ch = await rackExec(`chown -R agents:agents ${shq(cwd)} && echo ok`, 'root', 120);
        if (!/ok/.test(ch.stdout || '')) throw new Error('Could not hand the replica worktree to the agent account');
        // 4. the login (access token only) and the session's config
        const login = await loginOf(gr, o.account);
        rec.accountId = login.id;
        rec.accountName = login.name;
        rec.accountIndex = login.index;
        const projects = { [cwd]: { hasTrustDialogAccepted: true, allowedTools: [], mcpServers: {}, hasClaudeMdExternalIncludesApproved: true, hasClaudeMdExternalIncludesWarningShown: true } };
        const args = launcher.buildArgs(o, { title: rec.title, mcpConfig: `${sshArgs.cfg().home}/fleet/sessions/${id}/mcp.json` });
        args.splice(args.indexOf('--mcp-config') + 2, 0, '--strict-mcp-config');
        if (args.includes('--') && o.prompt) args[args.length - 1] = `${MISAKA_NOTE({ cwd, replica, replicaUrl: rec.replicaUrl || 'its port on Fat Misaka', id })}\n\n${String(o.prompt).slice(0, 18000)}`;
        const sf = sessionFiles(Object.assign({}, o, { title: rec.title, gitIdentity: rec.gitIdentity }), { login, cwd, replica, tmuxName: name, args });
        await install([...loginFiles(login, projects), ...sf.files]);
        // 5. the checkout moves to origin/main (the image the worktree came from may be older)
        const co = await ssh(`. ${shq(`${sf.abs}/env.sh`)}; cd ${shq(cwd)} && git fetch -q origin main && git checkout -q -B work/${replica} origin/main && git log -1 --format=%h`, { timeout: 120000 });
        if (co.code !== 0) throw new Error(`The replica worktree could not move to origin/main: ${String(co.stderr).trim().slice(0, 160)}`);
        rec.baseCommit = String(co.stdout).trim();
        putRecord(rec);
        accessTimer(gr, login.index !== null ? login.index : (login.id === 'host' ? undefined : login.id), login.id);
        // 6. tmux there: the watcher first (it waits for the session's files), then the session
        const sock = sshArgs.cfg().socket;
        await ssh(`tmux -L ${sock} start-server\\; set -g exit-empty off 2>/dev/null; tmux -L ${sock} kill-session -t ${shq(`=fleetwatch-${id.slice(0, 8)}`)} 2>/dev/null; true`);
        const w = await tmux(['new-session', '-d', '-s', `fleetwatch-${id.slice(0, 8)}`, '-x', '200', '-y', '10', '-c', `${sshArgs.cfg().home}/fleet`, `bash ${shq(`${sf.abs}/watch.sh`)}`]);
        if (w.code !== 0) throw new Error(`The watcher did not start: ${String(w.stderr).trim().slice(0, 120)}`);
        const r = await tmux(['new-session', '-d', '-s', name, '-x', '200', '-y', '50', '-c', cwd, `bash ${shq(`${sf.abs}/run.sh`)}`]);
        if (r.code !== 0) throw new Error(`Could not start it: ${String(r.stderr).trim().slice(0, 120) || 'tmux failed'}`);
        launcher._coordNote({ id: `claude-${id.slice(0, 8)}`, kind: 'claude', name: rec.title, sessionId: id, account: login.name, task: o.task || rec.title, cwd, repo: 'staticforge', branch: `work/${replica}`, host: 'fat-misaka', tmux: `${name} (${sock})`, model: o.model || '', effort: o.effort || '', dispatchedBy: o.dispatchedBy || '' });
        const res = await launcher.watch(name, Object.assign({}, o, { tmuxFn: tmux }));
        return Object.assign({ id, tmuxSession: name, account: { index: login.index, name: login.name, onHost: false }, engine: 'claude', model: o.model || null, effort: o.effort || null, host: 'misaka', replica, cwd }, res);
    } catch (e) {
        // nothing stays behind a start that failed
        await end(id, { reason: 'start failed', keepRecord: false, partial: { leaseId, replica: replicaMade ? replica : '' } }).catch(() => {});
        throw e;
    }
}

// ---------------------------------------------------------------- the live mirror

let liveCache = new Map(); // file -> { mtime, v }
/** Live-session rows (the claudeSessions.liveSessions shape plus host) for Misaka sessions whose watcher spoke in the last 90 s. */
function mirrorLive() {
    let names = [];
    try { names = fs.readdirSync(liveDir()).filter((n) => /^[0-9a-f-]{36}\.json$/.test(n)); } catch (_) { return []; }
    const recs = records();
    const out = [];
    const now = Date.now();
    for (const n of names) {
        const f = path.join(liveDir(), n);
        let v;
        try {
            const st = fs.statSync(f);
            const hit = liveCache.get(f);
            if (hit && hit.mtime === st.mtimeMs) v = hit.v;
            else { v = JSON.parse(fs.readFileSync(f, 'utf8')); liveCache.set(f, { mtime: st.mtimeMs, v }); }
        } catch (_) { continue; }
        const rec = recs[v.sessionId];
        if (!rec || rec.ended || !v.alive || now - Number(v.seenAt || 0) > LIVE_FRESH_MS) continue;
        const r = v.rec || {};
        let cfgDir = null;
        try { if (rec.accountId && rec.accountId !== 'host') cfgDir = require('./claudeAccountRuntime').configDir(rec.accountId); } catch (_) { cfgDir = null; }
        out.push({
            id: v.sessionId, pid: null, cwd: rec.cwd, name: String(r.name || rec.title || ''), givenName: r.name && r.nameSource && r.nameSource !== 'derived' ? String(r.name) : '',
            status: String(r.status || ''), origin: 'tmux', tmuxSession: rec.tmux, remoteControl: !!r.bridgeSessionId, link: '', updatedAt: Number(r.updatedAt) || 0,
            startedAt: Number(r.startedAt) || rec.startedAt, procStart: '', configDir: cfgDir, host: 'fat-misaka', replica: rec.replica
        });
    }
    return out;
}

// ---------------------------------------------------------------- ending

/**
 * Ends a session's life on Fat Misaka. opts: { reason, keepReplica, partial: { leaseId, replica } (a start that failed part-way) }.
 * Unpushed or uncommitted work in the replica is pushed to a wip/<agent id> branch first (the rule for stopped agents).
 */
async function end(sessionId, opts = {}) {
    const rec = Object.assign({}, records()[sessionId] || {}, opts.partial || {});
    const id8 = String(sessionId).slice(0, 8);
    const c = sshArgs.cfg();
    const out = { id: sessionId, wip: '', replicaDeleted: false, leaseReleased: false };
    if (!records()[sessionId] && !opts.partial) return Object.assign(out, { note: 'not a Misaka session' });
    const replica = rec.replica || '';
    const dir = `${c.home}/fleet/sessions/${sessionId}`;
    let keep = opts.keepReplica === true || rec.keepReplica === true;
    if (replica) {
        try {
            const k = await ssh(`test -e ${shq(`${dir}/keep-replica`)} && echo keep; true`, { timeout: 15000 });
            if (/keep/.test(k.stdout)) keep = true;
        } catch (_) { /* no marker */ }
    }
    // 1. the session and its watcher stop (done marker first: the watch loop must not restart the stream)
    await ssh(`touch ${shq(`${dir}/done`)} 2>/dev/null; tmux -L ${c.socket} kill-session -t ${shq(`=${rec.tmux || `rc-${id8}`}`)} 2>/dev/null; tmux -L ${c.socket} kill-session -t ${shq(`=fleetwatch-${id8}`)} 2>/dev/null; true`, { timeout: 20000 }).catch(() => {});
    // 2. work that was not pushed is kept on a wip branch
    if (replica && !keep) {
        try {
            const cwd = srcOf(replica);
            const s = await ssh(`. ${shq(`${dir}/env.sh`)}; cd ${shq(cwd)} 2>/dev/null || exit 0; git add -A >/dev/null 2>&1; git diff --cached --quiet || git commit -q -m ${shq(`wip: ${rec.title || id8} (session ended: ${opts.reason || 'ended'})`)}; if [ -n "$(git log origin/main..HEAD --oneline 2>/dev/null)" ]; then git push -q origin HEAD:refs/heads/wip/claude-${id8} && echo wip/claude-${id8}; fi`, { timeout: 90000 });
            out.wip = String(s.stdout || '').trim().split('\n').pop() || '';
        } catch (e) { console.warn(`[misakaSessions] wip push for ${id8}: ${e.message}`); }
    }
    // 3. what it held in agent-coord
    try {
        const store = require('./agentCoord/store');
        const agent = `claude-${id8}`;
        store.releaseAll(agent);
        try { require('./agentCoord/deviceQueue').releaseAgent(agent); } catch (_) { /* none */ }
        store.setStatus(agent, 'gone');
    } catch (_) { /* no agent row */ }
    // 4. the replica, the lease, the login copy
    if (replica && !keep) out.replicaDeleted = await deleteReplica(replica);
    if (rec.leaseId) { try { await rack({ op: 'lease_release', id: rec.leaseId, by: `claude-${id8}` }, 30000); out.leaseReleased = true; } catch (e) { console.warn(`[misakaSessions] lease release: ${e.message}`); } }
    const others = Object.values(records()).filter((r) => r.sessionId !== sessionId && !r.ended && r.accountId && r.accountId === rec.accountId);
    if (rec.accountId && !others.length) await ssh(`rm -f ${shq(`${c.home}/accounts/${rec.accountId}/config/.credentials.json`)}`, { timeout: 15000 }).catch(() => {});
    await ssh(`rm -rf ${shq(dir)}`, { timeout: 15000 }).catch(() => {});
    try { fs.rmSync(path.join(liveDir(), `${sessionId}.json`), { force: true }); } catch (_) { /* gone */ }
    if (records()[sessionId]) { const all = Object.assign({}, records()); all[sessionId] = Object.assign({}, all[sessionId], { ended: Date.now(), endReason: opts.reason || 'ended', keepReplica: keep }); if (opts.keepRecord === false) delete all[sessionId]; saveRecords(all); }
    if (keep) out.keptReplica = replica;
    return out;
}

/** At module load / reload: the access-token timer of every account that has a live Misaka session (a server restart must not let a running login expire). */
function rearm() {
    const ids = new Set(Object.values(records()).filter((r) => !r.ended && r.accountId).map((r) => r.accountId));
    ids.forEach((id) => { if (!accessTimers.has(id)) accessTimer(null, null, id); });
    return [...ids];
}

/** The Supervisor's hook: a work item ended, so its Misaka session (if any) ends too. Never throws. */
async function endForWork(sessionId, reason) {
    if (!sessionId || !recordOf(sessionId)) return null;
    try { return await end(sessionId, { reason: reason || 'work item ended' }); } catch (e) { console.warn(`[misakaSessions] end ${String(sessionId).slice(0, 8)}: ${e.message}`); return null; }
}

/** Ends every Misaka session whose watcher went quiet for an hour (the host went away): called by Fleet maintenance. */
function describe(id) {
    const r = records()[id];
    return r ? { host: 'fat-misaka', replica: r.replica, cwd: r.cwd, lease: r.leaseId || '', replicaUrl: r.replicaUrl || '' } : null;
}

module.exports = { rearm, resolveHost, launch, tmux, ssh, recordOf, records, mirrorLive, end, endForWork, describe, loginOf, install, sshOptions: sshArgs.sshOptions, destination: sshArgs.destination, cfg: sshArgs.cfg, _test: { sessionFiles, MISAKA_NOTE, replicaName, srcOf, loginFiles } };

require('./hotReload').mark(module, {
    dispose() { accessTimers.forEach((t) => { if (t && t.unref) clearTimeout(t); }); accessTimers.clear(); return { readyFor }; },
    accept(state) { if (state) readyFor = state.readyFor || ''; rearm(); }
});
const armLater = setTimeout(() => { try { rearm(); } catch (_) { /* later */ } }, 5000);
if (armLater.unref) armLater.unref();
