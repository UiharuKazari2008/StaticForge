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

// ---------------------------------------------------------------- #1124 the camera approach
const lib = g.CafeTasks.lib.drive;
const MPH = 0.44704;
const near = (x, y, e = 0.001) => assert.ok(Math.abs(x - y) <= e, `${x} != ${y}`);
near(lib.parseLimit('50'), 50 / 3.6);
near(lib.parseLimit('30 mph'), 30 * MPH);
near(lib.parseLimit('50 km/h'), 50 / 3.6);
near(lib.parseLimit('GB:nsl_single'), 60 * MPH);
near(lib.parseLimit('GB:nsl_dual'), 70 * MPH);
near(lib.parseLimit('GB:motorway'), 70 * MPH);
near(lib.parseLimit('50;30'), 50 / 3.6);
['none', 'signals', 'walk', '', null, undefined, 'foo'].forEach((v) => assert.strictEqual(lib.parseLimit(v), null, String(v)));
assert.strictEqual(lib.mph(21.3), '48 mph');
assert.strictEqual(lib.mph(null), '');
let tp = lib.tonePlan(0, 20, 20);
assert.strictEqual(tp.periodMs, 1400);
assert.strictEqual(lib.tonePlan(1, 20, 20).periodMs, 600);
assert.strictEqual(tp.speedPeriodMs, tp.periodMs, 'at the limit: locked');
tp = lib.tonePlan(0.5, 24, 20);
assert.strictEqual(tp.periodMs, 1000);
assert.strictEqual(tp.speedPeriodMs, Math.round(1000 * 20 / 24), '20 % over');
assert.strictEqual(lib.tonePlan(0.5, 60, 20).speedPeriodMs, 500, '3x over clamps at half the period');
assert.strictEqual(lib.tonePlan(0.5, 20.2, 20).speedPeriodMs, 1000, 'within 2 %: locked');
tp = lib.tonePlan(0.5, 30, null);
assert.strictEqual(tp.limitHz, 0);
assert.strictEqual(tp.speedPeriodMs, tp.periodMs);
assert.deepStrictEqual([tp.speedHz, tp.gain, tp.toneMs], [880, 0.35, 260]);
assert.strictEqual(lib.tonePlan(0.5, 30, 20).limitHz, 587.33);
const ap = lib.approachOf({ id: 'c', label: 'Red light camera', street: 'A38', maxspeed: '50' }, 800, 1600, { speed: 25 });
assert.strictEqual(ap.limitText, '31');
assert.strictEqual(ap.progress, 0.5);
assert.strictEqual(ap.title, 'Red light camera');
assert.strictEqual(ap.speedText, '56 mph');
assert.strictEqual(ap.over, true);
assert.strictEqual(ap.distText, '0.5 mi');

