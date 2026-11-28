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
const X = require('../lib/vmx');

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
// Linked clones (tag cloneof=<template>) read the template's disk as a backing file: the template must stay untouched while any exist.
async function cloneNamesOf(template) { const have = new Set(await names()); return Object.keys(tags).filter(k => tags[k].cloneof === template && have.has(k)); }
async function guardTemplate(name, what) {
  if (!tags[name]?.template) return;
  const c = await cloneNamesOf(name);
  if (c.length) throw bad(`${name} is a template with linked clones (${c.join(', ')}): ${what} would change the disk they are built on; delete the clones first`, 'IN_USE');
}
const randMac = () => '52:54:00:' + [0, 0, 0].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':');

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
  const dl = X.disks(x);
  const disks = dl.filter(d => d.device === 'disk').map(d => ({ target: d.target, bus: d.bus, format: d.format, source: d.source, sizeB: sizes[d.target] ?? null }));
  const cdroms = dl.filter(d => d.device === 'cdrom').map(d => ({ target: d.target, bus: d.bus, source: d.source }));
  const nics = [...x.matchAll(/<interface\b[\s\S]*?<\/interface>/g)].map(i => ({ mac: attr(i[0], 'mac', 'address'), network: attr(i[0], 'source', 'network') || attr(i[0], 'source', 'bridge'), model: attr(i[0], 'model', 'type'), ip: null }));
  if (state === 'running' && nics.length) {
    for (const src of ['agent', 'lease', 'arp']) {
      const r = await virsh(['domifaddr', name, '--source', src], { timeoutMs: 8000 });
      for (const l of r.stdout.split('\n')) { const f = l.trim().split(/\s+/); if (f[1] && /^[0-9a-f:]{17}$/i.test(f[1]) && f[3]) { const n = nics.find(z => z.mac && z.mac.toLowerCase() === f[1].toLowerCase()); if (n && !n.ip) n.ip = f[3].split('/')[0]; } }
      if (nics.every(n => n.ip)) break;
    }
  }
  const vnc = attr(x, 'graphics', 'port');
  const kb = tag => Math.round(Number((x.match(new RegExp(`<${tag}\\b[^>]*>(\\d+)<`)) || [])[1]) / 1024) || null;
  const cpuEl = (x.match(/<cpu\b[^>]*\/>|<cpu\b[\s\S]*?<\/cpu>/) || [''])[0];
  const cpuModel = /mode='host-passthrough'/.test(cpuEl) ? 'host-passthrough' : /mode='host-model'/.test(cpuEl) ? 'host-model' : ((cpuEl.match(/<model\b[^>]*>([^<]+)<\/model>/) || [])[1] || null);
  const uefi = /<os\b[^>]*firmware='efi'/.test(x) || /<loader\b[^>]*type='pflash'/.test(x);
  const boot = [...x.matchAll(/<(disk|interface)\b[\s\S]*?<\/\1>/g)].map(m => { const o = (m[0].match(/<boot order='(\d+)'/) || [])[1]; return o ? { o: Number(o), k: m[1] === 'interface' ? 'network' : attr(m[0], m[1], 'device') } : null; }).filter(Boolean).sort((a, b) => a.o - b.o).map(b => b.k);
  const out = {
    name, uuid: inf.UUID || null, state, vcpus: Number(inf['CPU(s)']) || null, memMB: kb('currentMemory') || Math.round(Number((inf['Max memory'] || '').split(' ')[0]) / 1024) || null, memMaxMB: kb('memory'),
    dynamicMemory: !!(kb('currentMemory') && kb('memory') && kb('currentMemory') < kb('memory')),
    autostart: inf.Autostart === 'enable', persistent: inf.Persistent === 'yes', saved: /Managed save:\s+yes/.test(info.stdout), disks, cdroms, nics,
    vnc: vnc && vnc !== '-1' ? Number(vnc) : null, tags: tags[name] || {},
    firmware: { generation: uefi ? 2 : 1, uefi, secureBoot: /<loader\b[^>]*secure='yes'/.test(x) || /<feature enabled='yes' name='secure-boot'/.test(x), tpm: /<tpm\b/.test(x), boot },
    cpuModel, agentChannel: /org\.qemu\.guest_agent\.0/.test(x), stopAction: (tags[name] && tags[name].stopAction) || 'shutdown',
    vmAgent: !!(hv.agents()[name] && hv.agentToken(name)),
  };
  const st = hv.statsCache.get(name);
  if (st && state === 'running') { out.cpu = st.cpu; out.uptimeS = st.uptimeS ?? null; if (st.memMB) out.assignedMB = st.memMB; }
  out.manageable = await hv.manageability(out, x);
  return out;
}

