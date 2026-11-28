'use strict';

/**
 * Rack Manager, the Dreamscape side (docs/rack-manager/README.md): the rack servers' iLO (console, hardware, power) and
 * their roles (rackd on the host, over a supervised ssh tunnel). One module serves three callers: the MMC console
 * (WS packets rack_*, modules/ws/handlers/322-rackManagerHandler.js), Fleet agents (unix socket rack.sock beside the
 * agent-coord DB, the rack_* MCP tools) and the server itself (require('./rackManager')).
 *
 *   servers   .cache/rack-manager/servers.json (defaults written when missing)
 *   tunnels   ssh -N -L 127.0.0.1:<free port>:127.0.0.1:8791 <alias>, one per server, started on first use, supervised
 *             with backoff 2 s .. 60 s by modules/rackManager/supervisor.js (a lean child: the 800 MB server never forks
 *             per child). State: up | down | not-deployed (no token file) | connecting. Extra forwards (sandbox CDP,
 *             emulator adb) are closed after 10 min unused.
 *   iLO       modules/rackManager/ilo/ (a copy of ~/ilo-console) runs as a child of the supervisor on a unix socket
 *             (ilo.sock); this module is its client and the WebSocket proxy in front of it.
 *   events    one SSE stream to rackd /v1/events per server, only while a subscriber (WS client or Fleet follow) exists.
 *   audit     every write is appended to .cache/rack-manager/audit.jsonl (secrets dropped).
 *   guard     WS and HTTP: an administrator with a full sign-in (modules/adminTerminal.js). Fleet (rack.sock) is the
 *             owner's socket (0600); destructive actions from Fleet need params.confirm === true.
 *
 * No timer runs while nobody is subscribed and nothing is connecting (server-push-not-polling).
 */

const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const net = require('net');
const http = require('http');
const { fork } = require('child_process');
const { EventEmitter } = require('events');

const ROOT = path.join(__dirname, '..', '..');
const ROLES = ['vms', 'android', 'sandboxes', 'terminal', 'storage', 'networking', 'services', 'logs', 'updates', 'containers', 'builds', 'replicas'];
const NAME_RE = /^[a-z][a-z0-9_-]{0,40}$/;
const FILE_RE = /^[A-Za-z0-9._-]{1,200}$/;
const POWER_OPS = { press: 0, hold: 1, cold: 2, reset: 3 };
const ILO_WHAT = { health: 'health', power: 'power', history: 'history', logs: 'logs', memory: 'memory', media: 'vm', settings: 'ilo/settings', users: 'ilo/users' };
const ILO_QUERY = new Set(['range', 'points', 'to', 'which', 'fresh']);
const FORWARD_IDLE_MS = 10 * 60 * 1000;
const SSE_RETRY_MIN = 2000;
const SSE_RETRY_MAX = 30000;
const INFO_TTL_MS = 10000;
const MAX_BODY = 16 * 1024 * 1024;

const DEFAULT_SERVERS = [
    { name: 'misaka', label: 'Fat Misaka', model: 'ProLiant DL580 G7', ilo: 'misaka', host: '192.168.100.42', ssh: 'fat-misaka', rackdPort: 8791, tokenFile: '~/.secrets/rackd-misaka.token' },
    { name: 'asuka', label: 'Chubby Asuka', model: 'ProLiant DL380 G5', ilo: 'asuka', host: '192.168.100.40', ssh: 'chubby-asuka', rackdPort: 8791, tokenFile: '~/.secrets/rackd-asuka.token' }
];

const events = new EventEmitter();
const T = { root: null, iloSock: null, noSpawn: false, sshCmd: null, socket: null, coord: null, iloEnv: null };

class RackError extends Error {
    constructor(code, message, extra) { super(message); this.code = code; if (extra) Object.assign(this, extra); }
}

const newState = () => ({ servers: null, rt: new Map(), sup: null, supervised: new Set(), sockServer: null, iloReady: null, iloSeen: false, leases: new Map(), leasesLoaded: false, iloFeed: null, iloFeedTimer: null, iloFeedBackoff: 2000 });
let S = newState();

const dataDir = () => T.root || path.join(ROOT, '.cache', 'rack-manager');
const expand = (p) => String(p || '').replace(/^~(?=\/|$)/, os.homedir());
const sleep = (ms) => new Promise((r) => { const t = setTimeout(r, ms); if (t.unref) t.unref(); });

// ---------------------------------------------------------------- servers

function loadServers() {
    if (S.servers) return S.servers;
    const file = path.join(dataDir(), 'servers.json');
    let list = null;
    try { list = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { list = null; }
    if (!Array.isArray(list) || !list.length) {
        list = DEFAULT_SERVERS;
        try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(list, null, 2) + '\n'); } catch (e) { console.warn(`[rackManager] servers.json: ${e.message}`); }
    }
    S.servers = list.filter((s) => s && NAME_RE.test(String(s.name || '')));
    return S.servers;
}

function serverOf(name) {
    const s = loadServers().find((x) => x.name === String(name));
    if (!s) throw new RackError('UNKNOWN_SERVER', `Unknown server ${String(name).slice(0, 40)}`);
    return s;
}

function rtOf(name) {
    let r = S.rt.get(name);
    if (!r) {
        r = { tunnel: { state: 'down', port: null, error: null, ready: null }, extras: new Map(), subs: new Map(), sse: null, sseTimer: null, sseBackoff: SSE_RETRY_MIN, info: null,
            power: { state: 'unknown', since: Date.now(), hostOn: null, post: null }, idle: null, idleTimer: null, idleAt: null, lastLeaseEnd: 0, bootTimer: null, waiters: [], timings: {} };
        S.rt.set(name, r);
    }
    return r;
}

// ---------------------------------------------------------------- the supervisor child

function ensureSup() {
    if (S.sup && S.sup.connected) return S.sup;
    if (T.noSpawn) throw new RackError('NO_SPAWN', 'Process spawning is disabled');
    S.supervised = new Set();
    const sup = fork(path.join(__dirname, 'supervisor.js'), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=48'] });
    sup.on('message', (m) => module.exports._onSup(m));
    sup.on('exit', () => {
        if (S.sup !== sup) return;
        S.sup = null;
        S.supervised = new Set();
        S.iloReady = null;
        S.rt.forEach((r, name) => { if (r.tunnel.state !== 'not-deployed') setTunnelState(name, 'down', 'The supervisor ended'); });
    });
    sup.unref();
    if (sup.channel && sup.channel.unref) sup.channel.unref();
    S.sup = sup;
    return sup;
}

function supStart(id, cmd, args, env) {
    ensureSup().send({ op: 'start', id, cmd, args, env });
    S.supervised.add(id);
}

function supStop(id) {
    S.supervised.delete(id);
    if (S.sup && S.sup.connected) { try { S.sup.send({ op: 'stop', id }); } catch (_) { /* gone */ } }
}

function lastLine(tail) {
    const lines = String(tail || '').split('\n').map((l) => l.trim()).filter(Boolean);
    return (lines[lines.length - 1] || '').slice(0, 200);
}

function onSup(m) {
    if (!m || !m.id) return;
    const mt = /^tun:(.+)$/.exec(m.id);
    if (mt) {
        const name = mt[1];
        if (!S.rt.has(name)) return;
        if (m.ev === 'spawn') { setTunnelState(name, 'connecting'); kickProbe(name, 20000); }
        else if (m.ev === 'exit') setTunnelState(name, 'down', lastLine(m.tail) || `ssh ended (${m.code})`);
        return;
    }
    if (m.ev === 'exit' && m.id === 'ilo') { S.iloReady = null; console.warn(`[rackManager] iLO service ended (${m.code}): ${lastLine(m.tail)}`); }
}

// ---------------------------------------------------------------- tunnels

function setTunnelState(name, state, error) {
    const t = rtOf(name).tunnel;
    const changed = t.state !== state;
    t.state = state;
    t.error = state === 'up' ? null : (error || t.error || null);
    if (changed) {
        events.emit('state', { server: name, state });
        dispatch(name, { role: 'rackd', kind: 'state', data: { state, error: t.error } });
    }
}

function freePort() {
    return new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
    });
}

/** True once something accepts on 127.0.0.1:port (ssh listens for its -L forward after it authenticated). */
async function probe(port, waitMs) {
    const deadline = Date.now() + waitMs;
    for (;;) {
        const ok = await new Promise((resolve) => {
            const s = net.connect(port, '127.0.0.1');
            s.once('connect', () => { s.destroy(); resolve(true); });
            s.once('error', () => resolve(false));
        });
        if (ok) return true;
        if (Date.now() >= deadline) return false;
        await sleep(300);
    }
}

function kickProbe(name, waitMs) {
    const t = rtOf(name).tunnel;
    if (t.ready || !t.port) return t.ready;
    t.ready = probe(t.port, waitMs).then((ok) => {
        t.ready = null;
        if (ok) setTunnelState(name, 'up');
        else if (t.state === 'connecting') setTunnelState(name, 'down', t.error || 'The tunnel did not come up');
        return ok;
    });
    return t.ready;
}

function sshArgs(cfg, local, remotePort) {
    return ['-N', '-o', 'ExitOnForwardFailure=yes', '-o', 'ServerAliveInterval=20', '-o', 'ServerAliveCountMax=3', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
        '-L', `127.0.0.1:${local}:127.0.0.1:${remotePort}`, cfg.ssh];
}

async function tokenOf(cfg) {
    try { return (await fsp.readFile(expand(cfg.tokenFile), 'utf8')).trim(); } catch (_) { return ''; }
}

