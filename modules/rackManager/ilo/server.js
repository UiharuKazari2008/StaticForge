'use strict';
// iLO web console: native replacement for HP's Java remote console.
// Usage: node server.js   (env PORT, BIND, PASSFILE)
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const zlib = require('zlib');
const { Ilo3Console, login: ilo3Login, logout: ilo3Logout, api: ilo3Api } = require('./lib/ilo3');
const { HID } = require('./lib/hid');
let Ilo2Console = null; try { ({ Ilo2Console } = require('./lib/ilo2')); } catch { /* not built yet */ }
const { Ribcl } = require('./lib/ribcl');
const { Telemetry } = require('./lib/telemetry');
const ws = require('./lib/ws');

// Rack Manager's iLO service (docs/rack-manager/README.md): a copy of ~/ilo-console's server.js (lib/ is a byte copy),
// run as a child of modules/rackManager.js. It listens on a unix socket (RACK_ILO_SOCK) and, when the address exists
// on this machine, on a LAN address with a small allowlist (lanGate below) for the hosts' login-status timer and
// the iLOs' virtual media downloads.
const SOCK = process.env.RACK_ILO_SOCK || path.join(__dirname, '..', '..', '..', '.cache', 'rack-manager', 'ilo.sock');
const LAN_BIND = process.env.RACK_ILO_LAN_BIND === undefined ? '192.168.100.250:8790' : process.env.RACK_ILO_LAN_BIND;
const PORT = Number((LAN_BIND.split(':')[1]) || 8790);
const PASSFILE = process.env.PASSFILE || path.join(os.homedir(), '.config/ilo/dream_admin.pass');
const SERVERS = {
  misaka: { host: '192.168.100.43', gen: 3, label: 'Misaka (DL580 G7, iLO 3)',
    driveLayout: [['1', '3', '5', 'DVD:2'], ['2', '4', '6', '7', '8']],   // front panel, as seen from the front
    // from the IPMI SDR entity IDs (ipmitool sdr type Temperature on the host)
    sensorNames: { 'Temp 14': 'System board (7.6)', 'Temp 15': 'System board (7.7)', 'Temp 16': 'Chipset / I/O hub (66.1)', 'Temp 17': 'Drive bays (4.1)' },
    driveTemp: 'Temp 17' },
  asuka: { host: '192.168.100.41', gen: 2, label: 'Asuka (DL380 G5, iLO 2)' },
};
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', '..', '.cache', 'rack-manager', 'ilo');
const IDLE_MS = 60000;   // keep the iLO session this long after the last viewer leaves

const log = m => console.log(new Date().toISOString().slice(11, 19), m);

// Plain-English POST stages, worked out from recorded boots of Misaka (DL580 G7, BIOS P65) by matching each
// code to what was on screen at the time. HP does not publish these codes; treat them as observations.
const POST_STAGES = [
  [/^(0138|0140|0148|5018|3010|6b00|6[05]00|6018|5160|50(00|08|10|18))$/, "Starting CPUs and chipset (screen off)"],
  [/^30[0-7][0-9a-f]$/, 'Initialising memory (one pass per memory board)'],
  [/^5218$/, 'Memory ready, starting video'],
  [/^(fe[0-2][0-9a-f]|5318|007b|0053)$/, "Video on, initialising devices"],
  [/^(3088|0066)$/, 'POST summary: CPUs, memory, power supplies'],
  [/^58(0[0-9a-f])$/, 'Running option ROMs (SATA, network boot, iLO, Smart Array)'],
  [/^(5820|5720|5f62|005a|fe3[0-9a-f]|59[01][0-9a-f])$/, 'Handing off to the boot disk'],
];
const postStage = code => { for (const [re, s] of POST_STAGES) if (re.test(code)) return s; return 'POST in progress'; };

