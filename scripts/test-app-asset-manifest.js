#!/usr/bin/env node
/**
 * Application asset manifest (Yozora #518): CSS parsing (nested @media, image-set densities,
 * fonts known to fonts.css), the real tree's groups (Dovecote's toolbar art, launch index), and
 * public/data/app-assets.json in sync with the sources (node scripts/build-app-asset-manifest.js).
 * modules/appAssetManifest.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const m = require('../modules/appAssetManifest');

const root = path.join(__dirname, '..');

// ---- parsing ----
const rules = m.cssLeafRules(`
/* a { background: url(/no.png) } */
@media (min-width: 10px) { #fooModal .x { background: url('/static_images/a.png') no-repeat; } }
.y::before { background: image-set(url("/static_images/b-16.png") 1x, url('/static_images/b-24.png') 1.5x); }
@font-face { font-family: 'X'; src: url('/dist/fonts/x.ttf'); }
`);
assert.strictEqual(rules.length, 2, 'two leaf rules (the @font-face and the comment are not)');
assert.strictEqual(rules[0].selector, '#fooModal .x');
assert.deepStrictEqual(m.blockImages(rules[0].body, '/css/a.css'), ['/static_images/a.png']);
assert.deepStrictEqual(m.blockImages(rules[1].body, '/css/a.css'),
    [[['/static_images/b-16.png', 1], ['/static_images/b-24.png', 1.5]]], 'image-set keeps its densities');
assert.deepStrictEqual(m.blockImages('background: url(../img/c.webp)', '/css/sub/x.css'), ['/css/img/c.webp'], 'relative to the sheet');
assert.deepStrictEqual(m.blockImages('background: url(data:image/png;base64,AAA)', '/css/x.css'), [], 'data: urls skipped');
assert.deepStrictEqual(m.blockFonts("font-family: 'Share Tech Mono', monospace; font-weight: bold", new Set(['Share Tech Mono'])),
    ['700 16px "Share Tech Mono"']);

// ---- the real tree ----
const manifest = m.buildAppAssetManifest(root);
const dove = manifest.groups['app:dovecote'];
assert.ok(dove, 'Dovecote has a group');
assert.ok(dove.images.some((e) => JSON.stringify(e).includes('/static_images/vista-mail/toolbar-16.png')),
    'Dovecote toolbar art (the late asset Yukimi saw) is in its group');
assert.ok(manifest.launch.dovecote && manifest.launch.dovecote.includes('app:dovecote'), 'launch dovecote → its group');
assert.ok(manifest.launch.studio && manifest.launch.studio.includes('window:manualModal'), 'launch studio → Studio window');
Object.values(manifest.launch).forEach((ids) => ids.forEach((id) => assert.ok(manifest.groups[id], `launch target ${id} exists`)));
Object.values(manifest.windows).forEach((ids) => ids.forEach((id) => assert.ok(manifest.groups[id], `window target ${id} exists`)));
Object.values(manifest.groups).forEach((g) => g.images.forEach((e) => {
    const files = Array.isArray(e) ? e.map((c) => c[0]) : [e];
    files.forEach((file) => {
        // Sized app icons are compiled into .cache (modules/appIconRuntimeAssets.js): the master must exist
        const icon = /^\/static_images\/app_icons\/(?:\d+\/)?([^/]+)\.(?:webp|png)$/.exec(file);
        const exists = icon
            ? fs.existsSync(path.join(root, 'public/static_images/app_icons', `${icon[1]}.png`)) || icon[1] === 'dreamscape-logo'
            : fs.existsSync(path.join(root, 'public', file));
        assert.ok(exists, `${file} exists`);
    });
}));

// ---- generated file in sync ----
// Generated (gitignored): the runtime compile writes it; a fresh checkout has none yet
const outFile = path.join(root, m.OUTPUT_REL);
if (fs.existsSync(outFile)) {
    const onDisk = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    assert.deepStrictEqual(onDisk, manifest, 'public/data/app-assets.json is current (node scripts/build-app-asset-manifest.js)');
}

console.log(`test-app-asset-manifest: ok (${Object.keys(manifest.groups).length} groups)`);
