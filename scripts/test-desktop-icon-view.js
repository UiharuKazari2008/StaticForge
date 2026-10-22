#!/usr/bin/env node
// Vista's desktop icon view (Yukimi 2026-10-21): icon sizes and Ctrl + wheel steps, the cell pitch,
// Auto Arrange / Align to Grid placement and drops, Sort By, the label's two lines, the desktop
// menu, Desktop Icon Settings and Change Icon (desktopIconView.js, desktopIconDialogs.js,
// desktopShortcuts.js), and the workspace field that stores the view (modules/workspace.js).
// Every figure below was read on the Vista Aero VM (1920x1200, taskbar 30 px) with LVM_GETITEMRECT.
// Run: node scripts/test-desktop-icon-view.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const V = require('../public/scripts/comp/desktopIconView.js');

// ---- sizes ----------------------------------------------------------------------------------
assert.deepStrictEqual(V.SIZES, { large: 96, medium: 48, classic: 32 });
assert.strictEqual(V.normalize({}).size, 48, 'Medium Icons is the default');
assert.strictEqual(V.normalize({}).alignToGrid, true, 'Align to Grid is on by default');
assert.strictEqual(V.normalize({}).autoArrange, false);
assert.strictEqual(V.normalize({ size: 999 }).size, 256);
assert.strictEqual(V.normalize({ size: 3 }).size, 16);

// Ctrl + wheel: up round(s / 0.9), down round(s * 0.9) (the VM's ladders from 16 and from 48 / 256)
const up = [16];
while (up[up.length - 1] < 256) up.push(V.stepSize(up[up.length - 1], true));
assert.deepStrictEqual(up, [16, 18, 20, 22, 24, 27, 30, 33, 37, 41, 46, 51, 57, 63, 70, 78, 87, 97, 108, 120, 133, 148, 164, 182, 202, 224, 249, 256]);
const fromMedium = [48];
for (let i = 0; i < 15; i++) fromMedium.push(V.stepSize(fromMedium[fromMedium.length - 1], true));
assert.deepStrictEqual(fromMedium, [48, 53, 59, 66, 73, 81, 90, 100, 111, 123, 137, 152, 169, 188, 209, 232]);
const down = [256];
for (let i = 0; i < 22; i++) down.push(V.stepSize(down[down.length - 1], false));
assert.deepStrictEqual(down.slice(0, 23), [256, 230, 207, 186, 167, 150, 135, 122, 110, 99, 89, 80, 72, 65, 59, 53, 48, 43, 39, 35, 32, 29, 26]);
// the View menu's radio for in-between sizes (53 / 81 Medium, 43 / 35 Classic, 135 Large)
assert.strictEqual(V.sizeName(53), 'medium');
assert.strictEqual(V.sizeName(81), 'medium');
assert.strictEqual(V.sizeName(43), 'classic');
assert.strictEqual(V.sizeName(35), 'classic');
assert.strictEqual(V.sizeName(135), 'large');

// ---- cells: n = floor(W / min), cell = floor(W / n) ---------------------------------------------
// [size, cx, cy] on the VM's 1920 x 1170 work area
const PITCH = [
    [16, 76, 65], [18, 76, 68], [20, 76, 73], [24, 76, 73], [27, 76, 78], [30, 76, 83], [32, 76, 83], [33, 76, 83],
    [37, 76, 90], [41, 76, 97], [46, 76, 97], [48, 76, 106], [51, 76, 106], [57, 76, 117], [63, 76, 117],
    [70, 80, 130], [78, 87, 130], [87, 96, 146], [96, 106, 167], [97, 106, 167], [108, 120, 167], [120, 137, 195],
    [133, 147, 195], [148, 160, 234], [164, 192, 234], [182, 213, 292], [202, 240, 292], [224, 240, 292],
    [249, 274, 390], [256, 274, 390],
    // the first pass up from 48 (item widths)
    [73, 83, null], [81, 91, null], [100, 112, null], [111, 128, null], [137, 160, null], [152, 174, null], [169, 192, null], [188, 213, null], [209, 240, null], [232, 274, null]
];
PITCH.forEach(([s, cx, cy]) => {
    const m = V.metrics(s, 1920, 1170);
    assert.strictEqual(m.cx, cx, `cell width at ${s}`);
    if (cy != null) assert.strictEqual(m.cy, cy, `cell height at ${s}`);
});
const med = V.metrics(48, 1920, 1170);
assert.strictEqual(med.iconBox, 52, 'Medium: the icon box is 52 high (label at 53)');
assert.strictEqual(med.labelWidth, 70, 'labels wrap at the item width less 6');
assert.strictEqual(V.metrics(96, 1920, 1170).iconBox, 100);
assert.strictEqual(V.metrics(32, 1920, 1170).iconBox, 36);