// ---- one shared iLO console per server -------------------------------------------------
class Session {
  constructor(name) {
    this.name = name; this.cfg = SERVERS[name]; this.viewers = new Set();
    this.con = null; this.starting = null; this.dirty = null; this.status = {};
    this.timer = setInterval(() => this.tick(), 40);
  }
  async ensure() {
    if (this.con && !this.con.closed) return this.con;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const password = fs.readFileSync(PASSFILE, 'utf8').trim();
      const Con = this.cfg.gen === 3 ? Ilo3Console : Ilo2Console;
      if (!Con) throw new Error('remote console for iLO 2 is not implemented yet');
      const con = new Con({ host: this.cfg.host, user: 'dream_admin', password, name: this.name });
      con.on('log', m => { log(m); this.broadcast({ log: m }); });
      con.on('resize', (w, h) => { this.dirty = { x0: 0, y0: 0, x1: w, y1: h }; this.broadcastResize(); this.trace('mode', `${w}x${h}`); });
      con.on('status', s => { if (s.post) this.trace(s.post === 'complete' ? 'complete' : 'code', s.post); else if (s.text) this.trace('text', s.text); });
      con.on('update', (x, y, w, h) => this.markDirty(x, y, w, h));
      con.on('power', on => { this.status.power = on; this.broadcast({ power: on }); });
      con.on('status', s => { if (s.post) Object.assign(s, this.postProgress(s.post)); Object.assign(this.status, s); this.broadcast(s); });
      con.on('status', s => { if (s.post || s.postPct !== undefined) hubEmit({ server: this.name, post: { code: s.post || null, pct: s.postPct === undefined ? null : s.postPct, stage: s.postStage || null, elapsed: s.postElapsed === undefined ? null : s.postElapsed, eta: s.postEta === undefined ? null : s.postEta, done: s.post === 'complete' || s.postDone === true } }); });
      con.on('close', reason => { this.broadcast({ closed: reason }); if (this.con === con) this.con = null; });
      await con.start();
      this.con = con;
      return con;
    })();
    try { return await this.starting; } finally { this.starting = null; }
  }
  markDirty(x, y, w, h) {
    const d = this.dirty;
    if (!d) this.dirty = { x0: x, y0: y, x1: x + w, y1: y + h };
    else { d.x0 = Math.min(d.x0, x); d.y0 = Math.min(d.y0, y); d.x1 = Math.max(d.x1, x + w); d.y1 = Math.max(d.y1, y + h); }
  }
  rect(x0, y0, x1, y1) {   // -> binary message: [2][x][y][w][h] + deflate-raw(RGB)
    const c = this.con, W = c.width;
    x1 = Math.min(x1, c.width); y1 = Math.min(y1, c.height);
    const w = x1 - x0, h = y1 - y0; if (w <= 0 || h <= 0) return null;
    const rgb = Buffer.allocUnsafe(w * h * 3); let o = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const p = c.fb[y * W + x]; rgb[o++] = p >> 16; rgb[o++] = (p >> 8) & 255; rgb[o++] = p & 255; }
    const hdr = Buffer.alloc(9); hdr[0] = 2; hdr.writeUInt16LE(x0, 1); hdr.writeUInt16LE(y0, 3); hdr.writeUInt16LE(w, 5); hdr.writeUInt16LE(h, 7);
    return Buffer.concat([hdr, zlib.deflateRawSync(rgb, { level: 1 })]);
  }
  tick() {
    const d = this.dirty, c = this.con;
    if (!d || !c || !c.width || this.viewers.size === 0) return;
    const live = [...this.viewers].filter(v => v.ws.buffered() < 4 << 20);
    if (live.length === 0) return;
    this.dirty = null;
    const m = this.rect(d.x0, d.y0, d.x1, d.y1);
    if (!m) return;
    for (const v of this.viewers) {
      if (live.includes(v)) v.ws.sendBinary(m); else v.needFull = true;
    }
    for (const v of live) if (v.needFull) { v.needFull = false; v.ws.sendBinary(this.rect(0, 0, c.width, c.height)); }
  }
  resizeMsg() { const b = Buffer.alloc(5); b[0] = 1; b.writeUInt16LE(this.con.width, 1); b.writeUInt16LE(this.con.height, 3); return b; }
  broadcastResize() { for (const v of this.viewers) v.ws.sendBinary(this.resizeMsg()); }
  broadcast(obj) { const s = JSON.stringify(obj); for (const v of this.viewers) v.ws.sendText(s); }
  async join(v) {
    this.viewers.add(v); clearTimeout(this.idle);
    v.ws.sendText(JSON.stringify({ server: this.name, label: this.cfg.label, connecting: true }));
    try {
      const c = await this.ensure();
      v.ws.sendText(JSON.stringify({ connected: true, ...this.status, power: c.power }));
      if (c.width) { v.ws.sendBinary(this.resizeMsg()); v.ws.sendBinary(this.rect(0, 0, c.width, c.height)); }
    } catch (e) { log(`[${this.name}] connect failed: ${e.message}`); v.ws.sendText(JSON.stringify({ error: e.message })); }
  }
  // POST progress: the codes of the last complete boot are saved; progress = position in that sequence.
  // Boot recorder: from the first POST code after 20 s of quiet, record every code / video mode / status text
  // with its time, plus a screenshot whenever the code changes (max 1 per second), for 8 minutes.
  // Saved to data/boottrace/<server>-<iso time>/trace.json + NNNNNN-<code>.png
  trace(type, v) {
    const now = Date.now();
    if (type === 'code' && (!this.tr || now - this.tr.start > 8 * 60000) && now - (this.lastTraceCode || 0) > 20000) {
      const dir = path.join(DATA_DIR, 'boottrace', `${this.name}-${new Date(now).toISOString().replace(/[:.]/g, '-')}`);
      fs.mkdirSync(dir, { recursive: true });
      this.tr = { start: now, dir, events: [], lastShot: 0, lastCode: null };
      log(`[${this.name}] boot recorder started (${dir})`);
      clearTimeout(this.trTimer);
      this.trTimer = setTimeout(() => this.traceSave(true), 8 * 60000);
    }
    if (type === 'code') this.lastTraceCode = now;
    const tr = this.tr; if (!tr || now - tr.start > 8 * 60000) return;
    const t = now - tr.start;
    tr.events.push({ t, type, v });
    if ((type === 'code' && v !== tr.lastCode) || type === 'mode' || type === 'complete') {
      tr.lastCode = type === 'code' ? v : tr.lastCode;
      // screenshot slightly later so the screen has caught up with the code
      if (now - tr.lastShot >= 1000) {
        tr.lastShot = now;
        setTimeout(() => {
          const c = this.con;
          if (c && c.width && this.tr === tr) try { fs.writeFileSync(path.join(tr.dir, `${String(t).padStart(6, '0')}-${type === 'code' ? v : type}.png`), png(c)); } catch { /* ignore */ }
        }, 400);
      }
    }
    if (tr.events.length % 50 === 0) this.traceSave(false);
  }
  traceSave(final) {
    const tr = this.tr; if (!tr) return;
    try { fs.writeFileSync(path.join(tr.dir, 'trace.json'), JSON.stringify({ server: this.name, start: tr.start, events: tr.events }, null, 0)); } catch { /* ignore */ }
    if (final) log(`[${this.name}] boot recorder finished: ${tr.events.length} events`);
  }
  // POST progress on time, not step count. Each finished boot is stored in data/boots-<server>.json as
  // {start, dur, codes: {code: first-seen ms}}; "dur" ends at "POST complete" (the hand-off to the disk).
  // Progress = where the current code usually sits in time (median over past boots), advanced by the time
  // spent on it, divided by the median boot length. Time left = median length - that position.
  postProgress(code) {
    const file = path.join(DATA_DIR, `boots-${this.name}.json`);
    if (!this.boots) { try { this.boots = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { this.boots = []; } }
    const now = Date.now(), gap = now - (this.lastCodeAt || 0); this.lastCodeAt = now;
    if (code === 'complete') {
      if (this.boot && now - this.boot.start > 20000) {
        this.boots.push({ start: this.boot.start, dur: now - this.boot.start, codes: this.boot.codes, counts: this.boot.counts });
        this.boots = this.boots.slice(-20);
        fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(this.boots));
        log(`[${this.name}] boot took ${Math.round((now - this.boot.start) / 1000)} s to reach the disk`);
      }
      this.boot = null; this.postDoneAt = now;
      return { postPct: 100, postDone: true, postEta: 0, postStage: 'Booting from disk' };
    }
    // the iLO keeps reporting port-80 codes after POST completes (option ROMs / OS): ignore them
    // unless they follow a quiet gap of 20 s or more, which means a new boot started
    if (this.postDoneAt && !this.boot && gap < 20000) return { postPct: 100, postDone: true, postIgnored: true };
    // a new boot, or a quiet gap of 45 s+ inside one (Linux shutting down sends a few codes, then the
    // machine goes silent ~56 s before POST starts; option ROMs are quiet for up to ~35 s): start the clock here
    if (!this.boot || gap > 45000) { this.boot = { start: now, codes: {}, counts: {} }; this.postDoneAt = 0; this.pos = 0; }
    const b = this.boot, el = now - b.start;
    if (b.codes[code] === undefined) b.codes[code] = el;
    b.counts[code] = (b.counts[code] || 0) + 1;
    const stage = postStage(code);
    const done = this.boots.filter(x => x.dur > 20000);
    if (!done.length) return { postPct: null, postStage: stage, postElapsed: Math.round(el / 1000) };
    const med = a => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const T = med(done.map(x => x.dur));
    // Elapsed time drives the bar. Codes that occur once per boot, past the first few seconds, are
    // checkpoints: arriving at one moves the bar forward to where that code usually sits. Repeating codes
    // (the memory passes) and codes also seen at the very start never move it, and it never goes backwards.
    let pos = Math.max(this.pos || 0, el);
    const once = done.filter(x => x.counts ? x.counts[code] === 1 : !/^30[0-7]/.test(code)).map(x => x.codes[code]).filter(v => v !== undefined && v > 5000);
    if (once.length && b.counts[code] === 1) pos = Math.max(pos, med(once));
    pos = Math.min(pos, T * 0.99);
    this.pos = pos;
    return { postPct: Math.round(pos / T * 100), postEta: Math.max(0, Math.round((T - pos) / 1000)), postStage: stage, postElapsed: Math.round(el / 1000) };
  }
  keepAlive() {   // API use without a viewer: keep the iLO session for IDLE_MS
    if (this.viewers.size) return;
    clearTimeout(this.idle);
    this.idle = setTimeout(() => { if (!this.viewers.size && this.con) this.con.stop('no viewers'); }, IDLE_MS);
  }
  leave(v) {
    this.viewers.delete(v);
    if (this.con && this.con.keys.size) this.con.releaseAll();
    if (this.viewers.size === 0) this.idle = setTimeout(() => { if (this.viewers.size === 0 && this.con) this.con.stop('no viewers'); }, IDLE_MS);
  }
  input(m) {
    const c = this.con; if (!c || c.closed) return;
    if (m.t === 'key') {
      if (c.keyEvent) c.keyEvent(m);                       // iLO 2: character stream (repeats included)
      else if (!m.rep) { const u = HID[m.code]; if (u) c.pressKey(u, !!m.down); }
    }
    else if (m.t === 'release') c.releaseAll();
    else if (m.t === 'mouse') c.mouse(m.x | 0, m.y | 0, m.b | 0);
    else if (m.t === 'combo') {
      const C = { cad: [0x05, 0x4C], cab: [0x05, 0x2A] }[m.name];
      if (C) c.combo(C[0], C[1]);
      else if (/^(c?a)f([1-9]|1[0-2])$/.test(m.name)) { const [, mods, n] = m.name.match(/^(c?a)f(\d+)$/); c.combo(mods === 'ca' ? 0x05 : 0x04, 0x3A + Number(n) - 1); }
    }
    else if (m.t === 'power') {
      if (this.cfg.gen === 3) c.powerButton(m.op | 0);
      else monitor(this.name).rb.powerOp(m.op | 0).then(() => log(`[${this.name}] power op ${m.op}`), e => log(`[${this.name}] power op failed: ${e.message}`));
    }
    else if (m.t === 'refresh') c.refresh();
    else if (m.t === 'type' && typeof m.text === 'string') c.typeText(m.text.slice(0, 20000));
  }
}
const sessions = {};
const session = n => sessions[n] || (sessions[n] = new Session(n));

