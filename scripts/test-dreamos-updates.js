#!/usr/bin/env node
'use strict';
// #910: DreamOS update route - admin uploads content-addressed files, publishes an Ed25519-signed channel manifest
// (refused unless the key is trusted, the signature matches and every named file is stored); devices read the exact
// signed bytes with the signature in headers, and fetch files by sha256.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Readable } = require('stream');
const route = require('../modules/dreamosUpdates');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dreamos-test-'));
route._test.setRoot(dir);

const handlers = {};
const reg = (m) => (p, ...fns) => { handlers[`${m} ${p}`] = fns[fns.length - 1]; };
route.mount({ get: reg('GET'), put: reg('PUT') }, null);

// make a response object and a promise that settles when it answers
function mk() {
    let resolve;
    const p = new Promise((r) => { resolve = r; });
    const r = {
        code: 200, headers: {}, body: null, headersSent: false,
        status(c) { r.code = c; return r; }, set(k, v) { r.headers[k] = v; return r; }, type() { return r; },
        json(b) { r.body = b; r.headersSent = true; resolve(r); return r; },
        send(b) { r.body = b; r.headersSent = true; resolve(r); return r; },
        end() { r.headersSent = true; resolve(r); return r; },
        sendFile(f) { r.body = fs.readFileSync(f); r.headersSent = true; resolve(r); }
    };
    return [r, p];
}
const admin = { userType: 'admin' };

async function put(sha, buf, who = admin) {
    const req = Readable.from([buf]);
    Object.assign(req, who, { params: { sha }, headers: {} });
    const [r, p] = mk();
    handlers['PUT /api/dreamos/object/:sha'](req, r);
    return p;
}
async function publish(channel, body, who = admin) {
    const [r, p] = mk();
    handlers['PUT /api/dreamos/channel/:channel']({ ...who, params: { channel }, headers: {}, body }, r);
    return p;
}
async function get(p, params, headers = {}) {
    const [r, pr] = mk();
    handlers[`GET ${p}`]({ params, headers }, r);
    return pr;
}

