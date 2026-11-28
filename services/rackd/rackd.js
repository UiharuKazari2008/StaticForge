'use strict';
// rackd: the Rack Manager host agent. HTTP on 127.0.0.1:8791, bearer token, no npm dependencies.
const http = require('http');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const { run } = require('./lib/exec');
const { RackError, DATA, readJson } = require('./lib/util');
const events = require('./lib/events');
const jobs = require('./lib/jobs');
const files = require('./lib/files');
const apt = require('./lib/apt');
const ws = require('./lib/ws');
const pty = require('./lib/pty');
const idle = require('./lib/idle');
const history = require('./lib/history');

const VERSION = '1.0.0';
const PORT = Number(process.env.RACKD_PORT || 8791);
const TOKEN_FILE = process.env.RACKD_TOKEN_FILE || '/etc/rackd/token';
const startedAt = new Date().toISOString();
const ROLE_IDS = ['vms', 'android', 'sandboxes', 'terminal', 'storage', 'networking', 'services', 'logs', 'updates', 'containers', 'builds', 'replicas'];
const roles = {}; for (const id of ROLE_IDS) roles[id] = require(`./roles/${id}`);

let tokenHash;
try { tokenHash = crypto.createHash('sha256').update(fs.readFileSync(TOKEN_FILE, 'utf8').trim()).digest(); } catch { console.error(`no token at ${TOKEN_FILE}`); process.exit(1); }
const authed = req => {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  return !!m && crypto.timingSafeEqual(crypto.createHash('sha256').update(m[1].trim()).digest(), tokenHash);
};

const send = (res, status, obj) => { const b = JSON.stringify(obj); res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(b) }); res.end(b); };
const fail = (res, e) => {
  const status = e.status || 500;
  if (status >= 500) console.error(`error: ${e.message}`);
  send(res, status, { error: e.message, code: e.code || (status >= 500 ? 'INTERNAL' : 'BAD_REQUEST') });
};
function body(req) {
  return new Promise((resolve, reject) => {
    const parts = []; let n = 0;
    req.on('data', d => { n += d.length; if (n > 1048576) { reject(new RackError('body too large', 'TOO_LARGE', 413)); req.destroy(); } else parts.push(d); });
    req.on('end', () => { if (!n) return resolve({}); try { const j = JSON.parse(Buffer.concat(parts).toString('utf8')); resolve(j && typeof j === 'object' ? j : {}); } catch { reject(new RackError('invalid JSON')); } });
    req.on('error', reject);
  });
}

async function info() {
  const mem = events.memInfo();
  const cpuinfo = (() => { try { return fs.readFileSync('/proc/cpuinfo', 'utf8'); } catch { return ''; } })();
  const sockets = new Set([...cpuinfo.matchAll(/^physical id\s*:\s*(\d+)/gm)].map(m => m[1])).size || 1;
  const osr = (() => { try { return (fs.readFileSync('/etc/os-release', 'utf8').match(/^PRETTY_NAME="?([^"\n]+)/m) || [])[1]; } catch { return null; } })();
  const out = {};
  await Promise.all(Object.values(roles).map(async r => {
    try { out[r.id] = await Promise.race([r.detect(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]); }
    catch (e) { out[r.id] = { installed: false, ready: false, summary: `error: ${e.message}`, missing: [] }; }
    // what runs now, for the console's At a Glance cards (count() is each role's own event-driven state, no extra calls)
    try { if (typeof r.count === 'function') { const c = r.count(); out[r.id].running = typeof c === 'number' ? c : (c && typeof c[r.id] === 'number' ? c[r.id] : c); } } catch { /* no count */ }
  }));
  return { host: os.hostname(), os: osr, kernel: os.release(), uptimeS: Math.round(os.uptime()), cpus: { count: sockets, model: os.cpus()[0]?.model, threads: os.cpus().length }, memory: { totalB: mem.totalB, availB: mem.availB }, load: os.loadavg(), rackd: { version: VERSION, startedAt }, roles: out };
}