// ---- layout ---------------------------------------------------------------------------------
const m = V.metrics(48, 760, 530); // 10 columns x 5 rows of 76 x 106
assert.strictEqual(m.cols, 10);
assert.strictEqual(m.rows, 5);
const list = (n) => Array.from({ length: n }, (_, i) => ({ id: `s${i}`, position: { index: 0, pos: i } }));

// Auto Arrange: columns top to bottom
let out = V.layout(list(7), { autoArrange: true, alignToGrid: true }, m);
assert.deepStrictEqual(out.order, ['s0', 's1', 's2', 's3', 's4', 's5', 's6']);
assert.deepStrictEqual(out.places.get('s5'), { x: 76, y: 0, col: 1, row: 0 });

// Align to Grid: a placed icon snaps to its nearest cell, a second one on the same cell moves to the next free one
out = V.layout([
    { id: 'a', position: { index: 'free', x: 300, y: 220, w: 760, h: 530 } },
    { id: 'b', position: { index: 'free', x: 310, y: 215, w: 760, h: 530 } },
    { id: 'c', position: { index: 0, pos: 0 } }
], { autoArrange: false, alignToGrid: true }, m);
assert.deepStrictEqual(out.places.get('a'), { x: 304, y: 212, col: 4, row: 2 });
assert.notDeepStrictEqual([out.places.get('b').col, out.places.get('b').row], [4, 2], 'no two icons share a cell');
assert.deepStrictEqual(out.places.get('c'), { x: 0, y: 0, col: 0, row: 0 }, 'unplaced icons fill the first free cell');

// Align to Grid off: the icon stays where it was dropped
out = V.layout([{ id: 'a', position: { index: 'free', x: 301, y: 222, w: 760, h: 530 } }], { autoArrange: false, alignToGrid: false }, m);
assert.deepStrictEqual([out.places.get('a').x, out.places.get('a').y], [301, 222]);
// a work area of another size scales a placed icon with it
out = V.layout([{ id: 'a', position: { index: 'free', x: 608, y: 0, w: 1520, h: 530 } }], { autoArrange: false, alignToGrid: true }, m);
assert.strictEqual(out.places.get('a').col, 4, 'an icon placed at the middle of a wider desktop stays in the middle');

// Auto Arrange drop: the insertion point is the cell under the pointer (the VM's mark at the cell top)
const ins = V.insertionAt(m, 30, 330, 7);
assert.deepStrictEqual(ins, { index: 3, x: 0, y: 318, width: 76 });
assert.strictEqual(V.insertionAt(m, 700, 500, 7).index, 7, 'past the last icon inserts at the end');

// ---- Sort By --------------------------------------------------------------------------------
assert.deepStrictEqual(V.nextSort({ sortBy: 'name', sortDir: 'asc' }, 'name'), { sortBy: 'name', sortDir: 'desc' }, 'the same field reverses');
assert.deepStrictEqual(V.nextSort({ sortBy: 'name', sortDir: 'asc' }, 'size'), { sortBy: 'size', sortDir: 'desc' }, 'Size starts largest first');
assert.deepStrictEqual(V.nextSort({ sortBy: 'size', sortDir: 'desc' }, 'type'), { sortBy: 'type', sortDir: 'asc' });
assert.deepStrictEqual(V.nextSort({ sortBy: 'type', sortDir: 'asc' }, 'date'), { sortBy: 'date', sortDir: 'desc' }, 'Date modified starts newest first');
const sc = [
    { id: 'n', name: 'Notes', type: 'note', updatedAt: '2026-10-01' },
    { id: 'w', name: 'Workspaces', type: 'folder' },
    { id: 'r', name: 'Recycle Bin', type: 'system-folder', data: { desktopIcon: 'recycle' } },
    { id: 'c', name: 'Computer', type: 'system-folder', data: { desktopIcon: 'computer' } },
    { id: 'a', name: 'a rather long', type: 'image', updatedAt: '2026-10-20' }
];
assert.deepStrictEqual(V.sortShortcuts(sc, 'name', 'asc').map((s) => s.id), ['c', 'r', 'w', 'a', 'n'], 'system icons, folders, then files');
assert.deepStrictEqual(V.sortShortcuts(sc, 'name', 'desc').map((s) => s.id), ['n', 'a', 'w', 'r', 'c'], 'descending reverses all of it (the VM)');
assert.deepStrictEqual(V.sortShortcuts(sc, 'date', 'desc').map((s) => s.id).slice(0, 2), ['a', 'n'], 'newest first');