// ---- RIBCL monitor: health (cached) + power sampling while someone is looking -------------
const num = v => v == null ? null : Number(typeof v === 'object' ? v.value : String(v).replace(/[^\d.]/g, '')) || 0;
class Monitor {
  constructor(name) {
    this.name = name;
    this.rb = new Ribcl(SERVERS[name], 'dream_admin', () => fs.readFileSync(PASSFILE, 'utf8').trim());
    this.history = []; this.last = null; this.touched = 0; this.hcache = null;
    setInterval(() => { if (Date.now() - this.touched < 10 * 60000) this.sample().catch(e => log(`[${name}] power sample: ${e.message}`)); }, 30000);
    // keep health warm: at start, then every 30 s while the page has been used in the last 10 minutes
    this.refreshHealth().catch(() => {});
    setInterval(() => { if (Date.now() - this.touched < 10 * 60000) this.refreshHealth().catch(e => log(`[${name}] health: ${e.message}`)); }, 30000);
  }
  // The iLO takes 10-30 s to answer GET_EMBEDDED_HEALTH, so serve the cached copy and refresh it behind.
  refreshHealth() {
    if (!this.hpending) this.hpending = this.rb.health().then(h => {
      const d = h.GET_EMBEDDED_HEALTH_DATA || h; this.hcache = { t: Date.now(), d };
      const colour = this.healthColour(d);   // Rack Manager: a health change is pushed (power-events), no extra polling
      if (colour !== this.lastColour) { this.lastColour = colour; const g = d.HEALTH_AT_A_GLANCE || {}, glance = {}; for (const [k, v] of Object.entries(g)) glance[k] = String((Array.isArray(v) ? v[0] : v || {}).STATUS || ''); hubEmit({ server: this.name, health: { colour, glance } }); }
      return d;
    }).finally(() => { this.hpending = null; });
    return this.hpending;
  }
  async health(fresh) {
    const age = this.hcache ? Date.now() - this.hcache.t : Infinity;
    if (this.hcache && !fresh) { if (age > 25000) this.refreshHealth().catch(e => log(`[${this.name}] health: ${e.message}`)); return this.hcache.d; }
    return this.refreshHealth();
  }
  async sample() {
    const [pr, cap, saver] = await Promise.all([this.rb.powerReadings(), this.rb.powerCap(), this.rb.powerSaver()]);
    const r = pr.GET_POWER_READINGS || {}, c = (cap.GET_POWER_CAP || {}).POWER_CAP;
    const capW = c == null || /off/i.test(String(c)) ? 0 : num(c);
    this.last = {
      t: Date.now(), present: num(r.PRESENT_POWER_READING), average: num(r.AVERAGE_POWER_READING),
      max: num(r.MAXIMUM_POWER_READING), min: num(r.MINIMUM_POWER_READING),
      cap: capW, regulator: (saver.GET_HOST_POWER_SAVER || {}).HOST_POWER_SAVER || null,
    };
    if (this.history.length && this.history[this.history.length - 1][0] > this.last.t - 5000) this.history.pop();
    this.history.push([this.last.t, this.last.present]);
    if (this.history.length > 2880) this.history.shift();   // 24 h at 30 s
    return this.last;
  }
}
// Hardware event log (IML) as [{severity, description, last_update, ...}]
Monitor.prototype.healthColour = function (h) {
  const g = (h && h.HEALTH_AT_A_GLANCE) || {};
  const st = Object.values(g).flatMap(v => Array.isArray(v) ? v : [v]).map(x => String((x && x.STATUS) || '')).filter(Boolean);
  if (!st.length) return null;
  return st.every(s => /^ok$/i.test(s)) ? 'green' : st.some(s => /fail|crit/i.test(s)) ? 'red' : 'yellow';
};
// Event logs, normalised to [{severity, class, initial, last_update, count, description}]
//   which = 'server' (Integrated Management Log, HP's SEL) | 'ilo' (iLO event log)
Monitor.prototype.logs = async function (which = 'server', fresh = false) {
  this.lcache = this.lcache || {};
  const c = this.lcache[which];
  if (c && !fresh && Date.now() - c.t < 60000) return c.d;
  const cfg = SERVERS[this.name]; let d = [];
  if (cfg.gen === 3) {
    const tel = telemetry[this.name], s = sessions[this.name];
    const live = (tel && tel.key) || (s && s.con && !s.con.closed ? s.con.key : null);
    const key = live || await ilo3Login(cfg.host, 'dream_admin', fs.readFileSync(PASSFILE, 'utf8').trim());
    try {
      const j = await ilo3Api(cfg.host, 'GET', which === 'ilo' ? '/json/ilo_event_log' : '/json/server_event_log', { key });
      d = (j.events || []).map(e => ({ severity: e.severity, class: e.class, initial: e.initial_update, last_update: e.last_update, count: e.count, description: e.description }));
    } finally { if (!live) await ilo3Logout(cfg.host, key); }
  } else {
    const r = await this.rb.call(which === 'ilo' ? '<RIB_INFO MODE="read"><GET_EVENT_LOG/></RIB_INFO>' : '<SERVER_INFO MODE="read"><GET_EVENT_LOG/></SERVER_INFO>');
    const ev = (r.EVENT_LOG || {}).EVENT;
    d = (Array.isArray(ev) ? ev : ev ? [ev] : []).map(e => ({ severity: e.SEVERITY, class: e.CLASS, initial: e.INITIAL_UPDATE, last_update: e.LAST_UPDATE, count: e.COUNT, description: e.DESCRIPTION }));
  }
  this.lcache[which] = { t: Date.now(), d };
  return d;
};
Monitor.prototype.events = async function () {
  try { return await this.logs('server'); } catch (e) { log(`[${this.name}] IML: ${e.message}`); return []; }
};
// Memory map: groups (boards / CPUs) x slots, with status from the IML and board temperatures.
Monitor.prototype.memory = async function () {
  const h = await this.health();
  let events = []; try { events = await this.events(); } catch (e) { log(`[${this.name}] events: ${e.message}`); }
  const arr = v => v == null ? [] : Array.isArray(v) ? v : [v], val = v => v && typeof v === 'object' ? v.value : v;
  const comps = arr((h.MEMORY || {}).MEMORY_COMPONENTS && h.MEMORY.MEMORY_COMPONENTS.MEMORY_COMPONENT);
  const groups = new Map();
  for (const c of comps) {
    const loc = String(val(c.MEMORY_LOCATION) || '');
    const m = loc.match(/^(.*?)[,\s]*DIMM\s*([0-9]+[A-Z]?)\s*$/i) || [null, '', loc];
    const g = (m[1] || 'System board').trim().replace(/,$/, ''), slot = m[2];
    const sizeTxt = String(val(c.MEMORY_SIZE) || ''), mb = parseInt(sizeTxt) || 0;
    const present = mb > 0 && !/not installed/i.test(sizeTxt);
    const evs = events.filter(e => {
      const t = String(e.description || '');
      const re = new RegExp(`${g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[,\\s]*DIMM\\s*${slot}\\b`, 'i');
      return re.test(t) || (!m[1] && new RegExp(`DIMM\\s*${slot}\\b`, 'i').test(t));
    }).filter(e => !/repaired|informational/i.test(e.severity || ''));
    const status = !present ? 'absent' : evs.some(e => /critical/i.test(e.severity)) ? 'fault' : evs.length ? 'issue' : 'ok';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push({ slot, loc, present, mb, speed: String(val(c.MEMORY_SPEED) || ''), status, events: evs.map(e => ({ severity: e.severity, when: e.last_update, text: e.description, count: e.count })) });
  }
  const temps = arr((h.TEMPERATURE || {}).TEMP).filter(t => /memory/i.test(t.LOCATION || '') && !/not installed/i.test(t.STATUS || ''));
  const list = [...groups.entries()].map(([name, slots], i) => {
    slots.sort((a, b) => parseInt(a.slot) - parseInt(b.slot) || a.slot.localeCompare(b.slot));
    const t = temps.length === groups.size ? temps[i] : null;   // one memory sensor per board, in order
    return { name, slots, temp: t ? { label: t.LABEL, c: Number(val(t.CURRENTREADING)), caution: Number(val(t.CAUTION)), status: t.STATUS } : null };
  });
  return { groups: list, otherMemoryTemps: temps.length !== groups.size ? temps.map(t => ({ label: t.LABEL, c: Number(val(t.CURRENTREADING)), status: t.STATUS })) : [], eventsChecked: events.length };
};
// ---- power events for Rack Manager (SSE on the unix socket only): the host's power state when it changes, and POST progress ----
const hubClients = new Set(), hubOn = {};
function hubEmit(obj) { const line = `data: ${JSON.stringify(obj)}\n\n`; for (const r of hubClients) { try { r.write(line); } catch (_) { hubClients.delete(r); } } }
function hubSample(name, sample) {
  if (hubOn[name] !== sample.on) { hubOn[name] = sample.on; hubEmit({ server: name, on: sample.on, t: sample.t }); }
  // every sample too, so an open Load History extends its temperature / fan / power strips live (local socket, one line per 5 s)
  hubEmit({ server: name, sample: { t: sample.t, on: !!sample.on, w: sample.w, temp: sample.temp, fan: sample.fan } });
}
// a console session held (silently) through a power-on so the POST codes keep coming; released 30 s after POST completes, at most 8 min
function watchBoot(name) {
  const s = session(name), v = { ws: { sendText() {}, sendBinary() {} } };
  s.join(v);
  let done = false;
  const release = () => { if (done) return; done = true; s.leave(v); hubClients.delete(sink); };
  const sink = { write(line) { if (line.includes(`"server":"${name}"`) && /"done":true/.test(line)) setTimeout(release, 30000); } };
  hubClients.add(sink);
  setTimeout(release, 8 * 60000);
}
const monitors = {};
const monitor = n => monitors[n] || (monitors[n] = new Monitor(n));
setTimeout(() => Object.keys(SERVERS).forEach(monitor), 1000);   // start warming caches at launch

