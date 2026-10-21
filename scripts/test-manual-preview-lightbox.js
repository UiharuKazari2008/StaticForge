'use strict';

// Studio preview click must not pass gallery index 0 when that list is empty
// (public/scripts/comp/manualPreviewManager.js resolveManualPreviewLightboxIndex).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/manualPreviewManager.js'), 'utf8');
const start = src.indexOf('function manualPreviewSameFile');
const end = src.indexOf('function manualPreviewLightboxSource');
assert.ok(start > 0 && end > start);
const sandbox = {};
vm.runInNewContext(src.slice(start, end), sandbox);
const resolve = sandbox.resolveManualPreviewLightboxIndex;

const preview = { filename: 'new.png', original: 'new.png' };
assert.strictEqual(resolve(preview, 0, []), -1, 'empty gallery is not index 0');
assert.strictEqual(resolve(preview, 0, [{ filename: 'older.png' }]), -1);
assert.strictEqual(resolve(preview, 0, [{ filename: 'new.png' }]), 0);
assert.strictEqual(resolve(preview, 0, [
    { filename: 'older.png' },
    { upscaled: 'new.png', original: 'new.png' }
]), 1);
assert.strictEqual(resolve(null, 0, [{ filename: 'new.png' }]), -1);
assert.ok(src.includes('resolveManualPreviewLightboxIndex('), 'the preview click uses the resolved index');
assert.ok(!src.includes('if (lastGenFilename && lastGenFilename === currentFilename)'), 'a missing gallery row is not treated as index 0');

console.log('manual preview lightbox index ok');
