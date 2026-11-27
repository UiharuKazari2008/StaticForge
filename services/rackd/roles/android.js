'use strict';
// android: SDK at /opt/android-sdk, AVDs in DATA/avd, everything user-level as `rack`.
// Each AVD record has a `backend` ('sdk-emulator' today; 'cuttlefish' / 'libvirt' reserved, see docs/rack-manager/android-no-avx.md).
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { run } = require('../lib/exec');
const { DATA, str, num, bool, RE, bad, absPath, readJson, writeJson, sleep, exists } = require('../lib/util');
const apt = require('../lib/apt');
const jobs = require('../lib/jobs');
const events = require('../lib/events');
const files = require('../lib/files');
const storage = require('./storage');

const packages = ['openjdk-21-jdk-headless', 'unzip', 'libpulse0', 'libnss3', 'libx11-6', 'libxkbfile1', 'libgl1', 'libxcomposite1', 'libxcursor1', 'libxdamage1', 'libxi6', 'libxtst6', 'libasound2t64', 'libdbus-1-3', 'libxrandr2', 'libxfixes3'];
const SDK = '/opt/android-sdk';
const AVD_HOME = path.join(DATA, 'avd');
const META = path.join(DATA, 'android.json');
const CMDLINE_URL = 'https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip';
const SUGGESTED = ['system-images;android-37.0;google_apis;x86_64', 'system-images;android-36;google_apis;x86_64', 'system-images;android-34;google_apis;x86_64', 'system-images;android-30;google_apis;x86_64'];
const JAVA = { JAVA_HOME: '/usr/lib/jvm/java-21-openjdk-amd64' };
const sdkEnv = () => ({ ANDROID_SDK_ROOT: SDK, ANDROID_HOME: SDK, ANDROID_AVD_HOME: AVD_HOME, ...JAVA });
const bin = (...p) => path.join(SDK, ...p);
const adbBin = () => bin('platform-tools', 'adb');
const sdkmanager = () => bin('cmdline-tools', 'latest', 'bin', 'sdkmanager');
const asRack = (argv, o = {}) => run(argv, { user: 'rack', env: { ...sdkEnv(), ...(o.env || {}) }, ...o, env: { ...sdkEnv(), ...(o.env || {}) } });

let meta = readJson(META, {});            // name -> {backend, emulator (build dir), ramdiskName}
const live = new Map();                   // name -> {child, consolePort, boot, ramdisk}
const saveMeta = () => writeJson(META, meta);
const emuDir = name => meta[name]?.emulator || bin('emulator');

function ini(file) { const o = {}; try { for (const l of fs.readFileSync(file, 'utf8').split('\n')) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i).trim()] = l.slice(i + 1).trim(); } } catch { /* none */ } return o; }
function avdDir(name) { const i = ini(path.join(AVD_HOME, `${name}.ini`)); return i.path || path.join(AVD_HOME, `${name}.avd`); }
function avdNames() { try { return fs.readdirSync(AVD_HOME).filter(f => f.endsWith('.ini')).map(f => f.slice(0, -4)); } catch { return []; } }
const avdExists = n => avdNames().includes(n);
function must(n) { const name = str(n, 'name', RE.name); if (!avdExists(name)) throw bad('no such AVD', 'NOT_FOUND'); return name; }
function sizeOf(f) { try { return fs.statSync(f).blocks * 512; } catch { return 0; } }

function freePorts() {
  return new Promise(resolve => {
    const used = new Set([...live.values()].map(l => l.consolePort));
    const tryP = p => {
      if (p > 5584) return resolve(null);
      if (used.has(p)) return tryP(p + 2);
      const s = net.createServer(); s.once('error', () => tryP(p + 2));
      s.listen(p, '127.0.0.1', () => s.close(() => { const s2 = net.createServer(); s2.once('error', () => tryP(p + 2)); s2.listen(p + 1, '127.0.0.1', () => s2.close(() => resolve(p))); }));
    };
    tryP(5554);
  });
}
async function kvmUsable() {
  if (!exists('/dev/kvm')) return false;
  const r = await run(['id', '-nG', 'rack']); return /\bkvm\b/.test(r.stdout);
}
const serialOf = l => `emulator-${l.consolePort}`;