/** Starts (once) the supervised tunnel and resolves when it answers; throws NOT_DEPLOYED / TUNNEL_DOWN. */
async function ensureTunnel(name, waitMs, gate) {
    const cfg = serverOf(name);
    const t = rtOf(name).tunnel;
    if (gate !== false) await powerGate(name, gate || {});
    if (cfg.rackdUrl) { t.state = 'up'; return t; }
    if (!(await tokenOf(cfg))) { setTunnelState(name, 'not-deployed', 'No token file; run scripts/rack/deploy-rackd.sh ' + cfg.name); throw new RackError('NOT_DEPLOYED', `rackd is not deployed on ${cfg.label || cfg.name} (no token file)`); }
    if (t.state === 'not-deployed') t.state = 'down';
    if (t.state === 'up') return t;
    if (!t.port) t.port = await freePort();
    if (!S.supervised.has(`tun:${name}`)) { setTunnelState(name, 'connecting'); supStart(`tun:${name}`, T.sshCmd || 'ssh', sshArgs(cfg, t.port, cfg.rackdPort || 8791)); }
    else if (t.state === 'down') setTunnelState(name, 'connecting');
    await kickProbe(name, waitMs || 15000);
    if (t.state !== 'up') throw new RackError('TUNNEL_DOWN', `Cannot reach ${cfg.label || cfg.name}: ${t.error || 'the ssh tunnel is down'}`);
    return t;
}

/** An extra local forward to a port on the host (a sandbox's CDP, an emulator's adb); closed after 10 min unused. */
async function forward(name, remotePort) {
    const cfg = serverOf(name);
    const port = Number(remotePort);
    if (!(port > 0 && port < 65536)) throw new RackError('BAD_REQUEST', 'Bad port');
    await ensureTunnel(name);
    const r = rtOf(name);
    let f = r.extras.get(port);
    const touch = () => {
        if (f.timer) clearTimeout(f.timer);
        f.timer = setTimeout(() => { r.extras.delete(port); supStop(`fwd:${name}:${port}`); }, FORWARD_IDLE_MS);
        if (f.timer.unref) f.timer.unref();
    };
    if (!f) {
        f = { port: await freePort(), timer: null };
        r.extras.set(port, f);
        if (cfg.rackdUrl) { f.port = port; } else supStart(`fwd:${name}:${port}`, T.sshCmd || 'ssh', sshArgs(cfg, f.port, port));
        if (!(await probe(f.port, 10000))) { r.extras.delete(port); supStop(`fwd:${name}:${port}`); throw new RackError('TUNNEL_DOWN', `Cannot forward port ${port}`); }
    }
    touch();
    return { port: f.port };
}

// ---------------------------------------------------------------- HTTP helpers

function request(opts, body) {
    return new Promise((resolve, reject) => {
        const req = http.request(opts, (res) => {
            const chunks = [];
            let size = 0;
            res.on('data', (c) => { size += c.length; if (size > MAX_BODY) { req.destroy(new Error('Response too large')); return; } chunks.push(c); });
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
            res.on('error', reject);
        });
        req.setTimeout(opts.timeoutMs || 30000, () => req.destroy(new Error('Timed out')));
        req.on('error', reject);
        req.end(body);
    });
}

const parseJson = (buf) => { try { return JSON.parse(buf.toString('utf8')); } catch (_) { return null; } };

async function rackdTarget(name, waitMs, gate) {
    const cfg = serverOf(name);
    const t = await ensureTunnel(name, waitMs, gate);
    const token = await tokenOf(cfg);
    if (!token) throw new RackError('NOT_DEPLOYED', `rackd is not deployed on ${cfg.label || cfg.name} (no token file)`);
    if (cfg.rackdUrl) { const u = new URL(cfg.rackdUrl); return { host: u.hostname, port: Number(u.port) || 80, token }; }
    return { host: '127.0.0.1', port: t.port, token };
}

/** One rackd call. Resolves the parsed JSON; throws RACKD_ERROR for a 4xx/5xx (message from rackd), TUNNEL_DOWN when unreachable. */
async function rackd(name, method, pathq, body, timeoutMs, gate) {
    const tg = await rackdTarget(name, undefined, gate);
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    let res;
    try {
        res = await request({ host: tg.host, port: tg.port, method, path: pathq, timeoutMs: timeoutMs || 30000,
            headers: Object.assign({ Authorization: `Bearer ${tg.token}`, Accept: 'application/json' }, payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) }, payload);
    } catch (e) {
        setTunnelState(name, rtOf(name).tunnel.state === 'up' && !serverOf(name).rackdUrl ? 'down' : rtOf(name).tunnel.state, e.message);
        throw new RackError('TUNNEL_DOWN', `rackd on ${name} did not answer: ${e.message}`);
    }
    const json = parseJson(res.body);
    if (res.status >= 400) throw new RackError('RACKD_ERROR', (json && json.error) || `rackd answered ${res.status}`, { status: res.status, rackdCode: json && json.code });
    return json === null ? {} : json;
}

async function iloRequest(method, pathq, body, timeoutMs) {
    await ensureIlo();
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    let res;
    try {
        res = await request({ socketPath: iloSockPath(), method, path: pathq, timeoutMs: timeoutMs || 60000, headers: payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {} }, payload);
    } catch (e) { throw new RackError('ILO_DOWN', `The iLO service did not answer: ${e.message}`); }
    const json = parseJson(res.body);
    if (res.status >= 400) throw new RackError('ILO_ERROR', (json && json.error) || `iLO service answered ${res.status}`, { status: res.status });
    return json === null ? {} : json;
}

// ---------------------------------------------------------------- the iLO service

function iloSockPath() { return T.iloSock || path.join(dataDir(), 'ilo.sock'); }

/** Starts the iLO child (once) and waits for its socket. */
async function ensureIlo() {
    if (T.noSpawn) return;
    if (S.iloReady) return S.iloReady;
    S.iloReady = (async () => {
        if (!S.supervised.has('ilo')) {
            const env = Object.assign({ RACK_ILO_SOCK: iloSockPath() }, T.iloEnv || {});
            try { fs.mkdirSync(path.dirname(iloSockPath()), { recursive: true, mode: 0o700 }); } catch (_) { /* exists */ }
            supStart('ilo', process.execPath, [path.join(__dirname, 'ilo', 'server.js')], env);
        }
        const deadline = Date.now() + 15000;
        for (;;) {
            const ok = await new Promise((resolve) => { const s = net.connect({ path: iloSockPath() }); s.once('connect', () => { s.destroy(); resolve(true); }); s.once('error', () => resolve(false)); });
            if (ok) return;
            if (Date.now() >= deadline) { S.iloReady = null; throw new RackError('ILO_DOWN', 'The iLO service did not start'); }
            await sleep(300);
        }
    })();
    S.iloReady.catch(() => { S.iloReady = null; });
    return S.iloReady;
}

// ---------------------------------------------------------------- audit and rules

const SECRET_KEY = /pass|token|secret|authorization|cookie|credential|apikey|api_key/i;

function scrub(v, depth) {
    if (v === null || typeof v !== 'object') return typeof v === 'string' && v.length > 500 ? `${v.slice(0, 500)}...` : v;
    if (depth > 4) return '...';
    if (Array.isArray(v)) return v.slice(0, 50).map((x) => scrub(x, depth + 1));
    const out = {};
    Object.keys(v).slice(0, 50).forEach((k) => { if (!SECRET_KEY.test(k)) out[k] = scrub(v[k], depth + 1); });
    return out;
}

async function audit(entry) {
    try {
        const file = path.join(dataDir(), 'audit.jsonl');
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.appendFile(file, JSON.stringify(Object.assign({ t: new Date().toISOString() }, entry, { params: scrub(entry.params || {}, 0) })) + '\n');
    } catch (e) { console.warn(`[rackManager] audit: ${e.message}`); }
}

/** Host power, VM destroy / delete, LV delete, Android AVD delete, a RAM disk delete without a sync, container remove / prune and build pipeline-delete / artifact-remove need confirm:true from Fleet. */
function needsConfirm(role, action, params) {
    const p = params || {};
    if (role === 'ilo' && action === 'power') return true;
    if (role === 'power' && action === 'off') return true;
    if (role === 'ilo' && action === 'users' && p.action === 'delete') return true;
    if (role === 'vms' && (action === 'destroy' || action === 'delete')) return true;
    if (role === 'storage' && (action === 'lv-delete' || (action === 'ramdisk-delete' && p.sync === false))) return true;
    if (role === 'android' && action === 'delete') return true;
    if (role === 'containers' && ['remove', 'prune', 'image-remove', 'volume-remove'].includes(action)) return true;
    if (role === 'builds' && (action === 'pipeline-delete' || action === 'artifact-remove')) return true;
    if (role === 'replicas' && action === 'delete') return true;
    return false;
}

function checkConfirm(ctx, role, action, params) {
    if (ctx && ctx.via === 'fleet' && needsConfirm(role, action, params) && !(params && params.confirm === true)) {
        throw new RackError('CONFIRM_REQUIRED', `${role} ${action} is destructive: pass confirm: true in params`);
    }
}

async function audited(ctx, server, role, action, params, fn) {
    const base = { who: (ctx && ctx.who) || 'unknown', via: (ctx && ctx.via) || 'server', server, role, action, params };
    try {
        const out = await fn();
        await audit(Object.assign(base, { ok: true }));
        return out;
    } catch (e) {
        await audit(Object.assign(base, { ok: false, error: String(e.message || e).slice(0, 300) }));
        throw e;
    }
}

