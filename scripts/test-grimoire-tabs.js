#!/usr/bin/env node
// Grimoire tabs (Yozora #451): each tab keeps its own display area and page state, a background Alchemy
// frame updates only its tab, the service's session cap is met by the background tab used longest ago,
// and closing works like IE7's. DOM-stub test (no browser).
// Run: node scripts/test-grimoire-tabs.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- a little DOM ----
class El {
    constructor(className, tag) {
        this.tagName = (tag || 'div').toUpperCase();
        this.className = className || '';
        this.children = [];
        this.parentNode = null;
        this.style = { removeProperty(k) { delete this[k]; }, setProperty(k, v) { this[k] = v; } };
        this.attrs = {};
        this.classList = {
            contains: (c) => this.className.split(/\s+/).includes(c),
            toggle: (c, on) => {
                const set = new Set(this.className.split(/\s+/).filter(Boolean));
                if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c);
                this.className = [...set].join(' ');
            }
        };
    }
    get firstElementChild() { return this.children[0] || null; }
    appendChild(node) { if (node.parentNode) node.remove(); node.parentNode = this; this.children.push(node); return node; }
    after(node) {
        const p = this.parentNode;
        if (node.parentNode) node.remove();
        node.parentNode = p;
        p.children.splice(p.children.indexOf(this) + 1, 0, node);
    }
    remove() { if (!this.parentNode) return; const c = this.parentNode.children; c.splice(c.indexOf(this), 1); this.parentNode = null; }
    closest(sel) { const cls = sel.replace(/^\./, ''); let n = this; while (n) { if (n.classList.contains(cls)) return n; n = n.parentNode; } return null; }
    querySelector(sel) {
        for (const c of this.children) {
            if ((sel === 'iframe' && c.tagName === 'IFRAME') || (sel.startsWith(':scope > .') && c.classList.contains(sel.slice(10)))) return c;
        }
        return null;
    }
    addEventListener() {}
    removeAttribute(a) { delete this.attrs[a]; }
    setAttribute(a, v) { this.attrs[a] = v; }
}

const frames = [];
function iframe() {
    const f = new El('', 'iframe');
    f.contentWindow = { sent: [], postMessage(m) { this.sent.push(m); } };
    frames.push(f);
    return f;
}

