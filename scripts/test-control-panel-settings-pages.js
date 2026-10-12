#!/usr/bin/env node
// Personalization and Global Settings live in Control Panel (Yozora #445, Yukimi 2026-10-12): the
// desktop settings forms (#desktopSettingsLayout) are hosted by two Control Panel pages that move
// the live DOM in on mount and back out on unmount, and the forms take Vista's light controls there.
// Run: node scripts/test-control-panel-settings-pages.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const cpl = require('../public/scripts/comp/melatonControlPanel.js');

// registerPage: new ids only, a default task pane, the page reachable by id
const page = { title: () => 'Test', body: () => '<div class="cpl-settings-host"></div>', mount: () => {}, unmount: () => {} };
assert.strictEqual(cpl.registerPage('test-page', page), true, 'a new page registers');
assert.strictEqual(cpl.registerPage('test-page', page), false, 'an id is taken once');
assert.strictEqual(cpl.registerPage('home', page), false, 'built-in pages cannot be replaced');
assert.strictEqual(cpl.registerPage('no-body', { title: () => 'x' }), false, 'a page needs title and body');
assert.strictEqual(cpl._test.pages['test-page'].tasks(), '', 'tasks default to an empty pane');
assert.ok(cpl.taskLinkHtml('Global Settings', 'nav', 'global').includes('data-cpl-arg="global"'), 'task links for outside pages');

// the items: Personalization and Global Settings open their pages
const ids = cpl._test.items.map((i) => i.id);
assert.ok(ids.includes('personalization') && ids.includes('global-settings'), 'both items are listed');
assert.ok(!/openDesktopSettingsModal/.test(String(cpl._test.items.find((i) => i.id === 'personalization').open)), 'Personalization navigates instead of opening the old window');

// wiring in modalUtils.js / app.html / CSS
const js = read('public/scripts/comp/modalUtils.js');
assert.ok(js.includes("cpl.registerPage('personalization'") && js.includes("cpl.registerPage('global'"), 'the two pages are registered');
assert.ok(js.includes("cpl.open(scope === 'global' ? 'global' : 'personalization')"), 'openDesktopSettingsModal opens the page');
assert.ok(/const layout = document\.getElementById\('desktopSettingsLayout'\) \|\| modal;/.test(js), 'the scope switch works wherever the forms are');
assert.ok((js.match(/finishDesktopSettingsDialog\(\);/g) || []).length >= 5, 'saving / removing the wallpaper only closes the window when it is the one showing');
assert.ok(read('public/app.html').includes('<div id="desktopSettingsLayout" class="desktop-settings-layout">'), 'the forms have their id');
const css = read('public/css/desktop-settings.css');
assert.ok(!/#desktopSettingsModal(?![\w-])(?![^{]*cpl-settings-host)/.test(css.replace(/:is\(#desktopSettingsModal, #melatonControlPanelModal \.cpl-settings-host\)/g, '')), 'every settings rule reaches the Control Panel host');
assert.ok(css.includes('#melatonControlPanelModal .cpl-settings-host .gallery-toggle-group'), 'the light Vista controls are there');

const mcp = read('public/scripts/comp/melatonControlPanel.js');
assert.ok(/unmountPage\(\);\s*const main = el\('\.cpl-main'\);/.test(mcp), 'pages unmount before every re-render');
assert.ok(/function close\(\) \{\s*stopTimers\(\);\s*unmountPage\(\);/.test(mcp), 'and when the window closes');

console.log('test-control-panel-settings-pages: ok');
