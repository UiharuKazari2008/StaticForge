#!/usr/bin/env node
/**
 * Connection indicator writes (Yozora #998, desktop perf pass): websocket.js lights the traffic arrows, the ticker,
 * the tray icons and the tooltips on every message and pong. Each of these must write the DOM only when something a
 * person can see changes, with the same look and timing as before:
 *  - an arrow that is a flash target but not drawn (the Vista desktop's taskbar arrows) keeps its classes in a Set:
 *    zero class mutations per flash, the same send/recv for the tray globe (_syncTaskbarNetFlags);
 *  - a re-pulse of a lit arrow only starts its timer again;
 *  - a running HTTP stream's touches do not re-sync classes or re-arm timers, and its stall / idle edges stay at
 *    stallMs / idleMs after the last touch;
 *  - a throttled flash asks for no frame until it is due;
 *  - the service worker tray icon, the ticker and the ping tooltip write only changes;
 *  - wsInboundRegistry dispatches from a pre-sorted map and reads localStorage once.
 * Methods are lifted out of the source and run against a small fake DOM and a fake clock.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'public/scripts/websocket.js'), 'utf8');

// ---- fake clock -------------------------------------------------------------------------------
let now = 1000;
let nextId = 1;
const timers = new Map();
const frames = new Map();
const clock = {
    setTimeout(fn, ms) { const id = nextId++; timers.set(id, { at: now + Math.max(0, ms || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    requestAnimationFrame(fn) { const id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    performance: { now: () => now }
};
function advance(ms) {
    const end = now + ms;
    for (;;) {
        let first = null;
        for (const [id, t] of timers) if (t.at <= end && (!first || t.at < first[1].at)) first = [id, t];
        if (!first) break;
        timers.delete(first[0]);
        now = first[1].at;
        first[1].fn();
    }
    now = end;
}
function frame() {
    const list = [...frames.values()];
    frames.clear();
    list.forEach((fn) => fn());
}

// ---- fake DOM ---------------------------------------------------------------------------------
let mutations = 0;
class FakeEl {
    constructor(id, classes = '') {
        this.id = id;
        this.nodeType = 1;
        this._classes = new Set(classes.split(/\s+/).filter(Boolean));
        this._attrs = new Map();
        this._text = '';
        this.isConnected = true;
        this.drawn = true;
        const self = this;
        this.classList = {
            contains: (c) => self._classes.has(c),
            add: (...cs) => { mutations++; cs.forEach((c) => self._classes.add(c)); },
            remove: (...cs) => { mutations++; cs.forEach((c) => self._classes.delete(c)); },
            toggle: (c, on) => { mutations++; const v = on === undefined ? !self._classes.has(c) : !!on; if (v) self._classes.add(c); else self._classes.delete(c); return v; }
        };
        this._listeners = {};
    }
    get className() { return [...this._classes].join(' '); }
    set className(v) { mutations++; this._classes = new Set(String(v).split(/\s+/).filter(Boolean)); }
    get textContent() { return this._text; }
    set textContent(v) { mutations++; this._text = String(v == null ? '' : v); }
    get firstChild() { return null; }
    getAttribute(n) { return this._attrs.has(n) ? this._attrs.get(n) : null; }
    setAttribute(n, v) { mutations++; this._attrs.set(n, String(v)); }
    removeAttribute(n) { mutations++; this._attrs.delete(n); }
    addEventListener(type, fn) { (this._listeners[type] = this._listeners[type] || []).push(fn); }
    fire(type) { (this._listeners[type] || []).forEach((fn) => fn({ type })); }
    checkVisibility() { return this.drawn; }
    closest(sel) { return this.inTaskbar && sel === '#taskbarWebsocketIndicator' ? {} : null; }
    querySelector() { return null; }
}

const byId = new Map();
const add = (el) => { byId.set(el.id, el); return el; };
const document = {
    hidden: false,
    documentElement: { dataset: {} },
    getElementById: (id) => byId.get(id) || null,
    querySelector: () => null,
    querySelectorAll: () => []
};
const window = { uiShell: 'desktop', netFlags: [] };
window.setDesktopTaskbarNetFlags = (f) => { window.netFlags.push(`${f.send ? 's' : '-'}${f.recv ? 'r' : '-'}`); };

// the page's compare-before-write helpers (app.html loads them before websocket.js)
vm.runInThisContext(fs.readFileSync(path.join(root, 'public/scripts/utils/domWrite.js'), 'utf8'));

// ---- lifting ----------------------------------------------------------------------------------
function lift(name, source = src) {
    const at = [`\n    async ${name}(`, `\n    ${name}(`].map((n) => source.indexOf(n)).find((i) => i >= 0);
    assert.ok(at >= 0, `websocket.js has ${name}`);
    let depth = 0;
    let quote = null;
    for (let i = source.indexOf(') {', at) + 2; i < source.length; i++) {
        const ch = source[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '/' && source[i + 1] === '/') { i = source.indexOf('\n', i); continue; }
        if (ch === '/' && source[i + 1] === '*') { i = source.indexOf('*/', i + 2) + 1; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        if (ch === '}' && --depth === 0) {
            const text = source.slice(at + 1, i + 1).trim();
            const params = ['WebSocketClient', 'BannerManager', 'document', 'window', 'setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'];
            const make = new Function(...params, `return function ${text}`);
            return make(Statics, Statics, document, window, clock.setTimeout, clock.clearTimeout, clock.requestAnimationFrame, clock.cancelAnimationFrame, clock.performance);
        }
    }
    throw new Error(`unbalanced ${name}`);
}

