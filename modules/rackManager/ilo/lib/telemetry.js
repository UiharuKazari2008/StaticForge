'use strict';
// Telemetry logger: polls power / temperatures / fans as fast as each iLO allows and keeps 90 days of history.
//   data/telemetry/<server>/YYYY-MM-DD.jsonl      today (and yesterday until it is 24 h old)
//   data/telemetry/<server>/YYYY-MM-DD.jsonl.gz   older days, gzip-compressed automatically
// One JSON object per line: {"t":ms,"on":bool,"w":watts,"temp":{"Temp 1":23,...},"fan":{"Fan 1":35,...}}
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { login, logout, api } = require('./ilo3');

const DAY = 86400000;
const pad = n => String(n).padStart(2, '0');
const dayOf = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const num = v => { if (v == null) return null; const n = Number(typeof v === 'object' ? v.value : String(v).replace(/[^\d.-]/g, '')); return Number.isFinite(n) ? n : null; };
const arr = v => v == null ? [] : Array.isArray(v) ? v : [v];

class Telemetry {
  // cfg: {host, gen}; opts: {dir, intervalMs, retentionDays, user, password: () => string, ribcl, log}
  constructor(name, cfg, opts) {
    this.name = name; this.cfg = cfg;
    this.dir = path.join(opts.dir, name); fs.mkdirSync(this.dir, { recursive: true });
    this.interval = opts.intervalMs || (cfg.gen === 3 ? 5000 : 15000);
    this.retention = opts.retentionDays || 90;
    this.user = opts.user; this.pw = opts.password; this.rb = opts.ribcl; this.log = opts.log || (() => {});
    this.last = null; this.errors = 0; this.key = null; this.stopped = false;
    this.onSample = opts.onSample || null;   // Rack Manager: told of every sample (power state changes are pushed from it)
  }

  start() { this.loop(); this.maintain(); this.mt = setInterval(() => this.maintain(), 3600000); return this; }
  stop() { this.stopped = true; clearTimeout(this.timer); clearInterval(this.mt); if (this.key) logout(this.cfg.host, this.key); }

  async loop() {
    if (this.stopped) return;
    const t0 = Date.now();
    let wait = this.interval;
    try {
      const s = this.cfg.gen === 3 ? await this.sample3() : await this.sample2();
      s.t = t0; this.errors = 0;
      if (!s.on) for (const k of Object.keys(s.fan)) s.fan[k] = 0;   // the iLO reports standby speeds; fans are stopped
      this.last = s;
      if (this.onSample) try { this.onSample(s); } catch (_) { /* a listener must not stop the logger */ }
      fs.appendFileSync(path.join(this.dir, `${dayOf(t0)}.jsonl`), JSON.stringify(s) + '\n');
      wait = Math.max(500, this.interval - (Date.now() - t0));
    } catch (e) {
      this.errors++;
      if (this.errors === 1 || this.errors % 20 === 0) this.log(`[${this.name}] telemetry: ${e.message} (${this.errors}x)`);
      if (/HTTP 403|session/i.test(e.message)) this.key = null;   // re-login next time
      wait = Math.min(60000, this.interval * Math.min(this.errors, 6));
    }
    this.timer = setTimeout(() => this.loop(), wait);
  }

  // iLO 3: JSON over one long-lived session (about 1.5 s for all four calls)
  async sample3() {
    const h = this.cfg.host;
    if (!this.key) this.key = await login(h, this.user, this.pw());
    const get = p => api(h, 'GET', `/json/${p}`, { key: this.key });
    const pr = await get('power_readings'), tp = await get('health_temperature'), fa = await get('health_fans');
    const temp = {}, fan = {};
    for (const x of arr(tp.temperature)) if (!/ABSENT/i.test(x.status)) temp[x.label] = num(x.currentreading);
    for (const x of arr(fa.fans)) fan[x.label] = num(x.speed);
    return { on: /^ON$/i.test(pr.hostpwr_state || tp.hostpwr_state || ''), w: num(pr.present_power_reading), temp, fan };
  }

