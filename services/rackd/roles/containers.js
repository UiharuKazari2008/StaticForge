'use strict';
// containers: Docker (docker.io from Debian), data root on the LV `rackdocker` in vmdata at /srv/rack/docker.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { run, ok } = require('../lib/exec');
const { str, num, bool, RE, bad, absPath } = require('../lib/util');
const apt = require('../lib/apt');
const jobs = require('../lib/jobs');
const events = require('../lib/events');
const storage = require('./storage');

const packages = ['docker.io', 'docker-cli', 'docker-buildx'];
const ROOT = '/srv/rack/docker';
const DATA_ROOT = `${ROOT}/data`;
const REF = /^[A-Za-z0-9][A-Za-z0-9._\/:@-]{0,255}$/;
const CID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const docker = (args, o) => run(['docker', ...args], { timeoutMs: 60000, ...o });
const dok = (args, o) => ok(['docker', ...args], { timeoutMs: 60000, ...o });
const jl = out => out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const have = () => fs.existsSync('/var/run/docker.sock');

const running = new Map(); // name -> replica?
async function refreshRunning() { running.clear(); if (!have()) return; const r = await docker(['ps', '--format', '{{.Names}}|{{.Label "rack.replica"}}'], { timeoutMs: 15000 }); for (const l of r.stdout.split('\n').filter(Boolean)) { const [n, rep] = l.split('|'); running.set(n, !!rep); } }
let evChild = null, backoff = 2000;
function watch() {
  if (evChild || !have()) return;
  const c = spawn('docker', ['events', '--format', '{{json .}}', '--filter', 'type=container'], { stdio: ['ignore', 'pipe', 'ignore'] });
  evChild = c; let buf = '';
  c.on('error', () => {});
  c.stdout.on('data', d => {
    backoff = 2000; buf += d.toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      try {
        const e = JSON.parse(l); const name = e.Actor?.Attributes?.name || e.id.slice(0, 12);
        const a = e.Action.split(':')[0];
        if (a === 'start') running.set(name, !!e.Actor?.Attributes?.['rack.replica']); else if (['die', 'stop', 'kill', 'destroy'].includes(a)) running.delete(name);
        if (a === 'create') events.emit('containers', 'added', name, { id: e.id, name });
        else if (a === 'destroy') events.emit('containers', 'removed', name, { id: e.id, name });
        else if (['start', 'die', 'stop', 'kill', 'pause', 'unpause', 'restart', 'oom'].includes(a)) events.emit('containers', 'state', name, { id: e.id, name, event: a });
      } catch { /* skip */ }
    }
  });
  c.on('close', () => { evChild = null; setTimeout(watch, backoff = Math.min(backoff * 2, 60000)).unref(); });
}

const mem = s => { const m = String(s || '').match(/^([\d.]+)\s*([KMGT]?i?B)/i); if (!m) return null; const u = { b: 1, kb: 1e3, kib: 1024, mb: 1e6, mib: 2 ** 20, gb: 1e9, gib: 2 ** 30 }[m[2].toLowerCase()]; return u ? Math.round(Number(m[1]) * u) : null; };

