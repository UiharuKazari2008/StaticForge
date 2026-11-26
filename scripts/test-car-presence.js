#!/usr/bin/env node
/*
 * CaféReady task car-presence (#1205): runs public/scripts/tasks in a bare VM context (no DOM, like the app's isolate)
 * and drives it the way DSApp CafeTasks does: dispatch(name, type, dataJson, stateJson?) -> actions.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
assert.ok(manifest.files.includes('car-presence.js'), 'the task ships in the manifest');
assert.ok(manifest.tasks.some((t) => t.name === 'car-presence' && t.api === 1));

function load() {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    manifest.files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f }));
    return sandbox;
}

const g = load();
const lib = g.CafeTasks.lib.carPresence;
let state = null;
let first = true;
function send(type, data) {
    const out = JSON.parse(g.CafeTasks.dispatch('car-presence', type, JSON.stringify(data || {}), first && state ? JSON.stringify(state) : null));
    first = false;
    if (out.error) throw new Error(out.error);
    if (out.patch) state = Object.assign(state || {}, out.patch);
    (out.drop || []).forEach((k) => { delete state[k]; });
    return out.actions;
}
const ops = (acts, op) => acts.filter((a) => a.op === op);
const asks = (acts) => ops(acts, 'request').filter((r) => r.type === 'lapis_presence');

// ---- the pure parts
assert.strictEqual(lib.lockOf('Car in range.', true), '');
assert.strictEqual(lib.lockOf('Car unlocked.', true), 'unlocked');
assert.strictEqual(lib.lockOf('Car UNLOCKED', undefined), 'unlocked');
assert.strictEqual(lib.lockOf('Car locked.', true), 'locked');
assert.strictEqual(lib.lockOf('Car locked.', false), '', 'the key does not see the car: no word');
assert.strictEqual(lib.lockOf('Tap to unlock', true), '', 'an instruction is not a state');
assert.strictEqual(lib.lockOf(null, true), '');

// ---- a start with nothing to say asks for nothing
let a = send('start');
assert.strictEqual(asks(a).length, 0);
assert.strictEqual(ops(a, 'link').length, 0);
assert.strictEqual(ops(a, 'timer').length + ops(a, 'subscribe').length + ops(a, 'feed').length, 0, 'no timers, pushes or feeds');

// the key sees the car: nothing to say
a = send('car', { connected: false, keyInRange: true, keyText: 'Car in range.', car: 'Kuro', at: 1000 });
assert.strictEqual(asks(a).length, 0);
// the car's Bluetooth connects: in the car, one request, link asked for
const t0 = Date.now();
a = send('car', { connected: true, keyInRange: true, keyText: 'Car in range.', car: 'Kuro', at: t0 });
assert.deepStrictEqual(ops(a, 'link').map((x) => x.on), [true]);
assert.strictEqual(asks(a).length, 1);
let body = asks(a)[0].data;
assert.deepStrictEqual([body.inCar, body.lock, body.source], [true, '', 'car_bt']);
assert.ok(Number.isFinite(body.at) && body.at <= Date.now());
// the link was up and the server answers: pending clears and the link is let go
const tag = asks(a)[0].tag;
a = send('reply', { tag, type: 'lapis_presence', ok: true, data: { ok: true } });
assert.deepStrictEqual(ops(a, 'link').map((x) => x.on), [false]);
assert.strictEqual(state.pending, null);

// repeats say nothing (same connected, same text; drive driving while already in the car)
a = send('car', { connected: true, keyInRange: true, keyText: 'Car in range.', car: 'Kuro', at: t0 + 1 });
assert.strictEqual(asks(a).length, 0, 'no repeat');
a = send('drive', { state: 'driving', since: t0 });
assert.strictEqual(asks(a).length, 0, 'already in the car');
a = send('drive', { state: 'parked_in_car', since: t0 });
assert.strictEqual(asks(a).length, 0);

// the lock word changes to unlocked: one request with the word
a = send('car', { connected: true, keyInRange: true, keyText: 'Car unlocked.', car: 'Kuro', at: t0 + 5 });
assert.strictEqual(asks(a).length, 1);
body = asks(a)[0].data;
assert.deepStrictEqual([body.inCar, body.lock, body.source], [true, 'unlocked', 'carkey']);
send('reply', { tag: asks(a)[0].tag, ok: true, data: {} });
// same word again: nothing; back to the plain text: nothing; unlocked again: a change
a = send('car', { connected: true, keyInRange: true, keyText: 'Car unlocked.', at: t0 + 6 });
assert.strictEqual(asks(a).length, 0);
a = send('car', { connected: true, keyInRange: true, keyText: 'Car in range.', at: t0 + 7 });
assert.strictEqual(asks(a).length, 0, 'a word going away is not sent');
a = send('car', { connected: true, keyInRange: true, keyText: 'Car locked.', at: t0 + 8 });
assert.strictEqual(asks(a).length, 1);
assert.deepStrictEqual([asks(a)[0].data.lock, asks(a)[0].data.inCar], ['locked', true]);
send('reply', { tag: asks(a)[0].tag, ok: true, data: {} });

// she leaves: Bluetooth and drive off, key gone; nothing is sent for leaving
a = send('car', { connected: false, keyInRange: false, keyText: '', at: t0 + 9 });
a = send('drive', { state: 'idle' });
assert.strictEqual(asks(a).length, 0);
// the next time she gets in by the drive state alone (a car without the Bluetooth): source drive
a = send('drive', { state: 'driving', since: t0 + 10 });
assert.strictEqual(asks(a).length, 1);
assert.deepStrictEqual([asks(a)[0].data.inCar, asks(a)[0].data.lock, asks(a)[0].data.source], [true, '', 'drive']);
send('reply', { tag: asks(a)[0].tag, ok: true, data: {} });
a = send('drive', { state: 'stopped' });

// ---- the link is down: the word stays pending in the state and goes out on the link's connected event
a = send('car', { connected: true, keyInRange: true, keyText: 'Car in range.', at: Date.now() });
assert.strictEqual(asks(a).length, 1);
// no reply (the request never went): still pending, the state holds it
assert.ok(state.pending && state.pending.inCar === true);
a = send('link', { connected: false });
assert.strictEqual(asks(a).length, 0, 'nothing while the link is down');
a = send('link', { connected: true });
assert.strictEqual(asks(a).length, 1, 'sent when the link comes up');
assert.deepStrictEqual(ops(a, 'link').map((x) => x.on), [true]);
assert.strictEqual(asks(a)[0].data.inCar, true);
// a refused request stays for the next link
const tag2 = asks(a)[0].tag;
a = send('reply', { tag: tag2, ok: false, error: 'INSUFFICIENT_PERMISSIONS' });
assert.ok(state.pending, 'kept after a refusal');
assert.deepStrictEqual(ops(a, 'link').map((x) => x.on), [false]);
// two words while down merge into one body
a = send('car', { connected: true, keyInRange: true, keyText: 'Car unlocked.', at: Date.now() });
assert.strictEqual(asks(a).length, 1);
assert.deepStrictEqual([asks(a)[0].data.inCar, asks(a)[0].data.lock], [true, 'unlocked']);
// the state survives a restart of the engine (the host hands it back) and a start asks again
const kept = JSON.parse(JSON.stringify(state));
a = JSON.parse(g.CafeTasks.dispatch('car-presence', 'start', '{}', JSON.stringify(kept))).actions;
assert.strictEqual(asks(a).length, 1, 'a pending word is sent again after the engine restarted');
// answered: done
const tag3 = asks(a)[0].tag;
a = send('reply', { tag: tag3, ok: true, data: {} });
assert.strictEqual(state.pending, null);
a = send('link', { connected: true });
assert.strictEqual(asks(a).length, 0, 'nothing pending: nothing sent');

// ---- an old word is dropped unsent (what it said is over)
const old = Object.assign({}, state, { pending: { inCar: true, lock: '', source: 'car_bt', at: Date.now() - lib.PENDING_MS - 1000 } });
const out = JSON.parse(g.CafeTasks.dispatch('car-presence', 'link', JSON.stringify({ connected: true }), JSON.stringify(old)));
assert.strictEqual(asks(out.actions).length, 0);
assert.deepStrictEqual(out.patch, { pending: null }, 'the stale word is dropped');
state = Object.assign(old, out.patch);

// ---- the state is small
assert.deepStrictEqual(Object.keys(state).sort(), ['bt', 'drv', 'lock', 'pending']);

// ---- the doors reach the status bar: the Car icon shows while the server's lock word is unlocked, its popup says so
const sb = g.CafeTasks.lib.statusBar;
const pops = g.CafeTasks.lib.statusPopups;
const noon = new Date('2026-11-26T12:00:00Z');
assert.strictEqual(sb.roles({ lapis: { until: 0, locked: null } }, {}, noon).carkey, false);
assert.strictEqual(sb.roles({ lapis: { until: 0, locked: true } }, {}, noon).carkey, false, 'locked alone does not show the icon');
assert.strictEqual(sb.roles({ lapis: { until: 0, locked: false } }, {}, noon).carkey, true);
assert.strictEqual(sb.roles({ lapis: { until: 0, locked: false } }, {}, noon).carkey, true);
const lines = (f, n) => JSON.stringify(pops.build('carkey', f, n || {}, noon));
assert.ok(/Unlocked\./.test(lines({ lapis: { until: 0, locked: false } })));
assert.ok(!/Locked\./.test(lines({ lapis: { until: 0, locked: true } })), 'locked alone: nothing running');
assert.ok(/Locked\./.test(lines({ lapis: { until: 0, locked: true } }, { carKey: true })), 'Locked beside another reason');
assert.ok(/Nothing running/.test(lines({ lapis: { until: 0, locked: null } })));

console.log('car presence: all checks passed');
