#!/usr/bin/env node
// Alchemy tab restore (Yozora #1116): an Alchemy page lands in the tab that asked for it, whichever tab shows when
// the session arrives, and Refresh on a tab whose page is gone opens that page again (not the Grimoire home).
// DOM-stub test (no browser): grimoireRemoteBrowser.js and grimoireTabs.js run as served in a vm; the two
// tagWikiSearchModal.js methods under test (reopenDeadWebPage, refreshToolbar) are cut out of the file as is.
// Run: node scripts/test-grimoire-remote-open-race.js
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
        this.listeners = {};
        this.style = { removeProperty(k) { delete this[k]; }, setProperty(k, v) { this[k] = v; } };
        this.attrs = {};
        this.classList = {
            contains: (c) => this.className.split(/\s+/).includes(c),
            toggle: (c, on) => {
                const set = new Set(this.className.split(/\s+/).filter(Boolean));
                if (on === undefined ? !set.has(c) : on) set.add(c); else set.delete(c);
                this.className = [...set].join(' ');
            },
            remove: (c) => { this.className = this.className.split(/\s+/).filter((x) => x && x !== c).join(' '); }
        };
    }
    get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.isRoot === true; }
    set innerHTML(v) { this.children.slice().forEach((c) => c.remove()); }
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
        for (const c of this.children) if (sel === 'iframe' && c.tagName === 'IFRAME') return c;
        return null;
    }
    querySelectorAll() { return []; }
    addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
    removeAttribute(a) { delete this.attrs[a]; }
    setAttribute(a, v) { this.attrs[a] = v; }
}
function iframe() {
    const f = new El('', 'iframe');
    f.contentWindow = { sent: [], postMessage(m) { this.sent.push(m); } };
    return f;
}

// ---- fetch: every call waits until the test answers it ----
const fetches = [];
function fetchStub(url, init) {
    const call = { url, method: (init && init.method) || 'GET', body: init && init.body ? JSON.parse(init.body) : null };
    call.promise = new Promise((resolve, reject) => { call.resolve = resolve; call.reject = reject; });
    fetches.push(call);
    if (call.method === 'DELETE') call.resolve({ ok: true, status: 200, json: async () => ({}) });
    return call.promise;
}
const answer = (call, id) => call.resolve({ ok: true, status: 200, json: async () => ({ sessionId: id, viewUrl: '/viewer/' + id + '?t=1' }) });
const posts = () => fetches.filter((f) => f.method === 'POST');
const deletes = () => fetches.filter((f) => f.method === 'DELETE').map((f) => f.url);
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ---- a Grimoire window stand-in with real tabs ----
const log = { unavailable: 0, audio: [], spinnerStops: 0, nav: 0, homepage: 0, opens: [] };
const root = new El('root');
root.isRoot = true;
const body = root.appendChild(new El('tag-wiki-search-body'));
const wrap0 = body.appendChild(new El('tag-wiki-search-display form-section-scroll selectable'));
const area0 = wrap0.appendChild(new El('tag-wiki-display-content'));
const host = {
    displayArea: area0,
    searchBody: body,
    modal: new El('modal'),
    rightPaneEl: new El('tag-wiki-split-pane'),
    addressBar: new El('wiki-address-bar'),
    history: [{ type: 'home' }],
    historyIndex: 0,
    _activePane: 'left',
    get activePane() { return this._activePane === 'right' && this.rightPane ? this.rightPane : this; },
    exitAddressEdit() {},
    setAddress(a) { this.address = a; },
    setNavigationLoading() {},
    finishGrimoireNavigationLoading() {},
    updateNavigationButtons() { log.nav++; },
    isSplitMode() { return false; },
    syncAddressAndControlsToActive() {},
    setActivePane() {},
    attachWikiDisplayContextMenu() {},
    addToHistory(entry) {
        this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push(entry);
        this.historyIndex = this.history.length - 1;
    },
    showGrimoireNavigateErrorPage() { log.unavailable++; },
    goHome() { this.history = [{ type: 'home' }]; this.historyIndex = 0; },
    navigate() {},
    close() {}
};
host.modal.parentNode = root;
root.children.push(host.modal);

