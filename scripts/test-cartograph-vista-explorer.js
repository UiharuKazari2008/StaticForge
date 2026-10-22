#!/usr/bin/env node
// Cartograph as Vista's Windows Explorer (Yozora #449): the chrome's Recent Pages and address
// box menus walk the applet's history, Details names types and dates the way Vista does, the
// grid scrolls by Vista's 19px rows, and the markup / CSS carry the pieces.
// Run: node scripts/test-cartograph-vista-explorer.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
require('../public/scripts/comp/explorerVistaChrome.js');
const Chrome = globalThis.ExplorerVistaChrome;

function chromeFor(app) {
    const c = Object.create(Chrome.prototype);
    c.app = app;
    c.labels = new Map([['/', 'Cartograph'], ['/Workspaces/default', 'Default']]);
    return c;
}

// history menus
const moves = [];
const app = {
    history: ['/', '/Workspaces', '/Workspaces/default', '/Workspaces', '/Workspaces/default/Pictures'],
    historyIndex: 3,
    currentPath: '/Workspaces',
    _loading: false,
    isFolderItem: (i) => i.kind === 'folder' || i.targetKind === 'system-folder',
    _fallbackTypeLabel: () => 'File',
    _applyViewModeForPath: (p) => moves.push(['view', p]),
    updateLocationLabels: () => moves.push(['labels']),
    _beginNavigation: () => 7,
    refresh: (t) => { moves.push(['refresh', t]); return Promise.resolve(); },
    _endNavigation: () => {}
};
const c = chromeFor(app);
const recent = c.recentPagesItems();
assert.deepStrictEqual(recent.map((i) => i.action), ['h:4', 'h:3', 'h:2', 'h:1', 'h:0'], 'Recent Pages: forward on top, back below');
assert.strictEqual(recent.find((i) => i.checked).action, 'h:3', 'the current page is the checked one');
assert.strictEqual(recent[0].text, 'Pictures', 'pages without a crumb label read their last segment');
assert.strictEqual(recent[2].text, 'Default', 'crumb labels name the pages');
assert.deepStrictEqual(c.visitedItems().map((i) => i.action), ['p:/Workspaces/default/Pictures', 'p:/Workspaces', 'p:/Workspaces/default', 'p:/'], 'the address box lists each place once, newest first');

c.goToHistory(1);
assert.strictEqual(app.historyIndex, 1);
assert.strictEqual(app.currentPath, '/Workspaces');
assert.deepStrictEqual(moves.map((m) => m[0]), ['view', 'labels', 'refresh'], 'a jump navigates like Back');
c.goToHistory(1);
c.goToHistory(99);
assert.strictEqual(moves.length, 3, 'the current page and out-of-range entries do nothing');

// Vista's wording in Details
assert.strictEqual(c.typeLabel({ kind: 'folder', name: 'Notes' }), 'File Folder');
assert.strictEqual(c.typeLabel({ targetKind: 'system-folder', name: 'Desktop', typeLabel: 'System Folder' }), 'System Folder');
assert.strictEqual(c.typeLabel({ name: 'a.png', mimeType: 'image/png', typeLabel: 'VFS Image' }), 'PNG Image', 'Vista names a file by its type, not the server wording');
assert.strictEqual(c.typeLabel({ name: 'photo', mimeType: 'image/jpeg' }), 'JPEG Image');
assert.strictEqual(c.typeLabel({ name: 'x.lnk', shortcutType: 'app' }), 'Shortcut');
assert.strictEqual(c.typeLabel({ name: 'notes.xyz' }), 'XYZ File');
assert.strictEqual(c.typeLabel({ name: 'blob', typeLabel: 'Grimoire Document' }), 'Grimoire Document', 'the server wording when nothing else names it');
assert.ok(/2006/.test(c.formatDate(1162455840)) && /\d:\d{2}/.test(c.formatDate(1162455840)), 'a date and the time');
assert.ok(!/:\d{2}:\d{2}/.test(c.formatDate(1162455840)), 'no seconds');
assert.strictEqual(c.formatDate(0), '');
assert.deepStrictEqual(c.modeMetrics('details'), { rowHeight: 19 });
assert.deepStrictEqual(c.modeMetrics('icons-xl'), { rowHeight: 312, cellWidth: 272 });
assert.deepStrictEqual(c.modeMetrics('icons-lg'), { rowHeight: 152, cellWidth: 112 });
assert.deepStrictEqual(c.modeMetrics('icons-md'), { rowHeight: 104, cellWidth: 96 });
assert.deepStrictEqual(c.modeMetrics('icons-sm'), { rowHeight: 72, cellWidth: 88 });

