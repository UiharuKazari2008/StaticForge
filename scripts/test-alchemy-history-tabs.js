// Alchemy / Grimoire (Yozora #628): wiki pages can be bookmarked, the History log and its day groups,
// idle background tabs are suspended (not the active one, not one playing audio), the volume flyout
// takes app sources, the file chooser is wired end to end, and a hidden tab keeps its viewport.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// bookmarks: web and Grimoire pages, nothing else
const { normalizeAlchemySettings } = require('../modules/grimoireBrowserBridge');
const marks = normalizeAlchemySettings({ bookmarks: [
    { url: 'https://example.com/', title: 'Example' },
    { url: 'edtx://wiki.danbooru.jp/tag/blue_hair', title: 'blue hair' },
    { url: 'rdf://docs.novelai.jp/tags', title: 'Docs' },
    { url: 'dsap://history.grimoire.jp', title: 'History' },
    { url: 'javascript:alert(1)', title: 'bad' }
] }).bookmarks.map((b) => b.url);
assert.deepStrictEqual(marks, ['https://example.com/', 'edtx://wiki.danbooru.jp/tag/blue_hair', 'rdf://docs.novelai.jp/tags', 'dsap://history.grimoire.jp']);

// History log (localStorage stand-in)
const store = new Map();
global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
global.window = global;
const log = require('../public/scripts/comp/grimoireHistoryDsap.js');
log.add('https://example.com/a', 'A');
log.add('edtx://wiki.danbooru.jp/tag/blue_hair', 'blue hair');
log.add('https://example.com/a', 'A again');
log.add('dsap://history.grimoire.jp', 'History');
let rows = log.load();
assert.deepStrictEqual(rows.map((r) => r.url), ['https://example.com/a', 'edtx://wiki.danbooru.jp/tag/blue_hair'], 'merged, newest first, History page not recorded');
assert.strictEqual(rows[0].title, 'A again');
assert.strictEqual(rows[0].count, 2);
log.remove('https://example.com/a');
assert.strictEqual(log.load().length, 1);
const now = new Date(2026, 9, 22, 15, 0).getTime();
assert.strictEqual(log._test.groupLabel(now - 3600e3, now), 'Today');
assert.strictEqual(log._test.groupLabel(now - 86400e3, now), 'Yesterday');
assert.strictEqual(log._test.groupLabel(now - 9 * 86400e3, now), 'Last Week');
assert.ok(!log._test.recordable('http://127.0.0.1:9220/app'));
log.clear();
assert.strictEqual(log.load().length, 0);

// tab suspension
const GrimoireTabs = require('../public/scripts/comp/grimoireTabs.js');
assert.strictEqual(GrimoireTabs.suspendAfterMs(), 20 * 60000);
const closed = [];
global.grimoireCloseRemoteBrowser = async (shell) => { closed.push(shell.name); shell._grimoireRemoteSessionId = ''; };
global.grimoireIsAudioShell = (shell) => shell.name === 'music';
const tabs = Object.create(GrimoireTabs.prototype);
const old = Date.now() - 30 * 60000;
tabs.active = { id: 1, state: null };
tabs.tabs = [
    tabs.active,
    { id: 2, lastActive: old, state: { name: 'idle', _grimoireRemoteSessionId: 's2' } },
    { id: 3, lastActive: old, state: { name: 'music', _grimoireRemoteSessionId: 's3' } },
    { id: 4, lastActive: Date.now(), state: { name: 'recent', _grimoireRemoteSessionId: 's4' } }
];
tabs.frameSnapshot = () => 'data:image/jpeg;base64,';
tabs.emit = () => {};
(async () => {
    assert.strictEqual(await tabs.suspendIdle(), 1);
    assert.deepStrictEqual(closed, ['idle']);
    assert.ok(tabs.tabs[1].suspended && tabs.tabs[1].snapshot);
    localStorage.setItem('alchemyTabSuspendMinutes', '0');
    assert.strictEqual(GrimoireTabs.suspendAfterMs(), 0);

    // wiring checks: file chooser end to end, volume sources, viewport kept while hidden
    const server = read('services/grimoire-browser/server.js');
    assert.ok(server.includes("Page.setInterceptFileChooserDialog") && server.includes("DOM.setFileInputFiles") && server.includes("preview.type === 'file-chooser-reply'"));
    const viewer = read('services/grimoire-browser/viewer.html');
    assert.ok(viewer.includes("grimoire-browser-file-chooser") && viewer.includes("file-chooser-reply"));
    assert.ok(viewer.includes('canvas.clientWidth') && viewer.includes("visibilitychange"), 'viewport from layout size, not while hidden');
    const bridge = read('modules/grimoireBrowserBridge.js');
    assert.ok(bridge.includes('/file-chooser/:cid/upload') && bridge.includes('/file-chooser/:cid/vfs'));
    const client = read('public/scripts/comp/grimoireRemoteBrowser.js');
    assert.ok(client.includes("Select on <u>C</u>lient") && client.includes("studioOpenFolderDialog('open-vfs'"));
    assert.ok(client.includes("action: 'history'") && client.includes('registerSource'));
    assert.ok(!read('public/app.html').includes('alchemyAudioTrayIcon'), 'the separate Alchemy audio icon is gone');
    assert.ok(read('public/scripts/comp/tabVolume.js').includes('window.tabVolume = {'));
    assert.ok(read('public/scripts/comp/studioSession.js').includes('function studioSaveFolderDismiss()'));
    console.log('test-alchemy-history-tabs: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
