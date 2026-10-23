#!/usr/bin/env node
// SoraTan desktop toy (Yozora #633): SoraTan.exe in the VFS starts Nanami (desktop-apps/soraTan.js)
// instead of downloading; her scene is the one scripts/import-soratan.js decoded from nanami.sora.
// Run: node scripts/test-soratan.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- wiring
const loader = read('public/scripts/comp/featureLoader.js');
assert.ok(loader.includes("'scripts/comp/vfsPrograms.js', 'scripts/comp/explorerArchive.js'"), 'vfsPrograms.js loads with Explorer, before the archive code');
assert.ok(loader.includes("soratan: {") && loader.includes("'scripts/comp/desktop-apps/soraTan.js'") && loader.includes("'css/desktop-apps/soraTan.css'"), 'soratan feature');
const explorer = read('public/scripts/comp/explorerApplet.js');
assert.ok(/targetKind === 'user-file'\) \{\s*\/\/[^\n]*\n\s*if \(window\.vfsPrograms && await window\.vfsPrograms\.open\(item\)\) return;/.test(explorer), 'Explorer asks vfsPrograms before opening a user file');
const archive = read('public/scripts/comp/explorerArchive.js');
assert.ok(archive.includes('if (root.vfsPrograms && await root.vfsPrograms.open(item)) return;'), 'archive entries ask vfsPrograms too');
const html = read('public/app.html');
assert.ok(html.includes('id="soraTanTrayIcon"') && html.includes('/static_images/soratan/soratan-16.png'), 'tray icon with the exe clover');
assert.ok(read('public/scripts/comp/trayRegistry.js').includes("{ id: 'soraTanTrayIcon', label: 'SoraTan' }"), 'tray icon is in Taskbar Properties');

// ---- vfsPrograms matches name + size only
const sandbox = { window: {}, console };
sandbox.window.featureLoader = { loadFeature: async (f) => { sandbox.loaded = f; } };
sandbox.window.openSoraTan = async () => { sandbox.started = (sandbox.started || 0) + 1; };
vm.runInNewContext(read('public/scripts/comp/vfsPrograms.js'), sandbox);
const progs = sandbox.window.vfsPrograms;
assert.ok(progs.find({ name: 'SoraTan.exe', size: 999424 }), 'loose SoraTan.exe');
assert.ok(progs.find({ name: 'SoraTan.exe', sizeBytes: 999424, targetKind: 'archive-entry' }), 'SoraTan.exe inside SoraTan.iso');
assert.ok(!progs.find({ name: 'SoraTan.exe', size: 1000 }), 'another build downloads');
assert.ok(!progs.find({ name: 'setup.exe', size: 999424 }), 'another name downloads');
assert.ok(!progs.find({ name: 'SoraTan.exe', size: 999424, kind: 'folder' }), 'a folder of that name is a folder');

(async () => {
    assert.strictEqual(await progs.open({ name: 'SoraTan.exe', size: 999424 }), true);
    assert.strictEqual(sandbox.loaded, 'soratan');
    assert.strictEqual(sandbox.started, 1);
    assert.strictEqual(await progs.open({ name: 'nanami.sora', size: 1383218 }), false);

    // ---- the decoded scene
    const scene = JSON.parse(read('public/static_images/soratan/nanami-scene.json'));
    assert.strictEqual(scene.source.md5, 'd67bdebdb4e869ffd81fd57a031fdb73');
    assert.deepStrictEqual(scene.meshes.map((m) => [m.name, m.verts, m.faces.length, m.frames.length]),
        [['nanami', 48, 35, 11], ['口', 6, 2, 79], ['本体', 66, 50, 199]]);
    for (const m of scene.meshes) {
        for (const f of m.faces) assert.ok(f.every((i) => i < m.verts), `${m.name}: face indexes in range`);
        for (const fr of m.frames) {
            assert.strictEqual(fr.pos.length, m.verts * 2);
            assert.ok(m.uvSets[fr.uv] && m.uvSets[fr.uv].length === m.verts * 2, `${m.name}: frame uv set`);
        }
    }
    assert.deepStrictEqual(scene.meshes[1].shapes.map((s) => s.name), ['口', ':D', 'A', 'E', 'I', 'O', 'U']);
    // placement fitted on the VM: Clip001 mesh positions, Node01 rest scale; the nanami mesh never shows
    assert.deepStrictEqual(scene.meshes.map((m) => m.offset), [[72.93, -1.56], [-158.31, 327.85], [94.04, 245.63]]);
    assert.deepStrictEqual(scene.meshes.map((m) => !!m.hidden), [true, false, false]);
    assert.deepStrictEqual(scene.node.scale, [1.073223, 1.073223, 1]);
    assert.deepStrictEqual(scene.clips.map((c) => c.name), ['Startup', 'Anime1', 'Anime2', 'DragL', 'DragR', 'A', 'E', 'I', 'O', 'U', '-', 'test mouth', 'M']);
    for (const c of scene.clips) {
        c.meshes.forEach((m, mi) => {
            if (m.frame) for (const [t, f] of m.frame.keys) {
                assert.ok(t <= c.duration + 200, `${c.name}: key time within the clip`);
                assert.ok(f < scene.meshes[mi].frames.length, `${c.name}: mesh ${mi} frame ${f} exists`);
            }
            if (m.shape) for (const [, s] of m.shape.keys) assert.ok(s < 7, `${c.name}: mouth shape ${s}`);
        });
    }
    const startup = scene.clips[0];
    assert.strictEqual(startup.duration, 3200);
    assert.deepStrictEqual(startup.node.position.keys[0], [0, [0.119987, -646.26001, 0]], 'Startup rises from below the window');
    assert.ok(fs.statSync(path.join(ROOT, 'public/static_images/soratan/nanami.png')).size === 228603, 'texture');
    for (const s of [16, 32, 48]) assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/soratan/soratan-${s}.png`)), `icon ${s}`);

    // ---- the runtime follows SoraTan.exe
    const rt = read('public/scripts/comp/desktop-apps/soraTan.js');
    assert.ok(rt.includes('const SORATAN_DEFAULT_SIZE = 500;') && rt.includes('const SORATAN_SIZES = [300, 500, 700, 900];'), 'exe sizes, 500 by default');
    assert.ok(rt.includes('const SORATAN_SCENE_SHIFT = [0, -256];') && rt.includes('const SORATAN_DRAW_ORDER = [2, 1];'), 'placement and draw order');
    assert.ok(rt.includes("{ text: 'Size', submenu: SORATAN_SIZES.map(size) },\n                { separator: true },\n                { text: 'Hide', action: 'soratan-hide' },"), 'MENU 131 order: Size, separator, Hide, Auto Hide, separator, Exit');
    assert.ok(rt.includes('const SORATAN_DRAG_IN_MS = 640;') && rt.includes('const SORATAN_DRAG_OUT_MS = 5760;') && rt.includes('const SORATAN_AUTO_HIDE_MS = 2560;'), 'exe timings');
    assert.ok(fs.existsSync(path.join(ROOT, 'docs/soratan.md')), 'format notes');

    // ---- keyboard characters (CJK names stay)
    for (const f of ['public/scripts/comp/desktop-apps/soraTan.js', 'public/scripts/comp/vfsPrograms.js', 'scripts/import-soratan.js', 'public/css/desktop-apps/soraTan.css']) {
        assert.ok(!/[–—‘’“”…×− ]/.test(read(f)), `${f}: keyboard characters only`);
    }
    console.log('test-soratan: ok');
})().catch((e) => { console.error(e); process.exit(1); });
