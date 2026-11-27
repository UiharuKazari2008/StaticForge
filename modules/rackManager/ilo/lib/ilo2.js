'use strict';
// iLO 2 remote console client (rc175p11.jar protocol): web login -> drc2fram.htm params -> TCP console
// with MD5-keyed RC4, the shared DVC decoder in 12-bit mode, character-stream keyboard.
const tls = require('tls');
const net = require('net');
const crypto = require('crypto');
const { Dvc } = require('./dvc');
const { Ilo3Console } = require('./ilo3');

const TLSOPT = { rejectUnauthorized: false, minVersion: 'TLSv1', maxVersion: 'TLSv1', ciphers: 'AES128-SHA:@SECLEVEL=0', secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT };

// Minimal HTTPS GET for iLO 2 (old TLS, cookies by hand)
function get(host, path, cookie) {
  return new Promise((resolve, reject) => {
    const s = tls.connect({ host, port: 443, ...TLSOPT }, () =>
      s.write(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n${cookie ? `Cookie: ${cookie}\r\n` : ''}\r\n`));
    // iLO 2 does not close the connection: finish on Content-Length, </html>, or 1.5 s of silence
    let d = '', idle = null; s.setEncoding('latin1');
    const done = () => { clearTimeout(idle); s.destroy(); resolve(d); };
    s.setTimeout(20000, () => { if (d) done(); else s.destroy(new Error(`${path}: timeout`)); });
    s.on('data', x => {
      d += x; clearTimeout(idle);
      const h = d.indexOf('\r\n\r\n'), cl = h > 0 && /content-length:\s*(\d+)/i.exec(d.slice(0, h));
      if ((cl && Buffer.byteLength(d.slice(h + 4), 'latin1') >= Number(cl[1])) || /<\/html>\s*$/i.test(d)) return done();
      idle = setTimeout(done, 1500);
    });
    s.on('end', () => resolve(d)); s.on('close', () => resolve(d)); s.on('error', reject);
  });
}

// HTTP response -> body, undoing chunked transfer encoding
function body(http) {
  const i = http.indexOf('\r\n\r\n'); if (i < 0) return http;
  const head = http.slice(0, i), b = http.slice(i + 4);
  if (!/transfer-encoding:\s*chunked/i.test(head)) return b;
  let o = '', p = 0;
  for (;;) {
    const e = b.indexOf('\r\n', p); if (e < 0) break;
    const n = parseInt(b.slice(p, e), 16); if (!(n > 0)) break;
    o += b.slice(e + 2, e + 2 + n); p = e + 2 + n + 2;
  }
  return o;
}

class Md5Rc4 {   // RC4 re-keyed with key = MD5(pre || key_prev)
  constructor(pre) { this.pre = Buffer.from(pre); this.key = Buffer.alloc(16); this.rekey(); }
  rekey() {
    this.key = crypto.createHash('md5').update(this.pre).update(this.key).digest();
    const s = this.s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + this.key[i % 16]) & 255; const t = s[i]; s[i] = s[j]; s[j] = t; }
    this.i = 0; this.j = 0;
  }
  next() {
    const s = this.s;
    this.i = (this.i + 1) & 255; this.j = (this.j + s[this.i]) & 255;
    const t = s[this.i]; s[this.i] = s[this.j]; s[this.j] = t;
    return s[(s[this.i] + s[this.j]) & 255];
  }
}

const ESC = '\x1b';
// F1..F12 for [none, shift, ctrl, alt]
const FKEYS = [
  'MNOPQRSTUVWX', 'YZabcdefghij', 'klmnopqrstuv', "wxyz@[\\]^_`'",
];
const SPECIAL = { Home: 'H', End: 'F', PageUp: 'I', PageDown: 'G', Insert: 'L', ArrowUp: 'A', ArrowDown: 'B', ArrowLeft: 'D', ArrowRight: 'C' };

class Ilo2Console extends Ilo3Console {
  _get(path) { return get(this.host, path, this.cookie); }
  async start() {
    const L = await get(this.host, '/login.htm');
    const skey = (L.match(/var sessionkey="([^"]+)"/) || [])[1], sidx = (L.match(/var sessionindex="([^"]+)"/) || [])[1];
    if (!skey) throw new Error('iLO 2 login page has no session key');
    const b64 = s => Buffer.from(s, 'latin1').toString('base64');
    this.cookie = `hp-iLO-Login=${sidx}:${b64(this.user)}:${b64(this.password)}:${skey}`;
    const page = body(await get(this.host, '/drc2fram.htm?restart=1', this.cookie));
    const p = {};
    for (const m of page.matchAll(/\b(info[0-9a-z]{1,3})\s*=\s*(?:"([^"]*)"|'([^']*)'|(-?\d+))\s*;/gi)) {
      const v = (m[2] ?? m[3] ?? m[4]).replace(/\s+/g, '');
      p[m[1].toUpperCase()] = v;
    }
    this.log(`page params: ${Object.entries(p).map(([k, v]) => `${k}=${(v.length > 5 && !/^\d+$/.test(v)) ? `<${v.length} chars>` : v}`).join(' ')}`);
    if (!p.INFO0) throw new Error(/sessionkey|UN\.value/.test(page) ? 'iLO 2 login failed' : 'iLO 2 console page has no session parameters');
    this.p = p;
    this.log(`logged in; console port ${p.INFO6 || 23}, encryption ${p.INFOA === '1' ? 'on' : 'off'}, mouse ${p.INFOM}`);
    try { await this.openVideo(); } catch (e) { await this.stop(e.message); throw e; }
  }

  loginString() {
    const s = this.p.INFO0;
    let l;
    if (s.startsWith('Compaq-RIB-Login=')) l = `${ESC}[!${s.slice(17, 73)}\r${s.slice(74, 106)}\r`;
    else { l = Buffer.from(s, 'base64').toString('latin1').replace(/:/g, '\r'); if (l) l += '\r'; }
    if (this.p.INFO1 !== undefined && this.p.INFO1 !== '') l = `${ESC}[4${l}`;
    return `${ESC}[7${ESC}[9${l}`;
  }

  async openVideo() {
    const port = Number(this.p.INFO6) || 23;
    const s = this.vsock = await new Promise((res, rej) => {
      const c = net.connect({ host: this.host, port }); c.setNoDelay(true);
      c.once('connect', () => { c.off('error', rej); res(c); }); c.once('error', rej);
    });
    this.dvcMode = false; this.escState = 0;
    const enc = this.p.INFOA === '1';
    if (enc) {
      this.rx = new Md5Rc4(Buffer.from(this.p.INFOB, 'hex'));
      this.tx = new Md5Rc4(Buffer.from(this.p.INFOC, 'hex'));
    }
    const me = this;
    this.dvc = new Dvc({
      resize(w, h) { me.resize(w, h); },
      paste(x, y, block, bh) { me.paste(x, y, block, bh); },
      flush() { me.emit('flush'); },
      refresh() { me.refresh(); },
      noVideo() { me.emit('status', { video: false }); },
      text(chan, str) { if (str.trim()) me.emit('status', { text: str, chan }); },
      seized() { me.stop('session taken over by another console'); },
      rekey() { if (me.rx) me.rx.rekey(); if (me.tx) me.tx.rekey(); },
    }, { gen: 2 });
    s.on('data', d => this.onVideo(d));
    s.on('close', () => this.stop('console socket closed'));
    s.on('error', e => this.log(`console socket error: ${e.message}`));
    // login: plaintext, or FF C0 + key index (BE32, not encrypted) + RC4(login)
    const login = Buffer.from(this.loginString(), 'latin1');
    if (enc) {
      const idx = Number(this.p.INFOD) || 0, hdr = Buffer.from([0xFF, 0xC0, idx >>> 24 & 255, idx >>> 16 & 255, idx >>> 8 & 255, idx & 255]);
      for (let i = 0; i < login.length; i++) login[i] ^= this.tx.next();
      s.write(Buffer.concat([hdr, login]));
    } else s.write(login);
    this.log('console connected, waiting for video');
    this.keepalive = setInterval(() => this.sendStr(`${ESC}[&`), 30000);
  }

  onVideo(d) {
    this.bytes += d.length;
    for (let i = 0; i < d.length; i++) {
      let b = d[i];
      if (this.dvcMode) {
        if (this.encrypted) b ^= this.rx.next();
        this.dvc.feed(b);
      } else if (b === 0x1b) this.escState = 1;
      else if (this.escState === 1 && b === 0x5b) this.escState = 2;
      else if (this.escState === 2 && (b === 0x52 || b === 0x72)) {
        this.dvcMode = true; this.encrypted = b === 0x52 && !!this.rx;
        this.log(`video stream started (${this.encrypted ? 'RC4' : 'no encryption'})`);
      } else this.escState = 0;
    }
    this.emit('flush');
  }

  sendStr(str) {
    if (!this.vsock || this.vsock.destroyed || !str) return;
    const b = Buffer.from(str, 'latin1');
    if (this.tx) for (let i = 0; i < b.length; i++) b[i] ^= this.tx.next();
    this.vsock.write(b);
  }
  send(bytes) { this.sendStr(Buffer.from(bytes).toString('latin1')); }

  // Browser key event -> iLO 2 character / escape sequence (keydown only)
  keyEvent(m) {
    if (!m.down) return;
    const n = m.shift ? 1 : m.ctrl ? 2 : m.alt ? 3 : 0, code = m.code || '', key = m.key || '';
    const pre = ['', `${ESC}[3`, `${ESC}[2`, `${ESC}[1`][n];
    let f;
    if ((f = code.match(/^F(\d{1,2})$/)) && f[1] >= 1 && f[1] <= 12) return this.sendStr(`${ESC}[${FKEYS[n][f[1] - 1]}`);
    if (SPECIAL[code]) return this.sendStr(pre + `${ESC}[${SPECIAL[code]}`);
    if (code === 'Escape') return this.sendStr(ESC);
    if (code === 'Tab') return this.sendStr(pre + '\t');
    if (code === 'Delete') return this.sendStr(m.ctrl && m.alt ? `${ESC}[2${ESC}[\x7f` : '\x7f');
    if (code === 'Enter' || code === 'NumpadEnter') return this.sendStr(['\r', `${ESC}[3\r`, '\n', `${ESC}[1\r`][n]);
    if (code === 'Backspace') return this.sendStr(['\b', `${ESC}[3\b`, '\x7f', `${ESC}[1\b`][n]);
    if (key.length === 1) {
      let ch = key;
      if (m.ctrl && /^[a-z@\[\\\]^_]$/i.test(key)) ch = String.fromCharCode(key.toUpperCase().charCodeAt(0) & 0x1f);
      return this.sendStr((m.alt ? `${ESC}[1` : '') + ch);
    }
  }
  pressKey() {}
  releaseAll() {}
  typeText(text) { this.sendStr(text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r').replace(/[^\x09\x0d\x20-\x7e]/g, '')); return Promise.resolve(); }
  combo(mod, usage) {
    if (mod === 0x05 && usage === 0x4C) return this.sendStr(`${ESC}[2${ESC}[\x7f`);   // Ctrl-Alt-Del
    const fn = usage - 0x3A;   // F-keys
    if (fn >= 0 && fn < 12) return this.sendStr(mod === 0x04 ? `${ESC}[${FKEYS[3][fn]}` : `${ESC}[2${ESC}[1${ESC}[${FKEYS[0][fn]}`);
  }
  mouse(x, y, buttons) {
    if (!this.width || x < 0 || y < 0 || x > this.width || y > this.height) return;
    const px = this.mx ?? x, py = this.my ?? y, pb = this.mb ?? 0; this.mx = x; this.my = y; this.mb = buttons;
    const cl = v => Math.max(-127, Math.min(127, v)) & 255;
    const X = Math.floor(x * 3000 / this.width), Y = Math.floor(y * 3000 / this.height);
    const abs = this.p && this.p.INFOM && this.p.INFOM !== '0';
    const mv = [0xFF, 0xD0, cl(x - px), cl(y - py)];
    if (abs) mv.push(X >> 8, X & 255, Y >> 8, Y & 255);
    if (x !== px || y !== py || abs) this.send(mv);
    // our bits: 1 left, 2 right, 4 middle -> iLO 2 codes: 4 left, 1 right, 2 middle
    for (const [ours, theirs] of [[1, 4], [2, 1], [4, 2]]) {
      if ((buttons & ours) && !(pb & ours)) this.send([0xFF, 0xD1, theirs]);
      if (!(buttons & ours) && (pb & ours)) this.send([0xFF, 0xD2, theirs]);
    }
  }
  powerButton() { this.log('power buttons go through RIBCL on iLO 2'); }
  refresh() { this.sendStr(`${ESC}[~`); }

  async stop(reason = 'stopped') {
    if (this.closed) return; this.closed = true;
    clearInterval(this.keepalive);
    this.log(`closing: ${reason}`);
    if (this.vsock) this.vsock.destroy();
    if (this.cookie) { try { await get(this.host, '/logout.htm', this.cookie); } catch { /* ignore */ } }
    this.emit('close', reason);
  }
}

module.exports = { Ilo2Console };