// the static tables, read from the source
const Statics = {};
for (const name of ['ARROW_STATE_CLASSES', 'ARROW_UP_CLASSES', 'ARROW_DOWN_CLASSES', 'SW_TRAY_STATE_CLASSES']) {
    const m = src.match(new RegExp(`static ${name} = (Object\\.freeze\\(\\[[^\\]]*\\]\\));`));
    assert.ok(m, `static ${name}`);
    Statics[name] = eval(m[1]);
}

const proto = {};
['_wsFlashElementLook', '_isWsFlashElementVisible', '_arrowHasState', '_setArrowState', '_setArrowDrawn',
    '_refreshWsFlashTargets', '_metaKeyForTimeout', '_clearArrowFlashMeta', '_endArrowFlash', '_startArrowFlashTimer',
    '_extendArrowFlashAfterMinPlay', '_pulseArrowFlash', '_touchHttpStream', '_scheduleHttpStreamTimers',
    '_syncHttpStreamClasses', '_syncTaskbarNetFlags', '_queueWsFlashApply', '_applyTrafficArrowFlash',
    'clearWebSocketIndicatorTimeouts', '_clearHttpStreamState', '_updateServiceWorkerTrayIcon',
    '_isWsFlashVisibilityMutationTarget', '_setIndicatorStatusTitle', 'updatePingDisplay'
].forEach((n) => { proto[n] = lift(n); });

function client(indicators) {
    return Object.assign(Object.create(proto), {
        websocketIndicators: indicators,
        _wsFlashTargets: null,
        _flashMinPlayRatio: 0.5,
        _wsFlashLastApply: 0,
        _wsFlashMinInterval: 80,
        _httpStreamStallMs: 500,
        _httpStreamIdleMs: 2800,
        _syncNetworkActivityOptOut() {},
        _taskbarNetEls: null
    });
}

// ---- 1. undrawn taskbar arrows: state in a Set, zero class writes per flash ---------------------
const tbUp = add(new FakeEl('taskbarWsUp', 'fas fa-arrow-up websocket-arrow-up'));
const tbDown = add(new FakeEl('taskbarWsDown', 'fas fa-arrow-down websocket-arrow-down'));
tbUp.inTaskbar = tbDown.inTaskbar = true;
tbUp.drawn = tbDown.drawn = false; // Vista: #taskbarWebsocketIndicator is display: none
const globe = add(new FakeEl('modemTrayIcon'));
document.querySelector = (sel) => (sel.includes('arrow-up') ? tbUp : sel.includes('arrow-down') ? tbDown : null);
const taskbarStatus = add(new FakeEl('taskbarWsStatus'));
const tbIndicator = { container: {}, status: taskbarStatus, upArrow: tbUp, downArrow: tbDown, upTimeout: null, downTimeout: null, upHttpTimeout: null, downHttpTimeout: null };

const c = client([tbIndicator]);
c._refreshWsFlashTargets();
assert.strictEqual(c._wsFlashTargets.length, 4, 'the taskbar arrows are targets while the globe shows');

