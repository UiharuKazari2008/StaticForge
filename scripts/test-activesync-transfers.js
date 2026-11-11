'use strict';

// ActiveSync file bodies (Yozora #747, modules/activeSyncTransfers.js) over a real express app:
// a download relayed from the device in chunks (headers, range, order, a desktop that goes away),
// an upload in chunks pulled by the device with Range, resume after a wrong offset, the queue for an
// offline partner and its release, and who may call what.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const WebSocket = require('ws');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activesync-transfers-'));
const as = require('../modules/activeSync');
const transfers = require('../modules/activeSyncTransfers');
as.resetForTests(tmpDir);
transfers.resetForTests();

const server = {
    clients: new Map(),
    sendToClient(ws, msg) { if (ws.onMessage) ws.onMessage(msg); },
    broadcast() {}
};
const gr = { getPath: () => tmpDir, getWebSocketServer: () => server };
const keepAlive = setInterval(() => {}, 1000);

function connect(sessionId, userType = 'admin') {
    const ws = { readyState: WebSocket.OPEN, onMessage: null };
    const info = { authenticated: true, userType, sessionId, clientId: Math.random().toString(16).slice(2, 14), connectedAt: new Date() };
    server.clients.set(ws, info);
    return { ws, info };
}

const app = express();
app.use(express.json());
// the test's sessions: "admin:<sid>" / "readonly:<sid>" in a header
const auth = (req, res, next) => {
    const [type, sid] = String(req.headers['x-test-session'] || '').split(':');
    if (!type) { res.status(401).end(); return; }
    req.userType = type;
    req.sessionId = sid;
    next();
};
transfers.mount(app, auth, gr);

function request(port, method, url, { session, headers = {}, body = null, json = null } = {}) {
    return new Promise((resolve, reject) => {
        const payload = json ? Buffer.from(JSON.stringify(json)) : body;
        const req = http.request({ host: '127.0.0.1', port, method, path: url, headers: Object.assign({ 'x-test-session': session || '' }, json ? { 'content-type': 'application/json' } : (payload ? { 'content-type': 'application/octet-stream' } : {}), payload ? { 'content-length': payload.length } : {}, headers) }, (res) => {
            const parts = [];
            res.on('data', (c) => parts.push(c));
            res.on('end', () => {
                const buf = Buffer.concat(parts);
                let parsed = null;
                try { parsed = JSON.parse(buf.toString('utf8')); } catch (_) { /* binary */ }
                resolve({ status: res.statusCode, headers: res.headers, body: buf, json: parsed });
            });
            res.on('error', reject);
        });
        req.on('error', reject);
        if (payload) req.write(payload);
        req.end();
    });
}

