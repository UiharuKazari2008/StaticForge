'use strict';
// What runs on the host, however it was started, and whether Rack Manager can see and drive it.
//  - a /proc sampler (every 30 s, rackd's own history cadence; no child process) that notices any process using about one core or more
//    over 5 minutes (its CPU time between the first and last sample of a 5 minute window);
//  - classify(): that process is explained by a VM, an emulator, a container, a rackd job or exec, a tmux session or a rack service, or it is
//    `unmanaged` (pid, user, command head) and keeps the host awake;
//  - inventory(): every VM, AVD, sandbox, container, replica, build, tmux session and unmanaged process with `manageable` and `missing`.
const fs = require('fs');
const { run } = require('./exec');
const jobs = require('./jobs');

const STEP_MS = 30000, NEED_MS = 270000;    // a 5 minute window, judged from samples at least 4.5 minutes apart
const BTIME = (() => { try { return Number((fs.readFileSync('/proc/stat', 'utf8').match(/^btime (\d+)/m) || [])[1]) || 0; } catch { return 0; } })();
const CORE = 0.9;                                                // "over one core": a single busy thread can reach 1.0, never more
const TICKS = 100;                                               // CLK_TCK on Linux
const SYSTEM = new Set(['dockerd', 'containerd', 'containerd-shim-runc-v2', 'libvirtd', 'virtqemud', 'virtlogd', 'systemd', 'systemd-journald', 'rackd']);
let roles = {}, hist = new Map(), timer = null, found = [], lastUnmanaged = [];

function readProc(pid) {
  let stat; try { stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); } catch { return null; }
  const rp = stat.lastIndexOf(')'); if (rp < 0) return null;
  const f = stat.slice(rp + 2).split(' ');                       // f[0] = state, f[1] = ppid, f[11] utime, f[12] stime, f[19] starttime
  return { pid, comm: stat.slice(stat.indexOf('(') + 1, rp), ppid: Number(f[1]), ticks: Number(f[11]) + Number(f[12]), start: Number(f[19]) };
}
function pids() { try { return fs.readdirSync('/proc').filter(x => /^\d+$/.test(x)).map(Number); } catch { return []; } }
function cmdline(pid) { try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean); } catch { return []; } }
function userOf(pid) {
  try {
    const uid = (fs.readFileSync(`/proc/${pid}/status`, 'utf8').match(/^Uid:\s+(\d+)/m) || [])[1];
    const pw = fs.readFileSync('/etc/passwd', 'utf8').split('\n').map(l => l.split(':')).find(p => p[2] === uid);
    return pw ? pw[0] : uid;
  } catch { return '?'; }
}
const cgroupOf = pid => { try { return fs.readFileSync(`/proc/${pid}/cgroup`, 'utf8').trim(); } catch { return ''; } };

// One sampling step: every process keeps its last samples while it stays above 0.3 core; a calmer step starts its 5 minutes again.
function sample() {
  const now = Date.now(); const seen = new Set();
  for (const pid of pids()) {
    const p = readProc(pid); if (!p) continue;
    seen.add(pid);
    const h = hist.get(pid);
    if (!h || h.start !== p.start) {
      // first sight (rackd just started): a process older than the window and at about one core over its whole life is judged at once, so a rackd restart does not forget
      const age = now - (BTIME + p.start / TICKS) * 1000;
      const seed = age >= NEED_MS && p.ticks / TICKS / (age / 1000) >= CORE ? [{ t: now - age, ticks: 0 }, { t: now, ticks: p.ticks }] : [{ t: now, ticks: p.ticks }];
      hist.set(pid, { start: p.start, s: seed }); continue;
    }
    const last = h.s[h.s.length - 1]; const dt = (now - last.t) / 1000;
    const rate = dt > 0 ? (p.ticks - last.ticks) / TICKS / dt : 0;
    if (rate < 0.3) h.s = [{ t: now, ticks: p.ticks }];
    else { h.s.push({ t: now, ticks: p.ticks }); while (h.s.length > 14) h.s.shift(); }
  }
  for (const pid of [...hist.keys()]) if (!seen.has(pid)) hist.delete(pid);
  found = [];
  for (const [pid, h] of hist) {
    if (h.s.length < 2) continue;
    const a = h.s[0], b = h.s[h.s.length - 1]; const span = b.t - a.t;
    if (span < NEED_MS) continue;
    const cores = (b.ticks - a.ticks) / TICKS / (span / 1000);
    if (cores >= CORE) found.push({ pid, cores: Math.round(cores * 100) / 100, forS: Math.round(span / 1000) });
  }
  scan().then(s => { lastUnmanaged = s.unmanaged; }).catch(() => {});   // what the Load History "Running" strip and the info report count
}

