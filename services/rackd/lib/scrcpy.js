'use strict';
// Live Android screen: scrcpy-server (v5.0.1, /opt/scrcpy/scrcpy-server-v5.0.1, sha256 checked at install) driven over adb from the host.
// One stream per open Device Connection window: the server is pushed to the device, started with video + control and NO audio (the lane's
// no-audio rule), and reached through an `adb forward` to its abstract socket. H.264 Annex B access units go to the browser as binary
// WebSocket frames [flags u8 (1 config, 2 key frame)][pts float64 us][bytes]; the browser decodes them with WebCodecs. Control messages arrive as
// small JSON text frames and are encoded to scrcpy's control protocol here (only when the stream was opened with control). Nothing runs
// while no window is open: the socket closing kills the device-side server and removes the forward.
const net = require('net');
const fs = require('fs');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { run, SBIN } = require('./exec');

const VERSION = '5.0.1';
const JAR = `/opt/scrcpy/scrcpy-server-v${VERSION}`;
const DEVICE_JAR = '/data/local/tmp/scrcpy-server.jar';
const MAX_PER_DEVICE = 3, MAX_TOTAL = 8;
const KEYS = { BACK: 4, HOME: 3, APP_SWITCH: 187, RECENTS: 187, POWER: 26, VOLUME_UP: 24, VOLUME_DOWN: 25, MENU: 82, ENTER: 66, DEL: 67, FORWARD_DEL: 112, TAB: 61, ESCAPE: 111, SPACE: 62, DPAD_UP: 19, DPAD_DOWN: 20, DPAD_LEFT: 21, DPAD_RIGHT: 22, DPAD_CENTER: 23, MOVE_HOME: 122, MOVE_END: 123, PAGE_UP: 92, PAGE_DOWN: 93, CAMERA: 27, SEARCH: 84, WAKEUP: 224, SLEEP: 223, NOTIFICATION: 83 };
const active = new Map();   // streamId -> {serial, name}

const adbEnv = sdk => ({ ANDROID_SDK_ROOT: sdk, ANDROID_HOME: sdk });
function adbSpawn(sdk, adbBin, args, o = {}) {
  const env = Object.entries({ HOME: '/var/lib/rack', PATH: SBIN, LANG: 'C.UTF-8', ...adbEnv(sdk) }).map(([k, v]) => `${k}=${v}`);
  return spawn('runuser', ['-u', 'rack', '--', 'env', ...env, adbBin, ...args], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], ...o });
}
function readExact(sock, n, timeoutMs) {   // resolves a Buffer of n bytes, or null on close / timeout; leftover bytes stay pushed back
  return new Promise(resolve => {
    let buf = Buffer.alloc(0); let done = false;
    const finish = v => { if (done) return; done = true; clearTimeout(t); sock.removeListener('data', on); sock.removeListener('close', onClose); sock.pause(); resolve(v); };
    const on = d => { buf = Buffer.concat([buf, d]); if (buf.length >= n) { const rest = buf.subarray(n), got = buf.subarray(0, n); finish(got); if (rest.length) sock.unshift(rest); } };
    const onClose = () => finish(null);
    const t = setTimeout(() => finish(null), timeoutMs);
    sock.on('data', on); sock.on('close', onClose); sock.resume();
  });
}

const u32 = n => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const u16 = n => { const b = Buffer.alloc(2); b.writeUInt16BE(n & 0xffff); return b; };
const u64 = big => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt.asUintN(64, big)); return b; };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function encode(m, size) {
  const w = clamp(Math.round(Number(m.w) || size.w), 1, 65535), h = clamp(Math.round(Number(m.h) || size.h), 1, 65535);
  switch (m.t) {
    case 'touch': {
      const act = { down: 0, up: 1, move: 2 }[m.a]; if (act === undefined) return null;
      const x = clamp(Math.round(Number(m.x)), 0, w - 1), y = clamp(Math.round(Number(m.y)), 0, h - 1);
      const pressure = act === 1 ? 0 : 0xffff;
      return Buffer.concat([Buffer.from([2, act]), u64(-2n), u32(x), u32(y), u16(w), u16(h), u16(pressure), u32(0), u32(act === 1 ? 0 : 1)]);
    }
    case 'key': {
      const code = m.name ? KEYS[String(m.name).toUpperCase()] : Math.floor(Number(m.code));
      if (!Number.isInteger(code) || code < 0 || code > 400) return null;
      const mk = a => Buffer.concat([Buffer.from([0, a]), u32(code), u32(0), u32(Math.floor(Number(m.meta) || 0))]);
      return m.a === 'down' ? mk(0) : m.a === 'up' ? mk(1) : Buffer.concat([mk(0), mk(1)]);
    }
    case 'text': { const t = Buffer.from(String(m.text || '').slice(0, 300), 'utf8'); return t.length ? Buffer.concat([Buffer.from([1]), u32(t.length), t]) : null; }
    case 'scroll': {
      const x = clamp(Math.round(Number(m.x)), 0, w - 1), y = clamp(Math.round(Number(m.y)), 0, h - 1);
      const fp = v => { const b = Buffer.alloc(2); b.writeInt16BE(clamp(Math.round(clamp(v, -1, 1) * 32767), -32768, 32767)); return b; };
      return Buffer.concat([Buffer.from([3]), u32(x), u32(y), u16(w), u16(h), fp(Number(m.dx) || 0), fp(Number(m.dy) || 0), u32(0)]);
    }
    case 'rotate': return Buffer.from([11]);
    case 'screen': return Buffer.from([10, m.on === false ? 0 : 1]);
    case 'notifications': return Buffer.from([m.open === false ? 7 : 5]);
    case 'reset': return Buffer.from([17]);
    default: return null;
  }
}

