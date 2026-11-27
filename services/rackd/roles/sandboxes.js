'use strict';
// sandboxes: Chromium instances (user rack) with a CDP port, own profile (optionally on a RAM disk).
const fs = require('fs');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { run } = require('../lib/exec');
const { DATA, str, num, bool, RE, bad, absPath, readJson, writeJson, rid, sleep, exists } = require('../lib/util');
const apt = require('../lib/apt');
const events = require('../lib/events');
const files = require('../lib/files');
const cdp = require('../lib/cdp');
const storage = require('./storage');

const packages = ['chromium', 'fonts-liberation', 'fonts-noto-color-emoji'];
const STATE = path.join(DATA, 'sandboxes.json');
const DIR = path.join(DATA, 'sandboxes');
const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
let boxes = readJson(STATE, []);
const procs = new Map(); // id -> child
const save = () => writeJson(STATE, boxes);
const find = id => { const b = boxes.find(x => x.id === str(id, 'id', /^sbx-[0-9a-f]{6}$/)); if (!b) throw bad('no such sandbox', 'NOT_FOUND'); return b; };
const alive = b => procs.has(b.id);

function freePort() {
  return new Promise((resolve, reject) => {
    const used = new Set(boxes.map(b => b.cdpPort));
    const tryPort = p => {
      if (p > 9499) return reject(bad('no free CDP port'));
      if (used.has(p)) return tryPort(p + 1);
      const s = net.createServer(); s.once('error', () => tryPort(p + 1)); s.listen(p, '127.0.0.1', () => s.close(() => resolve(p)));
    };
    tryPort(9400);
  });
}
async function browserPath() { const r = await run(['which', 'chromium']); return r.code === 0 ? r.stdout.trim() : null; }

function init() { for (const b of boxes) if (b.state === 'running') b.state = 'stopped', b.pid = null; save(); }
async function shutdown() { for (const c of procs.values()) { try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ } } }

async function startBox(b) {
  if (alive(b)) return;
  const exe = await browserPath(); if (!exe) throw bad('chromium is not installed (install the sandboxes role)', 'NOT_INSTALLED');
  b.cdpPort = await freePort();
  fs.mkdirSync(b.profile, { recursive: true });
  await run(['chown', 'rack:rack', b.profile]);
  const args = ['--headless=new', `--remote-debugging-port=${b.cdpPort}`, '--remote-debugging-address=127.0.0.1', `--user-data-dir=${b.profile}`,
    `--window-size=${b.viewport.w},${b.viewport.h}`, `--force-device-scale-factor=${b.viewport.dpr}`, '--no-first-run', '--no-default-browser-check', '--disable-gpu', '--disable-dev-shm-usage', '--no-sandbox', '--disable-background-networking'];
  if (b.viewport.mobile) args.push(`--user-agent=${MOBILE_UA}`, '--touch-events=enabled');
  args.push(b.url || 'about:blank');
  const child = spawn('runuser', ['-u', 'rack', '--', 'env', 'HOME=/var/lib/rack', 'DBUS_SESSION_BUS_ADDRESS=unix:path=/nonexistent', 'chromium', ...args], { detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  procs.set(b.id, child); b.pid = child.pid;
  child.on('exit', () => { procs.delete(b.id); b.state = 'stopped'; b.pid = null; save(); events.emit('sandboxes', 'state', b.id, { id: b.id, state: 'stopped' }); });
  for (let i = 0; i < 160; i++) {
    if (!alive(b)) throw bad('chromium exited at start', 'START_FAILED');
    try { await cdp.getJson(b.cdpPort, '/json/version', 1000); b.state = 'running'; save(); events.emit('sandboxes', 'state', b.id, { id: b.id, state: 'running' }); return; } catch { await sleep(250); }
  }
  throw bad('chromium did not open its debug port', 'START_FAILED');
}
async function stopBox(b) {
  const c = procs.get(b.id); if (!c) { b.state = 'stopped'; return; }
  try { process.kill(-c.pid, 'SIGTERM'); } catch { /* gone */ }
  for (let i = 0; i < 40 && procs.has(b.id); i++) await sleep(250);
  if (procs.has(b.id)) { try { process.kill(-c.pid, 'SIGKILL'); } catch { /* gone */ } await sleep(300); }
  b.state = 'stopped'; b.pid = null; save();
}
async function withPage(b, fn) {
  if (!alive(b)) throw bad('the sandbox is not running', 'NOT_RUNNING');
  const t = await cdp.pageTarget(b.cdpPort);
  const s = await cdp.session(t.webSocketDebuggerUrl);
  try {
    await s.send('Page.enable');
    if (b.viewport.mobile) { await s.send('Emulation.setDeviceMetricsOverride', { width: b.viewport.w, height: b.viewport.h, deviceScaleFactor: b.viewport.dpr, mobile: true }); await s.send('Emulation.setUserAgentOverride', { userAgent: MOBILE_UA }); }
    return await fn(s);
  } finally { s.close(); }
}
const pub = b => ({ id: b.id, name: b.name, state: alive(b) ? b.state : 'stopped', pid: b.pid, cdpPort: alive(b) ? b.cdpPort : null, profile: b.profile, ramdisk: b.ramdisk ? true : false, url: b.url, viewport: b.viewport, createdAt: b.createdAt });

module.exports = {
  id: 'sandboxes', packages, init, shutdown,
  count: () => procs.size,
  async busy() { return boxes.filter(alive).map(b => ({ kind: 'sandbox', id: b.id, why: 'running' })); },
  async stopAll(log, dryRun) { for (const b of boxes.filter(alive)) { log(`${dryRun ? 'would stop' : 'stopping'} sandbox ${b.id}`); if (!dryRun) await stopBox(b); } },
  async detect() {
    const missing = await apt.missing(packages); const exe = await browserPath();
    let ver = null; if (exe) ver = (await run([exe, '--version'])).stdout.trim();
    return { installed: !missing.length, ready: !!exe, summary: exe ? `${ver}, ${boxes.filter(alive).length}/${boxes.length} running` : 'no browser', missing };
  },
  async get() {
    const exe = await browserPath();
    return { browser: { path: exe, version: exe ? (await run([exe, '--version'])).stdout.trim() : null }, sandboxes: boxes.map(pub) };
  },
  actions: {
    async create(p) {
      const name = str(p.name, 'name', RE.name);
      const vp = p.viewport || {};
      const viewport = { w: num(vp.w, 'viewport.w', 200, 7680, 1280), h: num(vp.h, 'viewport.h', 200, 4320, 800), dpr: num(vp.dpr, 'viewport.dpr', 0.5, 5, 1), mobile: bool(vp.mobile, false) };
      const url = p.url ? str(p.url, 'url', /^https?:\/\/[^\s]+$|^about:blank$/, 2000) : null;
      const id = `sbx-${rid(3)}`;
      let ramdisk = null, profile = path.join(DIR, id, 'profile');
      if (bool(p.ramdisk, true)) {
        ramdisk = id;
        await storage.actions['ramdisk-create']({ name: id, sizeGB: num(p.ramdiskGB, 'ramdiskGB', 0.1, 64, 1), owner: 'rack', persist: false });
        profile = `/mnt/ram/${id}/profile`;
      } else { fs.mkdirSync(path.join(DIR, id), { recursive: true }); await run(['chown', 'rack:rack', path.join(DIR, id)]); }
      const b = { id, name, state: 'stopped', pid: null, cdpPort: null, profile, ramdisk, url, viewport, headless: true, createdAt: new Date().toISOString() };
      boxes.push(b); save();
      events.emit('sandboxes', 'added', id, pub(b));
      if (bool(p.start, true)) await startBox(b);
      return pub(b);
    },
    async start(p) { const b = find(p.id); await startBox(b); return pub(b); },
    async stop(p) { const b = find(p.id); await stopBox(b); return pub(b); },
    async delete(p) {
      const b = find(p.id); await stopBox(b);
      if (b.ramdisk) await storage.actions['ramdisk-delete']({ name: b.ramdisk, sync: false }).catch(() => {});
      else await run(['rm', '-rf', path.join(DIR, b.id)]);
      boxes = boxes.filter(x => x !== b); save();
      events.emit('sandboxes', 'removed', b.id, { id: b.id });
      return { ok: true };
    },
    async navigate(p) {
      const b = find(p.id); const url = str(p.url, 'url', /^https?:\/\/[^\s]+$|^about:blank$/, 2000);
      await withPage(b, async s => { const load = s.waitFor('Page.loadEventFired', 20000); const r = await s.send('Page.navigate', { url }); if (r.errorText) throw bad(`navigation failed: ${r.errorText}`, 'NAV'); await load; });
      b.url = url; save(); events.emit('sandboxes', 'state', b.id, { id: b.id, url });
      return { url };
    },
    async screenshot(p) {
      const b = find(p.id); const f = files.newPath('shots', b.id, 'png');
      await withPage(b, async s => { const r = await s.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(f.abs, Buffer.from(r.data, 'base64')); });
      return { file: f.file };
    },
    async cdp(p) {
      const b = find(p.id); if (!alive(b)) throw bad('the sandbox is not running', 'NOT_RUNNING');
      const v = await cdp.getJson(b.cdpPort, '/json/version'); const t = await cdp.pageTarget(b.cdpPort);
      return { port: b.cdpPort, wsPath: new URL(v.webSocketDebuggerUrl).pathname, pagePath: new URL(t.webSocketDebuggerUrl).pathname };
    },
    async eval(p) {
      const b = find(p.id); const expression = str(p.expression, 'expression', null, 100000);
      return withPage(b, async s => {
        const r = await s.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (r.exceptionDetails) throw bad(`script error: ${r.exceptionDetails.exception?.description || r.exceptionDetails.text}`, 'EVAL');
        return { value: r.result.value ?? null, type: r.result.type };
      });
    },
  },
};