module.exports = {
  id: 'containers', packages, init() { watch(); refreshRunning().catch(() => {}); },
  count: () => ({ containers: [...running.values()].filter(x => !x).length, replicas: [...running.values()].filter(Boolean).length }),
  async busy() {
    if (!have()) return [];
    const r = await docker(['ps', '--format', '{{.Names}}|{{.Label "rack.replica"}}'], { timeoutMs: 15000 });
    return r.stdout.split('\n').filter(Boolean).map(l => { const [n, rep] = l.split('|'); return { kind: rep ? 'replica' : 'container', id: n, why: 'running' }; });
  },
  async stopAll(log, dryRun) {
    if (!have()) return;
    const ids = (await docker(['ps', '-q'])).stdout.split('\n').filter(Boolean);
    for (const id of ids) { log(`${dryRun ? 'would stop' : 'stopping'} container ${id}`); if (!dryRun) await docker(['stop', '-t', '30', id], { timeoutMs: 90000 }); }
  }, shutdown() { if (evChild) try { evChild.kill(); } catch { /* gone */ } },
  // The Docker data root goes on its own LV before the engine is ever started.
  async preInstall(ctx) {
    if (!fs.existsSync(ROOT) || !(await run(['findmnt', '-n', ROOT])).stdout.trim()) {
      ctx.log(`creating LV rackdocker (300 GB) in vmdata at ${ROOT}`);
      await storage.actions['lv-create']({ vg: 'vmdata', name: 'rackdocker', sizeGB: 300, fs: 'ext4', mount: ROOT });
    }
    fs.mkdirSync(DATA_ROOT, { recursive: true });
    fs.mkdirSync('/etc/docker', { recursive: true });
    fs.writeFileSync('/etc/docker/daemon.json', `${JSON.stringify({ 'data-root': DATA_ROOT, 'log-driver': 'json-file', 'log-opts': { 'max-size': '50m', 'max-file': '3' } }, null, 2)}\n`);
    fs.mkdirSync('/etc/systemd/system/docker.service.d', { recursive: true });
    // wait for the LV mount at boot; let bridged (VM) traffic through Docker's FORWARD policy so the br0 VMs keep working
    fs.writeFileSync('/etc/systemd/system/docker.service.d/rack.conf', `[Unit]\nRequiresMountsFor=${ROOT}\n\n[Service]\nExecStartPost=-/bin/sh -c 'iptables -C DOCKER-USER -m physdev --physdev-is-bridged -j ACCEPT 2>/dev/null || iptables -I DOCKER-USER -m physdev --physdev-is-bridged -j ACCEPT'\n`);
    await ctx.exec(['systemctl', 'daemon-reload']);
  },
  async install(ctx) {
    await ctx.exec(['systemctl', 'enable', '--now', 'docker']);
    for (let i = 0; i < 20 && !have(); i++) await new Promise(r => setTimeout(r, 500));
    watch(); await refreshRunning().catch(() => {});
  },
  async detect() {
    const missing = await apt.missing(packages);
    if (missing.length) return { installed: false, ready: false, summary: 'docker is not installed', missing };
    const r = await docker(['info', '--format', '{{.ServerVersion}} {{.DockerRootDir}} {{.ContainersRunning}}/{{.Containers}}'], { timeoutMs: 15000 });
    if (r.code !== 0) return { installed: true, ready: false, summary: 'the engine is not answering', missing: [] };
    const [ver, root, cnt] = r.stdout.trim().split(' ');
    return { installed: true, ready: root.startsWith(ROOT), summary: `docker ${ver}, ${cnt} running, data root ${root}`, missing: [] };
  },
  async get() {
    const v = await docker(['info', '--format', '{{json .}}'], { timeoutMs: 15000 });
    if (v.code !== 0) return { engine: { version: null, dataRoot: null, running: false }, containers: [], images: [], volumes: [], networks: [] };
    const info = JSON.parse(v.stdout);
    const [ps, st, imgs, vols, nets] = await Promise.all([
      docker(['ps', '-a', '--no-trunc', '--format', '{{json .}}']), docker(['stats', '--no-stream', '--no-trunc', '--format', '{{json .}}'], { timeoutMs: 20000 }),
      docker(['image', 'ls', '--no-trunc', '--format', '{{.ID}}']), docker(['volume', 'ls', '--format', '{{json .}}']), docker(['network', 'ls', '--format', '{{json .}}']),
    ]);
    const stats = {}; for (const s of jl(st.stdout)) stats[s.ID] = s;
    const containers = jl(ps.stdout).map(c => {
      const s = stats[c.ID];
      const labels = {}; for (const kv of (c.Labels || '').split(',')) { const i = kv.indexOf('='); if (i > 0) labels[kv.slice(0, i)] = kv.slice(i + 1); }
      return { id: c.ID.slice(0, 12), name: c.Names, image: c.Image, state: c.State, status: c.Status, ports: c.Ports, cpus: s ? Number(s.CPUPerc.replace('%', '')) / 100 : null, memB: s ? mem(s.MemUsage.split('/')[0].trim()) : null, labels, createdAt: c.CreatedAt };
    });
    let images = [];
    const ids = [...new Set(imgs.stdout.split('\n').filter(Boolean))];
    if (ids.length) {
      const ins = await docker(['image', 'inspect', ...ids, '--format', '{{.Id}}|{{.Size}}|{{.Created}}|{{json .RepoTags}}']);
      images = ins.stdout.split('\n').filter(Boolean).map(l => { const [id, size, created, tags] = l.split('|'); let t = []; try { t = JSON.parse(tags) || []; } catch { /* none */ } return { id: id.replace('sha256:', '').slice(0, 12), tags: t, sizeB: Number(size), createdAt: created }; });
    }
    const mounts = await docker(['ps', '-a', '--format', '{{.Names}}|{{.Mounts}}']);
    const volumes = jl(vols.stdout).map(x => ({ name: x.Name, sizeB: null, usedBy: mounts.stdout.split('\n').filter(l => l.split('|')[1]?.split(',').includes(x.Name)).map(l => l.split('|')[0]) }));
    return { engine: { version: info.ServerVersion, dataRoot: info.DockerRootDir, running: true }, containers, images, volumes, networks: jl(nets.stdout).map(n => ({ id: n.ID, name: n.Name, driver: n.Driver, scope: n.Scope })) };
  },
  actions: {
    ...Object.fromEntries(['start', 'stop', 'restart', 'kill'].map(verb => [verb, async p => { await dok([verb, str(p.id, 'id', CID)], { timeoutMs: 90000 }); return { ok: true }; }])),
    async remove(p) { await dok(['rm', ...(p.force === true ? ['-f'] : []), str(p.id, 'id', CID)]); return { ok: true }; },
    async logs(p) { const r = await docker(['logs', '--tail', String(num(p.lines, 'lines', 1, 100000, 200)), str(p.id, 'id', CID)], { maxBytes: 4194304 }); return { text: r.stdout + r.stderr }; },
    async exec(p) {
      const r = await docker(['exec', str(p.id, 'id', CID), 'sh', '-c', str(p.cmd, 'cmd', null, 100000)], { timeoutMs: num(p.timeoutS, 'timeoutS', 1, 3600, 60) * 1000 });
      return { code: r.code, out: r.stdout + (r.stderr ? `\n${r.stderr}` : '') };
    },
    async pull(p) { const image = str(p.image, 'image', REF); return { job: jobs.start({ role: 'containers', title: `pull ${image}`, run: c => c.exec(['docker', 'pull', image], { timeoutMs: 3600e3 }) }) }; },
    async build(p) {
      const tag = str(p.tag, 'tag', REF); const context = absPath(p.context, 'context');
      const df = p.dockerfile ? (path.isAbsolute(p.dockerfile) ? absPath(p.dockerfile, 'dockerfile') : path.join(context, str(p.dockerfile, 'dockerfile', /^[A-Za-z0-9._\/-]+$/))) : null;
      return { job: jobs.start({ role: 'containers', title: `build ${tag}`, run: c => c.exec(['docker', 'build', '-t', tag, ...(df ? ['-f', df] : []), context], { timeoutMs: 7200e3 }) }) };
    },
    async run(p) {
      const name = str(p.name, 'name', CID); const image = str(p.image, 'image', REF);
      const a = ['run', '-d', '--name', name];
      if (p.cpus !== undefined) a.push('--cpus', String(num(p.cpus, 'cpus', 0.1, 512)));
      if (p.memGB !== undefined) a.push('--memory', `${Math.round(num(p.memGB, 'memGB', 0.05, 4096) * 1024)}m`);
      for (const [k, v] of Object.entries(p.env || {})) { if (!RE.envName.test(k) || typeof v !== 'string' || v.includes('\0')) throw bad(`env ${k} is not valid`); a.push('-e', `${k}=${v}`); }
      for (const m of Array.isArray(p.mounts) ? p.mounts : []) { const h = absPath(m.host, 'mount.host'), c = absPath(m.container, 'mount.container'); a.push('-v', `${h}:${c}${m.ro ? ':ro' : ''}`); }
      for (const pt of Array.isArray(p.ports) ? p.ports : []) a.push('-p', str(String(pt), 'port', /^(\d{1,5}:)?\d{1,5}(\/(tcp|udp))?$|^127\.0\.0\.1:\d{1,5}:\d{1,5}$/));
      for (const [k, v] of Object.entries(p.labels || {})) { if (!/^[A-Za-z0-9._-]{1,100}$/.test(k) || typeof v !== 'string' || /[\0\n]/.test(v)) throw bad(`label ${k} is not valid`); a.push('--label', `${k}=${v}`); }
      a.push(image);
      if (Array.isArray(p.cmd)) a.push(...p.cmd.map(x => str(x, 'cmd', null, 20000))); else if (p.cmd) a.push('sh', '-c', str(p.cmd, 'cmd', null, 100000));
      const r = await dok(a, { timeoutMs: 120000 });
      return { id: r.stdout.trim().slice(0, 12), name };
    },
    async 'image-remove'(p) { await dok(['rmi', str(p.id, 'id', REF)]); return { ok: true }; },
    async 'volume-remove'(p) { await dok(['volume', 'rm', str(p.name, 'name', CID)]); return { ok: true }; },
    async prune(p) {
      if (p.confirm !== true) throw bad('confirm:true is required');
      const cmd = { images: ['image', 'prune', '-af'], containers: ['container', 'prune', '-f'], volumes: ['volume', 'prune', '-f'], builder: ['builder', 'prune', '-af'] }[p.what];
      if (!cmd) throw bad('what must be images, containers, volumes or builder');
      return { job: jobs.start({ role: 'containers', title: `prune ${p.what}`, run: c => c.exec(['docker', ...cmd], { timeoutMs: 3600e3 }) }) };
    },
  },
};
