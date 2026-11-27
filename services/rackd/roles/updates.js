'use strict';
// updates: apt state and jobs. Nothing runs by itself; `check` is the only thing that touches the network.
const fs = require('fs');
const { run } = require('../lib/exec');
const { str, RE, bad } = require('../lib/util');
const jobs = require('../lib/jobs');
const events = require('../lib/events');

const packages = ['apt'];
const ENV = { DEBIAN_FRONTEND: 'noninteractive' };

function lastCheck() {
  for (const f of ['/var/lib/apt/periodic/update-success-stamp', '/var/lib/apt/lists']) { try { return fs.statSync(f).mtime.toISOString(); } catch { /* next */ } }
  return null;
}
function history() {
  let t = ''; try { t = fs.readFileSync('/var/log/apt/history.log', 'utf8'); } catch { return []; }
  return t.split('\n\n').filter(Boolean).map(b => {
    const g = k => (b.match(new RegExp(`^${k}: (.*)$`, 'm')) || [])[1];
    const up = g('Upgrade'); const ins = g('Install');
    return { start: g('Start-Date'), end: g('End-Date'), command: g('Commandline') || '', upgraded: up ? up.split('), ').map(x => x.split(':')[0]).slice(0, 100) : [], installed: ins ? ins.split('), ').map(x => x.split(':')[0]).slice(0, 100) : [] };
  }).filter(h => h.start).slice(-20).reverse();
}
const pkgNames = a => (Array.isArray(a) ? a : []).map(x => str(x, 'package', RE.pkg));

module.exports = {
  id: 'updates', packages,
  async detect() {
    const r = await run(['apt', 'list', '--upgradable'], { timeoutMs: 60000 });
    const n = r.stdout.split('\n').filter(l => l.includes('upgradable from')).length;
    return { installed: true, ready: true, summary: `${n} upgradable${fs.existsSync('/var/run/reboot-required') ? ', reboot required' : ''}`, missing: [] };
  },
  async get() {
    const [up, held] = await Promise.all([run(['apt', 'list', '--upgradable'], { timeoutMs: 60000 }), run(['apt-mark', 'showhold'])]);
    const upgradable = up.stdout.split('\n').map(l => l.match(/^([^/]+)\/(\S+) (\S+) \S+ \[upgradable from: ([^\]]+)\]/)).filter(Boolean).map(m => ({ package: m[1], from: m[4], to: m[3], security: /security/.test(m[2]) }));
    return { lastCheck: lastCheck(), upgradable, rebootRequired: fs.existsSync('/var/run/reboot-required'), held: held.stdout.split('\n').filter(Boolean), history: history() };
  },
  actions: {
    async check() { return { job: jobs.start({ role: 'updates', title: 'apt-get update', run: async c => { await c.exec(['apt-get', 'update'], { env: ENV }); events.emit('updates', 'state', null, { checked: true }); } }) }; },
    async upgrade(p) {
      const pk = pkgNames(p.packages);
      return { job: jobs.start({ role: 'updates', title: pk.length ? `upgrade ${pk.join(' ')}` : 'apt-get upgrade', run: async c => {
        await c.exec(pk.length ? ['apt-get', '-y', 'install', '--only-upgrade', ...pk] : ['apt-get', '-y', 'upgrade'], { env: ENV });
        events.emit('updates', 'state', null, { upgraded: true });
      } }) };
    },
    async hold(p) { const pk = pkgNames([p.package]); const r = await run(['apt-mark', 'hold', ...pk]); if (r.code) throw bad(r.stderr.trim()); events.emit('updates', 'state', null, { held: pk }); return { ok: true }; },
    async unhold(p) { const pk = pkgNames([p.package]); const r = await run(['apt-mark', 'unhold', ...pk]); if (r.code) throw bad(r.stderr.trim()); events.emit('updates', 'state', null, { unheld: pk }); return { ok: true }; },
    async autoremove() { return { job: jobs.start({ role: 'updates', title: 'apt-get autoremove', run: c => c.exec(['apt-get', '-y', 'autoremove'], { env: ENV }) }) }; },
  },
};
