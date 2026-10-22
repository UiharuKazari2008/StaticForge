#!/usr/bin/env node
// Taskbar and Start Menu Properties + the Vista taskbar (2026-10-21): settings store, dialog-unit
// mapping, clock calendar, tray behaviours, wiring and art. Run: node scripts/test-taskbar-properties.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const store = {};
global.window = global;
global.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };
global.CustomEvent = class { constructor(t, o) { this.type = t; this.detail = o && o.detail; } };
global.dispatchEvent = () => true;

// settings: Vista's defaults, normalisation, persistence
require('../public/scripts/comp/taskbarSettings.js');
const ts = global.taskbarSettings;
assert.strictEqual(ts.get().locked, true);
assert.strictEqual(ts.get().autoHide, false);
assert.strictEqual(ts.normalize({ recentProgramCount: 99 }).recentProgramCount, 30);
ts.set({ autoHide: true, places: { games: false } });
assert.strictEqual(JSON.parse(store['desktop-taskbar-settings']).autoHide, true, 'saved on this computer');
assert.strictEqual(ts.get().places.games, false);
ts.set({ places: { games: true } });
assert.ok(!('games' in ts.get().places), 'a place turned back on leaves the map');

// clock: Vista's month calendar (October 2026 starts on Thursday: Sep 27 leads)
require('../public/scripts/comp/taskbarClock.js');
const grid = global.taskbarClockFlyout._test.monthGrid(2026, 9, 0);
assert.strictEqual(grid.length, 42);
assert.strictEqual(grid[0].day, 27);
assert.strictEqual(grid[0].inMonth, false);
assert.strictEqual(grid[4].day, 1);

// dialog units: MapDialogRect rounding, measured on the VM (Lock the taskbar box at page 20,74)
require('../public/scripts/comp/taskbarProperties.js');
const dlu = global.taskbarProperties._test.dlu;
assert.strictEqual(dlu(13, 45, 200, 10), 'left:20px;top:73px;width:300px;height:16px;');
assert.strictEqual(dlu(6, 6, 240, 121), 'left:9px;top:10px;width:360px;height:196px;', 'group box edges');

// tray: legacy "not always shown" list migrates; Vista's default is Hide when inactive
const trayContext = () => {
    const c = vm.createContext({ localStorage: global.localStorage, document: { getElementById: () => null, querySelector: () => null }, Date, JSON, Set, Map, setTimeout, clearTimeout });
    vm.runInContext(read('public/scripts/comp/trayRegistry.js'), c);
    return c;
};
let tray = trayContext();
assert.strictEqual(vm.runInContext("trayIconBehavior('dovecoteTrayIcon')", tray), 'inactive');
store['desktop-tray-overflow-icons'] = JSON.stringify(['searchIndexingIndicator']);
tray = trayContext();
assert.strictEqual(vm.runInContext("trayIconBehavior('searchIndexingIndicator')", tray), 'hide');
assert.strictEqual(vm.runInContext("trayIconBehavior('dovecoteTrayIcon')", tray), 'show');
// the saved behaviours are read once, not once per icon per sync (the review's tray finding)
let trayReads = 0;
const countingStorage = { getItem: (k) => { trayReads += 1; return global.localStorage.getItem(k); }, setItem: global.localStorage.setItem };
const tray2 = vm.createContext({ localStorage: countingStorage, document: { getElementById: () => null, querySelector: () => null }, Date, JSON, Set, Map, setTimeout, clearTimeout });
vm.runInContext(read('public/scripts/comp/trayRegistry.js'), tray2);
for (let i = 0; i < 20; i++) vm.runInContext("trayIconBehavior('dovecoteTrayIcon')", tray2);
assert.ok(trayReads <= 3, `tray behaviours read ${trayReads} times`);

