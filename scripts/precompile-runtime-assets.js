#!/usr/bin/env node
'use strict';

// Deploy-time warm of .cache/runtime-assets so boot loads compiled CSS/JS
// instead of minifying on the request path. modules/runtimeAssetService.js

const path = require('path');
const runtimeAssetService = require('../modules/runtimeAssetService');

const root = path.resolve(__dirname, '..');
const force = process.argv.includes('--force');

runtimeAssetService.init({ projectRoot: root });

runtimeAssetService.startRuntimeAssetPrime(root, {
    force,
    showConsoleProgress: true
}).then((result) => {
    const errors = result && Array.isArray(result.errors) ? result.errors.length : 0;
    const compiled = result && result.compiled ? result.compiled : 0;
    const skipped = result && result.skipped ? result.skipped : 0;
    console.log(`[precompile-runtime-assets] compiled=${compiled} skipped=${skipped} errors=${errors}`);
    if (errors > 0) {
        for (const entry of result.errors) {
            console.error(`[precompile-runtime-assets] ${entry.file}: ${entry.error}`);
        }
    }
    process.exit(errors > 0 ? 1 : 0);
}).catch((err) => {
    console.error('[precompile-runtime-assets]', err && err.stack ? err.stack : err);
    process.exit(1);
});