function describe(name, l) {
  const c = ini(path.join(avdDir(name), 'config.ini'));
  const sys = c['image.sysdir.1'] || ''; const apiM = sys.match(/android-(\d+(?:\.\d+)?)/);
  return {
    name, api: apiM ? Number(apiM[1]) : null, abi: c['abi.type'] || null, device: c['hw.device.name'] || null,
    ramMB: Number(c['hw.ramSize']) || null, diskB: sizeOf(path.join(avdDir(name), 'userdata-qemu.img')) + sizeOf(path.join(avdDir(name), 'sdcard.img')),
    backend: meta[name]?.backend || 'sdk-emulator', emulator: meta[name]?.emulator ? path.basename(meta[name].emulator) : 'sdk',
    running: !!l, serial: l ? serialOf(l) : null, consolePort: l ? l.consolePort : null, adbPort: l ? l.consolePort + 1 : null,
    boot: l ? l.boot : 'off', pid: l ? l.child.pid : null,
  };
}
async function installedImages() {
  const out = [];
  try { for (const api of fs.readdirSync(bin('system-images'))) for (const tag of fs.readdirSync(bin('system-images', api))) for (const abi of fs.readdirSync(bin('system-images', api, tag))) out.push(`system-images;${api};${tag};${abi}`); } catch { /* none */ }
  return out;
}
async function devices() {
  if (!exists(adbBin())) return [];
  const r = await asRack([adbBin(), 'devices', '-l'], { timeoutMs: 15000 });
  return r.stdout.split('\n').slice(1).filter(l => l.trim()).map(l => { const f = l.trim().split(/\s+/); const m = l.match(/model:(\S+)/); return { serial: f[0], state: f[1], model: m ? m[1] : null }; });
}
function liveOf(name) { const l = live.get(name); if (!l) throw bad('the AVD is not running', 'NOT_RUNNING'); return l; }
const adb = (serial, args, o) => asRack([adbBin(), '-s', serial, ...args], { timeoutMs: 60000, ...o });

async function waitBoot(name, timeoutS) {
  const l = live.get(name); const t0 = Date.now();
  while (live.get(name) === l && Date.now() - t0 < timeoutS * 1000) {
    const r = await adb(serialOf(l), ['shell', 'getprop', 'sys.boot_completed'], { timeoutMs: 10000 });
    if (r.stdout.trim() === '1') { l.boot = 'ready'; events.emit('android', 'state', name, { name, boot: 'ready' }); return true; }
    await sleep(3000);
  }
  return false;
}
async function stopAvd(name) {
  const l = live.get(name); if (!l) return;
  await adb(serialOf(l), ['emu', 'kill'], { timeoutMs: 10000 });
  for (let i = 0; i < 40 && live.has(name); i++) await sleep(250);
  if (live.has(name)) { try { process.kill(-l.child.pid, 'SIGKILL'); } catch { /* gone */ } for (let i = 0; i < 20 && live.has(name); i++) await sleep(250); }
}