// ---- telemetry history (power / temps / fans), 90 days, gzip after a day ----------------------
const telemetry = {};
setTimeout(() => {
  for (const name of Object.keys(SERVERS)) {
    telemetry[name] = new Telemetry(name, SERVERS[name], {
      dir: path.join(DATA_DIR, 'telemetry'), user: 'dream_admin', retentionDays: 90, onSample: sample => hubSample(name, sample),
      password: () => fs.readFileSync(PASSFILE, 'utf8').trim(), ribcl: monitor(name).rb, log,
    }).start();
  }
}, 2000);
const RANGES = { '1h': 3600e3, '3h': 3 * 3600e3, '6h': 6 * 3600e3, '24h': 86400e3, '7d': 7 * 86400e3, '30d': 30 * 86400e3, '90d': 90 * 86400e3 };

// ---- PNG screenshot (for scripts / agents) ----------------------------------------------
function png(c) {
  const W = c.width, H = c.height, raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0, o = 0; y < H; y++) { raw[o++] = 0; for (let x = 0; x < W; x++) { const p = c.fb[y * W + x]; raw[o++] = p >> 16; raw[o++] = (p >> 8) & 255; raw[o++] = p & 255; } }
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const cr = Buffer.alloc(4); cr.writeUInt32BE(zlib.crc32(td)); return Buffer.concat([l, td, cr]); };
  const ih = Buffer.alloc(13); ih.writeUInt32BE(W, 0); ih.writeUInt32BE(H, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// ---- HTTP ---------------------------------------------------------------------------------
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  let m;
  if (u.pathname === '/api/power-events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
    res.write(': hello\n\n');
    for (const n of Object.keys(SERVERS)) { const l = telemetry[n] && telemetry[n].last; if (l) { hubOn[n] = l.on; res.write(`data: ${JSON.stringify({ server: n, on: l.on, t: l.t })}\n\n`); } }
    hubClients.add(res);
    req.on('close', () => hubClients.delete(res));
    return;
  }
  if (u.pathname === '/api/servers') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify(Object.entries(SERVERS).map(([name, s]) => ({ name, label: s.label, gen: s.gen, driveLayout: s.driveLayout || null, sensorNames: s.sensorNames || {}, driveTemp: s.driveTemp || null, connected: !!(sessions[name] && sessions[name].con), power: telemetry[name] && telemetry[name].last ? telemetry[name].last.on : null }))));
  }
  if ((m = u.pathname.match(/^\/api\/(\w+)\/screenshot\.png$/)) && SERVERS[m[1]]) {
    const s = session(m[1]);
    try {
      const c = await s.ensure();
      if (!c.width) await new Promise(r => setTimeout(r, 4000));
      if (!s.viewers.size) { clearTimeout(s.idle); s.idle = setTimeout(() => { if (!s.viewers.size && s.con) s.con.stop('no viewers'); }, IDLE_MS); }
      if (!c.width) { res.writeHead(503); return res.end('no video yet\n'); }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      return res.end(png(c));
    } catch (e) { res.writeHead(502); return res.end(e.message + '\n'); }
  }
  // Rack Manager: the power button without a WebSocket (same ops as the {t:'power',op} message: 0 press, 1 hold, 2 cold boot, 3 reset)
  if ((m = u.pathname.match(/^\/api\/(\w+)\/powerop$/)) && SERVERS[m[1]] && req.method === 'POST') {
    try {
      const pb = JSON.parse(await body(req) || '{}'), op = Number(pb.op);
      if (!(op >= 0 && op <= 3)) return json(res, 400, { error: 'op must be 0 (press), 1 (hold), 2 (cold boot) or 3 (reset)' });
      if (SERVERS[m[1]].gen === 3) { const s = session(m[1]); const c = await s.ensure(); c.powerButton(op); s.keepAlive(); if (pb.watch) watchBoot(m[1]); }
      else await monitor(m[1]).rb.powerOp(op);
      log(`[${m[1]}] power op ${op}`);
      return json(res, 200, { ok: true, op });
    } catch (e) { return json(res, 502, { error: e.message }); }
  }
  // ---- hardware status / power ----
  // ---- iLO users / settings ----
  if ((m = u.pathname.match(/^\/api\/(\w+)\/ilo\/(users|settings)$/)) && SERVERS[m[1]]) {
    const rb = monitor(m[1]).rb;
    try {
      if (m[2] === 'settings') {
        const [n, g] = await Promise.all([rb.network(), rb.globalSettings()]);
        return json(res, 200, { network: n.GET_NETWORK_SETTINGS || n, global: g.GET_GLOBAL_SETTINGS || g });
      }
      if (req.method === 'GET') return json(res, 200, await rb.users());
      const b = JSON.parse(await body(req) || '{}');
      const login = String(b.login || '').trim();
      if (!/^[\w.@-]{1,39}$/.test(login)) return json(res, 400, { error: 'login: 1-39 letters, digits or . _ @ -' });
      const privs = Array.isArray(b.privs) ? b.privs : undefined;
      if (b.action === 'add') {
        if (!b.password || String(b.password).length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
        await rb.addUser({ login, name: b.name || login, password: String(b.password), privs: privs || [] });
      } else if (b.action === 'modify') {
        if (b.password && String(b.password).length < 8) return json(res, 400, { error: 'password must be at least 8 characters' });
        if (login === 'dream_admin' && privs && !privs.includes('ADMIN_PRIV')) return json(res, 400, { error: 'dream_admin is what this tool logs in with; keep its admin right' });
        await rb.modUser(login, { password: b.password ? String(b.password) : undefined, privs });
      } else if (b.action === 'delete') {
        if (login === 'dream_admin') return json(res, 400, { error: 'dream_admin is what this tool logs in with; it cannot be deleted here' });
        await rb.deleteUser(login);
      } else return json(res, 400, { error: 'action must be add, modify or delete' });
      log(`[${m[1]}] iLO user ${b.action}: ${login}${b.password ? ' (password changed)' : ''}`);   // never log the password
      return json(res, 200, await rb.users());
    } catch (e) { return json(res, 502, { error: e.message }); }
  }
  if ((m = u.pathname.match(/^\/api\/(\w+)\/(history|logs|telemetry)$/)) && SERVERS[m[1]]) {
    const tel = telemetry[m[1]];
    try {
      if (m[2] === 'history') {
        if (!tel) return json(res, 503, { error: 'telemetry starting' });
        const span = RANGES[u.searchParams.get('range')] || RANGES['24h'];
        const to = Number(u.searchParams.get('to')) || Date.now();
        return json(res, 200, tel.history(to - span, to, Math.min(2000, Number(u.searchParams.get('points')) || 600)));
      }
      if (m[2] === 'telemetry') return json(res, 200, tel ? tel.usage() : {});
      monitor(m[1]).touched = Date.now();
      return json(res, 200, await monitor(m[1]).logs(u.searchParams.get('which') === 'ilo' ? 'ilo' : 'server', u.searchParams.has('fresh')));
    } catch (e) { return json(res, 502, { error: e.message }); }
  }
  if ((m = u.pathname.match(/^\/api\/(\w+)\/(health|power|powercap|powersaver|log|memory|events)$/)) && SERVERS[m[1]]) {
    const mon = monitor(m[1]), what = m[2];
    mon.touched = Date.now();
    try {
      if (what === 'health') {
        const h = await mon.health(u.searchParams.has('fresh')), tl = telemetry[m[1]] && telemetry[m[1]].last;
        const hostOn = tl ? tl.on : null;
        if (hostOn === false) {   // powered off: fans are stopped even though the iLO reports standby speeds
          const fans = h.FANS && h.FANS.FAN; for (const f of (Array.isArray(fans) ? fans : fans ? [fans] : [])) if (f.SPEED) f.SPEED = typeof f.SPEED === 'object' ? { ...f.SPEED, value: '0' } : '0';
        }
        return json(res, 200, { ...h, _hostOn: hostOn, _health: mon.healthColour(h) });
      }
      if (what === 'memory') return json(res, 200, await mon.memory());
      if (what === 'events') return json(res, 200, await mon.events());
      if (what === 'power') { if (!mon.last) await mon.sample(); return json(res, 200, { ...mon.last, history: mon.history }); }
      if (what === 'log') { const r = u.searchParams.get('which') === 'ilo' ? await mon.rb.ilolog() : await mon.rb.iml(); return json(res, 200, r); }
      if (req.method !== 'POST') return json(res, 405, { error: 'POST' });
      const b = JSON.parse(await body(req) || '{}');
      if (what === 'powercap') { await mon.rb.setPowerCap(b.watts); log(`[${m[1]}] power cap -> ${Number(b.watts) || 'off'}`); }
      if (what === 'powersaver') { await mon.rb.setPowerSaver(b.mode); log(`[${m[1]}] power regulator -> ${b.mode}`); }
      await mon.sample();
      return json(res, 200, { ...mon.last, history: mon.history });
    } catch (e) { return json(res, 502, { error: e.message }); }
  }

  // ---- ISO library + virtual media ----
  if (u.pathname === '/api/isos') {
    fs.mkdirSync(ISO_DIR, { recursive: true });
    const list = fs.readdirSync(ISO_DIR).filter(f => /\.(iso|img)$/i.test(f)).map(f => ({ name: f, size: fs.statSync(path.join(ISO_DIR, f)).size, url: ISO_BASE + encodeURIComponent(f) }));
    return json(res, 200, list);
  }
  if ((m = u.pathname.match(/^\/iso\/([^/]+)$/)) && (req.method === 'GET' || req.method === 'HEAD')) return serveIso(req, res, decodeURIComponent(m[1]));
  if (u.pathname === '/api/iso/upload' && req.method === 'POST') {
    const name = safeName(u.searchParams.get('name') || '');
    if (!name) return json(res, 400, { error: 'name must end in .iso or .img' });
    fs.mkdirSync(ISO_DIR, { recursive: true });
    const tmp = path.join(ISO_DIR, `.${name}.part`), out = fs.createWriteStream(tmp);
    req.pipe(out);
    out.on('finish', () => { fs.renameSync(tmp, path.join(ISO_DIR, name)); log(`ISO uploaded: ${name}`); json(res, 200, { ok: true, name }); });
    out.on('error', e => json(res, 500, { error: e.message }));
    req.on('aborted', () => { out.destroy(); fs.rmSync(tmp, { force: true }); });
    return;
  }
  if ((m = u.pathname.match(/^\/api\/(\w+)\/vm$/)) && SERVERS[m[1]]) {
    const rb = monitor(m[1]).rb;   // RIBCL works for both iLO 2 and iLO 3, no console session needed
    try {
      if (req.method === 'GET') return json(res, 200, await rb.vmStatus());
      const b = JSON.parse(await body(req) || '{}');
      const device = b.device === 'FLOPPY' ? 'FLOPPY' : 'CDROM';
      if (b.action === 'eject') { await rb.vmEject(device); log(`[${m[1]}] ${device} ejected`); }
      else {
        const url = b.iso ? ISO_BASE + encodeURIComponent(safeName(b.iso)) : String(b.url || '');
        if (!/^https?:\/\//.test(url)) return json(res, 400, { error: 'need an http(s) URL or an ISO from the library' });
        await rb.vmInsert(device, url, !!b.bootOnce);
        log(`[${m[1]}] ${device} <- ${url}${b.bootOnce ? ' (boot once)' : ''}`);
      }
      return json(res, 200, await rb.vmStatus());
    } catch (e) { return json(res, 502, { error: e.message }); }
  }
  res.writeHead(404); res.end('not found\n');
});

