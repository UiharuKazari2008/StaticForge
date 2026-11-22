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
// the holder's picture per notification kind (#1056): every kind in the table has its three sizes, and each kind of
// notice the sources raise gets its own picture (a fixture per source; a kind that fell back to its app's icon or the
// plain notice's fails here)
const kindArt = (k) => (tbl.holderKinds && tbl.holderKinds[k]) || null;
Object.keys(tbl.holderKinds || {}).forEach((k) => {
    ['', '@2x', '@4x'].forEach((d) => { if (!fs.existsSync(path.join(img, `${kindArt(k)}${d}.png`))) missing.push(`holder kind ${k}: ${kindArt(k)}${d}.png missing`); });
});
const fixtures = [
    [{ id: 'mail:a:INBOX:1', cls: 'mail', data: { kind: 'mail' } }, 'mail'],
    [{ id: 'mail-error:a', cls: 'notification', data: { kind: 'mail-error' } }, 'mail-error'],
    [{ id: 'sms:a:g', cls: 'sms', data: { kind: 'sms' } }, 'sms'],
    [{ id: 'tm-signin:a', cls: 'notification', data: { kind: 'tm-signin' } }, 'sms-error'],
    [{ id: 'p', data: { kind: 'call-missed' } }, 'call-missed'],
    [{ id: 'p', data: { category: 'call' } }, 'call'],
    [{ id: 'p', data: { category: 'missed_call' } }, 'call-missed'],
    [{ id: 'p', data: { kind: 'voicemail' } }, 'voicemail'],
    [{ id: 'p', data: { category: 'msg' } }, 'message'],
    [{ id: 'p', data: { category: 'email' } }, 'email'],
    [{ id: 'p', data: { category: 'alarm' } }, 'alarm'],
    [{ id: 'p', data: { category: 'progress' } }, 'progress'],
    [{ id: 'p', data: { category: 'err' } }, 'error'],
    [{ id: 'rem:f:u:1', cls: 'reminder', data: { kind: 'reminder' } }, 'reminder'],
    [{ id: 'rem:f:u:1', cls: 'reminder', data: { kind: 'reminder', meeting: true } }, 'meeting'],
    [{ id: 'rem:task:u:1', cls: 'reminder', data: { kind: 'reminder', task: true } }, 'task'],
    [{ id: 'print:1', cls: 'print' }, 'prints'],
    [{ id: 'print:1', cls: 'print-error', data: { failed: true } }, 'print-error'],
    [{ id: 'update', type: 'info' }, 'update'],
    [{ id: 'update', data: { failed: true } }, 'update-failed'],
    [{ id: 'director:s:turn', cls: 'director' }, 'director'],
    [{ id: 'question:f', cls: 'question' }, 'question'],
    [{ id: 'emotion:1', cls: 'emotion', data: { ok: true } }, 'emotion'],
    [{ id: 'emotion:1', cls: 'emotion', data: { ok: false } }, 'emotion-error'],
    [{ id: 'api-key:x', cls: 'api-key' }, 'api-key'],
    [{ id: 'videos:live:x', cls: 'notification' }, 'videos'],
    [{ id: 'system:x', data: { level: 'error' } }, 'error'],
    [{ id: 'system:x', data: { level: 'warning' } }, 'warning'],
    [{ id: 'traffic:a:b:c', cls: 'notification' }, 'traffic'],
    [{ id: 'wx:p:a', cls: 'weather-alert' }, 'wxalert'],
    [{ id: 'rain:p', cls: 'rain-alarm' }, 'rain'],
    [{ id: 'lapis:unlocked:k', data: { app: 'lapis', kind: 'unlocked' } }, 'lapis-unlocked'],
    [{ id: 'lapis:health:alerts', data: { app: 'lapis', kind: 'health' } }, 'lapis-health'],
    [{ id: 'lapis:x-1', data: { app: 'lapis', kind: 'refuel' } }, 'lapis-fuel'],
    [{ id: 'lapis:service:maintenance', data: { app: 'lapis', kind: 'service' } }, 'lapis-service'],
    [{ id: 'lapis:x-2', data: { app: 'lapis', kind: 'command' } }, 'lapis-failed'],
    [{ id: 'lapis:run-left', data: { app: 'lapis', kind: 'run-left' } }, 'lapis-run-left'],
    [{ id: 'x', cls: 'notification' }, 'notify'],
    // the page's own notices by their glyph (#1061): battery full / low
    [{ id: 'toast-1', icon: 'status-battery-full' }, 'battery-full'],
    [{ id: 'toast-2', icon: 'status-battery-low' }, 'battery-low'],
];
if (typeof tbl.holderKind !== 'function') missing.push('holderKind: missing (#1056)');
else {
    fixtures.forEach(([n, want]) => {
        const got = tbl.holderKind(n);
        if (got !== want) missing.push(`holder kind of ${n.id}${n.data ? ` ${JSON.stringify(n.data)}` : ''}: ${got}, wanted ${want}`);
        if (!tbl.holderArt(got)) missing.push(`holder kind ${got}: no picture`);
    });
}
if (missing.length) {
    console.error(`status registry: incomplete (rule status-icons-registered-only):\n  ${missing.join('\n  ')}`);
    process.exit(1);
}
console.log(`status registry: ok (${roles.size} roles)`);
