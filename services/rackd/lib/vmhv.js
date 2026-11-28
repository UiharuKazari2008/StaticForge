'use strict';
// vmhv: the Hyper-V-Manager-equivalent half of the vms role: settings, checkpoints, save, export / import / move, ISO pool, live stats and
// screen thumbnails (pushed only while someone is subscribed), input and exec without the network (QMP, QEMU guest agent), the in-guest agent.
// Split from roles/vms.js; h = the vms role's shared helpers.
const fs = require('fs');
const path = require('path');
const http = require('http');
const net = require('net');
const { run, ok } = require('./exec');
const { DATA, str, num, bool, RE, bad, absPath, readJson, writeJson, rid, sleep, RackError } = require('./util');
const X = require('./vmx');
const events = require('./events');
const jobs = require('./jobs');
const files = require('./files');

const EXPORT_ROOT = '/srv/rack/vm-exports';
const ISO_DIR = '/var/lib/libvirt/images/iso';
const SECRETS = '/etc/rackd/secrets/vm-agent';
const AGENTS = path.join(DATA, 'vm-agents.json');
const QEMU_USER = 'libvirt-qemu';
const attr = X.attr;
const GiB = 2 ** 30;
const SAFE = /^[A-Za-z0-9._\/-]{1,100}$/;

