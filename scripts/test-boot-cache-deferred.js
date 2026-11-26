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

// 1. ordering: no initializeCacheData(true) before the `ready` stage; one after endBoot()
const readyAt = src.indexOf("updateServerStage('ready', true)");
assert(readyAt > 0, 'ready stage marker not found');
const bootStart = src.indexOf("globalResources.logger.bootStep('Runtime Asset Compilation'");
assert(bootStart > 0 && bootStart < readyAt, 'Runtime Asset Compilation step not found before ready');
const before = src.slice(bootStart, readyAt);
assert(!/initializeCacheData\(true\)/.test(before), 'initializeCacheData runs before ready (boot path)');
assert(/refreshCache:\s*false/.test(before), 'boot refreshHashCacheAndBroadcast must pass refreshCache:false');
const after = src.slice(readyAt);
assert(/bootStep\('Asset Manifest'[\s\S]*?initializeCacheData\(true\)/.test(after), 'Asset Manifest step missing after ready');
assert(after.indexOf("bootStep('Asset Manifest'") < after.indexOf("bootStep('Preview Synchronization'"), 'Asset Manifest must run before Preview Synchronization');
assert(/runtimeCompileComplete = true/.test(after) && !/runtimeCompileComplete = true/.test(before), 'runtimeCompileComplete must flip after the manifest');

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
        console.log('ok test-boot-cache-deferred');
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
})().catch((e) => { console.error(e); process.exit(1); });