// ---------------------------------------------------------------- roles

const roleOk = (role) => ROLES.includes(role);

async function get(server, role, query, gate) {
    serverOf(server);
    if (role === 'info') return { role, data: await rackd(server, 'GET', '/v1/info', undefined, undefined, gate) };
    if (role === 'jobs') return { role, data: await rackd(server, 'GET', '/v1/jobs', undefined, undefined, gate) };
    if (role === 'metrics') { // GET only: the host's load history (range, points)
        const q = new URLSearchParams();
        ['range', 'points'].forEach((k) => { if (query && query[k] !== undefined) q.set(k, String(query[k]).slice(0, 20)); });
        return { role, data: await rackd(server, 'GET', `/v1/metrics/history${q.toString() ? `?${q}` : ''}`, undefined, 15000, gate) };
    }
    if (!roleOk(role)) throw new RackError('BAD_REQUEST', `Unknown role ${String(role).slice(0, 40)}`);
    const qs = query && typeof query === 'object' && Object.keys(query).length
        ? '?' + new URLSearchParams(Object.keys(query).filter((k) => /^[A-Za-z_]{1,20}$/.test(k)).map((k) => [k, String(query[k])])).toString() : '';
    return { role, data: await rackd(server, 'GET', `/v1/${role}${qs}`, undefined, undefined, gate) };
}

async function action(server, role, act, params, ctx) {
    serverOf(server);
    if (!roleOk(role)) throw new RackError('BAD_REQUEST', `Unknown role ${String(role).slice(0, 40)}`);
    if (!NAME_RE.test(String(act))) throw new RackError('BAD_REQUEST', 'Bad action');
    const p = params && typeof params === 'object' ? params : {};
    checkConfirm(ctx, role, act, p);
    const timeout = role === 'terminal' && act === 'exec' ? ((Number(p.timeoutS) || 60) + 15) * 1000 : 60000;
    return audited(ctx, server, role, act, p, async () => {
        const gate = { wake: !!(ctx && ctx.wake), who: ctx && ctx.who };
        const out = act === 'install' ? await rackd(server, 'POST', `/v1/roles/${role}/install`, p, timeout, gate) : await rackd(server, 'POST', `/v1/${role}/${act}`, p, timeout, gate);
        if (role === 'replicas' && act === 'seed-take' && out && out.needsDreamscape) return { result: await seedTake(server, p) };
        return out && out.job ? { job: out.job } : { result: out };
    });
}

/** replicas seed-take: rackd cannot reach Dreamscape, so the snapshot runs here (scripts/rack/seed-replica.sh, read-only on the live tree). */
async function seedTake(server, p) {
    const cfg = serverOf(server);
    const id = `seed-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}`;
    const args = [path.join(__dirname, '..', '..', 'scripts', 'rack', 'seed-replica.sh'), '--id', id, '--host', cfg.ssh];
    if (p.images != null && Number.isFinite(Number(p.images))) args.push('--images', String(Math.max(0, Math.min(500, Math.floor(Number(p.images))))));
    if (p.keys === true) args.push('--keys');
    const r = await require('../spawnHelper').run('bash', args, { timeout: 30 * 60 * 1000, maxBuffer: 4e6 });
    if (r.code !== 0) throw new RackError('RACKD_ERROR', `The seed failed: ${(r.stderr || r.stdout).trim().split('\n').slice(-3).join(' ').slice(0, 400)}`);
    const last = r.stdout.trim().split('\n').pop();
    try { return JSON.parse(last); } catch (_) { return { id }; }
}

async function job(server, id, opts, ctx) {
    serverOf(server);
    const o = opts || {};
    const gate = { wake: !!(ctx && ctx.wake), who: ctx && ctx.who };
    if (id === undefined || id === null || id === '') return { jobs: (await rackd(server, 'GET', '/v1/jobs', undefined, undefined, gate)) };
    if (!FILE_RE.test(String(id))) throw new RackError('BAD_REQUEST', 'Bad job id');
    if (o.cancel) return audited(ctx, server, 'jobs', 'cancel', { id }, async () => ({ job: await rackd(server, 'POST', `/v1/jobs/${id}/cancel`, {}, undefined, gate) }));
    return { job: await rackd(server, 'GET', `/v1/jobs/${id}?tail=${Math.min(2000, Math.max(1, Number(o.tail) || 200))}`, undefined, undefined, gate) };
}

// ---------------------------------------------------------------- iLO

async function iloGet(server, what, params) {
    const cfg = serverOf(server);
    if (what === 'servers') {
        const all = await iloRequest('GET', '/api/servers', undefined, 8000);
        const e = (Array.isArray(all) ? all : []).find((x) => x.name === cfg.ilo);
        if (!e) throw new RackError('ILO_ERROR', `The iLO service does not know ${cfg.ilo}`);
        return { data: e };
    }
    if (what === 'isos') return { data: await iloRequest('GET', '/api/isos', undefined, 8000) };
    const seg = ILO_WHAT[what];
    if (!seg) throw new RackError('BAD_REQUEST', `Unknown iLO view ${String(what).slice(0, 40)}`);
    const q = new URLSearchParams();
    Object.keys(params || {}).filter((k) => ILO_QUERY.has(k)).forEach((k) => q.set(k, String(params[k])));
    const qs = q.toString();
    return { data: await iloRequest('GET', `/api/${cfg.ilo}/${seg}${qs ? `?${qs}` : ''}`) };
}

async function iloAction(server, act, params, ctx) {
    const cfg = serverOf(server);
    const p = params && typeof params === 'object' ? params : {};
    checkConfirm(ctx, 'ilo', act, p);
    let call;
    if (act === 'power') {
        const op = POWER_OPS[String(p.op)];
        if (op === undefined) throw new RackError('BAD_REQUEST', 'op must be press, hold, reset or cold');
        call = () => iloRequest('POST', `/api/${cfg.ilo}/powerop`, { op });
    } else if (act === 'powercap') {
        const watts = Number(p.watts);
        if (!(watts >= 0 && watts < 5000)) throw new RackError('BAD_REQUEST', 'watts must be 0 (off) or a power cap');
        call = () => iloRequest('POST', `/api/${cfg.ilo}/powercap`, { watts });
    } else if (act === 'powersaver') {
        const mode = Number(p.mode);
        if (![1, 2, 3, 4].includes(mode)) throw new RackError('BAD_REQUEST', 'mode must be 1-4');
        call = () => iloRequest('POST', `/api/${cfg.ilo}/powersaver`, { mode });
    } else if (act === 'media') {
        const body = {};
        ['device', 'action', 'iso', 'url', 'bootOnce'].forEach((k) => { if (p[k] !== undefined) body[k] = p[k]; });
        call = () => iloRequest('POST', `/api/${cfg.ilo}/vm`, body);
    } else if (act === 'users') {
        const ua = String(p.action || '');
        const login = String(p.login || '').trim();
        if (!['add', 'modify', 'delete'].includes(ua)) throw new RackError('BAD_REQUEST', 'action must be add, modify or delete');
        if (!/^[\w.@-]{1,39}$/.test(login)) throw new RackError('BAD_REQUEST', 'login: 1-39 letters, digits or . _ @ -');
        if (login === 'dream_admin') throw new RackError('BAD_REQUEST', 'dream_admin is what Rack Manager logs in with; it cannot be changed here');
        const body = { action: ua, login };
        if (p.name !== undefined) body.name = String(p.name).slice(0, 60);
        if (p.password !== undefined) body.password = String(p.password);
        if (Array.isArray(p.privs)) body.privs = p.privs.map(String).slice(0, 20);
        call = () => iloRequest('POST', `/api/${cfg.ilo}/ilo/users`, body);
    } else throw new RackError('BAD_REQUEST', 'action must be power, powercap, powersaver, media or users');
    return audited(ctx, server, 'ilo', act, p, async () => ({ result: await call() }));
}

// ---------------------------------------------------------------- listing and status

async function iloBrief(cfg, all) {
    const e = (all || []).find((x) => x.name === cfg.ilo);
    return e ? { connected: !!e.connected, power: e.power === undefined ? null : e.power } : { connected: false, power: null };
}

async function rackdBrief(cfg) {
    const name = cfg.name;
    const r = rtOf(name);
    if (!cfg.rackdUrl && !(await tokenOf(cfg))) { setTunnelState(name, 'not-deployed', 'No token file'); return { state: 'not-deployed' }; }
    const ps = r.power.state;
    if (ps === 'off' || ps === 'powering-on' || ps === 'shutting-down') return { state: 'down', error: `host is ${ps}` };
    if (ps === 'booting') return { state: 'connecting' };
    try { await ensureTunnel(name, 1500, false); } catch (e) {
        if (e.code === 'NOT_DEPLOYED') return { state: 'not-deployed' };
        return { state: r.tunnel.state === 'connecting' ? 'connecting' : 'down', error: e.message };
    }
    if (!r.info || Date.now() - r.info.t > INFO_TTL_MS) {
        try { r.info = { t: Date.now(), data: await rackd(name, 'GET', '/v1/info', undefined, 4000, false) }; } catch (e) { return { state: 'down', error: e.message }; }
    }
    return { state: 'up', info: r.info.data };
}

async function list() {
    const servers = loadServers();
    let all = [];
    try { all = await iloRequest('GET', '/api/servers', undefined, 5000); } catch (_) { all = []; }
    return Promise.all(servers.map(async (cfg) => ({ name: cfg.name, label: cfg.label, model: cfg.model, ilo: await iloBrief(cfg, all), power: powerBrief(cfg.name), rackd: await rackdBrief(cfg) })));
}

