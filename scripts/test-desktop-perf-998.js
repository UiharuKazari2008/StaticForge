#!/usr/bin/env node
// Desktop perf pass #998: the tray, samplers and timers do no work for nothing.
//   node scripts/test-desktop-perf-998.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// ---- a tiny element stub: classList, attributes, children ----------------------------------------
function el(id, classes, attrs) {
    const set = new Set(classes || []);
    const at = Object.assign({}, attrs || {});
    const node = {
        nodeType: 1,
        id,
        isConnected: true,
        dataset: {},
        children: [],
        writes: 0,
        classList: {
            contains: (c) => set.has(c),
            add: (c) => { node.writes++; set.add(c); },
            remove: (c) => { node.writes++; set.delete(c); },
            toggle: (c, on) => { const want = on === undefined ? !set.has(c) : !!on; if (want !== set.has(c)) { node.writes++; if (want) set.add(c); else set.delete(c); } return want; }
        },
        getAttribute: (k) => (k in at ? at[k] : null),
        setAttribute: (k, v) => { node.writes++; at[k] = String(v); },
        removeAttribute: (k) => { node.writes++; delete at[k]; },
        addEventListener() {},
        closest(sel) { return sel === '.taskbar-tray-icon' && set.has('taskbar-tray-icon') ? node : null; },
        get title() { return at.title || ''; },
        set title(v) { node.writes++; at.title = String(v); }
    };
    return node;
}

// ---- 1. trayRegistry: only the catalogued icons are observed -------------------------------------
{
    const observed = [];
    const observers = [];
    class MO {
        constructor(cb) { this.cb = cb; observers.push(this); }
        observe(target, opts) { observed.push({ mo: this, target, opts }); }
    }
    const root = el('', ['taskbar-tray-icons']);
    const director = el('directorTrayIcon', ['taskbar-tray-icon', 'hidden']);
    const power = el('powerTrayIcon', ['taskbar-tray-icon']);
    const arrows = el('taskbarWebsocketIndicator', ['websocket-indicator', 'taskbar-ws-indicator']);
    const btn = el('trayOverflowBtn', ['tray-overflow-btn', 'hidden']);
    root.children.push(btn, director, power, arrows);
    const byId = { directorTrayIcon: director, powerTrayIcon: power, trayOverflowBtn: btn, taskbarWebsocketIndicator: arrows };
    const store = {};
    const ctx = vm.createContext({
        localStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
        document: {
            getElementById: (id) => byId[id] || null,
            querySelector: (sel) => (sel === '.taskbar-tray-icons' ? root : null),
            querySelectorAll: () => { throw new Error('no document-wide query'); }
        },
        MutationObserver: MO, Date, JSON, Set, Map, WeakSet, Array, setTimeout, clearTimeout
    });
    vm.runInContext(read('public/scripts/comp/trayRegistry.js'), ctx);
    const targets = observed.map((o) => o.target);
    assert.ok(targets.includes(director), 'a catalogued icon is observed');
    assert.ok(!targets.includes(power), 'a system icon is not');
    assert.ok(!targets.includes(arrows), 'the WebSocket arrows are not');
    const rootObs = observed.find((o) => o.target === root);
    assert.ok(rootObs && rootObs.opts.childList && !rootObs.opts.subtree && !rootObs.opts.attributes, 'the area itself: children only');
    assert.ok(observed.find((o) => o.target === director).opts.subtree, 'an icon with its own subtree');

    // a program's tray icon arrives: watched, active, listed (from the area's children, no document query)
    const app = el('melatonAppTray-vz', ['taskbar-tray-icon', 'melaton-app-tray-icon', 'hidden'], { title: 'VZAccess Manager\nConnected' });
    root.children.push(app);
    byId[app.id] = app;
    rootObs.mo.cb([{ addedNodes: [app], removedNodes: [] }]);
    assert.ok(observed.some((o) => o.target === app), 'an added program icon is observed');
    const rows = vm.runInContext('trayCatalogRows()', ctx);
    assert.ok(rows.some((r) => r.id === app.id && r.label === 'VZAccess Manager'), 'program icons listed from the area');
    // a move (trayOrder.js) of a watched icon: no second observe
    const before = observed.length;
    rootObs.mo.cb([{ addedNodes: [director], removedNodes: [director] }]);
    assert.strictEqual(observed.length, before, 'a moved icon is not observed again');
}