  // iLO 2: RIBCL (about 2.5 s per call, each with its own login)
  async sample2() {
    const pr = await this.rb.powerReadings(), hp = await this.rb.hostPower(), h = await this.rb.health();
    const d = h.GET_EMBEDDED_HEALTH_DATA || h, temp = {}, fan = {};
    for (const x of arr((d.TEMPERATURE || {}).TEMP)) if (!/not installed/i.test(x.STATUS || '')) temp[x.LABEL] = num(x.CURRENTREADING);
    for (const x of arr((d.FANS || {}).FAN)) fan[x.LABEL] = num(x.SPEED);
    const r = pr.GET_POWER_READINGS || {};
    return { on: /on/i.test(String((hp.GET_HOST_POWER || {}).HOST_POWER || '')), w: num(r.PRESENT_POWER_READING), temp, fan };
  }

  // gzip finished days once they are more than 24 h old; delete days past retention
  maintain() {
    const now = Date.now(), today = dayOf(now);
    for (const f of fs.readdirSync(this.dir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl(\.gz)?$/); if (!m) continue;
      const day = m[1], start = new Date(`${day}T00:00:00`).getTime(), p = path.join(this.dir, f);
      if (now - start > this.retention * DAY) { fs.rmSync(p, { force: true }); this.log(`[${this.name}] telemetry: removed ${f} (older than ${this.retention} days)`); continue; }
      if (!m[2] && day !== today && now - (start + DAY) >= DAY) {
        try {
          fs.writeFileSync(`${p}.gz`, zlib.gzipSync(fs.readFileSync(p), { level: 9 }));
          fs.rmSync(p);
          this.log(`[${this.name}] telemetry: compressed ${f}`);
        } catch (e) { this.log(`[${this.name}] telemetry: compress ${f}: ${e.message}`); }
      }
    }
  }

  readDay(day) {
    const p = path.join(this.dir, `${day}.jsonl`);
    let txt = '';
    try { if (fs.existsSync(p)) txt = fs.readFileSync(p, 'utf8'); else if (fs.existsSync(`${p}.gz`)) txt = zlib.gunzipSync(fs.readFileSync(`${p}.gz`)).toString('utf8'); }
    catch { return []; }
    const out = [];
    for (const l of txt.split('\n')) { if (!l) continue; try { out.push(JSON.parse(l)); } catch { /* partial line */ } }
    return out;
  }

  // Downsampled history: {power: [[t, avg, min, max]], temp: {label: [[t, avg]]}, fan: {label: [[t, avg]]}, on: [[t, 0|1]]}
  history(from, to, points = 600) {
    to = to || Date.now(); from = from || to - DAY;
    const rows = [];
    for (let d = new Date(dayOf(from) + 'T00:00:00').getTime(); d <= to; d += DAY) {
      for (const r of this.readDay(dayOf(d))) if (r.t >= from && r.t <= to) rows.push(r);
    }
    const step = Math.max(this.interval, Math.ceil((to - from) / points));
    const buckets = new Map();
    for (const r of rows) {
      const k = Math.floor((r.t - from) / step);
      let b = buckets.get(k);
      if (!b) buckets.set(k, b = { n: 0, w: [], on: 0, temp: {}, fan: {} });
      b.n++; if (r.on) b.on++;
      if (r.w != null) b.w.push(r.w);
      for (const [l, v] of Object.entries(r.temp || {})) if (v != null) (b.temp[l] = b.temp[l] || []).push(v);
      for (const [l, v] of Object.entries(r.fan || {})) if (v != null) (b.fan[l] = b.fan[l] || []).push(v);
    }
    const avg = a => Math.round(a.reduce((x, y) => x + y, 0) / a.length * 10) / 10;
    const out = { from, to, step, samples: rows.length, power: [], on: [], temp: {}, fan: {} };
    for (const k of [...buckets.keys()].sort((a, b) => a - b)) {
      const b = buckets.get(k), t = from + k * step + Math.floor(step / 2);
      if (b.w.length) out.power.push([t, avg(b.w), Math.min(...b.w), Math.max(...b.w)]);
      out.on.push([t, b.on * 2 >= b.n ? 1 : 0]);
      for (const [l, a] of Object.entries(b.temp)) (out.temp[l] = out.temp[l] || []).push([t, avg(a)]);
      for (const [l, a] of Object.entries(b.fan)) (out.fan[l] = out.fan[l] || []).push([t, avg(a)]);
    }
    return out;
  }

  usage() {
    let bytes = 0, days = 0;
    for (const f of fs.readdirSync(this.dir)) if (/\.jsonl(\.gz)?$/.test(f)) { bytes += fs.statSync(path.join(this.dir, f)).size; days++; }
    return { days, bytes, interval: this.interval, errors: this.errors, last: this.last };
  }
}

module.exports = { Telemetry };
