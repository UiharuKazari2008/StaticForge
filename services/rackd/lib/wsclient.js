'use strict';
// Minimal WebSocket client (RFC 6455) for CDP and tests: text/binary, fragments, ping.
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');

function connect(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({ host: u.hostname, port: u.port || 80, path: u.pathname + u.search, headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13', ...headers } });
    req.on('error', reject);
    req.on('response', res => { res.resume(); reject(new Error(`websocket refused: HTTP ${res.statusCode}`)); });
    req.on('upgrade', (res, socket, head) => {
      const ws = new EventEmitter();
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0), open = true, frags = [], fop = 0;
      const send = (op, payload) => {
        if (!open) return;
        const n = payload.length; const mask = crypto.randomBytes(4); let h;
        if (n < 126) h = Buffer.from([0x80 | op, 0x80 | n]);
        else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 0x80 | 126; h.writeUInt16BE(n, 2); }
        else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 0x80 | 127; h.writeBigUInt64BE(BigInt(n), 2); }
        const m = Buffer.from(payload); for (let i = 0; i < n; i++) m[i] ^= mask[i & 3];
        socket.write(Buffer.concat([h, mask, m]));
      };
      ws.sendText = s => send(1, Buffer.from(s));
      ws.sendBinary = b => send(2, b);
      ws.close = () => { if (open) { send(8, Buffer.alloc(0)); open = false; socket.end(); } };
      const pump = () => {
        for (;;) {
          if (buf.length < 2) return;
          const fin = buf[0] & 0x80, op = buf[0] & 15; let n = buf[1] & 127, o = 2;
          if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); o = 4; }
          else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); o = 10; }
          if (buf.length < o + n) return;
          const p = Buffer.from(buf.subarray(o, o + n)); buf = buf.subarray(o + n);
          if (op === 9) { send(10, p); continue; }
          if (op === 8) { ws.close(); continue; }
          if (op === 10) continue;
          if (op === 1 || op === 2) { fop = op; frags = [p]; } else if (op === 0) frags.push(p);
          if (fin) { const all = Buffer.concat(frags); frags = []; if (fop === 1) ws.emit('message', all.toString('utf8')); else ws.emit('binary', all); }
        }
      };
      socket.on('data', d => { buf = Buffer.concat([buf, d]); pump(); });
      socket.on('close', () => { open = false; ws.emit('close'); });
      socket.on('error', () => { open = false; });
      if (buf.length) pump();
      resolve(ws);
    });
    req.end();
  });
}
module.exports = { connect };