/** Fleet's rack_status: servers, iLO power, rackd state, role summaries and running jobs. */
async function status(server) {
    const rows = (await list()).filter((s) => !server || s.name === server);
    if (server && !rows.length) throw new RackError('UNKNOWN_SERVER', `Unknown server ${String(server).slice(0, 40)}`);
    return Promise.all(rows.map(async (s) => {
        const out = { name: s.name, label: s.label, model: s.model, ilo: s.ilo, power: s.power, rackd: { state: s.rackd.state, error: s.rackd.error }, roles: null, jobs: [] };
        out.builds = [];
        if (s.rackd.state === 'up') {
            const roles = (s.rackd.info && s.rackd.info.roles) || {};
            out.roles = Object.keys(roles).reduce((acc, k) => { acc[k] = { installed: roles[k].installed, ready: roles[k].ready, summary: roles[k].summary }; return acc; }, {});
            try { const j = await rackd(s.name, 'GET', '/v1/jobs', undefined, 4000, false); out.jobs = (Array.isArray(j) ? j : j.jobs || []).filter((x) => x.state === 'running').map((x) => ({ id: x.id, role: x.role, title: x.title })); } catch (_) { /* jobs are best effort */ }
            try { const b = await rackd(s.name, 'GET', '/v1/builds', undefined, 4000, false); out.builds = ((b && b.runs) || []).filter((x) => x.state === 'running').map((x) => ({ id: x.id, pipeline: x.pipeline, ref: x.ref, startedAt: x.startedAt, by: x.by })); } catch (_) { /* builds role may be absent */ }
        }
        return out;
    }));
}

// ---------------------------------------------------------------- event fan-out (SSE, only while subscribed)

function dispatch(name, ev) {
    const r = S.rt.get(name);
    if (!r || !r.subs.size) return;
    const msg = { server: name, role: ev.role, kind: ev.kind, id: ev.id, data: ev.data };
    r.subs.forEach((fn) => { try { fn(msg); } catch (_) { /* a dead socket drops itself */ } });
}

function sseClose(r) {
    if (r.sseTimer) { clearTimeout(r.sseTimer); r.sseTimer = null; }
    if (r.sse) { const s = r.sse; r.sse = null; try { s.destroy(); } catch (_) { /* gone */ } }
}

function sseParse(name, state, chunk) {
    state.buf += chunk;
    let i;
    while ((i = state.buf.indexOf('\n\n')) >= 0) {
        const block = state.buf.slice(0, i);
        state.buf = state.buf.slice(i + 2);
        let data = '';
        block.split('\n').forEach((l) => { if (l.startsWith('data:')) data += l.slice(5).trimStart(); });
        if (!data) continue;
        try { const ev = JSON.parse(data); onRackdEvent(name, ev); dispatch(name, ev); } catch (_) { /* a junk frame */ }
    }
}

async function sseOpen(name) {
    const r = rtOf(name);
    if (r.sse || !r.subs.size) return;
    if (['off', 'powering-on', 'booting', 'shutting-down'].includes(r.power.state)) return; // no attempts against a host that is not up
    const mark = {};
    r.sse = mark;
    try {
        const tg = await rackdTarget(name, 8000, false);
        if (r.sse !== mark || !r.subs.size) { if (r.sse === mark) r.sse = null; return; }
        const req = http.request({ host: tg.host, port: tg.port, method: 'GET', path: '/v1/events', headers: { Authorization: `Bearer ${tg.token}`, Accept: 'text/event-stream' } }, (res) => {
            if (res.statusCode !== 200) { res.resume(); res.destroy(); return; }
            r.sseBackoff = SSE_RETRY_MIN;
            const st = { buf: '' };
            res.setEncoding('utf8');
            res.on('data', (c) => sseParse(name, st, c));
            res.on('error', () => {});
        });
        mark.destroy = () => req.destroy();
        req.on('close', () => { if (r.sse === mark) { r.sse = null; sseRetry(name); } });
        req.on('error', () => {});
        req.end();
    } catch (_) {
        if (r.sse === mark) { r.sse = null; sseRetry(name); }
    }
}

function sseRetry(name) {
    const r = rtOf(name);
    if (!r.subs.size || r.sseTimer || ['off', 'powering-on', 'booting', 'shutting-down'].includes(r.power.state)) return;
    const wait = r.sseBackoff;
    r.sseBackoff = Math.min(SSE_RETRY_MAX, r.sseBackoff * 2);
    r.sseTimer = setTimeout(() => { r.sseTimer = null; sseOpen(name); }, wait);
    if (r.sseTimer.unref) r.sseTimer.unref();
}

/** fn(event) gets {server, role, kind, id, data} while subscribed. The first subscriber opens the SSE stream, the last closes it. */
function subscribe(server, key, fn, opts) {
    serverOf(server);
    const r = rtOf(server);
    r.subs.set(key, fn);
    if (opts && opts.lease) leaseTake(server, { purpose: 'console', key, who: 'console' }).catch(() => {});
    if (r.subs.size === 1) { r.sseBackoff = SSE_RETRY_MIN; sseOpen(server); }
    return { subscribed: true };
}

function unsubscribe(server, key) {
    const r = S.rt.get(server);
    if (!r || !r.subs.delete(key)) return false;
    leaseReleaseKey(server, key);
    if (!r.subs.size) sseClose(r);
    return true;
}

function unsubscribeAll(key) { S.rt.forEach((r, name) => unsubscribe(name, key)); }

const subscriberCount = (server) => (S.rt.get(server) ? S.rt.get(server).subs.size : 0);
const streamOpen = (server) => !!(S.rt.get(server) && (S.rt.get(server).sse || S.rt.get(server).sseTimer));

// ---------------------------------------------------------------- power on demand (docs/rack-manager/README.md)

const POWER_DEFAULTS = { auto: true, idleShutdownMin: 180, wakeOnDemand: true };
const BOOT_FALLBACK_MS = 120000;   // no POST codes (iLO 2): treat the OS as booting after this long
const WAKE_MAX_MS = 10 * 60 * 1000;
const MAX_TIMER_MS = 2147000000;
const IDLE_KEY = '__power_idle__';
const NOT_UP = ['off', 'powering-on', 'booting', 'shutting-down'];

const powerOf = (cfg) => Object.assign({}, POWER_DEFAULTS, cfg.power || {});

function powerBrief(name) {
    const p = rtOf(name).power;
    const out = { state: p.state, since: p.since };
    if (p.post) out.post = p.post;
    return out;
}

function powerResult(name) {
    const r = rtOf(name);
    const out = powerBrief(name);
    if (r.timings.upAt && r.timings.powerOnAt) { out.bootSeconds = Math.round((r.timings.upAt - r.timings.powerOnAt) / 1000); if (r.timings.bootingAt) out.postSeconds = Math.round((r.timings.bootingAt - r.timings.powerOnAt) / 1000); }
    return out;
}

function waitFor(name, target, ms) {
    const r = rtOf(name);
    if (r.power.state === target) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const w = { target, resolve, reject, timer: null };
        w.timer = setTimeout(() => { r.waiters = r.waiters.filter((x) => x !== w); reject(new RackError('POWER_TIMEOUT', `${name} did not reach ${target} in time`, { power: r.power.state })); }, ms);
        r.waiters.push(w);
    });
}

function stopTunnel(name) {
    const r = rtOf(name);
    supStop(`tun:${name}`);
    r.extras.forEach((f, port) => { if (f.timer) clearTimeout(f.timer); supStop(`fwd:${name}:${port}`); });
    r.extras.clear();
    r.tunnel.ready = null;
    if (r.tunnel.state !== 'not-deployed') setTunnelState(name, 'down', 'host is off');
}

function onPowerEnter(name, state, prev) {
    const r = rtOf(name);
    if (r.bootTimer) { clearTimeout(r.bootTimer); r.bootTimer = null; }
    if (prev === 'up' && state !== 'up') { r.subs.delete(IDLE_KEY); if (r.idleTimer) { clearTimeout(r.idleTimer); r.idleTimer = null; } r.idleAt = null; }
    if (state === 'powering-on') {
        r.bootTimer = setTimeout(() => { r.bootTimer = null; if (r.power.state === 'powering-on') setPower(name, 'booting'); }, BOOT_FALLBACK_MS);
        if (r.bootTimer.unref) r.bootTimer.unref();
    } else if (state === 'booting') {
        r.timings.bootingAt = Date.now();
        bootProbe(name);
    } else if (state === 'up') {
        r.timings.upAt = Date.now();
        if (powerOf(serverOf(name)).auto && !r.subs.has(IDLE_KEY)) r.subs.set(IDLE_KEY, () => {});
        idleFetch(name);
        if (r.subs.size) sseOpen(name);
    } else if (state === 'off') {
        sseClose(r);
        stopTunnel(name);
        r.info = null; r.idle = null;
        if (r.idleTimer) { clearTimeout(r.idleTimer); r.idleTimer = null; }
        r.idleAt = null;
    } else if (state === 'shutting-down') {
        sseClose(r);
    }
}

