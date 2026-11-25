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
    navigate(u) { this.navigated = u; this.navigates = (this.navigates || 0) + 1; },
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

    // ---- sleeping tabs (Restore Session): in the strip with icon and title, dimmed, loaded only when opened ----
    const fetched = [];
    global.fetch = (url, init) => { fetched.push({ url, method: init && init.method }); return Promise.resolve({}); };
    const realOpen = global.grimoireOpenRemoteBrowser;
    // the real opener sets its session id only after the service answers: record the call and leave the shell without one
    global.grimoireOpenRemoteBrowser = (shell, url, opts) => { calls.opened.push({ shell, url, opts }); };
    const openedBefore = calls.opened.length;
    const live = tabs.active;
    host._grimoireRemoteSessionId = 'LIVEBASE'; // the tab on show holds its page
    const sleepWeb = tabs.addSleeping({
        id: 'x1', kind: 'alchemy', url: 'https://a.example/', title: 'A page', icon: '/icons/a.png',
        history: [{ type: 'web', url: 'https://a.example/0', title: 'Zero', icon: '' }, { type: 'web', url: 'https://a.example/', title: 'A page', icon: '/icons/a.png' }],
        historyIndex: 1, session: { sessionId: 'LIVE1', viewUrl: '/v/1' }
    }, { at: 0 });
    const sleepGrim = tabs.addSleeping({ id: 'x2', kind: 'grimoire', url: 'edtx://en.grimoire.jp/wiki/x', title: '', icon: '' });
    assert.deepStrictEqual(tabs.list().map((t) => t.id), [sleepWeb.id, live.id, sleepGrim.id], 'at puts the tab in place, none at the end');
    assert.ok(!tabs.isActive(sleepWeb) && tabs.isActive(live), 'a sleeping tab is added behind, not shown');
    assert.strictEqual(calls.opened.length, openedBefore, 'nothing loads');
    assert.strictEqual(host.navigates || 0, 0, 'nothing navigates');
    assert.strictEqual(sleepWeb.wrap.style.display, 'none', 'its area is hidden');
    assert.ok(sleepWeb.sleeping && tabs.isDimmed(sleepWeb) && tabs.isDimmed(sleepGrim) && !tabs.isDimmed(live), 'asleep = dimmed, the tab on show never');
    assert.deepStrictEqual(sleepWeb.sleepInfo, { title: 'A page', icon: '/icons/a.png' });
    assert.deepStrictEqual(sleepGrim.sleepInfo, { title: 'edtx://en.grimoire.jp/wiki/x', icon: '/static_images/app_icons/books.webp' });
    assert.strictEqual(tabs.addSleeping({ kind: 'alchemy', url: 'https://n.example/' }, { at: 99 }).sleepInfo.icon, '/static_images/vista-ie/page-ie.png', 'IE page icon until the page icon is known');
    tabs.dispose(tabs.list()[tabs.count() - 1]);
    tabs.tabs.pop();
    assert.deepStrictEqual(sleepWeb.state.history.map((h) => [h.type, h.url, h.title, h.favicon]), [['web', 'https://a.example/0', 'Zero', undefined], ['web', 'https://a.example/', 'A page', '/icons/a.png']]);
    assert.strictEqual(sleepWeb.state.historyIndex, 1, 'the entry of its address');
    assert.strictEqual(sleepWeb.state._grimoireRemoteTitle, 'A page');
    assert.deepStrictEqual(sleepWeb.state._grimoireSleep, { title: 'A page', icon: '/icons/a.png', url: 'https://a.example/', address: '', session: { sessionId: 'LIVE1', viewUrl: '/v/1' } });
    assert.deepStrictEqual(sleepGrim.state._currentAddress, { fullUrl: 'edtx://en.grimoire.jp/wiki/x', displayUrl: 'edtx://en.grimoire.jp/wiki/x' });
    assert.deepStrictEqual(sleepGrim.state._grimoireSleep, { title: '', icon: '', url: '', address: 'edtx://en.grimoire.jp/wiki/x', session: null });
    assert.strictEqual(sleepGrim.state.history.length, 0, 'a Grimoire tab starts with no history');
    assert.strictEqual(tabs.backgroundTabOf(sleepWeb.state), sleepWeb);
    assert.doesNotThrow(() => tabs.nextSuspendDelay(Date.now()), 'sleeping tabs do not break the suspend look');
    const sleepSessionTab = tabs.addSleeping({ kind: 'alchemy', url: 'https://s.example/', session: { sessionId: 'LIVES' } });
    assert.ok(Number.isFinite(tabs.nextSuspendDelay(sleepSessionTab.lastActive)), 'a sleeping tab holding a session comes due like a live one');
    tabs.dispose(sleepSessionTab);
    tabs.tabs.splice(tabs.tabs.indexOf(sleepSessionTab), 1);

    // opened: the one clicked loads, once, with its history and its live session
    tabs.activate(sleepWeb);
    assert.strictEqual(calls.opened.length, openedBefore + 1, 'one load, not a second one from resume');
    const woke = calls.opened[openedBefore];
    assert.ok(woke.shell === host && woke.url === 'https://a.example/' && woke.opts.skipHistory && woke.opts.host === host, 'the window loads the sleeping tab\'s page');
    assert.deepStrictEqual(woke.opts.session, { sessionId: 'LIVE1', viewUrl: '/v/1' }, 'its live session streams as is');
    assert.ok(!sleepWeb.sleeping && !sleepWeb.wake && !sleepWeb.sleepInfo && !tabs.isDimmed(sleepWeb), 'awake');
    assert.strictEqual(host.history.length, 2);
    assert.strictEqual(host.historyIndex, 1);
    assert.strictEqual(host._grimoireSleep, undefined);
    assert.ok(!('_grimoireSleep' in (sleepWeb.state || {})), 'its sleep record is gone');
    assert.ok(tabs.isDimmed(live) === false && tabs.isActive(sleepWeb));
    host._grimoireRemoteSessionId = 'WOKE'; // the service answered
    tabs.activate(live);
    tabs.activate(sleepWeb);
    assert.strictEqual(calls.opened.filter((c) => c.url === 'https://a.example/').length, 1, 'an awake tab does not load again');
    tabs.activate(live);
    sleepWeb.state._grimoireRemoteSessionId = '';

    host.navigates = 0;
    tabs.activate(sleepGrim);
    assert.strictEqual(host.navigated, 'edtx://en.grimoire.jp/wiki/x');
    assert.strictEqual(host.navigates, 1, 'a Grimoire tab navigates to its address once');
    assert.strictEqual(calls.opened.length, openedBefore + 1, 'and opens no Alchemy page');
    assert.ok(!sleepGrim.sleeping);
    tabs.activate(live);

    // closing a sleeping tab that holds a live session ends it in the service
    const sleepClose = tabs.addSleeping({ kind: 'alchemy', url: 'https://c.example/', session: { sessionId: 'LIVE/2' } });
    tabs.close(sleepClose);
    assert.deepStrictEqual(fetched.filter((f) => f.url.includes('LIVE%2F2')).map((f) => [f.url, f.method]), [['/api/grimoire-browser/sessions/LIVE%2F2', 'DELETE']]);
    assert.ok(!tabs.list().includes(sleepClose));

    // the session cap may take a sleeping tab's session; the tab keeps its address and loads on opening
    const sleepFree = tabs.addSleeping({ kind: 'alchemy', url: 'https://d.example/', session: { sessionId: 'LIVE3' } });
    assert.strictEqual(await tabs.freeSession(), true);
    assert.ok(fetched.some((f) => f.url.endsWith('/LIVE3') && f.method === 'DELETE'));
    assert.ok(sleepFree.sleeping && sleepFree.suspended && sleepFree.wake.session === null && sleepFree.state._grimoireSleep.session === null);
    assert.strictEqual(await tabs.freeSession(), false, 'nothing else holds a session');
    tabs.activate(sleepFree);
    const freed = calls.opened[calls.opened.length - 1];
    assert.ok(freed.url === 'https://d.example/' && freed.opts.session === null, 'a new session opens for it');
    assert.ok(!tabs.isDimmed(sleepFree) && !sleepFree.suspended);
    tabs.activate(live);

    // a session given up at the cap marks a live tab suspended too (dimmed behind)
    global.grimoireOpenRemoteBrowser = realOpen;
    const liveWeb = tabs.open({ url: 'https://e.example/', afterActive: true });
    tabs.activate(live);
    assert.strictEqual(await tabs.freeSession(), true);
    assert.ok(liveWeb.suspended && tabs.isDimmed(liveWeb), 'a suspended tab is dimmed');
    tabs.activate(liveWeb);
    assert.ok(!liveWeb.suspended && !tabs.isDimmed(liveWeb));
    tabs.close(liveWeb);

    // ---- Restore Session: only the tab that was on show loads, the others are added asleep in saved order ----
    {
        const rctx = { console, Date, Promise, setTimeout, clearTimeout, Set, Map, Math, Number, String, Array, JSON, Object, RegExp };
        rctx.window = rctx;
        rctx.document = { addEventListener() {} };
        const loaded = [];
        const mainWin = { modal: { classList: { contains: () => true } }, tabs, navigate() {}, open() {}, history: [], historyIndex: -1 };
        tabs.available = () => true;
        tabs.load = (t) => loaded.push(t);
        rctx.grimoireAllWindows = () => [mainWin];
        vm.createContext(rctx);
        vm.runInContext(read('public/scripts/comp/browsingRestore.js'), rctx);
        const lead = tabs.active;
        const openedNow = calls.opened.length;
        const sleepers = tabs.count();
        await rctx.browsingRestore.restoreWindows([{ tabs: [
            { id: 'r1', kind: 'grimoire', url: 'edtx://en.grimoire.jp/wiki/a', title: 'Wiki A' },
            { id: 'r2', kind: 'alchemy', url: 'https://b.example/', title: 'B', active: true, history: [{ type: 'web', url: 'https://b.example/0', title: 'B0' }, { type: 'web', url: 'https://b.example/', title: 'B' }] },
            { id: 'r3', kind: 'alchemy', url: 'https://c.example/', title: 'C', icon: '/icons/c.png', session: { sessionId: 'LIVEC' } },
            { id: 'r4', kind: 'alchemy', url: 'https://d.example/', title: 'D' }
        ] }]);
        assert.deepStrictEqual(JSON.parse(JSON.stringify(loaded)), [{ url: 'https://b.example/' }], 'only the tab that was on show loads');
        assert.strictEqual(calls.opened.length, openedNow, 'no sleeping tab opens an Alchemy session');
        assert.strictEqual(tabs.count(), sleepers + 3);
        const all = tabs.list();
        const order = all.slice(all.indexOf(lead) - 1, all.indexOf(lead) + 3).map((t) => (t === lead ? 'lead' : t.sleepInfo ? t.sleepInfo.title : '?'));
        assert.deepStrictEqual(order, ['Wiki A', 'lead', 'C', 'D'], 'the strip keeps the saved order around the tab on show');
        assert.ok(tabs.isActive(lead), 'the tab on show stays on show');
        assert.strictEqual(mainWin.history.length, 2, 'its history is applied');
        assert.strictEqual(mainWin.history[mainWin.historyIndex].url, 'https://b.example/');
        assert.deepStrictEqual(all[all.indexOf(lead) + 1].wake, { url: 'https://c.example/', address: '', session: { sessionId: 'LIVEC' } });
        assert.strictEqual(all[all.indexOf(lead) + 1].sleepInfo.icon, '/icons/c.png');
    }

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
    // ---- several full windows (#615) ----
    assert.ok(modal.includes('static async openNewWindow(target = {})'), 'New Window builds another full window');
    assert.ok(modal.includes("el.querySelectorAll('[id]').forEach((node) => {") && modal.includes('node.dataset.grimoirePart = node.id;'), 'its ids carry a suffix and keep their name');
    assert.ok(/function grimoireActiveWindow\(\)/.test(modal) && /function grimoireWindowOf\(shell\)/.test(modal), 'the window used last, and the window of a shell');
    assert.ok(!/document\.getElementById\('(tagWikiSearch(?!Modal')|grimoireAddress)/.test(modal.slice(modal.indexOf('class TagWikiSearchModal'), modal.indexOf('// Grimoire windows (#615)'))), 'the window finds its parts through part()');
    assert.ok(!/#tagWikiSearchModal(?![\w-])(?!, \.grimoire-window\))/.test(css.replace(/\/\*[\s\S]*?\*\//g, '')), 'every window rule also matches a later window');
    assert.ok(read('public/scripts/comp/grimoireTabs.js').includes('root.grimoireActiveWindow()'), 'searches and shortcuts go to the window used last');
    assert.ok(read('public/scripts/comp/modalKeyboardRegistry.js').includes('function unregisterKeyboardListener(id)'), 'a closed window drops its keys');

    console.log('test-grimoire-tabs: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
