#!/usr/bin/env node
// Build public/data/app-assets.json (modules/appAssetManifest.js, Yozora #518). The runtime
// compile does this too; run by hand after editing application CSS without a server.
// Usage: node scripts/build-app-asset-manifest.js [--print]
const path = require('path');
const { buildAppAssetManifest, writeAppAssetManifest } = require('../modules/appAssetManifest');

const root = path.join(__dirname, '..');
if (process.argv.includes('--print')) {
    process.stdout.write(`${JSON.stringify(buildAppAssetManifest(root), null, 1)}\n`);
} else {
    const result = writeAppAssetManifest(root);
    console.log(`[app-assets] ${result.changed ? 'wrote' : 'unchanged'} ${path.relative(root, result.path)} (${result.groups} groups)`);
}