function setPower(name, state, extra) {
    const r = rtOf(name);
    const p = r.power;
    const prev = p.state;
    const changed = prev !== state;
    let pushed = changed;
    if (extra && extra.hostOn !== undefined) p.hostOn = extra.hostOn;
    if (changed) { p.state = state; p.since = Date.now(); p.post = null; }
    if (state === 'powering-on' && extra && extra.post) {
        const a = extra.post;
        if (!p.post || p.post.pct !== a.pct || p.post.stage !== a.stage || p.post.code !== a.code) { p.post = { stage: a.stage || null, pct: a.pct === undefined ? null : a.pct, eta: a.eta === undefined ? null : a.eta, code: a.code || null }; pushed = true; }
    }
    if (!pushed) return;
    if (changed) {
        onPowerEnter(name, state, prev);
        r.waiters = r.waiters.filter((w) => {
            if (w.target === state) { clearTimeout(w.timer); w.resolve(); return false; }
            if (state === 'off' && w.target !== 'off') { clearTimeout(w.timer); w.reject(new RackError('HOST_OFF', `${name} is off`, { power: 'off' })); return false; }
            return true;
        });
    }
    dispatch(name, { role: 'power', kind: 'state', data: powerBrief(name) });
    events.emit('power', { server: name, power: powerBrief(name) });
}

/** After the OS starts booting: bring the tunnel up and call it up once rackd answers. */
async function bootProbe(name) {
    const r = rtOf(name);
    try { await ensureTunnel(name, WAKE_MAX_MS, false); } catch (e) {
        if (e.code === 'NOT_DEPLOYED' && r.power.state === 'booting') setPower(name, 'up');
        return;
    }
    for (let i = 0; i < 6 && r.power.state === 'booting'; i += 1) {
        try { r.info = { t: Date.now(), data: await rackd(name, 'GET', '/v1/info', undefined, 4000, false) }; setPower(name, 'up'); return; } catch (_) { await sleep(3000); }
    }
}

function onIloEvent(ev) {
    if (!ev || !ev.server) return;
    const cfg = loadServers().find((s) => s.ilo === ev.server);
    if (!cfg) return;
    const name = cfg.name;
    const p = rtOf(name).power;
    if (ev.on === true || ev.on === false) dispatch(name, { role: 'ilo', kind: 'power', data: { on: ev.on, t: ev.t } });
    if (ev.health) dispatch(name, { role: 'ilo', kind: 'health', data: ev.health });
    if (ev.on === false) { p.hostOn = false; if (p.state !== 'off') setPower(name, 'off', { hostOn: false }); return; }
    if (ev.on === true) {
        p.hostOn = true;
        if (p.state === 'unknown') setPower(name, 'booting');
        else if (p.state === 'off') setPower(name, 'powering-on');
        return;
    }
    if (ev.post) {
        if (p.state === 'off') setPower(name, 'powering-on');
        if (rtOf(name).power.state !== 'powering-on') return;
        if (ev.post.done) setPower(name, 'booting');
        else setPower(name, 'powering-on', { post: { stage: ev.post.stage, pct: ev.post.pct, eta: ev.post.eta, code: ev.post.code } });
    }
}

function parseSseStream(state, chunk, onData) {
    state.buf += chunk;
    let i;
    while ((i = state.buf.indexOf('\n\n')) >= 0) {
        const block = state.buf.slice(0, i);
        state.buf = state.buf.slice(i + 2);
        let data = '';
        block.split('\n').forEach((l) => { if (l.startsWith('data:')) data += l.slice(5).trimStart(); });
        if (data) { try { onData(JSON.parse(data)); } catch (_) { /* junk */ } }
    }
}

/** One push connection to the iLO service: the hosts' power state and POST progress arrive as events. */
function startIloFeed() {
    if (S.iloFeed || S.iloFeedOff || process.env.RACK_MANAGER_DISABLED === '1') return;
    const req = http.request({ socketPath: iloSockPath(), method: 'GET', path: '/api/power-events', headers: { Accept: 'text/event-stream' } }, (res) => {
        if (res.statusCode !== 200) { res.resume(); S.iloFeedOff = true; return; }
        S.iloFeedBackoff = 2000;
        const st = { buf: '' };
        res.setEncoding('utf8');
        res.on('data', (c) => parseSseStream(st, c, (ev) => module.exports._onIloEvent(ev)));
        res.on('error', () => {});
    });
    S.iloFeed = req;
    req.on('error', () => {});
    req.on('close', () => {
        if (S.iloFeed !== req) return;
        S.iloFeed = null;
        if (S.iloFeedOff || S.iloFeedTimer) return;
        const wait = S.iloFeedBackoff;
        S.iloFeedBackoff = Math.min(30000, S.iloFeedBackoff * 2);
        S.iloFeedTimer = setTimeout(() => { S.iloFeedTimer = null; startIloFeed(); }, wait);
        if (S.iloFeedTimer.unref) S.iloFeedTimer.unref();
    });
    req.end();
}

function stopIloFeed() {
    if (S.iloFeedTimer) { clearTimeout(S.iloFeedTimer); S.iloFeedTimer = null; }
    if (S.iloFeed) { const f = S.iloFeed; S.iloFeed = null; try { f.destroy(); } catch (_) { /* gone */ } }
}

async function refreshPowerFromIlo(name) {
    const cfg = serverOf(name);
    let all = [];
    try { all = await iloRequest('GET', '/api/servers', undefined, 5000); } catch (_) { all = []; }
    const e = all.find((x) => x.name === cfg.ilo);
    if (e && e.power === true) setPower(name, 'booting', { hostOn: true });
    else if (e && e.power === false) setPower(name, 'off', { hostOn: false });
}

/** Role calls on a host that is not up: refuse at once, or (wake) power it on and wait. */
async function powerGate(name, o) {
    const st = rtOf(name).power.state;
    if (st === 'unknown' || st === 'up') return;
    const cfg = serverOf(name);
    const refuse = (code, msg) => { throw new RackError(code, msg, { power: st }); };
    if (st === 'shutting-down') refuse('HOST_SHUTTING_DOWN', `${cfg.label || name} is shutting down`);
    if (!o.wake) refuse(st === 'off' ? 'HOST_OFF' : 'HOST_BOOTING', st === 'off' ? `${cfg.label || name} is off (pass wake: true to power it on)` : `${cfg.label || name} is starting (${st})`);
    if (st === 'off') {
        if (!powerOf(cfg).wakeOnDemand) refuse('HOST_OFF', `${cfg.label || name} is off and wake on demand is switched off`);
        await powerOn(name, { via: 'wake', who: o.who || 'wake', reason: 'wake: a role call needs the host', wait: true });
        return;
    }
    await waitFor(name, 'up', WAKE_MAX_MS);
}

async function powerOn(name, o) {
    const cfg = serverOf(name);
    const r = rtOf(name);
    const ctx = { via: o.via || 'ws', who: o.who || 'unknown' };
    if (r.power.state === 'unknown') await refreshPowerFromIlo(name);
    if (r.power.state === 'unknown') throw new RackError('POWER_UNKNOWN', 'The iLO has not reported the power state yet', { power: 'unknown' });
    const st = r.power.state;
    if (st === 'shutting-down') throw new RackError('HOST_SHUTTING_DOWN', `${cfg.label || name} is shutting down`, { power: st });
    if (st !== 'off') {
        if (o.wait && st !== 'up') await waitFor(name, 'up', WAKE_MAX_MS);
        return powerResult(name);
    }
    await audited(ctx, name, 'power', 'on', { reason: o.reason }, async () => {
        await iloRequest('POST', `/api/${cfg.ilo}/powerop`, { op: 0, watch: true });
        r.timings = { powerOnAt: Date.now() };
        setPower(name, 'powering-on');
    });
    if (o.wait) await waitFor(name, 'up', WAKE_MAX_MS);
    return powerResult(name);
}

/** rackd's graceful host shutdown; the iLO's momentary press (ACPI) only when rackd is unreachable. Never hold or cold boot. */
async function shutdownHost(name, reason, params) {
    const cfg = serverOf(name);
    const r = rtOf(name);
    const before = r.power.state;
    setPower(name, 'shutting-down');
    const tunnelUp = cfg.rackdUrl || r.tunnel.state === 'up';
    try {
        if (!tunnelUp) throw new RackError('TUNNEL_DOWN', 'rackd is unreachable');
        await rackd(name, 'POST', '/v1/host/shutdown', { reason: String(reason || 'Rack Manager').slice(0, 200) }, 30000, false);
        params.how = 'rackd';
    } catch (e) {
        if (e.code === 'RACKD_ERROR') { setPower(name, before); throw e; }
        if (tunnelUp && /hang up|ECONNRESET|socket/i.test(String(e.message))) { params.how = 'rackd'; return; }
        try { await iloRequest('POST', `/api/${cfg.ilo}/powerop`, { op: 0 }); params.how = 'ilo-press'; } catch (e2) { setPower(name, before); throw e2; }
    }
}

async function powerOff(name, o) {
    const r = rtOf(name);
    const ctx = { via: o.via || 'ws', who: o.who || 'unknown' };
    checkConfirm(ctx, 'power', 'off', { confirm: o.confirm });
    if (r.power.state === 'unknown') await refreshPowerFromIlo(name);
    const st = r.power.state;
    if (st === 'off' || st === 'shutting-down') return powerResult(name);
    if (st === 'powering-on') throw new RackError('HOST_BOOTING', `${name} is powering on`, { power: st });
    if (st === 'unknown') throw new RackError('POWER_UNKNOWN', 'The iLO has not reported the power state yet', { power: st });
    const open = openLeases(name).map(leaseBrief);
    const busy = (r.idle && r.idle.busy) || [];
    if ((open.length || busy.length) && !o.force) throw new RackError('LEASES_OPEN', `${name} has ${open.length} lease(s) and ${busy.length} busy item(s); pass force: true to shut it down anyway`, { power: st, leases: open, busy });
    const params = { reason: o.reason, force: !!o.force };
    await audited(ctx, name, 'power', 'off', params, () => shutdownHost(name, o.reason, params));
    return powerBrief(name);
}

