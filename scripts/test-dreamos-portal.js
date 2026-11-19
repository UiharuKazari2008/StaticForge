#!/usr/bin/env node
// Captive portal sign-in on DreamOS (#910): public/scripts/comp/dreamosPortal.js against a stub host, tray and Grimoire.
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

function world(withHost) {
    const listeners = {};
    const calls = { open: 0, close: 0, check: 0, balloons: [], reconnect: 0, closedViews: 0, tabs: [], sync: 0 };
    let hostState = { state: 'online', network: null, session: null };
    const shells = [];
    const bar = { on: false, classList: { toggle: (c, on) => { if (c === 'net-portal') bar.on = !!on; } } };
    const root = {
        document: { readyState: 'complete', getElementById: (id) => (id === 'modemTrayIcon' ? { id } : null), addEventListener() {}, querySelector: (s) => (s === '.desktop-taskbar' ? bar : null) },
        addEventListener: (t, f) => { (listeners[t] = listeners[t] || []).push(f); },
        dispatchEvent: (e) => { (listeners[e.type] || []).forEach((f) => f(e)); return true; },
        CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } },
        innerWidth: 1280, innerHeight: 800, devicePixelRatio: 2,
        PopoverManager: { showPopover: (...a) => { calls.balloons.push(a); return {}; } },
        wsClient: {
            handlers: {},
            on(t, f) { this.handlers[t] = f; },
            _syncTaskbarNetFlags() { calls.sync++; },
            _updateModemTrayIcon() {},
            _reconnectOnFocusRegain() { calls.reconnect++; }
        },
        featureLoader: { loadFeature: () => Promise.resolve() },
        grimoireCloseLocalAlchemy: Object.assign((s) => { calls.closedViews++; shells.splice(shells.indexOf(s), 1); }, { shells: () => shells }),
        grimoireOpenInTab: (t) => { calls.tabs.push(t); shells.push({ _grimoireLocalAlchemy: true }); return true; }
    };
    root.CustomEvent = root.CustomEvent;
    if (withHost) {
        root.DreamOSPortal = {
            get: () => hostState,
            check: () => { calls.check++; return Promise.resolve(hostState); },
            open: (size) => { calls.open++; calls.size = size; return Promise.resolve({ ok: true, id: 'local-1', view: '/api/grimoire-browser/view/local-1', viewUrl: 'http://127.0.0.1:47910/api/grimoire-browser/view/local-1?t=x&scale=2', url: 'http://server.test/' }); },
            close: () => { calls.close++; return Promise.resolve({ ok: true }); }
        };
    }
    const ctx = vm.createContext({ window: root, CustomEvent: root.CustomEvent, Promise, module: undefined });
    vm.runInContext(read('public/scripts/comp/dreamosPortal.js'), ctx);
    const push = (s) => { hostState = s; root.dispatchEvent(new root.CustomEvent('dreamosportal', { detail: s })); };
    return { root, calls, push, bar, api: root.dreamosPortal };
}

