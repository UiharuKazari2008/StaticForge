'use strict';
// vms: libvirt via virsh / virt-install / virt-clone (qemu:///system). A `virsh event` child pushes state changes.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { run, ok } = require('../lib/exec');
const { DATA, str, num, bool, RE, bad, absPath, readJson, writeJson, rid, sleep } = require('../lib/util');
const apt = require('../lib/apt');
const jobs = require('../lib/jobs');
const events = require('../lib/events');
const files = require('../lib/files');

const packages = ['libvirt-daemon-system', 'libvirt-clients', 'virtinst', 'qemu-system-x86', 'qemu-utils'];
const V = ['virsh', '-c', 'qemu:///system'];
const virsh = (args, o) => run([...V, ...args], { timeoutMs: 30000, ...o });
const vok = (args, o) => ok([...V, ...args], { timeoutMs: 30000, ...o });
const TAGS = path.join(DATA, 'vm-tags.json');
let tags = readJson(TAGS, {});
const GB = 2 ** 30;

const attr = (x, tag, a) => { const m = x.match(new RegExp(`<${tag}\\b[^>]*\\b${a}='([^']*)'`)); return m ? m[1] : null; };
const names = async () => (await virsh(['list', '--all', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
const vmName = n => str(n, 'name', RE.name);
async function mustExist(name) { if (!(await names()).includes(name)) throw bad('no such VM', 'NOT_FOUND'); }

// Map of disk source (path or /dev node) -> VM name for every defined domain.
async function diskSourcesInUse() {
  const m = new Map();
  for (const n of await names()) {
    const x = (await virsh(['dumpxml', n, '--inactive'])).stdout;
    for (const d of x.matchAll(/<disk\b[\s\S]*?<\/disk>/g)) { const s = attr(d[0], 'source', 'dev') || attr(d[0], 'source', 'file'); if (s) m.set(s, n); }
  }
  return m;
}

async function describe(name) {
  const [xml, info] = await Promise.all([virsh(['dumpxml', name]), virsh(['dominfo', name])]);
  const x = xml.stdout; const inf = {};
  for (const l of info.stdout.split('\n')) { const i = l.indexOf(':'); if (i > 0) inf[l.slice(0, i).trim()] = l.slice(i + 1).trim(); }
  const state = (inf.State || 'unknown').replace(/\s+/g, ' ');
  const sizes = {};
  const bi = await virsh(['domblkinfo', name, '--all']);
  for (const l of bi.stdout.split('\n')) { const f = l.trim().split(/\s+/); if (f.length >= 2 && /^\d+$/.test(f[1])) sizes[f[0]] = Number(f[1]); }
  const disks = [...x.matchAll(/<disk\b[^>]*device='disk'[\s\S]*?<\/disk>/g)].map(d => ({ target: attr(d[0], 'target', 'dev'), source: attr(d[0], 'source', 'dev') || attr(d[0], 'source', 'file') || attr(d[0], 'source', 'name'), sizeB: sizes[attr(d[0], 'target', 'dev')] ?? null }));
  const nics = [...x.matchAll(/<interface\b[\s\S]*?<\/interface>/g)].map(i => ({ mac: attr(i[0], 'mac', 'address'), network: attr(i[0], 'source', 'network') || attr(i[0], 'source', 'bridge'), ip: null }));
  if (state === 'running' && nics.length) {
    for (const src of ['agent', 'lease', 'arp']) {
      const r = await virsh(['domifaddr', name, '--source', src], { timeoutMs: 8000 });
      for (const l of r.stdout.split('\n')) { const f = l.trim().split(/\s+/); if (f[1] && /^[0-9a-f:]{17}$/i.test(f[1]) && f[3]) { const n = nics.find(z => z.mac && z.mac.toLowerCase() === f[1].toLowerCase()); if (n && !n.ip) n.ip = f[3].split('/')[0]; } }
      if (nics.every(n => n.ip)) break;
    }
  }
  const vnc = attr(x, 'graphics', 'port');
  return {
    name, uuid: inf.UUID || null, state, vcpus: Number(inf['CPU(s)']) || null, memMB: Math.round(Number((inf['Max memory'] || '').split(' ')[0]) / 1024) || null,
    autostart: inf.Autostart === 'enable', persistent: inf.Persistent === 'yes', disks, nics,
    vnc: vnc && vnc !== '-1' ? Number(vnc) : null, tags: tags[name] || {},
  };
}

async function pools() {
  const out = [];
  for (const n of (await virsh(['pool-list', '--all', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
    const i = (await virsh(['pool-info', n, '--bytes'])).stdout; const g = k => (i.match(new RegExp(`^${k}:\\s+(.*)$`, 'm')) || [])[1];
    out.push({ name: n, state: g('State'), autostart: g('Autostart') === 'yes', capacityB: Number(g('Capacity').split(' ')[0]), availableB: Number(g('Available').split(' ')[0]) });
  }
  return out;
}

// virsh event --loop: lifecycle events become `state` / `added` / `removed` pushes.
const runningSet = new Set();
const refreshRunning = async () => { runningSet.clear(); for (const n of (await virsh(['list', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean)) runningSet.add(n); };
let evChild = null, evBackoff = 2000;
function watch() {
  const c = spawn('virsh', [...V.slice(1), 'event', '--loop', '--all'], { stdio: ['ignore', 'pipe', 'ignore'] });
  evChild = c; let buf = '';
  c.on('error', () => {});
  c.stdout.on('data', d => {
    evBackoff = 2000; buf += d.toString('utf8'); let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const l = buf.slice(0, i); buf = buf.slice(i + 1);
      const m = l.match(/^event 'lifecycle' for domain '?([^':]+)'?(?: \(domain [^)]*\))?: (\w+) (\w+)/i) || l.match(/^event 'lifecycle' for domain ([^:]+): (\w+) (\w+)/);
      if (!m) continue;
      const [, name, ev] = m;
      if (ev === 'Started' || ev === 'Resumed') runningSet.add(name); else if (['Stopped', 'Shutdown', 'Crashed', 'Undefined', 'PMSuspended'].includes(ev)) runningSet.delete(name);
      if (ev === 'Defined') events.emit('vms', 'added', name, { name });
      else if (ev === 'Undefined') events.emit('vms', 'removed', name, { name });
      else virsh(['domstate', name]).then(r => events.emit('vms', 'state', name, { name, state: r.stdout.trim() || ev.toLowerCase() }));
    }
  });
  c.on('close', () => { evChild = null; setTimeout(watch, evBackoff = Math.min(evBackoff * 2, 60000)).unref(); });
}

async function waitIp(name, ctx, timeoutS) {
  for (let i = 0; i < timeoutS / 3; i++) {
    if (ctx.signal.aborted) throw new Error('cancelled');
    const d = await describe(name); const ip = d.nics.find(n => n.ip)?.ip; if (ip) return ip;
    await sleep(3000);
  }
  throw new Error('the VM got no address in time');
}

// Graceful: virsh shutdown each running VM, wait up to 3 min, destroy only VMs tagged disposable.
async function shutdownVms(log, dryRun) {
  const running = (await virsh(['list', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
  if (!running.length) { log('no running VMs'); return; }
  for (const n of running) { log(`${dryRun ? 'would shut down' : 'shutting down'} VM ${n}`); if (!dryRun) await virsh(['shutdown', n]); }
  if (dryRun) return;
  for (let i = 0; i < 60; i++) {
    const left = (await virsh(['list', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
    if (!left.length) { log('all VMs are off'); return; }
    await sleep(3000);
  }
  for (const n of (await virsh(['list', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
    if (tags[n]?.disposable || tags[n]?.purpose === 'disposable') { log(`destroying disposable VM ${n}`); await virsh(['destroy', n]); } else log(`VM ${n} did not stop in 3 min and is not tagged disposable: left to the host shutdown`);
  }
}

module.exports = {
  id: 'vms', packages, diskSourcesInUse,
  init() { watch(); refreshRunning().catch(() => {}); },
  count: () => runningSet.size,
  async busy() { return (await virsh(['list', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean).map(n => ({ kind: 'vm', id: n, why: 'running' })); },
  async shutdownAll(log, dryRun) { return shutdownVms(log, dryRun); },
  shutdown() { if (evChild) try { evChild.kill(); } catch { /* gone */ } },
  async detect() {
    const missing = await apt.missing(packages);
    const r = await virsh(['list', '--all', '--name']);
    const n = r.stdout.split('\n').filter(s => s.trim()).length;
    return { installed: !missing.length, ready: r.code === 0, summary: r.code === 0 ? `${n} VM(s)` : 'libvirt not answering', missing };
  },
  async get() {
    const ns = await names();
    const vms = await Promise.all(ns.map(describe));
    const nets = [];
    for (const n of (await virsh(['net-list', '--all', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
      const i = (await virsh(['net-info', n])).stdout;
      nets.push({ name: n, active: /Active:\s+yes/.test(i), autostart: /Autostart:\s+yes/.test(i), bridge: (i.match(/Bridge:\s+(\S+)/) || [])[1] || null });
    }
    return { vms, networks: nets, pools: await pools(), templates: vms.filter(v => v.tags.template).map(v => ({ name: v.name, template: v.tags.template })) };
  },
  actions: {
    ...Object.fromEntries([['start', 'start'], ['shutdown', 'shutdown'], ['reboot', 'reboot'], ['destroy', 'destroy'], ['suspend', 'suspend'], ['resume', 'resume']].map(([a, verb]) => [a, async p => {
      const name = vmName(p.name); await mustExist(name); await vok([verb, name]); return { ok: true };
    }])),
    async create(p) {
      const name = vmName(p.name); const vcpus = num(p.vcpus, 'vcpus', 1, 240, 2), memMB = num(p.memMB, 'memMB', 64, 4194304, 2048), diskGB = num(p.diskGB, 'diskGB', 0.1, 20000, 20);
      if ((await names()).includes(name)) throw bad('a VM with that name exists', 'EXISTS');
      const poolList = await pools();
      const pool = p.pool ? str(p.pool, 'pool', RE.name) : (diskGB <= 100 && poolList.find(x => x.name === 'ssd') ? 'ssd' : (poolList.find(x => x.name === 'hdd') ? 'hdd' : poolList[0]?.name));
      if (!poolList.some(x => x.name === pool)) throw bad('no such storage pool', 'NOT_FOUND');
      const network = p.network ? str(p.network, 'network', RE.name) : 'br0';
      const iso = p.iso ? absPath(p.iso, 'iso') : null;
      if (iso && !fs.existsSync(iso)) { const alt = await run(['test', '-f', iso]); if (alt.code !== 0) throw bad('iso not found on the host'); }
      const osVariant = p.osVariant ? str(p.osVariant, 'osVariant', /^[a-z0-9._-]{1,60}$/) : null;
      return { job: jobs.start({ role: 'vms', title: `create VM ${name}`, run: async c => {
        const vol = `${name}.img`;
        await c.exec([...V, 'vol-create-as', pool, vol, `${Math.round(diskGB * 1024)}M`, '--format', 'raw']);
        const vpath = (await virsh(['vol-path', '--pool', pool, vol])).stdout.trim();
        const args = ['virt-install', '--connect', 'qemu:///system', '--name', name, '--vcpus', String(vcpus), '--memory', String(memMB), '--disk', `path=${vpath},bus=virtio`,
          '--network', `network=${network}`, '--graphics', 'vnc,listen=127.0.0.1', '--noautoconsole', '--osinfo', osVariant ? `name=${osVariant}` : 'detect=on,require=off'];
        if (iso) args.push('--cdrom', iso); else args.push('--import');
        try { await c.exec(args, { timeoutMs: 600e3 }); } catch (e) { await run([...V, 'vol-delete', vol, '--pool', pool]); throw e; }
        events.emit('vms', 'added', name, { name });
      } }) };
    },
    async clone(p) {
      const source = vmName(p.source), name = vmName(p.name); await mustExist(source);
      if ((await names()).includes(name)) throw bad('a VM with that name exists', 'EXISTS');
      return { job: jobs.start({ role: 'vms', title: `clone ${source} -> ${name}`, run: async c => { await c.exec(['virt-clone', '--connect', 'qemu:///system', '--original', source, '--name', name, '--auto-clone'], { timeoutMs: 3600e3 }); events.emit('vms', 'added', name, { name }); } }) };
    },
    async delete(p) {
      const name = vmName(p.name); await mustExist(name);
      const st = (await virsh(['domstate', name])).stdout.trim();
      if (st !== 'shut off') { if (p.force === true) await vok(['destroy', name]); else throw bad('the VM is not shut off (destroy it first, or pass force:true)', 'IN_USE'); }
      await vok(['undefine', name, '--nvram', '--managed-save', '--snapshots-metadata', ...(bool(p.storage, false) ? ['--remove-all-storage'] : [])], { timeoutMs: 120000 });
      delete tags[name]; writeJson(TAGS, tags);
      events.emit('vms', 'removed', name, { name });
      return { ok: true };
    },
    async set(p) {
      const name = vmName(p.name); await mustExist(name);
      if (p.vcpus !== undefined) { const n = String(num(p.vcpus, 'vcpus', 1, 240)); await vok(['setvcpus', name, n, '--config', '--maximum']); await vok(['setvcpus', name, n, '--config']); }
      if (p.memMB !== undefined) { const k = String(Math.round(num(p.memMB, 'memMB', 64, 4194304) * 1024)); await vok(['setmaxmem', name, k, '--config']); await vok(['setmem', name, k, '--config']); }
      if (p.autostart !== undefined) await vok(['autostart', name, ...(bool(p.autostart, false) ? [] : ['--disable'])]);
      events.emit('vms', 'state', name, { name });
      return { ok: true };
    },
    async tag(p) {
      const name = vmName(p.name); await mustExist(name);
      const t = { ...(tags[name] || {}) };
      for (const k of ['purpose', 'branch', 'template', 'disposable']) if (p.tags && k in p.tags) { if (p.tags[k] === null || p.tags[k] === '') delete t[k]; else t[k] = str(p.tags[k], k, /^[A-Za-z0-9._\/-]{1,100}$/); }
      if (Object.keys(t).length) tags[name] = t; else delete tags[name];
      writeJson(TAGS, tags); events.emit('vms', 'state', name, { name, tags: t });
      return { tags: t };
    },
    async snapshots(p) {
      const name = vmName(p.name); await mustExist(name);
      const r = await virsh(['snapshot-list', name]);
      const snaps = r.stdout.split('\n').slice(2).filter(l => l.trim()).map(l => { const f = l.trim().split(/\s+/); return { name: f[0], created: `${f[1]} ${f[2]} ${f[3]}`, state: f[4] }; });
      return { snapshots: snaps };
    },
    async snapshot(p) {
      const name = vmName(p.name), snap = str(p.snap, 'snap', RE.name); await mustExist(name);
      const v = { create: ['snapshot-create-as', name, snap], revert: ['snapshot-revert', name, snap], delete: ['snapshot-delete', name, snap] }[p.op];
      if (!v) throw bad('op must be create, revert or delete');
      await vok(v, { timeoutMs: 300000 }); events.emit('vms', 'state', name, { name, snapshot: snap, op: p.op });
      return { ok: true };
    },
    async screenshot(p) {
      const name = vmName(p.name); await mustExist(name);
      const raw = files.newPath('shots', `vm-${name}`, 'ppm');
      const r = await vok(['screenshot', name, raw.abs]);
      if (/image\/png/.test(r.stdout)) { const png = files.newPath('shots', `vm-${name}`, 'png'); fs.renameSync(raw.abs, png.abs); return { file: png.file }; }
      const png = files.newPath('shots', `vm-${name}`, 'png');
      const cv = await run(['python3', '-I', '-c', PPM2PNG, raw.abs, png.abs]);
      if (cv.code !== 0) return { file: raw.file, note: 'raw PPM (conversion failed)' };
      fs.unlinkSync(raw.abs); return { file: png.file };
    },
    // Clones the template (tag template=dreamscape, or `from`), boots the clone, checks `branch` out over ssh when a key is installed.
    async dsclone(p) {
      const name = vmName(p.name); const branch = p.branch ? str(p.branch, 'branch', /^[A-Za-z0-9._\/-]{1,100}$/) : null;
      const from = p.from ? vmName(p.from) : Object.keys(tags).find(k => tags[k].template === 'dreamscape');
      if (!from) throw bad('no template VM (tag one with template=dreamscape, or pass from)', 'NOT_FOUND');
      await mustExist(from);
      if ((await names()).includes(name)) throw bad('a VM with that name exists', 'EXISTS');
      return { job: jobs.start({ role: 'vms', title: `ds-clone ${name} from ${from}`, run: async c => {
        await c.exec(['virt-clone', '--connect', 'qemu:///system', '--original', from, '--name', name, '--auto-clone'], { timeoutMs: 3600e3 });
        tags[name] = { purpose: 'ds-clone', ...(branch ? { branch } : {}) }; writeJson(TAGS, tags);
        await c.exec([...V, 'start', name]);
        events.emit('vms', 'added', name, { name });
        const key = path.join(DATA, 'ssh', 'id_ed25519');
        if (branch && fs.existsSync(key)) {
          const ip = await waitIp(name, c, 240); c.log(`address ${ip}`);
          await c.exec(['ssh', '-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'UserKnownHostsFile=/dev/null', '-o', 'ConnectTimeout=15', `rack@${ip}`, `cd ~/staticforge && git fetch origin ${branch} && git checkout ${branch}`], { timeoutMs: 300e3 });
        } else if (branch) c.log(`branch ${branch} noted in the tags; no ssh key at ${key}, nothing checked out`);
      } }) };
    },
  },
};
const PPM2PNG = `
import sys, zlib, struct
d = open(sys.argv[1], 'rb').read()
parts = d.split(None, 4)
w, h = int(parts[1]), int(parts[2]); px = d[len(d) - w * h * 3:]
raw = b''.join(b'\\x00' + px[y * w * 3:(y + 1) * w * 3] for y in range(h))
def ch(t, b): c = struct.pack('>I', len(b)) + t + b; return c + struct.pack('>I', zlib.crc32(t + b) & 0xffffffff)
open(sys.argv[2], 'wb').write(b'\\x89PNG\\r\\n\\x1a\\n' + ch(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + ch(b'IDAT', zlib.compress(raw)) + ch(b'IEND', b''))
`;