let hv; // the Hyper-V half (lib/vmhv.js), built after the helpers below exist

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

// Graceful: each running VM gets its automatic stop action (tag stopAction: shutdown (default) | save | off), waits up to 3 min for the shutdowns,
// destroys only VMs tagged disposable.
async function shutdownVms(log, dryRun) {
  const running = (await virsh(['list', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
  if (!running.length) { log('no running VMs'); return; }
  for (const n of running) {
    const act = tags[n]?.stopAction || 'shutdown';
    log(`${dryRun ? 'would ' : ''}${act === 'save' ? 'save' : act === 'off' ? 'turn off' : 'shut down'} VM ${n}`);
    if (dryRun) continue;
    if (act === 'save') { const r = await virsh(['managedsave', n], { timeoutMs: 600000 }); if (r.code !== 0) { log(`saving ${n} failed (${r.stderr.trim().split('\n').pop()}): shutting it down`); await virsh(['shutdown', n]); } }
    else if (act === 'off') await virsh(['destroy', n]); else await virsh(['shutdown', n]);
  }
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

hv = require('../lib/vmhv')({ virsh, vok, tags, saveTags: () => writeJson(TAGS, tags), names, mustExist, guardTemplate, describe, diskSourcesInUse, V, get PPM2PNG() { return PPM2PNG; } });

module.exports = {
  id: 'vms', packages, diskSourcesInUse, vncPort: n => hv.vncPort(n),
  init() { watch(); refreshRunning().catch(() => {}); },
  count: () => runningSet.size,
  async busy() { return (await virsh(['list', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean).map(n => ({ kind: 'vm', id: n, why: 'running' })); },
  async shutdownAll(log, dryRun) { return shutdownVms(log, dryRun); },
  shutdown() { if (evChild) try { evChild.kill(); } catch { /* gone */ } },
  async detect() {
    const missing = await apt.missing(packages);
    const r = await virsh(['list', '--all', '--name']);
    const n = r.stdout.split('\n').filter(s => s.trim()).length;
    const all = r.stdout.split('\n').map(x => x.trim()).filter(Boolean);
    const unmanaged = all.filter(x => !tags[x]?.managed);
    return { installed: !missing.length, ready: r.code === 0, summary: r.code === 0 ? `${n} VM(s)${unmanaged.length ? `, ${unmanaged.length} unmanaged (${unmanaged.join(', ')}: no agent control, adopt them)` : ''}` : 'libvirt not answering', missing, unmanaged };
  },
  async get() {
    const ns = await names();
    if (Date.now() - hv.statAt() > 12000) { try { await hv.sampleStats(); } catch { /* libvirt busy */ } }
    const vms = await Promise.all(ns.map(describe));
    const nets = [];
    for (const n of (await virsh(['net-list', '--all', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
      const i = (await virsh(['net-info', n])).stdout;
      nets.push({ name: n, active: /Active:\s+yes/.test(i), autostart: /Autostart:\s+yes/.test(i), bridge: (i.match(/Bridge:\s+(\S+)/) || [])[1] || null });
    }
    return { vms, networks: nets, pools: await pools(), unmanaged: vms.filter(v => !v.manageable.ok).map(v => ({ name: v.name, managed: v.manageable.managed, missing: v.manageable.missing })), templates: vms.filter(v => v.tags.template).map(v => ({ name: v.name, template: v.tags.template })) };
  },
  actions: {
    ...hv.actions,
    ...Object.fromEntries([['start', 'start'], ['shutdown', 'shutdown'], ['reboot', 'reboot'], ['destroy', 'destroy'], ['suspend', 'suspend'], ['resume', 'resume'], ['reset', 'reset']].map(([a, verb]) => [a, async p => {
      const name = vmName(p.name); await mustExist(name); if (verb === 'start') await guardTemplate(name, 'starting it');
      const wasSaved = verb === 'start' && /Managed save:\s+yes/.test((await virsh(['dominfo', name])).stdout);
      await vok([verb, name]);
      if (wasSaved && (await virsh(['domstate', name])).stdout.trim() === 'paused') await vok(['resume', name]); // Save + Start continue running, as Hyper-V does
      return { ok: true };
    }])),
    // create {name, vcpus?, memMB?, memMaxMB?, generation?:1|2, secureBoot?, tpm?, cpuModel?, diskMode?:'new'|'existing'|'none', diskGB?, volume? (existing disk path), pool? (a LVM pool makes a raw volume; default: qcow2 file in the directory pool),
    //         bus?:'virtio'|'scsi'|'sata', iso?, network?, guest?:'windows'|'linux'|'other', purpose?, start?:true}
    // Every VM gets VNC on 127.0.0.1, the guest agent channel, a serial log and a tablet (vmx.ensureDevices) and is tagged managed.
    async create(p) {
      const name = vmName(p.name); const vcpus = num(p.vcpus, 'vcpus', 1, 240, 2), memMB = num(p.memMB, 'memMB', 64, 4194304, 2048);
      const memMaxMB = p.memMaxMB !== undefined ? num(p.memMaxMB, 'memMaxMB', memMB, 4194304) : memMB;
      const diskMode = p.diskMode || (p.diskGB === 0 ? 'none' : 'new'); const diskGB = diskMode === 'new' ? num(p.diskGB, 'diskGB', 0.1, 20000, 20) : 0;
      if ((await names()).includes(name)) throw bad('a VM with that name exists', 'EXISTS');
      const bus = p.bus ? str(p.bus, 'bus', /^(virtio|scsi|sata)$/) : 'virtio';
      const uefi = p.generation === 2 || p.generation === '2' || p.uefi === true; const guest = p.guest ? str(p.guest, 'guest', /^(windows|linux|other)$/) : undefined;
      const poolList = await pools();
      const logical = p.pool && (await vok(['pool-dumpxml', str(p.pool, 'pool', RE.name)])).stdout.match(/<pool type='(\w+)'/)?.[1] === 'logical';
      if (p.pool && !poolList.some(x => x.name === p.pool)) throw bad('no such storage pool', 'NOT_FOUND');
      const nets = (await virsh(['net-list', '--all', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
      const network = p.network === null || p.network === 'none' ? null : p.network ? str(p.network, 'network', RE.name) : 'br0';
      const iso = p.iso ? absPath(p.iso, 'iso') : '';
      if (iso && (await run(['test', '-f', iso])).code !== 0) throw bad('iso not found on the host');
      let existing = null; if (diskMode === 'existing') { existing = absPath(p.volume, 'volume'); if ((await run(['test', '-e', existing])).code !== 0) throw bad('that disk does not exist', 'NOT_FOUND'); if ((await diskSourcesInUse()).has(existing)) throw bad('that disk is in use by another VM', 'IN_USE'); }
      const dp = !logical && diskMode === 'new' ? (p.pool ? { name: p.pool, path: await hv.poolPath(p.pool) } : await hv.dirPool()) : null;
      return { job: jobs.start({ role: 'vms', title: `create VM ${name}`, run: async c => {
        let vpath = null, format = 'qcow2', made = null;
        try {
          if (diskMode === 'new') {
            if (logical) { await c.exec([...V, 'vol-create-as', p.pool, `${name}.img`, `${Math.round(diskGB * 1024)}M`, '--format', 'raw']); vpath = (await virsh(['vol-path', '--pool', p.pool, `${name}.img`])).stdout.trim(); format = 'raw'; made = () => run([...V, 'vol-delete', `${name}.img`, '--pool', p.pool]); }
            else { vpath = path.join(dp.path, `${name}.qcow2`); await c.exec(['qemu-img', 'create', '-q', '-f', 'qcow2', vpath, `${Math.round(diskGB * 1024)}M`]); await hv.chown(vpath); made = () => fs.rmSync(vpath, { force: true }); }
          } else if (existing) { vpath = existing; format = JSON.parse((await ok(['qemu-img', 'info', '--output=json', existing])).stdout).format === 'qcow2' ? 'qcow2' : 'raw'; }
          const isBridge = !!network && !nets.includes(network);
          const xml = X.buildXml({ name, vcpus, memMB, maxMemMB: memMaxMB, uefi, secureBoot: bool(p.secureBoot, false), tpm: bool(p.tpm, false), cpuModel: p.cpuModel ? str(p.cpuModel, 'cpuModel', /^[A-Za-z0-9._-]{1,60}$/) : undefined,
            disks: vpath ? [{ path: vpath, bus, format }] : [], iso, network, isBridge, guest });
          fs.mkdirSync(X.LOG_DIR, { recursive: true }); fs.chmodSync(X.LOG_DIR, 0o755);
          await hv.defineXml(xml, name);
        } catch (e) { if (made) await made(); throw e; }
        tags[name] = { managed: 'true', ...(guest ? { guest } : {}), ...(p.purpose ? { purpose: str(p.purpose, 'purpose', /^[A-Za-z0-9._\/-]{1,100}$/) } : {}) }; writeJson(TAGS, tags);
        events.emit('vms', 'added', name, { name });
        if (bool(p.start, true)) await c.exec([...V, 'start', name]);
      } }) };
    },
    async clone(p) {
      const source = vmName(p.source), name = vmName(p.name); await mustExist(source);
      if ((await names()).includes(name)) throw bad('a VM with that name exists', 'EXISTS');
      return { job: jobs.start({ role: 'vms', title: `clone ${source} -> ${name}`, run: async c => { await c.exec(['virt-clone', '--connect', 'qemu:///system', '--original', source, '--name', name, '--auto-clone'], { timeoutMs: 3600e3 }); await hv.ensureManageable(name, { guest: tags[source]?.guest }); events.emit('vms', 'added', name, { name }); } }) };
    },
    async delete(p) {
      const name = vmName(p.name); await mustExist(name);
      await guardTemplate(name, 'deleting it');
      const st = (await virsh(['domstate', name])).stdout.trim();
      if (st !== 'shut off') { if (p.force === true) await vok(['destroy', name]); else throw bad('the VM is not shut off (destroy it first, or pass force:true)', 'IN_USE'); }
      const files0 = bool(p.storage, false) ? X.disks((await vok(['dumpxml', name, '--inactive'])).stdout).filter(d => d.type === 'file' && d.source && d.device === 'disk').map(d => d.source) : [];
      await vok(['undefine', name, '--nvram', '--managed-save', '--snapshots-metadata', '--tpm', ...(bool(p.storage, false) ? ['--remove-all-storage'] : [])], { timeoutMs: 120000 });
      for (const f of files0) if (f.startsWith('/srv/rack/') && fs.existsSync(f)) fs.rmSync(f, { force: true }); // file disks in directory pools that libvirt left behind
      delete tags[name]; writeJson(TAGS, tags); fs.rmSync(X.logPath(name), { force: true });
      events.emit('vms', 'removed', name, { name });
      return { ok: true };
    },
    async tag(p) {
      const name = vmName(p.name); await mustExist(name);
      const t = { ...(tags[name] || {}) };
      for (const k of ['purpose', 'branch', 'template', 'disposable', 'cloneof']) if (p.tags && k in p.tags) { if (p.tags[k] === null || p.tags[k] === '') delete t[k]; else t[k] = str(p.tags[k], k, /^[A-Za-z0-9._\/-]{1,100}$/); }
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
      await guardTemplate(name, `snapshot ${p.op}`);
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
    // linked-clone {source, name, memMB?, vcpus?, start?:true, waitIpS?}: qcow2 overlay on the template's disk (backing file, no copy), own NVRAM copy,
    // copy of the template's TPM state (libvirt keeps it per UUID), new UUID and MACs. Tagged disposable, purpose=windows-test (windows11 templates).
    // The source must be shut off and tagged template=...; it is locked (start, snapshot, delete refused) while clones exist.
    async 'linked-clone'(p) {
      const source = vmName(p.source), name = vmName(p.name); await mustExist(source);
      const tpl = tags[source]?.template; if (!tpl) throw bad('the source is not tagged template=...', 'NOT_TEMPLATE');
      if ((await names()).includes(name)) throw bad('a VM with that name exists', 'EXISTS');
      if ((await virsh(['domstate', source])).stdout.trim() !== 'shut off') throw bad('the template is running (shut it down first)', 'IN_USE');
      const vcpus = p.vcpus !== undefined ? num(p.vcpus, 'vcpus', 1, 240) : null, memMB = p.memMB !== undefined ? num(p.memMB, 'memMB', 256, 4194304) : null;
      let xml = (await vok(['dumpxml', source, '--inactive'])).stdout;
      const t0 = Date.now();
      const disk = [...xml.matchAll(/<disk\b[^>]*device='disk'[\s\S]*?<\/disk>/g)].map(d => d[0])[0];
      const base = disk && attr(disk, 'source', 'file'); if (!base) throw bad('the template has no file disk', 'BAD_TEMPLATE');
      const overlay = path.join(path.dirname(base), `${name}.qcow2`);
      if (fs.existsSync(overlay)) throw bad('the overlay file exists already', 'EXISTS');
      await ok(['qemu-img', 'create', '-f', 'qcow2', '-F', 'qcow2', '-b', base, overlay], { timeoutMs: 60000 });
      try {
        xml = xml.replace(/<name>[^<]*<\/name>/, `<name>${name}</name>`).replace(/<uuid>[^<]*<\/uuid>\s*/, '');
        xml = xml.split(base).join(overlay);
        xml = xml.replace(/<mac address='[^']*'\/>/g, () => `<mac address='${randMac()}'/>`);
        xml = xml.replace(/(<disk\b[^>]*device='cdrom'[\s\S]*?)<source\b[^>]*\/>\s*/g, '$1');
        if (vcpus) xml = xml.replace(/<vcpu\b([^>]*)>\d+<\/vcpu>/, `<vcpu$1>${vcpus}</vcpu>`);
        if (memMB) xml = xml.replace(/<memory\b([^>]*)>\d+<\/memory>/, `<memory$1>${memMB * 1024}</memory>`).replace(/<currentMemory\b([^>]*)>\d+<\/currentMemory>/, `<currentMemory$1>${memMB * 1024}</currentMemory>`);
        const nv = xml.match(/<nvram\b[^>]*>([^<]+)<\/nvram>/);
        if (nv) { const dst = path.join(path.dirname(nv[1]), `${name}_VARS.fd`); fs.copyFileSync(nv[1], dst); xml = xml.replace(nv[1], dst); }
        xml = X.ensureDevices(xml, name).xml;
        const xf = path.join(DATA, `linked-${name}.xml`); fs.writeFileSync(xf, xml);
        try { await vok(['define', xf]); } finally { fs.rmSync(xf, { force: true }); }
        if (/<tpm\b/.test(xml)) {
          const su = t => (t.match(/<uuid>([^<]+)<\/uuid>/) || [])[1];
          const srcU = su((await vok(['dumpxml', source, '--inactive'])).stdout), newU = su((await vok(['dumpxml', name, '--inactive'])).stdout);
          const sd = `/var/lib/libvirt/swtpm/${srcU}`, dd = `/var/lib/libvirt/swtpm/${newU}`;
          if (fs.existsSync(sd) && !fs.existsSync(dd)) await ok(['cp', '-a', sd, dd]);
        }
      } catch (e) { await run([...V, 'undefine', name, '--nvram', '--tpm']); fs.rmSync(overlay, { force: true }); throw e; }
      tags[name] = { purpose: p.purpose ? str(p.purpose, 'purpose', /^[A-Za-z0-9._\/-]{1,100}$/) : (tpl === 'windows11' ? 'windows-test' : 'linked-clone'), disposable: 'true', cloneof: source, managed: 'true', ...(tags[source]?.guest ? { guest: tags[source].guest } : {}) };
      writeJson(TAGS, tags);
      events.emit('vms', 'added', name, { name });
      if (p.start !== false) await vok(['start', name]);
      let ip = null;
      const waitS = p.start !== false && p.waitIpS ? num(p.waitIpS, 'waitIpS', 1, 300) : 0;
      for (let i = 0; i < waitS / 2; i++) { ip = (await describe(name)).nics.find(n => n.ip)?.ip || null; if (ip) break; await sleep(2000); }
      return { name, source, overlay, started: p.start !== false, ip, ms: Date.now() - t0, tags: tags[name] };
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
        await hv.ensureManageable(name, { guest: 'linux' });
        tags[name] = { ...tags[name], purpose: 'ds-clone', ...(branch ? { branch } : {}) }; writeJson(TAGS, tags);
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