async function tmuxPanes() {
  const out = [];
  for (const user of ['rack', 'root']) {
    const r = await run(['tmux', 'list-panes', '-a', '-F', '#{session_name} #{pane_pid}'], { user: user === 'root' ? undefined : user, timeoutMs: 5000 });
    if (r.code === 0) for (const l of r.stdout.split('\n').filter(Boolean)) { const [n, p] = l.split(' '); out.push({ session: n, pid: Number(p) }); }
  }
  return out;
}
function ancestors(pid) { const out = []; let p = pid; for (let i = 0; i < 40 && p > 1; i++) { const r = readProc(p); if (!r) break; out.push(r); p = r.ppid; } return out; }

// Who explains this process: { by, why } or null (unmanaged).
async function explain(pid, ctx) {
  const argv = cmdline(pid); const cg = cgroupOf(pid); const chain = ancestors(pid);
  const head = argv.join(' ');
  if (/qemu-system/.test(argv[0] || '')) {
    const i = argv.indexOf('-avd');
    if (i >= 0) return roles.android && roles.android.knows && roles.android.knows(argv[i + 1]) ? { by: 'avd', why: `emulator ${argv[i + 1]}` } : null;   // an emulator rackd lost track of is unmanaged
    return argv.some(a => /guest=/.test(a)) && /machine-qemu|libvirt/.test(cg) ? { by: 'vm', why: 'libvirt domain' } : null;
  }
  const dk = cg.match(/docker-([0-9a-f]{12})/) || cg.match(/\/docker\/([0-9a-f]{12})/);
  if (dk) return { by: 'container', why: `container ${ctx.containers.get(dk[1]) || dk[1]}` };
  if (chain.some(c => c.comm.startsWith('containerd-shim'))) return { by: 'container', why: 'container process' };
  const un = cg.match(/(rack-[A-Za-z0-9_.-]+\.service)/); if (un) return { by: 'service', why: un[1] };
  if (/(^|\/)(docker\.service|containerd\.service|libvirtd\.service|virtqemud\.service)/.test(cg)) return { by: 'system', why: 'host infrastructure' };
  if (SYSTEM.has(chain[0] && chain[0].comm) && /rackd|dockerd|libvirtd|containerd/.test(head)) return { by: 'system', why: 'host infrastructure' };
  const rackd = chain.find(c => c.pid === process.pid);
  if (rackd) {
    const running = jobs.list().filter(j => j.state === 'running');
    return { by: running.length ? 'job' : 'exec', why: running.length ? `rackd job ${running[0].title || running[0].id}` : 'rackd exec (terminal role)' };
  }
  if (/\/rackd\.service$/m.test(cg)) return { by: 'rackd', why: 'started by rackd' };
  const panes = ctx.panes || (ctx.panes = await tmuxPanes());
  const pane = panes.find(pn => chain.some(c => c.pid === pn.pid));
  if (pane) return { by: 'tmux', why: `tmux session ${pane.session}` };
  return null;
}

async function dockerNames() {
  const m = new Map();
  const r = await run(['docker', 'ps', '--format', '{{.ID}} {{.Names}}'], { timeoutMs: 8000 });
  if (r.code === 0) for (const l of r.stdout.split('\n').filter(Boolean)) { const [i, n] = l.split(' '); m.set(i, n); }
  return m;
}

// Strays: qemu processes that are neither a libvirt domain nor an emulator of a known AVD name are unmanaged at once (a VM nobody can drive);
// processes at about one core or more for 5 minutes are unmanaged unless something above explains them.
async function scan() {
  const containers = await dockerNames(); const ctx = { containers };
  const managed = [], unmanaged = [];
  const all = new Set(found.map(f => f.pid));
  for (const pid of pids()) { const a = cmdline(pid)[0] || ''; if (/qemu-system/.test(a)) all.add(pid); }
  for (const pid of all) {
    const argv = cmdline(pid); if (!argv.length) continue;
    const f = found.find(x => x.pid === pid);
    const ex = await explain(pid, ctx);
    const item = { pid, user: userOf(pid), cmd: argv.join(' ').slice(0, 160), ...(f ? { cores: f.cores, forS: f.forS } : {}) };
    if (ex) { if (f) managed.push({ ...item, by: ex.by, why: ex.why }); continue; }
    unmanaged.push({ ...item, why: f ? `${f.cores} core(s) for ${Math.round(f.forS / 60)} min` : 'a qemu process that is not a libvirt domain or a known emulator' });
  }
  return { managed, unmanaged };
}