function drive(hostData, fixes, areaReply) {
    g = load(); state = null; first = true;
    send('start', hostData);
    send('drive', { state: 'driving', since: 1000 });
    send('reply', { tag: 'reports', ok: true, data: { settings: { home: { lat: 0, lon: 0 }, work: { lat: 0.2, lon: 0 }, radiusKm: 1 }, latest: { work: report('work'), home: report('home') } } });
    if (areaReply) { send('fix', { lat: 0.1, lon: 0.5, accuracyM: 10, speed: 20, heading: 90 }); send('reply', { tag: 'area', ok: true, data: areaReply }); }
    return fixes.map((f) => send('fix', Object.assign({ accuracyM: 10, speed: 20, heading: f.lon ? 90 : 0 }, f)));
}
const routeFixes = [0.03, 0.0675, 0.0700, 0.0750, 0.0800, 0.0850, 0.0900].map((lat) => ({ lat, lon: 0 }));
// cam40 is at 8896 m = lat 0.0800; 1 mi before it is lat 0.0655
let res = drive({ host: { api: 1, ops: ['approach'] } }, routeFixes);
const all = [].concat(...res);
assert.strictEqual(ops(all, 'notify').length, 0, 'the overlay replaces the notification');
const aps = ops(all, 'approach').map((x) => x.approach);
const live = aps.filter((x) => x);
assert.ok(live.length >= 4, 'an approach on each fix within a mile');
assert.ok(live.every((x) => x.id === 'cam40' && x.limitText === '45' && x.street === 'Main St'));
for (let i = 1; i < live.length; i++) assert.ok(live[i].progress > live[i - 1].progress, 'progress grows');
assert.ok(live[0].progress < 0.05 && live[0].spanM > 1000 && live[0].spanM <= 1610);
assert.strictEqual(aps.filter((x) => x === null).length, 1, 'one null once it is passed');
assert.strictEqual(aps[aps.length - 1], null);
// a drive that ends sends the null
res = drive({ host: { api: 1, ops: ['approach'] } }, routeFixes.slice(0, 3));
a = send('drive', { state: 'parked_in_car', since: 5000 });
assert.deepStrictEqual(ops(a, 'approach').map((x) => x.approach), [null], 'the drive ends the approach');
// an old host: the notification, no approach
res = drive({}, routeFixes);
assert.strictEqual(ops([].concat(...res), 'approach').length, 0);
assert.deepStrictEqual(ops([].concat(...res), 'notify').map((x) => x.id), ['cam40']);
// area mode
const osm = { box: { s: 0, w: 0.375, n: 0.25, e: 0.625 }, cameras: [{ id: 'osm1', label: 'Speed camera', lat: 0.1, lon: 0.51, maxspeed: '30 mph' }], police: [] };
res = drive({ host: { api: 1, ops: ['approach'] } }, [0.4975, 0.5, 0.505, 0.5095, 0.5105, 0.512, 0.516].map((lon) => ({ lat: 0.1, lon })), osm);
const aall = [].concat(...res);
assert.strictEqual(ops(aall, 'notify').length, 0);
const aaps = ops(aall, 'approach').map((x) => x.approach);
assert.ok(aaps.filter((x) => x).length >= 3 && aaps.filter((x) => x).every((x) => x.id === 'osm1' && x.limitText === '30'));
assert.strictEqual(aaps.filter((x) => x === null).length, 1);
assert.strictEqual(aaps[aaps.length - 1], null);