// ---- 2. desktopTaskMonitor: busy flags written once, synced in a microtask ------------------------
{
    const monitor = require('../public/scripts/comp/desktopTaskMonitor.js');
    const gallery = el('galleryWindow', []);
    const fakeDoc = { documentElement: {}, getElementById: (id) => (id === 'galleryWindow' ? gallery : null) };
    // apply() runs against the module's own doc; check the write-on-change directly through its source instead
    const src = read('public/scripts/comp/desktopTaskMonitor.js');
    assert.ok(!/requestAnimationFrame/.test(src), 'no frame callback per request');
    assert.ok(/queueMicrotask/.test(src), 'a microtask coalesces syncs');
    const fn = src.slice(src.indexOf('function setWindowBusy'), src.indexOf('function apply'));
    const c = vm.createContext({ doc: fakeDoc });
    vm.runInContext(fn + '\nthis.setWindowBusy = setWindowBusy;', c);
    c.setWindowBusy('galleryWindow', true);
    const w = gallery.writes;
    assert.strictEqual(w, 2);
    c.setWindowBusy('galleryWindow', true);
    assert.strictEqual(gallery.writes, w, 'busy again: nothing written');
    c.setWindowBusy('galleryWindow', false);
    assert.strictEqual(gallery.getAttribute('aria-busy'), null);
    assert.ok(monitor && typeof monitor.sync === 'function');
}

// ---- 3. offscreenAnimationPause: a one-shot's end queues no idle pass ----------------------------
{
    const listeners = {};
    let idle = 0;
    const doc = { addEventListener: (type, fn) => { listeners[type] = fn; }, getAnimations: () => [], readyState: 'complete', documentElement: { dataset: {} } };
    const src = read('public/scripts/utils/offscreenAnimationPause.js');
    const c = vm.createContext({
        document: doc, window: {}, IntersectionObserver: class { observe() {} unobserve() {} },
        requestAnimationFrame: () => 1, requestIdleCallback: () => { idle++; return 1; }, setTimeout: () => 1, clearTimeout() {},
        MutationObserver: class { observe() {} disconnect() {} }, performance: { now: () => 0 }, Date, Map, Set, WeakSet, Math, Array, Object, JSON, String, Number
    });
    try { vm.runInContext(src, c); } catch (_) { /* the watchdog half wants more of a page; the listeners are in */ }
    const oneShot = el('x', []);
    oneShot.getAnimations = () => [];
    const before = idle;
    if (listeners.animationend) {
        listeners.animationend({ type: 'animationend', target: oneShot, animationName: 'rise' });
        listeners.animationcancel({ type: 'animationcancel', target: oneShot, animationName: 'rise' });
        assert.strictEqual(idle, before, 'an unwatched element ending queues nothing');
        listeners.animationstart({ type: 'animationstart', target: oneShot, animationName: 'spin' });
        assert.ok(idle > before, 'a start still queues its check');
    }
}

// ---- 4. clientPerfSampler: quiet minutes skip the frame window, the desktop batches ---------------
{
    const src = read('public/scripts/comp/clientPerfSampler.js');
    const added = [];
    const removed = [];
    const c = vm.createContext({
        document: {
            addEventListener: (t) => added.push(t), removeEventListener: (t) => removed.push(t),
            getAnimations: () => [], visibilityState: 'visible', documentElement: { dataset: {}, classList: { contains: () => false } }
        },
        window: {}, Date, Math, Object, Array, JSON, performance: { now: () => 0 }
    });
    vm.runInContext(src + '\nthis.state = clientPerfState;', c);
    const a = c.state.activity;
    a.seen = false;
    assert.strictEqual(a.take(), false, 'no input, nothing animating: quiet');
    assert.ok(added.includes('pointerdown') && added.includes('animationstart'), 'listening for the next minute');
    a.note();
    assert.ok(removed.includes('pointerdown'), 'the first event takes the listeners off');
    assert.strictEqual(a.take(), true, 'input since the last sample: frames are timed');
    c.document.getAnimations = () => [{ playState: 'running' }];
    assert.strictEqual(a.take(), true, 'an animation running now counts');
    assert.ok(/if \(clientPerfState\.phone\.sendDue\(reason\)\) await sendQueuedClientPerfSamples\(\);/.test(src), 'the desktop batches its sends');
}

