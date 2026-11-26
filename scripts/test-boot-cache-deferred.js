#!/usr/bin/env node
'use strict';
// #1230: the asset manifest build must stay off the boot path (after `ready`), and an unchanged
// file must not be re-hashed across two consecutive builds.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'web_server.js'), 'utf8');

// 1. ordering: nothing awaits the compile prime or builds the manifest before `ready`; both run after endBoot()
const readyAt = src.indexOf("updateServerStage('ready', true)");
assert(readyAt > 0, 'ready stage marker not found');
const bootStart = src.indexOf('globalResources.logger.startBoot();');
assert(bootStart > 0 && bootStart < readyAt, 'startBoot not found before ready');
const before = src.slice(bootStart, readyAt);
assert(!/await assetPrime/.test(before), 'the boot awaits the compile prime before ready');
assert(!/bootStep\('Runtime Asset Compilation'/.test(before), 'Runtime Asset Compilation is a boot step before ready');
assert(!/initializeCacheData\(true\)/.test(before), 'initializeCacheData runs before ready (boot path)');
assert(!/runtimeCompileComplete = true/.test(before), 'runtimeCompileComplete flips before ready');
const after = src.slice(readyAt);
const iCompile = after.indexOf("bootStep('Runtime Asset Compilation'");
const iManifest = after.indexOf("bootStep('Asset Manifest'");
const iPreview = after.indexOf("bootStep('Preview Synchronization'");
assert(iCompile > 0 && iCompile < iManifest && iManifest < iPreview, 'after ready: compile, then Asset Manifest, then Preview Synchronization');
assert(/refreshCache:\s*false/.test(after), 'the compile step must pass refreshCache:false (the manifest is its own step)');
assert(/bootStep\('Asset Manifest'[\s\S]*?initializeCacheData\(true\)/.test(after), 'Asset Manifest step missing after ready');
assert(/assetPrime\.catch\(/.test(src), 'assetPrime needs an early catch (awaited late)');
assert(/runtimeCompileComplete = true/.test(after), 'runtimeCompileComplete must flip after the manifest');

// 2. an unchanged file is not read twice: persisted manifest -> hashServedFileIfChangedAsync
const store = require('../modules/assetManifestStore');
const svc = require('../modules/runtimeAssetService');
(async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'asset-manifest-'));
    try {
        const files = ['a.txt', 'b.txt', 'c.txt'].map((n) => path.join(tmp, n));
        files.forEach((f, i) => fs.writeFileSync(f, 'x'.repeat(10 + i)));
        const realRead = fs.promises.readFile;
        let reads = 0;
        fs.promises.readFile = function (p, ...rest) { if (files.includes(p)) reads++; return realRead.call(this, p, ...rest); };
        const build = async (prev) => {
            const map = new Map(prev.map((e) => [e.path, e]));
            const out = [];
            await store.runBounded(files, 2, async (f) => {
                const st = await fs.promises.stat(f);
                const hash = await svc.hashServedFileIfChangedAsync(f, st, map.get(f));
                out.push({ path: f, hash, size: st.size, modified: st.mtime.getTime() });
            });
            return out;
        };
        const first = await build([]);
        assert.strictEqual(reads, 3, 'first build reads every file');
        assert(await store.save(tmp, first), 'save');
        const loaded = await store.load(tmp); // a restart: only the disk copy is left
        assert.strictEqual(loaded.length, 3);
        reads = 0;
        await build(loaded);
        assert.strictEqual(reads, 0, 'second build re-read an unchanged file');
        fs.writeFileSync(files[1], 'changed!!!');
        reads = 0;
        await build(loaded);
        assert.strictEqual(reads, 1, 'only the changed file is read again');
        fs.promises.readFile = realRead;

        // 3. loadTree (run twice at boot) reads a file once: the second pass sees the same mtime
        const mem = require('../modules/runtimeAssetMemory');
        const out = path.join(tmp, 'out');
        fs.mkdirSync(out);
        for (let i = 0; i < 5; i++) fs.writeFileSync(path.join(out, `f${i}.js`), `var a${i}=1;`);
        let treeReads = 0;
        fs.promises.readFile = function (p, ...rest) { if (String(p).startsWith(out)) treeReads++; return realRead.call(this, p, ...rest); };
        await mem.loadTree(out);
        assert.strictEqual(treeReads, 5, 'first loadTree reads each file');
        await mem.loadTree(out);
        assert.strictEqual(treeReads, 5, 'second loadTree re-read an unchanged file');
        fs.promises.readFile = realRead;
        console.log('ok test-boot-cache-deferred');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
// 4. only the first boot tree prints "Server ready" (the measured pair); a later tree is "Post-ready tasks"
{
    const { execFileSync } = require('child_process');
    const out = execFileSync(process.execPath, ['-e', `
        const l = require('${path.join(root, 'modules', 'logger.js').replace(/\\/g, '/')}');
        (async () => {
            l.startBoot(); await l.bootStep('A', async () => {}); l.endBoot();
            l.startBoot(); await l.bootStep('B', async () => {}); l.endBoot();
        })();`], { encoding: 'utf8', cwd: root });
    assert.strictEqual((out.match(/Server ready \(/g) || []).length, 1, 'exactly one "Server ready" for two boot trees');
    assert(/Post-ready tasks done/.test(out), 'late tree is labelled Post-ready tasks');
}