// ---------------------------------------------------------------- #1289 where the phone is (traffic_place)
{
    const places = (acts) => ops(acts, 'request').filter((x) => x.type === 'traffic_place');
    const fixAt = (lat, extra) => send('fix', Object.assign({ lat, lon: 0, accuracyM: 10, speed: 5, heading: 0 }, extra));
    const settings = { settings: { home: { lat: 0, lon: 0 }, work: { lat: 0.2, lon: 0 }, radiusKm: 1 }, latest: { work: report('work'), home: report('home') } };
    // the task's own clock: ctx.now is Date.now() inside its vm context (each fresh() makes a new context, so the real clock is untouched)
    let clock = 5000000;
    const hold = () => { g.__clock = () => clock; vm.runInContext('Date.now = () => globalThis.__clock()', g); };
    const fresh = () => {
        g = load(); state = null; first = true;
        hold();
        send('start');
    };
    const driveStart = () => { const r = send('drive', { state: 'driving', since: 1000 }); send('reply', { tag: 'reports', ok: true, data: settings }); return r; };
    const one = (acts, place, tag, what) => {
        const p = places(acts);
        assert.strictEqual(p.length, 1, `${what}: one place request`);
        assert.deepStrictEqual(p[0].data || p[0].payload || p[0].body, { place }, what);
        assert.strictEqual(p[0].tag, tag, what);
    };
    {
        fresh();
        let r = driveStart();
        // the start request list shows the place too; pick it out of the first drive event
        // (driveStart returns the drive event's actions)
        one(r, null, 'place:away', 'a drive start tells away');
        r = send('drive', { state: 'parked_in_car', since: 2000 });
        assert.strictEqual(places(r).length, 0, 'a drive end tells nothing');
        // a second drive in the same state (away told already) tells nothing more
        r = send('drive', { state: 'driving', since: 3000 });
        assert.strictEqual(places(r).length, 0, 'away is held: not told again');
        send('reply', { tag: 'place:away', ok: true });

        r = fixAt(0.0005);
        one(r, 'home', 'place:home', 'a fix inside Home');
        assert.strictEqual(places(fixAt(0.0006)).length, 0, 'a second fix at Home tells nothing');
        send('reply', { tag: 'place:home', ok: true });
        r = fixAt(0.1);
        one(r, null, 'place:away', 'a fix outside both places is away');
        assert.strictEqual(places(fixAt(0.11)).length, 0, 'a second one tells nothing');
        send('reply', { tag: 'place:away', ok: true });
        r = fixAt(0.1995);
        one(r, 'work', 'place:work', 'a fix inside Work');
        assert.strictEqual(places(fixAt(0.1996)).length, 0, 'a second fix at Work tells nothing');

        // a fix with a poor accuracy is not a position
        r = fixAt(0.0005, { accuracyM: 600 });
        assert.strictEqual(places(r).length, 0, 'accuracy over 500 m tells nothing');

        // the answer failed (the link went): told again by a later fix, not before a minute
        send('reply', { tag: 'place:work', type: 'traffic_place', ok: false, error: 'the link went' });
        assert.strictEqual(places(fixAt(0.1997)).length, 0, 'a failed place is not told at once');
        clock += 59 * 1000;
        assert.strictEqual(places(fixAt(0.1998)).length, 0, 'nor at 59 s');
        clock += 2 * 1000;
        one(fixAt(0.1999), 'work', 'place:work', 'after a minute a fix tells it again');
        send('reply', { tag: 'place:work', type: 'traffic_place', ok: true });
        assert.strictEqual(state.placeFail, null, 'an ok answer clears the failure');
        assert.strictEqual(places(fixAt(0.1999)).length, 0, 'and it is held again');

        // a failure for an older place does not disturb a newer one already sent
        r = fixAt(0.0001);
        one(r, 'home', 'place:home', 'back at Home');
        send('reply', { tag: 'place:work', type: 'traffic_place', ok: false, error: 'timed out' });
        assert.strictEqual(state.sentPlace, 'home', 'the older failure leaves the newer place sent');
        assert.strictEqual(places(fixAt(0.0002)).length, 0, 'the newer place is not told again');

        // the link comes back while driving and the server does not have the place
        send('reply', { tag: 'place:home', type: 'traffic_place', ok: false, error: 'the link went' });
        assert.strictEqual(state.sentPlace, '');
        clock += 61 * 1000;
        r = send('link', { connected: true });
        one(r, 'home', 'place:home', 'the link back re-tells the last fix place');
        assert.strictEqual(places(send('link', { connected: true })).length, 0, 'and only once');
        // a link back before the first fix of a drive tells nothing (no place known yet)
        r = send('drive', { state: 'parked_in_car', since: 9000 });
        r = send('drive', { state: 'driving', since: 9500 });
        assert.strictEqual(state.here, '');
        assert.strictEqual(places(send('link', { connected: true })).length, 0, 'no fix yet: nothing to re-tell');

        // a state saved by the previous version: no placeFail / here keys, sentPlace 'home'
        fresh();
        const old = { active: true, driveSince: 1000, mode: '', direction: '', level: 'low', feed: '', reports: {}, reportsAt: 0, places: { home: { lat: 0, lon: 0 }, work: { lat: 0.2, lon: 0 }, radiusM: 1000 }, area: { box: null, items: [] }, along: {}, last: {}, alerted: {}, asking: {}, outSig: '', hostOps: [], appr: null, sentPlace: 'home' };
        g = load(); hold(); first = true; state = old;
        send('start');
        assert.strictEqual(places(fixAt(0.0005)).length, 0, 'an old state at Home: held');
        assert.strictEqual(state.placeFail, null);
        assert.strictEqual(state.here, 'home');
        one(fixAt(0.1), null, 'place:away', 'an old state leaving Home tells away');
        // the old reply tag is taken without a fault
        send('reply', { tag: 'place', ok: false });
    }
}

console.log('test-cafe-drive-alerts: ok');
