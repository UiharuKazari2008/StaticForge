'use strict';
// rackd smoke test over an ssh tunnel:
//   ssh -N -L 127.0.0.1:18791:127.0.0.1:8791 fat-misaka &
//   node services/rackd/test/smoke.js [role ...]      (env RACKD_URL, RACKD_TOKEN_FILE)
// Runs every role's GET and the safe actions; creates and removes its own test objects (tiny VM, 1 GB LV, <=2 GB RAM disk).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { connect } = require('../lib/wsclient');

const URL_ = process.env.RACKD_URL || 'http://127.0.0.1:18791';
const TOKEN = fs.readFileSync(process.env.RACKD_TOKEN_FILE || path.join(os.homedir(), '.secrets/rackd-misaka.token'), 'utf8').trim();
const H = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const only = process.argv.slice(2);
let pass = 0, failN = 0; const sse = [];

async function api(method, p, body) {
  const r = await fetch(`${URL_}/v1/${p}`, { method, headers: H, body: body === undefined ? undefined : JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(`${method} ${p}: ${r.status} ${j.error || ''}`); e.status = r.status; e.body = j; throw e; }
  return j;
}
const get = p => api('GET', p);
const act = (role, a, body = {}) => api('POST', `${role}/${a}`, body);
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function step(name, fn) {
  const t0 = Date.now();
  try { const out = await fn(); pass++; console.log(`PASS ${name} (${Date.now() - t0} ms)${out ? ` - ${out}` : ''}`); return true; }
  catch (e) { failN++; console.log(`FAIL ${name}: ${e.message}`); return false; }
}
function assert(c, m) { if (!c) throw new Error(m || 'assertion failed'); }
async function job(j, timeoutS = 600) {
  const id = j.job.id; const t0 = Date.now();
  for (;;) {
    const { job: x } = await get(`jobs/${id}?tail=30`);
    if (x.state !== 'running') { if (x.state !== 'done') throw new Error(`job ${id} ${x.state}: ${x.log.split('\n').slice(-5).join(' | ')}`); return x; }
    if (Date.now() - t0 > timeoutS * 1000) throw new Error(`job ${id} timed out`);
    await sleep(2000);
  }
}
async function openSse() {
  const r = await fetch(`${URL_}/v1/events`, { headers: H });
  (async () => { let buf = ''; for await (const c of r.body) { buf += Buffer.from(c).toString('utf8'); let i; while ((i = buf.indexOf('\n\n')) >= 0) { const m = buf.slice(0, i).match(/^data: (.*)$/m); buf = buf.slice(i + 2); if (m) sse.push(JSON.parse(m[1])); } } })().catch(() => {});
}
const want = r => !only.length || only.includes(r);
const sawEvent = async (pred, ms = 8000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (sse.some(pred)) return true; await sleep(200); } return false; };

