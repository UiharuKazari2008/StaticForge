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
const tray = vm.createContext({ localStorage: global.localStorage, document: { getElementById: () => null, querySelector: () => null }, Date, JSON, Set, Map, setTimeout, clearTimeout });
vm.runInContext(read('public/scripts/comp/trayRegistry.js'), tray);
assert.strictEqual(vm.runInContext("trayIconBehavior('dovecoteTrayIcon')", tray), 'inactive');
store['desktop-tray-overflow-icons'] = JSON.stringify(['searchIndexingIndicator']);
assert.strictEqual(vm.runInContext("trayIconBehavior('searchIndexingIndicator')", tray), 'hide');
assert.strictEqual(vm.runInContext("trayIconBehavior('dovecoteTrayIcon')", tray), 'show');

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

console.log('test-taskbar-properties: ok');
