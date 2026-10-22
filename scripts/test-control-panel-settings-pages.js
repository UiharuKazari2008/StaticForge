#!/usr/bin/env node
// Personalization and Global Settings live in Control Panel (Yozora #445, Yukimi 2026-10-12). The
// old settings window and its forms (#desktopSettingsModal) are gone (2026-10-22): Personalization
// is Vista's hub (cplPersonalization.js) and Keyboard is a page of its own with one check box.
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
for (const id of ['personalization', 'appearance', 'sound', 'taskbar', 'keyboard']) assert.ok(ids.includes(id), `${id} is listed`);
assert.ok(!ids.includes('global-settings'), 'the Global Settings item is gone');
assert.ok(!ids.includes('mouse'), 'pointer schemes were dropped');
// Personalization is Vista's hub (cplPersonalization.js, 2026-10-21): Window Color and Appearance
// opens its page there, Sound opens Vista's Sound dialog (personalizationDialogs.js)
assert.ok(String(cpl._test.items.find((i) => i.id === 'keyboard').open).includes("navigate('keyboard')"), 'keyboard opens its own page');
assert.ok(String(cpl._test.items.find((i) => i.id === 'appearance').open).includes("'window-color'"), 'Window Color and Appearance opens its Personalization page');
assert.ok(String(cpl._test.items.find((i) => i.id === 'sound').open).includes('personalizationDialogs.openSound()'), 'Sound opens the Sound dialog');
// Taskbar and Start Menu opens Vista's Properties dialog (public/scripts/comp/taskbarProperties.js)
assert.ok(String(cpl._test.items.find((i) => i.id === 'taskbar').open).includes("taskbarSettings.openProperties('taskbar')"), 'Taskbar and Start Menu opens its Properties dialog');
assert.ok(!/openDesktopSettingsModal/.test(String(cpl._test.items.find((i) => i.id === 'personalization').open)), 'Personalization navigates instead of opening the old window');

// wiring in modalUtils.js / app.html / CSS
const js = read('public/scripts/comp/modalUtils.js');
assert.ok(!js.includes("cpl.registerPage('personalization'"), 'the hub is cplPersonalization.js\'s page');
assert.ok(read('public/scripts/comp/cplPersonalization.js').includes("c.registerPage('personalization'"), 'the hub is registered');
// Theme is a dialog, the glass and live dragging live on Window Color and Appearance (2026-10-21)
assert.ok(!js.includes("cpl.registerPage('theme'") && read('public/scripts/comp/personalizationDialogs.js').includes('function openTheme()'), 'Theme Settings is a dialog');
assert.ok(js.includes("cpl.registerPage('keyboard'") && js.includes('id="cplVirtualKeyboardCheck"'), 'Keyboard is its own page with the check box');
assert.ok(js.includes('setDesktopVirtualKeyboardEnabled(check.checked)'), 'the check box saves as it changes');
assert.ok(!js.includes("['sound', ") && !js.includes("['appearance', "), 'no Sound or Appearance Settings page');
assert.ok(read('public/scripts/comp/cplPersonalization.js').includes('Show window contents while dragging'), 'live dragging on Window Color and Appearance');
assert.ok(!js.includes("['taskbar', 'Taskbar and Start Menu'"), 'no Taskbar and Start Menu page: the item opens the Properties dialog');
assert.ok(js.includes("cpl.open(scope === 'global' ? 'window-color' : 'personalization')"), 'openDesktopSettingsModal opens the page');
const html = read('public/app.html');
assert.ok(!html.includes('id="desktopSettingsModal"') && !html.includes('id="desktopSettingsLayout"'), 'the old settings window is gone');
assert.ok(!js.includes('mountDesktopSettingsInControlPanel') && !js.includes('prepareDesktopSettingsForm'), 'and its form code');

const mcp = read('public/scripts/comp/melatonControlPanel.js');
assert.ok(/unmountPage\(\);\s*const main = el\('\.cpl-main'\);/.test(mcp), 'pages unmount before every re-render');
assert.ok(/function close\(\) \{\s*stopTimers\(\);\s*unmountPage\(\);/.test(mcp), 'and when the window closes');

// featureLoader loads Control Panel long after DOMContentLoaded: it registers modalUtils.js's pages itself
const registered = [];
globalThis.registerDesktopSettingsControlPanelPages = () => registered.push('desktop-settings');
delete require.cache[require.resolve('../public/scripts/comp/melatonControlPanel.js')];
require('../public/scripts/comp/melatonControlPanel.js');
delete globalThis.registerDesktopSettingsControlPanelPages;
assert.deepStrictEqual(registered, ['desktop-settings'], 'the Keyboard page exists when Control Panel is opened first');

assert.ok(read('public/scripts/comp/taskbarProperties.js').includes('useApplicationImageIcon'), 'Taskbar and Start Menu Properties has the application image icon option');
assert.ok(js.includes('useApplicationImageIcon') && js.includes("classList.toggle('use-app-image-icons'"), 'the checkbox is saved and applied on the taskbar');
const shell = read('public/css/desktop-shell.css');
assert.ok(shell.includes('body.desktop-mode:is(.use-app-image-icons, .taskbar-orb) .taskbar-window-item .icon-image'), 'the checkbox uses the same taskbar picture as the Orb');
assert.ok(shell.includes('body.desktop-mode.use-app-image-icons .modal-window-title-main .icon-image'), 'the same checkbox uses that picture in the window caption');
assert.ok(read('modules/websocketHandlers.js').includes('useApplicationImageIcon: desktop.useApplicationImageIcon === true'), 'the setting is kept in user global settings');
assert.ok(read('modules/configManager.js').includes('useApplicationImageIcon: false'), 'new configs default the checkbox off');
assert.ok(mcp.includes('data-cpl-action="open"') && !mcp.includes("modal.addEventListener('dblclick'"), 'one click opens an item, no double open');

console.log('test-control-panel-settings-pages: ok');
