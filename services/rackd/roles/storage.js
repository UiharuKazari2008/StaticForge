'use strict';
// storage: lsblk, filesystems, RAM disks (tmpfs, zram), LVM.
const fs = require('fs');
const path = require('path');
const { run, ok } = require('../lib/exec');
const { DATA, str, num, bool, RE, bad, absPath, readJson, writeJson, exists } = require('../lib/util');
const apt = require('../lib/apt');
const events = require('../lib/events');
const vmsRole = () => require('./vms');

const packages = ['lvm2', 'rsync', 'e2fsprogs', 'util-linux'];
const optional = ['zram-tools', 'xfsprogs'];
const STATE = path.join(DATA, 'ramdisks.json');
const MNT = '/mnt/ram';
const RESERVE_B = 32 * 2 ** 30;
const GB = 2 ** 30;
let disks = readJson(STATE, {});        // name -> {name, kind, sizeB, owner, backing, syncMin, persist, zramDev?}
const timers = new Map();

const save = () => writeJson(STATE, disks);
const mountOf = name => path.join(MNT, name);
const isMounted = mp => { try { return fs.readFileSync('/proc/self/mountinfo', 'utf8').split('\n').some(l => l.split(' ')[4] === mp); } catch { return false; } };

function usage(mp) { try { const s = fs.statfsSync(mp); return { sizeB: s.blocks * s.bsize, usedB: (s.blocks - s.bfree) * s.bsize }; } catch { return { sizeB: 0, usedB: 0 }; } }
function memTotal() { return events.memInfo().totalB; }
const ramdiskB = () => Object.values(disks).reduce((a, d) => a + d.sizeB, 0);

function ownerIds(owner) {
  const r = require('child_process').spawnSync('id', ['-u', owner]);
  const g = require('child_process').spawnSync('id', ['-g', owner]);
  if (r.status !== 0) throw bad(`no such user ${owner}`);
  return { uid: String(r.stdout).trim(), gid: String(g.stdout).trim() };
}
function sync(d) {
  if (!d.backing) return Promise.resolve({ ok: true, skipped: true });
  return ok(['rsync', '-a', '--delete', `${mountOf(d.name)}/`, `${d.backing}/`], { timeoutMs: 3600e3 }).then(() => ({ ok: true }));
}
function arm(d) {
  clearInterval(timers.get(d.name)); timers.delete(d.name);
  if (d.backing && d.syncMin > 0) timers.set(d.name, setInterval(() => sync(d).catch(() => {}), d.syncMin * 60000).unref());
}

async function mountTmpfs(d) {
  const mp = mountOf(d.name); const { uid, gid } = ownerIds(d.owner);
  fs.mkdirSync(mp, { recursive: true });
  if (!isMounted(mp)) await ok(['mount', '-t', 'tmpfs', '-o', `size=${d.sizeB},uid=${uid},gid=${gid},mode=0755`, `rd-${d.name}`, mp]);
  else await ok(['mount', '-o', `remount,size=${d.sizeB}`, mp]);
}
async function mountZram(d) {
  const mp = mountOf(d.name); const { uid, gid } = ownerIds(d.owner);
  fs.mkdirSync(mp, { recursive: true });
  if (isMounted(mp)) return;
  await run(['modprobe', 'zram']);
  const r = await ok(['zramctl', '--find', '--size', String(d.sizeB), '--algorithm', 'zstd']);
  d.zramDev = r.stdout.trim();
  await ok(['mkfs.ext4', '-q', '-m', '0', d.zramDev]);
  await ok(['mount', d.zramDev, mp]);
  await ok(['chown', `${uid}:${gid}`, mp]);
}
async function restore(d) {
  if (d.backing && exists(d.backing)) await run(['rsync', '-a', `${d.backing}/`, `${mountOf(d.name)}/`], { timeoutMs: 3600e3 });
  const { uid, gid } = ownerIds(d.owner);   // rsync -a copies the backing dir's owner onto the mount root: put the RAM disk owner back
  await run(['chown', `${uid}:${gid}`, mountOf(d.name)]);
}
async function umount(d) {
  const mp = mountOf(d.name);
  if (isMounted(mp)) await ok(['umount', mp]);
  if (d.zramDev) await run(['zramctl', '--reset', d.zramDev]);
  try { fs.rmdirSync(mp); } catch { /* not empty / gone */ }
}

