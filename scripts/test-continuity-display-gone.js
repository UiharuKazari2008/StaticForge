#!/usr/bin/env node
/**
 * Continuity PC with its display disconnected (Yukimi, Nov 20 2026, #1003): the phone's Continuity PC popup had no Shut Down,
 * and Install Now asked the unplugged DeX window to run its shutdown sequence (up to 60 s, crawling out of sight on
 * the phone window's own JavaScript thread) and then restarted it. Now Shut Down and a restart for updates close the
 * DeX window at once (dex-close), the update question says it shuts down, and it is not asked for its plan.
 *
 * Two pages of public/scripts/comp/melatonContinuity.js (phone + DeX window) in fake windows, joined by a fake
 * ContinuityBus (DSApp ContinuityBus.kt: post -> the other page's receive), plus wmShell's popup rule.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/melatonContinuity.js'), 'utf8');

const timers = [];
function makeWindow(role, bus) {
    const listeners = {};
    const doc = {
        visibilityState: role === 'desktop' ? 'hidden' : 'visible',
        hidden: role === 'desktop',
        addEventListener: () => {}, removeEventListener: () => {},
        getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
        documentElement: { classList: { contains: (c) => (role === 'phone' ? c === 'ui-mobile' : false), add() {}, remove() {} }, dataset: {} },
        createElement: () => ({ style: {}, classList: { add() {}, remove() {} }, appendChild() {}, setAttribute() {} }),
        body: { appendChild() {} },
    };
    const store = new Map();
    const win = {
        role,
        document: doc,
        navigator: { userAgent: 'test' },
        screen: { width: 1920, height: 1200 },
        devicePixelRatio: 1,
        location: { origin: 'https://example.test', pathname: '/app', replaced: [], replace(u) { this.replaced.push(u); } },
        localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
        sessionStorage: { getItem: () => null, setItem() {}, removeItem() {} },
        addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
        removeEventListener: () => {},
        dispatchEvent: () => true,
        setTimeout: (fn, ms) => { timers.push({ fn, ms: ms || 0, role }); return timers.length; },
        clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
        performance: { now: () => Date.now() },
        console,
        closed: [],
        AndroidHome: { getContinuity: () => JSON.stringify({ hybrid: true, dexSeen: true, home: role === 'phone', external: role === 'desktop' }), isHome: () => role === 'phone' },
        AndroidContinuity: {
            role: () => role,
            peers: () => JSON.stringify(bus.windows.filter((w) => w !== win && !w.gone).map((w) => w.role)),
            post: (json) => { const to = bus.windows.filter((w) => w !== win && !w.gone); bus.queue.push(...to.map((w) => [w, json, role])); return to.length > 0; },
            closeWindow: () => { win.closed.push(Date.now()); if (bus.appCloses) win.gone = true; },
        },
        wsClient: { initializationCompleted: true, isConnected: () => true },
        refreshes: 0,
    };
    win.wmShell = { refreshStatus: () => { win.refreshes += 1; } };
    win.MutationObserver = class { observe() {} disconnect() {} };
    win.window = win;
    win.globalThis = win;
    win.suppressWebSocketReconnectForReload = () => { win.suppressed = true; };
    return win;
}

function load(win) {
    const ctx = vm.createContext(win);
    for (const k of ['JSON', 'Math', 'Date', 'Promise', 'Map', 'Set', 'Array', 'Object', 'String', 'Number', 'Boolean', 'RegExp', 'Error', 'URL']) ctx[k] = globalThis[k];
    vm.runInContext(SRC, ctx, { filename: 'melatonContinuity.js' });
    return win.melatonContinuity;
}

async function flush(bus) {
    for (let i = 0; i < 50; i++) {
        await new Promise((r) => setImmediate(r));
        while (bus.queue.length) { const [w, json, from] = bus.queue.shift(); if (!w.gone && w.melatonContinuity) w.melatonContinuity.receive(json, from); }
        const due = timers.filter((t) => t.ms <= 0);
        due.forEach((t) => timers.splice(timers.indexOf(t), 1));
        due.forEach((t) => t.fn());
        if (!bus.queue.length && !due.length) break;
    }
}
const runTimers = (maxMs) => { const due = timers.filter((t) => t.ms <= maxMs); due.forEach((t) => timers.splice(timers.indexOf(t), 1)); due.forEach((t) => t.fn()); };

// wmShell.js's rule for the popup's buttons (kept in step with the source by the assertion below)
const WMSHELL = fs.readFileSync(path.join(ROOT, 'public/scripts/comp/wmShell.js'), 'utf8');
function popupButtons(mc) {
    const pc = mc.continuityPc();
    const live = !!(mc && typeof mc.dexPower === 'function' && pc && (pc.displayGone || (typeof mc.peers === 'function' && mc.peers().includes('desktop'))));
    return !live ? [] : pc.displayGone ? ['Shut Down'] : ['Shut Down', 'Restart'];
}

(async () => {
    assert.ok(WMSHELL.includes("pc.displayGone ? [shutDown] : [shutDown, { text: 'Restart'"), 'wmShell popup rule as tested here');

    const bus = { windows: [], queue: [], appCloses: true };
    const phone = makeWindow('phone', bus);
    const desk = makeWindow('desktop', bus);
    bus.windows.push(phone, desk);
    const pm = load(phone);
    const dm = load(desk);
    // the desktop joins and says it is up; its display is there
    pm.receive(JSON.stringify({ type: 'peer', state: 'joined', role: 'desktop' }), 'desktop');
    pm.receive(JSON.stringify({ type: 'dex-state', state: 'ready', attach: 'usb', width: 1920, height: 1200 }), 'desktop');
    await flush(bus);
    assert.deepStrictEqual(popupButtons(pm), ['Shut Down', 'Restart'], 'connected: Shut Down and Restart');
    assert.strictEqual(pm.dexDisplayGone(), false);

    // the display goes (the app's dex-display), the window keeps running
    pm.receive(JSON.stringify({ type: 'dex-display', state: 'removed' }), 'desktop');
    await flush(bus);
    assert.strictEqual(pm.dexDisplayGone(), true, 'display gone noticed');
    assert.deepStrictEqual(popupButtons(pm), ['Shut Down'], 'display gone: Shut Down is there, no Restart');

    // a restart for updates plans the desktop in without asking it
    const asked = [];
    const orig = desk.AndroidContinuity.post;
    dm.on('update-needs?', () => asked.push('update-needs?'));
    const plan = await pm.restartPlan(['/scripts/comp/modalUtils.js']);
    await flush(bus);
    assert.deepStrictEqual(plan.other, true, 'display gone: the desktop is part of the restart');
    assert.strictEqual(asked.length, 0, 'the unplugged window is not asked for its plan');
    desk.AndroidContinuity.post = orig;

    // the question says it shuts down
    let question = null;
    phone.uiShell = 'mobile';
    phone.showConfirmationDialog = (text) => { question = text; return Promise.resolve(true); };
    assert.strictEqual(await pm.confirmUpdateRestart({ self: true, other: true }), true);
    assert.ok(/will shut down/.test(question), `question: ${question}`);

    // Shut Down: the window closes at once, no shutdown sequence, no restart
    const ran = [];
    desk.runWinlogonPower = (kind) => { ran.push(kind); return Promise.resolve(true); };
    const ans = await pm.dexPower('shutdown');
    await flush(bus);
    assert.strictEqual(ans, 'done');
    assert.strictEqual(desk.closed.length, 1, 'the DeX window was closed');
    assert.deepStrictEqual(ran, [], 'no shutdown sequence ran');
    assert.ok(desk.suppressed, 'its reconnects stopped');
    assert.strictEqual(pm.continuityPc(), null, 'the phone no longer shows a Continuity PC');
    assert.deepStrictEqual(popupButtons(pm), [], 'no power buttons for a closed desktop');

    // an app that will not close a window whose display went: the page unloads itself, and the phone forgets it
    const bus2 = { windows: [], queue: [], appCloses: false };
    const phone2 = makeWindow('phone', bus2);
    const desk2 = makeWindow('desktop', bus2);
    bus2.windows.push(phone2, desk2);
    const pm2 = load(phone2);
    load(desk2);
    pm2.receive(JSON.stringify({ type: 'peer', state: 'joined', role: 'desktop' }), 'desktop');
    pm2.receive(JSON.stringify({ type: 'dex-state', state: 'ready' }), 'desktop');
    pm2.receive(JSON.stringify({ type: 'dex-display', state: 'removed' }), 'desktop');
    await flush(bus2);
    assert.strictEqual(pm2.closeDex(), true);
    await flush(bus2);
    runTimers(1500);
    assert.deepStrictEqual(desk2.location.replaced, ['about:blank'], 'page unloaded when the app keeps the window');
    assert.ok(!pm2.peers().includes('desktop'), 'the kept window no longer counts as the Continuity PC');
    // a new DeX window joins later: it counts again
    pm2.receive(JSON.stringify({ type: 'peer', state: 'joined', role: 'desktop' }), 'desktop');
    assert.ok(pm2.peers().includes('desktop'), 'a DeX window that joins again counts');

    console.log('continuity display gone: all checks passed');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