function installJob(role) {
  const r = roles[role];
  return jobs.start({ role, title: `install role ${role}`, run: async ctx => {
    if (r.preInstall) await r.preInstall(ctx);
    if (r.packages?.length) await apt.install(ctx, r.packages);
    if (r.install) await r.install(ctx);
    events.emit(role, 'state', null, { installed: true });
  } });
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] !== 'v1') throw new RackError('not found', 'NOT_FOUND', 404);
  const [, a, b, c] = parts; const m = req.method;
  if (m === 'GET' && a === 'info' && !b) return send(res, 200, await info());
  if (m === 'GET' && a === 'events') return events.addClient(req, res);
  if (m === 'GET' && a === 'metrics' && b === 'history') return send(res, 200, history.query(url.searchParams.get('range') || '3h', url.searchParams.get('points')));
  if (m === 'GET' && a === 'idle' && !b) return send(res, 200, await idle.get());
  if (m === 'POST' && a === 'host' && b === 'shutdown' && !c) {
    const p = await body(req);
    return send(res, 202, { job: idle.shutdown({ reason: typeof p.reason === 'string' ? p.reason.slice(0, 200) : '', dryRun: p.dryRun === true }) });
  }
  if (a === 'jobs') {
    if (m === 'GET' && !b) return send(res, 200, { jobs: jobs.list().slice(0, 200) });
    if (m === 'GET' && b && !c) return send(res, 200, { job: jobs.get(b, Number(url.searchParams.get('tail')) || 200) });
    if (m === 'POST' && b && c === 'cancel') { await body(req); return send(res, 200, { job: jobs.cancel(b) }); }
  }
  if (a === 'roles' && m === 'POST' && b && c === 'install') {
    if (!roles[b]) throw new RackError('no such role', 'NOT_FOUND', 404);
    await body(req); return send(res, 202, { job: installJob(b) });
  }
  if (a === 'files' && m === 'GET' && b && c) {
    const f = files.resolve(b, c); const st = fs.statSync(f.abs);
    res.writeHead(200, { 'Content-Type': f.type, 'Content-Length': st.size, 'Cache-Control': 'private, max-age=31536000, immutable' });
    return fs.createReadStream(f.abs).pipe(res);
  }
  const role = roles[a];
  if (!role) throw new RackError('not found', 'NOT_FOUND', 404);
  if (m === 'GET' && !b) return send(res, 200, await role.get(Object.fromEntries(url.searchParams)));
  if (m === 'POST' && b && !c) {
    const act = role.actions[b];
    if (!act || !Object.prototype.hasOwnProperty.call(role.actions, b)) throw new RackError(`no such action ${a}/${b}`, 'NOT_FOUND', 404);
    const params = await body(req);
    console.log(`action ${a}/${b}`);
    const result = await act(params, {});
    return send(res, result && result.job ? 202 : 200, result === undefined ? { ok: true } : result);
  }
  throw new RackError('not found', 'NOT_FOUND', 404);
}

const server = http.createServer((req, res) => {
  if (!authed(req)) return send(res, 401, { error: 'unauthorized', code: 'UNAUTHORIZED' });
  route(req, res).catch(e => { if (!res.headersSent) fail(res, e); else res.end(); });
});

// GET /v1/terminal/ws?cols&rows&cmd=&user=: an interactive pty
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://x');
  if (!authed(req) || url.pathname !== '/v1/terminal/ws') { socket.write('HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n'); return socket.destroy(); }
  const user = url.searchParams.get('user') || 'rack';
  if (user !== 'rack' && user !== 'root') { socket.write('HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\n\r\n'); return socket.destroy(); }
  const cmd = url.searchParams.get('cmd');
  const argv = cmd ? (user === 'root' ? ['bash', '-lc', cmd] : ['runuser', '-u', 'rack', '--', 'bash', '-lc', cmd]) : (user === 'root' ? ['bash', '-l'] : ['runuser', '-l', 'rack']);
  const sock = ws.accept(req, socket); if (!sock) return;
  let closed = false;
  const p = pty.open({ cols: Number(url.searchParams.get('cols')) || 80, rows: Number(url.searchParams.get('rows')) || 24, argv,
    onData: s => { if (!closed) sock.sendText(s); }, onExit: code => { if (!closed) { sock.sendText(`\r\n[process exited ${code}]\r\n`); sock.close(); } } });
  sock.on('message', s => {
    if (s.charCodeAt(0) === 0) { try { const j = JSON.parse(s.slice(1)); if (j.t === 'resize') p.resize(j.cols, j.rows); } catch { /* ignore */ } return; }
    p.write(s);
  });
  sock.on('binary', b => p.write(b));
  sock.on('close', () => { closed = true; p.kill(); });
});

async function main() {
  fs.mkdirSync(DATA, { recursive: true, mode: 0o755 });
  jobs.init(); idle.init(roles);
  for (const r of Object.values(roles)) { try { if (r.init) await r.init(); } catch (e) { console.error(`init ${r.id}: ${e.message}`); } }
  history.init(roles);
  server.listen(PORT, '127.0.0.1', () => console.log(`rackd ${VERSION} listening on 127.0.0.1:${PORT}`));
}
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  for (const r of Object.values(roles)) { try { if (r.shutdown) await r.shutdown(); } catch { /* best effort */ } }
  process.exit(0);
}
process.on('SIGTERM', stop); process.on('SIGINT', stop);
process.on('uncaughtException', e => console.error(`uncaught: ${e && e.stack || e}`));
process.on('unhandledRejection', e => console.error(`unhandled: ${e && e.stack || e}`));
main();
