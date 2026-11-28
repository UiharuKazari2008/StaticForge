'use strict';
// SSE hub. Timers (ping, metrics) run only while at least one client is connected.
const fs = require('fs');
const os = require('os');

const clients = new Set();
let pingTimer = null, metricsTimer = null, prev = null;
const idleHooks = [], activeHooks = [], emitHooks = [];

function emit(role, kind, id, data) {
  if (!clients.size) return;
  if (kind !== 'metrics') for (const f of emitHooks) { try { f(role, kind); } catch { /* hook failed */ } }
  const msg = `event: rack\ndata: ${JSON.stringify({ role, kind, id, data })}\n\n`;
  for (const res of clients) res.write(msg);
}
const listening = () => clients.size > 0;
const onIdle = fn => idleHooks.push(fn);
const onActive = fn => activeHooks.push(fn);
const onEmit = fn => emitHooks.push(fn);

function sample() {
  const stat = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
  const idle = stat[3] + (stat[4] || 0), total = stat.reduce((a, b) => a + b, 0);
  let rx = 0, tx = 0;
  for (const l of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) {
    const m = l.trim().match(/^([^:]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/);
    if (m && m[1] !== 'lo') { rx += Number(m[2]); tx += Number(m[3]); }
  }
  let rd = 0, wr = 0;
  for (const l of fs.readFileSync('/proc/diskstats', 'utf8').split('\n')) {
    const f = l.trim().split(/\s+/);
    if (f.length > 9 && /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+)$/.test(f[2])) { rd += Number(f[5]) * 512; wr += Number(f[9]) * 512; }
  }
  return { t: Date.now(), idle, total, rx, tx, rd, wr };
}
function memInfo() {
  const m = {}; for (const l of fs.readFileSync('/proc/meminfo', 'utf8').split('\n')) { const x = l.match(/^(\w+):\s+(\d+)/); if (x) m[x[1]] = Number(x[2]) * 1024; }
  return { totalB: m.MemTotal, availB: m.MemAvailable };
}
function tickMetrics() {
  let s; try { s = sample(); } catch { return; }
  if (prev) {
    const dt = (s.t - prev.t) / 1000 || 1, dTot = s.total - prev.total;
    emit('rack', 'metrics', null, {
      cpu: dTot > 0 ? Math.round((1 - (s.idle - prev.idle) / dTot) * 1000) / 10 : 0,
      mem: (m => ({ totalB: m.totalB, usedB: m.totalB - m.availB, availB: m.availB }))(memInfo()), load: os.loadavg(),
      net: { rxBps: Math.max(0, Math.round((s.rx - prev.rx) / dt)), txBps: Math.max(0, Math.round((s.tx - prev.tx) / dt)) },
      disk: { rBps: Math.max(0, Math.round((s.rd - prev.rd) / dt)), wBps: Math.max(0, Math.round((s.wr - prev.wr) / dt)) },
    });
  }
  prev = s;
}

function addClient(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(': hello\n\n');
  clients.add(res);
  if (clients.size === 1) {
    pingTimer = setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000);
    prev = null; tickMetrics();
    metricsTimer = setInterval(tickMetrics, 10000);
    for (const f of activeHooks) { try { f(); } catch { /* hook failed */ } }
  }
  const drop = () => {
    if (!clients.delete(res)) return;
    if (!clients.size) { clearInterval(pingTimer); clearInterval(metricsTimer); pingTimer = metricsTimer = null; for (const f of idleHooks) { try { f(); } catch { /* hook failed */ } } }
  };
  req.on('close', drop); res.on('close', drop); res.on('error', drop);
}
module.exports = { emit, addClient, listening, onIdle, onActive, onEmit, memInfo };
