'use strict';
// networking: interfaces, routes, bridges, listening sockets, libvirt networks. Never touches the host's own bridge.
const fs = require('fs');
const { run, ok } = require('../lib/exec');
const { str, num, bool, RE, bad } = require('../lib/util');
const apt = require('../lib/apt');
const events = require('../lib/events');

const packages = ['iproute2', 'iputils-ping'];
const j = async argv => { const r = await run(argv); try { return JSON.parse(r.stdout); } catch { return []; } };
const sys = (n, f) => { try { return fs.readFileSync(`/sys/class/net/${n}/${f}`, 'utf8').trim(); } catch { return null; } };

async function defaultDevs() {
  const routes = await j(['ip', '-j', 'route']);
  const devs = new Set();
  for (const r of routes) if (r.dst === 'default' && r.dev) { devs.add(r.dev); const m = sys(r.dev, 'master'); void m; try { devs.add(fs.readlinkSync(`/sys/class/net/${r.dev}/master`).split('/').pop()); } catch { /* no master */ } }
  return devs;
}
async function hostIfaces() { // interfaces that carry the host's addresses or default route (plus their bridge and ports)
  const set = await defaultDevs();
  for (const a of await j(['ip', '-j', 'addr'])) if (a.ifname !== 'lo' && (a.addr_info || []).some(x => x.family === 'inet' && x.scope === 'global')) set.add(a.ifname);
  for (const n of [...set]) { try { for (const p of fs.readdirSync(`/sys/class/net/${n}/brif`)) set.add(p); } catch { /* not a bridge */ } }
  return set;
}
async function libvirtNets() {
  const r = await run(['virsh', '-c', 'qemu:///system', 'net-list', '--all', '--name']);
  const out = [];
  for (const name of r.stdout.split('\n').map(s => s.trim()).filter(Boolean)) {
    const x = (await run(['virsh', '-c', 'qemu:///system', 'net-dumpxml', name])).stdout;
    const info = await run(['virsh', '-c', 'qemu:///system', 'net-info', name]);
    const ip = x.match(/<ip address='([^']+)'(?: netmask='([^']+)'| prefix='(\d+)')?/);
    out.push({ name, active: /Active:\s+yes/.test(info.stdout), autostart: /Autostart:\s+yes/.test(info.stdout), bridge: (x.match(/<bridge name='([^']+)'/) || [])[1] || null, subnet: ip ? `${ip[1]}${ip[3] ? '/' + ip[3] : ip[2] ? ' ' + ip[2] : ''}` : null });
  }
  return out;
}

module.exports = {
  id: 'networking', packages,
  async detect() {
    const missing = await apt.missing(packages);
    const n = fs.readdirSync('/sys/class/net').filter(x => x !== 'lo').length;
    return { installed: !missing.length, ready: !missing.length, summary: `${n} interface(s)`, missing };
  },
  async get() {
    const [addr, link, routes, ss, nets] = await Promise.all([j(['ip', '-j', 'addr']), j(['ip', '-j', '-s', 'link']), j(['ip', '-j', 'route']), run(['ss', '-H', '-tulnp']), libvirtNets()]);
    const stats = {}; for (const l of link) stats[l.ifname] = l.stats64 || {};
    const interfaces = addr.map(a => ({
      name: a.ifname, state: (a.operstate || '').toLowerCase(), mac: a.address || null, mtu: a.mtu,
      addrs: (a.addr_info || []).map(x => `${x.local}/${x.prefixlen}`),
      rxB: stats[a.ifname]?.rx?.bytes ?? 0, txB: stats[a.ifname]?.tx?.bytes ?? 0,
      speed: Number(sys(a.ifname, 'speed')) > 0 ? Number(sys(a.ifname, 'speed')) : null,
    }));
    const bridges = fs.readdirSync('/sys/class/net').filter(n => fs.existsSync(`/sys/class/net/${n}/bridge`)).map(n => ({ name: n, ports: fs.readdirSync(`/sys/class/net/${n}/brif`) }));
    const listening = ss.stdout.split('\n').filter(Boolean).map(l => {
      const f = l.split(/\s+/); const local = f[4] || ''; const i = local.lastIndexOf(':');
      const pm = l.match(/users:\(\("([^"]+)"/);
      return { proto: f[0], addr: local.slice(0, i), port: Number(local.slice(i + 1)), process: pm ? pm[1] : null };
    });
    return { interfaces, routes: routes.map(r => ({ dst: r.dst, gateway: r.gateway || null, dev: r.dev, src: r.prefsrc || null, metric: r.metric ?? null })), bridges, listening, libvirt: nets };
  },
  actions: {
    async ping(p) {
      const host = str(p.host, 'host', RE.host); const count = num(p.count, 'count', 1, 20, 4);
      const r = await run(['ping', '-n', '-c', String(count), '-W', '2', host], { timeoutMs: (count * 3 + 5) * 1000 });
      const m = r.stdout.match(/(\d+) packets transmitted, (\d+) (?:packets )?received/);
      const rtt = r.stdout.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)/);
      return { code: r.code, sent: m ? Number(m[1]) : count, received: m ? Number(m[2]) : 0, avgMs: rtt ? Number(rtt[2]) : null, out: (r.stdout + r.stderr).trim() };
    },
    async 'bridge-create'(p) {
      const name = str(p.name, 'name', /^[a-z][a-z0-9_-]{0,14}$/);
      const ports = (Array.isArray(p.ports) ? p.ports : []).map(x => str(x, 'port', /^[a-zA-Z0-9_.-]{1,15}$/));
      if (fs.existsSync(`/sys/class/net/${name}`)) throw bad('an interface with that name exists', 'EXISTS');
      const host = await hostIfaces();
      for (const pt of ports) {
        if (host.has(pt)) throw bad(`${pt} carries the host's own network and cannot be moved`, 'HOST_NETWORK');
        if (!fs.existsSync(`/sys/class/net/${pt}`)) throw bad(`no such interface ${pt}`, 'NOT_FOUND');
        if (sys(pt, 'master') !== null || fs.existsSync(`/sys/class/net/${pt}/master`)) throw bad(`${pt} is already in a bridge or bond`, 'IN_USE');
      }
      await ok(['ip', 'link', 'add', 'name', name, 'type', 'bridge']);
      for (const pt of ports) await ok(['ip', 'link', 'set', pt, 'master', name]);
      await ok(['ip', 'link', 'set', name, 'up']);
      events.emit('networking', 'added', name, { name, ports });
      return { name, ports, note: 'runtime only: not written to the host network configuration' };
    },
    async 'bridge-delete'(p) {
      const name = str(p.name, 'name', /^[a-z][a-z0-9_-]{0,14}$/);
      if (!fs.existsSync(`/sys/class/net/${name}/bridge`)) throw bad('no such bridge', 'NOT_FOUND');
      const host = await hostIfaces();
      if (host.has(name) || name === 'br0') throw bad('this bridge carries the host network', 'HOST_NETWORK');
      if (fs.readdirSync(`/sys/class/net/${name}/brif`).length) throw bad('the bridge still has ports', 'IN_USE');
      await ok(['ip', 'link', 'del', name]);
      events.emit('networking', 'removed', name, { name });
      return { ok: true };
    },
    async 'libvirt-net'(p) {
      const name = str(p.name, 'name', RE.name);
      const nets = await libvirtNets(); const n = nets.find(x => x.name === name);
      if (!n) throw bad('no such libvirt network', 'NOT_FOUND');
      const v = ['virsh', '-c', 'qemu:///system'];
      if (p.op === 'start') await ok([...v, 'net-start', name]);
      else if (p.op === 'stop') {
        const host = await hostIfaces();
        if (n.bridge && host.has(n.bridge)) throw bad('this network is the host bridge: stopping it would cut the host off', 'HOST_NETWORK');
        await ok([...v, 'net-destroy', name]);
      } else if (p.op === 'autostart') await ok([...v, 'net-autostart', name, ...(bool(p.enable, true) ? [] : ['--disable'])]);
      else throw bad('op must be start, stop or autostart');
      events.emit('networking', 'state', name, { name, op: p.op });
      return { ok: true };
    },
  },
};
