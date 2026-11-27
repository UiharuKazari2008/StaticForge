'use strict';
// iLO 3 remote console client: web login, rc_info, video socket (+ command socket), stream cipher.
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { Dvc } = require('./dvc');

// iLO 3 fw 1.94 with "enforce AES" on: TLS 1.0/1.1, AES-CBC-SHA, legacy renegotiation.
const TLS = {
  rejectUnauthorized: false, minVersion: 'TLSv1', maxVersion: 'TLSv1.1',
  ciphers: 'AES128-SHA:AES256-SHA:@SECLEVEL=0', secureOptions: crypto.constants.SSL_OP_LEGACY_SERVER_CONNECT,
};

function api(host, method, path, { body, key } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {};
    if (data) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(data); }
    if (key) headers.Cookie = `sessionKey=${key}`;
    const r = https.request({ ...TLS, host, method, path, headers, timeout: 20000 }, res => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', x => d += x);
      res.on('end', () => {
        let j = null; try { j = JSON.parse(d); } catch { /* not JSON */ }
        if (res.statusCode !== 200) return reject(new Error(`${method} ${path}: HTTP ${res.statusCode} ${j && j.message || d.slice(0, 120)}`));
        resolve(j !== null ? j : d);
      });
    });
    r.on('timeout', () => r.destroy(new Error(`${path}: timeout`)));
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

async function login(host, user, password) {
  const j = await api(host, 'POST', '/json/login_session', { body: { method: 'login', user_login: user, password } });
  if (!j || !j.session_key) throw new Error('login: no session_key in reply');
  return j.session_key;
}
async function logout(host, key) {
  try { await api(host, 'POST', '/json/login_session', { body: { method: 'logout', session_key: key }, key }); } catch { /* ignore */ }
}

class Rc4 {
  constructor(key) {
    const s = this.s = new Uint8Array(256);
    for (let i = 0; i < 256; i++) s[i] = i;
    for (let i = 0, j = 0; i < 256; i++) { j = (j + s[i] + key[i % 16]) & 255; const t = s[i]; s[i] = s[j]; s[j] = t; }
    this.i = 0; this.j = 0;
  }
  next() {
    const s = this.s;
    this.i = (this.i + 1) & 255; this.j = (this.j + s[this.i]) & 255;
    const t = s[this.i]; s[this.i] = s[this.j]; s[this.j] = t;
    return s[(s[this.i] + s[this.j]) & 255];
  }
}
class AesOfb {   // AES-128, OFB, IV = 0 (Aes.java randomValue)
  constructor(key) {
    this.c = crypto.createCipheriv('aes-128-ecb', Buffer.from(key), null); this.c.setAutoPadding(false);
    this.iv = Buffer.alloc(16); this.n = 0;
  }
  next() {
    if (this.n === 0) this.iv = this.c.update(this.iv);
    const b = this.iv[this.n]; this.n = (this.n + 1) & 15; return b;
  }
}
const makeKs = (cipher, key) => cipher === 1 ? new Rc4(key) : (cipher === 2 || cipher === 3) ? new AesOfb(key) : null;

// Reads single handshake bytes from a socket before streaming starts.
function byteReader(sock) {
  let buf = Buffer.alloc(0), waiter = null;
  const onData = d => { buf = Buffer.concat([buf, d]); if (waiter) { const w = waiter; waiter = null; w(); } };
  sock.on('data', onData);
  return {
    async byte(ms = 15000) {
      while (buf.length === 0) {
        await new Promise((res, rej) => { waiter = res; setTimeout(() => rej(new Error('handshake timeout')), ms).unref(); });
      }
      const b = buf[0]; buf = buf.subarray(1); return b;
    },
    detach() { sock.off('data', onData); const rest = buf; buf = Buffer.alloc(0); return rest; },
  };
}

function connectTcp(host, port) {
  return new Promise((res, rej) => {
    const s = net.connect({ host, port }); s.setNoDelay(true);
    s.once('connect', () => { s.off('error', rej); res(s); }); s.once('error', rej);
  });
}