mutations = 0;
window.netFlags = [];
c._pulseArrowFlash(tbUp, tbIndicator, 'upTimeout', 'active', 300);
assert.strictEqual(mutations, 0, 'lighting an undrawn arrow writes no class');
assert.ok(!tbUp.classList.contains('active') && c._arrowHasState(tbUp, 'active'), 'its state is held in the Set');
assert.deepStrictEqual(window.netFlags, ['s-'], 'the globe still sends');
advance(300);
assert.strictEqual(mutations, 0, 'the flash ends without a class write');
assert.deepStrictEqual(window.netFlags, ['s-', '--'], 'and the globe rests on time');

// re-pulse a lit arrow past its minimum play: timer only, no flag flicker
window.netFlags = [];
c._pulseArrowFlash(tbDown, tbIndicator, 'downTimeout', 'active', 300);
advance(200);
c._pulseArrowFlash(tbDown, tbIndicator, 'downTimeout', 'active', 300);
assert.deepStrictEqual(window.netFlags, ['-r'], 're-pulsing a lit arrow does not take the globe off and on');
advance(299);
assert.ok(c._arrowHasState(tbDown, 'active'), 'the re-pulse extends the flash from its own start');
advance(1);
assert.ok(!c._arrowHasState(tbDown, 'active'), 'and ends 300 ms after it');
assert.deepStrictEqual(window.netFlags, ['-r', '--']);

// HTTP stream on an undrawn arrow
mutations = 0;
window.netFlags = [];
c._touchHttpStream('down');
assert.deepStrictEqual(window.netFlags, ['-r'], 'a stream lights the globe');
const timersAfterFirst = timers.size;
for (let i = 0; i < 5; i++) { advance(100); c._touchHttpStream('down'); }
assert.deepStrictEqual(window.netFlags, ['-r'], 'touches on a running stream sync nothing');
assert.strictEqual(timers.size, timersAfterFirst, 'and arm no further timers');
const lastTouch = now;
advance(499);
assert.ok(!c._httpStreamDownStalled, 'not stalled before stallMs after the last touch');
advance(1);
assert.ok(c._httpStreamDownStalled, 'stalled stallMs after the last touch');
assert.deepStrictEqual(window.netFlags, ['-r', '--'], 'a stalled stream rests the globe');
advance(lastTouch + 2799 - now);
assert.ok(c._httpStreamDownActive, 'still active before idleMs');
advance(1);
assert.ok(!c._httpStreamDownActive, 'idle idleMs after the last touch');
assert.strictEqual(mutations, 0, 'the whole stream wrote no class on the undrawn arrow');

// drawn again (Classic theme): the held state goes onto the element once
c._pulseArrowFlash(tbUp, tbIndicator, 'upTimeout', 'active', 300);
tbUp.drawn = true;
mutations = 0;
c._refreshWsFlashTargets();
assert.ok(tbUp.classList.contains('active'), 'a refresh that finds the arrow drawn copies its state onto it');
assert.strictEqual(mutations, 1, 'one class write for the copy');
advance(300);
assert.ok(!tbUp.classList.contains('active'), 'a drawn arrow flashes on its classList as before');
tbUp.drawn = false;
c._pulseArrowFlash(tbUp, tbIndicator, 'upTimeout', 'active', 300);
c._refreshWsFlashTargets();
assert.ok(!tbUp.classList.contains('active') && c._arrowHasState(tbUp, 'active'), 'undrawn again: back into the Set');
mutations = 0;
c.clearWebSocketIndicatorTimeouts();
assert.ok(!c._arrowHasState(tbUp, 'active'), 'clearing ends the held flash');
assert.strictEqual(mutations, 0, 'clearing writes no class that is not on');

// ---- 2. throttled flash: no frame until it is due --------------------------------------------
const c2 = client([]);
c2._wsFlashTargets = [{ arrow: new FakeEl('x'), timeoutKey: 'upTimeout', timeoutStore: {} }];
c2._wsFlashLastApply = now;
c2._wsFlashPendingUp = 300;
c2._queueWsFlashApply();
assert.strictEqual(frames.size, 0, 'throttled: no frame asked for yet');
assert.strictEqual(c2._wsFlashRafId, -1, 'the -1 wait marker is set');
advance(80);
assert.strictEqual(frames.size, 1, 'the frame is asked for when the gap ends');
frame();
assert.strictEqual(c2._wsFlashLastApply, now, 'and the flash lands on it');
c2._wsFlashPendingUp = 300;
advance(200);
c2._queueWsFlashApply();
assert.strictEqual(frames.size, 1, 'not throttled: straight to the frame');
frame();