(async () => {
    const img = crypto.randomBytes(4096);
    const sha = crypto.createHash('sha256').update(img).digest('hex');

    assert.strictEqual((await put(sha, img, { userType: 'user' })).code, 403, 'admins only');
    assert.strictEqual((await put('0'.repeat(64), img)).code, 400, 'hash must match');
    assert.ok(!fs.readdirSync(path.join(dir, 'objects')).some((f) => f.endsWith('.part')), 'no partial file left');
    const up = await put(sha, img);
    assert.strictEqual(up.code, 200);
    assert.strictEqual(up.body.stored, true);
    assert.strictEqual((await put(sha, img)).body.stored, false, 'already stored');

    const got = await get('/api/dreamos/object/:sha', { sha });
    assert.ok(Buffer.compare(got.body, img) === 0);
    assert.strictEqual((await get('/api/dreamos/object/:sha', { sha: '../trusted-keys.json' })).code, 404);

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(path.join(dir, 'trusted-keys.json'), JSON.stringify({ keys: [{ id: 'ruiko-1', ed25519: publicKey.export({ format: 'jwk' }).x }] }));
    const rel = (v, s = sha) => ({ version: v, api: 1, files: [{ name: 'root.erofs', sha256: s, size: img.length }] });
    const manifest = (released, s) => JSON.stringify({ format: 1, channel: 'dev', released, base: rel('0.1.0', s), components: { cafeready: rel('0.1.0', s) } }, null, 1);
    const sign = (t) => crypto.sign(null, Buffer.from(t), privateKey).toString('base64');

    const m1 = manifest('2026-11-18T10:00:00Z');
    assert.strictEqual((await publish('dev', { manifest: m1, signature: sign(m1), key: 'other' })).body.code, 'UNTRUSTED_KEY');
    assert.strictEqual((await publish('dev', { manifest: m1, signature: sign(m1 + ' '), key: 'ruiko-1' })).body.code, 'BAD_SIGNATURE');
    const mOther = m1.replace('"dev"', '"stable"');
    assert.strictEqual((await publish('dev', { manifest: mOther, signature: sign(mOther), key: 'ruiko-1' })).body.code, 'BAD_MANIFEST');
    const mMissing = manifest('2026-11-18T10:00:00Z', 'a'.repeat(64));
    const miss = await publish('dev', { manifest: mMissing, signature: sign(mMissing), key: 'ruiko-1' });
    assert.strictEqual(miss.code, 409);
    assert.deepStrictEqual(miss.body.missing, ['a'.repeat(64)]);

    let pushed = null;
    route.events.once('channel', (e) => { pushed = e; });
    const ok = await publish('dev', { manifest: m1, signature: sign(m1), key: 'ruiko-1' });
    assert.strictEqual(ok.code, 200, JSON.stringify(ok.body));
    assert.strictEqual(pushed.channel, 'dev', 'publish is pushed to the link');

    const ch = await get('/api/dreamos/channel/:channel', { channel: 'dev' });
    assert.strictEqual(ch.body.toString('utf8'), m1, 'exact signed bytes');
    assert.ok(crypto.verify(null, ch.body, publicKey, Buffer.from(ch.headers['X-DreamOS-Signature'], 'base64')), 'device can verify');
    assert.strictEqual(ch.headers['X-DreamOS-Key'], 'ruiko-1');
    assert.strictEqual((await get('/api/dreamos/channel/:channel', { channel: 'dev' }, { 'if-none-match': ch.headers.ETag })).code, 304);

    const old = manifest('2026-11-01T00:00:00Z');
    assert.strictEqual((await publish('dev', { manifest: old, signature: sign(old), key: 'ruiko-1' })).body.code, 'OLDER_RELEASE');
    assert.strictEqual((await publish('dev', { manifest: old, signature: sign(old), key: 'ruiko-1', allowOlder: true })).code, 200, 'explicit rollback');
    assert.strictEqual((await get('/api/dreamos/channel/:channel', { channel: 'nope' })).code, 404);

    // channel assignments: admin only, a device id and a channel name; the carrier frame names the channel's release
    const dev = 'ab'.repeat(16);
    const assign = async (device, body, who = admin) => {
        const [r, p] = mk();
        handlers['PUT /api/dreamos/assign/:device']({ ...who, params: { device }, headers: {}, body }, r);
        return p;
    };
    const seen = [];
    route.events.on('assign', (e) => seen.push(e));
    assert.strictEqual((await assign(dev, { channel: 'dev' }, { userType: 'user' })).code, 403);
    assert.strictEqual((await assign('xyz', { channel: 'dev' })).code, 400);
    assert.strictEqual((await assign(dev, { channel: '../dev' })).code, 400);
    assert.strictEqual((await route.channelFrame(dev)).channel, null, 'no assignment yet');
    assert.strictEqual((await assign(dev, { channel: 'dev' })).code, 200);
    assert.deepStrictEqual(seen, [{ device: dev, channel: 'dev' }]);
    const f = await route.channelFrame(dev);
    assert.strictEqual(f.type, 'miniport_update_channel');
    assert.strictEqual(f.channel, 'dev');
    assert.strictEqual(f.released, JSON.parse(old).released, 'the channel release as published');
    assert.strictEqual(`"${f.sha256}"`, (await get('/api/dreamos/channel/:channel', { channel: 'dev' })).headers.ETag);
    const list = await (() => { const [r, p] = mk(); handlers['GET /api/dreamos/assign']({ ...admin, params: {}, headers: {} }, r); return p; })();
    assert.deepStrictEqual(list.body.devices, { [dev]: 'dev' });
    assert.strictEqual((await assign(dev, { channel: null })).code, 200);
    assert.strictEqual((await route.channelFrame(dev)).channel, null, 'assignment ended');
    assert.strictEqual(await route.channelFrame('nope'), null);

    fs.rmSync(dir, { recursive: true, force: true });
    console.log('test-dreamos-updates: ok');
})().catch((e) => { console.error(e); process.exit(1); });
