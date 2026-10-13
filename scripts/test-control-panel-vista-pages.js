#!/usr/bin/env node
// Control Panel as Vista's (Yukimi 2026-10-13): Remote Access, Authentication (from Security Center)
// and MeletonFX Update are Control Panel pages; the update page takes the service worker's states
// in the foreground while it is open; the window has Explorer's chrome and Vista's task pane.
// Run: node scripts/test-control-panel-vista-pages.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// the update page's reading of service worker states
global.window = global;
global.serviceWorkerManager = { hasPendingUpdates: () => true };
const upd = require('../public/scripts/comp/cplUpdate.js');
const classify = upd._test.classify;
assert.strictEqual(classify('checking', 'Scanning for available updates…'), 'checking');
assert.strictEqual(classify('checking', 'Your app is already up to date!'), 'uptodate');
assert.strictEqual(classify('checking', 'Failed to check for updates. Please try again.'), 'failed');
assert.strictEqual(classify('available', 'Resource updates are available.'), 'available');
assert.strictEqual(classify('downloading', ''), 'downloading');
assert.strictEqual(classify('complete', 'Updates ready — apply without restart'), 'ready', 'CSS-only updates install live');
assert.strictEqual(classify('complete', 'Completed updating 3 files.'), 'restart', 'downloaded updates wait for a restart');
global.serviceWorkerManager = { hasPendingUpdates: () => false };
assert.strictEqual(classify('complete', ''), 'uptodate');

// Vista's balloons only when something needs you; the tooltip says the rest
const balloonFor = upd._test.balloonFor;
assert.strictEqual(balloonFor('checking'), null);
assert.strictEqual(balloonFor('downloading'), null);
assert.strictEqual(balloonFor('uptodate'), null);
assert.strictEqual(balloonFor('restart').title, 'Restart MeletonFX to finish installing updates');
assert.strictEqual(balloonFor('ready').title, 'Updates are ready to install');
assert.strictEqual(upd._test.tooltipFor('downloading', 40), 'Downloading updates (40%)');
const updJs = read('public/scripts/comp/cplUpdate.js');
assert.ok(updJs.includes("button: ['Check for updates', 'check']"), 'up to date offers Check for updates');
assert.ok(updJs.includes("installing: { band: 'blue', title: 'Installing updates…'"), 'installing has its own look');
assert.ok(updJs.includes('role="progressbar"'), "7.css bars (classic draws its own)");
const swmJs = read('public/scripts/comp/serviceWorkerManager.js');
assert.ok(swmJs.includes('const balloon = window.cplUpdate.balloonFor(pageState);') && swmJs.includes('_renderVistaUpdateBalloon'), 'the tray balloon is Vista\'s');
assert.ok(read('public/scripts/comp/mainMenuManager.js').includes('window.cplUpdate.open(() => sw.refreshServerCacheAndCheck())'), 'the tray check runs on the page');

// the foreground hook in the service worker manager
const swm = read('public/scripts/comp/serviceWorkerManager.js');
assert.ok(/if \(typeof this\.foregroundUpdateView === 'function' && popupKind !== 'runtime-compile'\) \{\s*this\._hideServiceWorkerTrayPopup\(\);/.test(swm), 'the open page takes the states and the balloon stays down');
assert.ok(swm.includes("localStorage.setItem('meletonUpdateCheckedAt'") && swm.includes("localStorage.setItem('meletonUpdateInstalledAt'"), 'check and install times for the facts');

// Remote Access hosted in Control Panel
const mu = read('public/scripts/comp/modalUtils.js');
assert.ok(mu.includes("cpl.registerPage('remote-access'") && mu.includes("cpl.open('remote-access')"), 'Remote Access is a Control Panel page');
assert.ok(read('public/app.html').includes('<div id="remoteAccessSettingsLayout" class="desktop-settings-layout">'), 'the form has its id');
assert.ok(read('public/scripts/comp/melatonControlPanel.js').includes("open: () => navigate('remote-access')"), 'the item opens the page');

// Authentication moved out of Security Center
const sec = read('public/scripts/comp/securityCenterDsapApplet.js');
assert.ok(!sec.includes('data-sec-tab="auth"'), 'Security Center has no Authentication tab');
assert.ok(sec.includes("if (view === 'auth' && !host.cplAuthentication && securityDsapOpenAuthInControlPanel()) view = 'home';"), 'old auth links land in Control Panel');
assert.ok(/function openSecurityCenterDsap\(view\) \{\s*if \(securityDsapNormalizeView\(view\) === 'auth' && securityDsapOpenAuthInControlPanel\(\)\) return;/.test(sec));
const auth = read('public/scripts/comp/cplAuthentication.js');
assert.ok(auth.includes('driver = Object.create(securityDsapDriver)') && auth.includes("getPathSegments: () => ['auth']"), 'the page runs its own driver on the auth view');
const html = read('public/app.html');
assert.ok(html.indexOf('scripts/comp/melatonControlPanel.js') < html.indexOf('scripts/comp/cplAuthentication.js')
    && html.indexOf('scripts/comp/cplAuthentication.js') < html.indexOf('scripts/comp/cplUpdate.js'), 'pages load after Control Panel');

// the look
const net = read('public/css/melaton-network.css');
for (const sel of ['.cpl-auth-host .sec-data-table th', '.cpl-wu-band--green', '.cpl-wu-progress', '#remoteAccessSettingsLayout .gallery-toggle-group .gallery-toggle-btn::before']) {
    assert.ok(net.includes(sel), sel);
}
assert.ok(net.includes('rgb(175, 233, 176)') && net.includes('rgb(252, 236, 100)') && net.includes('rgb(251, 130, 129)'), "Windows Update's band colours (wucltux.dll UIFILE)");
const vex = read('public/css/vista-explorer.css');
assert.ok(vex.includes("url('/static_images/vista-cpl/task-pane-swoosh.png') no-repeat left bottom / 200px auto,\n        linear-gradient(#416fa5, #69b570);"), "Vista's task pane");
assert.ok(/(#melatonControlPanelModal \.modal-window-title-toolbar \.naxt-nav-group) \{[^}]*height: 27px;[^}]*align-items: flex-start;[^}]*background: url\('\/static_images\/vista-explorer\/travel-gutter\.png'\) no-repeat 0 0;/.test(vex), "Explorer's orbs and gutter, the band the orbs' height");
for (const f of ['shield-ok.png', 'shield-warning.png', 'shield-error.png', 'key-32.png', 'windows-update-32.png', 'task-pane-swoosh.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-cpl', f)), f);
}

console.log('test-control-panel-vista-pages: ok');