// Called at rackd start: remount persisted disks (restoring from backing), forget non-persistent ones.
async function init() {
  for (const d of Object.values(disks)) {
    if (!d.persist && !isMounted(mountOf(d.name))) { delete disks[d.name]; continue; }
    try {
      const was = isMounted(mountOf(d.name));
      if (d.kind === 'zram') await mountZram(d); else await mountTmpfs(d);
      if (!was) await restore(d);
      arm(d);
    } catch (e) { console.error(`ramdisk ${d.name}: ${e.message}`); }
  }
  save();
}
async function syncAll(log, dryRun) { for (const d of Object.values(disks)) if (d.backing) { log(`${dryRun ? 'would sync' : 'syncing'} RAM disk ${d.name} -> ${d.backing}`); if (!dryRun) await sync(d); } }
async function shutdown() { for (const d of Object.values(disks)) { try { await sync(d); } catch { /* best effort */ } } }

async function lvmInfo() {
  const [vg, lv, mounts] = await Promise.all([
    run(['vgs', '--reportformat', 'json', '--units', 'b', '--nosuffix', '-o', 'vg_name,vg_size,vg_free,pv_count']),
    run(['lvs', '--reportformat', 'json', '--units', 'b', '--nosuffix', '-o', 'lv_name,vg_name,lv_size,lv_attr,lv_dm_path']),
    run(['lsblk', '-J', '-b', '-o', 'PATH,MOUNTPOINT,FSTYPE']),
  ]);
  const parse = r => { try { return JSON.parse(r.stdout).report[0]; } catch { return null; } };
  const byPath = {};
  try { const walk = n => { byPath[n.path] = n; (n.children || []).forEach(walk); }; JSON.parse(mounts.stdout).blockdevices.forEach(walk); } catch { /* none */ }
  const used = await vmsRole().diskSourcesInUse().catch(() => new Set());
  const vgs = (parse(vg)?.vg || []).map(v => ({ name: v.vg_name, sizeB: Number(v.vg_size), freeB: Number(v.vg_free), pvs: Number(v.pv_count) }));
  const lvs = (parse(lv)?.lv || []).map(l => {
    const dev = byPath[l.lv_dm_path] || {};
    const links = [`/dev/${l.vg_name}/${l.lv_name}`, l.lv_dm_path];
    const out = { vg: l.vg_name, name: l.lv_name, sizeB: Number(l.lv_size), open: l.lv_attr[5] === 'o' };
    if (dev.mountpoint) out.mount = dev.mountpoint;
    if (dev.fstype) out.fstype = dev.fstype;
    const by = links.find(x => used.has(x));
    if (by) out.usedBy = used.get ? used.get(by) : true;
    return out;
  });
  return { vgs, lvs };
}