// Busy items beyond the roles' own: every libvirt domain, qemu / emulator process, running container, running job, tmux session with recent
// output (30 min), and the heavy processes above.
async function busyExtras() {
  const busy = [];
  const { managed, unmanaged } = await scan();
  const dom = await run(['virsh', '-c', 'qemu:///system', 'list', '--name'], { timeoutMs: 10000 });
  if (dom.code === 0) for (const n of dom.stdout.split('\n').map(s => s.trim()).filter(Boolean)) busy.push({ kind: 'vm', id: n, why: 'running (libvirt domain)' });
  const ct = await run(['docker', 'ps', '--format', '{{.Names}}'], { timeoutMs: 8000 });
  if (ct.code === 0) for (const n of ct.stdout.split('\n').filter(Boolean)) busy.push({ kind: 'container', id: n, why: 'running' });
  for (const j of jobs.list()) if (j.state === 'running') busy.push({ kind: 'job', id: j.id, why: j.title });
  for (const q of procsByName(/qemu-system/)) if (q.avd) busy.push({ kind: 'avd', id: q.avd, why: 'emulator process' });
  for (const m of managed) busy.push({ kind: 'work', id: `pid ${m.pid}`, why: `${m.cores} core(s) for ${Math.round(m.forS / 60)} min: ${m.why}` });
  for (const u of unmanaged) busy.push({ kind: 'unmanaged', id: `pid ${u.pid}`, why: `${u.user}: ${u.cmd.slice(0, 80)} (${u.why})` });
  return { busy, unmanaged };
}
function procsByName(re) {
  const out = [];
  for (const pid of pids()) { const a = cmdline(pid); if (!a.length || !re.test(a[0])) continue; const i = a.indexOf('-avd'); out.push({ pid, avd: i >= 0 ? a[i + 1] : null }); }
  return out;
}

// The full inventory for Fleet / the console.
async function inventory() {
  const g = async id => { try { return roles[id] ? await roles[id].get({}) : null; } catch { return null; } };
  const [vms, android, sandboxes, containers, builds, terminal] = await Promise.all(['vms', 'android', 'sandboxes', 'containers', 'builds', 'terminal'].map(g));
  const items = [];
  for (const v of (vms && vms.vms) || []) if (v.state === 'running') items.push({ kind: 'vm', id: v.name, state: v.state, manageable: v.manageable === undefined ? null : !!v.manageable, missing: v.missing || (v.manageable === undefined ? ['the VM role reports no manageable field (guest agent not checked)'] : []), tags: v.tags });
  for (const a of (android && android.avds) || []) if (a.running) items.push({ kind: 'avd', id: a.name, backend: a.backend, state: a.boot, serial: a.serial, manageable: !!a.manageable, missing: a.missing || [], ...(a.lane ? { lane: a.lane } : {}) });
  for (const s of (sandboxes && sandboxes.sandboxes) || []) if (s.state === 'running') items.push({ kind: 'sandbox', id: s.name || s.id, state: s.state, manageable: true, missing: [] });
  for (const c of (containers && containers.containers) || []) if (/^running|^up/i.test(c.state || c.status || '')) items.push({ kind: (c.labels && c.labels['rack.replica']) || /rack\.replica/.test(JSON.stringify(c.labels || '')) ? 'replica' : 'container', id: c.name, state: c.state, manageable: true, missing: [] });
  for (const r of (builds && builds.runs) || []) if (r.state === 'running') items.push({ kind: 'build', id: r.id, pipeline: r.pipeline, state: r.state, manageable: true, missing: [] });
  for (const j of jobs.list()) if (j.state === 'running') items.push({ kind: 'job', id: j.id, role: j.role, title: j.title, state: j.state, manageable: true, missing: [] });
  for (const t of (terminal && terminal.tmux) || []) items.push({ kind: 'tmux', id: t.name, state: t.attached ? 'attached' : 'detached', manageable: true, missing: [] });
  const { managed, unmanaged } = await scan();
  for (const u of unmanaged) items.push({ kind: 'unmanaged', id: `pid ${u.pid}`, user: u.user, cmd: u.cmd, cores: u.cores, state: 'running', manageable: false, missing: ['not started through Rack Manager', 'adopt: stop it and start it as a rackd job, a tmux session (terminal tmux-new), a container or a rack service'] });
  return { at: new Date().toISOString(), items, managedHeavy: managed, unmanaged, counts: items.reduce((o, i) => { o[i.kind] = (o[i.kind] || 0) + 1; return o; }, {}), unmanageable: items.filter(i => i.manageable === false).map(i => `${i.kind} ${i.id}`) };
}

const unmanagedNow = async () => (await scan()).unmanaged;
function init(rolesMap) { roles = rolesMap; if (!timer) { sample(); timer = setInterval(() => { try { sample(); } catch { /* /proc raced */ } }, STEP_MS); timer.unref(); } }
const unmanagedCount = () => lastUnmanaged.length;
module.exports = { init, unmanagedCount, busyExtras, inventory, unmanagedNow, _sample: sample, _found: () => found };