(async () => {
    // every client but DreamOS: inert
    {
        const w = world(false);
        assert.strictEqual(w.api.available(), false);
        assert.strictEqual(w.api.captive(), false);
        assert.strictEqual(await w.api.openBrowser(), false);
        assert.strictEqual(w.calls.balloons.length, 0);
    }
    // no portal: nothing shown
    {
        const w = world(true);
        w.push({ state: 'online', network: 'Home', session: null });
        assert.strictEqual(w.calls.balloons.length, 0, 'no balloon on an open network');
        assert.strictEqual(w.api.captive(), false);
    }
    // portal -> balloon on the network icon -> click opens Grimoire on the local Alchemy -> online closes it
    {
        const w = world(true);
        w.push({ state: 'portal', network: 'Hotel Lapis', url: 'http://10.77.0.1/login', session: null, probe: 'http://server.test/' });
        assert.strictEqual(w.api.captive(), true);
        assert.strictEqual(w.api.networkName(), 'Hotel Lapis');
        assert.strictEqual(w.calls.balloons.length, 1, 'one balloon');
        const b = w.calls.balloons[0];
        assert.strictEqual(b[0].id, 'modemTrayIcon', 'on the network tray icon');
        assert.strictEqual(b[2], 'Additional log on information may be required.');
        assert.strictEqual(b[3], 'Click to open your browser.');
        assert.ok(b[5] > 0, 'closes by itself');
        assert.strictEqual(b[8].popupId, 'network-portal');
        assert.deepStrictEqual([b[8].position, b[8].arrowPosition], ['top', 'bottom-right']);
        assert.strictEqual(w.bar.on, true, 'the tray icon is marked');
        // the same state again (a re-push): no second balloon
        w.push({ state: 'portal', network: 'Hotel Lapis', url: 'http://10.77.0.1/login', session: null, probe: 'http://server.test/' });
        assert.strictEqual(w.calls.balloons.length, 1);
        b[8].onClick();
        await new Promise((r) => setTimeout(r, 10));
        assert.strictEqual(w.calls.open, 1, 'the host starts the local Alchemy');
        assert.strictEqual(w.calls.size.scale, 2, 'at the screen\'s scale');
        assert.strictEqual(w.calls.tabs.length, 1);
        assert.strictEqual(JSON.stringify(w.calls.tabs[0].session), JSON.stringify({ sessionId: 'local-1', viewUrl: 'http://127.0.0.1:47910/api/grimoire-browser/view/local-1?t=x&scale=2', local: true }));
        // asked again while it shows: no second session
        await w.api.openBrowser();
        assert.strictEqual(w.calls.open, 1);
        // the link dropping asks the host for a check (an event, not a timer)
        w.root.wsClient.handlers.disconnected();
        assert.strictEqual(w.calls.check, 1);
        // the host says the session runs, then ends it while the portal still holds (nobody looked at it): the view goes
        w.push({ state: 'portal', network: 'Hotel Lapis', url: 'http://10.77.0.1/login', session: { id: 'local-1' }, probe: 'http://server.test/' });
        w.push({ state: 'portal', network: 'Hotel Lapis', url: 'http://10.77.0.1/login', session: null, probe: 'http://server.test/' });
        assert.strictEqual(w.calls.closedViews, 1, 'a session the host ended takes its view along');
        assert.strictEqual(w.calls.balloons.length, 1, 'and no new balloon for the same network');
        await w.api.openBrowser();
        assert.strictEqual(w.calls.open, 2);
        w.push({ state: 'portal', network: 'Hotel Lapis', url: 'http://10.77.0.1/login', session: { id: 'local-2' }, probe: 'http://server.test/' });
        // signed in: the host says online
        w.push({ state: 'online', network: 'Hotel Lapis', url: null, session: null });
        assert.strictEqual(w.api.captive(), false);
        assert.strictEqual(w.calls.closedViews, 2, 'the sign-in tab goes');
        assert.strictEqual(w.bar.on, false, 'the tray icon is back to normal');
        assert.strictEqual(w.calls.reconnect, 1, 'the link reconnects now');
        // another network with a portal later: a new balloon
        w.push({ state: 'portal', network: 'Café', url: 'http://1.1.1.1/', session: null, probe: 'http://server.test/' });
        assert.strictEqual(w.calls.balloons.length, 2);
    }
    // the pieces around it
    {
        const src = read('public/scripts/comp/dreamosPortal.js');
        assert.ok(!/setInterval|setTimeout/.test(src), 'no timers');
        assert.ok(!/fetch\(/.test(src), 'nothing asked of the server');
        assert.ok(read('public/scripts/comp/popoverManager.js').includes('options.onClick'), 'balloons take a click action');
        assert.ok(read('public/scripts/comp/trayRegistry.js').includes("id: 'network-portal'"), 'the balloon can be switched off in Notifications');
        const ws = read('public/scripts/websocket.js');
        assert.ok(read('public/css/vista-glass-controls.css').includes('.desktop-taskbar.net-portal #modemTrayIconGlyph.fa-globe'), 'the tray globe shows limited behind a portal');
        assert.ok(ws.includes('Access: Local only'), 'Vista\'s wording in the tooltip');
        const g = read('public/scripts/comp/grimoireRemoteBrowser.js');
        assert.ok(g.includes('shell._grimoireLocalAlchemy = payload.local === true'), 'Grimoire takes the local session');
        assert.ok(/if \(local\) \{\s+if \(window\.dreamosPortal\) window\.dreamosPortal\.sessionClosed\(id\);\s+return Promise\.resolve\(\);/.test(g), 'closing it never asks the service');
        assert.ok(read('public/scripts/comp/grimoireTabs.js').includes("'_grimoireLocalAlchemy'"), 'the mark travels with its tab');
        const app = read('public/app.html');
        assert.ok(app.indexOf('scripts/comp/popoverManager.js') < app.indexOf('scripts/comp/dreamosPortal.js'), 'loaded after the balloons');
    }
    console.log('test-dreamos-portal: ok');
})().catch((e) => { console.error(e); process.exit(1); });
