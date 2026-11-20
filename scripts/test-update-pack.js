#!/usr/bin/env node
// Update packs (#951, modules/updatePack.js): one zip for any subset of the manifest. Entries a built pack holds at the
// manifest hash are copied out of it raw; the rest are read and compressed now; pack.json names every entry's body
// hash and what is missing and why. fflate (the client's unzip) must read the result.
// Run: node scripts/test-update-pack.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { unzipSync, strFromU8 } = require('fflate');
const meletonInstallPack = require('../modules/meletonInstallPack');
const updatePack = require('../modules/updatePack');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

class FakeRes extends EventEmitter {
    constructor() { super(); this.chunks = []; this.ended = false; }
    write(buf) { this.chunks.push(Buffer.from(buf)); return true; }
    end() { this.ended = true; }
    body() { return Buffer.concat(this.chunks); }
}

(async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-pack-test-'));
    const packDir = path.join(dir, 'packs');
    const files = {};
    const write = (name, bytes) => { const p = path.join(dir, name); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, bytes); files[name] = p; return bytes; };
    const a = write('scripts/a.js', Buffer.from('console.log("a");\n'.repeat(400)));
    const b = write('css/b.css', Buffer.from('body{color:red}\n'.repeat(300)));
    const png = write('static_images/c.png', crypto.randomBytes(5000));
    const big = write('static_images/d.webp', crypto.randomBytes(70000));
    const manifest = [
        { url: '/scripts/a.js', hash: sha(a), size: a.length },
        { url: '/css/b.css', hash: sha(b), size: b.length },
        { url: '/static_images/c.png', hash: sha(png), size: png.length },
        { url: '/static_images/d.webp', hash: sha(big), size: big.length },
        { url: '/protected/secret.js', hash: 'x'.repeat(64), size: 3, auth: true }
    ];
    const resolveFile = (row) => {
        const p = files[row.url.replace(/^\//, '')];
        return p && fs.existsSync(p) ? p : null;
    };
    meletonInstallPack.init({ outputDir: packDir });
    await meletonInstallPack.rebuild({ outputDir: packDir, manifest, resolveFile });

    // b.css changes after the pack was built: its new bytes are not in the pack, so it is compressed now
    const b2 = write('css/b.css', Buffer.from('body{color:blue}\n'.repeat(300)));
    const now = manifest.map((row) => (row.url === '/css/b.css' ? { ...row, hash: sha(b2), size: b2.length } : row));
    now.push({ url: '/scripts/new.js', hash: 'y'.repeat(64), size: 10 }); // in the manifest, no file yet
    const byUrl = new Map(now.map((row) => [row.url, row]));

    const planned = await updatePack.plan({
        manifestByUrl: byUrl,
        requested: [
            { url: '/scripts/a.js' }, { url: '/css/b.css' }, { url: '/static_images/c.png' }, { url: '/static_images/d.webp' },
            { url: '/protected/secret.js' }, { url: '/scripts/new.js' }, { url: '/nope.js' }, { url: '/scripts/a.js' }
        ],
        resolveFile,
        allowAuth: () => false,
        contentType: (url) => (url.endsWith('.js') ? 'application/javascript; charset=UTF-8' : '')
    });
    assert.strictEqual(planned.files, 4, 'four entries');
    assert.strictEqual(planned.copied, 3, 'a.js, c.png and d.webp come out of the built pack as they are');
    assert.strictEqual(planned.packed, 1, 'b.css (changed since the pack) is compressed now');
    const reasons = Object.fromEntries(planned.missing.map((m) => [m.url, m.reason]));
    assert.deepStrictEqual(reasons, { '/protected/secret.js': 'auth', '/scripts/new.js': 'unresolved', '/nope.js': 'not-found' });
    const res = new FakeRes();
    assert.strictEqual(await updatePack.send(res, planned), true);
    const zip = res.body();
    assert.strictEqual(zip.length, planned.total, 'Content-Length is the bytes sent');
    const out = unzipSync(new Uint8Array(zip));
    const listing = JSON.parse(strFromU8(out['pack.json']));
    assert.strictEqual(listing.v, 2);
    assert.strictEqual(listing.hash, meletonInstallPack.hashManifest([byUrl.get('/scripts/a.js'), byUrl.get('/css/b.css'), byUrl.get('/static_images/c.png'), byUrl.get('/static_images/d.webp'), byUrl.get('/protected/secret.js'), byUrl.get('/scripts/new.js')]),
        'X-Pack-Hash covers the manifest rows asked for (updateEngine.copyPack)');
    const expect = { '/scripts/a.js': a, '/css/b.css': b2, '/static_images/c.png': png, '/static_images/d.webp': big };
    for (const row of listing.files) {
        const bytes = Buffer.from(out[row.entry]);
        assert.ok(bytes.equals(expect[row.url]), `${row.url}: the bytes are the file's`);
        assert.strictEqual(row.body, sha(bytes), `${row.url}: body is the hash of the entry's bytes`);
        assert.strictEqual(row.hash, byUrl.get(row.url).hash, `${row.url}: hash is the manifest's`);
        assert.strictEqual(row.size, bytes.length);
    }
    assert.strictEqual(listing.files.find((r) => r.url === '/scripts/a.js').type, 'application/javascript; charset=UTF-8');
    assert.deepStrictEqual(listing.missing.map((m) => m.url).sort(), ['/nope.js', '/protected/secret.js', '/scripts/new.js']);

    // the pack is rebuilt (renamed over) while an answer streams from the old one: the open file is what is read
    const again = await updatePack.plan({ manifestByUrl: byUrl, requested: [{ url: '/static_images/d.webp' }], resolveFile });
    assert.strictEqual(again.copied, 1);
    fs.renameSync(path.join(packDir, 'pack.zip'), path.join(packDir, 'old.zip'));
    fs.writeFileSync(path.join(packDir, 'pack.zip'), 'not a zip');
    const res2 = new FakeRes();
    await updatePack.send(res2, again);
    assert.ok(Buffer.from(unzipSync(new Uint8Array(res2.body()))['static_images/d.webp']).equals(big), 'read from the file it planned with');
    // and a damaged pack on disk is no source: everything is compressed now
    const third = await updatePack.plan({ manifestByUrl: byUrl, requested: [{ url: '/scripts/a.js' }], resolveFile });
    assert.strictEqual(third.copied, 0);
    assert.strictEqual(third.packed, 1);
    await third.close();

    // a client that leaves mid-answer: send stops and closes the pack
    fs.renameSync(path.join(packDir, 'old.zip'), path.join(packDir, 'pack.zip'));
    const fourth = await updatePack.plan({ manifestByUrl: byUrl, requested: [{ url: '/static_images/d.webp' }], resolveFile });
    const res4 = new FakeRes();
    res4.write = function (buf) { this.chunks.push(Buffer.from(buf)); this.emit('close'); return true; };
    assert.strictEqual(await updatePack.send(res4, fourth), false);

    fs.rmSync(dir, { recursive: true, force: true });
    console.log('test-update-pack: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
