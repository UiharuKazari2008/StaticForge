#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const runtimeAssetService = require('../modules/runtimeAssetService');

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-cache-budget-'));
const assetPath = path.join(tempDir, 'asset.js');

try {
    fs.writeFileSync(assetPath, 'const value = 1;\n');
    const stats = fs.statSync(assetPath);
    const hash = runtimeAssetService.hashServedFileIfChanged(assetPath, stats, null);

    fs.unlinkSync(assetPath);
    assert.strictEqual(
        runtimeAssetService.hashServedFileIfChanged(assetPath, stats, {
            hash,
            size: stats.size,
            modified: stats.mtime.getTime()
        }),
        hash,
        'unchanged cache entries do not reread asset bytes'
    );

    const serverSource = fs.readFileSync(path.join(__dirname, '..', 'web_server.js'), 'utf8');
    const initStart = serverSource.indexOf('async function initializeCacheData(');
    const initEnd = serverSource.indexOf('// Build service worker cache manifest', initStart);
    assert.ok(initStart >= 0 && initEnd > initStart, 'cache initialization function exists');
    assert.ok(
        !serverSource.slice(initStart, initEnd).includes('warmZip('),
        'service-worker refresh does not eagerly rebuild the complete agent asset zip'
    );

    console.log('test-runtime-cache-refresh-budget: ok');
} finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
}