// ---- 3. service worker tray icon: only real changes --------------------------------------------
const swIcon = add(new FakeEl('serviceWorkerTrayIcon', 'tray-icon hidden'));
add(new FakeEl('serviceWorkerTrayIconGlyph'));
window.serviceWorkerManager = {
    getServiceWorkerHeartbeatStatus: () => ({ available: true, isResponding: false, heartbeatMissed: true }),
    isUpdating: false, updateProgress: 0, updateAvailable: false,
    hasPendingUpdates: () => false, availableUpdateCount: () => 0
};
const c3 = client([]);
c3._updateServiceWorkerTrayIcon();
assert.ok(swIcon.classList.contains('sw-heartbeat-missed'));
mutations = 0;
c3._updateServiceWorkerTrayIcon();
assert.strictEqual(mutations, 0, 'an unchanged state writes nothing');
window.serviceWorkerManager.getServiceWorkerHeartbeatStatus = () => ({ available: false });
c3._updateServiceWorkerTrayIcon();
assert.ok(swIcon.classList.contains('sw-unavailable') && !swIcon.classList.contains('sw-heartbeat-missed'), 'one state class at a time');

// ---- 4. ping tooltip: in memory, written on hover --------------------------------------------
const dot = new FakeEl('websocketStatusMenubar');
const c4 = client([{ status: dot }]);
c4.getPingDisplayText = () => `WebSocket Status\nPing: ${c4.rtt}ms`;
c4.updatePingWarningIcon = () => {};
c4._updateMelatonLinkIndicators = () => {};
c4._updateModemTrayIcon = () => {};
c4.rtt = 40;
mutations = 0;
c4.updatePingDisplay();
c4.rtt = 41;
c4.updatePingDisplay();
assert.strictEqual(mutations, 0, 'pongs write no title');
dot.fire('pointerenter');
assert.strictEqual(dot.getAttribute('title'), 'WebSocket Status\nPing: 41ms', 'hover shows the current text');
c4.rtt = 42;
c4.updatePingDisplay();
assert.strictEqual(dot.getAttribute('title'), 'WebSocket Status\nPing: 42ms', 'live while the pointer is on it');
dot.fire('pointerleave');
mutations = 0;
c4.rtt = 43;
c4.updatePingDisplay();
assert.strictEqual(mutations, 0, 'and quiet again once it leaves');
c4._setIndicatorStatusTitle(dot, 'WebSocket Status\nDisconnected', true);
assert.strictEqual(dot.getAttribute('title'), 'WebSocket Status\nDisconnected', 'a status change is written at once');

// ---- 5. a window's class change only matters if it holds arrows ---------------------------------
const plainWindow = new FakeEl('someModal', 'modal');
plainWindow.matches = () => false;
assert.strictEqual(proto._isWsFlashVisibilityMutationTarget.call(c, plainWindow), false, 'a focus click on a window without arrows is ignored');
const dialWindow = new FakeEl('connectionDialModal', 'modal');
dialWindow.matches = () => false;
assert.strictEqual(proto._isWsFlashVisibilityMutationTarget.call(c, dialWindow), true, 'the connection dialogs still count');
const arrowWindow = new FakeEl('w2', 'modal');
arrowWindow.matches = () => false;
arrowWindow.querySelector = (sel) => (sel.includes('.websocket-indicator') ? {} : null);
assert.strictEqual(proto._isWsFlashVisibilityMutationTarget.call(c, arrowWindow), true, 'a window holding an indicator counts');

