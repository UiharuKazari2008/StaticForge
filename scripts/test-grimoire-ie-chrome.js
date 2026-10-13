#!/usr/bin/env node
// Grimoire / Alchemy as Internet Explorer 7 (Yozora #448): the chrome's Recent Pages and address
// menus walk the active pane's history, Favorites are the Alchemy bookmarks, Stop follows the
// load state, and the markup hooks / CSS / art are in place.
// Run: node scripts/test-grimoire-ie-chrome.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const Chrome = require('../public/scripts/comp/grimoireIeChrome.js');

const jumps = [];
const pane = {
    history: [{ type: 'home' }, { type: 'wiki', tag: { name: 'impressionism' } }, { type: 'web', url: 'https://www.bing.com/', title: 'Bing' }, { type: 'wiki', tag: { name: 'impressionism' } }],
    historyIndex: 2,
    getHistoryEntryDisplayText: (e) => (e.type === 'home' ? 'Grimoire' : e.type === 'web' ? e.title : e.tag.name),
    getHistoryEntryMenuIcon: () => 'fas fa-file-alt',
    goToHistoryIndex: (i) => jumps.push(i)
};
const attrs = new Set();
const host = { activePane: pane, addressBar: { classList: { contains: (c) => attrs.has(c) }, hasAttribute: (a) => attrs.has(a) } };
const c = Object.create(Chrome.prototype);
c.host = host;
c.bookmarks = [];

assert.strictEqual(c.shell(), pane, 'menus speak for the active split pane');
const recent = c.recentPagesItems();
assert.deepStrictEqual(recent.map((i) => i.action), ['h:3', 'h:2', 'h:1', 'h:0'], 'forward on top, back below');
assert.strictEqual(recent.find((i) => i.checked).text, 'Bing', 'the current page is checked');
assert.deepStrictEqual(c.visitedItems().map((i) => i.text), ['impressionism', 'Bing', 'Grimoire'], 'each page once, newest first');
c.onMenuAction('h:0');
assert.deepStrictEqual(jumps, [0], 'a menu entry jumps the pane through its history');
assert.strictEqual(c.favoriteItems()[0].disabled, true, 'no bookmarks: a disabled line');
c.bookmarks = [{ url: 'https://a.example/', title: 'A' }];
assert.strictEqual(c.favoriteItems()[0].bookmarkUrl, 'https://a.example/');
assert.strictEqual(c.isLoading(), false);
attrs.add('data-alchemy-loading');
assert.strictEqual(c.isLoading(), true, 'the Alchemy load fill counts as loading');
host.activePane = host;
assert.strictEqual(c.shell(), host, 'no split: the window itself');

// wiring
assert.ok(read('public/scripts/comp/featureLoader.js').includes("'scripts/comp/grimoireRemoteBrowser.js', 'scripts/comp/grimoireIeChrome.js', 'scripts/comp/tagWikiSearchModal.js'"), 'loads before the window');
assert.ok(read('public/scripts/comp/tagWikiSearchModal.js').includes('this.ieChrome = new GrimoireIeChrome(this)'), 'the window builds it');
const css = read('public/css/vista-explorer.css');
for (const sel of ['.grimoire-travel', '.grimoire-ie-seg', '.grimoire-ie-search', '.grimoire-ie-tabrow', '.grimoire-ie-tab', '.grimoire-ie-newtab', '.grimoire-ie-commands', '.grimoire-ie-status']) {
    assert.ok(css.includes(sel), sel + ' is styled');
}
assert.ok(/(#tagWikiSearchModal \.modal-window-title-toolbar \.grimoire-travel) \{[^}]*height: 27px;[^}]*align-items: flex-start;[^}]*background: url\('\/static_images\/vista-explorer\/travel-gutter\.svg'\) no-repeat 0 0;/.test(css), 'the orbs sit in Explorer\'s gutter, the band the orbs\' height');
assert.ok(/\.grimoire-ie-commands > #grimoireAddressSiteBtn \{\s*display: inline-flex;/.test(css), 'Tools shows on Grimoire pages too');
for (const f of ['favorites.png', 'favorites-add.png', 'home.png', 'page-ie.png', 'refresh.png', 'stop.png', 'drop.png', 'search.png', 'tools.png', 'zone-internet.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-ie', f)), f);
}

console.log('test-grimoire-ie-chrome: ok');