// ---- leases (persisted: .cache/rack-manager/leases.json; a page's console lease is tied to its socket and never persisted)

function loadLeases() {
    if (S.leasesLoaded) return;
    S.leasesLoaded = true;
    try { JSON.parse(fs.readFileSync(path.join(dataDir(), 'leases.json'), 'utf8')).forEach((l) => { if (l && l.id && l.expiresAt > Date.now()) S.leases.set(l.id, l); }); } catch (_) { /* none yet */ }
}

async function saveLeases() {
    try {
        const file = path.join(dataDir(), 'leases.json');
        await fsp.mkdir(path.dirname(file), { recursive: true });
        await fsp.writeFile(`${file}.tmp`, JSON.stringify([...S.leases.values()].filter((l) => !l.key && l.expiresAt > Date.now())));
        await fsp.rename(`${file}.tmp`, file);
    } catch (e) { console.warn(`[rackManager] leases: ${e.message}`); }
}

const leaseBrief = (l) => ({ id: l.id, purpose: l.purpose, who: l.who, since: l.takenAt, ends: l.key ? null : l.expiresAt });

function openLeases(name) {
    loadLeases();
    const now = Date.now();
    const out = [];
    [...S.leases.values()].forEach((l) => {
        if (!l.key && l.expiresAt <= now) { S.leases.delete(l.id); const r = rtOf(l.server); r.lastLeaseEnd = Math.max(r.lastLeaseEnd, l.expiresAt); return; }
        if (l.server === name) out.push(l);
    });
    return out;
}

