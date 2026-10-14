#!/usr/bin/env node
// Classic (non-Aero) context menus use Menu / Hilight, not glass or Vista teal.
// Run: node scripts/test-classic-context-menus.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const menus = fs.readFileSync(path.join(ROOT, 'public/css/vista-menus.css'), 'utf8');
const aero = 'body.desktop-mode:not(.windows-classic-theme)';
const classic = 'body.windows-classic-theme';

assert.ok(menus.includes(`${aero} :is(.context-menu, .context-menu-submenu)`), 'Aero menus stay gated');
assert.ok(menus.includes(`${classic} :is(.context-menu, .context-menu-submenu)`), 'Classic menus are themed');
assert.ok(menus.includes('background: var(--Menu)'), 'Classic face is Menu');
assert.ok(menus.includes('background: var(--Hilight) !important'), 'Classic hot item is Hilight');
assert.ok(!/body\.windows-classic-theme[^{]*context-menu[^{]*\{[^}]*#aaddfa/.test(menus), 'Classic has no Vista teal');
assert.ok(!/body\.windows-classic-theme[^{]*context-menu[^{]*\{[^}]*backdrop-filter: var\(--glass/.test(menus), 'Classic menus are not glass');
assert.ok(menus.includes(`${classic} .custom-dropdown-menu`), 'Classic dropdown lists match');
assert.ok(
    menus.includes('.context-menu-item.context-menu-item-highlighted:not(.disabled)'),
    'Aero current item uses the Vista hot box'
);
assert.ok(
    menus.includes('.context-menu-item-highlighted:not(.disabled))::before'),
    'Aero current item hides the gutter etch'
);

console.log('test-classic-context-menus: ok');