// ---- 6. ticker: cached elements, unchanged writes skipped --------------------------------------
const ticker = new FakeEl('t', 'websocket-ticker');
const tIcon = new FakeEl('ti', 'fas fa-info-circle websocket-ticker-icon');
const tText = new FakeEl('tt');
let tickerQueries = 0;
document.querySelectorAll = (sel) => {
    tickerQueries++;
    if (sel === '.websocket-ticker') return [ticker];
    if (sel === '.websocket-ticker-icon') return [tIcon];
    if (sel === '.websocket-ticker-text') return [tText];
    return [];
};
const bm = Object.create({
    tickerElements: lift('tickerElements'),
    _writeTicker: lift('_writeTicker'),
    showWebSocketTicker: lift('showWebSocketTicker'),
    hideWebSocketTicker: lift('hideWebSocketTicker')
});
bm.showWebSocketTicker('info', 'Generate Image', 'fa-spinner-third fa-spin', false);
assert.strictEqual(ticker.className, 'websocket-ticker expanded info');
assert.strictEqual(tText.textContent, 'Generate Image');
const q0 = tickerQueries;
mutations = 0;
bm.showWebSocketTicker('info', 'Generate Image', 'fa-spinner-third fa-spin', false);
assert.strictEqual(mutations, 0, 'the same ticker writes nothing');
assert.strictEqual(tickerQueries, q0, 'and looks nothing up');
bm.hideWebSocketTicker();
assert.ok(!ticker.classList.contains('expanded'));
mutations = 0;
bm.hideWebSocketTicker();
assert.strictEqual(mutations, 0, 'hiding a hidden ticker writes nothing');
ticker.isConnected = false;
bm.showWebSocketTicker('info', 'x', 'fa-check', false);
assert.ok(tickerQueries > q0, 'a ticker that has gone is looked up again');

// ---- 7. request names: one frozen table ---------------------------------------------------------
const bmSrc = src.slice(0, src.indexOf('\nclass WebSocketClient'));
const BM = new Function(`${bmSrc}; return BannerManager;`)();
assert.ok(Object.isFrozen(BM.REQUEST_TYPE_NAMES), 'the table is frozen');
assert.ok(Object.keys(BM.REQUEST_TYPE_NAMES).length > 500, 'and complete');
const fmt = BM.prototype.formatRequestType;
assert.strictEqual(fmt('generate_image'), 'Generate Image');
assert.strictEqual(fmt('workspace_image_added'), 'Image Added');
assert.strictEqual(fmt('no_such_type'), 'no_such_type', 'unknown types pass through');

// ---- 8. wsInboundRegistry: pre-sorted map, the dev flag read once -------------------------------
let reads = 0;
const store = { staticforge_dev_mode: 'false' };
const ctx = vm.createContext({
    console: { debug() {}, warn() {}, error() {} },
    localStorage: { getItem: (k) => { reads++; return store[k] ?? null; } },
    Map, Set, Array, Number, String
});
vm.runInContext(fs.readFileSync(path.join(root, 'public/scripts/ws/wsInboundRegistry.js'), 'utf8'), ctx);
const order = [];
const reg = (id, type, priority, extra) => vm.runInContext('registerWsInboundHandler', ctx)(Object.assign({ id, type, priority, handler: () => order.push(id) }, extra));
reg('a', 'm', 0);
reg('b', 'm', 5);
const unC = reg('c', 'm', 0);
reg('d', 'other', 1, { alias: ['m', 'other'] });
reg('e', 'm', 0, { phase: 'pre' });
const dispatch = vm.runInContext('dispatchWsInbound', ctx);
assert.strictEqual(dispatch({ type: 'm' }, null, 'post'), true);
assert.deepStrictEqual(order, ['b', 'd', 'a', 'c'], 'priority first, registration order among equals, aliases included');
order.length = 0;
dispatch({ type: 'other' }, null, 'post');
assert.deepStrictEqual(order, ['d'], 'an alias equal to its type runs once');
order.length = 0;
unC();
dispatch({ type: 'm' }, null, 'post');
assert.deepStrictEqual(order, ['b', 'd', 'a'], 'unregister takes it out of every key');
order.length = 0;
dispatch({ type: 'm' }, null, 'pre');
assert.deepStrictEqual(order, ['e'], 'phases are separate');
const r0 = reads;
for (let i = 0; i < 20; i++) assert.strictEqual(dispatch({ type: 'nobody' }, null, 'post'), false);
assert.strictEqual(reads - r0, 0, 'misses do not read localStorage each time');
store.staticforge_dev_mode = 'true';
assert.strictEqual(vm.runInContext('isWsInboundDevLogEnabled(true)', ctx), true, 'a refresh reads the flag again');

console.log('test-ws-indicator-writes: ok');
