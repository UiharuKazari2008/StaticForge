#!/usr/bin/env node
// Melaton app EXE container (Yozora #640): a package appended to a Windows stub reads back as the
// package, the store runs it, the .ico builds, and a normal exe is left alone. The real stub is
// compiled on the VM (apps/_stub); this test uses a PE-header fixture, so it needs no Windows.
// Run: node scripts/test-melaton-exe.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { wrapPackageExe, packageZipFromExe, exeOverlayOffset, isMelatonExe, readExeHead } = require('../modules/melatonApps/exeContainer');
const { buildIco } = require('../modules/melatonApps/ico');
const { packageBytesOf, MelatonPackageStore, validateManifest } = require('../modules/melatonPackageStore');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'melaton-exe-test-'));

/** A structurally-valid PE header (no code): a stub stand-in for the container parser. */
function fakeStub(len) {
    const b = Buffer.alloc(len);
    b.writeUInt16LE(0x5a4d, 0);
    const peAt = 0x80; b.writeUInt32LE(peAt, 0x3c);
    b.writeUInt32LE(0x00004550, peAt);
    b.writeUInt16LE(0x14c, peAt + 4);
    b.writeUInt16LE(1, peAt + 6);
    b.writeUInt16LE(0xe0, peAt + 20);
    const sectionsAt = peAt + 24 + 0xe0;
    b.write('.text\0\0\0', sectionsAt, 'binary');
    b.writeUInt32LE(len - 0x200, sectionsAt + 16);
    b.writeUInt32LE(0x200, sectionsAt + 20);
    return b;
}

function pkgZip(manifest, extra) {
    const zip = new AdmZip();
    zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest)));
    zip.addFile('client/main.js', Buffer.from("melatonApps.define('demo', () => {});"));
    if (manifest.icon) zip.addFile(manifest.icon, Buffer.from((extra && extra.icon) || 'PNG-bytes'));
    if (manifest.server) zip.addFile('server/main.js', Buffer.from('module.exports = () => {};'));
    return zip.toBuffer();
}

(async () => {
    const manifest = { id: 'demo', version: '1.0.0', title: 'Demo', format: 'msaz', type: 'native', icon: 'assets/icon.png', client: { entry: 'client/main.js' }, server: { entry: 'server/main.js', runner: 'session' } };
    const zip = pkgZip(manifest);
    const stub = fakeStub(4096);
    assert.strictEqual(exeOverlayOffset(stub), stub.length, 'a bare stub has no overlay');

    // wrap + read back
    const exe = wrapPackageExe(stub, zip);
    assert.strictEqual(exeOverlayOffset(exe), stub.length, 'the overlay starts where the PE ends');
    assert.ok(isMelatonExe(exe), 'recognised as a Melaton app');
    const sliced = packageZipFromExe(exe);
    assert.deepStrictEqual(new AdmZip(sliced).getEntries().map((e) => e.entryName).sort(), ['assets/icon.png', 'client/main.js', 'manifest.json', 'server/main.js']);
    assert.strictEqual(new AdmZip(sliced).readAsText('manifest.json'), JSON.stringify(manifest));

    // packageBytesOf: an exe yields its package, a plain zip is itself
    assert.ok(packageBytesOf(exe).equals(sliced));
    assert.ok(packageBytesOf(zip).equals(zip));

    // a normal Windows exe (no package overlay) is not a Melaton app
    assert.strictEqual(isMelatonExe(stub), false);
    assert.strictEqual(packageZipFromExe(stub), null);
    assert.strictEqual(isMelatonExe(Buffer.from('MZ not really a pe')), false);

    // readExeHead from disk, without reading the whole file
    const exePath = path.join(tmp, 'demo.exe');
    fs.writeFileSync(exePath, exe);
    assert.deepStrictEqual(await readExeHead(exePath), { overlay: stub.length });

    // a real stub is larger than the 64 KiB head: readExeHead must still find the overlay from the
    // section table (the overlay offset lies far past what it reads)
    const bigStub = fakeStub(200 * 1024);
    const bigExe = wrapPackageExe(bigStub, zip);
    const bigPath = path.join(tmp, 'big.exe');
    fs.writeFileSync(bigPath, bigExe);
    assert.deepStrictEqual(await readExeHead(bigPath), { overlay: bigStub.length }, 'overlay found beyond the file head');
    assert.ok(isMelatonExe(bigExe));

    // the store runs a Melaton exe (prepareRun slices it)
    const store = new MelatonPackageStore({ rootDir: path.join(tmp, 'packages') });
    const run = store.prepareRun(exe);
    assert.strictEqual(run.manifest.id, 'demo');
    assert.ok(fs.existsSync(path.join(run.dir, 'client/main.js')) && fs.existsSync(path.join(run.dir, 'manifest.json')));
    // same package, whether given as the exe or the bare zip -> same run tree
    assert.strictEqual(store.prepareRun(zip).sha, run.sha);

    // installFromBuffer also accepts an exe
    const installed = store.installFromBuffer(wrapPackageExe(fakeStub(2048), pkgZip(Object.assign({}, manifest, { id: 'demo2', launchId: 'demo2' }))));
    assert.strictEqual(installed.id, 'demo2');

    // .ico: 16/32/48 DIB + 256 PNG
    const rgba = (n) => Buffer.alloc(n * n * 4, 0xff);
    const ico = buildIco([{ size: 16, rgba: rgba(16) }, { size: 32, rgba: rgba(32) }, { size: 48, rgba: rgba(48) }, { size: 256, png: Buffer.from('\x89PNG\r\n\x1a\n256-png', 'latin1') }]);
    assert.strictEqual(ico.readUInt16LE(0), 0);
    assert.strictEqual(ico.readUInt16LE(2), 1, 'type: icon');
    assert.strictEqual(ico.readUInt16LE(4), 4, 'four images');
    assert.strictEqual(ico.readUInt8(6), 16, 'first entry is 16 px');
    assert.strictEqual(ico.readUInt8(6 + 3 * 16), 0, '256 px entry width stored as 0');
    const png256At = ico.readUInt32LE(6 + 3 * 16 + 12);
    assert.strictEqual(ico.subarray(png256At, png256At + 4).toString('latin1'), '\x89PNG', '256 px entry is PNG');

    // keyboard characters
    for (const f of ['modules/melatonApps/exeContainer.js', 'modules/melatonApps/ico.js', 'scripts/build-melaton-app.js', 'apps/_stub/MelatonStub.cs.tmpl']) {
        assert.ok(!/[–—‘’“”…×− ]/.test(fs.readFileSync(path.join(__dirname, '..', f), 'utf8')), `${f}: keyboard characters only`);
    }

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('test-melaton-exe: ok');
})().catch((err) => { console.error(err); fs.rmSync(tmp, { recursive: true, force: true }); process.exit(1); });