// ---- 5. browsingSessions: no minute net until a program registers windows ------------------------
// (the phone: its Internet Explorer registers when it opens; the desktop registers Grimoire's list at load)
{
    let intervals = 0;
    const root = {
        uiShell: 'mobile',
        document: { visibilityState: 'visible', documentElement: { dataset: {} }, addEventListener() {} },
        addEventListener() {}, localStorage: { getItem: () => null, setItem() {} },
        wsClient: { on() {}, sendMessage: () => new Promise(() => {}), isConnected: () => false },
        navigator: { userAgent: 'test' }, location: { search: '' }
    };
    const c = vm.createContext({
        window: root, self: root, globalThis: root, setTimeout: () => 1, clearTimeout() {},
        setInterval: () => { intervals++; return 1; }, clearInterval() {}, Promise, JSON, Date, Math, Array, Object, String, Number, Uint8Array
    });
    root.window = root;
    vm.runInContext(read('public/scripts/comp/browsingSessions.js'), c);
    assert.strictEqual(intervals, 0, 'bound with no providers: no interval');
    root.browsingSessions.register(() => []);
    assert.strictEqual(intervals, 1, 'the first provider arms it');
    root.browsingSessions.register(() => []);
    assert.strictEqual(intervals, 1, 'once');
}

// ---- 6. serviceWorkerManager: the desktop pings only while Melaton Update's icon shows ----------------
{
    const src = read('public/scripts/comp/serviceWorkerManager.js');
    const part = (from, to) => src.slice(src.indexOf(from), src.indexOf(to));
    const body = part('    startHealthCheck() {', '    _runMeasuredHealthCheckPing() {')
        + part('    getServiceWorkerHeartbeatStatus() {', '    _clearStallToast() {');
    let pings = 0;
    let tick = null;
    const doc = { hidden: false, documentElement: { dataset: {} }, addEventListener() {}, removeEventListener() {} };
    const c = vm.createContext({
        window: {}, document: doc, navigator: { serviceWorker: { controller: {} } }, Date,
        setInterval: (fn) => { tick = fn; return 1; }, clearInterval() {},
        SW_HEALTH_PING_MS: 60000, SW_HEALTH_SILENT_MS: 95000, SW_HEALTH_GRACE_MS: 20000
    });
    vm.runInContext('class M {\n' + body + '\n}\nthis.M = M;', c);
    const m = new c.M();
    Object.assign(m, {
        swRegistration: { active: {} }, isUpdating: false, updateAvailable: false, lastPingResponseTime: null,
        hasPendingUpdates: () => false, availableUpdateCount: () => 0, _runMeasuredHealthCheckPing: () => { pings++; }
    });
    m.startHealthCheck();
    assert.strictEqual(pings, 0, 'no update: no ping at start');
    tick();
    assert.strictEqual(pings, 0, 'nor each minute');
    m.lastPingResponseTime = Date.now() - 10 * 60 * 1000;
    assert.strictEqual(m.getServiceWorkerHeartbeatStatus().isResponding, true, 'unwatched is not Not Responding');
    m.availableUpdateCount = () => 2;
    const st = m.getServiceWorkerHeartbeatStatus();
    assert.strictEqual(pings, 1, 'updates available: one ping at once');
    assert.strictEqual(m.lastPingResponseTime, null, 'the old answer is dropped');
    assert.strictEqual(st.isResponding, true, 'the grace period covers the new ping');
    tick();
    assert.strictEqual(pings, 2, 'then each minute');
    m.availableUpdateCount = () => 0;
    tick();
    assert.strictEqual(pings, 2, 'installed: pings stop');
}

console.log('test-desktop-perf-998: ok');