module.exports = function build(h) {
  const { virsh, vok, tags, saveTags, names, mustExist, guardTemplate } = h;
  const state = async n => (await virsh(['domstate', n])).stdout.trim();
  const needOff = async (n, what) => { if ((await state(n)) !== 'shut off') throw bad(`${what}: turn the virtual machine off first`, 'NEEDS_OFF'); };
  const inactiveXml = async n => (await vok(['dumpxml', n, '--inactive'])).stdout;
  const liveXml = async n => (await vok(['dumpxml', n])).stdout;
  const touch = (name, extra) => events.emit('vms', 'state', name, Object.assign({ name }, extra || {}));

  async function defineXml(xml, label) {
    const f = path.join(DATA, `def-${label}-${rid(3)}.xml`);
    fs.writeFileSync(f, xml);
    try { await vok(['define', f]); } finally { fs.rmSync(f, { force: true }); }
  }
  /** Edits the persistent definition: fn(xml) -> xml. needOffWhy: refuse unless the VM is off. */
  async function edit(name, fn, needOffWhy) {
    if (needOffWhy) await needOff(name, needOffWhy);
    const xml = await inactiveXml(name);
    const out = await fn(xml);
    if (out === xml) return false;
    await defineXml(out, name);
    return true;
  }
  const poolPath = async pool => (await vok(['pool-dumpxml', pool])).stdout.match(/<path>([^<]+)<\/path>/)?.[1] || null;
  async function dirPool() {
    const out = (await virsh(['pool-list', '--all', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
    for (const pref of ['vmfiles', ...out]) {
      if (!out.includes(pref)) continue;
      const x = (await virsh(['pool-dumpxml', pref])).stdout;
      if (/<pool type='dir'/.test(x) && pref !== 'iso') return { name: pref, path: x.match(/<path>([^<]+)<\/path>/)?.[1] };
    }
    throw bad('no directory storage pool for disk files', 'NO_POOL');
  }
  const chown = async (...ps) => { const keep = ps.filter(p => p && p.startsWith('/srv/rack/')); if (keep.length) await run(['chown', `${QEMU_USER}:${QEMU_USER}`, ...keep]); };
  const q = s => JSON.stringify(s);

  // ---- guest agent + QMP -------------------------------------------------------------------------------------
  async function qga(name, cmd, args, timeoutS) {
    const r = await virsh(['qemu-agent-command', name, '--timeout', String(timeoutS || 5), q({ execute: cmd, ...(args ? { arguments: args } : {}) })], { timeoutMs: ((timeoutS || 5) + 5) * 1000 });
    if (r.code !== 0) throw bad(`guest agent: ${(r.stderr || r.stdout).trim().split('\n').pop()}`, 'NO_AGENT');
    try { return JSON.parse(r.stdout).return; } catch { throw bad('guest agent answered something unreadable', 'NO_AGENT'); }
  }
  async function qmp(name, cmd, args) {
    const r = await virsh(['qemu-monitor-command', name, q({ execute: cmd, ...(args ? { arguments: args } : {}) })], { timeoutMs: 15000 });
    if (r.code !== 0) throw bad(`monitor: ${(r.stderr || r.stdout).trim().split('\n').pop()}`);
    let j; try { j = JSON.parse(r.stdout); } catch { throw bad('monitor answered something unreadable'); }
    if (j.error) throw bad(`monitor: ${j.error.desc}`);
    return j.return;
  }
  const pingCache = new Map();
  async function guestPing(name) {
    const c = pingCache.get(name);
    if (c && Date.now() - c.at < 15000) return c.ok;
    const r = await virsh(['qemu-agent-command', name, '--timeout', '2', '{"execute":"guest-ping"}'], { timeoutMs: 6000 });
    const okp = r.code === 0;
    pingCache.set(name, { at: Date.now(), ok: okp });
    return okp;
  }
  const osCache = new Map();
  async function isWindows(name) {
    if (tags[name]?.guest) return tags[name].guest === 'windows';
    if (osCache.has(name)) return osCache.get(name);
    try { const o = await qga(name, 'guest-get-osinfo', null, 4); const w = o.id === 'mswindows'; osCache.set(name, w); return w; } catch { return false; }
  }

  // ---- screens -----------------------------------------------------------------------------------------------
  const dims = new Map(); // name -> { w, h, at }
  function pngSize(file) { try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(24); fs.readSync(fd, b, 0, 24, 0); fs.closeSync(fd); if (b.toString('latin1', 1, 4) === 'PNG') return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) }; } catch { /* none */ } return null; }
  /** One frame of the VM's screen as a PNG at destAbs. Resolves { w, h }. */
  async function grab(name, destAbs) {
    const raw = `${destAbs}.${rid(2)}.raw`;
    const r = await vok(['screenshot', name, raw]);
    let png = destAbs;
    if (/image\/png/.test(r.stdout)) fs.renameSync(raw, destAbs);
    else {
      const cv = await run(['python3', '-I', '-c', h.PPM2PNG, raw, destAbs + '.tmp.png']);
      fs.rmSync(raw, { force: true });
      if (cv.code !== 0) throw bad('screenshot conversion failed');
      fs.renameSync(destAbs + '.tmp.png', destAbs);
    }
    const d = pngSize(png); if (d) dims.set(name, { ...d, at: Date.now() });
    return d || { w: 0, h: 0 };
  }
  async function screenSize(name, force) {
    const d = dims.get(name);
    if (d && !force && Date.now() - d.at < 20000) return d;
    const tmp = path.join(DATA, `dim-${name}-${rid(2)}.png`);
    try { await grab(name, tmp); } finally { fs.rmSync(tmp, { force: true }); }
    return dims.get(name) || { w: 1024, h: 768 };
  }

  // screens feed: while a client keeps the lease (`screens {watch:true}` every ~25 s), a frame of every running VM every 5 s -> stable file shots/vmscr-<name>.png + event vms/screen
  let screenTimer = null, screenLease = 0; const frameSig = new Map();
  const shotsDir = () => { const d = path.join(DATA, 'files', 'shots'); fs.mkdirSync(d, { recursive: true }); return d; };
  const frameName = n => `vmscr-${n.replace(/[^A-Za-z0-9._-]/g, '_')}.png`;
  async function screenTick() {
    if (Date.now() > screenLease || !events.listening()) { clearInterval(screenTimer); screenTimer = null; return; }
    const running = (await virsh(['list', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
    const todo = running.slice();
    await Promise.all(Array.from({ length: Math.min(4, todo.length) }, async () => {
      for (let n; (n = todo.shift());) {
        try {
          const dst = path.join(shotsDir(), frameName(n));
          const d = await grab(n, dst);
          const st = fs.statSync(dst); const sig = `${st.size}:${d.w}x${d.h}`;
          if (frameSig.get(n) !== sig) { frameSig.set(n, sig); events.emit('vms', 'screen', n, { name: n, file: `shots/${frameName(n)}`, v: Math.round(st.mtimeMs), w: d.w, h: d.h }); }
        } catch { /* the VM went away or has no display yet */ }
      }
    }));
  }
  function watchScreens(on) {
    if (!on) { screenLease = 0; return; }
    screenLease = Date.now() + 45000;
    if (!screenTimer) { screenTimer = setInterval(() => { screenTick().catch(() => {}); }, 5000); screenTick().catch(() => {}); }
  }
  const screenFiles = () => { const o = {}; try { for (const f of fs.readdirSync(shotsDir())) { const m = f.match(/^vmscr-(.+)\.png$/); if (m) o[m[1]] = { file: `shots/${f}`, v: Math.round(fs.statSync(path.join(shotsDir(), f)).mtimeMs) }; } } catch { /* none */ } return o; };

  // ---- stats: CPU, assigned memory, uptime of the running VMs (sampled every 10 s while a client is subscribed) ----------
  const statsCache = new Map(); let prevCpu = new Map(), statTimer = null, statAt = 0;
  async function sampleStats() {
    const r = await virsh(['domstats', '--cpu-total', '--balloon', '--vcpu'], { timeoutMs: 15000 });
    const now = Date.now(); const next = new Map(); const out = {};
    for (const blk of r.stdout.split(/\n(?=Domain: )/)) {
      const nm = (blk.match(/^Domain: '([^']+)'/) || [])[1]; if (!nm) continue;
      const g = k => { const m = blk.match(new RegExp(`^\\s+${k.replace(/\./g, '\\.')}=(\\S+)`, 'm')); return m ? Number(m[1]) : null; };
      const t = g('cpu.time'); const vc = g('vcpu.current') || 1; const cur = g('balloon.current'); const maxK = g('balloon.maximum');
      const prev = prevCpu.get(nm);
      let cpu = null; if (t != null && prev && now > prev.at) cpu = Math.max(0, Math.min(100, ((t - prev.t) / ((now - prev.at) * 1e6)) / vc * 100));
      if (t != null) next.set(nm, { t, at: now });
      out[nm] = { cpu: cpu == null ? null : Math.round(cpu * 10) / 10, memMB: cur != null ? Math.round(cur / 1024) : null, memMaxMB: maxK != null ? Math.round(maxK / 1024) : null };
    }
    prevCpu = next;
    // uptime: age of the QEMU process
    const pids = {}; for (const nm of Object.keys(out)) { try { const p = Number(fs.readFileSync(`/run/libvirt/qemu/${nm}.pid`, 'utf8').trim()); if (p > 0) pids[p] = nm; } catch { /* no pid file */ } }
    if (Object.keys(pids).length) {
      const ps = await run(['ps', '-o', 'pid=,etimes=', '-p', Object.keys(pids).join(',')]);
      for (const l of ps.stdout.split('\n')) { const f = l.trim().split(/\s+/); if (f.length === 2 && pids[f[0]]) out[pids[f[0]]].uptimeS = Number(f[1]); }
    }
    statsCache.clear(); for (const [k, v] of Object.entries(out)) statsCache.set(k, v);
    statAt = now;
    return out;
  }
  async function statTick() { try { const s = await sampleStats(); events.emit('vms', 'stats', null, { stats: s }); } catch { /* libvirt busy */ } }
  events.onActive(() => { if (!statTimer) { statTick(); statTimer = setInterval(statTick, 10000); } });
  events.onIdle(() => { clearInterval(statTimer); statTimer = null; screenLease = 0; });

  // ---- adoption / manageability ------------------------------------------------------------------------------
  async function ensureManageable(name, o) {
    const r = await edit(name, xml => X.ensureDevices(xml, name).xml);
    fs.mkdirSync(X.LOG_DIR, { recursive: true }); try { fs.chmodSync(X.LOG_DIR, 0o755); } catch { /* ignore */ }
    tags[name] = { ...(tags[name] || {}), managed: 'true', ...(o && o.guest ? { guest: o.guest } : {}) }; saveTags();
    return r;
  }
  const agents = () => readJson(AGENTS, {});
  const agentUrl = async name => {
    const a = agents()[name]; if (!a) return null;
    if (a.url) return a.url;
    const d = await h.describe(name); const ip = d.nics.find(n => n.ip)?.ip; return ip ? `http://${ip}:${a.port || 8790}` : null;
  };
  const agentToken = name => { try { return fs.readFileSync(path.join(SECRETS, name), 'utf8').trim(); } catch { return null; } };

  // ---- checkpoints --------------------------------------------------------------------------------------------
  const nvramOf = xml => (xml.match(/<nvram\b[^>]*>([^<]+)<\/nvram>/) || [])[1] || null;
  const isoDate = s => { const m = String(s).match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-])(\d\d)(\d\d)$/); return m ? new Date(`${m[1]}T${m[2]}${m[3]}${m[4]}:${m[5]}`).toISOString() : s; };
  async function checkpoints(name) {
    const r = await virsh(['snapshot-list', name, '--parent']);
    const rows = r.stdout.split('\n').slice(2).filter(l => l.trim()).map(l => { const f = l.trim().split(/\s+/); return { name: f[0], created: isoDate(`${f[1]} ${f[2]} ${f[3]}`), state: f[4], parent: f[5] && f[5] !== '-' ? f[5] : null }; });
    let current = null; const c = await virsh(['snapshot-current', name, '--name']); if (c.code === 0) current = c.stdout.trim() || null;
    for (const s of rows) {
      const x = (await virsh(['snapshot-dumpxml', name, s.name, '--security-info'])).stdout;
      s.external = /snapshot='external'/.test(x) || s.state === 'disk-snapshot';
      s.memory = /<memory snapshot='(internal|external)'/.test(x) || s.state === 'running' || s.state === 'paused';
      s.description = (x.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
      s.current = s.name === current;
    }
    return { checkpoints: rows, current };
  }
  async function createCheckpoint(name, snap, description) {
    const xml = await inactiveXml(name); const st = await state(name);
    const ds = X.disks(xml).filter(d => d.device === 'disk' && !d.readonly && d.source);
    const pflash = /<loader\b[^>]*type='pflash'/.test(xml) || /<os\b[^>]*firmware='efi'/.test(xml);
    const external = pflash || ds.some(d => d.format !== 'qcow2');
    const base = ['snapshot-create-as', name, snap, ...(description ? ['--description', description] : [])];
    const nv = nvramOf(xml); if (nv && fs.existsSync(nv)) fs.copyFileSync(nv, `${nv}.${snap}`);
    if (!external) { await vok(base, { timeoutMs: 600000 }); return { kind: 'internal' }; }
    const dp = await dirPool();
    const args = [...base];
    for (const d of ds) args.push('--diskspec', `${d.target},snapshot=external,file=${path.join(dp.path, `${name}.${snap}.${d.target}.qcow2`)}`);
    // libvirt overlays every disk when it reverts an external checkpoint, a DVD image included (and then cannot merge it back): the media is out while the checkpoint is made
    const media = X.disks(xml).filter(d => d.device === 'cdrom' && d.target && d.source);
    const lv = st === 'running' || st === 'paused' ? ['--live'] : [];
    for (const d of media) await vok(['change-media', name, d.target, '--eject', '--config', ...lv, '--force']);
    for (const d of X.disks(xml).filter(d => d.device === 'cdrom' && d.target)) args.push('--diskspec', `${d.target},snapshot=no`);
    if (st === 'running') args.push('--memspec', `file=${path.join(dp.path, `${name}.${snap}.mem`)},snapshot=external`); else args.push('--disk-only');
    try { await vok(args, { timeoutMs: 600000 }); } finally { for (const d of media) await virsh(['change-media', name, d.target, d.source, '--insert', '--config', ...lv]); }
    await chown(...ds.map(d => path.join(dp.path, `${name}.${snap}.${d.target}.qcow2`)));
    return { kind: 'external' };
  }
  async function descendants(name, snap) {
    const r = await virsh(['snapshot-list', name, '--descendants', '--from', snap, '--name']); // includes the snapshot itself? no: only descendants
    return r.stdout.split('\n').map(s => s.trim()).filter(s => s && s !== snap);
  }
  async function deleteCheckpoint(name, snap, subtree) {
    const doomed = subtree ? [...(await descendants(name, snap)), snap] : [snap];
    const xml = await inactiveXml(name); const nv = nvramOf(xml);
    if (subtree) {
      const r = await virsh(['snapshot-delete', name, snap, '--children'], { timeoutMs: 600000 });
      if (r.code !== 0) { // leaf first
        for (const s of (await descendants(name, snap)).reverse()) await vok(['snapshot-delete', name, s], { timeoutMs: 600000 });
        await vok(['snapshot-delete', name, snap], { timeoutMs: 600000 });
      }
    } else {
      const r = await virsh(['snapshot-delete', name, snap], { timeoutMs: 600000 });
      if (r.code !== 0) {
        if (/Permission denied/.test(r.stderr)) { await run(['sh', '-c', `chown ${QEMU_USER}:${QEMU_USER} /srv/rack/vmfiles/* 2>/dev/null; true`]); await vok(['snapshot-delete', name, snap], { timeoutMs: 600000 }); } else throw bad((r.stderr || r.stdout).trim().split('\n').pop());
      }
    }
    if (nv) for (const s of doomed) fs.rmSync(`${nv}.${s}`, { force: true });
    return doomed;
  }

  const actions = {
    // ---- settings -----------------------------------------------------------------------------------------------
    // set {name, vcpus?, memMB? (startup), memMaxMB? (dynamic memory: the balloon runs from memMB up to memMaxMB; omit or equal = fixed), cpuModel? ('host-passthrough'|'host-model'|<model>),
    //      autostart?, stopAction? ('shutdown'|'save'|'off'), newName?, guest? ('windows'|'linux'), agent?:true}
    async set(p) {
      const name = vmName(p.name); await mustExist(name); await guardTemplate(name, 'changing its settings');
      const st = await state(name); const changed = [];
      const cfg = {};
      if (p.vcpus !== undefined) cfg.vcpus = num(p.vcpus, 'vcpus', 1, 240);
      if (p.memMB !== undefined) cfg.memMB = num(p.memMB, 'memMB', 64, 4194304);
      if (p.memMaxMB !== undefined) cfg.memMaxMB = num(p.memMaxMB, 'memMaxMB', 64, 4194304);
      if (cfg.memMB !== undefined || cfg.memMaxMB !== undefined) {
        const x = await inactiveXml(name);
        const curMax = Math.round(Number((x.match(/<memory\b[^>]*>(\d+)</) || [])[1]) / 1024), cur = Math.round(Number((x.match(/<currentMemory\b[^>]*>(\d+)</) || [])[1]) / 1024);
        const memMB = cfg.memMB ?? cur, maxMB = Math.max(memMB, cfg.memMaxMB ?? (cfg.memMB !== undefined && curMax === cur ? memMB : curMax));
        if (cfg.memMaxMB !== undefined && cfg.memMaxMB < memMB) throw bad('the maximum memory cannot be below the startup memory');
        const same = maxMB === curMax;
        if (st === 'running' && same && memMB <= curMax) { await vok(['setmem', name, String(memMB * 1024), '--live', '--config']); changed.push('memory'); }
        else { await needOff(name, 'Changing the startup or maximum memory'); await edit(name, x2 => x2.replace(/<memory\b([^>]*)>\d+<\/memory>/, `<memory$1>${maxMB * 1024}</memory>`).replace(/<currentMemory\b([^>]*)>\d+<\/currentMemory>/, `<currentMemory$1>${memMB * 1024}</currentMemory>`).replace(/<maxMemory\b[\s\S]*?<\/maxMemory>\s*/, '')); changed.push('memory'); }
      }
      if (cfg.vcpus !== undefined) { await edit(name, x => x.replace(/<vcpu\b[^>]*>\d+<\/vcpu>/, `<vcpu placement='static'>${cfg.vcpus}</vcpu>`).replace(/<topology\b[^>]*\/>\s*/, ''), 'Changing the number of processors'); changed.push('vcpus'); }
      if (p.cpuModel !== undefined) {
        const m = str(p.cpuModel, 'cpuModel', /^[A-Za-z0-9._-]{1,60}$/);
        const el = m === 'host-passthrough' ? "<cpu mode='host-passthrough' check='none' migratable='on'/>" : m === 'host-model' ? "<cpu mode='host-model'/>" : `<cpu mode='custom' match='exact'><model fallback='forbid'>${m}</model></cpu>`;
        await edit(name, x => /<cpu\b/.test(x) ? x.replace(/<cpu\b[^>]*\/>|<cpu\b[\s\S]*?<\/cpu>/, el) : x.replace(/(<clock\b)/, `${el}\n  $1`), 'Changing the processor model'); changed.push('cpuModel');
      }
      if (p.guest !== undefined) { const g = p.guest === null || p.guest === '' ? null : str(p.guest, 'guest', /^(windows|linux|other)$/); const t = { ...(tags[name] || {}) }; if (g) t.guest = g; else delete t.guest; if (Object.keys(t).length) tags[name] = t; else delete tags[name]; saveTags(); changed.push('guest'); }
      if (p.stopAction !== undefined) { const a = str(p.stopAction, 'stopAction', /^(shutdown|save|off)$/); tags[name] = { ...(tags[name] || {}), stopAction: a }; saveTags(); changed.push('stopAction'); }
      if (p.autostart !== undefined) { await vok(['autostart', name, ...(bool(p.autostart, false) ? [] : ['--disable'])]); changed.push('autostart'); }
      if (p.agent === true) { await edit(name, x => (/org\.qemu\.guest_agent\.0/.test(x) ? x : X.addDevice(x, "<channel type='unix'><target type='virtio' name='org.qemu.guest_agent.0'/></channel>")), 'Adding the guest agent channel'); changed.push('agent'); }
      if (p.newName !== undefined) {
        const nn = vmName(p.newName); await needOff(name, 'Renaming'); if ((await names()).includes(nn)) throw bad('a VM with that name exists', 'EXISTS');
        await vok(['domrename', name, nn]);
        if (tags[name]) { tags[nn] = tags[name]; delete tags[name]; saveTags(); }
        events.emit('vms', 'removed', name, { name }); events.emit('vms', 'added', nn, { name: nn }); changed.push('name');
        return { ok: true, changed, name: nn };
      }
      touch(name); return { ok: true, changed, name };
    },
    // firmware {name, bootOrder?:['disk','cdrom','network'], secureBoot?:bool, tpm?:bool}
    async firmware(p) {
      const name = vmName(p.name); await mustExist(name); await guardTemplate(name, 'changing its firmware');
      const changed = [];
      if (p.bootOrder !== undefined) {
        const ord = (Array.isArray(p.bootOrder) ? p.bootOrder : []).map(s => String(s)); if (!ord.length || ord.some(s => !['disk', 'cdrom', 'network'].includes(s))) throw bad("bootOrder is a list of 'disk', 'cdrom', 'network'");
        await edit(name, x => {
          x = x.replace(/<boot\b[^>]*\/>\s*/g, '');
          const mark = (xml, re, k) => { const i = ord.indexOf(k); if (i < 0) return xml; let done = false; return xml.replace(re, b => { if (done) return b; done = true; return b.replace(/<\/(disk|interface)>$/, `<boot order='${i + 1}'/></$1>`); }); };
          x = mark(x, /<disk\b[^>]*device='disk'[\s\S]*?<\/disk>/, 'disk');
          x = mark(x, /<disk\b[^>]*device='cdrom'[\s\S]*?<\/disk>/, 'cdrom');
          return mark(x, /<interface\b[\s\S]*?<\/interface>/, 'network');
        }, 'Changing the boot order'); changed.push('bootOrder');
      }
      if (p.secureBoot !== undefined) {
        const on = bool(p.secureBoot, false); const x0 = await inactiveXml(name);
        if (!/<os\b[^>]*firmware='efi'/.test(x0) && !/<loader\b/.test(x0)) throw bad('Secure Boot needs a UEFI (generation 2) virtual machine', 'NOT_UEFI');
        await needOff(name, 'Changing Secure Boot');
        const nv = nvramOf(x0);
        await edit(name, x => {
          x = x.replace(/<os\b[^>]*>/, "<os firmware='efi'>").replace(/<firmware>[\s\S]*?<\/firmware>\s*/g, '').replace(/<loader\b[\s\S]*?<\/loader>\s*/g, '').replace(/<nvram\b[\s\S]*?<\/nvram>\s*/g, '');
          x = x.replace(/(<type\b[^>]*>hvm<\/type>)/, `$1\n    <firmware><feature enabled='${on ? 'yes' : 'no'}' name='enrolled-keys'/><feature enabled='${on ? 'yes' : 'no'}' name='secure-boot'/></firmware>`);
          x = x.replace(/<smm\b[^>]*\/>/, '');
          if (on) x = /<features>/.test(x) ? x.replace('<features>', "<features>\n    <smm state='on'/>") : x;
          return x;
        });
        if (nv) fs.rmSync(nv, { force: true });
        changed.push('secureBoot');
      }
      if (p.tpm !== undefined) {
        const on = bool(p.tpm, false);
        await edit(name, x => { x = x.replace(/<tpm\b[\s\S]*?<\/tpm>\s*/g, ''); return on ? X.addDevice(x, "<tpm model='tpm-crb'><backend type='emulator' version='2.0'/></tpm>") : x; }, 'Changing the TPM'); changed.push('tpm');
      }
      touch(name); return { ok: true, changed };
    },
    // disk-attach {name, bus?:'virtio'|'scsi'|'sata', volume?:<absolute path>, newGB?, format?}
    async 'disk-attach'(p) {
      const name = vmName(p.name); await mustExist(name); await guardTemplate(name, 'attaching a disk');
      const bus = p.bus ? str(p.bus, 'bus', /^(virtio|scsi|sata)$/) : 'virtio'; const st = await state(name);
      if (st !== 'shut off' && bus === 'sata') throw bad('Attaching a SATA disk: turn the virtual machine off first', 'NEEDS_OFF');
      const xml = await inactiveXml(name); let vpath, fmt;
      if (p.volume) {
        vpath = absPath(p.volume, 'volume'); if (!fs.existsSync(vpath)) throw bad('that disk file does not exist', 'NOT_FOUND');
        const used = await h.diskSourcesInUse(); if (used.has(vpath)) throw bad(`that disk is in use by ${used.get(vpath)}`, 'IN_USE');
        const info = JSON.parse((await ok(['qemu-img', 'info', '--output=json', vpath])).stdout); fmt = info.format === 'qcow2' ? 'qcow2' : 'raw';
      } else {
        const gb = num(p.newGB, 'newGB', 0.1, 20000); const dp = await dirPool(); fmt = 'qcow2';
        vpath = path.join(dp.path, `${name}-${rid(3)}.qcow2`);
        await ok(['qemu-img', 'create', '-q', '-f', 'qcow2', vpath, `${Math.round(gb * 1024)}M`]); await chown(vpath);
      }
      const target = X.nextTarget(xml, bus);
      const r = await virsh(['attach-disk', name, vpath, target, '--driver', 'qemu', '--subdriver', fmt, '--targetbus', bus, '--persistent', ...(st === 'running' ? ['--live'] : [])], { timeoutMs: 60000 });
      if (r.code !== 0) { if (!p.volume) fs.rmSync(vpath, { force: true }); throw bad((r.stderr || r.stdout).trim().split('\n').pop() + (st === 'running' ? ' (turn the virtual machine off to add a disk on this controller)' : '')); }
      touch(name); return { ok: true, target, path: vpath, format: fmt };
    },
    // disk-detach {name, target, delete?:false}
    async 'disk-detach'(p) {
      const name = vmName(p.name); await mustExist(name); await guardTemplate(name, 'removing a disk');
      const target = str(p.target, 'target', /^[a-z]{2,3}[a-z]?$/); const st = await state(name);
      const d = X.disks(await inactiveXml(name)).find(x => x.target === target && x.device === 'disk'); if (!d) throw bad('no such disk', 'NOT_FOUND');
      if (st !== 'shut off' && d.bus === 'sata') throw bad('Removing a SATA disk: turn the virtual machine off first', 'NEEDS_OFF');
      await vok(['detach-disk', name, target, '--persistent', ...(st === 'running' ? ['--live'] : [])]);
      if (bool(p.delete, false) && d.source && d.source.startsWith('/srv/rack/')) fs.rmSync(d.source, { force: true });
      touch(name); return { ok: true, source: d.source };
    },
    // disk-resize {name, target, sizeGB}: grow only
    async 'disk-resize'(p) {
      const name = vmName(p.name); await mustExist(name); await guardTemplate(name, 'resizing a disk');
      const target = str(p.target, 'target', /^[a-z]{2,3}[a-z]?$/); const gb = num(p.sizeGB, 'sizeGB', 0.1, 100000);
      const d = X.disks(await inactiveXml(name)).find(x => x.target === target && x.device === 'disk'); if (!d || !d.source) throw bad('no such disk', 'NOT_FOUND');
      const bi = await virsh(['domblkinfo', name, target]); const cap = Number((bi.stdout.match(/Capacity:\s+(\d+)/) || [])[1]);
      const want = Math.round(gb * GiB);
      if (cap && want <= cap) throw bad(`a disk can only grow (now ${Math.round(cap / GiB * 10) / 10} GB)`, 'GROW_ONLY');
      const st = await state(name);
      if (d.source.startsWith('/dev/')) await ok(['lvextend', '-y', '-L', `${Math.round(gb * 1024)}M`, d.source]);
      if (st === 'running') await vok(['blockresize', name, target, `${Math.round(gb * 1024)}M`]);
      else if (!d.source.startsWith('/dev/')) await ok(['qemu-img', 'resize', d.source, `${Math.round(gb * 1024)}M`]);
      touch(name); return { ok: true, sizeB: want };
    },
    // cdrom {name, iso?: <path in the iso pool> | null to eject, target?, add?:true (adds an empty DVD drive when the machine has none; off only)}
    async cdrom(p) {
      const name = vmName(p.name); await mustExist(name);
      let iso = null; if (p.iso) { iso = absPath(p.iso, 'iso'); if (!iso.startsWith(`${ISO_DIR}/`) || !fs.existsSync(iso)) throw bad('the image must be a file in the ISO pool', 'NOT_FOUND'); }
      const st = await state(name); const xml = await inactiveXml(name);
      const cds = X.disks(xml).filter(d => d.device === 'cdrom'); const cd = p.target ? cds.find(d => d.target === p.target) : cds[0];
      const live = st === 'running' || st === 'paused' ? ['--live'] : [];
      if (!cd) {
        if (!iso && !bool(p.add, false)) return { ok: true };
        if (st !== 'shut off') throw bad('Adding a DVD drive: turn the virtual machine off first', 'NEEDS_OFF');
        const t = X.nextTarget(xml, 'sata');
        await edit(name, x => X.addDevice(x, `<disk type='file' device='cdrom'><driver name='qemu' type='raw'/>${iso ? `<source file='${X.esc(iso)}'/>` : ''}<target dev='${t}' bus='sata'/><readonly/></disk>`));
        touch(name); return { ok: true, target: t };
      }
      if (iso) await vok(['change-media', name, cd.target, iso, cd.source ? '--update' : '--insert', '--config', ...live]);
      else if (cd.source) await vok(['change-media', name, cd.target, '--eject', '--config', ...live, '--force']);
      touch(name); return { ok: true, target: cd.target };
    },
    // nic {name, op?:'set'|'add'|'remove', index?:0, network?, mac?, model?:'virtio'|'e1000e'|'rtl8139', link?:'up'|'down'}
    async nic(p) {
      const name = vmName(p.name); await mustExist(name); await guardTemplate(name, 'changing a network adapter');
      const op = p.op || 'set'; const idx = p.index === undefined ? 0 : num(p.index, 'index', 0, 31);
      const nets = (await virsh(['net-list', '--all', '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
      const network = p.network ? str(p.network, 'network', RE.name) : null; const mac = p.mac ? str(p.mac, 'mac', /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i) : null;
      const model = p.model ? str(p.model, 'model', /^(virtio|e1000e|e1000|rtl8139)$/) : null;
      if (p.link !== undefined && !network && !mac && !model && op === 'set') {
        const x = await inactiveXml(name); const m = [...x.matchAll(/<interface\b[\s\S]*?<\/interface>/g)][idx]; if (!m) throw bad('no such adapter', 'NOT_FOUND');
        const macA = attr(m[0], 'mac', 'address'); if ((await state(name)) === 'shut off') throw bad('The link state of an adapter changes while the virtual machine runs', 'NEEDS_ON');
        await vok(['domif-setlink', name, macA, p.link === 'down' ? 'down' : 'up', '--config']); touch(name); return { ok: true };
      }
      const frag = (m0, old) => {
        const net = network || (old && (attr(old, 'source', 'network') || attr(old, 'source', 'bridge'))) || 'br0';
        const isBr = !nets.includes(net) && !(old && attr(old, 'source', 'network') === net);
        return `<interface type='${isBr ? 'bridge' : 'network'}'><mac address='${m0}'/><source ${isBr ? 'bridge' : 'network'}='${X.esc(net)}'/><model type='${model || (old && attr(old, 'model', 'type')) || 'virtio'}'/></interface>`;
      };
      const randMac = () => '52:54:00:' + [0, 0, 0].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':');
      await edit(name, x => {
        const all = [...x.matchAll(/<interface\b[\s\S]*?<\/interface>/g)];
        if (op === 'add') return X.addDevice(x, frag(mac || randMac(), null));
        const m = all[idx]; if (!m) throw bad('no such adapter', 'NOT_FOUND');
        if (op === 'remove') return x.replace(m[0], '');
        return x.replace(m[0], frag(mac || attr(m[0], 'mac', 'address'), m[0]));
      }, 'Changing a network adapter');
      touch(name); return { ok: true };
    },
    // ---- checkpoints --------------------------------------------------------------------------------------------
    async checkpoints(p) { const name = vmName(p.name); await mustExist(name); return checkpoints(name); },
    // checkpoint {name, op:'create'|'apply'|'rename'|'delete', snap, newName?, description?, subtree?:true}
    async checkpoint(p) {
      const name = vmName(p.name); await mustExist(name); await guardTemplate(name, `checkpoint ${p.op}`);
      const snap = str(p.snap, 'snap', RE.name);
      const existing = (await virsh(['snapshot-list', name, '--name'])).stdout.split('\n').map(s => s.trim()).filter(Boolean);
      if (p.op === 'create') {
        if (existing.includes(snap)) throw bad('a checkpoint with that name exists', 'EXISTS');
        const r = await createCheckpoint(name, snap, typeof p.description === 'string' ? p.description.slice(0, 500) : ''); touch(name, { snapshot: snap, op: 'create' }); return { ok: true, ...r };
      }
      if (!existing.includes(snap)) throw bad('no such checkpoint', 'NOT_FOUND');
      if (p.op === 'apply') {
        const nv = nvramOf(await inactiveXml(name));
        if (nv && fs.existsSync(`${nv}.${snap}`)) { if ((await state(name)) !== 'shut off') await vok(['destroy', name]); fs.copyFileSync(`${nv}.${snap}`, nv); }
        await vok(['snapshot-revert', name, snap, '--force'], { timeoutMs: 600000 }); touch(name, { snapshot: snap, op: 'apply' }); return { ok: true };
      }
      if (p.op === 'delete') { const gone = await deleteCheckpoint(name, snap, bool(p.subtree, false)); touch(name, { op: 'delete' }); return { ok: true, deleted: gone }; }
      if (p.op === 'rename') {
        const nn = str(p.newName, 'newName', RE.name); if (existing.includes(nn)) throw bad('a checkpoint with that name exists', 'EXISTS');
        const cur = (await virsh(['snapshot-current', name, '--name'])).stdout.trim();
        const kids = (await virsh(['snapshot-list', name, '--parent'])).stdout.split('\n').slice(2).filter(l => l.trim()).map(l => l.trim().split(/\s+/)).filter(f => f[5] === snap).map(f => f[0]);
        const dump = async s => (await vok(['snapshot-dumpxml', name, s, '--security-info'])).stdout;
        const redefine = async (xml, current) => { const f = path.join(DATA, `snap-${rid(3)}.xml`); fs.writeFileSync(f, xml); try { await vok(['snapshot-create', name, f, '--redefine', ...(current ? ['--current'] : [])]); } finally { fs.rmSync(f, { force: true }); } };
        let x = await dump(snap); x = x.replace(`<name>${snap}</name>`, `<name>${nn}</name>`);
        await redefine(x, cur === snap);
        for (const k of kids) { const kx = (await dump(k)).replace(new RegExp(`(<parent>\\s*<name>)${snap}(</name>)`), `$1${nn}$2`); await redefine(kx, cur === k); }
        await vok(['snapshot-delete', name, snap, '--metadata']);
        const nv = nvramOf(await inactiveXml(name)); if (nv && fs.existsSync(`${nv}.${snap}`)) fs.renameSync(`${nv}.${snap}`, `${nv}.${nn}`);
        touch(name, { op: 'rename' }); return { ok: true };
      }
      throw bad('op must be create, apply, rename or delete');
    },
    // save {name}: managed save (Hyper-V's Save). start resumes it; save-discard throws the saved state away.
    async save(p) { const name = vmName(p.name); await mustExist(name); if ((await state(name)) === 'shut off') throw bad('the virtual machine is off'); await vok(['managedsave', name], { timeoutMs: 600000 }); touch(name); return { ok: true }; },
    async 'save-discard'(p) { const name = vmName(p.name); await mustExist(name); await virsh(['managedsave-remove', name]); touch(name); return { ok: true }; },
    // ---- ISO pool -------------------------------------------------------------------------------------------------
    async 'iso-list'() { return { dir: ISO_DIR, isos: fs.readdirSync(ISO_DIR).filter(f => /\.(iso|img)$/i.test(f)).map(f => ({ name: f, path: path.join(ISO_DIR, f), sizeB: fs.statSync(path.join(ISO_DIR, f)).size })) }; },
    async 'iso-fetch'(p) {
      const url = str(p.url, 'url', /^https?:\/\/[^\s'"]+$/, 1000), nm = str(p.name, 'name', /^[A-Za-z0-9][A-Za-z0-9._-]{0,100}\.(iso|img)$/i);
      return { job: jobs.start({ role: 'vms', title: `download ${nm}`, run: async c => { const tmp = path.join(ISO_DIR, `.${nm}.part`); await c.exec(['curl', '-fL', '--retry', '2', '-o', tmp, url], { timeoutMs: 3600e3 }); fs.renameSync(tmp, path.join(ISO_DIR, nm)); await run(['chown', `${QEMU_USER}:${QEMU_USER}`, path.join(ISO_DIR, nm)]); await virsh(['pool-refresh', 'iso']); } }) };
    },
    // ---- export / import / move -------------------------------------------------------------------------------------
    async exports() {
      const out = [];
      for (const f of fs.existsSync(EXPORT_ROOT) ? fs.readdirSync(EXPORT_ROOT) : []) { const m = readJson(path.join(EXPORT_ROOT, f, 'manifest.json'), null); if (m) out.push({ folder: f, ...m }); }
      return { root: EXPORT_ROOT, exports: out };
    },
    'export-delete'(p) { const f = str(p.folder, 'folder', RE.name); const d = path.join(EXPORT_ROOT, f); if (!fs.existsSync(path.join(d, 'manifest.json'))) throw bad('no such export', 'NOT_FOUND'); fs.rmSync(d, { recursive: true, force: true }); return { ok: true }; },
    // export {name, folder?}: the machine must be off. A folder under /srv/rack/vm-exports with domain.xml, manifest.json, one qcow2 per disk, the NVRAM.
    async export(p) {
      const name = vmName(p.name); await mustExist(name); await needOff(name, 'Exporting');
      const folder = p.folder ? str(p.folder, 'folder', RE.name) : name; const dir = path.join(EXPORT_ROOT, folder);
      if (fs.existsSync(dir)) throw bad('that export folder exists', 'EXISTS');
      return { job: jobs.start({ role: 'vms', title: `export ${name}`, run: async c => {
        fs.mkdirSync(dir, { recursive: true });
        try {
          const xml = await inactiveXml(name); const ds = X.disks(xml).filter(d => d.device === 'disk' && d.source); const man = { name, exportedAt: new Date().toISOString(), disks: [], tags: tags[name] || {} };
          for (const d of ds) { const f = `disk-${d.target}.qcow2`; c.log(`copying ${d.target}`); await c.exec(['qemu-img', 'convert', '-O', 'qcow2', d.source, path.join(dir, f)], { timeoutMs: 6 * 3600e3 }); man.disks.push({ target: d.target, file: f, source: d.source, sizeB: fs.statSync(path.join(dir, f)).size }); }
          fs.writeFileSync(path.join(dir, 'domain.xml'), xml);
          const nv = nvramOf(xml); if (nv && fs.existsSync(nv)) { fs.copyFileSync(nv, path.join(dir, 'nvram.fd')); man.nvram = true; }
          const uuid = (xml.match(/<uuid>([^<]+)<\/uuid>/) || [])[1]; if (/<tpm\b/.test(xml) && uuid && fs.existsSync(`/var/lib/libvirt/swtpm/${uuid}`)) { await c.exec(['cp', '-a', `/var/lib/libvirt/swtpm/${uuid}`, path.join(dir, 'swtpm')]); man.tpm = true; }
          fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(man, null, 1));
        } catch (e) { fs.rmSync(dir, { recursive: true, force: true }); throw e; }
      } }) };
    },
    // import {folder, name?, copy?:true}
    async import(p) {
      const folder = str(p.folder, 'folder', RE.name); const dir = path.join(EXPORT_ROOT, folder); const man = readJson(path.join(dir, 'manifest.json'), null);
      if (!man) throw bad('no such export folder', 'NOT_FOUND');
      const name = vmName(p.name || man.name); if ((await names()).includes(name)) throw bad('a VM with that name exists (pass another name)', 'EXISTS');
      const dp = await dirPool();
      return { job: jobs.start({ role: 'vms', title: `import ${name}`, run: async c => {
        let xml = fs.readFileSync(path.join(dir, 'domain.xml'), 'utf8'); const made = [];
        try {
          xml = xml.replace(/<name>[^<]*<\/name>/, `<name>${name}</name>`).replace(/<uuid>[^<]*<\/uuid>\s*/, '').replace(/<mac address='[^']*'\/>/g, () => `<mac address='52:54:00:${[0, 0, 0].map(() => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(':')}'/>`);
          for (const d of man.disks) { const dst = path.join(dp.path, `${name}-${d.target}.qcow2`); c.log(`copying ${d.target}`); await c.exec(['cp', '--reflink=auto', path.join(dir, d.file), dst], { timeoutMs: 6 * 3600e3 }); made.push(dst); xml = xml.split(d.source).join(dst); }
          const nv = nvramOf(xml); if (nv) { const dst = path.join(path.dirname(nv), `${name}_VARS.fd`); if (man.nvram) fs.copyFileSync(path.join(dir, 'nvram.fd'), dst); xml = xml.replace(nv, dst); }
          await chown(...made);
          xml = X.ensureDevices(xml, name).xml;
          await defineXml(xml, name);
          if (man.tpm) { const su = t => (t.match(/<uuid>([^<]+)<\/uuid>/) || [])[1]; const nu = su((await vok(['dumpxml', name, '--inactive'])).stdout); if (nu) await ok(['cp', '-a', path.join(dir, 'swtpm'), `/var/lib/libvirt/swtpm/${nu}`]); }
        } catch (e) { for (const f of made) fs.rmSync(f, { force: true }); await run([...h.V, 'undefine', name, '--nvram', '--tpm']); throw e; }
        tags[name] = { ...(man.tags || {}), managed: 'true' }; delete tags[name].template; delete tags[name].cloneof; saveTags();
        events.emit('vms', 'added', name, { name });
      } }) };
    },
    // move {name, pool?}: the machine's file disks move to the directory pool (default vmfiles); off, no checkpoints
    async move(p) {
      const name = vmName(p.name); await mustExist(name); await needOff(name, 'Moving'); await guardTemplate(name, 'moving it');
      if ((await virsh(['snapshot-list', name, '--name'])).stdout.trim()) throw bad('delete the checkpoints first', 'IN_USE');
      const dp = p.pool ? { name: p.pool, path: await poolPath(str(p.pool, 'pool', RE.name)) } : await dirPool();
      return { job: jobs.start({ role: 'vms', title: `move ${name} to ${dp.name}`, run: async c => {
        let xml = await inactiveXml(name);
        for (const d of X.disks(xml).filter(x => x.device === 'disk' && x.type === 'file' && x.source && path.dirname(x.source) !== dp.path)) { const dst = path.join(dp.path, path.basename(d.source)); c.log(`moving ${d.source}`); await c.exec(['mv', '-n', d.source, dst], { timeoutMs: 6 * 3600e3 }); await chown(dst); xml = xml.split(d.source).join(dst); }
        await defineXml(xml, name); touch(name);
      } }) };
    },
    // ---- manageability ------------------------------------------------------------------------------------------------
    // adopt {name, guest?:'windows'|'linux'}: adds VNC (127.0.0.1), the guest agent channel, the serial log and a tablet (the VM must be off) and tags it managed
    async adopt(p) {
      const name = vmName(p.name); await mustExist(name); await guardTemplate(name, 'adopting it');
      const guest = p.guest ? str(p.guest, 'guest', /^(windows|linux|other)$/) : undefined;
      const x = await inactiveXml(name); const need = X.ensureDevices(x, name).added;
      if (need.length) await needOff(name, `Adopting (adds ${need.join(', ')})`);
      await ensureManageable(name, { guest }); touch(name); return { ok: true, added: need };
    },
    // ---- screens, input, exec without the network --------------------------------------------------------------------------
    async screens(p) { if (p.watch !== undefined) watchScreens(bool(p.watch, false)); return { ok: true, frames: screenFiles(), leaseS: 45 }; },
    async screen(p) {
      const name = vmName(p.name); await mustExist(name);
      const f = files.newPath('shots', `vm-${name}`, 'png'); const d = await grab(name, f.abs); return { file: f.file, width: d.w, height: d.h };
    },
    // input {name, events:[{type:'key', keys:['ctrl','alt','delete']}, {type:'text', text}, {type:'move', x, y}, {type:'click', button?, x?, y?, double?}, {type:'scroll', dy}], norm?:true (x, y are 0..1)}
    async input(p) {
      const name = vmName(p.name); await mustExist(name);
      if (!Array.isArray(p.events) || !p.events.length || p.events.length > 200) throw bad('events must be a list of 1 to 200');
      let sent = 0;
      // small batches with a short wait: a guest's keyboard driver drops key events that arrive in one burst
      const send = async ev => { const n = ev.length > 8 ? 4 : 8; for (let i = 0; i < ev.length; i += n) { await qmp(name, 'input-send-event', { events: ev.slice(i, i + n) }); sent += Math.min(n, ev.length - i); if (ev.length > 8) await sleep(12); } };
      const place = async e => {
        if (e.x === undefined || e.y === undefined) return [];
        const sz = p.norm ? { w: 1, h: 1 } : await screenSize(name, false);
        return [X.absEv('x', num(e.x, 'x', 0, 1e5) / sz.w * 32767), X.absEv('y', num(e.y, 'y', 0, 1e5) / sz.h * 32767)];
      };
      for (const e of p.events) {
        try {
          if (e.type === 'key') await send(X.combo(Array.isArray(e.keys) ? e.keys : [e.keys]));
          else if (e.type === 'text') await send(X.typeEvents(String(e.text || '').slice(0, 20000)));
          else if (e.type === 'move') await send(await place(e));
          else if (e.type === 'click') { const b = ['left', 'right', 'middle'].includes(e.button) ? e.button : 'left'; const pre = await place(e); await send([...pre, X.btnEv(b, true), X.btnEv(b, false), ...(e.double ? [X.btnEv(b, true), X.btnEv(b, false)] : [])]); }
          else if (e.type === 'scroll') { const n = Math.min(50, Math.abs(Math.round(num(e.dy, 'dy', -1000, 1000)))); const b = e.dy > 0 ? 'wheel-down' : 'wheel-up'; const ev = []; for (let i = 0; i < n; i++) ev.push(X.btnEv(b, true), X.btnEv(b, false)); await send(ev); }
          else throw bad(`unknown input type ${e.type}`);
        } catch (err) { if (err.status) throw err; throw bad(err.message); }
      }
      return { ok: true, sent };
    },
    // exec {name, cmd, args?, timeoutS?:30, input?}: the QEMU guest agent; without args cmd is a command line for sh -c (cmd.exe /c on Windows)
    async exec(p) {
      const name = vmName(p.name); await mustExist(name); const timeout = num(p.timeoutS, 'timeoutS', 1, 3600, 30);
      const cmd = str(p.cmd, 'cmd', null, 20000); const win = await isWindows(name);
      const argv = Array.isArray(p.args) ? { path: cmd, arg: p.args.map(String) } : win ? { path: 'cmd.exe', arg: ['/c', cmd] } : { path: '/bin/sh', arg: ['-c', cmd] };
      const started = await qga(name, 'guest-exec', { ...argv, 'capture-output': true, ...(p.input !== undefined ? { 'input-data': Buffer.from(String(p.input)).toString('base64') } : {}) });
      const t0 = Date.now();
      for (;;) {
        const s = await qga(name, 'guest-exec-status', { pid: started.pid });
        if (s.exited) { const dec = b => (b ? Buffer.from(b, 'base64').toString('utf8') : ''); return { code: s.exitcode ?? (s.signal ? -s.signal : null), stdout: dec(s['out-data']), stderr: dec(s['err-data']), ms: Date.now() - t0 }; }
        if (Date.now() - t0 > timeout * 1000) return { code: null, timedOut: true, stdout: '', stderr: '', ms: Date.now() - t0, pid: started.pid };
        await sleep(200);
      }
    },
    async 'file-read'(p) {
      const name = vmName(p.name); await mustExist(name); const fp = str(p.path, 'path', null, 1024);
      const h2 = await qga(name, 'guest-file-open', { path: fp, mode: 'r' }); const parts = []; let total = 0;
      try { for (;;) { const r = await qga(name, 'guest-file-read', { handle: h2, count: 1048576 }, 20); const b = Buffer.from(r['buf-b64'] || '', 'base64'); total += b.length; parts.push(b); if (r.eof || !b.length) break; if (total > 16 * 1048576) throw bad('the file is larger than 16 MB', 'TOO_LARGE'); } }
      finally { await qga(name, 'guest-file-close', { handle: h2 }).catch(() => {}); }
      const all = Buffer.concat(parts); const out = { path: fp, size: all.length, dataBase64: all.toString('base64') };
      if (all.length <= 1048576) { const t = all.toString('utf8'); if (!t.includes('\ufffd')) out.text = t; }
      return out;
    },
    // file-write {name, path, data, base64?:false, append?:false}
    async 'file-write'(p) {
      const name = vmName(p.name); await mustExist(name); const fp = str(p.path, 'path', null, 1024);
      if (typeof p.data !== 'string') throw bad('data is required (a string; base64:true for bytes)');
      const buf = bool(p.base64, false) ? Buffer.from(p.data, 'base64') : Buffer.from(p.data, 'utf8'); if (buf.length > 16 * 1048576) throw bad('too large (16 MB)', 'TOO_LARGE');
      const h2 = await qga(name, 'guest-file-open', { path: fp, mode: bool(p.append, false) ? 'a' : 'w' });
      try { for (let i = 0; i < buf.length || i === 0; i += 262144) { await qga(name, 'guest-file-write', { handle: h2, 'buf-b64': buf.subarray(i, i + 262144).toString('base64') }, 20); if (!buf.length) break; } await qga(name, 'guest-file-flush', { handle: h2 }).catch(() => {}); }
      finally { await qga(name, 'guest-file-close', { handle: h2 }).catch(() => {}); }
      return { ok: true, path: fp, size: buf.length };
    },
    // agent-register {name, token, url?, port?:8790}: the in-guest agent (docs/vista-vm-agent.md): token kept in /etc/rackd/secrets/vm-agent/<name> (0600), never returned
    async 'agent-register'(p) {
      const name = vmName(p.name); await mustExist(name); const token = str(p.token, 'token', /^[\x21-\x7e]{8,200}$/);
      fs.mkdirSync(SECRETS, { recursive: true, mode: 0o700 }); fs.writeFileSync(path.join(SECRETS, name), token, { mode: 0o600 });
      const a = agents(); a[name] = { ...(p.url ? { url: str(p.url, 'url', /^https?:\/\/[^\s'"]+$/, 300) } : {}), port: p.port ? num(p.port, 'port', 1, 65535) : 8790 }; writeJson(AGENTS, a);
      touch(name); return { ok: true, url: await agentUrl(name) };
    },
    'agent-forget'(p) { const name = vmName(p.name); const a = agents(); delete a[name]; writeJson(AGENTS, a); fs.rmSync(path.join(SECRETS, name), { force: true }); touch(name); return { ok: true }; },
    // agent {name, route, method?:'GET'|'POST', query?:{}, body?:string, bodyBase64?:string, timeoutS?:60}: the in-guest agent's routes (ping, run, get, put, list, exists, shot, icon, iconcount); binary answers become a file
    async agent(p) {
      const name = vmName(p.name); await mustExist(name); const url = await agentUrl(name); const token = agentToken(name);
      if (!url || !token) throw bad('no in-guest agent is registered for this VM (agent-register), or it has no address yet', 'NO_AGENT');
      const route = str(p.route, 'route', /^\/?[a-z]{2,20}$/); const method = p.method === 'POST' ? 'POST' : 'GET';
      const u = new URL(url); const qs = new URLSearchParams(); for (const [k, v] of Object.entries(p.query || {})) qs.set(k, String(v));
      const body = p.bodyBase64 ? Buffer.from(p.bodyBase64, 'base64') : p.body !== undefined ? Buffer.from(String(p.body)) : null; const timeout = num(p.timeoutS, 'timeoutS', 1, 600, 60) * 1000;
      return await new Promise((resolve, reject) => {
        const req = http.request({ host: u.hostname, port: u.port || 80, method, path: `/${route.replace(/^\//, '')}${qs.toString() ? `?${qs}` : ''}`, headers: { 'X-Token': token, ...(body ? { 'Content-Length': body.length } : {}) }, timeout }, res => {
          const parts = []; let n = 0;
          res.on('data', d => { n += d.length; if (n > 64 * 1048576) req.destroy(new Error('answer too large')); else parts.push(d); });
          res.on('end', () => {
            const b = Buffer.concat(parts); const ct = String(res.headers['content-type'] || '');
            if (/^image\//.test(ct) || b.includes(0)) { const f = files.newPath('shots', `agent-${name}`, /png/.test(ct) ? 'png' : 'png'); fs.writeFileSync(f.abs, b); return resolve({ status: res.statusCode, contentType: ct, file: f.file, size: b.length }); }
            resolve({ status: res.statusCode, contentType: ct, text: b.toString('utf8').slice(0, 1048576), size: b.length });
          });
        });
        req.on('timeout', () => req.destroy(new Error('the in-guest agent did not answer in time')));
        req.on('error', e => reject(bad(`in-guest agent: ${e.message}`, 'NO_AGENT')));
        req.end(body || undefined);
      });
    },
  };
  const vmName = n => str(n, 'name', RE.name);

  /** The VNC port of a running VM (for the console bridge). */
  async function vncPort(name) {
    if (!RE.name.test(name || '')) throw new RackError('bad name', 'BAD_REQUEST', 400);
    const x = (await virsh(['dumpxml', name])).stdout;
    const g = x.match(/<graphics\b[^>]*type='vnc'[^>]*>/); const port = g && attr(g[0], 'graphics', 'port');
    if (!port || port === '-1') throw new RackError('the VM is not running or has no VNC display', 'NOT_RUNNING', 409);
    return Number(port);
  }
  /** Manageability of a VM description (see describe): what is missing for agents and the console to work. */
  async function manageability(d, xml) {
    const missing = [];
    if (!/<graphics\b[^>]*type='vnc'/.test(xml) || !/listen='127\.0\.0\.1'|address='127\.0\.0\.1'/.test((xml.match(/<graphics\b[\s\S]*?<\/graphics>|<graphics\b[^>]*\/>/) || [''])[0])) missing.push('vnc');
    const chan = /org\.qemu\.guest_agent\.0/.test(xml); if (!chan) missing.push('guest-agent-channel');
    if (!new RegExp(`<serial\\b[^>]*type='file'[\\s\\S]*?${X.logPath(d.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(xml)) missing.push('serial-log');
    if (!/<input\b[^>]*type='tablet'/.test(xml)) missing.push('tablet');
    if (d.state === 'running' && chan && !(await guestPing(d.name))) missing.push('guest-agent');
    if (tags[d.name]?.guest === 'windows' && !(agents()[d.name] && agentToken(d.name))) missing.push('vm-agent');
    return { ok: missing.length === 0 && !!tags[d.name]?.managed, managed: !!tags[d.name]?.managed, missing };
  }

  return { dirPool, chown, defineXml, poolPath, actions, vncPort, manageability, statsCache, sampleStats, statAt: () => statAt, ensureManageable, checkpoints, agents, agentToken, screenFiles, nvramOf, guestPing };
};
