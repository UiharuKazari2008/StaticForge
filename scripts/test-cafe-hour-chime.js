#!/usr/bin/env node
'use strict';
// #1108: the CaféReady hour-chime task chimes on the phone's clock at each hour / half hour with the chosen sound.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const dir = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert(manifest.tasks.some((t) => t.name === 'hour-chime'), 'in the manifest');
const g = {}; g.globalThis = g; vm.createContext(g);
manifest.files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), g, { filename: f }));
const RealDate = Date;
let clock = 0;
// the task reads ctx.now from the host; its lib reads the phone's local zone through Date
const send = (type, data, now) => { g.Date = RealDate; const real = RealDate.now; RealDate.now = () => now; const o = JSON.parse(g.CafeTasks.dispatch('hour-chime', type, JSON.stringify(data || {}))); RealDate.now = real; if (o.error) throw new Error(o.error); return o.actions; };
const at = (h, m, s = 0) => new RealDate(2026, 10, 24, h, m, s).getTime();
const notes = (a) => a.filter((x) => x.op === 'notify');
const timer = (a) => (a.filter((x) => x.op === 'timer').pop() || {}).ms;
const snap = (chime) => ({ type: 'status.snapshot', data: { full: true, fields: { chime } } });

let a = send('start', {}, at(10, 15));
assert.strictEqual(timer(a), undefined, 'off: no timer');
a = send('push', snap({ mode: 'hour', hourSound: 'Alarm-03', halfSound: 'Remind-02', strike: true }), at(10, 15));
assert.strictEqual(timer(a), 45 * 60000, 'hour: next at 11:00');
assert.strictEqual(notes(a).length, 0);
a = send('timer', {}, at(11, 0, 0.5));
let n = notes(a);
assert.strictEqual(n.length, 1); assert.strictEqual(n[0].sound, 'Alarm-03'); assert.strictEqual(n[0].strikes, 11, 'strikes tell the hour');
a = send('timer', {}, at(11, 0, 1));
assert.strictEqual(notes(a).length, 0, 'the same slot twice is one');
a = send('timer', {}, at(11, 59, 50));
assert.strictEqual(notes(a)[0].title, '12:00', 'a timer that came early still chimes its slot');
assert.strictEqual(notes(a)[0].strikes, 12);
a = send('timer', {}, at(13, 0));
assert.strictEqual(notes(a)[0].strikes, 1, '13:00 is one on the 12 h dial');
a = send('push', snap({ mode: 'half', hourSound: 'Alarm-03', halfSound: 'Remind-02', strike: false }), at(13, 10));
assert.strictEqual(timer(a), 20 * 60000, 'half: next at 13:30');
a = send('timer', {}, at(13, 30));
n = notes(a); assert.strictEqual(n[0].sound, 'Remind-02'); assert.strictEqual(n[0].strikes, 1);
a = send('timer', {}, at(14, 0));
assert.strictEqual(notes(a)[0].sound, 'Alarm-03', 'on the hour in half mode: the hour sound');
a = send('push', snap({ mode: 'off' }), at(14, 5));
assert.strictEqual(timer(a), 0, 'off cancels the timer');
// server side
const hc = require('../modules/hourChime');
assert.deepStrictEqual(hc.clean({ mode: 'x', hourSound: '../a', strike: 1 }), { mode: 'off', hourSound: 'Remind-02', halfSound: 'Remind-01', strike: true });
// #1321: a stored Alarm file she never picked becomes the default; one she picked stays
assert.strictEqual(hc.clean({ mode: 'off', hourSound: 'Alarm-01', halfSound: 'Remind-01' }).hourSound, 'Remind-02', 'the old unpicked default');
assert.strictEqual(hc.clean({ mode: 'hour', hourSound: 'Alarm-03', picked: ['hourSound'] }).hourSound, 'Alarm-03', 'her own pick stays');
assert.strictEqual(hc.clean({ mode: 'half', halfSound: 'Alarm4' }).halfSound, 'Remind-01', 'half hour too');
console.log('test-cafe-hour-chime ok');
