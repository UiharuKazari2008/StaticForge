'use strict';
// Minimal WebSocket server side (RFC 6455): handshake, unfragmented text/binary frames, ping/close.
const crypto = require('crypto');
const { EventEmitter } = require('events');

function accept(req, socket) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return null; }
  const acc = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${acc}\r\n\r\n`);
  socket.setNoDelay(true);
  const ws = new EventEmitter();
  let buf = Buffer.alloc(0), open = true;
  const frame = (op, payload) => {
    if (!open) return;
    const n = payload.length; let h;
    if (n < 126) h = Buffer.from([0x80 | op, n]);
    else if (n < 65536) { h = Buffer.alloc(4); h[0] = 0x80 | op; h[1] = 126; h.writeUInt16BE(n, 2); }
    else { h = Buffer.alloc(10); h[0] = 0x80 | op; h[1] = 127; h.writeBigUInt64BE(BigInt(n), 2); }
    socket.write(Buffer.concat([h, payload]));
  };
  ws.sendText = s => frame(1, Buffer.from(s));
  ws.sendBinary = b => frame(2, b);
  ws.close = () => { if (open) { frame(8, Buffer.alloc(0)); open = false; socket.end(); } };
  ws.buffered = () => socket.writableLength;
  socket.on('data', d => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15, masked = buf[1] & 0x80; let n = buf[1] & 127, o = 2;
      if (n === 126) { if (buf.length < 4) return; n = buf.readUInt16BE(2); o = 4; }
      else if (n === 127) { if (buf.length < 10) return; n = Number(buf.readBigUInt64BE(2)); o = 10; }
      const mo = o; if (masked) o += 4;
      if (buf.length < o + n) return;
      const p = Buffer.from(buf.subarray(o, o + n));
      if (masked) for (let i = 0; i < n; i++) p[i] ^= buf[mo + (i & 3)];
      buf = buf.subarray(o + n);
      if (op === 1) ws.emit('message', p.toString('utf8'));
      else if (op === 2) ws.emit('binary', p);
      else if (op === 8) { ws.close(); }
      else if (op === 9) frame(10, p);
    }
  });
  socket.on('close', () => { open = false; ws.emit('close'); });
  socket.on('error', () => { open = false; });
  return ws;
}
module.exports = { accept };
