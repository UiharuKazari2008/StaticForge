#!/usr/bin/env node
/*
 * CaféReady task drive-alerts (#908): runs public/scripts/tasks in a bare VM context (no DOM, like the app's
 * isolate) and drives it the way DSApp CafeTasks does: dispatch(name, type, dataJson, stateJson?) -> actions.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const dir = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

function load() {
    const sandbox = {};
    sandbox.globalThis = sandbox;
    vm.createContext(sandbox);
    manifest.files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), sandbox, { filename: f }));
    return sandbox;
}

let g = load();
let state = null;
let first = true;
function send(type, data) {
    const out = JSON.parse(g.CafeTasks.dispatch('drive-alerts', type, JSON.stringify(data || {}), first && state ? JSON.stringify(state) : null));
    first = false;
    if (out.error) throw new Error(out.error);
    if (out.patch) state = Object.assign(state || {}, out.patch);
    (out.drop || []).forEach((k) => { delete state[k]; });
    return out.actions;
}
const ops = (acts, op) => acts.filter((a) => a.op === op);

// a straight commute north: Home (0,0) -> Work (0.2, 0) ~22 km; cameras at 40 % and 70 %
const line = []; for (let i = 0; i <= 20; i++) line.push([i * 0.01, 0]);
const report = (dir) => ({ hash: `h-${dir}`, routes: [{ line: dir === 'work' ? line : line.slice().reverse(), durationSec: 1500, distanceM: 22239 }], preferredIndex: 0,
    traps: dir === 'work' ? [{ id: 'cam40', label: 'Speed camera', street: 'Main St', maxspeed: '45 mph', at: 0.4 }, { id: 'cam70', at: 0.7 }] : [], police: [] });

let a = send('start');
assert.deepStrictEqual(ops(a, 'subscribe')[0].types.sort(), ['traffic_police', 'traffic_settings_changed', 'traffic_updated']);
assert.strictEqual(ops(a, 'location').length, 0, 'not driving: no position');

a = send('drive', { state: 'driving', since: 1000 });
assert.deepStrictEqual(ops(a, 'link').map((x) => x.on), [true], 'driving asks for the link');
assert.deepStrictEqual(ops(a, 'location').map((x) => x.level), ['low']);
const req = ops(a, 'request')[0];
assert.strictEqual(req.type, 'traffic_get');
send('reply', { tag: 'reports', ok: true, data: { settings: { home: { lat: 0, lon: 0 }, work: { lat: 0.2, lon: 0 }, radiusKm: 1 }, latest: { work: report('work'), home: report('home') } } });

// leaving Home: 2 km in, camera 40 % (8.9 km) is 6.9 km ahead -> within 5 mi: high
a = send('fix', { lat: 0.02, lon: 0, accuracyM: 10, speed: 20, heading: 0 });
a = send('fix', { lat: 0.03, lon: 0, accuracyM: 10, speed: 20, heading: 0 });
assert.ok(ops(a, 'location').some((x) => x.level === 'high'), 'near a camera ahead: GPS');
assert.ok(ops(a, 'feed').some((x) => x.feed === 'traffic_police_work' && x.on), 'police feed of the route');
assert.strictEqual(ops(a, 'notify').length, 0);
// 1 mi before cam40 (0.4*22239 = 8896 m; at 7500 m)
a = send('fix', { lat: 0.0675, lon: 0, accuracyM: 10, speed: 20, heading: 0 });
let n = ops(a, 'notify');
assert.strictEqual(n.length, 1);
assert.strictEqual(n[0].id, 'cam40');
assert.strictEqual(n[0].kind, 'traffic-camera');
assert.ok(/ahead on Main St\. Limit 45 mph\./.test(n[0].text), n[0].text);
const before = JSON.stringify(g.CafeTasks.dispatch('drive-alerts', 'fix', JSON.stringify({ lat: 0.0685, lon: 0, accuracyM: 10, speed: 20, heading: 0 })));
assert.ok(!/"reports"/.test(before), 'a fix sends back only the keys it changed, not the reports');
a = send('fix', { lat: 0.07, lon: 0, accuracyM: 10, speed: 20, heading: 0 });
assert.strictEqual(ops(a, 'notify').length, 0, 'once per camera');
const out = ops(a, 'output').concat([]).pop();
void out;

// the host restarts (a killed process): the state comes back, alerted stays
g = load(); first = true;
a = send('start');
assert.ok(ops(a, 'location').some((x) => x.level !== 'off'), 'driving state resumes the position');
a = send('fix', { lat: 0.0705, lon: 0, accuracyM: 10, speed: 20, heading: 0 });
assert.strictEqual(ops(a, 'notify').length, 0, 'still once after a restart');

// off the commutes: area mode asks traffic_nearby once
a = send('fix', { lat: 0.1, lon: 0.5, accuracyM: 10, speed: 20, heading: 90 });
const area = ops(a, 'request').find((x) => x.type === 'traffic_nearby');
assert.ok(area, 'asks for the area');
assert.ok(ops(a, 'feed').some((x) => x.feed === 'traffic_police_work' && !x.on), 'leaves the route feed');
send('reply', { tag: 'area', ok: true, data: { box: { s: 0, w: 0.375, n: 0.25, e: 0.625 }, cameras: [{ id: 'osm1', label: 'Speed camera', lat: 0.1, lon: 0.51 }], police: [] } });
a = send('fix', { lat: 0.1, lon: 0.5005, accuracyM: 10, speed: 20, heading: 90 });
assert.strictEqual(ops(a, 'request').filter((x) => x.type === 'traffic_nearby').length, 0, 'area held: not asked again');
assert.deepStrictEqual(ops(a, 'notify').map((x) => x.id), ['osm1']);

// parked: position off, feed off
a = send('drive', { state: 'parked_in_car', since: 5000 });
assert.deepStrictEqual(ops(a, 'location').map((x) => x.level), ['off']);
assert.deepStrictEqual(ops(a, 'link').map((x) => x.on), [false], 'parked lets the link go');
a = send('fix', { lat: 0.1, lon: 0.505, accuracyM: 10 });
assert.strictEqual(a.length, 0, 'not driving: fixes do nothing');

console.log('test-cafe-drive-alerts: ok');