// ---- globals the modules reach for ----
const calls = { opened: [], closed: [], deleted: [], stopSpinner: 0, dsapOff: 0, audio: [] };
global.document = { getElementById: () => null, createElement: (tag) => new El('', tag) };
global.customScrollbar = null;
global.contextMenu = { detachFromElement() {} };
global.deactivateDsapOnShell = () => { calls.dsapOff++; };
global.grimoireStopNavigationSpinner = () => { calls.stopSpinner++; };
global.grimoireRetargetAudio = (from, to) => calls.audio.push([from, to]);
global.grimoireNormalizeWebUrl = (u) => (/^https?:\/\//.test(u || '') ? u : '');
global.grimoireOpenRemoteBrowser = (shell, url, opts) => {
    calls.opened.push({ shell, url, opts });
    shell._grimoireRemoteSessionId = 'S' + calls.opened.length;
    shell.displayArea.appendChild(iframe());
    shell.history = (shell.history || []);
    if (!(opts && opts.skipHistory)) {
        shell.history.push({ type: 'web', url, title: url });
        shell.historyIndex = shell.history.length - 1;
    }
};
global.grimoireCloseRemoteBrowser = (shell) => {
    calls.closed.push(shell);
    if (shell._grimoireRemoteSessionId) calls.deleted.push(shell._grimoireRemoteSessionId);
    shell._grimoireRemoteSessionId = '';
    const f = shell.displayArea && shell.displayArea.querySelector('iframe');
    if (f) f.remove();
    return Promise.resolve();
};
global.grimoireShowRemoteTabPage = (shell, state) => { calls.statusShown = state; };
global.grimoireUpdateRemoteScrollbar = () => {};
global.grimoireSetAudioShell = () => {};
global.grimoireStartNavigationSpinner = () => {};

const GrimoireTabs = require('../public/scripts/comp/grimoireTabs.js');

// ---- a Grimoire window stand-in ----
const body = new El('tag-wiki-search-body');
const wrap0 = body.appendChild(new El('tag-wiki-search-display form-section-scroll selectable'));
const area0 = wrap0.appendChild(new El('tag-wiki-display-content'));
const host = {
    displayArea: area0,
    searchBody: body,
    rightPaneEl: new El('tag-wiki-split-pane'),
    addressBar: new El('wiki-address-bar'),
    history: [{ type: 'home' }, { type: 'wiki', tag: { name: 'impressionism' } }],
    historyIndex: 1,
    currentTagName: 'impressionism',
    _activePane: 'left',
    syncs: 0,
    closedWindow: 0,
    get activePane() { return this; },
    exitAddressEdit() {},
    isSplitMode() { return false; },
    syncAddressAndControlsToActive() { this.syncs++; },
    setActivePane() {},
    attachWikiDisplayContextMenu() {},
    goHome() { this.history = [{ type: 'home' }]; this.historyIndex = 0; this.currentTagName = null; },
    navigate(u) { this.navigated = u; },
    close() { this.closedWindow++; }
};
const tabs = new GrimoireTabs(host);
host.tabs = tabs;
let changes = 0;
tabs.onChange(() => changes++);

// one tab: the window's own
assert.strictEqual(tabs.count(), 1);
const first = tabs.list()[0];
assert.strictEqual(first.area, area0, 'the first tab adopts the existing display area');

// a new Grimoire tab: the first one's page waits in its state; the window shows the new one's home
const second = tabs.open();
assert.strictEqual(tabs.count(), 2);
assert.ok(tabs.isActive(second));
assert.notStrictEqual(host.displayArea, area0, 'the window draws into the new tab\'s area');
assert.strictEqual(body.children.length, 2, 'the new area sits beside the first');
assert.strictEqual(wrap0.style.display, 'none', 'the first tab\'s area is hidden, not emptied');
assert.strictEqual(first.state.currentTagName, 'impressionism');
assert.strictEqual(first.state.historyIndex, 1);
assert.deepStrictEqual(host.history, [{ type: 'home' }], 'the new tab starts at the Grimoire home');
assert.ok(changes > 0, 'the strip hears about it');

// a new Alchemy tab next to the one on show
const third = tabs.open({ url: 'https://www.bing.com/', afterActive: true });
assert.deepStrictEqual(tabs.list().map((t) => t.id), [first.id, second.id, third.id]);
assert.strictEqual(host._grimoireRemoteSessionId, 'S1');
const bingFrame = host.displayArea.querySelector('iframe');
assert.ok(bingFrame, 'the Alchemy page streams into the tab\'s own area');

// back to the first: its page state comes back, the Alchemy tab keeps its frame and session
tabs.activate(first);
assert.strictEqual(host.displayArea, area0);
assert.strictEqual(host.currentTagName, 'impressionism');
assert.strictEqual(host.historyIndex, 1);
assert.strictEqual(host._grimoireRemoteSessionId, undefined, 'the Alchemy session stays with its tab');
assert.strictEqual(third.state._grimoireRemoteSessionId, 'S1');
assert.strictEqual(third.state.displayArea.querySelector('iframe'), bingFrame, 'the background frame stays connected');
assert.strictEqual(wrap0.style.display, undefined, 'its area shows again');
assert.ok(calls.stopSpinner > 0, 'the old tab\'s spinner stops with it');
assert.deepStrictEqual(tabs.backgroundShells(), [second.state, third.state]);
assert.strictEqual(tabs.backgroundTabOf(third.state), third);
assert.strictEqual(tabs.backgroundTabOf(host), null, 'the window is never a background shell');

// ---- a background frame (grimoireRemoteBrowser.js grimoireBackgroundRemoteMessage) ----
const ctx = { console, Date, Promise, setTimeout, clearTimeout, URL, Set, Map, Math, Number, String, Array, JSON, Object, encodeURIComponent };
ctx.window = ctx;
ctx.addEventListener = () => {};
ctx.document = { addEventListener() {}, getElementById: () => null };
ctx.location = { origin: 'http://x' };
ctx.tagWikiSearchModal = host;
ctx.wikiWindowManager = null;
ctx.capTagWikiHistoryEntries = (history, historyIndex) => ({ history, historyIndex });
vm.createContext(ctx);
vm.runInContext(read('public/scripts/comp/grimoireRemoteBrowser.js'), ctx);
const found = { host, shell: third.state, frame: bingFrame, tab: third };
assert.strictEqual(ctx.grimoireBackgroundRemoteMessage(found, { type: 'grimoire-browser-navigating', url: 'https://www.bing.com/search?q=a', navigating: true }), true);
assert.strictEqual(third.loading, true, 'the background tab shows its loading ring');
ctx.grimoireBackgroundRemoteMessage(found, { type: 'grimoire-browser-location', url: 'https://www.bing.com/search?q=a', title: 'a - Search' });
assert.strictEqual(third.loading, false);
const top = third.state.history[third.state.historyIndex];
assert.deepStrictEqual([top.type, top.url, top.title], ['web', 'https://www.bing.com/search?q=a', 'a - Search'], 'the page lands in that tab\'s history');
assert.strictEqual(third.state._currentAddress.fullUrl, 'https://www.bing.com/search?q=a', 'its address waits for the tab');
assert.strictEqual(host.currentTagName, 'impressionism', 'the tab on show is untouched');
ctx.grimoireBackgroundRemoteMessage(found, { type: 'grimoire-browser-location', url: 'https://www.bing.com/search?q=a', title: 'a - Bing' });
assert.strictEqual(third.state.history[third.state.historyIndex].title, 'a - Bing', 'a later title renames the entry');
assert.strictEqual(ctx.grimoireBackgroundRemoteMessage(found, { type: 'grimoire-browser-download', id: 'g' }), false, 'downloads fall through to the usual handling');
assert.strictEqual(ctx.grimoireBackgroundRemoteMessage(found, { type: 'grimoire-browser-popup', url: 'https://a.example/' }), false, 'so do popups');
ctx.grimoireBackgroundRemoteMessage(found, { type: 'grimoire-browser-status', state: 'failed', url: 'https://www.bing.com/' });
assert.deepStrictEqual(third.pending, { left: { state: 'failed', url: 'https://www.bing.com/' } }, 'a failed page waits for its tab');
assert.strictEqual(calls.statusShown, undefined);

// tab keys
const key = (k, extra) => Object.assign({ key: k, ctrlKey: true, metaKey: false, altKey: false, shiftKey: false }, extra);
assert.strictEqual(ctx.grimoireTabShortcut(key('t')), 'new-tab');
assert.strictEqual(ctx.grimoireTabShortcut(key('W')), 'close-tab');
assert.strictEqual(ctx.grimoireTabShortcut(key('Tab', { shiftKey: true })), 'prev-tab');
assert.strictEqual(ctx.grimoireTabShortcut(key('q')), 'quick-tabs');
assert.strictEqual(ctx.grimoireTabShortcut(key('t', { ctrlKey: false })), '', 'plain keys go to the page');
assert.strictEqual(ctx.grimoireTabShortcut(key('t', { altKey: true })), '');

// the failed page shows when the tab does
tabs.activate(third);
assert.strictEqual(calls.statusShown, 'failed');
assert.strictEqual(host.displayArea.querySelector('iframe'), bingFrame);
assert.strictEqual(host._grimoireRemoteSessionId, 'S1');

// ---- the session cap: the background tab used longest ago lets its session go ----
(async () => {
    tabs.activate(first);
    assert.strictEqual(await tabs.freeSession(), true);
    assert.ok(calls.deleted.includes('S1'), 'the background Alchemy session ends');
    assert.strictEqual(third.state._grimoireRemoteSessionId, '');
    assert.strictEqual(third.state.history[third.state.historyIndex].url, 'https://www.bing.com/search?q=a', 'its address stays');
    assert.strictEqual(await tabs.freeSession(), false, 'nothing left to free');
    // shown again: it reconnects to its page without a new history entry
    const before = calls.opened.length;
    tabs.activate(third);
    const again = calls.opened[before];
    assert.ok(again && again.shell === host && again.url === 'https://www.bing.com/search?q=a' && again.opts.skipHistory, 'reconnects to the same page');

    // ---- closing ----
    const order = tabs.list().map((t) => t.id);
    tabs.close(third); // the tab on show: the one to its right, else its left
    assert.ok(tabs.isActive(second), 'closing the tab on show shows its neighbour');
    assert.deepStrictEqual(tabs.list().map((t) => t.id), order.filter((id) => id !== third.id));
    assert.ok(calls.deleted.includes('S2'), 'its Alchemy session ends');
    assert.strictEqual(body.children.length, 2, 'its area leaves the page');
    tabs.closeOthers(second);
    assert.deepStrictEqual(tabs.list(), [second]);
    assert.strictEqual(wrap0.parentNode, null, 'the first tab\'s area went with it');
    tabs.close();
    assert.strictEqual(host.closedWindow, 1, 'closing the last tab closes the window');

    // the window closes: other tabs go, the one on show ends its session, and it restores the saved right pane next time
    const extra = tabs.open({ url: 'https://example.com/' });
    tabs.resetForWindowClose();
    assert.deepStrictEqual(tabs.list(), [extra]);
    assert.strictEqual(host._grimoireRemoteSessionId, '');
    assert.ok(tabs.restoresSavedRightPane());

    // ---- wiring ----
    assert.ok(read('public/scripts/comp/featureLoader.js').includes("'scripts/comp/grimoireIeChrome.js', 'scripts/comp/grimoireTabs.js', 'scripts/comp/tagWikiSearchModal.js'"), 'loads before the window');
    const modal = read('public/scripts/comp/tagWikiSearchModal.js');
    assert.ok(modal.includes('this.tabs = new GrimoireTabs(this)'), 'the window builds it');
    assert.ok(modal.includes('this.tabs.activeRightArea()'), 'each tab has its own right pane');
    assert.ok(modal.includes('this.tabs.resetForWindowClose()'), 'tabs close with the window');
    assert.ok(read('services/grimoire-browser/viewer.html').includes("type: 'grimoire-browser-shortcut'"), 'the viewer hands the tab keys up');
    const css = read('public/css/vista-explorer.css');
    for (const sel of ['.grimoire-ie-tabstrip', '.grimoire-ie-tabtools', '.grimoire-ie-tab-close', '.grimoire-ie-quickview', '.grimoire-ie-quicktile']) assert.ok(css.includes(sel), sel + ' is styled');
    for (const f of ['tab.png', 'tab-hot.png', 'tab-pressed.png', 'tab-close.png', 'tab-close-hot.png', 'tab-close-pressed.png', 'quick-tabs.png']) {
        assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-ie', f)), f);
    }
    console.log('test-grimoire-tabs: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