const ISO_DIR = process.env.ISO_DIR || path.join(os.homedir(), 'iso');
const ISO_BASE = process.env.ISO_BASE || `http://${LAN_BIND || '192.168.100.250:8790'}/iso/`;
const safeName = n => { const b = path.basename(String(n)); return /^[\w.+-]+\.(iso|img)$/i.test(b) ? b : null; };
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = req => new Promise((ok, bad) => { let d = ''; req.on('data', x => { d += x; if (d.length > 1e5) req.destroy(); }); req.on('end', () => ok(d)); req.on('error', bad); });
function serveIso(req, res, name) {
  const f = safeName(name) && path.join(ISO_DIR, safeName(name));
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  const size = fs.statSync(f).size, r = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  let start = 0, end = size - 1;
  if (r) { if (r[1] === '') start = size - Number(r[2]); else { start = Number(r[1]); if (r[2]) end = Math.min(Number(r[2]), size - 1); } }
  if (start > end || start >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
  res.writeHead(r ? 206 : 200, { 'Content-Type': 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(r ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}) });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(f, { start, end }).pipe(res);
}
server.on('upgrade', (req, socket) => {
  const m = new URL(req.url, 'http://x').pathname.match(/^\/ws\/(\w+)$/);
  if (!m || !SERVERS[m[1]]) return socket.destroy();
  const w = ws.accept(req, socket); if (!w) return;
  const s = session(m[1]), v = { ws: w };
  w.on("message", t => { try { s.input(JSON.parse(t)); } catch (e) { log(`input error: ${e.message}`); } });
  w.on('close', () => s.leave(v));
  s.join(v);
});
// ---- listeners ------------------------------------------------------------------------------
try { fs.mkdirSync(path.dirname(SOCK), { recursive: true, mode: 0o700 }); } catch (_) { /* there */ }
// Never take over a live socket: a second copy (a test run, a stray start) once unlinked the running service's
// socket and left a dead file behind (Nov 27 2026). Connect first; only a refused or missing socket is removed.
const probe = net.createConnection(SOCK);
probe.on('connect', () => { probe.destroy(); log(`another iLO service already answers on ${SOCK}; exiting`); process.exit(3); });
probe.on('error', () => { try { fs.unlinkSync(SOCK); } catch (_) { /* none */ } listenSock(); });
function listenSock() { server.listen(SOCK, () => { try { fs.chmodSync(SOCK, 0o600); } catch (_) { /* kept */ } log(`listening on ${SOCK}`); }).on('error', e => { log(`socket ${SOCK}: ${e.message}`); process.exit(1); }); }

