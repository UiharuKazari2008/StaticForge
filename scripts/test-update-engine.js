#!/usr/bin/env node
// Melaton update engine (public/scripts/launch/updateEngine.js, Yozora #419): manifest diff
// against static-cache-v1 (x-file-hash, path normalisation, Vary / ?sha= siblings), the
// installer threshold with remembered stragglers, install state, and the download driver over a
// fake service worker (byte-weighted progress, errors, complete, stall).
// Run: node scripts/test-update-engine.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const engine = require('../public/scripts/launch/updateEngine.js');

const ORIGIN = 'https://example.test';

function fakeCaches(rows) {
    // rows: [{ url, hash }] stored as Request-like keys
    const cache = {
        async match(key) {
            const url = typeof key === 'string' ? new URL(key, ORIGIN).href : key.url;
            const row = rows.find((r) => new URL(r.url, ORIGIN).href === url);
            return row ? { url: row.url, headers: { get: (h) => (h === 'x-file-hash' ? row.hash : null) } } : undefined;
        },
        async keys() {
            return rows.map((r) => ({ url: new URL(r.url, ORIGIN).href }));
        }
    };
    return { open: async (name) => { assert.strictEqual(name, 'static-cache-v1'); return cache; } };
}

function memoryStorage() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

(async () => {
    // ---- diff ----
    const manifest = [
        { url: '/', hash: 'root2', size: 10 },
        { url: '/app', hash: 'app1', size: 20 },
        { url: '/scripts/a.js', hash: 'a1', size: 30 },
        { url: '/scripts/b.js', hash: 'b2', size: 40 },
        { url: '/css/c.css', hash: 'c1', size: 50 }
    ];
    const env = {
        location: { origin: ORIGIN },
        caches: fakeCaches([
            { url: '/index.html', hash: 'root2' },          // "/" matches the /index.html row
            { url: '/app', hash: 'app1' },
            { url: '/scripts/a.js', hash: 'a1' },
            { url: '/scripts/b.js', hash: 'b1' },             // stale hash
            { url: '/css/c.css?sha=abc', hash: 'c1' }         // only a ?sha= sibling has it
        ])
    };
    const needed = await engine.filesNeedingUpdate(env, manifest);
    assert.deepStrictEqual(needed.map((f) => f.url), ['/scripts/b.js'], 'only the stale file; aliases and siblings count');
    assert.strictEqual(engine.totalBytes(needed), 40);

    // ---- conditional manifest (Yozora #516): digest stored once in sync, then 304 ----
    {
        const DIGEST = 'digest-1';
        const synced = [{ url: '/app', hash: 'app1', size: 20 }];
        const seen = [];
        const storage = memoryStorage();
        const condEnv = {
            location: { origin: ORIGIN },
            localStorage: storage,
            caches: fakeCaches([{ url: '/app', hash: 'app1' }]),
            fetch: async (url, opts) => {
                const sent = opts.headers['X-Manifest-Hash'] || '';
                seen.push(sent);
                if (sent === DIGEST) return { ok: false, status: 304, headers: { get: () => DIGEST } };
                return { ok: true, status: 200, headers: { get: (h) => (h === 'X-Manifest-Hash' ? DIGEST : null) }, json: async () => synced };
            }
        };
        const first = await engine.check(condEnv);
        assert.strictEqual(first.files.length, 0, 'in sync');
        assert.strictEqual(seen[0], '', 'first check sends no digest');
        assert.strictEqual(storage.getItem('melatonManifestHash'), DIGEST, 'digest stored once the cache matched');
        const second = await engine.check(condEnv);
        assert.strictEqual(seen[1], DIGEST, 'next check sends the digest');
        assert.ok(second.unchanged && second.files.length === 0, '304: nothing to install, no diff');

        // A cache that is behind does not store the digest
        const behindStorage = memoryStorage();
        const behind = await engine.check({ ...condEnv, localStorage: behindStorage, caches: fakeCaches([]) });
        assert.strictEqual(behind.files.length, 1);
        assert.strictEqual(behindStorage.getItem('melatonManifestHash'), null, 'out of sync: no digest');

        const bare = memoryStorage();
        bare.setItem('melatonManifestHash', DIGEST);
        const hole = await engine.check({ ...condEnv, localStorage: bare, caches: fakeCaches([]) });
        assert.ok(!hole.unchanged, '304 without a stored file list is not a full cache');
        assert.strictEqual(hole.files.length, 1, 'empty cache is taken from the full list');

        const snapped = memoryStorage();
        snapped.setItem('melatonManifestHash', DIGEST);
        snapped.setItem('melatonManifestSnapshot', JSON.stringify([{ url: '/app', hash: 'app1' }]));
        const emptySnap = await engine.check({ ...condEnv, localStorage: snapped, caches: fakeCaches([]) });
        assert.ok(!emptySnap.unchanged, '304 still diffs the stored file list');
        assert.strictEqual(emptySnap.files.length, 1, 'a wiped cache is not treated as in sync');
    }
    assert.deepStrictEqual((await engine.filesNeedingUpdate({ ...env, caches: null }, manifest)).length, 5, 'no Cache Storage: everything');
    const withAuth = manifest.concat([
        { url: '/protected/fflate.js', hash: 'ff', size: 9, auth: true },
        { url: '/protected/t5_tokenizer.json', hash: 't5', size: 9 }
    ]);
    const authNeeded = await engine.filesNeedingUpdate({ ...env, caches: null }, withAuth);
    assert.ok(!authNeeded.some((file) => String(file.url).startsWith('/protected/')), 'auth-gated files are not precached');

    // check(): manifest from OPTIONS /
    env.fetch = async (url, opts) => {
        assert.strictEqual(url, '/');
        assert.strictEqual(opts.method, 'OPTIONS');
        return { ok: true, json: async () => manifest };
    };
    const found = await engine.check(env);
    assert.deepStrictEqual(found.files.map((f) => f.url), ['/scripts/b.js']);
    env.fetch = async () => ({ ok: false, status: 503 });
    assert.deepStrictEqual(await engine.check(env), { skipped: 'no-manifest' }, 'runtime compile 503: skip, boot on');

    // ---- installer threshold, stragglers, state ----
    const s = { localStorage: memoryStorage() };
    const many = Array.from({ length: 25 }, (_, i) => ({ url: `/f${i}.js` }));
    assert.strictEqual(engine.needsInstaller(s, many.slice(0, 20)), false, '20 files: silent');
    assert.strictEqual(engine.needsInstaller(s, many), true, '21+: installer');
    engine.writeRecord(s, { completedAt: 1, stragglers: many.slice(0, 10).map((f) => f.url) });
    assert.strictEqual(engine.needsInstaller(s, many), false, 'known stragglers do not reopen Setup');
    engine.writeState(s, { startedAt: 5, total: 25 });
    assert.deepStrictEqual(engine.readState(s), { startedAt: 5, total: 25, active: true });
    assert.strictEqual(engine.needsInstaller(s, many.slice(0, 2)), true, 'an interrupted install resumes in Setup');
    engine.writeState(s, null);
    assert.strictEqual(engine.readState(s), null);

    // ---- download over a fake worker ----
    function fakeWorker() {
        const listeners = new Set();
        const posted = [];
        const container = {
            controller: { postMessage: (m) => posted.push(m) },
            addEventListener: (t, fn) => { if (t === 'message') listeners.add(fn); },
            removeEventListener: (t, fn) => listeners.delete(fn),
            emit: (data) => [...listeners].forEach((fn) => fn({ data }))
        };
        return { container, posted, listeners };
    }
    const clock = { t: 0, timers: new Map(), id: 0 };
    const denv = (container) => ({
        navigator: { serviceWorker: container },
        now: () => clock.t,
        setInterval: (fn) => { const id = ++clock.id; clock.timers.set(id, fn); return id; },
        clearInterval: (id) => clock.timers.delete(id)
    });
    const list = [{ url: '/x', hash: 'x', size: 900 }, { url: '/y', hash: 'y', size: 100 }];
    let w = fakeWorker();
    const progress = [];
    const done = engine.download(denv(w.container), list, { onProgress: (p) => progress.push(Math.round(p.fraction * 100)) });
    assert.deepStrictEqual(w.posted, [{ type: 'CACHE_STATIC_FILES', files: list, silent: false }]);
    w.container.emit({ type: 'STATIC_CACHE_STARTED', total: 2 });
    w.container.emit({ type: 'STATIC_CACHE_PROGRESS', completed: 1, total: 2, currentFile: '/x' });
    w.container.emit({ type: 'STATIC_CACHE_ERROR', file: '/y', error: 'HTTP 404: Not Found' });
    w.container.emit({ type: 'STATIC_CACHE_COMPLETE', completed: 2, total: 2 });
    const result = await done;
    assert.deepStrictEqual(progress, [0, 90, 100], 'progress by bytes (the 900 B file is 90%)');
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.errors, ['/y: HTTP 404: Not Found']);
    assert.strictEqual(w.listeners.size, 0, 'listener removed');

    // no progress for stallMs: stalled
    w = fakeWorker();
    const stalled = engine.download(denv(w.container), list, {});
    clock.t += engine.config.stallMs;
    [...clock.timers.values()].forEach((fn) => fn());
    const r2 = await stalled;
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(r2.stalled, true);
    assert.strictEqual(clock.timers.size, 0, 'stall timer cleared');

    // no controller: nothing posted
    const r3 = await engine.download({ navigator: { serviceWorker: { controller: null } } }, list, {});
    assert.deepStrictEqual([r3.ok, r3.errors], [false, ['no-worker']]);

    // /app boot gate uses the same cutoff and straggler rule (serviceWorkerManager.js)
    const swSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/serviceWorkerManager.js'), 'utf8');
    const fnStart = swSrc.indexOf('function filesCountingTowardInstaller');
    const fnEnd = swSrc.indexOf('class ServiceWorkerManager');
    assert.ok(fnStart > 0 && fnEnd > fnStart, 'installer helpers are in serviceWorkerManager.js');
    const gate = {};
    vm.runInNewContext(
        'var WIZARD_FILE_THRESHOLD = 20;\n' + swSrc.slice(fnStart, fnEnd) +
        '\nthis.filesCountingTowardInstaller = filesCountingTowardInstaller;\nthis.needsLaunchInstaller = needsLaunchInstaller;\nthis.servicePackFromFiles = servicePackFromFiles;\nthis.servicePackPatchId = servicePackPatchId;',
        gate
    );
    const gateFiles = Array.from({ length: 25 }, (_, i) => ({ url: '/gate' + i + '.js', hash: 'h' }));
    assert.strictEqual(gate.needsLaunchInstaller(gateFiles.slice(0, 20), {}), false, '20 files stay on /app');
    assert.strictEqual(gate.needsLaunchInstaller(gateFiles, {}), true, '21+ files reboot to /launch');
    assert.strictEqual(gate.needsLaunchInstaller(gateFiles, {
        stragglers: gateFiles.slice(0, 10).map((f) => f.url)
    }), false, 'known stragglers do not count toward the cutoff');
    assert.strictEqual(gate.needsLaunchInstaller([], { installInProgress: true }), true, 'an interrupted /launch install still reboots');
    const oct2026 = Date.UTC(2026, 9, 14);
    const packFiles = [
        { url: '/b.js', hash: 'hb', modified: Date.UTC(2026, 0, 2) },
        { url: '/a.js', hash: 'ha', modified: oct2026 }
    ];
    const servicePack = gate.servicePackFromFiles(packFiles, Date.UTC(2020, 0, 1));
    assert.strictEqual(servicePack.yy, '26');
    assert.strictEqual(servicePack.quarter, 4, 'October is Q4');
    assert.strictEqual(servicePack.label, `Upgrade to Service Pack 26Q4 ${servicePack.patchId}`);
    assert.strictEqual(servicePack.patchId, gate.servicePackPatchId(packFiles));
    assert.strictEqual(gate.servicePackFromFiles(packFiles.slice().reverse(), 0).patchId, servicePack.patchId, 'order does not change the patch id');
    assert.notStrictEqual(gate.servicePackPatchId([{ url: '/a.js', hash: 'other' }]), servicePack.patchId);
    assert.strictEqual(gate.servicePackFromFiles([{ url: '/a.js', hash: 'ha' }], Date.UTC(2026, 3, 1)).label.startsWith('Upgrade to Service Pack 26Q2 '), true);
    assert.strictEqual(gate.servicePackFromFiles([{ url: '/a.js', hash: 'ha', modified: Date.UTC(2025, 6, 1) }], oct2026).yy, '25', 'the file time wins over now');
    assert.ok(swSrc.includes('_offerServicePackUpgrade'), 'a large update on the running desktop is held for the service pack restart');
    assert.ok(swSrc.includes('_isBeforeDesktop'), 'pre-desktop updates do not paint progress');
    const initFn = swSrc.slice(
        swSrc.indexOf('async checkAndDownloadUpdatesForInit'),
        swSrc.indexOf('async downloadUpdatesForInit')
    );
    assert.ok(initFn.length > 0 && !initFn.includes('_showInitUpdateModal'), 'the boot download does not open the System Update dialog');

    // ---- install groups and the one-stream pack ----
    assert.strictEqual(engine.fileGroup({ url: '/app', type: 'route' }), 'features');
    assert.strictEqual(engine.fileGroup({ url: '/scripts/a.js' }), 'features');
    assert.strictEqual(engine.fileGroup({ url: '/css/c.css' }), 'features');
    assert.strictEqual(engine.fileGroup({ url: '/static_images/a.webp' }), 'updates');
    assert.strictEqual(engine.fileGroup({ url: '/fonts/a.woff2' }), 'updates');
    assert.strictEqual(engine.zipEntryName('/'), 'index.html');
    assert.strictEqual(engine.zipEntryName('/app'), 'app.html');
    assert.strictEqual(engine.contentType('/app'), 'text/html; charset=utf-8', 'extracted /app must render, not download');
    assert.strictEqual(engine.contentType('/launch'), 'text/html; charset=utf-8');
    assert.strictEqual(engine.contentType('/'), 'text/html; charset=utf-8');
    assert.strictEqual(engine.contentType('/scripts/a.js'), 'application/javascript');
    assert.strictEqual(engine.zipEntryName('/scripts/a.js'), 'scripts/a.js');

    const crypto = require('crypto');
    const os = require('os');
    const fflate = require('fflate');
    const pack = require('../modules/meletonInstallPack');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'meleton-pack-'));
    const jsBody = Buffer.from('console.log(1)\n');
    const pngBody = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(path.join(tmp, 'a.js'), jsBody);
    fs.writeFileSync(path.join(tmp, 'a.png'), pngBody);
    const packManifest = [
        { url: '/a.js', hash: crypto.createHash('sha256').update(jsBody).digest('hex'), size: jsBody.length },
        { url: '/a.png', hash: crypto.createHash('sha256').update(pngBody).digest('hex'), size: pngBody.length }
    ];
    const outDir = path.join(tmp, 'out');
    const built = await pack.rebuild({
        outputDir: outDir,
        manifest: packManifest,
        resolveFile: (file) => path.join(tmp, file.url.slice(1))
    });
    assert.strictEqual(built.rebuilt, true);
    assert.strictEqual(built.count, 2);
    assert.strictEqual(built.hash, pack.hashManifest(packManifest));
    const again = await pack.rebuild({
        outputDir: outDir,
        manifest: packManifest,
        resolveFile: (file) => path.join(tmp, file.url.slice(1))
    });
    assert.strictEqual(again.rebuilt, false, 'same manifest does not rebuild the pack');
    const zipBytes = fs.readFileSync(path.join(outDir, 'pack.zip'));
    const central = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
    const methods = [];
    let at = 0;
    while (at < zipBytes.length) {
        const found = zipBytes.indexOf(central, at);
        if (found < 0) break;
        const nameLen = zipBytes.readUInt16LE(found + 28);
        methods.push({
            name: zipBytes.slice(found + 46, found + 46 + nameLen).toString(),
            method: zipBytes.readUInt16LE(found + 10)
        });
        at = found + 46 + nameLen;
    }
    const byName = new Map(methods.map((row) => [row.name, row.method]));
    assert.strictEqual(byName.get('a.js'), 8, 'script is deflated');
    assert.strictEqual(byName.get('a.png'), 0, 'png is stored');
    assert.strictEqual(byName.get('pack.json'), 8);

    function memoryCache(rows) {
        const store = new Map();
        rows.forEach((row) => {
            store.set(new URL(row.url, ORIGIN).href, row);
        });
        const cache = {
            async match(key) {
                const url = typeof key === 'string' ? new URL(key, ORIGIN).href : key.url;
                const row = store.get(url);
                if (!row) return undefined;
                const body = row.body || new Uint8Array();
                return {
                    url,
                    headers: {
                        get: (name) => {
                            if (name === 'x-file-hash') return row.hash;
                            if (name === 'content-type') return row.type || null;
                            return null;
                        }
                    },
                    arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
                };
            },
            async keys() {
                return [...store.keys()].map((url) => ({ url }));
            },
            async delete(request) {
                const url = typeof request === 'string' ? new URL(request, ORIGIN).href : request.url;
                store.delete(url);
            },
            async put(key, response) {
                const url = typeof key === 'string' ? new URL(key, ORIGIN).href : key.url;
                const body = new Uint8Array(await response.arrayBuffer());
                store.set(url, {
                    url,
                    hash: response.headers.get('x-file-hash'),
                    type: response.headers.get('content-type'),
                    body
                });
            }
        };
        return { open: async () => cache, store };
    }

    const caches = memoryCache([
        { url: '/a.js', hash: packManifest[0].hash, body: new Uint8Array(jsBody), type: 'application/javascript' }
    ]);
    const zipResponse = {
        ok: true,
        status: 200,
        headers: {
            get: (name) => {
                if (name === 'x-pack-hash') return built.hash;
                if (name === 'content-length') return String(zipBytes.length);
                return null;
            }
        },
        arrayBuffer: async () => zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
    };
    const penv = {
        location: { origin: ORIGIN },
        caches,
        fflate,
        fetch: async (url) => {
            assert.strictEqual(url, '/install/meletonfx.zip');
            return zipResponse;
        },
        sleep: async () => {}
    };
    const copied = await engine.copyPack(penv, packManifest, { onProgress: () => {} });
    assert.strictEqual(copied.ok, true, copied.error || 'copy');
    const expanded = await engine.expandPack(penv, packManifest, { onProgress: () => {} });
    assert.strictEqual(expanded.ok, true, expanded.error || 'expand');
    assert.deepStrictEqual(expanded.missing, []);
    assert.strictEqual(expanded.stored, 1, 'only the png was missing from the cache');
    const features = await engine.installGroup(penv, 'features', {});
    const updates = await engine.installGroup(penv, 'updates', {});
    assert.deepStrictEqual(features.mismatched, [], 'the script was already current and is not in this group write');
    assert.deepStrictEqual(updates.mismatched, [], 'the stored png matches after write');
    const pngKey = new URL('/a.png', ORIGIN).href;
    assert.strictEqual(caches.store.get(pngKey).hash, packManifest[1].hash);

    const posted = [];
    const subsetCopy = await engine.copyPack({
        ...penv,
        fetch: async (url, opts) => {
            if (opts && opts.method === 'POST') {
                posted.push(JSON.parse(opts.body));
                return { ok: false, status: 413, headers: { get: () => null } };
            }
            return zipResponse;
        }
    }, packManifest, { subset: packManifest.slice(0, 1) });
    assert.strictEqual(posted.length, 1, 'a short list is posted');
    assert.strictEqual(posted[0].files[0].url, packManifest[0].url);
    assert.strictEqual(subsetCopy.ok, true, '413 falls back to the full pack');

    const bad = await engine.copyPack({
        ...penv,
        fetch: async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name === 'content-length' ? '4' : 'not-the-hash') },
            arrayBuffer: async () => zipBytes.buffer.slice(zipBytes.byteOffset, zipBytes.byteOffset + zipBytes.byteLength)
        })
    }, packManifest, {});
    assert.strictEqual(bad.ok, false);
    assert.strictEqual(bad.error, 'pack-hash');

    fs.rmSync(tmp, { recursive: true, force: true });

    // Realistic install: ~3k files in one pack. fflate 0.8 Unzip.push recursed once
    // per entry, so a single push of the whole pack hit "Maximum call stack size exceeded".
    const bigDir = path.join(tmp, 'big');
    fs.mkdirSync(path.join(bigDir, 'scripts'), { recursive: true });
    const bigManifest = [];
    for (let i = 0; i < 3000; i++) {
        const body = i % 4 === 0 ? crypto.randomBytes(2048) : Buffer.from(`console.log(${i});\n`.repeat(20 + (i % 40)));
        const rel = `scripts/f${i}.${i % 4 === 0 ? 'png' : 'js'}`;
        fs.writeFileSync(path.join(bigDir, rel), body);
        bigManifest.push({ url: '/' + rel, hash: crypto.createHash('sha256').update(body).digest('hex'), size: body.length });
    }
    const bigOut = path.join(bigDir, 'out');
    const bigBuilt = await pack.rebuild({ outputDir: bigOut, manifest: bigManifest, resolveFile: (file) => path.join(bigDir, file.url.slice(1)) });
    const bigZip = fs.readFileSync(path.join(bigOut, 'pack.zip'));
    const bigCaches = memoryCache([]);
    // The real 172 MB pack (2.8k entries) overflows on one push; it is too big
    // for a unit test, so pin the slicing instead.
    let maxPush = 0;
    class SpyUnzip extends fflate.Unzip {
        push(chunk, final) {
            maxPush = Math.max(maxPush, chunk.length);
            return super.push(chunk, final);
        }
    }
    const spyFflate = Object.assign({}, fflate, { Unzip: SpyUnzip });
    const benv = {
        location: { origin: ORIGIN },
        caches: bigCaches,
        fflate: spyFflate,
        fetch: async () => ({
            ok: true,
            status: 200,
            headers: { get: (name) => (name === 'x-pack-hash' ? bigBuilt.hash : name === 'content-length' ? String(bigZip.length) : null) },
            arrayBuffer: async () => bigZip.buffer.slice(bigZip.byteOffset, bigZip.byteOffset + bigZip.byteLength)
        }),
        sleep: async () => {}
    };
    const bigCopy = await engine.copyPack(benv, bigManifest, {});
    assert.strictEqual(bigCopy.ok, true, bigCopy.error || 'big copy');
    const bigExpand = await engine.expandPack(benv, bigManifest, {});
    assert.strictEqual(bigExpand.ok, true, bigExpand.error || 'big expand');
    assert.deepStrictEqual(bigExpand.missing, []);
    assert.strictEqual(bigExpand.stored, 3000, 'every file of a 3k-entry pack lands');
    assert.ok(maxPush > 0 && maxPush <= 64 * 1024, `Unzip.push is fed in slices (max ${maxPush})`);

    // A stale pack answers 503 while the server rebuilds it; copyPack waits, then copies.
    let calls503 = 0;
    const waitEnv = {
        ...benv,
        caches: memoryCache([]),
        sleep: async () => {},
        fetch: async () => {
            calls503 += 1;
            if (calls503 < 3) return { ok: false, status: 503, headers: { get: (n) => (n === 'retry-after' ? '5' : null) } };
            return benv.fetch();
        }
    };
    const waited = await engine.copyPack(waitEnv, bigManifest, {});
    assert.strictEqual(waited.ok, true, waited.error || 'copy after 503');
    assert.strictEqual(calls503, 3);
    // Retry drops the stored digest and list.
    const ls = new Map([['melatonManifestHash', 'x'], ['melatonManifestSnapshot', '[]'], ['other', '1']]);
    engine.forgetManifest({ localStorage: { removeItem: (k) => ls.delete(k), getItem: (k) => ls.get(k), setItem: (k, v) => ls.set(k, v) } });
    assert.deepStrictEqual([...ls.keys()], ['other']);

    console.log('✅ test-update-engine: all assertions passed');
})().catch((err) => {
    console.error('❌ test-update-engine failed:', err);
    process.exit(1);
});