module.exports = {
  id: 'android', packages,
  async install(ctx) {
    await ctx.exec(['mkdir', '-p', SDK, AVD_HOME]);
    if (!exists(sdkmanager())) {
      const tmp = '/var/lib/rackd/cmdline-tools.zip';
      await ctx.exec(['curl', '-fL', '--retry', '3', '-o', tmp, CMDLINE_URL], { timeoutMs: 900e3 });
      await ctx.exec(['rm', '-rf', `${SDK}/cmdline-tools`, `${SDK}/.cl-tmp`]);
      await ctx.exec(['unzip', '-q', '-o', tmp, '-d', `${SDK}/.cl-tmp`]);
      await ctx.exec(['mkdir', '-p', `${SDK}/cmdline-tools`]);
      await ctx.exec(['mv', `${SDK}/.cl-tmp/cmdline-tools`, `${SDK}/cmdline-tools/latest`]);
      await ctx.exec(['rm', '-rf', `${SDK}/.cl-tmp`, tmp]);
    }
    await ctx.exec(['chown', '-R', 'rack:rack', SDK, AVD_HOME]);
    ctx.log('accepting licenses');
    await ctx.run([sdkmanager(), `--sdk_root=${SDK}`, '--licenses'], { user: 'rack', env: sdkEnv(), input: 'y\n'.repeat(60), timeoutMs: 300e3 });
    await ctx.exec([sdkmanager(), `--sdk_root=${SDK}`, '--install', 'platform-tools', 'emulator'], { user: 'rack', env: sdkEnv(), input: 'y\n'.repeat(20), timeoutMs: 1800e3 });
  },
  async detect() {
    const missing = await apt.missing(packages);
    if (!exists(sdkmanager())) missing.push('android-sdk');
    else { if (!exists(adbBin())) missing.push('android-sdk-platform-tools'); if (!exists(bin('emulator', 'emulator'))) missing.push('android-sdk-emulator'); }
    const kvm = await kvmUsable();
    return { installed: !missing.length, ready: !missing.length && kvm, summary: `${avdNames().length} AVD(s), ${live.size} running, kvm ${kvm ? 'ok' : 'unavailable'}`, missing };
  },
  async get() {
    const inst = await installedImages(); const all = [...new Set([...inst, ...SUGGESTED])];
    return {
      sdk: { path: SDK, emulator: exists(bin('emulator', 'emulator')), platformTools: exists(adbBin()), emulatorBuilds: (() => { try { return fs.readdirSync('/opt/android-emulators'); } catch { return []; } })() },
      kvm: await kvmUsable(),
      avds: avdNames().map(n => describe(n, live.get(n))),
      images: all.map(p => ({ package: p, installed: inst.includes(p) })),
      devices: await devices(),
    };
  },
  count: () => live.size,
  async busy() { return [...live.keys()].map(n => ({ kind: 'avd', id: n, why: 'running' })); },
  async stopAll(log, dryRun) { for (const n of [...live.keys()]) { log(`${dryRun ? 'would stop' : 'stopping'} AVD ${n}`); if (!dryRun) await stopAvd(n); } },
  async init() { try { fs.mkdirSync(AVD_HOME, { recursive: true }); } catch { /* ignore */ } },
  async shutdown() { for (const l of live.values()) { try { process.kill(-l.child.pid, 'SIGTERM'); } catch { /* gone */ } } },
  actions: {
    async create(p) {
      const name = str(p.name, 'name', RE.name); const image = str(p.image, 'image', RE.sdkpkg);
      if (!/^system-images;/.test(image)) throw bad('image must be a system-images package');
      if (avdExists(name)) throw bad('an AVD with that name exists', 'EXISTS');
      const device = p.device ? str(p.device, 'device', /^[A-Za-z0-9_ ./-]{1,60}$/) : 'pixel_6';
      const ramMB = p.ramMB ? num(p.ramMB, 'ramMB', 512, 65536) : null, diskGB = p.diskGB ? num(p.diskGB, 'diskGB', 1, 500) : null;
      const doCreate = async c => {
        const r = await c.run([bin('cmdline-tools', 'latest', 'bin', 'avdmanager'), 'create', 'avd', '-n', name, '-k', image, '-d', device, '--force'], { user: 'rack', env: sdkEnv(), input: 'no\n', timeoutMs: 120e3 });
        if (r.code !== 0) throw bad(`avdmanager failed: ${(r.stderr || r.stdout).trim().slice(-400)}`, 'AVD');
        const cfg = path.join(avdDir(name), 'config.ini'); let t = fs.readFileSync(cfg, 'utf8');
        const set = (k, v) => { t = new RegExp(`^${k}=`, 'm').test(t) ? t.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`) : `${t.trimEnd()}\n${k}=${v}\n`; };
        if (ramMB) set('hw.ramSize', ramMB); if (diskGB) set('disk.dataPartition.size', `${diskGB}G`);
        fs.writeFileSync(cfg, t);
        meta[name] = { backend: 'sdk-emulator', ...(p.emulator ? { emulator: emuPath(p.emulator) } : {}) }; saveMeta();
        events.emit('android', 'added', name, { name });
      };
      if (!(await installedImages()).includes(image)) {
        if (!exists(sdkmanager())) throw bad('the android role is not installed', 'NOT_INSTALLED');
        return { job: jobs.start({ role: 'android', title: `create AVD ${name} (downloads ${image})`, run: async c => {
          await c.exec([sdkmanager(), `--sdk_root=${SDK}`, '--install', image], { user: 'rack', env: sdkEnv(), input: 'y\n'.repeat(20), timeoutMs: 3600e3 }); await doCreate(c);
        } }) };
      }
      let log = ''; await doCreate({ run: (a, o) => run(a, o), log: m => { log += m; } });
      return { name };
    },
    async start(p) {
      const name = must(p.name); if (live.has(name)) throw bad('already running', 'RUNNING');
      if (!(await kvmUsable())) throw bad('/dev/kvm is not usable by user rack', 'NO_KVM');
      const backend = meta[name]?.backend || 'sdk-emulator';
      if (backend !== 'sdk-emulator') throw bad(`backend ${backend} is not implemented here yet`, 'BACKEND');
      const exe = path.join(emuDir(name), 'emulator'); if (!exists(exe)) throw bad('emulator binary missing', 'NOT_INSTALLED');
      const port = await freePorts(); if (!port) throw bad('no free emulator port');
      let home = AVD_HOME, ramdiskName = null;
      if (bool(p.ramdisk, false)) {
        const need = Math.ceil((sizeOf(path.join(avdDir(name), 'userdata-qemu.img')) + sizeOf(path.join(avdDir(name), 'sdcard.img'))) / 2 ** 30 * 1.3 + 1);
        ramdiskName = `avd-${name}`;
        await storage.actions['ramdisk-create']({ name: ramdiskName, sizeGB: need, owner: 'rack', persist: false });
        const dst = `/mnt/ram/${ramdiskName}`;
        await run(['rsync', '-a', `${avdDir(name)}/`, `${dst}/${name}.avd/`], { timeoutMs: 600e3 });
        const i = fs.readFileSync(path.join(AVD_HOME, `${name}.ini`), 'utf8').replace(/^path=.*$/m, `path=${dst}/${name}.avd`).replace(/^path\.rel=.*\n?/m, '');
        fs.writeFileSync(`${dst}/${name}.ini`, i); await run(['chown', '-R', 'rack:rack', dst]); home = dst;
      }
      const gpu = p.gpu ? str(p.gpu, 'gpu', /^[a-z_]{2,30}$/) : 'swiftshader_indirect';
      const args = ['-avd', name, '-port', String(port), '-gpu', gpu, '-no-audio', '-no-boot-anim', '-no-metrics'];
      if (bool(p.headless, true)) args.push('-no-window');
      if (bool(p.wipe, false)) args.push('-wipe-data');
      for (const a of Array.isArray(p.extraArgs) ? p.extraArgs : []) args.push(str(a, 'extraArg', /^-[A-Za-z0-9_-]+$|^[A-Za-z0-9_.,=:/-]+$/, 200));
      const env = { ...sdkEnv(), ANDROID_AVD_HOME: home, ANDROID_EMULATOR_HOME: '/var/lib/rack/.android', QT_QPA_PLATFORM: 'offscreen', LD_LIBRARY_PATH: path.join(emuDir(name), 'lib64') + ':' + path.join(emuDir(name), 'lib64', 'qt', 'lib') };
      const child = spawn('runuser', ['-u', 'rack', '--', 'env', 'HOME=/var/lib/rack', ...Object.entries(env).map(([k, v]) => `${k}=${v}`), exe, ...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
      child.on('error', () => {});
      const l = { child, consolePort: port, boot: 'booting', ramdiskName, home, out: '' };
      const cap = d => { l.out = (l.out + d.toString('utf8')).slice(-8000); };
      child.stdout.on('data', cap); child.stderr.on('data', cap);
      live.set(name, l);
      child.on('exit', async (code, sig) => {
        live.delete(name);
        if (ramdiskName) { await run(['rsync', '-a', '--delete', `${home}/${name}.avd/`, `${avdDir(name)}/`], { timeoutMs: 600e3 }); await storage.actions['ramdisk-delete']({ name: ramdiskName, sync: false }).catch(() => {}); }
        events.emit('android', 'state', name, { name, boot: 'off', exit: code ?? sig });
      });
      events.emit('android', 'state', name, { name, boot: 'booting' });
      if (bool(p.wait, false)) {
        const ok = await waitBoot(name, num(p.timeoutS, 'timeoutS', 10, 1200, 300));
        if (!ok) return { ...describe(name, live.get(name)), booted: false, output: live.get(name) ? undefined : l.out.slice(-2000) };
      } else waitBoot(name, 600).catch(() => {});
      return { ...describe(name, live.get(name)), booted: live.get(name)?.boot === 'ready' };
    },
    async stop(p) { const name = must(p.name); await stopAvd(name); return { ok: true }; },
    async wipe(p) { const name = must(p.name); if (live.has(name)) throw bad('stop it first', 'RUNNING'); for (const f of ['userdata-qemu.img', 'userdata-qemu.img.qcow2', 'cache.img', 'snapshots']) await run(['rm', '-rf', path.join(avdDir(name), f)]); events.emit('android', 'state', name, { name }); return { ok: true }; },
    async delete(p) {
      const name = must(p.name); await stopAvd(name);
      await run(['rm', '-rf', avdDir(name), path.join(AVD_HOME, `${name}.ini`)]); delete meta[name]; saveMeta();
      events.emit('android', 'removed', name, { name }); return { ok: true };
    },
    async screenshot(p) {
      const name = must(p.name); const l = liveOf(name);
      let args = ['exec-out', 'screencap', '-p'];
      if (p.display !== undefined) args = ['exec-out', 'screencap', '-d', str(String(p.display), 'display', /^\d{1,20}$/), '-p'];
      let r = await adb(serialOf(l), args, { binary: true, maxBytes: 33554432 });
      if ((r.code !== 0 || r.stdout.length < 100) && p.display === undefined) {   // foldables: several displays, name one
        const ids = await adb(serialOf(l), ['shell', 'dumpsys', 'SurfaceFlinger', '--display-id'], { timeoutMs: 20000 });
        const id = (ids.stdout.match(/Display (\d+)/) || [])[1];
        if (id) r = await adb(serialOf(l), ['exec-out', 'screencap', '-d', id, '-p'], { binary: true, maxBytes: 33554432 });
      }
      if (r.code !== 0 || r.stdout.length < 100) throw bad(`screencap failed: ${(r.stderr || r.stdout.toString()).toString().trim().slice(0, 300)}`, 'ADB');
      const f = files.newPath('shots', `avd-${name}`, 'png'); fs.writeFileSync(f.abs, r.stdout); return { file: f.file };
    },
    async install(p) {
      const name = must(p.name); const l = liveOf(name);
      if (!p.apk && !p.url) throw bad('apk or url is required');
      const apk = p.apk ? absPath(p.apk, 'apk') : null; const url = p.url ? str(p.url, 'url', /^https:\/\/[^\s]+$/, 2000) : null;
      if (apk && !/\.apk$/.test(apk)) throw bad('apk must be an .apk file');
      return { job: jobs.start({ role: 'android', title: `install on ${name}`, run: async c => {
        let file = apk;
        if (url) { file = `/tmp/rackd-${Date.now()}.apk`; await c.exec(['curl', '-fL', '-o', file, url], { timeoutMs: 600e3 }); await run(['chmod', '644', file]); }
        try { await c.exec([adbBin(), '-s', serialOf(l), 'install', '-r', file], { user: 'rack', env: sdkEnv(), timeoutMs: 600e3 }); } finally { if (url) fs.unlinkSync(file); }
      } }) };
    },
    async shell(p) {
      const name = must(p.name); const l = liveOf(name); const cmd = str(p.cmd, 'cmd', null, 20000);
      const r = await adb(serialOf(l), ['shell', cmd], { timeoutMs: 120e3 });
      return { code: r.code, out: r.stdout + (r.stderr ? `\n${r.stderr}` : '') };
    },
    async sdk(p) {
      const pk = (Array.isArray(p.packages) ? p.packages : []).map(x => str(x, 'package', RE.sdkpkg));
      if (!pk.length) throw bad('packages is required');
      return { job: jobs.start({ role: 'android', title: `sdkmanager ${pk.join(' ')}`, run: async c => { await c.exec([sdkmanager(), `--sdk_root=${SDK}`, '--install', ...pk], { user: 'rack', env: sdkEnv(), input: 'y\n'.repeat(20), timeoutMs: 3600e3 }); } }) };
    },
    async adb(p) {
      const args = (Array.isArray(p.args) ? p.args : []).map(x => str(x, 'arg', null, 4000));
      if (!args.length) throw bad('args is required');
      const r = await asRack([adbBin(), ...args], { timeoutMs: 120e3 });
      return { code: r.code, out: r.stdout + (r.stderr ? `\n${r.stderr}` : '') };
    },
    // Install an archived emulator build next to the SDK one: /opt/android-emulators/<build> (job).
    async 'emulator-build'(p) {
      const build = str(p.build, 'build', /^\d{6,10}$/);
      return { job: jobs.start({ role: 'android', title: `archived emulator ${build}`, run: async c => {
        const dir = '/opt/android-emulators'; const tmp = `${dir}/.emu-${build}.zip`;
        await c.exec(['mkdir', '-p', dir]);
        await c.exec(['curl', '-fL', '--retry', '3', '-o', tmp, `https://dl.google.com/android/repository/emulator-linux_x64-${build}.zip`], { timeoutMs: 900e3 });
        await c.exec(['rm', '-rf', `${dir}/.x-${build}`]); await c.exec(['unzip', '-q', '-o', tmp, '-d', `${dir}/.x-${build}`]);
        await c.exec(['mv', `${dir}/.x-${build}/emulator`, `${dir}/${build}`]); await c.exec(['rm', '-rf', `${dir}/.x-${build}`, tmp]);
        await c.exec(['chown', '-R', 'rack:rack', dir]);
        // the archived build needs the SDK's skins/ and package metadata beside it
        c.log(`installed ${dir}/${build}`);
      } }) };
    },
  },
};
function emuPath(build) { const b = str(build, 'emulator', /^(sdk|\d{6,10})$/); return b === 'sdk' ? bin('emulator') : `/opt/android-emulators/${b}`; }
