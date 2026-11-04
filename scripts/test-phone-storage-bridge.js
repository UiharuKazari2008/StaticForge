#!/usr/bin/env node
// public/scripts/comp/phoneStorageBridge.js against a fake window.AndroidPhoneStorage (Yozora #698):
// call/reply ids, errors, file URLs, config events, and the chunked writer (binary framing, at most 4
// chunks unacknowledged, byte-identical result, base64 fallback, writeAbort on cancel).
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/phoneStorageBridge.js'), 'utf8');

function makeBridge(opts = {}) {
    const files = new Map();
    const log = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const ups = new Map();
    let nextUpload = 7;
    const bridge = {
        onmessage: null,
        postMessage(msg) {
            const reply = (m) => setTimeout(() => bridge.onmessage({ data: JSON.stringify(m) }), 1);
            if (msg instanceof ArrayBuffer) {
                const view = new DataView(msg);
                const upload = view.getInt32(0, false);
                const seq = view.getInt32(4, false);
                const up = ups.get(upload);
                assert.ok(up, 'chunk for a known upload');
                assert.strictEqual(seq, up.next, 'chunks arrive in order');
                up.next += 1;
                up.parts.push(Buffer.from(msg.slice(8)));
                inFlight += 1;
                maxInFlight = Math.max(maxInFlight, inFlight);
                setTimeout(() => {
                    inFlight -= 1;
                    up.written += msg.byteLength - 8;
                    bridge.onmessage({ data: JSON.stringify({ event: 'chunk', upload, seq, ok: true, written: up.written }) });
                }, 3);
                return;
            }
            const { id, op, args } = JSON.parse(msg);
            log.push(op);
            if (op === 'hello') return reply({ id, ok: true, result: { version: 1, enabled: true, access: true, locked: false, roots: [{ id: 'internal', name: 'Internal storage', kind: 'internal' }], baseUrl: 'https://appassets.androidplatform.net/phone-storage/tok123', features: { binaryWrite: opts.binary !== false, chunkSize: 64 * 1024 } } });
            if (op === 'list' && args.path === '/missing') return reply({ id, ok: false, error: { code: 'not_found', message: 'No such folder' } });
            if (op === 'writeBegin') {
                const upload = nextUpload++;
                ups.set(upload, { next: 0, parts: [], written: 0, args });
                return reply({ id, ok: true, result: { upload, name: args.name, chunkSize: 64 * 1024 } });
            }
            if (op === 'writeChunk') {
                const up = ups.get(args.upload);
                assert.strictEqual(args.seq, up.next);
                up.next += 1;
                const bytes = Buffer.from(args.data, 'base64');
                up.parts.push(bytes);
                up.written += bytes.length;
                return reply({ id, ok: true, result: { written: up.written } });
            }
            if (op === 'writeEnd') {
                const up = ups.get(args.upload);
                const data = Buffer.concat(up.parts);
                files.set(`${up.args.root}:${up.args.dir}/${up.args.name}`, data);
                return reply({ id, ok: true, result: { name: up.args.name, size: data.length, mtime: up.args.mtime } });
            }
            if (op === 'writeAbort') { ups.delete(args.upload); return reply({ id, ok: true, result: null }); }
            return reply({ id, ok: true, result: { op, args } });
        }
    };
    return { bridge, files, log, stats: () => ({ maxInFlight }) };
}

function load(bridge) {
    const win = { AndroidPhoneStorage: bridge };
    const mod = { exports: {} };
    new Function('window', 'globalThis', 'module', 'console', 'btoa', 'setTimeout', SRC)(win, win, mod, console, (s) => Buffer.from(s, 'binary').toString('base64'), setTimeout);
    return win.phoneStorage;
}

class FakeBlob {
    constructor(buf, name) { this.buf = buf; this.size = buf.length; this.name = name; this.lastModified = 1700000000000; }
    slice(a, b) { const part = this.buf.subarray(a, b); return { arrayBuffer: async () => part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength) }; }
}