function loginPacket(channel, key, info) {
  const feats = String(info.optional_features || '');
  const scramble = feats.includes('ENCRYPT_KEY');
  const flags = scramble ? (feats.includes('ENCRYPT_VMKEY') ? 0x40 : 0x80) : 0;
  const tok = Buffer.from(key, 'latin1');
  if (scramble) { const k = String(info.enc_key); for (let i = 0; i < tok.length; i++) tok[i] ^= k.charCodeAt(i % k.length); }
  return Buffer.concat([Buffer.from([channel, 0x20 | flags]), tok]);
}

// Events: 'resize'(w,h), 'update'(x,y,w,h), 'flush', 'power'(bool), 'status'(obj), 'log'(msg), 'close'(reason)
class Ilo3Console extends EventEmitter {
  constructor({ host, user, password, name }) {
    super();
    Object.assign(this, { host, user, password, name: name || host });
    this.width = 0; this.height = 0; this.fb = new Uint32Array(0);
    this.encrypted = false; this.cipher = 0; this.keys = new Set(); this.closed = false;
    this.info = {}; this.power = null; this.bytes = 0;
  }
  log(m) { this.emit('log', `[${this.name}] ${m}`); }

  async start() {
    this.key = await login(this.host, this.user, this.password);
    this.log('logged in');
    try {
      const info = this.info = await api(this.host, 'GET', '/json/rc_info', { key: this.key });
      this.encKey = Buffer.from(String(info.enc_key), 'hex');
      if (this.encKey.length !== 16) throw new Error('rc_info: bad enc_key');
      this.port = Number(info.rc_port) || 17990;
      this.log(`rc_info: port ${this.port}, features "${info.optional_features || ''}"`);
      await this.openVideo();
      this.openCmd().catch(e => this.log(`command socket: ${e.message}`));
    } catch (e) { await this.stop(e.message); throw e; }
  }

  async handshake(sock, channel) {
    const rd = byteReader(sock);
    const hello = await rd.byte();
    if (hello !== 0x50) throw new Error(`channel ${channel}: unexpected hello 0x${hello.toString(16)}`);
    sock.write(loginPacket(channel, this.key, this.info));
    let st = await rd.byte();
    if ((st === 0x53 || st === 0x59) && channel === 1) {
      this.log('another console session is active: seizing it');
      sock.write(Buffer.from([0x55, 0x00]));
      st = await rd.byte();
    }
    const why = { 0x51: 'access denied', 0x57: 'no licence', 0x58: 'no free console sessions' }[st];
    if (why) throw new Error(`channel ${channel}: ${why}`);
    return rd.detach();
  }

  async openVideo() {
    const s = this.vsock = await connectTcp(this.host, this.port);
    const rest = await this.handshake(s, 1);
    this.log('video channel connected');
    const me = this;
    this.dvc = new Dvc({
      resize(w, h) { me.resize(w, h); },
      paste(x, y, block, bh) { me.paste(x, y, block, bh); },
      flush() { me.emit('flush'); },
      cipher(c) { me.setCipher(c); },
      ping() { me.send([0x0C, 0x00]); },
      refresh() { me.send([0x05, 0x00]); },
      power(on) { me.power = on; me.emit('power', on); },
      noVideo() { me.emit('status', { video: false }); },
      text(chan, str) { if (str.trim()) me.emit('status', { text: str, chan }); },
      seized() { me.stop('session taken over by another console'); },
      licensed() {},
    });
    s.on('data', d => this.onVideo(d));
    s.on('close', () => this.stop('video socket closed'));
    s.on('error', e => this.log(`video socket error: ${e.message}`));
    if (rest.length) this.onVideo(rest);
  }

