'use strict';
// Idle verdict (GET /v1/idle, SSE `idle` event) and the graceful host shutdown job.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('./exec');
const { DATA, writeJson } = require('./util');
const events = require('./events');
const jobs = require('./jobs');

let roles = {};
let last = null, idleSince = new Date().toISOString(), timer = null, debounce = null, shuttingDown = false;
const LOAD_LIMIT = Math.max(4, os.cpus().length * 0.1); // Misaka idles near 2.4 on 80 threads

async function compute() {
  const busy = [];
  for (const j of jobs.list()) if (j.state === 'running') busy.push({ kind: 'job', id: j.id, why: j.title });
  for (const r of Object.values(roles)) if (r.busy) { try { busy.push(...await r.busy()); } catch { /* role not usable */ } }
  const who = await run(['who']);
  for (const l of who.stdout.split('\n').filter(Boolean)) { const f = l.trim().split(/\s+/); if (!/^pts\//.test(f[1])) continue; /* only interactive ssh shells (pts); sshd-only sessions are tunnels such as Dreamscape's own */ busy.push({ kind: 'ssh', id: `${f[0]}@${f[1]}`, why: 'logged in' }); }
  const load = os.loadavg()[0];
  if (load > LOAD_LIMIT) busy.push({ kind: 'load', id: 'loadavg', why: `load ${load.toFixed(2)} over ${LOAD_LIMIT}` });
  if (shuttingDown) busy.push({ kind: 'shutdown', id: 'host', why: 'shutting down' });
  return busy;
}
async function verdict() {
  const busy = await compute(); const idle = busy.length === 0;
  if (last === null || last.idle !== idle) idleSince = new Date().toISOString();
  const v = { idle, idleSince: idle ? idleSince : null, busy };
  const key = JSON.stringify(v.busy);
  const changed = !last || last.idle !== idle || last.key !== key;
  last = { idle, key };
  return { v, changed };
}
async function check() { const { v, changed } = await verdict(); if (changed) events.emit('host', 'idle', null, v); return v; }

// Recompute on role/job events (debounced) and every 5 min: only while an SSE client is connected.
function init(rolesMap) {
  roles = rolesMap;
  events.onEmit((role, kind) => { if (role === 'host' && kind === 'idle') return; clearTimeout(debounce); debounce = setTimeout(() => check().catch(() => {}), 1500); });
  events.onActive(() => { last = null; check().catch(() => {}); timer = setInterval(() => check().catch(() => {}), 300000); });
  events.onIdle(() => { clearInterval(timer); timer = null; clearTimeout(debounce); });
}
const get = async () => (await verdict()).v;

function shutdown({ reason, dryRun }) {
  if (shuttingDown) throw Object.assign(new Error('a shutdown is already running'), { status: 409, code: 'BUSY' });
  shuttingDown = true;
  return jobs.start({ role: 'host', title: `host shutdown${dryRun ? ' (dry run)' : ''}`, run: async ctx => {
    try {
      const log = ctx.log; log(`reason: ${reason || 'none given'}${dryRun ? ' (dry run: nothing is stopped)' : ''}`);
      const order = ['sandboxes', 'android', 'containers'];
      for (const id of order) if (roles[id]?.stopAll) { log(`-- ${id}`); await roles[id].stopAll(log, dryRun); }
      log('-- vms'); if (roles.vms?.shutdownAll) await roles.vms.shutdownAll(log, dryRun);
      log('-- RAM disks'); if (roles.storage?.syncAll) await roles.storage.syncAll(log, dryRun);
      const rec = { at: new Date().toISOString(), reason: reason || null, dryRun: !!dryRun, jobs: jobs.list().filter(j => j.state === 'running' && j.id !== ctx.jobId).length };
      if (!dryRun) writeJson(path.join(DATA, 'last-shutdown.json'), rec);
      else log(`would write ${path.join(DATA, 'last-shutdown.json')}: ${JSON.stringify(rec)}`);
      if (dryRun) { log('would run: systemctl poweroff'); return; }
      log('systemctl poweroff');
      await run(['systemctl', 'poweroff']);
    } finally { if (dryRun) shuttingDown = false; }
  } });
}
module.exports = { init, get, check, shutdown };