(async () => {
    // no bridge: unavailable, calls reject with 'disabled'
    const none = load(null);
    assert.strictEqual(none.available, false);
    await assert.rejects(none.call('hello'), (e) => e.code === 'disabled');

    const fake = makeBridge();
    const ps = load(fake.bridge);
    assert.strictEqual(ps.available, true);
    const st = await ps.hello();
    assert.strictEqual(st.roots[0].id, 'internal');
    await ps.hello();
    assert.strictEqual(fake.log.filter((o) => o === 'hello').length, 1, 'hello is cached');

    assert.strictEqual(ps.fileUrl('internal', '/DCIM/Camera/a b#1.jpg'), 'https://appassets.androidplatform.net/phone-storage/tok123/internal/DCIM/Camera/a%20b%231.jpg');
    assert.strictEqual(ps.fileUrl('internal', '/x.mp4', { thumb: 2000 }), 'https://appassets.androidplatform.net/phone-storage/tok123/internal/x.mp4?thumb=1024');
    assert.strictEqual(ps.fileUrl('internal', '/x.pdf', { download: true }).endsWith('x.pdf?download=1'), true);
    assert.strictEqual(ps.joinPath('/', 'a'), '/a');
    assert.strictEqual(ps.joinPath('/DCIM/', 'a'), '/DCIM/a');
    assert.strictEqual(ps.parentPath('/DCIM/Camera'), '/DCIM');
    assert.strictEqual(ps.parentPath('/DCIM'), '/');

    await assert.rejects(ps.call('list', { root: 'internal', path: '/missing' }), (e) => e.code === 'not_found' && e.message === 'No such folder');

    // config event: hello again, then 'config' listeners
    let configs = 0;
    ps.on('config', () => { configs += 1; });
    fake.bridge.onmessage({ data: JSON.stringify({ event: 'config' }) });
    await new Promise((r) => setTimeout(r, 20));
    assert.strictEqual(configs, 1);
    assert.strictEqual(fake.log.filter((o) => o === 'hello').length, 2, 'config re-reads hello');

    // changed events pass through
    let changed = null;
    ps.on('changed', (m) => { changed = m; });
    fake.bridge.onmessage({ data: JSON.stringify({ event: 'changed', root: 'internal', path: '/DCIM' }) });
    assert.deepStrictEqual(changed && [changed.root, changed.path], ['internal', '/DCIM']);

    // binary write: 1 MB + odd tail, byte-identical, ≤4 in flight, progress reaches the total
    const data = crypto.randomBytes(1024 * 1024 + 12345);
    let last = 0;
    const entry = await ps.write('internal', '/Download', new FakeBlob(data, 'big.bin'), { onProgress: (n) => { last = n; } });
    assert.strictEqual(entry.size, data.length);
    assert.ok(fake.files.get('internal:/Download/big.bin').equals(data), 'byte-identical');
    assert.ok(fake.stats().maxInFlight <= 4 && fake.stats().maxInFlight >= 2, `in flight ${fake.stats().maxInFlight}`);
    assert.strictEqual(last, data.length);

    // cancel: writeAbort, rejects 'aborted'
    const ctl = new AbortController();
    const p = ps.write('internal', '/Download', new FakeBlob(crypto.randomBytes(2 * 1024 * 1024), 'c.bin'), { signal: ctl.signal });
    setTimeout(() => ctl.abort(), 15);
    await assert.rejects(p, (e) => e.code === 'aborted');
    await new Promise((r) => setTimeout(r, 10));
    assert.ok(fake.log.includes('writeAbort'), 'cancel aborts the upload');

    // base64 fallback (binaryWrite false)
    const fake2 = makeBridge({ binary: false });
    const ps2 = load(fake2.bridge);
    const small = crypto.randomBytes(200 * 1024 + 7);
    await ps2.write('internal', '/', new FakeBlob(small, 's.bin'));
    assert.ok([...fake2.files.values()].some((buf) => buf.equals(small)), 'base64 chunks write the same bytes');
    assert.ok(fake2.log.includes('writeChunk'), 'writeChunk used when binaryWrite is false');
    console.log('test-phone-storage-bridge: ok');
})().catch((err) => { console.error(err); process.exit(1); });