// ---- labels: Vista's list view on the VM (GDI Segoe UI 9 pt widths) --------------------------
// Medium (wrap at 70): "A rather long / file name f..." in a 74 px label rect
let lab = V.clampLabel('A rather long file name for the wrapping test', 70, 'x');
assert.deepStrictEqual(lab.lines, ['A rather long', 'file name f...']);
assert.strictEqual(lab.width + 4, 74);
assert.deepStrictEqual(lab.all, ['A rather long', 'file name for', 'the wrapping', 'test']);
// the cut line fits the widest line, not the wrap width: "the carto..." in a 62 px rect
lab = V.clampLabel('Pictures of the cartograph expedition', 70, 'x');
assert.deepStrictEqual(lab.lines, ['Pictures of', 'the carto...']);
assert.strictEqual(lab.width + 4, 62);
// Large (wrap at 100): "A rather long file / name for the ..." (the space stays) in a 92 px rect
lab = V.clampLabel('A rather long file name for the wrapping test', 100, 'x');
assert.deepStrictEqual(lab.lines, ['A rather long file', 'name for the ...']);
assert.strictEqual(lab.width + 4, 92);
// single lines: the label rect is the text + 4 (Recycle Bin 64, Workspaces 67, MAS_AIO 54, Notes 35)
[['Recycle Bin', 64], ['Workspaces', 67], ['MAS_AIO', 54], ['Notes', 35]].forEach(([t, w]) => {
    const l = V.clampLabel(t, 70, 'x');
    assert.strictEqual(l.cut, false);
    assert.strictEqual(l.width + 4, w, t);
});
assert.ok(V.wrapLines('MAS_AIO_without_any_spaces_at_all', 70, 'x').length > 1, 'a word wider than the line breaks between letters');
assert.strictEqual(V.metrics(48, 1920, 1170).labelWidth, 70);
assert.strictEqual(V.metrics(96, 1920, 1170).labelWidth, 100);

// ---- icons ----------------------------------------------------------------------------------
assert.deepStrictEqual(V.normalizeIconRef({ file: 'imageres', index: 103 }), { file: 'imageres', index: 103 });
assert.strictEqual(V.normalizeIconRef({ file: 'imageres', index: 185 }), null, 'imageres has 185 icons');
assert.strictEqual(V.normalizeIconRef({ file: 'evil', index: 1 }), null);
assert.deepStrictEqual(V.normalizeIconRef({ file: 'app', name: 'studio.png' }), { file: 'app', name: 'studio.png' });
assert.strictEqual(V.normalizeIconRef({ file: 'app', name: '../x.png' }), null);
const sp = V.spriteStyle({ file: 'shell32', index: 33 }, 48);
assert.strictEqual(sp.backgroundPosition, '-48px -96px', 'sheets are 16 icons a row');
assert.strictEqual(sp.backgroundSize, '768px 864px');
assert.ok(sp.backgroundImage.includes('/static_images/vista-desktop/shell32-48.webp'));
['imageres', 'shell32', 'NetworkExplorer'].forEach((f) => [16, 32, 48, 96].forEach((s) => {
    assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-desktop/${f}-${s}.webp`)), `${f}-${s} sheet`);
}));
['item-hot', 'item-selected', 'item-selected-nofocus', 'item-hot-selected', 'personalize-16'].forEach((f) => {
    assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-desktop/${f}.png`)), f);
});
// Vista's defaults (CLSID DefaultIcon on the VM)
assert.deepStrictEqual(V.systemSlotDefault('computer'), { file: 'imageres', index: 103 });
assert.deepStrictEqual(V.systemSlotDefault('recycle-full'), { file: 'imageres', index: 48 });
assert.deepStrictEqual(V.systemSlotDefault('network'), { file: 'NetworkExplorer', index: 0 });
assert.deepStrictEqual(V.SYSTEM_ICONS.map((s) => s.key), ['computer', 'user', 'network', 'recycle', 'control-panel']);
assert.deepStrictEqual(V.SYSTEM_ICON_SLOTS.map((s) => s.slot), ['computer', 'user', 'network', 'recycle-full', 'recycle-empty'], 'the list has no Control Panel and two Recycle Bins');

