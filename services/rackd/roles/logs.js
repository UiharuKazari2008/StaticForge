'use strict';
// logs: journald query and live follow (a journalctl -f child per follow, only while someone listens).
const { spawn } = require('child_process');
const { run } = require('../lib/exec');
const { str, num, RE, bad, rid } = require('../lib/util');
const events = require('../lib/events');

const packages = [];
const follows = new Map(); // followId -> child
const TIME = /^[0-9A-Za-z:.+\- ]{1,64}$/;

function entry(o) {
  const s = v => (Array.isArray(v) ? Buffer.from(v).toString('utf8') : String(v ?? ''));
  return { t: new Date(Number(o.__REALTIME_TIMESTAMP) / 1000).toISOString(), unit: o._SYSTEMD_UNIT || o.SYSLOG_IDENTIFIER || '', priority: Number(o.PRIORITY ?? 6), pid: o._PID ? Number(o._PID) : null, message: s(o.MESSAGE) };
}
function filters(q) {
  const a = [];
  if (q.unit) a.push('-u', str(q.unit, 'unit', /^[A-Za-z0-9@:._\\-]{1,200}$/));
  if (q.priority !== undefined && q.priority !== '') a.push('-p', str(String(q.priority), 'priority', /^[0-7](\.\.[0-7])?$/));
  return a;
}
const stop = id => { const c = follows.get(id); if (!c) return false; follows.delete(id); try { c.kill('SIGTERM'); } catch { /* gone */ } return true; };
events.onIdle(() => { for (const id of [...follows.keys()]) stop(id); });

module.exports = {
  id: 'logs', packages,
  async detect() { const r = await run(['journalctl', '--disk-usage']); return { installed: true, ready: r.code === 0, summary: (r.stdout.match(/take up ([\d.]+\w+)/) || [])[1] ? `journal ${(r.stdout.match(/take up ([\d.]+\w+)/) || [])[1]}` : 'journald', missing: [] }; },
  async get(q = {}) {
    const lines = num(q.lines, 'lines', 1, 2000, 200);
    const a = ['--no-pager', '-o', 'json', '-n', String(lines), ...filters(q)];
    for (const k of ['since', 'until']) if (q[k]) { if (!TIME.test(q[k]) || q[k].startsWith('-') && !/^-\d/.test(q[k])) throw bad(`${k} is not valid`); a.push(`--${k}=${q[k]}`); }
    if (q.grep) a.push(`--grep=${str(q.grep, 'grep', null, 200)}`);
    if (q.boot !== undefined && q.boot !== '') a.push('-b', str(String(q.boot), 'boot', /^(-?\d{1,3}|[0-9a-f]{32})$/));
    const [r, b] = await Promise.all([run(['journalctl', ...a], { timeoutMs: 30000, maxBytes: 8388608 }), run(['journalctl', '--list-boots', '--no-pager', '-o', 'json'], { timeoutMs: 15000 })]);
    if (r.code !== 0 && !r.stdout) throw bad(r.stderr.trim() || 'journalctl failed', 'JOURNAL');
    const entries = [];
    for (const l of r.stdout.split('\n')) { if (!l) continue; try { entries.push(entry(JSON.parse(l))); } catch { /* partial line */ } }
    let boots = []; try { boots = JSON.parse(b.stdout).map(x => ({ id: x.boot_id, index: x.index, first: new Date(x.first_entry / 1000).toISOString(), last: new Date(x.last_entry / 1000).toISOString() })); } catch { /* old systemd */ }
    return { entries, boots };
  },
  actions: {
    async follow(p) {
      if (!events.listening()) throw bad('nobody listens on /v1/events: open the event stream first', 'NO_LISTENER');
      if (follows.size >= 8) throw bad('too many follows');
      const args = ['--no-pager', '-f', '-n', '0', '-o', 'json', ...filters(p)];
      const followId = `f${rid(3)}`;
      const c = spawn('journalctl', args, { stdio: ['ignore', 'pipe', 'ignore'], detached: true });
      follows.set(followId, c);
      c.on('error', () => follows.delete(followId));
      let buf = '';
      c.stdout.on('data', d => {
        buf += d.toString('utf8'); let i;
        while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { events.emit('logs', 'log', followId, entry(JSON.parse(l))); } catch { /* skip */ } }
      });
      c.on('close', () => follows.delete(followId));
      return { followId };
    },
    async unfollow(p) { if (!stop(str(p.followId, 'followId', /^f[0-9a-f]{6}$/))) throw bad('no such follow', 'NOT_FOUND'); return { ok: true }; },
    async dmesg(p) {
      const n = num(p.lines, 'lines', 1, 5000, 200);
      const r = await run(['dmesg', '--time-format=iso'], { maxBytes: 8388608 });
      return { lines: r.stdout.split('\n').filter(Boolean).slice(-n) };
    },
  },
};
