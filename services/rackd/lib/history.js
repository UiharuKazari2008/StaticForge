'use strict';
// Host metrics history: a sample every 30 s while rackd runs (/proc reads + counts the roles keep from their own events).
// In-memory ring (24 h) and DATA/metrics/YYYY-MM-DD.jsonl (7 days).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DATA } = require('./util');
const jobs = require('./jobs');
const inventory = require('./inventory');
const events = require('./events');

const DIR = path.join(DATA, 'metrics');
const STEP_MS = 30000, RING_MS = 24 * 3600e3, KEEP_DAYS = 7;
const RANGES = { '3h': 3 * 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 86400e3 };
const COUNTS = ['unmanaged', 'vms', 'avds', 'sandboxes', 'containers', 'replicas', 'builds', 'jobs'];
let ring = [], prev = null, timer = null, roles = {};

const day = t => new Date(t).toISOString().slice(0, 10);
function raw() {
  const stat = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0].split(/\s+/).slice(1).map(Number);
  let rx = 0, tx = 0, rd = 0, wr = 0;
  for (const l of fs.readFileSync('/proc/net/dev', 'utf8').split('\n').slice(2)) { const m = l.trim().match(/^([^:]+):\s*(\d+)(?:\s+\d+){7}\s+(\d+)/); if (m && m[1] !== 'lo') { rx += Number(m[2]); tx += Number(m[3]); } }
  for (const l of fs.readFileSync('/proc/diskstats', 'utf8').split('\n')) { const f = l.trim().split(/\s+/); if (f.length > 9 && /^(sd[a-z]+|nvme\d+n\d+|vd[a-z]+)$/.test(f[2])) { rd += Number(f[5]) * 512; wr += Number(f[9]) * 512; } }
  return { t: Date.now(), idle: stat[3] + (stat[4] || 0), total: stat.reduce((a, b) => a + b, 0), rx, tx, rd, wr };
}
function sample() {
  const s = raw(); const out = prev ? (() => {
    const dt = (s.t - prev.t) / 1000 || 1, dTot = s.total - prev.total, m = events.memInfo(), c = roles.containers?.count?.() || {};
    return {
      t: s.t, cpu: dTot > 0 ? Math.round((1 - (s.idle - prev.idle) / dTot) * 1000) / 10 : 0, memUsedB: m.totalB - m.availB, memTotalB: m.totalB,
      diskRBps: Math.max(0, Math.round((s.rd - prev.rd) / dt)), diskWBps: Math.max(0, Math.round((s.wr - prev.wr) / dt)), netRxBps: Math.max(0, Math.round((s.rx - prev.rx) / dt)), netTxBps: Math.max(0, Math.round((s.tx - prev.tx) / dt)), load1: os.loadavg()[0],
      vms: roles.vms?.count?.() || 0, avds: roles.android?.count?.() || 0, sandboxes: roles.sandboxes?.count?.() || 0, containers: c.containers || 0, replicas: c.replicas || 0, builds: roles.builds?.count?.() || 0, jobs: jobs.runningCount(), unmanaged: inventory.unmanagedCount(),
    };
  })() : null;
  prev = s;
  if (!out) return;
  ring.push(out); const cut = out.t - RING_MS; while (ring.length && ring[0].t < cut) ring.shift();
  try { fs.appendFileSync(path.join(DIR, `${day(out.t)}.jsonl`), `${JSON.stringify(out)}\n`); } catch { /* disk full: memory still has it */ }
}
function init(rolesMap) {
  roles = rolesMap; fs.mkdirSync(DIR, { recursive: true });
  const cutoff = Date.now() - KEEP_DAYS * 86400e3;
  const files = fs.readdirSync(DIR).filter(f => /^\d{4}-\d\d-\d\d\.jsonl$/.test(f)).sort();
  for (const f of files) { if (Date.parse(f.slice(0, 10)) + 86400e3 < cutoff) { try { fs.unlinkSync(path.join(DIR, f)); } catch { /* gone */ } } }
  const ringFrom = Date.now() - RING_MS;
  for (const f of files.slice(-2)) { try { for (const l of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) { if (!l) continue; try { const o = JSON.parse(l); if (o.t >= ringFrom) ring.push(o); } catch { /* partial line */ } } } catch { /* skip */ } }
  ring.sort((a, b) => a.t - b.t);
  sample(); timer = setInterval(sample, STEP_MS); timer.unref();
}
function fileSamples(from) {
  const out = []; const files = fs.readdirSync(DIR).filter(f => /^\d{4}-\d\d-\d\d\.jsonl$/.test(f)).sort();
  for (const f of files) { if (Date.parse(f.slice(0, 10)) + 86400e3 < from) continue; try { for (const l of fs.readFileSync(path.join(DIR, f), 'utf8').split('\n')) { if (!l) continue; try { const o = JSON.parse(l); if (o.t >= from) out.push(o); } catch { /* partial */ } } } catch { /* skip */ } }
  return out;
}
// {from, to, step, samples}: avg per bucket, counts = max per bucket.
function query(range = '3h', points = 360) {
  const span = RANGES[range]; if (!span) { const e = new Error('range must be 3h, 6h, 24h or 7d'); e.status = 400; throw e; }
  const n = Math.max(10, Math.min(2000, Number(points) | 0 || 360));
  const to = Date.now(), from = to - span;
  const src = span <= RING_MS ? ring.filter(s => s.t >= from) : fileSamples(from);
  const step = Math.max(STEP_MS, Math.ceil(span / n / STEP_MS) * STEP_MS);
  const buckets = new Map();
  for (const s of src) { const k = Math.floor((s.t - from) / step); (buckets.get(k) || buckets.set(k, []).get(k)).push(s); }
  const samples = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([k, arr]) => {
    const o = { t: from + k * step + Math.round(step / 2) };
    for (const key of Object.keys(arr[0])) { if (key === 't') continue; const vals = arr.map(x => x[key] || 0); o[key] = COUNTS.includes(key) ? Math.max(...vals) : Math.round(vals.reduce((a, b) => a + b, 0) / vals.length * 10) / 10; }
    return o;
  });
  return { from, to, step, samples };
}
module.exports = { init, query };