async function leaseTake(server, o) {
    const cfg = serverOf(server);
    loadLeases();
    const purpose = String(o.purpose || '').trim().slice(0, 80);
    if (!purpose) throw new RackError('BAD_REQUEST', 'A lease needs a purpose');
    const ctx = { via: o.via || 'ws', who: o.who || 'unknown' };
    const minutes = Math.min(1440, Math.max(1, Math.floor(Number(o.minutes)) || 60));
    let lease = o.id ? S.leases.get(String(o.id)) : null;
    if (o.id && (!lease || lease.server !== server)) throw new RackError('BAD_REQUEST', 'No such lease');
    if (!lease) { lease = { id: `l_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, server, purpose, who: ctx.who, takenAt: Date.now(), expiresAt: 0, key: o.key || null }; S.leases.set(lease.id, lease); }
    lease.expiresAt = lease.key ? Infinity : Date.now() + minutes * 60000;
    if (!lease.key) { await saveLeases(); await audit({ who: ctx.who, via: ctx.via, server, role: 'lease', action: o.id ? 'renew' : 'take', params: { id: lease.id, purpose, minutes }, ok: true }); }
    const r = rtOf(server);
    if (!lease.key && r.power.state === 'off' && powerOf(cfg).wakeOnDemand) {
        await powerOn(server, { via: ctx.via, who: ctx.who, reason: `lease: ${purpose}`, wait: o.wait === true });
    }
    recompute(server);
    return { lease: leaseBrief(lease), power: powerBrief(server) };
}

async function leaseRelease(id, o) {
    loadLeases();
    const lease = S.leases.get(String(id));
    if (!lease) throw new RackError('BAD_REQUEST', 'No such lease');
    S.leases.delete(lease.id);
    rtOf(lease.server).lastLeaseEnd = Date.now();
    await saveLeases();
    await audit({ who: (o && o.who) || 'unknown', via: (o && o.via) || 'ws', server: lease.server, role: 'lease', action: 'release', params: { id: lease.id, purpose: lease.purpose }, ok: true });
    recompute(lease.server);
    return { released: true };
}

function leaseReleaseKey(server, key) {
    let hit = false;
    [...S.leases.values()].forEach((l) => { if (l.server === server && l.key === key) { S.leases.delete(l.id); hit = true; } });
    if (hit) { rtOf(server).lastLeaseEnd = Date.now(); recompute(server); }
}

// ---- idle shutdown: ONE deadline timer per server, recomputed when rackd's idle state or a lease changes

function sinceMs(v) { if (typeof v === 'number') return v; const t = Date.parse(v); return Number.isFinite(t) ? t : Date.now(); }

/** The time the host may be shut down, or null (not idle, a lease is held, auto is off or the host is not up). */
function idleDeadline(name) {
    const r = rtOf(name);
    const st = powerOf(serverOf(name));
    if (!st.auto || r.power.state !== 'up' || !r.idle || r.idle.idle !== true) return null;
    const open = openLeases(name);
    if (open.some((l) => l.key)) return null;
    const from = Math.max(sinceMs(r.idle.idleSince), r.lastLeaseEnd || 0, ...open.map((l) => l.expiresAt));
    return from + st.idleShutdownMin * 60000;
}

function recompute(name) {
    const r = rtOf(name);
    if (r.idleTimer) { clearTimeout(r.idleTimer); r.idleTimer = null; }
    r.idleAt = idleDeadline(name);
    if (r.idleAt === null) return;
    r.idleTimer = setTimeout(() => { r.idleTimer = null; idleFire(name); }, Math.min(MAX_TIMER_MS, Math.max(0, r.idleAt - Date.now())));
    if (r.idleTimer.unref) r.idleTimer.unref();
}

async function idleFire(name) {
    await idleFetch(name, true);
    const due = idleDeadline(name);
    if (due !== null && due <= Date.now() + 1000) {
        const mins = powerOf(serverOf(name)).idleShutdownMin;
        try { await powerOff(name, { via: 'auto', who: 'rackManager', reason: `idle for ${mins} min with no lease` }); } catch (e) { console.warn(`[rackManager] idle shutdown of ${name}: ${e.message}`); }
    } else recompute(name);
}

async function idleFetch(name, quiet) {
    const r = rtOf(name);
    try {
        const j = await rackd(name, 'GET', '/v1/idle', undefined, 5000, false);
        r.idle = { idle: !!j.idle, idleSince: j.idleSince, busy: Array.isArray(j.busy) ? j.busy : [] };
    } catch (_) { if (!quiet) r.idle = null; }
    if (!quiet) recompute(name);
}

function onRackdEvent(name, ev) {
    if (!ev || ev.kind !== 'idle') return;
    const d = ev.data;
    if (d && d.idle !== undefined) { rtOf(name).idle = { idle: !!d.idle, idleSince: d.idleSince, busy: Array.isArray(d.busy) ? d.busy : [] }; recompute(name); } else idleFetch(name);
}

/** The shape the console reads: {state, since, post?, leases:[{id,purpose,who,since,ends}], idle:{idle,idleSince,busy:[]}, deadline, settings}. */
function powerStatus(name) {
    const cfg = serverOf(name);
    const r = rtOf(name);
    return Object.assign(powerResult(name), {
        leases: openLeases(name).map(leaseBrief),
        idle: r.idle ? { idle: r.idle.idle, idleSince: r.idle.idleSince === undefined ? null : r.idle.idleSince, busy: r.idle.busy } : { idle: false, idleSince: null, busy: [] },
        deadline: r.idleAt,
        settings: powerOf(cfg)
    });
}

async function powerAction(name, action, o) {
    serverOf(name);
    if (action === 'status') return powerStatus(name);
    if (action === 'on') { await powerOn(name, o); return powerStatus(name); }
    if (action === 'off') { await powerOff(name, o); return powerStatus(name); }
    throw new RackError('BAD_REQUEST', 'action must be on, off or status');
}

async function setPowerSettings(name, settings, ctx) {
    const cfg = serverOf(name);
    const s = settings && typeof settings === 'object' ? settings : {};
    const next = {};
    if (s.auto !== undefined) { if (typeof s.auto !== 'boolean') throw new RackError('BAD_REQUEST', 'auto must be true or false'); next.auto = s.auto; }
    if (s.wakeOnDemand !== undefined) { if (typeof s.wakeOnDemand !== 'boolean') throw new RackError('BAD_REQUEST', 'wakeOnDemand must be true or false'); next.wakeOnDemand = s.wakeOnDemand; }
    if (s.idleShutdownMin !== undefined) {
        const n = Math.floor(Number(s.idleShutdownMin));
        if (!(n >= 1 && n <= 10080)) throw new RackError('BAD_REQUEST', 'idleShutdownMin must be 1 to 10080');
        next.idleShutdownMin = n;
    }
    return audited(ctx, name, 'power', 'settings', next, async () => {
        cfg.power = Object.assign({}, cfg.power, next);
        try {
            const file = path.join(dataDir(), 'servers.json');
            await fsp.mkdir(path.dirname(file), { recursive: true });
            await fsp.writeFile(`${file}.tmp`, JSON.stringify(loadServers(), null, 2) + '\n');
            await fsp.rename(`${file}.tmp`, file);
        } catch (e) { console.warn(`[rackManager] servers.json: ${e.message}`); }
        const r = rtOf(name);
        if (r.power.state === 'up') {
            if (powerOf(cfg).auto) { if (!r.subs.has(IDLE_KEY)) { r.subs.set(IDLE_KEY, () => {}); sseOpen(name); } } else { r.subs.delete(IDLE_KEY); if (!r.subs.size) sseClose(r); }
        }
        recompute(name);
        return { settings: powerOf(cfg), power: powerBrief(name) };
    });
}

// ---------------------------------------------------------------- the guard (HTTP + upgrade)

function fullAdmin(session, userType, applicationAuth) {
    const terminal = require('../adminTerminal');
    return userType === 'admin' && !applicationAuth && terminal.sessionIsFull(session);
}

function httpGuard(req, res, next) {
    if (fullAdmin(req.session, req.userType, req.applicationAuth)) return next();
    res.status(403).json({ ok: false, error: 'Rack Manager needs an administrator with a full sign-in' });
}

function pipeStream(res, up, fallbackType) {
    res.status(up.statusCode || 502);
    ['content-type', 'content-length', 'cache-control', 'etag', 'last-modified', 'accept-ranges', 'content-range', 'content-disposition'].forEach((h) => { if (up.headers[h]) res.set(h, up.headers[h]); });
    if (!up.headers['content-type'] && fallbackType) res.set('Content-Type', fallbackType);
    up.pipe(res);
    up.on('error', () => res.destroy());
}

function httpError(res, e) {
    const status = e.code === 'UNKNOWN_SERVER' ? 404 : e.code === 'BAD_REQUEST' ? 400 : e.code === 'NOT_DEPLOYED' || e.code === 'TUNNEL_DOWN' || e.code === 'ILO_DOWN' ? 503 : 502;
    if (!res.headersSent) res.status(status).json({ ok: false, code: e.code || 'FAILED', error: String(e.message || e) });
}

function mount(app, authMiddleware) {
    const full = [authMiddleware, httpGuard];
    app.get('/rack/:server/ilo/screenshot.png', full, async (req, res) => {
        try {
            const cfg = serverOf(req.params.server);
            await ensureIlo();
            const up = http.request({ socketPath: iloSockPath(), method: 'GET', path: `/api/${cfg.ilo}/screenshot.png` }, (r) => pipeStream(res, r, 'image/png'));
            up.setTimeout(30000, () => up.destroy());
            up.on('error', (e) => httpError(res, new RackError('ILO_DOWN', e.message)));
            up.end();
        } catch (e) { httpError(res, e); }
    });
    // an ISO for the iLO's virtual media: the raw body is streamed to the iLO service (never buffered here)
    app.post('/rack/:server/ilo/iso-upload', full, async (req, res) => {
        try {
            serverOf(req.params.server);
            const name = String(req.query.name || '');
            if (!/^[\w.+-]{1,120}\.(iso|img)$/i.test(name)) throw new RackError('BAD_REQUEST', 'name must end in .iso or .img');
            await ensureIlo();
            const up = http.request({ socketPath: iloSockPath(), method: 'POST', path: `/api/iso/upload?name=${encodeURIComponent(name)}`, headers: Object.assign({ 'Content-Type': 'application/octet-stream' }, req.headers['content-length'] ? { 'Content-Length': req.headers['content-length'] } : {}) }, (r) => {
                let b = '';
                r.on('data', (c) => { b += c; });
                r.on('end', () => { audit({ who: 'admin', via: 'http', server: req.params.server, role: 'ilo', action: 'iso-upload', params: { name }, ok: r.statusCode < 400 }); res.status(r.statusCode || 502).type('json').send(b || '{}'); });
            });
            up.on('error', (e) => httpError(res, new RackError('ILO_DOWN', e.message)));
            req.on('aborted', () => up.destroy());
            req.pipe(up);
        } catch (e) { httpError(res, e); }
    });
    // kind/name, or artifacts/<runId>/<name> (large: streamed, Range passed through, never buffered)
    app.get('/rack/:server/files/:kind/*', full, async (req, res) => {
        try {
            serverOf(req.params.server);
            const parts = [req.params.kind].concat(String(req.params[0] || '').split('/'));
            if (parts.length > 3 || parts.length < 2 || parts.some((x) => !FILE_RE.test(x) || x === '..' || x === '.')) throw new RackError('BAD_REQUEST', 'Bad file name');
            const tg = await rackdTarget(req.params.server);
            const headers = { Authorization: `Bearer ${tg.token}` };
            if (req.headers.range) headers.Range = req.headers.range;
            if (req.headers['if-none-match']) headers['If-None-Match'] = req.headers['if-none-match'];
            const up = http.request({ host: tg.host, port: tg.port, method: 'GET', path: `/v1/files/${parts.join('/')}`, headers }, (r) => pipeStream(res, r, 'application/octet-stream'));
            up.setTimeout(10 * 60 * 1000, () => up.destroy());
            res.on('close', () => up.destroy());
            up.on('error', (e) => httpError(res, new RackError('TUNNEL_DOWN', e.message)));
            up.end();
        } catch (e) { httpError(res, e); }
    });
}

const UPGRADE_RE = /^\/rack\/([a-z][a-z0-9_-]{0,40})\/(ilo\/ws|terminal\/ws)(\?.*)?$/;

function refuseUpgrade(socket, line) {
    try { socket.end(`HTTP/1.1 ${line}\r\nConnection: close\r\n\r\n`); } catch (_) { socket.destroy(); }
}

/** Pipes an accepted upgrade to the upstream (a unix socket or host:port), byte for byte. */
function proxyUpgrade(req, socket, head, up) {
    const headers = { connection: 'Upgrade', upgrade: 'websocket', 'sec-websocket-key': req.headers['sec-websocket-key'] || '', 'sec-websocket-version': req.headers['sec-websocket-version'] || '13', host: 'localhost' };
    if (req.headers['sec-websocket-extensions']) headers['sec-websocket-extensions'] = req.headers['sec-websocket-extensions'];
    if (req.headers['sec-websocket-protocol']) headers['sec-websocket-protocol'] = req.headers['sec-websocket-protocol'];
    Object.assign(headers, up.headers || {});
    const upstream = http.request(Object.assign({ method: 'GET', path: up.path, headers }, up.socketPath ? { socketPath: up.socketPath } : { host: up.host, port: up.port }));
    upstream.on('upgrade', (upRes, upSocket, upHead) => {
        let reply = 'HTTP/1.1 101 Switching Protocols\r\n';
        for (let i = 0; i < upRes.rawHeaders.length; i += 2) reply += `${upRes.rawHeaders[i]}: ${upRes.rawHeaders[i + 1]}\r\n`;
        socket.write(`${reply}\r\n`);
        if (upHead && upHead.length) socket.write(upHead);
        if (head && head.length) upSocket.write(head);
        socket.setNoDelay(true);
        upSocket.setNoDelay(true);
        upSocket.pipe(socket).pipe(upSocket);
        upSocket.on('error', () => socket.destroy());
        socket.on('error', () => upSocket.destroy());
        upSocket.on('close', () => socket.destroy());
        socket.on('close', () => upSocket.destroy());
    });
    upstream.on('response', (r) => { refuseUpgrade(socket, `${r.statusCode} ${r.statusMessage || ''}`); r.resume(); });
    upstream.on('error', () => refuseUpgrade(socket, '502 Bad Gateway'));
    upstream.end();
}

/** config.json public_hostname (staticforge.737.jp.net): the reverse proxy in front sends neither the public Host nor
 *  X-Forwarded-Host (seen live: Host 192.168.200.101:9220), so the page's public origin is named here. Read per call. */
function publicHosts() {
    try {
        const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'config.json'), 'utf8'));
        return [cfg.public_hostname, cfg.mcp_public_hostname].filter((h) => typeof h === 'string' && h);
    } catch (_) { return []; }
}

/** The page's origin is this server: the Host header, or the public name the reverse proxy forwards (737.jp.net sends
 *  X-Forwarded-Host; Host is then the internal address, so a Host-only check refused every console behind the proxy). */
function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    let oh;
    try { oh = new URL(origin).host.toLowerCase(); } catch (_) { return false; }
    const hosts = [req.headers.host].concat(String(req.headers['x-forwarded-host'] || '').split(','), publicHosts())
        .map((h) => String(h || '').trim().toLowerCase()).filter(Boolean);
    return hosts.includes(oh) || hosts.some((h) => h.replace(/:(443|80)$/, '') === oh.replace(/:(443|80)$/, ''));
}

/** True when the upgrade was a Rack Manager path (taken, accepted or refused). */
function handleUpgrade(req, socket, head, sessionMiddleware) {
    const m = UPGRADE_RE.exec(String(req.url || ''));
    if (!m) return false;
    socket.on('error', () => {});
    sessionMiddleware(req, {}, async () => {
        const s = req.session;
        if (!s || !s.authenticated) return refuseUpgrade(socket, '401 Unauthorized');
        if (!fullAdmin(s, s.userType, s.applicationAuth) || !sameOrigin(req)) {
            console.warn(`[rackManager] upgrade ${String(req.url).split('?')[0]} refused: ${!fullAdmin(s, s.userType, s.applicationAuth) ? 'not a full admin sign-in' : `origin ${req.headers.origin} vs host ${req.headers.host} / ${req.headers['x-forwarded-host'] || '-'}`}`);
            return refuseUpgrade(socket, '403 Forbidden');
        }
        try {
            const cfg = serverOf(m[1]);
            if (m[2] === 'ilo/ws') {
                await ensureIlo();
                return proxyUpgrade(req, socket, head, { socketPath: iloSockPath(), path: `/ws/${cfg.ilo}` });
            }
            const tg = await rackdTarget(cfg.name);
            const q = new URL(req.url, 'http://x').searchParams;
            const fwd = new URLSearchParams();
            ['cols', 'rows'].forEach((k) => { const n = Math.floor(Number(q.get(k))); if (n > 0 && n < 1000) fwd.set(k, String(n)); });
            const cmd = q.get('cmd');
            if (cmd && cmd.length < 500) fwd.set('cmd', cmd);
            return proxyUpgrade(req, socket, head, { host: tg.host, port: tg.port, path: `/v1/terminal/ws${fwd.toString() ? `?${fwd}` : ''}`, headers: { authorization: `Bearer ${tg.token}` } });
        } catch (e) { return refuseUpgrade(socket, e.code === 'UNKNOWN_SERVER' ? '404 Not Found' : '503 Service Unavailable'); }
    });
    return true;
}

let upgradeHooked = false;
function attachUpgrade(server, sessionMiddleware) {
    if (!server || server.__rackManagerUpgrade) return;
    server.__rackManagerUpgrade = true;
    upgradeHooked = true;
    const existing = server.listeners('upgrade');
    server.removeAllListeners('upgrade');
    server.on('upgrade', (req, socket, head) => {
        if (module.exports.handleUpgrade(req, socket, head, sessionMiddleware)) return;
        existing.forEach((listener) => listener.call(server, req, socket, head));
    });
}

// ---------------------------------------------------------------- the agents' socket (rack.sock)

function socketPath() {
    if (T.socket) return T.socket;
    if (process.env.AGENT_RACK_SOCKET) return process.env.AGENT_RACK_SOCKET;
    const store = T.coord || require('../agentCoord/store');
    return path.join(path.dirname(store.dbPath()), 'rack.sock');
}

const fleetCtx = (req) => ({ via: 'fleet', who: `agent:${String(req.by || 'unknown').slice(0, 60)}` });

/** One Fleet request. Resolves {ok, result} or {ok:false, error, code}. */
async function handleSock(req, stream) {
    try {
        if (!req || typeof req !== 'object') throw new RackError('BAD_REQUEST', 'Bad request');
        const ctx = fleetCtx(req);
        ctx.wake = req.wake === true;
        switch (req.op) {
            case 'status': return { ok: true, result: { servers: await status(req.server) } };
            case 'power': return { ok: true, result: await powerAction(req.server, req.action, { via: 'fleet', who: ctx.who, reason: req.reason, wait: req.wait === true, confirm: req.confirm === true, force: req.force === true }) };
            case 'lease': return { ok: true, result: await leaseTake(req.server, { via: 'fleet', who: ctx.who, purpose: req.purpose, minutes: req.minutes, id: req.id, wait: req.wait === true }) };
            case 'lease_release': return { ok: true, result: await leaseRelease(req.id, { via: 'fleet', who: ctx.who }) };
            case 'role':
                if (req.role === 'ilo') return { ok: true, result: req.action ? await iloAction(req.server, req.action, req.params, ctx) : await iloGet(req.server, (req.params && req.params.what) || 'health', req.params) };
                return { ok: true, result: req.action ? await action(req.server, req.role, req.action, req.params, ctx) : await get(req.server, req.role, req.params, { wake: ctx.wake, who: ctx.who }) };
            case 'exec': {
                const p = { cmd: req.cmd, cwd: req.cwd, timeoutS: req.timeout_s, user: req.user };
                Object.keys(p).forEach((k) => { if (p[k] === undefined) delete p[k]; });
                return { ok: true, result: await action(req.server, 'terminal', 'exec', p, ctx) };
            }
            case 'job': return { ok: true, result: await job(req.server, req.id, { cancel: req.cancel === true, tail: req.tail }, ctx) };
            case 'follow': {
                if (!stream) throw new RackError('BAD_REQUEST', 'follow needs a stream');
                const key = {};
                subscribe(req.server, key, (ev) => stream.write(`${JSON.stringify({ event: ev })}\n`));
                stream.once('close', () => unsubscribe(req.server, key));
                return { ok: true, follow: true };
            }
            default: throw new RackError('BAD_REQUEST', 'op must be status, role, exec, job, power, lease, lease_release or follow');
        }
    } catch (e) {
        // a host that is off / starting and open leases are answered as results (not tool errors), with the power state
        if (/^HOST_/.test(String(e.code)) || e.code === 'LEASES_OPEN') return { ok: true, result: { refused: true, code: e.code, error: String(e.message), power: e.power, leases: e.leases, busy: e.busy } };
        return { ok: false, error: String(e.message || e), code: e.code || 'FAILED' };
    }
}

function onSockConnection(sock) {
    let buf = '';
    sock.setEncoding('utf8');
    sock.setTimeout(150000, () => sock.destroy());
    sock.on('data', async (chunk) => {
        buf += chunk;
        const i = buf.indexOf('\n');
        if (i < 0) { if (buf.length > 65536) sock.destroy(); return; }
        const line = buf.slice(0, i);
        buf = '';
        let req = null;
        try { req = JSON.parse(line); } catch (_) { req = null; }
        if (req && req.op === 'follow') sock.setTimeout(0);
        const out = await module.exports.handleSock(req, sock);
        try {
            if (out.follow) sock.write(`${JSON.stringify(out)}\n`);
            else sock.end(`${JSON.stringify(out)}\n`);
        } catch (_) { /* gone */ }
    });
    sock.on('error', () => {});
}

function serveSocket() {
    if (S.sockServer) return;
    let file;
    try { file = socketPath(); } catch (e) { console.warn(`[rackManager] no agent socket: ${e.message}`); return; }
    try { fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 }); fs.unlinkSync(file); } catch (_) { /* none */ }
    const srv = net.createServer((sock) => module.exports._onSockConnection(sock));
    srv.on('error', (e) => console.warn(`[rackManager] socket: ${e.message}`));
    srv.listen(file, () => { try { fs.chmodSync(file, 0o600); } catch (_) { /* kept */ } });
    if (srv.unref) srv.unref();
    S.sockServer = srv;
}

function closeSocket() {
    return new Promise((resolve) => { const s = S.sockServer; S.sockServer = null; if (!s) return resolve(); s.close(() => resolve()); });
}

// ---------------------------------------------------------------- start / stop

/** Called once at boot (web_server.js): the socket for Fleet, the supervisor, and the iLO service (its telemetry records history all the time). */
function start() {
    if (process.env.RACK_MANAGER_DISABLED === '1') return;
    loadServers();
    loadLeases();
    serveSocket();
    if (!T.noSpawn) {
        try { ensureSup(); } catch (e) { console.warn(`[rackManager] supervisor: ${e.message}`); return; }
        ensureIlo().then(() => startIloFeed()).catch((e) => console.warn(`[rackManager] ${e.message}`));
    }
}

async function stop() {
    stopIloFeed();
    S.rt.forEach((r) => { sseClose(r); r.extras.forEach((f) => { if (f.timer) clearTimeout(f.timer); }); r.subs.clear(); [r.idleTimer, r.bootTimer].forEach((t) => { if (t) clearTimeout(t); }); r.idleTimer = null; r.bootTimer = null; r.waiters.forEach((w) => clearTimeout(w.timer)); r.waiters = []; });
    await closeSocket();
    if (S.sup) { try { S.sup.send({ op: 'stopAll' }); } catch (_) { /* gone */ } const sup = S.sup; S.sup = null; await sleep(150); try { sup.kill('SIGTERM'); } catch (_) { /* gone */ } }
    S.supervised = new Set();
    S.iloReady = null;
}

module.exports = {
    start, stop, mount, attachUpgrade, handleUpgrade, handleSock, events, RackError,
    list, status, get, action, job, iloGet, iloAction, forward, subscribe, unsubscribe, unsubscribeAll, subscriberCount, streamOpen,
    needsConfirm, serverOf, loadServers,
    powerAction, powerStatus, powerBrief, setPowerSettings, leaseTake, leaseRelease, leaseReleaseKey,
    _onIloEvent: onIloEvent,
    _onSup: onSup,
    _onSockConnection: onSockConnection,
    _test: {
        setRoot(dir) { T.root = dir; S = newState(); },
        setIloSock(p) { T.iloSock = p; },
        setNoSpawn(b) { T.noSpawn = !!b; },
        setSshCmd(c) { T.sshCmd = c; },
        setSocket(p) { T.socket = p; },
        setServers(list) { S.servers = list; },
        startIloFeed, stopIloFeed, setPower, idleDeadline, recompute, openLeases, loadLeases,
        serveSocket, closeSocket, socketPath, scrub, rtOf, ensureTunnel, state: () => S
    }
};

// Reload without a restart: the supervisor child, the tunnels and subscribers move to the new version; streams re-open.
require('../hotReload').mark(module, {
    dispose() {
        S.rt.forEach((r) => { if (r.sseTimer) { clearTimeout(r.sseTimer); r.sseTimer = null; } if (r.sse) { const s = r.sse; r.sse = null; try { s.destroy(); } catch (_) { /* gone */ } } });
        S.rt.forEach((r) => { [r.idleTimer, r.bootTimer].forEach((t) => { if (t) clearTimeout(t); }); r.idleTimer = null; r.bootTimer = null; });
        stopIloFeed();
        return { S, upgradeHooked };
    },
    accept(st) {
        if (!st || !st.S) return;
        S = st.S;
        upgradeHooked = !!st.upgradeHooked;
        if (S.sup && S.sup.connected) { S.sup.removeAllListeners('message'); S.sup.on('message', (m) => module.exports._onSup(m)); }
        if (S.sockServer) { S.sockServer.removeAllListeners('connection'); S.sockServer.on('connection', (sock) => module.exports._onSockConnection(sock)); }
        S.rt.forEach((r, name) => {
            if (r.subs.size) sseOpen(name);
            recompute(name);
        });
        S.iloFeedOff = false;
        if (!T.noSpawn) startIloFeed();
    }
});