// wiring
const html = read('public/app.html');
for (const f of ['css/vista-taskbar.css', 'scripts/comp/taskbarSettings.js', 'scripts/comp/taskbarClock.js']) assert.ok(html.includes(f), f);
assert.ok(!html.includes('trayOverflowFlyout'), 'hidden icons expand in place, no flyout');
assert.ok(read('public/scripts/comp/featureLoader.js').includes("scripts: ['scripts/comp/taskbarProperties.js']"));
const mu = read('public/scripts/comp/modalUtils.js');
assert.ok(mu.includes('taskbarGroupingEnabled() && modals.length > 3'), 'Group similar taskbar buttons');
assert.ok(mu.includes("!taskbar.classList.contains('taskbar-autohide')"), 'auto-hide gives windows the screen');
assert.ok(!read('public/css/vista-glass-controls.css').includes('slice 5, #443'), 'the gradient buttons are replaced by Vista faces');

// art (PNG IHDR sizes)
const size = (f) => { const b = fs.readFileSync(path.join(ROOT, 'public/static_images/vista-taskbar', f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
assert.deepStrictEqual(size('start-orb.png'), [60, 138]);
assert.deepStrictEqual(size('button-normal.png'), [134, 29]);
assert.deepStrictEqual(size('button-flash.png'), [134, 29]);
assert.deepStrictEqual(size('tray-chevron.png'), [19, 60]);

// Start menu options: icon sizes and the two power buttons
assert.strictEqual(ts.normalize({ programsIconSize: 'huge', powerButton: 'logoff', lockButton: 'restart' }).programsIconSize, 'small');
assert.strictEqual(ts.normalize({ powerButton: 'logoff' }).powerButton, 'logoff');
assert.strictEqual(ts.normalize({ lockButton: 'restart' }).lockButton, 'lock', 'the lock button has no restart');
assert.strictEqual(ts.get().startIconSize, 'large', 'Vista: Use large icons is on');
assert.strictEqual(ts.normalize({ largeIcons: false }).startIconSize, 'small', 'the first build\'s setting carries over');
assert.strictEqual(ts.normalize({ startIconSize: 'medium' }).startIconSize, 'medium');
assert.ok(mu.includes('START_MENU_POWER_BUTTONS[prefs.powerButton]') && mu.includes('START_MENU_LOCK_BUTTONS[prefs.lockButton]'), 'the buttons follow the settings');
const shell = read('public/css/desktop-shell.css');
assert.ok(shell.includes('#startMenu[data-start-size="medium"]') && shell.includes('#startMenu[data-programs-size="large"]'));
for (const f of ['disconnect.png', 'lock-logoff.png']) {
    const b = fs.readFileSync(path.join(ROOT, 'public/static_images/vista-start', f));
    assert.deepStrictEqual([b.readUInt32BE(16), b.readUInt32BE(20)], [70, 90], f);
}

// account names (User Accounts' Change the account name)
const ap = require('../modules/accountPictures.js');
assert.strictEqual(ap.describe({ accountNames: { administrator: 'Yukimi' } }).administrator.name, 'Yukimi');
assert.strictEqual(ap.describe({}).guest.name, 'Guest');
assert.strictEqual(ap.normalizeName('  Yukimi Kazari '), 'Yukimi Kazari');
for (const bad of ['', 'a/b', 'x'.repeat(21), '...']) assert.throws(() => ap.normalizeName(bad), /name|characters/i, bad);
const handler = read('modules/ws/handlers/270-accountPicturesHandler.js');
assert.ok(handler.includes("reg('set_account_name', handleSetName, { destructive: true })"));
assert.ok(read('modules/websocketHandlers.js').includes("'set_account_name',"), 'listed with the destructive packets');
assert.ok(read('web_server.js').includes("logonName: accountPictures.accountName(config, 'administrator')"), '/status names the Administrator');
store.userType = 'admin';
store.meletonAccounts = JSON.stringify({ administrator: { name: 'Yukimi', url: '/static_images/account-pictures/fireworks.png' } });
delete require.cache[require.resolve('../public/scripts/comp/meletonAccounts.js')];
const accounts = require('../public/scripts/comp/meletonAccounts.js');
assert.strictEqual(accounts.name(), 'Yukimi', 'the cached name before the session is up');
assert.strictEqual(accounts.pictureUrl(), '/static_images/account-pictures/fireworks.png', 'the assigned picture, not the kitten');
assert.ok(accounts.matchesLogonName('yukimi') && accounts.matchesLogonName('Administrator') && !accounts.matchesLogonName('Guest'));
assert.strictEqual(accounts.name('guest'), 'Guest');
for (const f of ['public/scripts/websocket.js', 'public/scripts/comp/workstationLock.js', 'public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js']) {
    assert.ok(read(f).includes('meletonAccount'), `${f} shows the account's name`);
}
assert.ok(read('public/scripts/comp/cplUserAccounts.js').includes("link('Change your account name', 'rename', true)"));

// closing a Customize dialog: it fades out on top, the owner comes back after (Yukimi 2026-10-21)
const tp = read('public/scripts/comp/taskbarProperties.js');
assert.ok(/closeWindow\(sub\.modal\)\.then\(\(\) => \{[\s\S]*?bringModalToFront', owner\)/.test(tp), 'the owner is raised only after the dialog has closed');
assert.ok(!/closeWindow\(sub\.modal\);\s*callGlobal\('openModal', dlg\.modal\)/.test(tp));

// Quick Launch: an editable list
assert.deepStrictEqual(ts.DEFAULTS.quickLaunchItems, ['show-desktop', 'switch-windows', 'encyclopedia', 'media-player']);
assert.deepStrictEqual(ts.normalize({ quickLaunchItems: ['a', 'a', 'bad id!', 'b'] }).quickLaunchItems, ['a', 'b'], 'unique, safe ids');
assert.strictEqual(ts.addQuickLaunch('studio'), true);
assert.strictEqual(ts.addQuickLaunch('studio'), false, 'once');
assert.ok(ts.hasQuickLaunch('studio'));
assert.strictEqual(ts.removeQuickLaunch('studio'), true);
assert.ok(!ts.hasQuickLaunch('studio'));
assert.ok(mu.includes("action: 'add-to-quick-launch'") && read('public/scripts/comp/desktopShortcuts.js').includes("case 'add-to-quick-launch':"), 'Add to Quick Launch on Start menu items and desktop shortcuts');
const vt = read('public/css/vista-taskbar.css');
assert.ok(vt.includes('.taskbar-start:not(:has(> .taskbar-start-button.orb)) + .taskbar-quick-launch') && vt.includes('padding: 0 0 0 3px;'), 'Quick Launch spacing after a text Start button, icons 3 px in');

// the Start button lives on the Taskbar tab; Orb greys out Logo and Text
// the Start button group moved down under the taskbar Opacity slider (2026-10-21)
assert.ok(tp.includes("group(6, 142, 240, 58, 'Start button')") && tp.includes("c.querySelector('#tbp-sb-text').disabled = orb;"));
assert.ok(!tp.includes("node('Start button',"), 'no longer in Customize Start Menu');

// Recent Items: per workspace, documents only
global.activeWorkspace = 'ws-a';
const ri = require('../public/scripts/comp/recentItems.js');
ri.clear();
ri.add({ kind: 'page', key: 'session-1', title: 'Page one', data: { url: 'a' } });
ri.add({ kind: 'page', key: 'session-1', title: 'Page two', data: { url: 'b' } });
ri.add({ kind: 'file', key: '/x.txt', title: 'x.txt' });
assert.deepStrictEqual(ri.list().map((e) => e.title), ['x.txt', 'Page two'], 'a browser session keeps one entry, its last page');
global.activeWorkspace = 'ws-b';
assert.strictEqual(ri.list().length, 0, 'per workspace');
global.activeWorkspace = 'ws-a';
for (let i = 0; i < 20; i++) ri.add({ kind: 'file', key: `/f${i}`, title: `f${i}` });
assert.strictEqual(ri.list().length, 15, "Vista's 15");
ts.set({ recentFiles: false });
assert.strictEqual(ri.add({ kind: 'file', key: '/no', title: 'no' }), false, 'Privacy off: nothing is recorded');
ts.set({ recentFiles: true });
assert.ok(!mu.includes('function getStartMenuRecentItems'), 'Recent Items are not programs');

// the preview bar keeps each style's own height (no stretched art); copies keep ids for their styles
assert.ok(tp.includes('const PREVIEW_BAR_HEIGHTS = { orb: 31, luna: 33, workspace: 35 };'));
const tsrc = read('public/scripts/comp/taskbarSettings.js');
assert.ok(tsrc.includes('function stripLiveAttributes(node)') && !tsrc.includes("removeAttribute('id')"), 'thumbnails keep ids');
assert.ok(vt.includes('margin: 6px 0 0;'), 'the group count sits on the label line');

// tray icon copies keep their ids (their Vista pictures are #id rules); the list's combo is pinned
assert.ok(!tp.includes("cl.removeAttribute('id')") && !tp.includes("glyph.removeAttribute('id')"));
const tpc = read('public/css/taskbar-properties.css');
assert.ok(tpc.includes('.tbp-list-row select.tbp-list-select') && tpc.includes('overflow-x: hidden;'));

// the previews draw like the taskbar: its colours and size, not the dialog's Tahoma 11 px
const tpc2 = read('public/css/taskbar-properties.css');
assert.ok(tpc2.includes(':is(button, input, select, label, span, div):not(.tbp-preview *)'), "the dialog's font stays out of the previews");
assert.ok(tp.includes('function barLook()') && tpc2.includes('var(--tbp-tray-color, #ccc)'));

assert.ok(!tp.includes('modal hidden on-top tbp-window'), 'Properties is not always on top');

// ---- a small DOM for what needs the taskbar element (review fixes, 2026-10-21) ----------------
function fakeDom() {
    class El {
        constructor(tag) {
            this.tagName = String(tag).toUpperCase();
            this.children = [];
            this.parentNode = null;
            this.dataset = {};
            this.attrs = {};
            this.listeners = {};
            this.id = '';
            this.title = '';
            const cls = new Set();
            this.classList = {
                contains: (c) => cls.has(c),
                add: (...c) => c.forEach((x) => cls.add(x)),
                remove: (...c) => c.forEach((x) => cls.delete(x)),
                toggle: (c, on) => { const v = on === undefined ? !cls.has(c) : !!on; if (v) cls.add(c); else cls.delete(c); return v; }
            };
            Object.defineProperty(this, 'className', { get: () => Array.from(cls).join(' '), set: (v) => { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach((x) => cls.add(x)); } });
            const props = {};
            this.style = { setProperty: (k, v) => { props[k] = v; }, removeProperty: (k) => { delete props[k]; }, getPropertyValue: (k) => props[k] || '' };
        }
        set textContent(v) { this.children.forEach((c) => { c.parentNode = null; }); this.children = []; this._text = v; }
        get textContent() { return this._text || ''; }
        appendChild(c) { c.parentNode = this; this.children.push(c); return c; }
        insertBefore(c, ref) { c.parentNode = this; const i = this.children.indexOf(ref); if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
        setAttribute(k, v) { this.attrs[k] = String(v); }
        removeAttribute(k) { delete this.attrs[k]; }
        addEventListener(t, fn) { (this.listeners[t] = this.listeners[t] || []).push(fn); }
        matches() { return false; }
        contains(n) { for (let x = n; x; x = x.parentNode) if (x === this) return true; return false; }
        querySelector() { return null; }
        querySelectorAll() { return []; }
        walk(fn) { fn(this); this.children.forEach((c) => c.walk(fn)); }
    }
    const tb = new El('div');
    tb.id = 'desktopTaskbar';
    const band = new El('div');
    band.id = 'taskbarWindows';
    tb.appendChild(band);
    const timers = [];
    const ctx = {
        localStorage: (() => { const st = {}; return { getItem: (k) => (k in st ? st[k] : null), setItem: (k, v) => { st[k] = String(v); }, removeItem: (k) => { delete st[k]; }, key: (i) => Object.keys(st)[i], get length() { return Object.keys(st).length; } }; })(),
        CustomEvent: global.CustomEvent,
        dispatchEvent: () => true,
        addEventListener: () => {},
        removeEventListener: () => {},
        setTimeout: (fn) => { timers.push(fn); return timers.length; },
        clearTimeout: () => {},
        requestAnimationFrame: () => 0,
        JSON, Math, Number, String, Array, Object, Set, Map, Date, Promise, console,
        refits: 0,
        known: new Set(),
        document: {
            readyState: 'complete',
            getElementById: (id) => { let hit = null; tb.walk((n) => { if (!hit && n.id === id) hit = n; }); return hit; },
            createElement: (t) => new El(t),
            addEventListener: () => {},
            querySelector: () => null,
            querySelectorAll: () => []
        }
    };
    ctx.window = ctx;
    ctx.refitMaximizedModals = () => { ctx.refits += 1; };
    ctx.syncRootStateFlags = () => {};
    ctx.findStartMenuLaunchableById = (id) => (ctx.known.has(id) ? { launchId: id, text: id, imageIcon: `${id}.png` } : null);
    vm.createContext(ctx);
    vm.runInContext(read('public/scripts/comp/taskbarSettings.js'), ctx);
    return { ctx, tb, timers, ts: ctx.taskbarSettings, bar: () => ctx.document.getElementById('taskbarQuickLaunch') };
}

// Opacity: clamped to 20-100; the slider previews on the taskbar without saving; Cancel puts it back
{
    assert.strictEqual(ts.normalize({ opacity: 5 }).opacity, 20);
    assert.strictEqual(ts.normalize({ opacity: 150 }).opacity, 100);
    assert.strictEqual(ts.normalize({ opacity: 'x' }).opacity, 100);
    assert.strictEqual(ts.normalize({ opacity: 57.6 }).opacity, 58);
    const { ctx, tb, ts: t2 } = fakeDom();
    t2.previewOpacity(40);
    assert.ok(tb.classList.contains('taskbar-custom-opacity'));
    assert.strictEqual(tb.style.getPropertyValue('--taskbar-opacity'), '0.4');
    assert.strictEqual(t2.get().opacity, 100, 'a preview is not saved');
    vm.runInContext(read('public/scripts/comp/taskbarProperties.js'), ctx);
    ctx.taskbarProperties._test.revertOpacityPreview();
    assert.ok(!tb.classList.contains('taskbar-custom-opacity'), 'Cancel puts the saved opacity back');
    assert.strictEqual(tb.style.getPropertyValue('--taskbar-opacity'), '');
    t2.set({ opacity: 10 });
    assert.strictEqual(tb.style.getPropertyValue('--taskbar-opacity'), '0.2', 'the slider floor is 20 %');
    ctx.taskbarProperties._test.revertOpacityPreview();
    assert.strictEqual(tb.style.getPropertyValue('--taskbar-opacity'), '0.2', 'an applied opacity stays');
    assert.ok(tp.includes('revertOpacityPreview();\n        const modal = dlg.modal;'), 'closing the sheet reverts the preview');
    const glass = read('public/css/aero-glass.css');
    assert.ok(glass.includes('html.disable-blur body:not(.has-active-maximized-window) .desktop-taskbar.taskbar-custom-opacity::after'),
        'a maximized window keeps the taskbar solid under Aero Basic too');

    // auto-hide on or off re-fits maximised windows to the new work area
    t2.set({ autoHide: true });
    assert.strictEqual(ctx.refits, 1);
    t2.set({ locked: false });
    assert.strictEqual(ctx.refits, 1, 'only when auto-hide changes');
    t2.set({ autoHide: false });
    assert.strictEqual(ctx.refits, 2);
}

// Apply sends only what the dialog changed: a Lock or Quick Launch change made meanwhile stays
{
    const corePatch = global.taskbarProperties._test.corePatch;
    const saved = { ...ts.normalize({}), places: { games: false } };
    const pending = JSON.parse(JSON.stringify(saved));
    pending.autoHide = true;
    pending.places = { help: false };
    assert.deepStrictEqual(corePatch(pending, saved), { autoHide: true, places: { games: true, help: false } });
    assert.deepStrictEqual(corePatch(saved, JSON.parse(JSON.stringify(saved))), {});
    ts.set({ locked: true, quickLaunchItems: ['show-desktop'] });
    ts.set({ locked: false, quickLaunchItems: ['show-desktop', 'calc'] }); // the taskbar menu and Add to Quick Launch
    ts.set(corePatch({ ...saved, autoHide: true }, saved));
    assert.strictEqual(ts.get().locked, false);
    assert.deepStrictEqual(ts.get().quickLaunchItems, ['show-desktop', 'calc']);
    assert.ok(tp.includes("root.addEventListener('taskbarsettingschange', onSettingsChange)"), 'the open dialog follows outside changes');
}

// Quick Launch: a launchId that never resolves stops retrying and shows as a deletable broken shortcut
{
    const { ctx, timers, ts: t3, bar } = fakeDom();
    ctx.known.add('calc');
    t3.set({ quickLaunchItems: ['show-desktop', 'calc', 'gone-app'] });
    assert.deepStrictEqual(bar().children.map((b) => b.dataset.quickLaunch), ['show-desktop', 'calc'], 'not found yet: left out while waiting');
    let rounds = 0;
    while (timers.length && rounds < 50) { timers.shift()(); rounds += 1; }
    assert.ok(rounds <= 12, `retries stop (${rounds} rounds)`);
    const broken = bar().children.find((b) => b.dataset.quickLaunch === 'gone-app');
    assert.ok(broken && broken.dataset.missing === 'true' && broken.dataset.contextMenu === 'vista-quick-launch-item', 'a broken shortcut you can delete');
    assert.ok(broken.children[0].src.endsWith('/vista-taskbar/program-16.png'), "Vista's generic program icon");
    t3.removeQuickLaunch('gone-app');
    assert.deepStrictEqual(bar().children.map((b) => b.dataset.quickLaunch), ['show-desktop', 'calc']);
    assert.deepStrictEqual(size('program-16.png'), [16, 16]);
    assert.deepStrictEqual(size('program-32.png'), [32, 32]);
}

// Recent Items: Privacy off clears every workspace; a reopened item does not come back twice
{
    global.activeWorkspace = 'ws-a';
    ri.clear();
    ri.add({ kind: 'file', key: 'user-file:7', title: 'a.txt' });
    ri.registerOpener('page', async () => { ri.add({ kind: 'page', key: 'new-session', title: 'Same page', data: { url: 'u' } }); });
    ri.add({ kind: 'page', key: 'old-session', title: 'Same page', data: { url: 'u' } });
    return ri.open(ri.list()[0]).then(() => {
        assert.deepStrictEqual(ri.list().map((e) => e.key), ['page:new-session', 'file:user-file:7'], 'the new browser session replaces the reopened entry');
        const src = read('public/scripts/comp/recentItems.js');
        assert.ok(src.includes("key: `${item.targetKind}:${id}`"), 'a file is keyed by itself, not the folder it was opened from');
        global.activeWorkspace = 'ws-b';
        ri.add({ kind: 'file', key: 'b', title: 'b' });
        store.removeItem = (k) => { delete store[k]; };
        global.localStorage.removeItem = store.removeItem;
        global.localStorage.key = (i) => Object.keys(store)[i];
        Object.defineProperty(global.localStorage, 'length', { get: () => Object.keys(store).length, configurable: true });
        ts.set({ recentFiles: false });
        assert.deepStrictEqual(ri.list(), []);
        assert.ok(!Object.keys(store).some((k) => k.startsWith('recentItems:')), 'Privacy off clears every workspace');
        ts.set({ recentFiles: true });
        assert.ok(mu.includes("container.querySelectorAll('[data-click-menu]').forEach((el) => contextMenu.detachClickMenuFromElement(el));"), 'the Start menu frees its old click menus');
        console.log('test-taskbar-properties: ok');
    });
}