/** open({ws, serial, name, control, sdk, adb, maxSize, bitrate, fps, onClose}) -> { close() }; throws on a refusal before the socket is used. */
async function open(o) {
  const id = crypto.randomBytes(4).toString('hex'); const scid = (parseInt(crypto.randomBytes(3).toString('hex'), 16) & 0x7fffff).toString(16).padStart(8, '0');
  const same = [...active.values()].filter(a => a.serial === o.serial).length;
  if (same >= MAX_PER_DEVICE || active.size >= MAX_TOTAL) { const e = new Error('too many open screens'); e.code = 'BUSY'; throw e; }
  if (!fs.existsSync(JAR)) { const e = new Error(`${JAR} is missing on the host`); e.code = 'NOT_INSTALLED'; throw e; }
  active.set(id, { serial: o.serial, name: o.name });
  const ws = o.ws; const cleanups = []; let closed = false; let size = { w: 0, h: 0 }, config = null, port = null, server = null, vsock = null, csock = null, needKey = false;
  const A = (args, opt) => run(['runuser', '-u', 'rack', '--', 'env', 'HOME=/var/lib/rack', `PATH=${SBIN}`, ...Object.entries(adbEnv(o.sdk)).map(([k, v]) => `${k}=${v}`), o.adb, '-s', o.serial, ...args], { timeoutMs: 20000, ...(opt || {}) });
  function close(why) {
    if (closed) return; closed = true; active.delete(id);
    for (const f of cleanups.reverse()) { try { f(); } catch { /* gone */ } }
    try { ws.close(); } catch { /* gone */ }
    if (o.onClose) o.onClose(why);
  }
  ws.on('close', () => close('ws'));
  try {
    // the server jar on the device (pushed when absent or a different size)
    const st = await A(['shell', `stat -c %s ${DEVICE_JAR} 2>/dev/null`]);
    if (st.stdout.trim() !== String(fs.statSync(JAR).size)) { const p = await A(['push', JAR, DEVICE_JAR], { timeoutMs: 60000 }); if (p.code !== 0) throw new Error(`adb push failed: ${(p.stderr || p.stdout).trim().slice(0, 200)}`); }
    const fw = await A(['forward', 'tcp:0', `localabstract:scrcpy_${scid}`]); if (fw.code !== 0) throw new Error(`adb forward failed: ${(fw.stderr || fw.stdout).trim().slice(0, 200)}`);
    port = Number(fw.stdout.trim().split('\n').pop()); if (!(port > 0)) throw new Error('adb forward gave no port');
    cleanups.push(() => { A(['forward', '--remove', `tcp:${port}`]).catch(() => {}); });
    const args = [`CLASSPATH=${DEVICE_JAR}`, 'app_process', '/', 'com.genymobile.scrcpy.Server', VERSION, `scid=${scid}`, 'log_level=info', 'video=true', 'audio=false', `control=${o.control ? 'true' : 'false'}`,
      'tunnel_forward=true', 'video_codec=h264', `max_size=${clamp(Number(o.maxSize) || 1280, 240, 2560)}`, `video_bit_rate=${clamp(Number(o.bitrate) || 4000000, 200000, 16000000)}`, `max_fps=${clamp(Number(o.fps) || 30, 1, 60)}`, 'power_on=false', 'send_device_meta=true', 'send_frame_meta=true', 'send_codec_meta=true', 'send_dummy_byte=true', 'cleanup=true'];
    let srvLog = '';
    server = adbSpawn(o.sdk, o.adb, ['-s', o.serial, 'shell', ...args]);
    server.stdout.on('data', d => { srvLog = (srvLog + d).slice(-2000); }); server.stderr.on('data', d => { srvLog = (srvLog + d).slice(-2000); });
    cleanups.push(() => { try { process.kill(-server.pid, 'SIGTERM'); } catch { /* gone */ } });
    server.on('close', () => { if (!closed) close('server'); });
    // the video socket: connect until the server answers with its dummy byte
    let ok = false;
    for (let i = 0; i < 40 && !closed && !ok; i++) {
      vsock = net.connect(port, '127.0.0.1'); vsock.setNoDelay(true); vsock.on('error', () => {});
      const b = await new Promise(res => { vsock.once('connect', () => res(true)); vsock.once('error', () => res(false)); });
      if (b) { const d = await readExact(vsock, 1, 700); if (d) ok = true; }
      if (!ok) { vsock.destroy(); await new Promise(r => setTimeout(r, 250)); }
    }
    if (!ok || closed) throw new Error(`scrcpy server did not start: ${srvLog.trim().split('\n').slice(-2).join(' ').slice(0, 200)}`);
    cleanups.push(() => vsock.destroy());
    if (o.control) {
      csock = net.connect(port, '127.0.0.1'); csock.setNoDelay(true); csock.on('error', () => {}); csock.on('data', () => {});   // device messages (clipboard) are drained
      await new Promise((res, rej) => { csock.once('connect', res); csock.once('error', rej); });
      cleanups.push(() => csock.destroy());
    }
    const nameB = await readExact(vsock, 64, 5000); if (!nameB) throw new Error('scrcpy sent no device name');
    const codec = await readExact(vsock, 4, 5000); if (!codec) throw new Error('scrcpy sent no video header');   // v5: the codec id ('h264'); the size follows in a session packet
    const deviceName = nameB.toString('utf8').replace(/\0+$/, '');
    let metaSent = false;
    const sendMeta = () => { metaSent = true; ws.sendText(JSON.stringify({ t: 'meta', name: deviceName, codec: 'h264', w: size.w, h: size.h, control: !!o.control, readOnly: !o.control, serial: o.serial })); };
    ws.on('message', s => {
      let m; try { m = JSON.parse(s); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'ping') return ws.sendText('{"t":"pong"}');
      if (!o.control || !csock || csock.destroyed) return;
      if (m.t === 'size') { size = { w: clamp(Number(m.w) || size.w, 1, 65535), h: clamp(Number(m.h) || size.h, 1, 65535) }; return; }
      const b = encode(m, size); if (b) csock.write(b);
    });
    // frames
    vsock.on('error', () => close('video'));
    vsock.on('close', () => close('video'));
    let acc = Buffer.alloc(0);
    vsock.on('data', d => {
      acc = acc.length ? Buffer.concat([acc, d]) : d;
      for (;;) {
        if (acc.length < 12) return;
        const hi = acc.readUInt32BE(0), lo = acc.readUInt32BE(4), len = acc.readUInt32BE(8);
        if (hi & 0x80000000) { acc = acc.subarray(12); size = { w: lo, h: len }; if (!metaSent) sendMeta(); else ws.sendText(JSON.stringify({ t: 'size', w: size.w, h: size.h })); continue; }
        if (acc.length < 12 + len) return;
        const pkt = acc.subarray(12, 12 + len); acc = acc.subarray(12 + len);
        const isConfig = !!(hi & 0x40000000), isKey = !!(hi & 0x20000000);   // v5 flags: bit 63 session [w][h], 62 config, 61 key frame
        const pts = ((hi & 0x1fffffff) * 4294967296) + lo;
        if (isConfig) { config = Buffer.from(pkt); continue; }
        if (ws.buffered() > 3 * 1048576 && !isKey) { needKey = true; continue; }   // a slow viewer: drop deltas until the next key frame
        if (needKey && !isKey) continue;
        if (isKey) needKey = false;
        if (!metaSent) sendMeta();
        const body = isKey && config ? Buffer.concat([config, pkt]) : pkt;
        const head = Buffer.alloc(9); head[0] = isKey ? 2 : 0; head.writeDoubleBE(pts, 1);
        ws.sendBinary(Buffer.concat([head, body]));
      }
    });
    vsock.resume();
    return { close, id };
  } catch (e) {
    try { ws.sendText(JSON.stringify({ t: 'error', error: String(e.message).slice(0, 300) })); } catch { /* gone */ }
    close('error'); throw e;
  }
}
const count = () => active.size;
module.exports = { open, encode, count, KEYS, VERSION, JAR };
