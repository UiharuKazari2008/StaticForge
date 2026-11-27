'use strict';
// services: systemd units and rack-defined services (rack-<name>.service).
const fs = require('fs');
const path = require('path');
const { run, ok } = require('../lib/exec');
const { DATA, str, bool, RE, bad, readJson, writeJson } = require('../lib/util');
const events = require('../lib/events');

const packages = [];
const DEFS = path.join(DATA, 'services');
// The host's lifelines: never stopped, restarted, disabled or masked through rackd.
const PROTECTED = /^(ssh|sshd|NetworkManager|NetworkManager-wait-online|systemd-networkd|networking|libvirtd|libvirtd-.*|virtqemud.*|virtnetworkd.*|virtstoraged.*|cockpit.*|kiosk|rackd|dbus|systemd-logind|systemd-journald|systemd-udevd)\.(service|socket)$/;
const unitName = u => { const s = str(u, 'unit', null, 200); return RE.unit.test(s) ? s : (RE.unit.test(`${s}.service`) ? `${s}.service` : (() => { throw bad('unit is not valid'); })()); };
const sc = (args, o) => run(['systemctl', '--no-pager', ...args], { timeoutMs: 30000, ...o });
const safeVerbs = new Set(['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask']);
const dangerous = new Set(['stop', 'restart', 'disable', 'mask']);

async function list() {
  const [units, files] = await Promise.all([
    sc(['list-units', '--type=service', '--all', '--plain', '--no-legend', '--full']),
    sc(['list-unit-files', '--type=service', '--plain', '--no-legend']),
  ]);
  const en = {}; for (const l of files.stdout.split('\n')) { const f = l.trim().split(/\s+/); if (f[0]) en[f[0]] = f[1]; }
  return units.stdout.split('\n').filter(Boolean).map(l => {
    const m = l.trim().match(/^(\S+)\s+(\S+)\s+(\S+)\s+(\S+)\s*(.*)$/);
    return m ? { unit: m[1], load: m[2], active: m[3], sub: m[4], description: m[5], enabled: en[m[1]] || null } : null;
  }).filter(Boolean);
}
function racks() {
  try { return fs.readdirSync(DEFS).filter(f => f.endsWith('.json')).map(f => readJson(path.join(DEFS, f))).filter(Boolean).map(d => ({ name: d.name, unit: `rack-${d.name}.service`, cmd: d.cmd, user: d.user, cwd: d.cwd || null, restart: d.restart, envNames: d.envNames || [] })); } catch { return []; }
}

module.exports = {
  id: 'services', packages,
  async detect() {
    const r = await sc(['is-system-running']);
    return { installed: true, ready: true, summary: `systemd ${r.stdout.trim() || 'unknown'}, ${racks().length} rack service(s)`, missing: [] };
  },
  async get() { return { services: await list(), rack: racks() }; },
  actions: {
    ...Object.fromEntries([...safeVerbs].map(verb => [verb, async p => {
      const unit = unitName(p.unit);
      if (dangerous.has(verb) && PROTECTED.test(unit)) throw bad(`${unit} is protected: rackd does not ${verb} it`, 'PROTECTED');
      await ok(['systemctl', '--no-pager', verb, unit], { timeoutMs: 60000 });
      events.emit('services', 'state', unit, { unit, op: verb });
      return { ok: true };
    }])),
    async status(p) {
      const unit = unitName(p.unit);
      const props = {};
      const r = await sc(['show', unit, '-p', 'Id,Description,LoadState,ActiveState,SubState,MainPID,MemoryCurrent,ActiveEnterTimestamp,UnitFileState,FragmentPath,Result,NRestarts']);
      for (const l of r.stdout.split('\n')) { const i = l.indexOf('='); if (i > 0) props[l.slice(0, i)] = l.slice(i + 1); }
      const lg = await run(['journalctl', '-u', unit, '-n', '30', '-o', 'short-iso', '--no-pager'], { timeoutMs: 15000 });
      return { props, log: lg.stdout.split('\n').filter(Boolean) };
    },
    // cmd runs through bash from a script file, env goes to an EnvironmentFile: no quoting of params inside the unit.
    async define(p) {
      const name = str(p.name, 'name', /^[a-z0-9][a-z0-9_-]{0,40}$/);
      const cmd = str(p.cmd, 'cmd', null, 20000);
      const user = p.user === undefined ? 'rack' : str(p.user, 'user', RE.user);
      if (user !== 'rack' && user !== 'root') throw bad("user must be 'rack' or 'root'");
      const restart = p.restart === undefined ? 'on-failure' : p.restart;
      if (!['no', 'on-failure', 'always', 'on-success', 'on-abnormal'].includes(restart)) throw bad('restart is not valid');
      const cwd = p.cwd ? str(p.cwd, 'cwd', /^\/[^\n\r\0]*$/, 1024) : null;
      const env = p.env && typeof p.env === 'object' ? p.env : {};
      const envLines = Object.entries(env).map(([k, v]) => {
        if (!RE.envName.test(k) || typeof v !== 'string' || /[\n\r\0]/.test(v)) throw bad(`env ${k} is not valid`);
        return `${k}=${v}`;
      });
      fs.mkdirSync(DEFS, { recursive: true });
      const script = path.join(DEFS, `${name}.sh`), envf = path.join(DEFS, `${name}.env`);
      fs.writeFileSync(script, `#!/bin/bash\n${cmd}\n`, { mode: 0o755 });
      fs.writeFileSync(envf, `${envLines.join('\n')}\n`, { mode: 0o600 });
      fs.chmodSync(DEFS, 0o755);
      const unit = `[Unit]\nDescription=Rack service ${name}\nAfter=network.target\n\n[Service]\nUser=${user}\nExecStart=/bin/bash ${script}\nEnvironmentFile=-${envf}\n${cwd ? `WorkingDirectory=${cwd}\n` : ''}Restart=${restart}\nRestartSec=3\n\n[Install]\nWantedBy=multi-user.target\n`;
      fs.writeFileSync(`/etc/systemd/system/rack-${name}.service`, unit);
      writeJson(path.join(DEFS, `${name}.json`), { name, cmd, user, cwd, restart, envNames: Object.keys(env) });
      await ok(['systemctl', 'daemon-reload']);
      if (bool(p.start, true)) await ok(['systemctl', 'enable', '--now', `rack-${name}.service`]);
      events.emit('services', 'added', `rack-${name}.service`, { name });
      return { unit: `rack-${name}.service` };
    },
    async undefine(p) {
      const name = str(p.name, 'name', /^[a-z0-9][a-z0-9_-]{0,40}$/);
      if (!fs.existsSync(path.join(DEFS, `${name}.json`))) throw bad('no such rack service', 'NOT_FOUND');
      await run(['systemctl', 'disable', '--now', `rack-${name}.service`], { timeoutMs: 60000 });
      for (const f of [`/etc/systemd/system/rack-${name}.service`, ...['sh', 'env', 'json'].map(e => path.join(DEFS, `${name}.${e}`))]) { try { fs.unlinkSync(f); } catch { /* gone */ } }
      await run(['systemctl', 'daemon-reload']);
      await run(['systemctl', 'reset-failed', `rack-${name}.service`]);
      events.emit('services', 'removed', `rack-${name}.service`, { name });
      return { ok: true };
    },
  },
};
