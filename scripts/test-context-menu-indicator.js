#!/usr/bin/env node
// List rows use a 7.css gutter mark (check, or radio when indicatorMark is radio).
// The mark is only painted while the row is on. Icon and grid tiles keep data-state.
// Run: node scripts/test-context-menu-indicator.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

const js = read('public/scripts/comp/contextMenu.js');
assert.ok(js.includes('applyIndicatorLamp'));
assert.ok(js.includes('paintMenuMark'));
assert.ok(js.includes('context-menu-item-mark'));
assert.ok(!js.includes("itemElement.classList.add('indicator')"));
assert.ok(js.includes('resolveIndicatorState'));
assert.ok(!js.includes('indicator-box'));
assert.ok(js.includes('this.applyIndicatorLamp(iconElement, icon)'));
assert.ok(js.includes('this.applyIndicatorLamp(btn, cell)'));

const css = read('public/css/context-menu.css');
assert.ok(css.includes('.context-menu-item-mark[data-kind="check"]'));
assert.ok(css.includes('.context-menu-item-mark[data-kind="radio"]'));
assert.ok(css.includes('content: "\\2714"'));
assert.ok(css.includes('.context-menu-icon-btn.indicator::after') && css.includes('content: none'), 'icon rows do not draw the lamp');
assert.ok(js.includes("itemElement.classList.contains('context-menu-icon-btn')"));
assert.ok(!css.includes('border-bottom-color: #3aff67'));
assert.ok(!css.includes('radial-gradient(#7aff89, #006318)'));

const compare = read('public/scripts/comp/imageGenerationSettings.js');
assert.ok(compare.includes("parent.classList.add('indicator')"));
assert.ok(!compare.includes("querySelector('.context-menu-item-indicator')"));
assert.ok(compare.includes("indicatorMark: 'check'"));
assert.ok(compare.includes("indicatorMark: 'radio'"));
assert.ok(compare.includes('attachStudioControlMenu') === false);
const menus = read('public/scripts/comp/manualDropdownManager.js');
assert.ok(menus.includes('attachStudioControlMenu(manualResolutionDropdownBtn, getStudioResolutionMenuItems)'));
assert.ok(menus.includes('attachStudioControlMenu(manualSamplerDropdownBtn, getStudioSamplerControlMenuItems)'));

const lamp = read('public/css/app.css');
assert.ok(lamp.includes('.indicator::after'));
assert.ok(lamp.includes('.indicator[data-state="on"]::after'));

console.log('test-context-menu-indicator: ok');