// ---- the desktop menu (Vista's: View, Sort By, Refresh | Paste, Paste Shortcut | New | Personalize)
const menu = V.desktopMenuConfig().sections[0].items;
assert.deepStrictEqual(menu.map((i) => (i.separator ? '-' : i.text)), ['View', 'Sort By', 'Refresh', '-', 'Paste', 'Paste Shortcut', '-', 'New', '-', 'Personalize']);
assert.deepStrictEqual(menu[0].submenu.map((i) => (i.separator ? '-' : i.text)), ['Large Icons', 'Medium Icons', 'Classic Icons', '-', 'Auto Arrange', 'Align to Grid', '-', 'Show Desktop Icons']);
assert.deepStrictEqual(menu[1].submenu.map((i) => i.text), ['Name', 'Size', 'Type', 'Date modified']);
assert.strictEqual(menu[0].submenu[1].indicatorMark, 'radio');
assert.strictEqual(menu[0].submenu[4].indicatorMark, 'check');
assert.ok(menu.every((i) => !i.icon || /desktop-menu-icon/.test(i.icon)), 'no Font Awesome glyphs in Vista\'s menu');

// ---- dialogs --------------------------------------------------------------------------------
global.window = global;
const D = require('../public/scripts/comp/desktopIconDialogs.js');
const page = D._test.desktopPageHtml();
['Co<u>m</u>puter', '<u>U</u>ser\'s Files', '<u>N</u>etwork', '<u>R</u>ecycle Bin', 'C<u>o</u>ntrol Panel', 'C<u>h</u>ange Icon...', 'Re<u>s</u>tore Default'].forEach((t) => assert.ok(page.includes(t), t));
// shell32.dll.mui 29952 on the Tahoma grid: the list at 7,68 238x100 -> 11,111 357x162
assert.ok(page.includes('left:11px;top:111px;width:357px;height:162px;'), 'the icon list sits where Vista\'s does');
const ciHtml = D._test.changeIconHtml();
assert.ok(ciHtml.includes('<u>L</u>ook for icons in this file:') && ciHtml.includes('<u>B</u>rowse...') && ciHtml.includes('<u>S</u>elect an icon from the list below:'));
assert.ok(ciHtml.includes('left:11px;top:76px;width:268px;height:199px;'), 'the list box as measured on the VM');
assert.strictEqual(D._test.fileForPath('C:\\Melaton\\System32\\imageres.dll'), 'imageres');
assert.strictEqual(D._test.fileForPath('%SystemRoot%\\system32\\SHELL32.dll'), 'shell32');
assert.strictEqual(D._test.fileForPath('C:\\nothing.dll'), null);
assert.deepStrictEqual(D._test.systemShortcut('recycle').data.systemKey, 'trash', 'the Recycle Bin is the workspace\'s Trash');

// ---- wiring -----------------------------------------------------------------------------------
const html = read('public/app.html');
assert.ok(html.includes('scripts/comp/desktopIconView.js') && html.includes('/css/desktop-icon-view.css'), 'loaded at boot');
const loader = read('public/scripts/comp/featureLoader.js');
assert.ok(/desktop_icon_dialogs:\s*{[^}]*desktop-icon-dialogs\.css[^}]*desktopIconDialogs\.js/.test(loader), 'the dialogs load on demand');
assert.ok(read('public/scripts/comp/cplPersonalization.js').includes("loadFeature('desktop_icon_dialogs')"), 'Personalize > Change desktop icons opens the dialog');
assert.ok(read('public/scripts/comp/modalUtils.js').includes('desktopIconView.desktopMenuConfig()'), 'the desktop uses Vista\'s menu');
const shortcutsJs = read('public/scripts/comp/desktopShortcuts.js');
['renderVistaIconView', 'computeVistaDrop', 'createDragGhosts', 'updateInsertMark', "'desktop-change-icon'"].forEach((n) => assert.ok(shortcutsJs.includes(n), n));
const css = read('public/css/desktop-icon-view.css');
assert.ok(!/(html|body)[^{,]*:has\(/.test(css), 'no html/body :has() (desktop perf)');
assert.ok(css.includes("item-selected.png') 3 fill / 3px stretch"), 'the theme\'s selection frame');

// ---- the server field -------------------------------------------------------------------------
const W = require('../modules/workspace.js');
const n = W.normalizeWorkspaceDesktopView({ size: 300, autoArrange: true, sortBy: 'x', systemIcons: { computer: { file: 'imageres', index: 5 }, network: { file: 'bad', index: 1 } } });
assert.deepStrictEqual(n, { size: 256, autoArrange: true, alignToGrid: true, showIcons: true, sortBy: 'name', sortDir: 'asc', systemIcons: { computer: { file: 'imageres', index: 5 } } });
assert.ok(read('modules/ws/handlers/90-workspaceHandler.js').includes('desktopView:'), 'the workspace list carries the field');

console.log('desktop icon view: ok');
