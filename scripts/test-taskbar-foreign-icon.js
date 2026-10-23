#!/usr/bin/env node
// A window whose caption icon is not an app_icons master (Vista's progress dialog:
// /static_images/vista-file-progress/progress-16.png) still gets its taskbar icon: no app_icons
// srcset naming files that do not exist (the browser took those and drew nothing), its own file,
// and its -32 twin for 2x. App icons keep their compiled sizes. modalUtils.js renderAppIconImg.
// Run: node scripts/test-taskbar-foreign-icon.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/modalUtils.js'), 'utf8');
const start = src.indexOf('const APP_ICON_SRCSET_SIZES');
const end = src.indexOf('function renderDualIcon');
assert.ok(start > 0 && end > start, 'the icon helpers are where they were');
const ctx = { window: { location: { origin: 'http://x' } }, URL };
vm.createContext(ctx);
vm.runInContext(src.slice(start, end) + '\n;this.api = { renderAppIconImg, buildAppIconSrcset };', ctx);
const { renderAppIconImg, buildAppIconSrcset } = ctx.api;

const progress = renderAppIconImg('/static_images/vista-file-progress/progress-16.png', '', 17);
assert.ok(progress.includes('src="/static_images/vista-file-progress/progress-16.png"'), progress);
assert.ok(!progress.includes('app_icons'), 'no app_icons sizes for it: ' + progress);
assert.ok(progress.includes('srcset="/static_images/vista-file-progress/progress-16.png 1x, /static_images/vista-file-progress/progress-32.png 2x"'), progress);
assert.strictEqual(buildAppIconSrcset('/static_images/vista-file-progress/progress-16.png'), '', 'the taskbar update adds none either');

const globe = renderAppIconImg('/static_images/melaton/net-globe.png', '', 17);
assert.ok(globe.includes('src="/static_images/melaton/net-globe.png"') && !globe.includes('srcset'), globe);

const app = renderAppIconImg('studio.png', '', 17);
assert.ok(app.includes('/static_images/app_icons/16/studio.webp 16w'), 'app icons keep their sizes: ' + app);
assert.ok(buildAppIconSrcset('/static_images/app_icons/studio.png').includes('app_icons/32/studio.webp'));

console.log('test-taskbar-foreign-icon: ok');
