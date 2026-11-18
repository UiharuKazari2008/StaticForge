#!/usr/bin/env node
'use strict';
// #908 phase 3: the CaféReady status-bar task maps the server's snapshot and the phone's own signals to icons (the
// page's rules), in a bare VM like the app's engine.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const dir = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const g = { }; g.globalThis = g; vm.createContext(g);
manifest.files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), g, { filename: f }));
let first = true;
const send = (type, data) => { const o = JSON.parse(g.CafeTasks.dispatch('status-bar', type, JSON.stringify(data || {}), first ? null : null)); first = false; if (o.error) throw new Error(o.error); return o.actions; };
const out = (a) => (a.filter((x) => x.op === 'output').pop() || {}).output;

let a = send('start');
assert.deepStrictEqual(Object.keys(out(a).roles).sort(), ['continuity', 'nightshade'], 'before a snapshot: only the phone\'s own');

const fields = {
    mail: { unread: 5, fresh: 0 }, sms: { unread: 2, fresh: 1 }, chat: { fresh: 0 }, director: { running: false, unseen: true },
    prints: { phone: 0 }, weather: { alerts: 1, rain: false }, lapis: { until: 0 },
    traffic: { days: [], leaveHome: '', leaveWork: '' }, notices: { waiting: 0 }, prefs: { mailAll: false, smsAll: false }, received: { unseen: 0 }
};
a = send('push', { type: 'status.snapshot', data: { full: true, fields } });
let r = out(a).roles;
assert.strictEqual(r.mail, false, 'unread but none new, "any unread" off');
assert.strictEqual(r.sms, true);
assert.strictEqual(r.director, true);
assert.strictEqual(r.wxalert, true);
assert.strictEqual(r.carkey, false);

a = send('push', { type: 'status.snapshot', data: { full: false, fields: { prefs: { mailAll: true, smsAll: false } } } });
assert.strictEqual(out(a).roles.mail, true, '"any unread" on');

a = send('native', { carKey: true, link: false });
r = out(a).roles;
assert.strictEqual(r.carkey, true);
assert.strictEqual(r.nightshade, true, 'the link down shows');

a = send('native', { carKey: true });
assert.strictEqual(a.filter((x) => x.op === 'output').length, 0, 'nothing changed: no output');

// leave window: a Leave Work time now opens the car, and a timer is set for its edge
const now = new Date();
const hh = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
assert.strictEqual(g.CafeTasks.lib.statusBar.leaveWindow({ days: [now.getDay()], leaveWork: hh(now), leaveHome: '' }, now), 'home');
assert.strictEqual(g.CafeTasks.lib.statusBar.leaveWindow({ days: [(now.getDay() + 1) % 7], leaveWork: hh(now) }, now), null, 'not a commute day');
a = send('native', { carKey: false });
a = send('push', { type: 'status.snapshot', data: { full: false, fields: { traffic: { days: [now.getDay()], leaveWork: hh(now), leaveHome: '' } } } });
assert.strictEqual(out(a).roles.carkey, true);
assert.ok(a.some((x) => x.op === 'timer' && x.ms > 0), 'a timer for the window\'s end');
// the page asleep: with the shared fit (CafeTasks.lib.statusFit) and the app's layout, the output carries the fit
let seen = null;
g.CafeTasks.lib.statusFit = { fit: (input) => { seen = input; return { right: input.icons.map((i) => i.role), left: [], folded: [] }; } };
a = send('layout', { geo: { iconsRight: 1000, titleX: 100, titleMin: 200, gap: 4, icon: 54, holeX: 500, holeR: 560 }, widths: { sms: 54 }, native: ['battery'], order: ['mail', 'sms', 'director'] });
const fit = out(a).fit;
assert.ok(fit && fit.right.includes('sms') && fit.right.includes('battery'), 'the fit is in the output');
assert.strictEqual(seen.roomRight, 440);
assert.strictEqual(seen.roomLeft, 200);
assert.ok(seen.icons.find((i) => i.role === 'battery').foldable === false);
console.log('test-cafe-status-bar: ok');
