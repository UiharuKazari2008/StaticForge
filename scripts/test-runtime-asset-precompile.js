#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const runtimeAssetService = require('../modules/runtimeAssetService');
const runtimeAssetMemory = require('../modules/runtimeAssetMemory');

function makeRoot(name) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), name));
    const cssDir = path.join(root, 'public', 'css');
    const scriptsDir = path.join(root, 'public', 'scripts');
    fs.mkdirSync(cssDir, { recursive: true });
    fs.mkdirSync(scriptsDir, { recursive: true });
    return root;
}

async function testSingleFlightAndMemoryHit() {
    runtimeAssetService.clearRuntimeAssetMemory();
    const root = makeRoot('runtime-precompile-');
    const cssPath = path.join(root, 'public', 'css', 'fixture.css');
    fs.writeFileSync(cssPath, 'body{color:red}\n');
    fs.writeFileSync(path.join(root, 'public', 'app.html'), '<link rel="stylesheet" href="/css/fixture.css">\n');
    fs.writeFileSync(path.join(root, 'public', 'launch.html'), '<link rel="stylesheet" href="/css/fixture.css">\n');
    runtimeAssetService.init({ projectRoot: root });

    const origRead = fs.promises.readFile;
    let sourceReads = 0;
    fs.promises.readFile = async function patchedRead(file, ...rest) {
        const text = String(file);
        if (text.endsWith(`${path.sep}fixture.css`) && !text.includes(`${path.sep}.cache${path.sep}`)) {
            sourceReads += 1;
            await new Promise((resolve) => setTimeout(resolve, 40));
        }
        return origRead.call(fs.promises, file, ...rest);
    };

    try {
        const [first, second] = await Promise.all([
            runtimeAssetService.resolveRuntimeAsset(root, '/css/fixture.css'),
            runtimeAssetService.resolveRuntimeAsset(root, '/css/fixture.css')
        ]);
        assert.ok(first && first.body, 'first resolve returns bytes');
        assert.ok(second && second.body.equals(first.body), 'single-flight shares one body');
        assert.strictEqual(sourceReads, 1, `source read once, got ${sourceReads}`);
        assert.strictEqual(first.optimized, true);
        assert.ok(String(first.body).includes('body{color:red}') || String(first.body).includes('color:red'));

        const origSync = fs.readFileSync;
        const origExists = fs.existsSync;
        fs.readFileSync = () => {
            throw new Error('request path used readFileSync');
        };
        fs.existsSync = () => {
            throw new Error('request path used existsSync');
        };
        try {
            const hit = await runtimeAssetService.resolveRuntimeAsset(root, '/css/fixture.css');
            assert.ok(hit.body.equals(first.body), 'memory hit does not touch sync fs');
            const looked = runtimeAssetService.lookupRuntimeAsset('/css/fixture.css');
            assert.strictEqual(looked.hash, first.hash);
        } finally {
            fs.readFileSync = origSync;
            fs.existsSync = origExists;
        }

        const html = await runtimeAssetService.resolveRuntimeAsset(root, '/app.html');
        assert.ok(html && html.body.includes(`sha=${first.hash}`), String(html && html.body));
        assert.strictEqual(
            fs.readFileSync(path.join(root, 'public', 'app.html'), 'utf8').includes('sha='),
            false
        );
    } finally {
        fs.promises.readFile = origRead;
        runtimeAssetService.clearRuntimeAssetMemory();
        fs.rmSync(root, { recursive: true, force: true });
    }
}

async function testPrimeLoadsDiskWithoutSecondCompile() {
    runtimeAssetService.clearRuntimeAssetMemory();
    const root = makeRoot('runtime-prime-');
    fs.writeFileSync(path.join(root, 'public', 'css', 'prime.css'), 'h1{color:blue}\n');
    fs.writeFileSync(path.join(root, 'public', 'app.html'), '<link rel="stylesheet" href="/css/prime.css">\n');
    fs.writeFileSync(path.join(root, 'public', 'launch.html'), '<link rel="stylesheet" href="/css/prime.css">\n');
    runtimeAssetService.init({ projectRoot: root });

    const first = await runtimeAssetService.startRuntimeAssetPrime(root, { showConsoleProgress: false });
    assert.ok(first.compiled + first.skipped >= 1, JSON.stringify(first));
    const compiledPath = path.join(root, '.cache', 'runtime-assets', 'css', 'prime.css');
    assert.ok(fs.existsSync(compiledPath), 'deploy-style compile writes the cache');
    const stamp = fs.statSync(compiledPath).mtimeMs;

    runtimeAssetService.clearRuntimeAssetMemory();
    const loaded = await runtimeAssetMemory.loadTree(path.join(root, '.cache', 'runtime-assets'));
    assert.ok(loaded >= 1);
    const hit = runtimeAssetService.lookupRuntimeAsset('/css/prime.css');
    assert.ok(hit && hit.body.length > 0);
    assert.strictEqual(fs.statSync(compiledPath).mtimeMs, stamp, 'memory load does not rewrite compiled output');

    runtimeAssetService.clearRuntimeAssetMemory();
    fs.rmSync(root, { recursive: true, force: true });
}

async function main() {
    await testSingleFlightAndMemoryHit();
    await testPrimeLoadsDiskWithoutSecondCompile();
    console.log('test-runtime-asset-precompile: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
