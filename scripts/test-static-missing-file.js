#!/usr/bin/env node
// A missing static script must resolve as absent. It must not reject ENOENT.
// Run: node scripts/test-static-missing-file.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');

const runtimeAssetService = require('../modules/runtimeAssetService');

async function main() {
    const rejections = [];
    function onRejection(error) {
        rejections.push(error);
    }
    process.on('unhandledRejection', onRejection);

    runtimeAssetService.clearRuntimeAssetMemory();
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'static-missing-'));
    try {
    const scriptsDir = path.join(root, 'public', 'scripts', 'comp');
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(path.join(scriptsDir, 'blockContainer.js'), 'function BlockContainer() {}\n');
    fs.writeFileSync(path.join(root, 'public', 'app.html'), '<!doctype html>');
    fs.writeFileSync(path.join(root, 'public', 'launch.html'), '<!doctype html>');
    runtimeAssetService.init({ projectRoot: root });

    const missing = await runtimeAssetService.resolveRuntimeAsset(root, '/scripts/blockContainer.js');
    assert.strictEqual(missing, null, 'unknown script path is absent');

    const again = await Promise.all([
        runtimeAssetService.resolveRuntimeAsset(root, '/scripts/blockContainer.js'),
        runtimeAssetService.resolveRuntimeAsset(root, '/scripts/blockContainer.js')
    ]);
    assert.deepStrictEqual(again, [null, null]);

    const present = await runtimeAssetService.resolveRuntimeAsset(root, '/scripts/comp/blockContainer.js');
    assert.ok(present && present.body, 'the real blockContainer script still compiles');

    const app = express();
    app.use(async (req, res, next) => {
        try {
            if (req.method !== 'GET' && req.method !== 'HEAD') return next();
            if (!runtimeAssetService.isRuntimeManagedWebPath(req.path)) return next();
            const asset = await runtimeAssetService.resolveRuntimeAsset(root, req.path);
            if (!asset || !asset.body) return next();
            res.type(asset.contentType).end(asset.body);
        } catch (err) {
            if (err && (err.code === 'ENOENT' || err.code === 'ENOTDIR')) return next();
            next(err);
        }
    });
    app.use(express.static(path.join(root, 'public'), { fallthrough: true }));
    app.use((req, res) => {
        res.status(404).json({ success: false, error: 'Not found', code: 'NOT_FOUND', path: req.originalUrl });
    });
    const httpServer = http.createServer(app);
    await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const port = httpServer.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/scripts/blockContainer.js`);
    const body = await response.json();
    assert.strictEqual(response.status, 404);
    assert.strictEqual(body.code, 'NOT_FOUND');
    const ok = await fetch(`http://127.0.0.1:${port}/scripts/comp/blockContainer.js`);
    assert.strictEqual(ok.status, 200);
    httpServer.close();

    await new Promise((resolve) => setTimeout(resolve, 50));
    process.off('unhandledRejection', onRejection);
    assert.deepStrictEqual(rejections, [], rejections.map((error) => error && error.message).join('\n'));

    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
    assert.ok(serverSource.includes("err.code === 'ENOENT'"), 'static errors become 404');
    assert.ok(serverSource.includes("code: 'NOT_FOUND'"));

    console.log('test-static-missing-file: ok');
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