// The LAN listener answers ONLY: GET|HEAD /iso/<name> (virtual media; any LAN source) and GET /api/<server>/health,
// /history, /power from the rack hosts 192.168.100.40-43 (their login-status timers). Everything else: 404.
const { lanAllowed } = require('./lan');
function lanGate(req, res) {
  if (!lanAllowed(req.method, req.url, req.socket.remoteAddress)) { res.writeHead(404); return res.end('not found\n'); }
  return server.emit('request', req, res);
}
function listenLan() {
  if (!LAN_BIND) return;
  const idx = LAN_BIND.lastIndexOf(':'), host = LAN_BIND.slice(0, idx), port = Number(LAN_BIND.slice(idx + 1));
  if (!Object.values(os.networkInterfaces()).flat().some(a => a && a.address === host)) { log(`LAN bind ${LAN_BIND}: address not on this machine, skipped`); return; }
  const lan = http.createServer(lanGate);
  let warned = false;
  lan.on('error', e => {
    if (!warned) { warned = true; log(`LAN bind ${LAN_BIND}: ${e.message} (retrying every 60 s)`); }
    if (e.code === 'EADDRINUSE') setTimeout(() => lan.listen(port, host), 60000).unref();
  });
  lan.listen(port, host, () => log(`listening on http://${LAN_BIND}/ (iso + health/history/power only)`));
}
listenLan();
process.on('SIGINT', async () => { for (const s of Object.values(sessions)) if (s.con) await s.con.stop('server exit'); process.exit(0); });
process.on('SIGTERM', async () => { for (const s of Object.values(sessions)) if (s.con) await s.con.stop('server exit'); process.exit(0); });
