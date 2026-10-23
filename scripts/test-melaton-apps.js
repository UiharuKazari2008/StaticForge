#!/usr/bin/env node
// Melaton apps (Yozora #638): .msaz v2 manifests, run-from-VFS trees, opens[], the sandboxed runner
// (session ends with its instance, service outlives it, crash / hang end the instance), the
// /melaton-apps file route, and SoraTan as the first system package. Does not start the server.
// Run: node scripts/test-melaton-apps.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const AdmZip = require('adm-zip');
const { MelatonPackageStore, validateManifest, MelatonPackageError } = require('../modules/melatonPackageStore');
const { MelatonAppRunner } = require('../modules/melatonApps/runner');
const { createMelatonAppStatic } = require('../modules/melatonApps/static');

const ROOT = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'melaton-apps-test-'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function zip(files) {
    const z = new AdmZip();
    for (const [name, body] of Object.entries(files)) z.addFile(name, Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
    return z.toBuffer();
}

const ECHO_SERVER = `
const fs = require('fs');
module.exports = (app) => {
  let n = 0;
  app.onMessage(async (data, i) => {
    if (data.op === 'probe') {
      const out = {};
      const tryIt = (k, fn) => { try { fn(); out[k] = 'allowed'; } catch (e) { out[k] = e.code || e.message; } };
      tryIt('readEtc', () => fs.readFileSync('/etc/hostname'));
      tryIt('writePkg', () => fs.writeFileSync(__dirname + '/x', '1'));
      tryIt('writeData', () => fs.writeFileSync(app.dataDir + '/n', '1'));
      tryIt('http', () => require('http'));
      tryIt('net', () => require('node:net'));
      tryIt('child', () => require('child_process'));
      tryIt('killParent', () => process.kill(process.ppid, 0));
      out.fetch = typeof fetch;
      out.env = Object.keys(process.env).sort();
      try { out.file = (await app.call('readLaunchFile', 'data.txt')).toString(); } catch (e) { out.file = e.code; }
      try { await app.call('readLaunchFile', '../x'); out.escape = 'allowed'; } catch (e) { out.escape = e.code; }
      app.send(out, i);
    } else if (data.op === 'crash') {
      setTimeout(() => { throw new Error('boom'); });
    } else if (data.op === 'hang') {
      setTimeout(() => { for (;;) {} });
    } else {
      app.send({ count: ++n }, i);
    }
  });
};`;

const manifest = (over) => Object.assign({
    id: 'echo', version: '1.0.0', title: 'Echo', format: 'msaz', type: 'native',
    client: { entry: 'client/main.js' },
    server: { entry: 'server/main.js', runner: 'session' }
}, over || {});

(async () => {
    // ---- manifest v2
    const m = validateManifest(manifest({ opens: [{ name: 'Echo.exe', size: 12 }], icon: 'icon.png', publisher: 'Test' }));
    assert.strictEqual(m.launchId, 'echo', '.msaz launchId defaults to its id');
    assert.deepStrictEqual(m.server, { entry: 'server/main.js', runner: 'session' });
    assert.deepStrictEqual(m.opens, [{ name: 'Echo.exe', size: 12 }]);
    const bad = (over, code) => assert.throws(() => validateManifest(manifest(over)), (e) => e instanceof MelatonPackageError && e.code === code, code);
    bad({ server: { entry: 'server/main.js', runner: 'daemon' } }, 'PACKAGE_RUNNER');
    bad({ server: { entry: 'server/main.js', packets: ['pkg.echo.x'] } }, 'PACKAGE_PACKETS');
    bad({ server: { runner: 'session' } }, 'PACKAGE_SERVER');
    bad({ server: { entry: 'server/main.js', memoryMB: 4096 } }, 'PACKAGE_MEMORY');
    bad({ opens: [{ name: 'a/b.exe', size: 1 }] }, 'PACKAGE_OPENS');
    bad({ icon: 'icon.svg' }, 'PACKAGE_ICON');
    bad({ server: { entry: '../main.js' } }, 'PACKAGE_PATH');
    // a v1 .mapz keeps its packets contract; a .mapz may name a runner instead
    assert.deepStrictEqual(validateManifest(manifest({ format: 'mapz', launchId: 'echo', server: { entry: 's.js', packets: ['pkg.echo.ping'] } })).server, { entry: 's.js', packets: ['pkg.echo.ping'] });
    assert.deepStrictEqual(validateManifest(manifest({ format: 'mapz', launchId: 'echo', server: { entry: 's.js', runner: 'service' } })).server, { entry: 's.js', runner: 'service' });

    // ---- run from the VFS: content-addressed tree
    const store = new MelatonPackageStore({ rootDir: path.join(tmp, 'packages') });
    const pkgBytes = zip({ 'manifest.json': manifest(), 'client/main.js': '// client', 'server/main.js': ECHO_SERVER });
    const run1 = store.prepareRun(pkgBytes);
    const run2 = store.prepareRun(pkgBytes);
    assert.strictEqual(run1.sha, run2.sha);
    assert.ok(fs.existsSync(path.join(run1.dir, 'server/main.js')) && run1.base === `packages/.run/${run1.sha}`);
    assert.throws(() => store.prepareRun(zip({ 'manifest.json': manifest(), 'client/main.js': '' })), (e) => e.code === 'PACKAGE_FILE', 'missing server.entry');
    assert.throws(() => store.prepareRun(zip({ 'manifest.json': manifest({ format: 'mapz', launchId: 'echo' }), 'client/main.js': '', 'server/main.js': '' })), (e) => e.code === 'PACKAGE_FORMAT_MISMATCH');
    assert.strictEqual(store.sweepRuns([run1.sha], 0), 0, 'a run in use stays');
    assert.strictEqual(store.sweepRuns([], 0), 1, 'an unused run goes');

    // ---- system package from the repo + opens[]
    const sora = store.installFromDirectory(path.join(ROOT, 'apps/soratan'), { system: true });
    assert.strictEqual(sora.system, true);
    assert.strictEqual(store.installFromDirectory(path.join(ROOT, 'apps/soratan'), { system: true }).updatedAt, sora.updatedAt, 'unchanged tree is not copied again');
    assert.strictEqual(store.findOpener('soratan.EXE', 999424).id, 'soratan');
    assert.strictEqual(store.findOpener('SoraTan.exe', 1000), null, 'another build is not opened');
    store.setEnabled('soratan', false);
    assert.strictEqual(store.findOpener('SoraTan.exe', 999424), null, 'a disabled package opens nothing');
    store.setEnabled('soratan', true);

    // ---- file route: client side only (a real Express app: sendFile has its own dotfile rules)
    const express = require('express');
    const web = express();
    web.use('/melaton-apps', createMelatonAppStatic({ packagesRoot: path.join(tmp, 'packages') }));
    web.use((err, req, res, next) => res.status(500).send(String(err && err.message))); // eslint-disable-line no-unused-vars
    const srv = await new Promise((resolve) => { const x = web.listen(0, '127.0.0.1', () => resolve(x)); });
    const get = async (p) => {
        const r = await fetch(`http://127.0.0.1:${srv.address().port}/melaton-apps${p}`);
        return { code: r.status, cache: r.headers.get('cache-control'), type: r.headers.get('content-type') };
    };
    assert.strictEqual((await get('/soratan/client/soratan.js')).code, 200, 'client entry served (the tree lives under .cache/)');
    assert.match(String((await get('/soratan/assets/soratan-16.png')).type), /image\/png/);
    assert.strictEqual((await get('/soratan/server/main.js')).code, 404, 'server half is never served');
    assert.strictEqual((await get('/soratan/manifest.json')).code, 404);
    assert.strictEqual((await get('/soratan/..%2Findex.json')).code, 404);
    assert.strictEqual((await get('/.run/x')).code, 404);
    store.prepareRun(pkgBytes);
    const runGet = await get(`/${run1.sha}/client/main.js`);
    assert.strictEqual(runGet.code, 200, 'a run tree (under .run/) is served');
    assert.match(String(runGet.cache), /immutable/);
    assert.strictEqual((await get(`/${run1.sha}/server/main.js`)).code, 404);
    srv.close();

    // ---- runner: sandbox, lifetimes, faults
    const runner = new MelatonAppRunner({ dataRoot: store.dataRoot, log: () => {} });
    const pushes = [];
    const deliver = (msg) => pushes.push(msg);
    const launch = { file: { name: 'Echo.exe' }, folder: 'f', list: async () => [{ name: 'data.txt', size: 4 }], readFile: async (n) => (n === 'data.txt' ? Buffer.from('data') : null) };
    const pkg = (runnerKind) => ({ id: 'echo', dir: store.prepareRun(zip({ 'manifest.json': manifest({ server: { entry: 'server/main.js', runner: runnerKind } }), 'client/main.js': '', 'server/main.js': ECHO_SERVER })).dir, manifest: manifest({ server: { entry: 'server/main.js', runner: runnerKind } }) });
    const nextPush = async (pred, ms = 4000) => {
        const t0 = Date.now();
        for (;;) {
            const hit = pushes.find(pred);
            if (hit) { pushes.splice(pushes.indexOf(hit), 1); return hit; }
            if (Date.now() - t0 > ms) throw new Error('no push');
            await wait(20);
        }
    };

    const a = runner.launch({ pkg: pkg('session'), owner: { key: 'tab1' }, launch, deliver });
    runner.message(a.instanceId, { op: 'probe' }, 'tab1');
    const probe = (await nextPush((p) => p.type === 'app_message' && p.data.data.readEtc)).data.data;
    assert.strictEqual(probe.readEtc, 'ERR_ACCESS_DENIED');
    assert.strictEqual(probe.writePkg, 'ERR_ACCESS_DENIED');
    assert.strictEqual(probe.writeData, 'allowed');
    for (const k of ['http', 'net', 'child', 'killParent']) assert.strictEqual(probe[k], 'ERR_MELATON_APP_BLOCKED', k);
    assert.strictEqual(probe.fetch, 'undefined');
    assert.deepStrictEqual(probe.env, ['LANG', 'NODE_ENV', 'TZ'], 'no server secrets in the env');
    assert.strictEqual(probe.file, 'data', 'readLaunchFile reads the launch folder');
    assert.strictEqual(probe.escape, 'APP_CALL_ARGS', 'no path out of the launch folder');
    assert.throws(() => runner.message(a.instanceId, {}, 'tab2'), (e) => e.code === 'APP_NOT_OWNER', 'another tab cannot talk to it');
    const pid = runner.list().processes[0].pid;
    runner.terminate(a.instanceId, 'tab1');
    await wait(600);
    assert.strictEqual(runner.list().processes.length, 0, 'a session runner ends with its window');
    assert.throws(() => process.kill(pid, 0), 'its process is gone');

    const b = runner.launch({ pkg: pkg('session'), owner: { key: 'tab1' }, launch, deliver });
    runner.message(b.instanceId, { op: 'count' }, 'tab1');
    await nextPush((p) => p.type === 'app_message' && p.data.instanceId === b.instanceId);
    assert.strictEqual(runner.ownerGone('tab1'), 1);
    await wait(600);
    assert.strictEqual(runner.list().processes.length, 0, 'a session runner ends with its tab');

    const s1 = runner.launch({ pkg: pkg('service'), owner: { key: 'tab1' }, launch, deliver });
    runner.message(s1.instanceId, { op: 'count' }, 'tab1');
    assert.strictEqual((await nextPush((p) => p.data.instanceId === s1.instanceId && p.data.data.count)).data.data.count, 1);
    runner.terminate(s1.instanceId, 'tab1');
    await wait(300);
    assert.strictEqual(runner.list().processes.length, 1, 'a service outlives its window');
    const s2 = runner.launch({ pkg: pkg('service'), owner: { key: 'tab2' }, launch, deliver });
    runner.message(s2.instanceId, { op: 'count' }, 'tab2');
    assert.strictEqual((await nextPush((p) => p.data.instanceId === s2.instanceId && p.data.data.count)).data.data.count, 2, 'the same service process serves the next launch');
    runner.message(s2.instanceId, { op: 'crash' }, 'tab2');
    const crashed = await nextPush((p) => p.type === 'app_exited' && p.data.instanceId === s2.instanceId);
    assert.strictEqual(crashed.data.fault, true);
    assert.strictEqual(runner.list().instances.length, 0);

    const s3 = runner.launch({ pkg: pkg('service'), owner: { key: 'tab3' }, launch, deliver });
    await wait(400);
    runner.stopService('echo');
    const stopped = await nextPush((p) => p.type === 'app_exited' && p.data.instanceId === s3.instanceId);
    assert.strictEqual(stopped.data.fault, false, 'a stopped service is not a fault');

    // ---- SoraTan's server half decodes the .sora next to the exe
    const soraFile = path.join(os.homedir(), '.cache/gadget-review/src/soratan/nanami.sora');
    if (fs.existsSync(soraFile)) {
        const row = store.get('soratan');
        const t = runner.launch({
            pkg: { id: 'soratan', dir: path.join(store.rootDir, 'soratan'), manifest: row.manifest },
            owner: { key: 'tab4' },
            launch: { file: { name: 'SoraTan.exe' }, folder: 'iso', list: async () => [{ name: 'SoraTan.exe' }, { name: 'nanami.sora' }], readFile: async (n) => (n === 'nanami.sora' ? fs.readFileSync(soraFile) : null) },
            deliver
        });
        runner.message(t.instanceId, { op: 'load' }, 'tab4');
        const scene = (await nextPush((p) => p.data && p.data.instanceId === t.instanceId, 15000)).data.data;
        assert.strictEqual(scene.op, 'scene');
        assert.deepStrictEqual(scene.scene.meshes.map((x) => x.frames.length), [11, 79, 199]);
        assert.ok(Buffer.from(scene.texture, 'base64').slice(1, 4).toString() === 'PNG');
        runner.terminate(t.instanceId, 'tab4');
        const none = runner.launch({
            pkg: { id: 'soratan', dir: path.join(store.rootDir, 'soratan'), manifest: row.manifest },
            owner: { key: 'tab4' }, launch: { list: async () => [], readFile: async () => null }, deliver
        });
        runner.message(none.instanceId, { op: 'load' }, 'tab4');
        assert.strictEqual((await nextPush((p) => p.data && p.data.instanceId === none.instanceId, 8000)).data.data.text, ' Load Sora file fail!');
        runner.terminate(none.instanceId, 'tab4');
    } else {
        console.log('(nanami.sora not on this machine: SoraTan decode skipped)');
    }

    // a hung server half is ended by the watchdog (shortened here)
    const { LIMITS } = require('../modules/melatonApps/runner');
    Object.assign(LIMITS, { pingEveryMs: 200, pingTimeoutMs: 800 });
    const h = runner.launch({ pkg: pkg('session'), owner: { key: 'tab5' }, launch, deliver });
    await wait(300);
    runner.message(h.instanceId, { op: 'hang' }, 'tab5');
    const hung = await nextPush((p) => p.type === 'app_exited' && p.data.instanceId === h.instanceId, 8000);
    assert.strictEqual(hung.data.reason, 'not-responding');
    assert.strictEqual(hung.data.fault, true);

    // ---- WS payloads: app_message keeps its own data
    const { payloadOf } = require('../modules/ws/handlers/245-melatonAppsHandler');
    assert.deepStrictEqual(payloadOf({ type: 'app_message', instanceId: 'app_x', data: { op: 'load' } }), { type: 'app_message', instanceId: 'app_x', data: { op: 'load' } });
    assert.deepStrictEqual(payloadOf({ type: 'app_launch', data: { fileId: 'f1' } }), { fileId: 'f1' }, 'a wrapped payload still works');
    assert.strictEqual(payloadOf({ type: 'app_launch', fileId: 'f1' }).fileId, 'f1');

    // ---- wiring
    const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
    assert.ok(read('modules/websocket.js').includes("require('./ws/handlers/245-melatonAppsHandler').onClientClosed(ws);"), 'a closed tab ends its apps');
    assert.ok(read('web_server.js').includes("app.use('/melaton-apps', authMiddleware,"), 'file route behind auth');
    assert.ok(read('public/sw.js').includes("url.pathname.startsWith('/melaton-apps/')"), 'the service worker passes app files through');
    assert.ok(read('public/scripts/comp/featureLoader.js').includes("'scripts/comp/melatonApps.js', 'scripts/comp/vfsPrograms.js'"), 'client runtime loads with Explorer');
    for (const f of ['modules/melatonApps/runner.js', 'modules/melatonApps/sandboxPreload.js', 'modules/melatonApps/sandboxBootstrap.js', 'modules/melatonApps/static.js', 'modules/ws/handlers/245-melatonAppsHandler.js', 'public/scripts/comp/melatonApps.js', 'public/scripts/comp/vfsPrograms.js', 'apps/soratan/client/soratan.js', 'apps/soratan/server/main.js']) {
        assert.ok(!/[–—‘’“”…×− ]/.test(read(f)), `${f}: keyboard characters only`);
    }

    runner.shutdown();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('test-melaton-apps: ok');
    process.exit(0);
})().catch((err) => {
    console.error(err);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(1);
});