  async openCmd() {
    const s = this.csock = await connectTcp(this.host, this.port);
    await this.handshake(s, 2);
    this.log('command channel connected');
    let buf = Buffer.alloc(0);
    const SIZES = { 2: 0, 3: 1, 4: 1, 5: 2, 6: 128, 7: 4, 8: 0, 9: 128, 10: 0 };
    s.on('data', d => {
      buf = Buffer.concat([buf, d]);
      while (buf.length >= 12) {
        const type = buf[0], len = SIZES[type] !== undefined ? SIZES[type] : buf.readUInt32LE(4);
        if (buf.length < 12 + len) break;
        const p = buf.subarray(12, 12 + len), h10 = buf[10];
        buf = buf.subarray(12 + len);
        if (type === 3) { this.power = p[0] !== 0; this.emit('power', this.power); }
        else if (type === 4) this.emit('status', { health: ['green', 'yellow', 'red'][p[0]] || 'off' });
        else if (type === 5) this.emit('status', { post: p.length === 2 ? ((p[1] << 8) | p[0]).toString(16).padStart(4, '0') : '' });
        else if (type === 2) this.emit('status', { post: 'complete' });
        else if (type === 6) {
          const who = p.toString('latin1', 0, 64).replace(/[\0 ]+$/, ''), from = p.toString('latin1', 64).replace(/[\0 ]+$/, '');
          this.log(`${who} at ${from} asks to take over the console (${h10}s): allowing`);
          s.write(Buffer.from([4, 0, 0, 0]));
        } else if (type === 9) s.write(Buffer.from([3, 0, 0, 0]));
        else if (type === 10) this.stop('iLO firmware upgrade in progress');
        else this.log(`command msg type ${type}`);
      }
    });
    s.on('error', e => this.log(`command socket error: ${e.message}`));
  }

  setCipher(c) {
    this.cipher = c;
    this.rx = makeKs(c, this.encKey); this.tx = makeKs(c, this.encKey);
    this.encrypted = !!this.rx;
    this.log(`video cipher ${['none', 'RC4', 'AES-128', 'AES-128 (256)'][c] || c}`);
    setTimeout(() => this.send([0x05, 0x00]), 200);
  }

  onVideo(d) {
    this.bytes += d.length;
    const dvc = this.dvc;
    for (let i = 0; i < d.length; i++) {
      const b = this.encrypted ? d[i] ^ this.rx.next() : d[i];
      dvc.feed(b);       // may switch this.encrypted for the following bytes
    }
    this.emit('flush');
  }

  resize(w, h) {
    if (w === this.width && h === this.height) return;
    this.width = w; this.height = h; this.fb = new Uint32Array(w * h);
    this.log(`screen ${w}x${h}`);
    this.emit('resize', w, h);
  }
  paste(x, y, block, bh) {
    const W = this.width, H = this.height, fb = this.fb;
    for (let r = 0; r < bh; r++) {
      const yy = y + r; if (yy >= H) break;
      const o = yy * W;
      for (let c = 0; c < 16; c++) { const xx = x + c; if (xx < W) fb[o + xx] = block[r * 16 + c]; }
    }
    this.emit('update', x, y, 16, bh);
  }

  send(bytes) {
    if (!this.vsock || this.vsock.destroyed) return;
    const b = Buffer.from(bytes);
    if (this.encrypted) for (let i = 0; i < b.length; i++) b[i] ^= this.tx.next();
    this.vsock.write(b);
  }

