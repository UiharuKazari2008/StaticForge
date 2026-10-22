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
assert.ok(read('public/scripts/comp/featureLoader.js').includes("'scripts/comp/grimoireRemoteBrowser.js', 'scripts/comp/grimoireIeChrome.js', 'scripts/comp/grimoireTabs.js', 'scripts/comp/tagWikiSearchModal.js'"), 'loads before the window');
assert.ok(read('public/scripts/comp/tagWikiSearchModal.js').includes('this.ieChrome = new GrimoireIeChrome(this)'), 'the window builds it');
const css = read('public/css/vista-explorer.css');
for (const sel of ['.grimoire-travel', '.grimoire-ie-seg', '.grimoire-ie-search', '.grimoire-ie-tabrow', '.grimoire-ie-tab', '.grimoire-ie-newtab', '.grimoire-ie-commands', '.grimoire-ie-status']) {
    assert.ok(css.includes(sel), sel + ' is styled');
}
assert.ok(/(#tagWikiSearchModal \.modal-window-title-toolbar \.grimoire-travel) \{[^}]*height: 27px;[^}]*align-items: flex-start;[^}]*background: url\('\/static_images\/vista-explorer\/travel-gutter\.png'\) no-repeat 0 0;/.test(css), 'the orbs sit in Explorer\'s gutter, the band the orbs\' height');
assert.ok(/\.grimoire-ie-commands > #grimoireAddressSiteBtn \{\s*display: inline-flex;/.test(css), 'Tools shows on Grimoire pages too');
for (const f of ['favorites.png', 'favorites-add.png', 'home.png', 'page-ie.png', 'refresh.png', 'stop.png', 'drop.png', 'search.png', 'tools.png', 'zone-internet.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-ie', f)), f);
}

// #453: Home ▾, Feeds ▾, Print ▾, Search ▾ and the status bar zoom
const saved = [];
c.searchInput = { placeholder: '', setAttribute() {} };
c.saveSetting = (patch) => saved.push(patch);
c.applySettings({ homePage: '', searchProvider: 'e621' });
assert.strictEqual(c.provider().id, 'e621', 'the saved provider searches');
assert.strictEqual(c.searchInput.placeholder, 'e621 Wiki', 'the box names its provider like IE7');
assert.deepStrictEqual(c.searchItems().filter((i) => i.checked).map((i) => i.providerId), ['e621']);
c.applySettings({});
assert.strictEqual(c.provider().id, 'grimoire', 'no setting: Grimoire Search');
assert.strictEqual(c.provider().url('a b'), 'edtx://en.grimoire.jp/search?q=a%20b');
c.onMenuAction('search-provider', { providerId: 'web' });
assert.deepStrictEqual(saved.pop(), { searchProvider: 'web' });
let home = c.homeItems();
assert.strictEqual(home[0].checked, true, 'no home page set: the Grimoire home is checked');
assert.strictEqual(home.find((i) => i.action === 'home-remove').disabled, true);
c.homePage = 'https://example.org/';
home = c.homeItems();
assert.strictEqual(home.filter((i) => i.checked).length, 1);
assert.strictEqual(home.find((i) => i.checked).homeUrl, 'https://example.org/', 'the chosen home page is checked');
c.onMenuAction('home-remove');
assert.deepStrictEqual(saved.pop(), { homePage: '' });
assert.strictEqual(c.feedItems()[0].disabled, true, 'no feeds: a disabled line');
host._grimoireIeFeeds = [{ href: 'https://example.org/rss', title: 'News' }];
assert.strictEqual(c.feedItems()[0].feedUrl, 'https://example.org/rss');
assert.strictEqual(c.zoomOf(host), 100);
const zoomed = [];
c.applyZoom = (shell) => zoomed.push(shell._grimoireIeZoom);
c.sync = () => {};
c.onMenuAction('zoom-in');
c.onMenuAction('zoom', { zoomLevel: 200 });
c.onMenuAction('zoom-out');
assert.deepStrictEqual(zoomed, [110, 200, 175], 'zoom steps like IE7 and stays per pane');
assert.ok(c.zoomItems().find((i) => i.zoomLevel === 175) === undefined && c.zoomItems().every((i) => !i.checked), '175% is a step, not a level');

const bridge = require('../modules/grimoireBrowserBridge.js');
const norm = bridge.normalizeAlchemySettings({ homePage: 'javascript:alert(1)', searchProvider: 'nope' });
assert.strictEqual(norm.homePage, '', 'only web and Grimoire pages can be home');
assert.strictEqual(norm.searchProvider, 'grimoire');
assert.strictEqual(bridge.normalizeAlchemySettings({ homePage: 'edtx://en.grimoire.jp/index.dtxt', searchProvider: 'danbooru' }).homePage, 'edtx://en.grimoire.jp/index.dtxt');

const service = read('services/grimoire-browser/server.js');
assert.ok(/msg\.type === 'zoom'/.test(service) && /deviceScaleFactor: zoom/.test(service), 'Alchemy zooms like Chrome');
assert.ok(/msg\.type === 'print'/.test(service) && /captureBeyondViewport: true/.test(service), 'Alchemy prints the whole page');
assert.ok(/broadcast\(session, \{ type: 'feeds', feeds \}\)/.test(service), 'Alchemy reports feeds');
const viewer = read('services/grimoire-browser/viewer.html');
for (const t of ["'grimoire-browser-zoom'", "'grimoire-browser-print'", "type: 'grimoire-browser-feeds'"]) assert.ok(viewer.includes(t), 'viewer relays ' + t);

// the tab row is the band right under the client edge (VM): no line of its own on top
assert.ok(/#tagWikiSearchModal \.grimoire-ie-tabrow \{\s*height: 31px;\s*margin-top: 0;\s*margin-bottom: 5px;\s*border-top: 0;/.test(css), 'no strip above the tab row');
for (const sel of ['.grimoire-ie-split', '.grimoire-ie-split-drop', '.grimoire-ie-search-drop', '.grimoire-ie-status-zoom', '#grimoireIePrintHost', '--grimoire-ie-zoom']) {
    assert.ok(css.includes(sel), sel + ' is styled');
}
// IE7's Recent Pages ▾ (ieframe TRAVEL_BACKGROUND), not Explorer's; and IE7's zones
assert.ok(/\.grimoire-recent-pages-btn \{[^}]*width: 20px;[^}]*height: 29px;[^}]*background: url\('\/static_images\/vista-ie\/recent-pages\.png'\)/.test(css), 'Recent Pages ▾ is IE7\'s art');
const chromeSrc = read('public/scripts/comp/grimoireIeChrome.js');
assert.ok(chromeSrc.includes("'Internet | Protected Mode: On' : 'Local intranet | Protected Mode: Off'"), 'Alchemy is the Internet, the Grimoire the local intranet');
for (const f of ['feeds.png', 'print.png', 'zoom.png', 'recent-pages.png', 'zone-intranet.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-ie', f)), f);
}

console.log('test-grimoire-ie-chrome: ok');