// ---- the scripts as served ----
const ctx = { console, Date, Promise, setTimeout, clearTimeout, URL, Set, Map, WeakMap, WeakSet, Math, Number, String, Array, JSON, Object, encodeURIComponent, setImmediate };
ctx.window = ctx;
// the tab strip's idle timer is not under test
ctx.setInterval = () => 0;
ctx.clearInterval = () => {};
ctx.addEventListener = () => {};
ctx.document = { hidden: false, addEventListener() {}, getElementById: () => null, createElement: (tag) => (tag === 'iframe' ? iframe() : new El('', tag)) };
ctx.fetch = fetchStub;
ctx.location = { origin: 'http://x' };
ctx.tagWikiSearchModal = host;
ctx.wikiWindowManager = null;
ctx.capTagWikiHistoryEntries = (history, historyIndex) => ({ history, historyIndex });
ctx.deactivateDsapOnShell = () => {};
ctx.grimoireAlchToChrome = (u) => u;
ctx.grimoireAllWindows = () => [host];
ctx.grimoireWindowOf = (shell) => (shell === host || host.rightPane === shell || (host.tabs && host.tabs.backgroundTabOf(shell)) ? host : null);
vm.createContext(ctx);
vm.runInContext(read('public/scripts/comp/grimoireRemoteBrowser.js'), ctx);
vm.runInContext(read('public/scripts/comp/grimoireTabs.js'), ctx);
// spies: the file's own calls go through the global
ctx.grimoireSetAudioShell = (shell) => log.audio.push(shell);
ctx.grimoireSyncAudio = () => {};
ctx.grimoireShowBrowserUnavailable = (h, shell, url) => { log.unavailable++; };

const tabs = new ctx.GrimoireTabs(host);
host.tabs = tabs;
tabs.stopSuspendTimer();
// the tab shown is a stand-in for the real Grimoire pages: opening a tab without a page just starts at home
const A = tabs.list()[0];

const urlA = 'https://a.example/';
const urlB = 'https://b.example/';
const frameOf = (area) => area.querySelector('iframe');
const shownAreas = () => tabs.list().map((t) => (t === tabs.active ? host.displayArea : t.state.displayArea));