  // HID boot report from the set of held usages
  sendKeys() {
    let mod = 0; const ks = [];
    for (const u of this.keys) { if (u >= 0xE0 && u <= 0xE7) mod |= 1 << (u - 0xE0); else ks.push(u); }
    const r = [0x01, 0x00, mod, 0x00, 0, 0, 0, 0, 0, 0];
    for (let i = 0; i < Math.min(ks.length, 6); i++) r[4 + i] = ks[i];
    this.send(r);
  }
  pressKey(usage, down) { if (down) this.keys.add(usage); else this.keys.delete(usage); this.sendKeys(); }
  releaseAll() { this.keys.clear(); this.sendKeys(); }
  async combo(mod, usage) {   // e.g. Ctrl-Alt-Del = combo(0x05, 0x4C)
    const w = ms => new Promise(r => setTimeout(r, ms));
    this.send([1, 0, mod, 0, usage, 0, 0, 0, 0, 0]); await w(250);
    this.send([1, 0, mod, 0, 0, 0, 0, 0, 0, 0]); await w(250);
    this.send([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]); this.keys.clear();
  }
  mouse(x, y, buttons) {
    if (!this.width || x < 0 || y < 0 || x > this.width || y > this.height) return;
    const X = Math.floor(x * 3000 / this.width), Y = Math.floor(y * 3000 / this.height);
    const px = this.mx ?? x, py = this.my ?? y; this.mx = x; this.my = y;
    const cl = v => Math.max(-127, Math.min(127, v)) & 255;
    this.send([2, 0, X & 255, X >> 8, Y & 255, Y >> 8, cl(x - px), cl(py - y), buttons & 7, 0]);
  }
  powerButton(op) { this.send([0, 0, op & 3, 0]); }   // 0 press, 1 hold, 2 cycle, 3 reset
  refresh() { this.send([0x05, 0x00]); }

  // Type text as key presses (US layout). Queued so pastes don't interleave.
  typeText(text, delay = 12) {
    const w = ms => new Promise(r => setTimeout(r, ms));
    this.typing = (this.typing || Promise.resolve()).then(async () => {
      this.keys.clear();
      for (const ch of text.replace(/\r\n?/g, '\n')) {
        const k = charToHid(ch); if (!k || this.closed) continue;
        this.send([1, 0, k[0], 0, k[1], 0, 0, 0, 0, 0]); await w(delay);
        this.send([1, 0, 0, 0, 0, 0, 0, 0, 0, 0]); await w(delay);
      }
    });
    return this.typing;
  }

  // Virtual media from a URL (the iLO downloads the image itself). device: 'CDROM' | 'FLOPPY'
  vmStatus() { return api(this.host, 'GET', '/json/vm_status', { key: this.key }); }
  async vmInsert(device, url, boot = 'CONNECT') {
    const post = body => api(this.host, 'POST', '/json/vm_status', { key: this.key, body: { method: 'set_virtual_media_options', device, ...body, session_key: this.key } });
    await post({ command: 'INSERT', url });
    await post({ command: 'SET', boot_option: boot, url });
  }
  vmEject(device) {
    return api(this.host, 'POST', '/json/vm_status', { key: this.key, body: { method: 'set_virtual_media_options', device, command: 'EJECT', session_key: this.key } });
  }

  async stop(reason = 'stopped') {
    if (this.closed) return; this.closed = true;
    this.log(`closing: ${reason}`);
    for (const s of [this.vsock, this.csock]) if (s) s.destroy();
    if (this.key) await logout(this.host, this.key);
    this.emit('close', reason);
  }
}

// US-layout character -> [modifier, HID usage]
const SHIFT = 0x02;
const US = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => { US[c] = [0, 0x04 + i]; US[c.toUpperCase()] = [SHIFT, 0x04 + i]; });
'1234567890'.split('').forEach((c, i) => { US[c] = [0, 0x1E + i]; });
'!@#$%^&*()'.split('').forEach((c, i) => { US[c] = [SHIFT, 0x1E + i]; });
for (const [plain, shifted, u] of [['-', '_', 0x2D], ['=', '+', 0x2E], ['[', '{', 0x2F], [']', '}', 0x30], ['\\', '|', 0x31],
  [';', ':', 0x33], ["'", '"', 0x34], ['`', '~', 0x35], [',', '<', 0x36], ['.', '>', 0x37], ['/', '?', 0x38]]) { US[plain] = [0, u]; US[shifted] = [SHIFT, u]; }
Object.assign(US, { ' ': [0, 0x2C], '\n': [0, 0x28], '\t': [0, 0x2B] });
const charToHid = ch => US[ch] || null;

module.exports = { Ilo3Console, login, logout, api, charToHid };