(async () => {
  await openSse();
  await step('info', async () => { const i = await get('info'); assert(i.roles && Object.keys(i.roles).length >= 9); return Object.entries(i.roles).map(([k, v]) => `${k}:${v.ready ? 'ready' : 'not ready'}`).join(' '); });
  await step('auth refused without token', async () => { const r = await fetch(`${URL_}/v1/info`); assert(r.status === 401); });
  for (const r of ['vms', 'android', 'sandboxes', 'terminal', 'storage', 'networking', 'services', 'logs', 'updates', 'containers', 'builds']) if (want(r)) await step(`GET ${r}`, async () => { const d = await get(r); assert(d && typeof d === 'object'); return Object.keys(d).join(','); });
  await step('jobs list', async () => { const j = await get('jobs'); assert(Array.isArray(j.jobs)); });

  if (want('terminal')) {
    await step('terminal exec', async () => { const r = await act('terminal', 'exec', { cmd: 'echo ok; id -un' }); assert(r.code === 0 && r.stdout.includes('rack')); });
    await step('tmux new/send/capture/kill', async () => {
      await act('terminal', 'tmux-new', { name: 'smoke' });
      await act('terminal', 'tmux-send', { name: 'smoke', keys: 'echo tmux-$((20+22))' }); await sleep(800);
      const c = await act('terminal', 'tmux-capture', { name: 'smoke' }); assert(c.text.includes('tmux-42'), c.text);
      assert((await get('terminal')).tmux.some(t => t.name === 'smoke'));
      await act('terminal', 'tmux-kill', { name: 'smoke' }); assert(!(await get('terminal')).tmux.some(t => t.name === 'smoke'));
    });
    await step('pty websocket round trip + resize', async () => {
      const ws = await connect(`${URL_}/v1/terminal/ws?cols=100&rows=30`, { Authorization: `Bearer ${TOKEN}` });
      let out = ''; ws.on('message', m => { out += m; });
      await sleep(1000); ws.sendText('echo pty-$((6*7)); stty size\n'); await sleep(800);
      ws.sendText(`\u0000${JSON.stringify({ t: 'resize', cols: 120, rows: 40 })}`); await sleep(300); ws.sendText('stty size\n'); await sleep(800);
      ws.close(); assert(out.includes('pty-42'), out); assert(/30 100/.test(out) && /40 120/.test(out), out);
    });
  }

  if (want('storage')) {
    await step('ramdisk create/resize/delete', async () => {
      await act('storage', 'ramdisk-create', { name: 'smoke', sizeGB: 1 });
      let s = await get('storage'); let d = s.ramdisks.find(x => x.name === 'smoke'); assert(d && d.mounted && d.sizeB === 2 ** 30);
      await act('storage', 'ramdisk-resize', { name: 'smoke', sizeGB: 2 });
      s = await get('storage'); d = s.ramdisks.find(x => x.name === 'smoke'); assert(d.sizeB === 2 * 2 ** 30);
      await act('terminal', 'exec', { cmd: 'echo x > /mnt/ram/smoke/f && cat /mnt/ram/smoke/f' });
      await act('storage', 'ramdisk-delete', { name: 'smoke' }); assert(!(await get('storage')).ramdisks.some(x => x.name === 'smoke'));
    });
    await step('ramdisk guard refuses a huge disk', async () => { try { await act('storage', 'ramdisk-create', { name: 'huge', sizeGB: 100000 }); assert(false, 'accepted'); } catch (e) { assert(e.status === 400, e.message); } });
    await step('lv create (1 GB) / resize / delete', async () => {
      await act('storage', 'lv-create', { vg: 'vmdata', name: 'rackdtest', sizeGB: 1, fs: 'ext4' });
      let s = await get('storage'); assert(s.lvs.some(l => l.name === 'rackdtest' && l.vg === 'vmdata'));
      await act('storage', 'lv-resize', { vg: 'vmdata', name: 'rackdtest', sizeGB: 2 });
      try { await act('storage', 'lv-delete', { vg: 'misaka-vg', name: 'root', confirm: true }); assert(false, 'root deleted'); } catch (e) { assert(e.status === 400, e.message); }
      await act('storage', 'lv-delete', { vg: 'vmdata', name: 'rackdtest', confirm: true });
      s = await get('storage'); assert(!s.lvs.some(l => l.name === 'rackdtest'));
    });
    await step('du', async () => { const r = await act('storage', 'du', { path: '/var/lib/rackd' }); assert(r.entries.length); });
  }

  if (want('services')) {
    await step('services status sshd', async () => { const r = await act('services', 'status', { unit: 'ssh.service' }); assert(r.props.ActiveState === 'active'); });
    await step('protected unit refused', async () => { try { await act('services', 'stop', { unit: 'ssh.service' }); assert(false, 'accepted'); } catch (e) { assert(e.status === 400, e.message); } });
    await step('define / status / undefine rack service', async () => {
      await act('services', 'define', { name: 'smoke', cmd: 'echo "$GREETING"; exec sleep 3600', env: { GREETING: 'hello' } }); await sleep(1500);
      const s = await act('services', 'status', { unit: 'rack-smoke.service' }); assert(s.props.ActiveState === 'active', JSON.stringify(s.props));
      assert((await get('services')).rack.some(r => r.name === 'smoke'));
      await act('services', 'undefine', { name: 'smoke' }); assert(!(await get('services')).rack.some(r => r.name === 'smoke'));
    });
  }

  if (want('logs')) {
    await step('logs query', async () => { const r = await get('logs?unit=ssh.service&lines=5'); assert(Array.isArray(r.entries) && r.boots.length); });
    await step('logs follow shows a log event on SSE', async () => {
      const { followId } = await act('logs', 'follow', {});
      await act('terminal', 'exec', { cmd: 'logger -t rackd-smoke follow-probe', user: 'root' });
      assert(await sawEvent(e => e.role === 'logs' && e.kind === 'log' && /follow-probe/.test(e.data.message)), 'no log event');
      await act('logs', 'unfollow', { followId });
    });
    await step('dmesg', async () => { const r = await act('logs', 'dmesg', { lines: 5 }); assert(r.lines.length); });
  }
  await step('metrics events arrive', async () => { assert(await sawEvent(e => e.kind === 'metrics', 15000)); });

  if (want('networking')) {
    await step('ping', async () => { const r = await act('networking', 'ping', { host: '127.0.0.1', count: 2 }); assert(r.received === 2); });
    await step('bridge create/delete (no ports)', async () => { await act('networking', 'bridge-create', { name: 'rtest0' }); assert((await get('networking')).bridges.some(b => b.name === 'rtest0')); await act('networking', 'bridge-delete', { name: 'rtest0' }); });
    await step('stopping the host libvirt net refused', async () => { try { await act('networking', 'libvirt-net', { name: 'br0', op: 'stop' }); assert(false, 'accepted'); } catch (e) { assert(e.status === 400, e.message); } });
  }

  if (want('updates')) {
    await step('updates check job', async () => { await job(await act('updates', 'check')); const u = await get('updates'); assert(u.lastCheck); return `${u.upgradable.length} upgradable`; });
  }

  if (want('vms')) {
    await step('vm create (no ISO) / start / screenshot / destroy / delete', async () => {
      await job(await act('vms', 'create', { name: 'rackd-smoke', vcpus: 1, memMB: 256, diskGB: 1, network: 'br0' }), 300);
      let v = (await get('vms')).vms.find(x => x.name === 'rackd-smoke'); assert(v, 'not listed');
      if (v.state !== 'running') await act('vms', 'start', { name: 'rackd-smoke' });
      await sleep(4000);
      v = (await get('vms')).vms.find(x => x.name === 'rackd-smoke'); assert(v.state === 'running', v.state);
      const s = await act('vms', 'screenshot', { name: 'rackd-smoke' }); const r = await fetch(`${URL_}/v1/files/${s.file}`, { headers: H }); assert(r.ok && (await r.arrayBuffer()).byteLength > 100, 'screenshot');
      assert(await sawEvent(e => e.role === 'vms' && e.id === 'rackd-smoke', 2000), 'no vm event');
      await act('vms', 'tag', { name: 'rackd-smoke', tags: { purpose: 'smoke' } });
      await act('vms', 'destroy', { name: 'rackd-smoke' }); await sleep(500);
      await act('vms', 'delete', { name: 'rackd-smoke', storage: true });
      assert(!(await get('vms')).vms.some(x => x.name === 'rackd-smoke'));
      return `file ${s.file}`;
    });
  }

  if (want('sandboxes')) {
    await step('sandbox create/navigate/eval/screenshot/stop/delete', async () => {
      const b = await act('sandboxes', 'create', { name: 'smoke', ramdisk: true, url: 'about:blank' }); assert(b.state === 'running', b.state);
      await act('sandboxes', 'navigate', { id: b.id, url: 'https://example.com/' });
      const ev = await act('sandboxes', 'eval', { id: b.id, expression: '1+41' }); assert(ev.value === 42);
      const t = await act('sandboxes', 'eval', { id: b.id, expression: 'document.title' }); assert(/Example/.test(t.value), t.value);
      const c = await act('sandboxes', 'cdp', { id: b.id }); assert(c.port > 9000);
      const s = await act('sandboxes', 'screenshot', { id: b.id }); const r = await fetch(`${URL_}/v1/files/${s.file}`, { headers: H }); assert(r.ok && (await r.arrayBuffer()).byteLength > 100);
      await act('sandboxes', 'stop', { id: b.id }); await act('sandboxes', 'delete', { id: b.id });
      assert(!(await get('sandboxes')).sandboxes.length);
    });
  }

  if (want('android')) {
    await step('android avd create/start/boot/screenshot/stop/delete', async () => {
      const g = await get('android'); assert(g.sdk.emulator, 'sdk not installed');
      const image = process.env.AVD_IMAGE || 'system-images;android-34;google_apis;x86_64';
      const r = await act('android', 'create', { name: 'smoke', image, ramMB: 2048, diskGB: 4 }); if (r.job) await job(r, 1800);
      const s = await act('android', 'start', { name: 'smoke', wait: true, timeoutS: 420 }); assert(s.booted, `did not boot: ${s.output || s.boot}`);
      const shot = await act('android', 'screenshot', { name: 'smoke' }); assert(shot.file);
      const sh = await act('android', 'shell', { name: 'smoke', cmd: 'getprop ro.build.version.sdk' }); assert(sh.code === 0);
      await act('android', 'stop', { name: 'smoke' }); await act('android', 'delete', { name: 'smoke' });
      return `api ${sh.out.trim()}`;
    });
  }
  console.log(`\n${pass} passed, ${failN} failed`);
  process.exit(failN ? 1 : 0);
})();