async function main() {
    const listener = app.listen(0, '127.0.0.1');
    await new Promise((r) => listener.on('listening', r));
    const port = listener.address().port;
    const DEV = 'a1b2c3d4e5f60718';
    const PC = '00112233445566778899aabbccddeeff';
    const ADMIN = 'admin:pc-session';
    const PHONE = 'admin:phone-session';

    const pc = connect('pc-session');
    as.hello(gr, server, pc.info, { kind: 'computer', id: PC, name: 'PC', ops: [] });
    const phone = connect('phone-session');
    as.hello(gr, server, phone.info, { kind: 'device', id: DEV, name: 'Phone', ops: ['partnership.*', 'stream.*', 'storage.*'] });

    const FILE = Buffer.alloc(2500000);
    for (let i = 0; i < FILE.length; i += 1) FILE[i] = (i * 31 + 7) & 0xff;
    let sendMode = 'ok';
    const sends = [];
    const post = (id, seq, buf, end, headers) => request(port, 'POST', `/api/activesync/transfer/${id}/chunk?seq=${seq}${end ? '&end=1' : ''}`, { session: PHONE, body: buf, headers });

    // the device's side of the protocol, as the agent does it
    const answer = (callId, ok, payload) => as.reply(phone.info, Object.assign({ callId, ok }, ok ? { result: payload } : { error: payload }));
    phone.ws.onMessage = (msg) => {
        if (msg.type !== 'as_request') return;
        const { callId, op, args } = msg.data;
        (async () => {
            if (op === 'partnership.propose') return { accept: true };
            if (op === 'stream.send') {
                sends.push(args);
                if (sendMode === 'missing') throw { code: 'ENOENT', message: 'No such file' };
                let data = FILE;
                let status = 200;
                const head = { 'x-as-type': args.thumb ? 'image/jpeg' : 'video/mp4', 'x-as-mtime': '1700000000000' };
                const m = /^bytes=(\d+)-(\d*)$/.exec(args.range || '');
                if (m) {
                    const a = Number(m[1]);
                    const b = m[2] === '' ? FILE.length - 1 : Number(m[2]);
                    data = FILE.subarray(a, b + 1);
                    status = 206;
                    head['x-as-range'] = `bytes ${a}-${b}/${FILE.length}`;
                }
                head['x-as-status'] = String(status);
                head['x-as-length'] = String(data.length);
                const CH = 1024 * 1024;
                let seq = 0;
                if (sendMode === 'disorder') {
                    const r = await post(args.transferId, 3, data.subarray(0, 10), false, head);
                    assert.strictEqual(r.status, 409);
                    assert.strictEqual(r.json.expected, 0);
                }
                for (let off = 0; off < data.length || seq === 0; off += CH) {
                    const end = off + CH >= data.length;
                    const r = await post(args.transferId, seq, data.subarray(off, off + CH), end, seq === 0 ? head : {});
                    if (r.status === 410) return { stopped: true };
                    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
                    seq += 1;
                    if (end) break;
                }
                return { bytes: data.length };
            }
            if (op === 'stream.receive') {
                // pull in two ranges, as the phone's lazy file does
                const half = Math.floor(args.size / 2);
                const parts = [];
                if (args.size > 0) {
                    for (const range of [`bytes=0-${half - 1}`, `bytes=${half}-${args.size - 1}`]) {
                        const r = await request(port, 'GET', `/api/activesync/transfer/${args.transferId}/data`, { session: PHONE, headers: { range } });
                        assert.strictEqual(r.status, 206);
                        parts.push(r.body);
                    }
                }
                phone.received = { args, data: Buffer.concat(parts) };
                return { name: args.name, size: args.size, path: `${args.dir}/${args.name}` };
            }
            throw { code: 'UNSUPPORTED', message: 'no' };
        })().then((r) => answer(callId, true, r), (e) => answer(callId, false, { code: e.code || 'FAILED', message: e.message || String(e) }));
    };

    // pending: no files yet
    let r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/DCIM/a.mp4`, { session: ADMIN });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.code, 'NOT_CONNECTED');
    await as.partnership(gr, server, pc.info, { action: 'propose', deviceId: DEV, mode: 'partner', name: 'Phone' });

    // who may ask
    r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/DCIM/a.mp4`, { session: 'readonly:x' });
    assert.strictEqual(r.status, 403);
    r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/DCIM/a.mp4`, {});
    assert.strictEqual(r.status, 401);

    // a whole file, in three chunks
    r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/DCIM/Camera/a%20b.mp4`, { session: ADMIN });
    assert.strictEqual(r.status, 200);
    assert.strictEqual(r.headers['content-type'], 'video/mp4');
    assert.strictEqual(r.headers['content-length'], String(FILE.length));
    assert.strictEqual(r.headers['accept-ranges'], 'bytes');
    assert.ok(/sandbox/.test(r.headers['content-security-policy']));
    assert.ok(r.body.equals(FILE));
    assert.strictEqual(sends[0].root, 'primary');
    assert.strictEqual(sends[0].path, '/DCIM/Camera/a b.mp4');
    assert.strictEqual(sends[0].thumb, 0);

    // a range, a thumbnail, a download
    r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/a.mp4`, { session: ADMIN, headers: { range: 'bytes=100-1099' } });
    assert.strictEqual(r.status, 206);
    assert.strictEqual(r.headers['content-range'], `bytes 100-1099/${FILE.length}`);
    assert.ok(r.body.equals(FILE.subarray(100, 1100)));
    r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/a.jpg?thumb=256`, { session: ADMIN });
    assert.strictEqual(r.headers['content-type'], 'image/jpeg');
    assert.ok(/max-age/.test(r.headers['cache-control']));
    assert.strictEqual(sends[sends.length - 1].thumb, 256);
    r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/My%20Clip.mp4?download=1`, { session: ADMIN });
    assert.ok(/attachment; filename\*=UTF-8''My%20Clip\.mp4/.test(r.headers['content-disposition']));

    // a chunk out of order is refused and the stream still completes; a missing file is the phone's 404
    sendMode = 'disorder';
    r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/a.mp4`, { session: ADMIN });
    assert.ok(r.body.equals(FILE));
    sendMode = 'missing';
    r = await request(port, 'GET', `/api/activesync/file/${DEV}/primary/none.mp4`, { session: ADMIN });
    assert.strictEqual(r.status, 404);
    assert.strictEqual(r.json.code, 'ENOENT');
    sendMode = 'ok';

    // chunks from another session, or for no stream
    r = await request(port, 'POST', '/api/activesync/transfer/00000000000000000000000000000000/chunk?seq=0', { session: PHONE, body: Buffer.from('x') });
    assert.strictEqual(r.status, 410);

    // ---- upload: begin, chunks (one resent at a stale offset), commit; the phone pulls it
    const UP = Buffer.from('The quick brown fox. '.repeat(300000)); // ~6.3 MB, two chunks
    r = await request(port, 'POST', `/api/activesync/upload/${DEV}/begin`, { session: 'readonly:x', json: { name: 'a.txt', size: 1 } });
    assert.strictEqual(r.status, 403);
    r = await request(port, 'POST', `/api/activesync/upload/${DEV}/begin`, { session: ADMIN, json: { root: 'primary', dir: '/Download', name: 'no/tes?.txt', size: UP.length, conflict: 'rename', mtime: 1700000000000 } });
    assert.strictEqual(r.status, 200);
    const { id, chunkSize } = r.json;
    assert.strictEqual(chunkSize, transfers.UPLOAD_CHUNK_BYTES);
    r = await request(port, 'POST', `/api/activesync/upload/${id}/commit`, { session: ADMIN, json: {} });
    assert.strictEqual(r.status, 409, 'not all here yet');
    r = await request(port, 'POST', `/api/activesync/upload/${id}/chunk?offset=0`, { session: ADMIN, body: UP.subarray(0, chunkSize) });
    assert.strictEqual(r.json.received, chunkSize);
    r = await request(port, 'POST', `/api/activesync/upload/${id}/chunk?offset=0`, { session: ADMIN, body: UP.subarray(0, chunkSize) });
    assert.strictEqual(r.status, 409);
    assert.strictEqual(r.json.received, chunkSize, 'a resent chunk says where the file stands');
    r = await request(port, 'GET', `/api/activesync/transfer/${id}/data`, { session: PHONE });
    assert.strictEqual(r.status, 404, 'nothing to pull before the commit');
    r = await request(port, 'POST', `/api/activesync/upload/${id}/chunk?offset=${chunkSize}`, { session: ADMIN, body: UP.subarray(chunkSize) });
    assert.strictEqual(r.json.received, UP.length);
    r = await request(port, 'POST', `/api/activesync/upload/${id}/commit`, { session: ADMIN, json: {} });
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.strictEqual(r.json.entry.name, 'no tes?.txt', 'path separators never reach the phone in a name');
    assert.ok(phone.received.data.equals(UP));
    assert.strictEqual(phone.received.args.dir, '/Download');
    assert.strictEqual(phone.received.args.conflict, 'rename');
    assert.strictEqual(fs.readdirSync(path.join(tmpDir, 'activesync-transfers')).length, 0, 'delivered: nothing kept');

    // the data is the device's only
    r = await request(port, 'POST', `/api/activesync/upload/${DEV}/begin`, { session: ADMIN, json: { root: 'primary', dir: '/', name: 'q.bin', size: 5 } });
    const id2 = r.json.id;
    await request(port, 'POST', `/api/activesync/upload/${id2}/chunk?offset=0`, { session: ADMIN, body: Buffer.from('hello') });
    // offline partner + queue: kept, delivered after the next hello, then removed
    server.clients.delete(phone.ws);
    as.onSocketClosed(gr, server, phone.info);
    r = await request(port, 'POST', `/api/activesync/upload/${id2}/commit`, { session: ADMIN, json: { queue: true } });
    assert.strictEqual(r.json.queued, true);
    assert.strictEqual(fs.readdirSync(path.join(tmpDir, 'activesync-transfers')).length, 2);
    r = await request(port, 'GET', `/api/activesync/transfer/${id2}/data`, { session: ADMIN });
    assert.strictEqual(r.status, 403, 'only the device pulls');
    const phone2 = connect('phone-session');
    phone2.ws.onMessage = phone.ws.onMessage;
    const replyTo = phone2.info;
    // the handler above answers through phone.info: point it at the new socket
    phone.info = replyTo;
    as.hello(gr, server, phone2.info, { kind: 'device', id: DEV, name: 'Phone', ops: ['partnership.*', 'stream.*', 'storage.*'] });
    assert.strictEqual(await as.deliverQueue(gr, server, DEV), 1);
    assert.strictEqual(phone.received.data.toString(), 'hello');
    assert.strictEqual(fs.readdirSync(path.join(tmpDir, 'activesync-transfers')).length, 0);

    // without queue an offline device refuses, and the copy is dropped
    server.clients.delete(phone2.ws);
    as.onSocketClosed(gr, server, phone2.info);
    r = await request(port, 'POST', `/api/activesync/upload/${DEV}/begin`, { session: ADMIN, json: { root: 'primary', dir: '/', name: 'z.bin', size: 0 } });
    r = await request(port, 'POST', `/api/activesync/upload/${r.json.id}/commit`, { session: ADMIN, json: {} });
    assert.strictEqual(r.status, 503);
    assert.strictEqual(fs.readdirSync(path.join(tmpDir, 'activesync-transfers')).length, 0);

    // a queued file goes when its partnership ends
    r = await request(port, 'POST', `/api/activesync/upload/${DEV}/begin`, { session: ADMIN, json: { root: 'primary', dir: '/', name: 'w.bin', size: 0 } });
    await request(port, 'POST', `/api/activesync/upload/${r.json.id}/commit`, { session: ADMIN, json: { queue: true } });
    assert.strictEqual(fs.readdirSync(path.join(tmpDir, 'activesync-transfers')).length, 2);
    await as.partnership(gr, server, pc.info, { action: 'end', deviceId: DEV });
    assert.strictEqual(fs.readdirSync(path.join(tmpDir, 'activesync-transfers')).length, 0);

    listener.close();
    clearInterval(keepAlive);
    as.resetForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('activesync transfers: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
