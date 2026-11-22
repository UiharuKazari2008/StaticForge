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
assert.strictEqual(r.director, false, 'a finished turn not seen no longer lights it (Yukimi, Nov 18: only while a turn runs)');
assert.strictEqual(r.wxalert, true);
assert.strictEqual(r.carkey, false);

a = send('push', { type: 'status.snapshot', data: { full: false, fields: { director: { running: true, unseen: false } } } });
assert.strictEqual(out(a).roles.director, true, 'a turn running');
a = send('push', { type: 'status.snapshot', data: { full: false, fields: { prefs: { mailAll: true, smsAll: false } } } });
assert.strictEqual(out(a).roles.mail, true, '"any unread" on');
// XM Radio recording (#1020): the tape while one runs, its popup with the running clock and the three buttons
assert.strictEqual(r.xmrec, false, 'nothing recording');
a = send('push', { type: 'status.snapshot', data: { full: false, fields: { xmrec: { list: [{ rid: 'r1', channelId: 'c', number: 2, name: 'Hits 1', kind: 'manual', since: 1700000000000, back: 75, a: 'Artist', t: 'Song', ad: false }] } } } });
assert.strictEqual(out(a).roles.xmrec, true, 'a recording shows the tape');
const xp = out(a).popups.xmrec;
assert.ok(xp && xp.sec.some((x) => x.t === 'pair' && x.clock === 1700000000000), 'the running time is the app\'s clock');
assert.ok(xp.sec.some((x) => x.t === 'pair' && x.r[0].s === '1:15'), 'how far it reached back');
assert.deepStrictEqual(xp.buttons.map((b) => b.text), ['Monitor', 'Cancel', 'Hide']);
assert.deepStrictEqual(xp.foot, ['XM Radio']);
a = send('push', { type: 'status.snapshot', data: { full: false, fields: { xmrec: { list: [] } } } });
assert.strictEqual(out(a).roles.xmrec, false, 'stopped: the tape goes');

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
const realFit = g.CafeTasks.lib.statusFit;
assert.ok(realFit && typeof realFit.fit === 'function', 'status-fit.js is in the bundle');
g.CafeTasks.lib.statusFit = { fit: (input) => { seen = input; return { shown: input.icons.map((i) => i.role), left: [], folded: [], shed: [], groupShown: false }; } };
a = send('layout', { geo: { iconsRight: 1000, titleX: 100, titleMin: 200, gap: 4, icon: 54, holeX: 500, holeR: 560 }, widths: { sms: 54 }, native: ['battery'], order: ['mail', 'sms', 'director'] });
const fit = out(a).fit;
assert.ok(fit && fit.right.includes('sms') && fit.right.includes('battery'), 'the fit is in the output');
assert.strictEqual(JSON.stringify(seen.bar.hole), JSON.stringify({ x: 500, w: 60 }));
assert.strictEqual(seen.bar.iconsRight, 1000);
assert.ok(seen.icons.find((i) => i.role === 'battery').foldable === false);
// and the real one, over an app on a narrow bar, folds or sheds rather than crossing the camera
g.CafeTasks.lib.statusFit = realFit;
a = send('layout', { geo: { iconsRight: 1000, titleX: 100, titleMin: 200, gap: 4, icon: 54, holeX: 900, holeR: 950 }, width: 1080, widths: {}, native: ['signal', 'battery'], order: ['mail', 'sms', 'director', 'carkey', 'received', 'notify'] });
const f2 = out(a).fit;
assert.ok(f2 && Array.isArray(f2.right), 'the real fit gives a placement');
console.log('test-cafe-status-bar: ok');
