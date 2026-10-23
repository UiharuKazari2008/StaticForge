#!/usr/bin/env node
// SoraTan desktop toy (Yozora #633), a Melaton system package since #638 (apps/soratan): SoraTan.exe
// in the VFS opens it (opens[]); its server half decodes the .sora next to the exe; the client half
// follows SoraTan.exe's behaviour. The runner and sandbox are covered by test-melaton-apps.js.
// Run: node scripts/test-soratan.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { validateManifest } = require('../modules/melatonPackageStore');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- the package
const manifest = validateManifest(JSON.parse(read('apps/soratan/manifest.json')));
assert.strictEqual(manifest.format, 'msaz');
assert.deepStrictEqual(manifest.opens, [{ name: 'SoraTan.exe', size: 999424 }], 'opens the 2009 SoraTan.exe only');
assert.deepStrictEqual(manifest.server, { entry: 'server/main.js', runner: 'session', memoryMB: 96 }, 'ends with her');
for (const s of [16, 32, 48]) assert.ok(fs.existsSync(path.join(ROOT, `apps/soratan/assets/soratan-${s}.png`)), `icon ${s}`);
assert.ok(!fs.existsSync(path.join(ROOT, 'public/static_images/soratan')), 'no decoded copy of the toy in public/: it is decoded from the user\'s file');
assert.ok(!fs.existsSync(path.join(ROOT, 'public/scripts/comp/desktop-apps/soraTan.js')), 'the runtime moved into the package');

// ---- the client half: an app, behaviour as SoraTan.exe
const rt = read('apps/soratan/client/soratan.js');
assert.ok(rt.includes("melatonApps.define('soratan', start);") && /^\(function \(\) \{/m.test(rt), 'defines the app, wrapped (two package copies cannot collide)');
assert.ok(rt.includes('const SORATAN_DEFAULT_SIZE = 500;') && rt.includes('const SORATAN_SIZES = [300, 500, 700, 900];'), 'exe sizes, 500 by default');
assert.ok(rt.includes('const SORATAN_SCENE_SHIFT = [0, -256];') && rt.includes('const SORATAN_DRAW_ORDER = [2, 1];'), 'placement and draw order');
assert.ok(rt.includes("{ text: 'Size', submenu: SORATAN_SIZES.map(size) },\n                { separator: true },\n                { text: 'Hide', action: 'soratan-hide' },"), 'MENU 131 order');
assert.ok(rt.includes('const SORATAN_DRAG_IN_MS = 640;') && rt.includes('const SORATAN_DRAG_OUT_MS = 5760;') && rt.includes('const SORATAN_AUTO_HIDE_MS = 2560;'), 'exe timings');
assert.ok(rt.includes('app.overlay().appendChild(root);') && rt.includes('app.tray({') && rt.includes('soraTan.app.exit();'), 'overlay, tray and Exit through the app context');
assert.ok(!/<style|\.css['"]/.test(rt), 'no package stylesheet (cssPolicy locked)');
// client parses
vm.runInNewContext(rt, { melatonApps: { define: (id, fn) => { assert.strictEqual(id, 'soratan'); assert.strictEqual(typeof fn, 'function'); } } });

// ---- Explorer: SoraTan.exe goes to the app, not a download
const progs = read('public/scripts/comp/vfsPrograms.js');
assert.ok(progs.includes('root.melatonApps.openerFor(item.name, itemSize(item))') && progs.includes('archiveFileId: item.archiveFileId'), 'loose and archive files ask the opener');
assert.ok(!progs.includes('999424') && !progs.includes('openSoraTan'), 'no SoraTan special case left in Explorer');

// ---- the decoder (server half) on the real file, when it is here
const sora = path.join(os.homedir(), '.cache/gadget-review/src/soratan/nanami.sora');
if (fs.existsSync(sora)) {
    const { decodeSora } = require('../apps/soratan/server/decoder');
    const { scene, png } = decodeSora(fs.readFileSync(sora));
    assert.strictEqual(scene.source.md5, 'd67bdebdb4e869ffd81fd57a031fdb73');
    assert.deepStrictEqual(scene.meshes.map((m) => [m.name, m.verts, m.faces.length, m.frames.length]), [['nanami', 48, 35, 11], ['口', 6, 2, 79], ['本体', 66, 50, 199]]);
    assert.deepStrictEqual(scene.meshes.map((m) => m.offset), [[72.93, -1.56], [-158.31, 327.85], [94.04, 245.63]]);
    assert.deepStrictEqual(scene.node.scale, [1.073223, 1.073223, 1]);
    assert.deepStrictEqual(scene.clips.map((c) => c.name), ['Startup', 'Anime1', 'Anime2', 'DragL', 'DragR', 'A', 'E', 'I', 'O', 'U', '-', 'test mouth', 'M']);
    assert.strictEqual(png.length, 228603);
} else {
    console.log('(nanami.sora not on this machine: decoder check skipped)');
}

for (const f of ['apps/soratan/client/soratan.js', 'apps/soratan/server/main.js', 'apps/soratan/server/decoder.js', 'public/scripts/comp/vfsPrograms.js']) {
    assert.ok(!/[–—‘’“”…×− ]/.test(read(f)), `${f}: keyboard characters only`);
}
console.log('test-soratan: ok');