module.exports = {
  id: 'storage', packages, optional, init, shutdown, syncAll,
  async detect() {
    const missing = await apt.missing(packages);
    return { installed: !missing.length, ready: !missing.length, summary: `${Object.keys(disks).length} RAM disk(s), ${(ramdiskB() / GB).toFixed(1)} GB of ${(memTotal() / GB).toFixed(0)} GB RAM in RAM disks`, missing };
  },
  async get() {
    const [lsblk, df, lvm] = await Promise.all([
      run(['lsblk', '-J', '-b', '-o', 'NAME,SIZE,TYPE,MODEL,MOUNTPOINT,FSTYPE']),
      run(['df', '-B1', '-P', '-x', 'tmpfs', '-x', 'devtmpfs', '-x', 'squashfs', '-x', 'overlay']),
      lvmInfo(),
    ]);
    let tree = []; try { tree = JSON.parse(lsblk.stdout).blockdevices; } catch { /* none */ }
    const filesystems = df.stdout.split('\n').slice(1).filter(Boolean).map(l => { const f = l.split(/\s+/); return { mount: f[5], fstype: null, sizeB: Number(f[1]), usedB: Number(f[2]), availB: Number(f[3]), device: f[0] }; });
    const types = {}; for (const l of (await run(['findmnt', '-rn', '-o', 'TARGET,FSTYPE'])).stdout.split('\n')) { const [t, f] = l.split(' '); if (t) types[t] = f; }
    for (const f of filesystems) f.fstype = types[f.mount] || null;
    let arrays = []; try { arrays = fs.readFileSync('/proc/mdstat', 'utf8').split('\n').filter(l => /^md\d+/.test(l)).map(l => ({ name: l.split(' ')[0], line: l })); } catch { /* no md */ }
    const rds = Object.values(disks).map(d => {
      const mp = mountOf(d.name); const u = usage(mp);
      return { name: d.name, kind: d.kind, sizeB: d.sizeB, usedB: u.usedB, mount: mp, owner: d.owner, backing: d.backing, syncMin: d.syncMin, persist: d.persist, mounted: isMounted(mp) };
    });
    return { disks: tree, filesystems, arrays, ramdisks: rds, memory: { ...events.memInfo(), ramdiskB: ramdiskB() }, ...lvm };
  },
  actions: {
    async 'ramdisk-create'(p) {
      const name = str(p.name, 'name', RE.name);
      if (disks[name]) throw bad('RAM disk exists already', 'EXISTS');
      const sizeB = Math.round(num(p.sizeGB, 'sizeGB', 0.01, 100000) * GB);
      const kind = p.kind === undefined ? 'tmpfs' : p.kind;
      if (kind !== 'tmpfs' && kind !== 'zram') throw bad("kind must be 'tmpfs' or 'zram'");
      const owner = str(p.owner === undefined ? 'rack' : p.owner, 'owner', RE.user);
      if (ramdiskB() + sizeB > memTotal() - RESERVE_B) throw bad(`RAM disks may not take more than total RAM minus 32 GB (in use ${(ramdiskB() / GB).toFixed(1)} GB)`, 'RAM_GUARD');
      const d = { name, kind, sizeB, owner, persist: bool(p.persist, true) };
      if (p.backing) { d.backing = absPath(p.backing, 'backing'); d.syncMin = p.syncMin ? num(p.syncMin, 'syncMin', 1, 1440) : 0; fs.mkdirSync(d.backing, { recursive: true }); }
      if (isMounted(mountOf(name))) throw bad('mount point is in use', 'EXISTS');
      if (kind === 'zram') await mountZram(d); else await mountTmpfs(d);
      await restore(d);
      disks[name] = d; save(); arm(d);
      events.emit('storage', 'added', name, { name, sizeB, kind });
      return { name, mount: mountOf(name), sizeB };
    },
    async 'ramdisk-resize'(p) {
      const d = disks[str(p.name, 'name', RE.name)]; if (!d) throw bad('no such RAM disk', 'NOT_FOUND');
      const sizeB = Math.round(num(p.sizeGB, 'sizeGB', 0.01, 100000) * GB);
      if (d.kind !== 'tmpfs') throw bad('only tmpfs RAM disks can be resized');
      if (ramdiskB() - d.sizeB + sizeB > memTotal() - RESERVE_B) throw bad('RAM disks may not take more than total RAM minus 32 GB', 'RAM_GUARD');
      if (sizeB < usage(mountOf(d.name)).usedB) throw bad('smaller than the data in it');
      d.sizeB = sizeB; await mountTmpfs(d); save();
      events.emit('storage', 'state', d.name, { name: d.name, sizeB });
      return { name: d.name, sizeB };
    },
    async 'ramdisk-sync'(p) {
      const d = disks[str(p.name, 'name', RE.name)]; if (!d) throw bad('no such RAM disk', 'NOT_FOUND');
      if (!d.backing) throw bad('this RAM disk has no backing directory');
      return sync(d);
    },
    async 'ramdisk-delete'(p) {
      const d = disks[str(p.name, 'name', RE.name)]; if (!d) throw bad('no such RAM disk', 'NOT_FOUND');
      if (bool(p.sync, true) && d.backing) await sync(d);
      clearInterval(timers.get(d.name)); timers.delete(d.name);
      await umount(d); delete disks[d.name]; save();
      events.emit('storage', 'removed', d.name, { name: d.name });
      return { ok: true };
    },
    async du(p) {
      const dir = absPath(p.path, 'path'); const depth = num(p.depth, 'depth', 0, 4, 1);
      const r = await run(['du', '-x', '-B1', '-d', String(depth), '--', dir], { timeoutMs: 120000 });
      if (r.code !== 0 && !r.stdout) throw bad(r.stderr.trim() || 'du failed');
      return { entries: r.stdout.split('\n').filter(Boolean).map(l => { const i = l.indexOf('\t'); return { path: l.slice(i + 1), sizeB: Number(l.slice(0, i)) }; }) };
    },
    async 'lv-create'(p) {
      const vg = str(p.vg, 'vg', RE.lv), name = str(p.name, 'name', RE.lv);
      const sizeGB = num(p.sizeGB, 'sizeGB', 0.1, 100000);
      const fsType = p.fs === undefined ? null : p.fs;
      if (fsType !== null && fsType !== 'ext4' && fsType !== 'xfs') throw bad("fs must be 'ext4', 'xfs' or null");
      const mount = p.mount ? absPath(p.mount, 'mount') : null;
      if (mount && !fsType) throw bad('mount needs fs');
      const { vgs, lvs } = await lvmInfo();
      const v = vgs.find(x => x.name === vg); if (!v) throw bad('no such volume group', 'NOT_FOUND');
      if (lvs.some(l => l.vg === vg && l.name === name)) throw bad('logical volume exists already', 'EXISTS');
      if (sizeGB * GB > v.freeB) throw bad('not enough free space in the volume group');
      await ok(['lvcreate', '-y', '-L', `${Math.round(sizeGB * 1024)}M`, '-n', name, vg]);
      const dev = `/dev/${vg}/${name}`;
      if (fsType === 'ext4') await ok(['mkfs.ext4', '-q', dev], { timeoutMs: 600000 });
      if (fsType === 'xfs') await ok(['mkfs.xfs', '-q', dev], { timeoutMs: 600000 });
      if (mount) {
        fs.mkdirSync(mount, { recursive: true });
        await ok(['mount', dev, mount]);
        fs.appendFileSync('/etc/fstab', `${dev} ${mount} ${fsType} defaults,nofail 0 2\n`);
      }
      events.emit('storage', 'added', `${vg}/${name}`, { vg, name });
      return { vg, name, device: dev };
    },
    async 'lv-resize'(p) {
      const vg = str(p.vg, 'vg', RE.lv), name = str(p.name, 'name', RE.lv);
      const sizeGB = num(p.sizeGB, 'sizeGB', 0.1, 100000);
      const { lvs } = await lvmInfo();
      const l = lvs.find(x => x.vg === vg && x.name === name); if (!l) throw bad('no such logical volume', 'NOT_FOUND');
      if (sizeGB * GB <= l.sizeB) throw bad('grow only: the new size must be larger');
      await ok(['lvextend', '-r', '-L', `${Math.round(sizeGB * 1024)}M`, `${vg}/${name}`], { timeoutMs: 600000 });
      events.emit('storage', 'state', `${vg}/${name}`, { vg, name });
      return { vg, name };
    },
    async 'lv-delete'(p) {
      const vg = str(p.vg, 'vg', RE.lv), name = str(p.name, 'name', RE.lv);
      if (p.confirm !== true) throw bad('confirm:true is required');
      const { lvs } = await lvmInfo();
      const l = lvs.find(x => x.vg === vg && x.name === name); if (!l) throw bad('no such logical volume', 'NOT_FOUND');
      if (l.mount) throw bad('mounted: unmount it first', 'IN_USE');
      if (l.usedBy) throw bad('used by a VM', 'IN_USE');
      if (l.open) throw bad('the volume is open', 'IN_USE');
      await ok(['lvremove', '-y', `${vg}/${name}`]);
      try { const dev = `/dev/${vg}/${name}`; const t = fs.readFileSync('/etc/fstab', 'utf8'); const n = t.split('\n').filter(x => !x.startsWith(`${dev} `)).join('\n'); if (n !== t) fs.writeFileSync('/etc/fstab', n); } catch { /* no fstab line */ }
      events.emit('storage', 'removed', `${vg}/${name}`, { vg, name });
      return { ok: true };
    },
  },
};
