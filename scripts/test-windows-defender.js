#!/usr/bin/env node
// Melaton Defender (Yukimi 2026-10-13): Security Center as Vista's Melaton Defender window, the
// authorised IPs under Allowed items. Run: node scripts/test-windows-defender.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
global.window = global;
const wd = require('../public/scripts/comp/windowsDefender.js');

assert.deepStrictEqual(Object.keys(wd.PAGES), ['quarantine', 'allowed', 'honeypot', 'history']);
assert.strictEqual(wd.PAGES.quarantine.view, 'blocked', 'Quarantined items are the blocked clients');
assert.strictEqual(wd.PAGES.allowed.view, 'auth', 'Allowed items are the approved IPs (auth view)');
assert.strictEqual(wd.PAGES.history.view, 'telemetry');
assert.strictEqual(wd.VIEW_TO_PAGE.blocked, 'quarantine');

const ok = wd._test.homeHtml({ blockedTotal: 3, blockedToday: 0, pathsTotal: 9, honeypotToday: 0, guest: true, checkedAt: 'Today at 9:00 AM' });
assert.ok(ok.includes('defender-banner--ok') && ok.includes('No unwanted or harmful activity detected.'));
const warn = wd._test.homeHtml({ blockedTotal: 3, blockedToday: 2, pathsTotal: 9, honeypotToday: 1, guest: false, checkedAt: 'Today at 9:00 AM' });
assert.ok(warn.includes('defender-banner--warn') && warn.includes('2 clients were blocked') && warn.includes('data-defender="quarantine"'));
assert.ok(warn.includes('<td>Guest sign-in:</td><td>Off</td>'));
const tools = wd._test.toolsHtml();
assert.ok(tools.includes('Tools and Settings') && tools.includes('Quarantined items') && tools.includes('Allowed items'));

// Security Center's launchers land in Defender on the Vista desktop
const sec = read('public/scripts/comp/securityCenterDsapApplet.js');
assert.ok(sec.includes('if (securityDsapOpenDefender(normalized)) return;'));
const man = read('public/scripts/comp/dsapManifests.js');
assert.ok(man.includes("text: 'Melaton Defender'") && man.includes("window.windowsDefender.open('home')"));
const loader = read('public/scripts/comp/featureLoader.js');
assert.ok(loader.includes("'scripts/comp/windowsDefender.js'") && loader.includes("'css/vista-defender.css'"), 'Defender loads with Control Panel');
const css = read('public/css/vista-defender.css');
assert.ok(css.includes('background: linear-gradient(to right, #4372a4, #68b472);'), "Defender's blue-to-green");
assert.ok(css.includes('.defender-list--allowed #secAuthView > :not(#secApprovedView)'), 'Allowed items shows the approved IPs only');
for (const f of ['logo.png', 'travel-gutter.png', 'back.png', 'forward-hot.png', 'home.png', 'tools-hot.png', 'quarantine-48.png', 'allowed-48.png', 'defender-32.png']) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public/static_images/vista-defender', f)), f);
}
console.log('test-windows-defender: ok');