// the grid takes the host's wording and row pitch
const grid = read('public/scripts/comp/vfsVirtualGrid.js');
assert.ok(grid.includes('this.modeOverrides ? this.modeOverrides(this.viewMode, base)'), 'the grid scrolls by the overridden row height');
assert.ok(grid.includes('this.formatTypeLabel ? this.formatTypeLabel(item)') && grid.includes('this.formatDate ? this.formatDate(ts)'));
const applet = read('public/scripts/comp/explorerApplet.js');
assert.ok(applet.includes('modeOverrides: (viewMode) =>') && applet.includes('pane.dataset.view = this.viewMode'));

// markup and styles
const html = read('public/app.html');
assert.ok(html.includes('id="explorerRecentPagesBtn"') && html.includes('id="explorerAddressDropBtn"'), 'Recent Pages and the address ▾ are there');
const css = read('public/css/vista-explorer.css');
assert.ok(css.includes("url('/static_images/vista-explorer/recent-pages.png')"), 'Recent Pages uses the theme art');
assert.ok(/\.explorer-address-group[^{]*\{[^}]*overflow: visible/.test(css), 'refresh is not clipped');
assert.ok(css.includes('grid-template-columns: 160px 120px 120px 80px 1fr;') && css.includes('padding: 0 0 0 1px;'), 'Vista column widths, 1px in, then the filler');
assert.ok(css.includes('header-item-normal.png") 0 2 0 1 fill / 0 2px 0 1px stretch') && css.includes('header-sort-arrow.png'), "the header is Vista's HEADER art with its sort arrow");
for (const f of ['normal', 'hot', 'pressed', 'sorted', 'sorted-hot', 'sorted-pressed', 'edged', 'edged-hot', 'edged-pressed', 'edged-sorted', 'edged-sorted-hot', 'edged-sorted-pressed']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', `public/static_images/vista-controls/header-item-${f}.png`)), `header-item-${f}`);
}
assert.ok(css.includes('.explorer-view-pane[data-view="details"] .explorer-grid-host'), 'column lines in Details');
assert.ok(/(#explorerModal \.modal-window-title-toolbar \.naxt-nav-group) \{[^}]*height: 27px;[^}]*align-items: flex-start;[^}]*background: url\('\/static_images\/vista-explorer\/travel-gutter\.png'\) no-repeat 0 0;/.test(css), 'the orbs sit in the gutter, the band the orbs\' height (the groove was 3px low)');
assert.ok(/#explorerForwardBtn \{\s*margin-left: -1px;/.test(css), 'orb centres 28px apart');
assert.strictEqual(fs.readFileSync(path.join(ROOT, 'public/static_images/vista-explorer/travel-gutter.png')).readUInt32BE(16), 57, "the gutter is Vista's own 57x27 band (MsMpRes.dll PNG 281)");
for (const f of ['recent-pages.png', 'refresh.png', 'travel-gutter.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-explorer', f)), f);
}

// details pane: the same picture is not rebuilt on a status refresh, and a new picture
// keeps has-preview so the previous photo stays until the next one is decoded
function fakeEl() {
    const classes = new Set();
    const el = { dataset: {}, innerHTML: '' };
    el.classList = {
        contains: (c) => classes.has(c),
        add: (...cs) => cs.forEach((c) => classes.add(c)),
        remove: (...cs) => cs.forEach((c) => classes.delete(c))
    };
    Object.defineProperty(el, 'className', {
        get() { return [...classes].join(' '); },
        set(v) {
            classes.clear();
            String(v || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
        }
    });
    return el;
}
const populates = [];
const details = chromeFor({
    _populateIconBox: (box, item) => populates.push(item.id),
    _itemSizeBytes: () => 1510000,
    _formatStatusSize: () => '1.51 MB',
    isFolderItem: () => false
});
const detailsIcon = fakeEl();
const detailsInfo = fakeEl();
details.el = { detailsIcon, detailsInfo };
const light = { id: 'light', name: 'switch.png', mimeType: 'image/png', previewUrl: '/p/light', modifiedAt: 100 };
const cassette = { id: 'tape', name: 'tape.png', mimeType: 'image/png', previewUrl: '/p/tape', modifiedAt: 100 };
details.renderDetails([light], '');
details.renderDetails([light], 'ignored');
assert.deepStrictEqual(populates, ['light'], 'a status refresh does not reload the details photo');
detailsIcon.classList.add('has-preview');
details.renderDetails([cassette], '');
assert.deepStrictEqual(populates, ['light', 'tape']);
assert.ok(detailsIcon.classList.contains('has-preview'), 'the previous photo stays up while the next one loads');
assert.ok(detailsInfo.innerHTML.includes('tape.png') && detailsInfo.innerHTML.includes('PNG Image'));
details.renderDetails([], '4 items');
assert.strictEqual(detailsIcon.dataset.detailsKey, '');
assert.ok(detailsInfo.innerHTML.includes('4 items'));
details.renderDetails([], '5 items');
assert.ok(detailsInfo.innerHTML.includes('5 items'), 'the summary still updates when the icon is already the folder');
assert.ok(read('public/scripts/comp/explorerApplet.js').includes('_swapVisiblePreview'), 'a loaded details photo is swapped in place');

// live folders (Yukimi 2026-10-13): the server picks every 10th picture of a folder (a workspace's
// latest generations when its desktop has none); the client stands them between Vista's folder
// back (imageres 4) and front flap (imageres 5) at the medium size and up
const vfs = fs.readFileSync(path.join(__dirname, '..', 'modules/vfsManager.js'), 'utf8');
assert.ok(vfs.includes('_pickSpacedPreviews(previews, count = 2, stride = 10)') && vfs.includes('async _workspaceFolderPreviews(workspaceId)'), 'server previews');
assert.ok((vfs.match(/previews: this\._pickSpacedPreviews\(this\._shortcutPreviews\(/g) || []).length === 2 && vfs.includes('previews: workspacePreviews[id] || []'), 'folders and workspaces carry previews');
assert.ok(fs.readFileSync(path.join(__dirname, '..', 'modules/metadataDatabase.js'), 'utf8').includes('async function listWorkspaceLatestFilenames('), 'latest generations query');
const ex = fs.readFileSync(path.join(__dirname, '..', 'public/scripts/comp/explorerApplet.js'), 'utf8');
assert.ok(ex.includes('_mountLiveFolder(box, icon, previews)') && ex.includes("explorer-item-icon-box-sm") && ex.includes("@lq.webp"), 'client live folder');
const liveCss = fs.readFileSync(path.join(__dirname, '..', 'public/css/vista-explorer.css'), 'utf8');
assert.ok(liveCss.includes('.explorer-item-type-icon.explorer-live-folder:is(') && liveCss.includes("url('/static_images/vista-icons/explorer/folder-back-96.png')") && liveCss.includes("url('/static_images/vista-icons/explorer/folder-front-96.png')") && liveCss.includes('folder-front-48.png') && liveCss.includes('folder-front-256.png'), 'live folder uses the extract that matches the box');
assert.ok(liveCss.includes("--ex-icon-lg: url('/static_images/vista-icons/explorer/folder-96.png')") && !liveCss.includes("256.png') 2x"), 'large is the 96 extract and hidpi does not swap in the 256');
for (const n of ['folder-back-256', 'folder-back-96', 'folder-back-48', 'folder-front-256', 'folder-front-96', 'folder-front-48', 'folder-96', 'folder-48', 'folder-16']) assert.ok(fs.existsSync(path.join(__dirname, '..', `public/static_images/vista-icons/explorer/${n}.png`)), n);
// Computer (2026-10-22): the trail starts at Computer, C: (Local Disk) is the Cartograph root, sizes
// as Vista prints them, the address box's parts stay laid over it, the command bar has Vista's icons
require('../public/scripts/comp/explorerComputerView.js');
const Computer = globalThis.ExplorerComputerView;
const { parseSize, formatSize, diskFacts, hostFacts } = Computer._test;
assert.strictEqual(Computer.PATH, 'Computer');
assert.strictEqual(Computer.ROOT_NAME, 'Local Disk (C:)', 'Vista names the system drive Local Disk');
assert.ok(Computer.isPath('Computer') && !Computer.isPath('/Computer') && !Computer.isPath('/'), 'Computer is outside the VFS paths');
assert.ok(Computer.matchesInput(' computer ') && !Computer.matchesInput('/Computer'), 'typing Computer goes there');
assert.strictEqual(parseSize('63.90 GB'), Math.round(63.9 * 1024 ** 3));
assert.strictEqual(parseSize('N/A'), 0);
assert.strictEqual(formatSize(38.1 * 1024 ** 3 + 5e7), '38.1 GB', 'three digits, truncated');
assert.strictEqual(formatSize(932.4 * 1024 ** 3), '932 GB');
assert.strictEqual(formatSize(1.815 * 1024 ** 4), '1.81 TB');
const disk = diskFacts({ disk: { total: '63.90 GB', free: '38.10 GB', used: '25.80 GB' } });
assert.ok(Math.abs(disk.usedFraction - 25.8 / 63.9) < 0.001 && !disk.full, 'an older server: the bar from the text sizes');
assert.strictEqual(diskFacts({ disk: { totalBytes: 1000, freeBytes: 50, fileSystem: 'ext4' } }).full, true, 'red under 10% free');
assert.strictEqual(diskFacts({ disk: { totalBytes: 1000, freeBytes: 50, fileSystem: 'ext4' } }).fileSystem, 'ext4');
assert.strictEqual(diskFacts({ disk: { total: 'N/A' } }), null);
assert.deepStrictEqual(hostFacts({ host: { hostname: 'ruiko', cpuModel: 'AMD Ryzen 7', totalMemBytes: 4 * 1024 ** 3 } }), { name: 'RUIKO', processor: 'AMD Ryzen 7', memory: '4.00 GB' });

function crumbHost() {
    return { innerHTML: '', clientWidth: 0, scrollWidth: 0, querySelector: () => null };
}
const trailApp = { currentPath: '/Workspaces/default', computer: {} };
const trail = chromeFor(trailApp);
trail.el = { breadcrumb: crumbHost() };
trail.highlightFavorite = () => {};
trail.renderBreadcrumb('/Workspaces/Default');
assert.deepStrictEqual(trail.crumbs.map((x) => x.label), ['Computer', 'Local Disk (C:)', 'Workspaces', 'Default']);
assert.deepStrictEqual(trail.crumbs.map((x) => x.path), ['Computer', '/', '/Workspaces', '/Workspaces/default']);
assert.ok(trail.el.breadcrumb.innerHTML.includes('crumb-folder.png') && !trail.el.breadcrumb.innerHTML.includes('explorer-crumb-overflow'), 'a hidden box shows every crumb');
trailApp.currentPath = '/';
trail.renderBreadcrumb('/');
assert.ok(trail.el.breadcrumb.innerHTML.includes('drive-system-16.png'), 'the drive shows its own icon');
trailApp.currentPath = 'Computer';
trail.renderBreadcrumb('Computer');
assert.deepStrictEqual(trail.crumbs.map((x) => x.label), ['Computer']);
assert.ok(trail.el.breadcrumb.innerHTML.includes('computer-16.png'));
// folding: a box that fits two crumbs' worth
const narrow = crumbHost();
narrow.clientWidth = 100;
Object.defineProperty(narrow, 'scrollWidth', { get() { return (narrow.innerHTML.match(/class="explorer-crumb"/g) || []).length * 60; } });
trail.el.breadcrumb = narrow;
trailApp.currentPath = '/Workspaces/default';
trail.renderBreadcrumb('/Workspaces/Default');
assert.strictEqual(trail.foldedCrumbs, 3, 'crumbs fold from the left until the rest fits');
assert.ok(narrow.innerHTML.includes('explorer-crumb-overflow') && narrow.innerHTML.includes('>Default<') && !narrow.innerHTML.includes('>Computer<'));

const css2 = read('public/css/vista-explorer.css');
assert.ok(/\.explorer-address-group > #explorerBreadcrumb \{\s*position: absolute;\s*z-index: 2;/.test(css2), 'the crumbs stay laid over the box (not a flow item cut to half its width)');
assert.ok(/\.explorer-address-group > :is\(#explorerRefreshBtn, #explorerAddressDropBtn\) \{\s*position: absolute;/.test(css2), 'the ▾ keeps its place left of refresh');
assert.ok(css2.includes('.explorer-computer-tile.is-selected') && css2.includes('drive-bar-track.png') && css2.includes('drive-bar-fill.png') && css2.includes('drive-bar-fill-error.png'), "the drive bar is Vista's track and fill");
assert.ok(/\.explorer-drive-bar-fill \{\s*left: -1px;\s*top: -1px;\s*bottom: -1px;\s*width: calc\(var\(--used, 0\) \* \(100% \+ 2px\)\);/.test(css2), 'the fill spans the whole bar, frame included');
assert.ok(css2.includes('#explorerModal.explorer-in-computer .explorer-details-header {\n    grid-template-columns: 80px 80px 80px 85px 1fr;'), "Computer's column widths");
assert.ok(/\.explorer-computer-group-head \{[^}]*gap: 0;[^}]*margin: 2px 9px 0 13px;/.test(css2) && css2.includes('.explorer-computer-group-toggle {'), 'the heading rule runs to the chevron');
const exCss = read('public/css/explorer.css');
assert.ok(exCss.includes('#explorerModal.explorer-in-computer #explorerGridHost {') && !exCss.includes(':is(#explorerGridHost, #explorerDetailsHeader)'), 'Computer keeps the column headers');
assert.ok(read('public/scripts/comp/explorerComputerView.js').includes("{ label: 'Free Space' }") && read('public/scripts/comp/explorerComputerView.js').includes('style="--used:'), "Computer's columns, the bar's used fraction");
for (const f of ['drive-bar-track', 'drive-bar-fill', 'drive-bar-fill-error']) {
    assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-controls/${f}.png`)), f);
}
const html2 = read('public/app.html');
for (const name of ['upload', 'download', 'replace', 'system-properties', 'control-panel']) {
    assert.ok(html2.includes(`/static_images/vista-cmdbar/${name}.png`), `${name} has Vista's icon`);
    assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-cmdbar/${name}.png`)), `${name}.png`);
}
for (const f of ['computer-16', 'computer-64', 'drive-system-16', 'drive-system-48', 'drive-system-64']) {
    assert.ok(fs.existsSync(path.join(ROOT, `public/static_images/vista-explorer/${f}.png`)), f);
}
// explorerArchive.js (7-Zip) may sit between fileOperationProgress.js and the applet
assert.ok(/'scripts\/comp\/explorerComputerView\.js', 'scripts\/comp\/fileOperationProgress\.js', (?:'[^']+', )*'scripts\/comp\/explorerApplet\.js'/.test(read('public/scripts/comp/featureLoader.js')), 'loaded before the applet');
assert.ok(read('public/scripts/comp/desktopShortcuts.js').includes("openExplorerApplet('Computer')"), "the desktop's Computer opens Computer");
const gr = read('modules/globalResources.js');
assert.ok(gr.includes('diskInfo.totalBytes = totalBytes;') && gr.includes('diskInfo.fileSystem = STATFS_TYPE_NAMES[stats.type] || null;'), 'the server sends the disk in bytes');

console.log('test-cartograph-vista-explorer: ok');
