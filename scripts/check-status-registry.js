#!/usr/bin/env node
/*
 * The status icon registration is complete (Yukimi, Nov 18 2026, HARD rule status-icons-registered-only): every role the
 * status table can show (status-order.js display + the roles the page / task use) has its glyph, its popup builder
 * (status-popups.js) and its tap. Run by .githooks/pre-commit; exit 1 names what is missing.
 */
'use strict';
const path = require('path');
const dir = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
global.CafeTasks = { lib: {} };
require(path.join(dir, 'status-order.js'));
require(path.join(dir, 'status-popups.js'));
const tbl = global.CafeTasks.lib.statusOrder;
// the display table and every program role the page draws (wmShell STATUS_APP_ROLES) and the task names
const roles = new Set([...tbl.display, 'mail', 'sms', 'chat', 'prints', 'director', 'update', 'wxalert', 'rain', 'traffic', 'lapis', 'carkey',
    'continuity', 'received', 'nightshade']);
const missing = [];
roles.forEach((r) => {
    const glyph = tbl.glyph(r) || (tbl.systemGlyphs && tbl.systemGlyphs[r]);
    const popup = global.CafeTasks.lib.statusPopups.has(r);
    if (!glyph || !popup) missing.push(`${r}: ${!glyph ? 'no glyph ' : ''}${!popup ? 'no popup' : ''}`.trim());
    // a popup must build from empty inputs (a fresh install, nothing sent yet)
    else if (!global.CafeTasks.lib.statusPopups.build(r, {}, {}, new Date())) missing.push(`${r}: popup fails on empty inputs`);
});
// the notification holder (#1026): every role and notice kind has its large colour picture, all three sizes on disk
const fs = require('fs');
const img = path.join(__dirname, '..', 'public', 'static_images');
new Set([...roles, ...Object.keys(tbl.glyphs)]).forEach((r) => {
    const base = tbl.holderArt && tbl.holderArt(r);
    if (!base) { missing.push(`${r}: no holder picture`); return; }
    ['', '@2x', '@4x'].forEach((d) => { if (!fs.existsSync(path.join(img, `${base}${d}.png`))) missing.push(`${r}: ${base}${d}.png missing`); });
});
if (missing.length) {
    console.error(`status registry: incomplete (rule status-icons-registered-only):\n  ${missing.join('\n  ')}`);
    process.exit(1);
}
console.log(`status registry: ok (${roles.size} roles)`);