(async () => {
    // ---- 1. the user moves to another tab while the page is on its way ----
    const open1 = ctx.grimoireOpenRemoteBrowser(host, urlA, { host });
    assert.strictEqual(fetches.length, 1);
    assert.strictEqual(ctx.grimoireRemoteOpening(host), urlA, 'an open in flight is marked');
    assert.strictEqual(ctx.window.grimoireRemoteOpening, ctx.grimoireRemoteOpening, 'exported');
    const B = tabs.open();
    assert.ok(tabs.isActive(B));
    assert.strictEqual(ctx.grimoireRemoteOpening(host), '', 'the marker belongs to the asking tab, not to the window');
    assert.strictEqual(ctx.grimoireRemoteOpening(A.state), urlA, 'the background tab is the one opening');
    answer(fetches[0], 'SA');
    await open1;
    assert.strictEqual(host._grimoireRemoteSessionId, undefined, 'the tab on show gets no session');
    assert.ok(!frameOf(host.displayArea) && host.displayArea === B.area, 'nor a frame');
    assert.strictEqual(A.state._grimoireRemoteSessionId, 'SA', 'the session is the asking tab\'s');
    const frameA = frameOf(A.area);
    assert.ok(frameA && frameA.src === '/viewer/SA?t=1', 'its frame streams into the asking tab\'s own area');
    assert.deepStrictEqual(A.state.history.map((e) => e.url || e.type), ['home', urlA], 'the history entry goes to that tab');
    assert.strictEqual(A.state.historyIndex, 1);
    assert.deepStrictEqual(host.history, [{ type: 'home' }], 'the tab on show keeps its history');
    assert.strictEqual(host._grimoireRemoteViewQuery, undefined);
    assert.ok(!log.audio.includes(host) && !log.audio.includes(A.state), 'the audio shell is not taken by a page behind');
    assert.strictEqual(A.state._currentAddress.fullUrl, urlA, 'its address waits for the tab');
    assert.strictEqual(ctx.grimoireRemoteOpening(A.state), '', 'the marker is cleared');
    assert.strictEqual(deletes().length, 0);
    // the viewer's messages find the frame in the background state
    const found = ctx.grimoireRemoteFromMessage({ source: frameA.contentWindow });
    assert.ok(found && found.tab === A && found.shell === A.state && found.host === host, 'messages route to the background tab');
    frameA.contentWindow.sent.length = 0;
    ctx.grimoireBackgroundRemoteMessage(found, { type: 'grimoire-browser-ready' });
    assert.ok(frameA.contentWindow.sent.some((m) => m.type === 'grimoire-browser-visibility' && m.hidden === true), 'a viewer behind a tab is told it is hidden');
    frameA.contentWindow.sent.length = 0;
    (frameA.listeners.load || []).forEach((fn) => fn());
    assert.ok(frameA.contentWindow.sent.some((m) => m.type === 'grimoire-browser-visibility' && m.hidden === true), 'also when its frame loads');
    // back to the asking tab: it shows its page
    tabs.activate(A);
    assert.strictEqual(host._grimoireRemoteSessionId, 'SA');
    assert.strictEqual(frameOf(host.displayArea), frameA);
    assert.strictEqual(posts().length, 1, 'no second session when the tab shows');

    // ---- 2. its tab is closed while the page is on its way: the new session is given up ----
    const Z = tabs.open();
    const open2 = ctx.grimoireOpenRemoteBrowser(host, urlB, { host });
    assert.strictEqual(posts().length, 2);
    tabs.activate(B);
    tabs.close(Z);
    assert.ok(!tabs.list().includes(Z));
    answer(posts()[1], 'SGONE');
    await open2;
    assert.ok(deletes().some((u) => u.endsWith('/sessions/SGONE')), 'a session for a closed tab is deleted');
    assert.ok(!frameOf(host.displayArea) && !host._grimoireRemoteSessionId, 'and does not land on the tab on show');
    assert.ok(!deletes().some((u) => u.endsWith('/sessions/SA')), 'the other tabs keep their pages');

    // ---- 3. back on the asking tab before it lands: the tab on show takes it ----
    const C = tabs.open();
    const open3 = ctx.grimoireOpenRemoteBrowser(host, urlA, { host });
    tabs.activate(B);
    tabs.activate(C);
    answer(posts()[2], 'SC');
    await open3;
    assert.strictEqual(host._grimoireRemoteSessionId, 'SC');
    assert.ok(frameOf(host.displayArea));
    assert.ok(log.audio.includes(host), 'the page on show takes the audio');
    assert.deepStrictEqual(host.history.map((e) => e.url || e.type), ['home', urlA]);

    // ---- 4. two opens for one page: the same address is not asked twice; a newer address wins ----
    const D = tabs.open();
    const before = posts().length;
    const openD1 = ctx.grimoireOpenRemoteBrowser(host, urlA, { host, skipHistory: true });
    await ctx.grimoireOpenRemoteBrowser(host, urlA, { host, skipHistory: true });
    assert.strictEqual(posts().length, before + 1, 'a tab shown again while its page loads does not open it twice');
    const openD2 = ctx.grimoireOpenRemoteBrowser(host, urlB, { host });
    assert.strictEqual(posts().length, before + 2);
    answer(posts()[before + 1], 'SD2');
    await openD2;
    answer(posts()[before], 'SD1');
    await openD1;
    assert.strictEqual(host._grimoireRemoteSessionId, 'SD2', 'the newest open lands');
    assert.ok(deletes().some((u) => u.endsWith('/sessions/SD1')), 'the older session is let go');

    // ---- 5. the service says no while the user is elsewhere: the tab behind keeps its address, no error page on the other ----
    const E = tabs.open();
    const unavailableBefore = log.unavailable;
    const openE = ctx.grimoireOpenRemoteBrowser(host, urlA, { host });
    tabs.activate(D);
    fetches[fetches.length - 1].reject(new Error('down'));
    await openE;
    assert.strictEqual(log.unavailable, unavailableBefore, 'no error page over the tab on show');
    assert.deepStrictEqual(E.state.history.map((e) => e.url || e.type), ['home', urlA], 'the tab behind keeps the address (it opens when shown)');
    assert.strictEqual(ctx.grimoireRemoteOpening(E.state), '');
    tabs.activate(E);
    const openEFail = ctx.grimoireOpenRemoteBrowser(host, urlB, { host });
    fetches[fetches.length - 1].reject(new Error('down'));
    await openEFail;
    assert.strictEqual(log.unavailable, unavailableBefore + 1, 'on show the error page appears as before');

    // ---- 6. a tab that wakes its page after the user moved on (opts.tab, session already open) ----
    const F = tabs.open();
    tabs.activate(E);
    const postsBefore = posts().length;
    await ctx.grimoireOpenRemoteBrowser(host, urlB, { host, tab: F, session: { sessionId: 'SWAKE', viewUrl: '/viewer/SWAKE?t=1' }, skipHistory: true });
    assert.strictEqual(posts().length, postsBefore, 'a session that came with the call needs no request');
    assert.strictEqual(F.state._grimoireRemoteSessionId, 'SWAKE', 'it lands in the tab that asked');
    assert.ok(frameOf(F.area));
    assert.ok(host._grimoireRemoteSessionId !== 'SWAKE');
    // and a session for a tab that is gone is let go
    tabs.close(F);
    const deletedBefore = deletes().length;
    await ctx.grimoireOpenRemoteBrowser(host, urlB, { host, tab: F, session: { sessionId: 'SLATE', viewUrl: '/viewer/SLATE?t=1' }, skipHistory: true });
    assert.ok(deletes().slice(deletedBefore).some((u) => u.endsWith('/sessions/SLATE')), 'a session for a gone tab is closed');
    assert.ok(host._grimoireRemoteSessionId !== 'SLATE');

    // ---- 7. the right pane of a tab ----
    const pane = { displayArea: new El('pane-area'), history: [], historyIndex: -1, blank: true, addToHistory(e) { this.history.push(e); this.historyIndex = this.history.length - 1; } };
    root.appendChild(pane.displayArea);
    const G = tabs.open();
    host.rightPane = pane;
    const openP = ctx.grimoireOpenRemoteBrowser(pane, urlA, { host });
    tabs.activate(E);
    assert.strictEqual(ctx.grimoireRemoteOpening(pane), urlA);
    answer(posts()[posts().length - 1], 'SPANE');
    await openP;
    assert.strictEqual(pane._grimoireRemoteSessionId, 'SPANE', 'the pane object keeps its page');
    assert.ok(frameOf(pane.displayArea), 'its frame is in the pane\'s own area');
    assert.ok(host._grimoireRemoteSessionId !== 'SPANE');
    assert.deepStrictEqual(pane.history.map((e) => e.url), [urlA]);
    assert.strictEqual(G.state.rightPane, pane);

    // ---- 8. Refresh on a web entry without a session (tagWikiSearchModal.js refreshToolbar, as in the file) ----
    const src = read('public/scripts/comp/tagWikiSearchModal.js');
    const from = src.indexOf('    reopenDeadWebPage(pane) {');
    const to = src.indexOf('    async performSearch() {');
    assert.ok(from > 0 && to > from, 'the methods are in the file');
    const rctx = { console, setTimeout, Promise };
    vm.createContext(rctx);
    vm.runInContext('class Win {\n' + src.slice(from, to) + '\n}', rctx);
    const ropened = [];
    let flying = '';
    let reloadable = false;
    rctx.grimoireNormalizeWebUrl = (u) => (/^https?:\/\//.test(u || '') ? u : '');
    rctx.grimoireRemoteBrowserReload = () => reloadable;
    rctx.grimoireRemoteOpening = () => flying;
    rctx.grimoireOpenRemoteBrowser = (shell, url, opts) => { ropened.push({ shell, url, opts }); };
    const loading = [];
    const makeWin = (entry) => {
        const w = Object.assign(new (vm.runInContext('Win', rctx))(), {
            history: [entry], historyIndex: 0, searchInput: { value: 'stale query' },
            setNavigationLoading(on) { loading.push(on); },
            showDreamWikiHomepage() { log.homepage++; },
            getCurrentTagName() { return null; },
            refreshSearchPageResults() { log.homepage += 100; },
            performSearch() { log.homepage += 100; }
        });
        w.activePane = w;
        return w;
    };
    const dead = makeWin({ type: 'web', url: urlA, title: 'A' });
    await dead.refreshToolbar();
    assert.deepStrictEqual(ropened.map((o) => [o.shell, o.url, o.opts.host, o.opts.skipHistory]), [[dead, urlA, dead, true]], 'a dead web tab opens its page again');
    assert.strictEqual(log.homepage, 0, 'not the home, not the search box');
    assert.ok(!loading.includes(false), 'the spinner the open started stays');
    flying = urlA;
    await dead.refreshToolbar();
    assert.strictEqual(ropened.length, 1, 'an open already on its way is not repeated');
    flying = '';
    reloadable = true;
    await dead.refreshToolbar();
    assert.strictEqual(ropened.length, 1, 'a live page just reloads');
    reloadable = false;
    // right pane of a split window
    const winR = makeWin({ type: 'home' });
    const rpane = { history: [{ type: 'web', url: urlB }], historyIndex: 0 };
    winR.activePane = rpane;
    await winR.refreshToolbar();
    assert.deepStrictEqual(ropened.slice(1).map((o) => [o.shell, o.url, o.opts.host]), [[rpane, urlB, winR]], 'the right pane opens its page too');
    assert.strictEqual(log.homepage, 0);
    // a web error page opens the address again
    const navErr = makeWin({ type: 'nav-error', url: urlA, kind: 'browser_unavailable' });
    await navErr.refreshToolbar();
    assert.strictEqual(ropened.length, 3);
    // a Grimoire home still goes home
    const home = makeWin({ type: 'home' });
    await home.refreshToolbar();
    assert.strictEqual(log.homepage, 1);
    assert.strictEqual(ropened.length, 3);

    console.log('test-grimoire-remote-open-race: ok');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});
