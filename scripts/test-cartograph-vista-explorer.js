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
assert.strictEqual(c.modeMetrics('icons-lg'), null);

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
assert.ok(css.includes('grid-template-columns: 157px 120px 120px 80px'), 'Vista column widths');
assert.ok(css.includes('.explorer-view-pane[data-view="details"] .explorer-grid-host'), 'column lines in Details');
assert.ok(css.includes("background: url('/static_images/vista-explorer/travel-gutter.svg') no-repeat 0 50%;"), 'the orbs sit in the gutter');
assert.ok(/#explorerForwardBtn \{\s*margin-left: -1px;/.test(css), 'orb centres 28px apart');
assert.ok(read('public/static_images/vista-explorer/travel-gutter.svg').includes('A12.5 12.5 0 1 1'), 'the gutter rings each orb');
for (const f of ['recent-pages.png', 'refresh.png', 'travel-gutter.svg']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-explorer', f)), f);
}

console.log('test-cartograph-vista-explorer: ok');
