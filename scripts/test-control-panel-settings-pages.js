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
assert.ok(cpl.taskLinkHtml('Taskbar and Start Menu', 'nav', 'taskbar').includes('data-cpl-arg="taskbar"'), 'task links for outside pages');

// the items: Personalization and Global Settings open their pages
const ids = cpl._test.items.map((i) => i.id);
// Global Settings is split into Vista's items (Yukimi 2026-10-13), one group of the global sections each
for (const id of ['personalization', 'appearance', 'mouse', 'sound', 'taskbar', 'keyboard']) assert.ok(ids.includes(id), `${id} is listed`);
assert.ok(!ids.includes('global-settings'), 'the Global Settings item is gone');
for (const id of ['appearance', 'mouse', 'sound', 'taskbar', 'keyboard']) {
    assert.ok(String(cpl._test.items.find((i) => i.id === id).open).includes(`navigate('${id}')`), `${id} opens its own page`);
}
assert.ok(!/openDesktopSettingsModal/.test(String(cpl._test.items.find((i) => i.id === 'personalization').open)), 'Personalization navigates instead of opening the old window');

// wiring in modalUtils.js / app.html / CSS
const js = read('public/scripts/comp/modalUtils.js');
assert.ok(js.includes("cpl.registerPage('personalization'") && /GLOBAL_PAGES\.forEach\(\(\[id, name, heading, intro\]\) => \{\s*cpl\.registerPage\(id/.test(js), 'the pages are registered');
for (const id of ['appearance', 'mouse', 'sound', 'taskbar', 'keyboard']) assert.ok(js.includes(`['${id}', `), `${id} page`);
assert.ok(js.includes("mountDesktopSettingsInControlPanel(main, 'global', id)"), 'each global page mounts its group');
assert.ok(/offGroup\(section\)/.test(js) && js.includes('section.dataset.desktopSettingsGroup !== desktopSettingsActiveGroup'), 'the scope switch hides the other groups');
assert.ok(js.includes("cpl.open(scope === 'global' ? 'appearance' : 'personalization')"), 'openDesktopSettingsModal opens the page');
const html = read('public/app.html');
const groups = [...html.matchAll(/data-desktop-settings-scope="global" data-desktop-settings-group="([a-z]+)"/g)].map((m) => m[1]);
assert.deepStrictEqual(groups, ['appearance', 'appearance', 'mouse', 'sound', 'taskbar', 'taskbar', 'taskbar', 'keyboard'], 'every global section has its group');
assert.ok(/const layout = document\.getElementById\('desktopSettingsLayout'\) \|\| modal;/.test(js), 'the scope switch works wherever the forms are');
assert.ok((js.match(/finishDesktopSettingsDialog\(\);/g) || []).length >= 5, 'saving / removing the wallpaper only closes the window when it is the one showing');
assert.ok(read('public/app.html').includes('<div id="desktopSettingsLayout" class="desktop-settings-layout">'), 'the forms have their id');
const css = read('public/css/desktop-settings.css');
assert.ok(!/#desktopSettingsModal(?![\w-])(?![^{]*cpl-settings-host)/.test(css.replace(/:is\(#desktopSettingsModal, #melatonControlPanelModal \.cpl-settings-host\)/g, '')), 'every settings rule reaches the Control Panel host');
assert.ok(css.includes('#melatonControlPanelModal .cpl-settings-host .gallery-toggle-group'), 'the light Vista controls are there');

const mcp = read('public/scripts/comp/melatonControlPanel.js');
assert.ok(/unmountPage\(\);\s*const main = el\('\.cpl-main'\);/.test(mcp), 'pages unmount before every re-render');
assert.ok(/function close\(\) \{\s*stopTimers\(\);\s*unmountPage\(\);/.test(mcp), 'and when the window closes');

assert.ok(js.includes("document.addEventListener('DOMContentLoaded', () => registerDesktopSettingsControlPanelPages());"), 'the pages exist before the old opener ever runs (Control Panel opened first)');
assert.ok(mcp.includes('data-cpl-action="open"') && !mcp.includes("modal.addEventListener('dblclick'"), 'one click opens an item, no double open');

console.log('test-control-panel-settings-pages: ok');
