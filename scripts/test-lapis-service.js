#!/usr/bin/env node
'use strict';

/**
 * Lapis Remote service checks (Yozora #835): node scripts/test-lapis-service.js
 * BlueLink is a stand-in (bluelinkClient._setRequest); nothing here can reach the real car.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lapis-test-'));
process.env.LAPIS_DB = ':memory:';
process.env.LAPIS_LATEST_FILE = path.join(dir, 'latest.json');
process.env.LAPIS_PICTURE_DIR = path.join(dir, 'pic');
process.env.TRAFFIC_USAGE_FILE = path.join(dir, 'tu.json');
process.env.TRAFFIC_LATEST_FILE = path.join(dir, 'tl.json');
process.env.TRAFFIC_CAMERA_FILE = path.join(dir, 'tc.json');

const bluelink = require('../modules/bluelinkClient');
const climate = require('../modules/lapisClimate');
const usage = require('../modules/lapisUsage');
const svc = require('../modules/lapisService');

const HOME = { lat: 38.6, lon: -76.9 };
const WORK = { lat: 38.82, lon: -77.02 };
const cfg = { lapis: { home: HOME, work: WORK, timeZone: 'America/New_York' }, traffic: {} };
const sent = [];
const keys = { bluelink: [{ apiKey: 'pw', username: 'me@example.com', pin: '1234' }] };
const gr = {
    getConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o == null ? o : o[k]), cfg),
    modifyConfig: () => ({ assign: (p, v) => { cfg[p[0]] = v; return Promise.resolve(); } }),
    getApiKeyManager: () => ({ getServiceKeys: (s) => keys[s] || [], getSelectedIndex: () => 0 }),
    getWebSocketServer: () => ({ broadcast: (m) => sent.push(m) }),
};

// the stand-in car
const car = { locked: true, engine: false, fuel: 62, odo: 48213, at: '2026-11-14T14:00:00Z', lat: HOME.lat, lon: HOME.lon, calls: [], actionStatus: 'SUCCESS', tokens: 0 };
function statusBody() {
    return {
        vehicleStatus: {
            dateTime: car.at, doorLock: car.locked, engine: car.engine, airCtrlOn: car.engine, defrost: false, fuelLevel: car.fuel, lowFuelLight: car.fuel < 12,
            dte: { value: Math.round(car.fuel * 6.2), unit: 3 }, odometer: car.odo, battery: { batSoc: car.health ? car.health.battery : 84, batSignalReferenceValue: { batWarning: car.health ? car.health.warnAt : 65 } }, tirePressure: car.health ? { tirePressureFrontLeft: car.health.psi.fl, tirePressureFrontRight: car.health.psi.fr, tirePressureRearLeft: car.health.psi.rl, tirePressureRearRight: car.health.psi.rr } : undefined, airTemp: { value: 'LO', unit: 1 },
            doorOpen: { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0 }, windowOpen: { frontLeft: 0, frontRight: 0, backLeft: 0, backRight: 0 },
            trunkOpen: false, hoodOpen: false, tirePressureLamp: { tirePressureWarningLampAll: 0, tirePressureWarningLampRearLeft: car.lampOff ? 0 : 1 },
            seatHeaterVentState: { flSeatHeatState: 2, frSeatHeatState: 2, rlSeatHeatState: 2, rrSeatHeatState: 2 },
        },
    };
}
bluelink._setRequest(async ({ method, path: p, headers, body }) => {
    car.calls.push({ method, path: p, headers, body });
    const ok = (o, h) => ({ status: 200, headers: h || {}, text: o === null ? '' : JSON.stringify(o) });
    if (p.endsWith('oauth/token')) { car.tokens++; return ok({ access_token: `t${car.tokens}`, refresh_token: 'r', expires_in: '1800' }); }
    if (p.includes('enrollment/details/')) return ok({ enrolledVehicleDetails: [{ vehicleDetails: { regid: 'REG1', vin: 'VIN1', nickName: 'Kuro', modelCode: 'SONATA HYBRID', modelYear: '2024', evStatus: 'N', vehicleGeneration: '3', odometer: String(car.odo), enrollmentStatus: 'ACTIVE' } }] });
    if (p.endsWith('rcs/rvs/vehicleStatus')) return ok(statusBody());
    if (p.endsWith('rcs/rfc/findMyCar')) return ok({ coord: { lat: car.lat, lon: car.lon, alt: 0 }, head: 90, speed: { value: 0, unit: 1 }, time: car.at });
    if (p.endsWith('rcs/rdo/off')) { car.locked = true; return ok(null, { tmsTid: 'TID-LOCK' }); }
    if (p.endsWith('rcs/rdo/on')) { car.locked = false; return ok(null, { tmsTid: 'TID-UNLOCK' }); }
    if (p.endsWith('rcs/rsc/start')) { car.engine = true; return ok(null, { tmsTid: 'TID-START' }); }
    if (p.endsWith('rcs/rsc/stop')) { car.engine = false; return ok(null, { tmsTid: 'TID-STOP' }); }
    if (p.endsWith('rmt/getRunningStatus')) return ok({ status: car.actionStatus });
    return { status: 404, headers: {}, text: 'no such call' };
});

// weather stand-in: 41 °F, half cloud, 400 W/m² -> estimate 44 °F
require('../modules/weatherService').openMeteoRaw = async () => ({
    current_weather: { temperature: 41, time: '2026-11-14T09:00', weathercode: 1, is_day: 1 },
    hourly: { time: ['2026-11-14T08:00', '2026-11-14T09:00'], shortwave_radiation: [100, 400], cloudcover: [80, 50], uv_index: [0, 1] },
});

let now = Date.parse('2026-11-14T14:05:00Z');
svc._test.setNow(() => now);
svc._test.setSleep(async () => {});
svc.bind(gr);

const notices = () => sent.filter((m) => m.type === 'lapis_notice').map((m) => m.data);
const lastState = () => sent.filter((m) => m.type === 'lapis_updated').pop().data.state;
const settle = () => new Promise((r) => setImmediate(() => setImmediate(() => setTimeout(r, 20))));

(async () => {
    // ---- climate table: Yukimi's sensor, row by row
    // the scaling line: within 2 °F of every step of Yukimi's old table at the step's middle, and the same levels
    for (const [t, temp, def, h, s] of [[25, 82, true, 4, 8], [37, 80, true, 3, 7], [48.5, 78, false, 3, 6], [66, 74, false, 0, 0], [80.5, 70, false, 0, 3], [90, 65, false, 0, 4], [100, 62, false, 0, 5]]) {
        const r = climate.choose(t);
        assert.ok(Math.abs(r.temp - temp) <= 2, `climate temperature at ${t}: ${r.temp} vs ${temp}`);
        assert.deepStrictEqual([r.defrost, r.heating, r.seat], [def, h, s], `climate levels at ${t}`);
    }
    assert.strictEqual(climate.choose(50, { seats: false, wheel: false }).seat, 0);
    assert.strictEqual(climate.choose(50, { seats: false, wheel: false }).heating, 0);
    assert.ok(climate.choose(66, { comfort: 70 }).temp === 70, 'comfort moves the mild point');
    assert.strictEqual(climate.cleanSettings({ coldAt: 60, seatHeatBelow: 40 }).seatHeatBelow > 50, true, 'anchors stay in order');
    assert.strictEqual(climate.interiorEstimate({ outdoorF: 41, shortwave: 400, cloudCover: 50 }), 44);

    // ---- first read
    let state = await svc.read({ reason: 'poll' });
    assert.strictEqual(state.vehicle.name, 'Kuro');
    assert.strictEqual(state.status.locked, true);
    assert.strictEqual(state.status.fuel, 62);
    assert.strictEqual(state.status.setTemp, 62, 'LO reads as the low end');
    assert.strictEqual(state.status.tireLow.any, true);
    assert.strictEqual(state.location.place, 'Home');
    assert.strictEqual(state.climate.temp, 79, '44 °F estimate -> 79 on the line');
    assert.strictEqual(state.climate.seat, 6);
    assert.ok(state.usage.refuel && state.usage.refuel.day, 'a refuel day');
    assert.strictEqual(state.usage.commute.basis, 'distance');
    const statusCall = car.calls.find((c) => c.path.endsWith('vehicleStatus'));
    assert.strictEqual(statusCall.headers.REFRESH, undefined, 'a poll does not wake the car');
    assert.strictEqual(statusCall.headers.blueLinkServicePin, '1234');
    assert.strictEqual(car.tokens, 1);

    assert.strictEqual(notices().filter((n) => n.kind === 'health' && n.key === 'alerts' && /(^|,)tire=/.test(n.stamp)).length, 1, 'the tire lamp is said on the first read (a car standing since before the server started is not "just parked")');
    car.lampOff = true;

    // ---- remote start with the automatic climate
    car.calls.length = 0;
    const res = await svc.command('start', {});
    assert.strictEqual(res.command.kind, 'start');
    assert.strictEqual(res.command.transactionId, undefined, 'the transaction id stays on the server');
    const start = car.calls.find((c) => c.path.endsWith('rcs/rsc/start'));
    assert.deepStrictEqual(start.body.airTemp, { unit: 1, value: 79 });
    assert.strictEqual(start.body.heating1, 3);
    assert.strictEqual(start.body.defrost, false);
    assert.strictEqual(start.body.seatHeaterVentInfo.drvSeatHeatState, 6);
    assert.strictEqual(start.body.seatHeaterVentInfo.astSeatHeatState, 0);
    assert.strictEqual(start.body.igniOnDuration, 10);
    await settle();
    assert.strictEqual(lastState().command.state, 'success');
    assert.strictEqual(lastState().status.engine, true);
    assert.ok(car.calls.some((c) => c.path.endsWith('vehicleStatus') && c.headers.REFRESH === 'true'), 'a fresh read follows a command');

    // a table temperature outside the car's range goes out as its end
    car.engine = false;
    await svc.command('start', { temp: 85, seat: 8, heating: 4, defrost: true, minutes: 99 });
    const hot = car.calls.filter((c) => c.path.endsWith('rcs/rsc/start')).pop();
    assert.strictEqual(hot.body.airTemp.value, 82);
    assert.strictEqual(hot.body.igniOnDuration, 30);
    await settle();
    // ---- a remote start on its timer: warnings at 5, 3, 2 and 1 minutes, then driving ends it
    sent.length = 0;
    const runCmd = svc._test.live.command;
    assert.ok(runCmd.runsUntil, 'the second start runs on its timer');
    const until = runCmd.runsUntil;
    const runLeft = () => notices().filter((n) => n.kind === 'run-left').map((n) => n.minutes);
    svc._test.sched.accountSig = '';
    now = until - 6 * 60000; await svc._test.tick();
    assert.deepStrictEqual(runLeft(), [], 'nothing at 6 minutes');
    now = until - 5 * 60000 + 1000; await svc._test.tick();
    now = until - 4 * 60000; await svc._test.tick();
    now = until - 3 * 60000 + 1000; await svc._test.tick();
    now = until - 2 * 60000 + 1000; await svc._test.tick();
    now = until - 60000 + 1000; await svc._test.tick();
    assert.deepStrictEqual(runLeft(), [5, 3, 2, 1], 'one warning at each mark');
    assert.match(notices().find((n) => n.kind === 'run-left').text, /remote start ends at/);
    assert.ok(svc.getState().command.runsUntil, 'still running before anyone drives');
    assert.strictEqual(svc.getState().command.startLoc, undefined, 'the start position stays on the server');
    car.odo += 2; car.at = new Date(now).toISOString();
    await svc.read({ reason: 'run' });
    assert.strictEqual(svc._test.live.command.runsUntil, null, 'driving ends the timer');
    assert.strictEqual(svc._test.live.command.ended, 'driving');
    assert.strictEqual(svc._test.activeRun(), null);
    now = until - 30000; await svc._test.tick();
    assert.deepStrictEqual(runLeft(), [5, 3, 2, 1], 'no more warnings once driving');

    // ---- a remote start that runs out its timer: off at once, and BlueLink's kept report from the run does not put it
    // back on (Today held "Running" after the timer and Start stayed off, Nov 18); one woken report confirms it
    car.engine = false;
    await svc.command('start', { minutes: 10 });
    await settle();
    const timed = svc._test.live.command;
    assert.ok(timed.runsUntil, 'the start runs on its timer');
    car.at = new Date(now).toISOString();
    now = timed.runsUntil + 1000;
    svc._test.sched.accountSig = '';
    svc._test.sched.runPollAt = now + 60000;
    await svc._test.tick();
    assert.strictEqual(svc._test.live.command.ended, 'timeout');
    assert.strictEqual(svc.getState().status.engine, false, 'the timer ran out: shown off');
    await svc.read({ reason: 'poll' });
    assert.strictEqual(svc.getState().status.engine, false, 'the kept report from the run does not show it running again');
    assert.ok(svc._test.sched.runEndCheckAt > 0, 'a woken look is due');
    car.calls.length = 0;
    car.engine = false;
    now = svc._test.sched.runEndCheckAt + 1000;
    car.at = new Date(now).toISOString();
    await svc._test.tick();
    assert.strictEqual(svc._test.sched.runEndCheckAt, 0);
    assert.ok(car.calls.some((c) => c.path.endsWith('vehicleStatus') && c.headers.REFRESH === 'true'), 'the end is confirmed with a woken report');
    assert.ok(svc.getState().command === null || !svc.getState().command.runsUntil, 'Start is offered again');
    svc._test.live.parkedSince = 0; // (the next check parks the car afresh)

    await assert.rejects(() => svc.command('honk'), /Unknown command/);

    // ---- left unlocked: one fresh look after lockRemindMin, then the notice
    car.engine = false; car.locked = false; car.at = '2026-11-14T15:00:00Z';
    now = Date.parse('2026-11-14T15:01:00Z');
    sent.length = 0;
    await svc.read({ reason: 'poll' });
    assert.strictEqual(notices().length, 0, 'no notice on the first sight');
    assert.ok(svc._test.sched.lockCheckAt >= Date.parse('2026-11-14T15:10:00Z'), 'the follow-up is set for 10 minutes after parking');
    now = svc._test.sched.lockCheckAt + 1000;
    car.calls.length = 0;
    svc._test.sched.accountSig = '';
    await svc._test.tick();
    assert.ok(car.calls.some((c) => c.headers.REFRESH === 'true'), 'the follow-up wakes the car');
    assert.strictEqual(notices().length, 1);
    assert.strictEqual(notices()[0].kind, 'unlocked');
    assert.deepStrictEqual(notices()[0].actions, ['lock']);
    assert.match(notices()[0].text, /Parked at Home for \d+ minutes/);
    // not again for the same stop
    now += 20 * 60 * 1000;
    await svc.read({ reason: 'poll' });
    await svc._test.tick();
    assert.strictEqual(notices().length, 1);
    // locked by hand in the meantime: no notice
    car.locked = true;
    await svc.read({ reason: 'poll' });

    // ---- low fuel, once per tank; a fill-up clears it. Crossed on a drive: quiet until the car has stood 30 minutes (Nov 21)
    sent.length = 0;
    const fuelNotes = () => notices().filter((n) => n.kind === 'health' && /(^|,)fuel=/.test(n.stamp));
    car.fuel = 18; car.odo += 270; car.at = '2026-11-15T15:00:00Z'; now = Date.parse('2026-11-15T15:02:00Z');
    await svc.read({ reason: 'poll' });
    assert.strictEqual(fuelNotes().length, 0, 'just driven: low fuel waits');
    now = Date.parse('2026-11-15T15:29:00Z');
    await svc.read({ reason: 'poll' });
    assert.strictEqual(fuelNotes().length, 0, 'still within 30 minutes of the drive');
    now = Date.parse('2026-11-15T15:31:00Z');
    await svc.read({ reason: 'poll' });
    assert.strictEqual(fuelNotes().length, 1, 'said once the car has stood 30 minutes');
    assert.strictEqual(fuelNotes()[0].title, 'Fuel is low');
    car.fuel = 16; car.odo += 10; car.at = '2026-11-15T18:00:00Z'; now = Date.parse('2026-11-15T18:02:00Z');
    await svc.read({ reason: 'poll' });
    now = Date.parse('2026-11-15T18:40:00Z');
    await svc.read({ reason: 'poll' });
    assert.strictEqual(fuelNotes().length, 1, 'only once per tank');
    now = Date.parse('2026-11-15T18:02:00Z');
    // 16 %: Monday's drive to work does not fit. Nothing at 1 PM on Sunday; said that evening, once
    svc._test.dailyNotices();
    assert.strictEqual(notices().filter((n) => n.kind === 'refuel').length, 0, 'not in the middle of the day before');
    now = Date.parse('2026-11-16T00:10:00Z'); // 7:10 PM Sunday in New York
    svc._test.dailyNotices();
    const refuelNote = notices().filter((n) => n.kind === 'refuel');
    assert.strictEqual(refuelNote.length, 1, 'the evening before a before-work stop');
    assert.strictEqual(refuelNote[0].title, 'Get gas tomorrow morning');
    svc._test.dailyNotices();
    assert.strictEqual(notices().filter((n) => n.kind === 'refuel').length, 1);

    // when to refuel: a work day is two drives, so the answer is a day and a side of work
    const wk = { miles: [5, 100, 100, 100, 100, 100, 5], basis: Array(7).fill('history') };
    const rb = (fuelPct, extra) => usage.refuelBy(Object.assign({ fuelPct, milesPerPct: 5, weekday: wk, todayKey: '2026-11-15', reservePct: 15, workDays: [1, 2, 3, 4, 5] }, extra)).stop;
    assert.deepStrictEqual(rb(26), { day: '2026-11-16', part: 'after-work' }, '55 miles: Sunday 5, Monday morning 50, not the drive home');
    assert.deepStrictEqual(rb(20), { day: '2026-11-16', part: 'before-work' }, '25 miles: not even Monday morning');
    assert.deepStrictEqual(rb(15.5), { day: '2026-11-15', part: null }, 'a day off: no side of work');
    assert.deepStrictEqual(rb(36), { day: '2026-11-17', part: 'before-work' }, '105 miles: Sunday and all of Monday');
    assert.deepStrictEqual(usage.refuelBy({ fuelPct: 20, milesPerPct: 5, weekday: wk, todayKey: '2026-11-16', milesToday: 50, reservePct: 15, workDays: [1, 2, 3, 4, 5] }).stop, { day: '2026-11-16', part: 'after-work' }, 'at work already: the drive home');
    car.fuel = 97; car.at = '2026-11-15T19:00:00Z'; now = Date.parse('2026-11-15T19:02:00Z');
    state = await svc.read({ reason: 'poll' });
    assert.strictEqual(svc._test.live.flags.lowFuel, false);
    assert.ok(state.usage.refuel.daysLeft >= 3, 'a full tank pushes the refuel day out');

    // ---- vehicle health: said at once, again when worse, kept in state until a report clears it
    sent.length = 0;
    car.health = { battery: 41, warnAt: 65, psi: { fl: 30, fr: 30, rl: 28, rr: 30 } };
    car.at = '2026-11-15T20:00:00Z'; now = Date.parse('2026-11-15T20:02:00Z');
    state = await svc.read({ reason: 'poll' });
    let health = notices().filter((n) => n.kind === 'health');
    assert.strictEqual(health.length, 1, 'the 12 V battery under the car\'s level');
    assert.strictEqual(health[0].key, 'alerts');
    assert.strictEqual(health[0].stamp, 'battery12=b4');
    assert.match(health[0].text, /41%.*warning level 65%/);
    assert.match(health[0].text, /It was 84% at/);
    assert.strictEqual(state.alerts.length, 1);
    await svc.read({ reason: 'poll' });
    assert.strictEqual(notices().filter((n) => n.kind === 'health').length, 1, 'not repeated while unchanged');
    car.health.battery = 38; car.at = '2026-11-15T21:00:00Z'; now = Date.parse('2026-11-15T21:02:00Z');
    await svc.read({ reason: 'poll' });
    assert.strictEqual(notices().filter((n) => n.kind === 'health').length, 2, 'again after another 10 points bucket');
    car.health.psi.rl = 22; car.at = '2026-11-15T22:00:00Z'; now = Date.parse('2026-11-15T22:02:00Z');
    state = await svc.read({ reason: 'poll' });
    health = notices().filter((n) => n.kind === 'health');
    assert.strictEqual(health.length, 3);
    // two alerts at once: one notification naming both, a short line each (Nov 21: several notifications before)
    assert.strictEqual(health[2].title, 'Kuro needs attention');
    assert.strictEqual(health[2].count, 2);
    assert.match(health[2].text, /Tire low: rear left 22 psi/);
    assert.match(health[2].text, /12 V battery 38%/);
    assert.ok(!/Inflate|check for an inverter/.test(health[2].text), 'the advice stays in Lapis');
    assert.strictEqual(sent.filter((m) => m.type === 'lapis_notice').length, 3, 'one push per read, never one per alert')
    assert.deepStrictEqual(state.alerts.map((a) => a.key).sort(), ['battery12', 'tire']);
    assert.deepStrictEqual(svc._test.lowTires({ tirePsi: { fl: 35, fr: 35, rl: 30, rr: 35 }, tireLow: {} }, { tireLowPsi: 26 }), ['rl'], 'one tire 4 psi under the others');
    car.health = { battery: 90, warnAt: 65, psi: { fl: 33, fr: 33, rl: 33, rr: 33 } }; car.at = '2026-11-15T23:00:00Z'; now = Date.parse('2026-11-15T23:02:00Z');
    state = await svc.read({ reason: 'poll' });
    assert.strictEqual(state.alerts.length, 0, 'cleared by a good report');
    assert.deepStrictEqual(svc._test.live.flags.health, {});

    // ---- quiet while the car runs (Nov 21): a new alert waits; the left-unlocked reminder is not an alert
    sent.length = 0;
    car.engine = true; car.health = { battery: 90, warnAt: 65, psi: { fl: 33, fr: 33, rl: 20, rr: 33 } }; car.at = '2026-11-16T01:00:00Z'; now = Date.parse('2026-11-16T01:02:00Z');
    state = await svc.read({ reason: 'poll' });
    assert.strictEqual(notices().filter((n) => n.kind === 'health').length, 0, 'running: no alert');
    assert.deepStrictEqual(state.alerts.map((a) => a.key), ['tire'], 'Lapis still shows it');
    car.engine = false; car.at = '2026-11-16T01:10:00Z'; now = Date.parse('2026-11-16T01:12:00Z');
    await svc.read({ reason: 'poll' });
    assert.strictEqual(notices().filter((n) => n.kind === 'health').length, 0, 'just parked: still quiet');
    // a tire switched off by itself (Settings > Notifications): never said, still shown
    await svc.saveSettings({ notify: { tire: false } });
    assert.strictEqual(svc.getSettings().notify.tire, false);
    assert.strictEqual(svc.getSettings().notify.battery12, true, 'the other items stay on');
    now = Date.parse('2026-11-16T02:00:00Z');
    state = await svc.read({ reason: 'poll' });
    assert.strictEqual(notices().filter((n) => n.kind === 'health').length, 0, 'the tire is switched off');
    assert.deepStrictEqual(state.alerts.map((a) => a.key), ['tire'], 'still in Lapis');
    // the battery joins: one notification for it alone (the switched-off tire is not in it)
    car.health.battery = 40; now = Date.parse('2026-11-16T02:30:00Z');
    await svc.read({ reason: 'poll' });
    health = notices().filter((n) => n.kind === 'health');
    assert.strictEqual(health.length, 1);
    assert.strictEqual(health[0].title, '12 V battery is low');
    assert.ok(!/tire/.test(health[0].stamp), 'the tire is left out');
    await svc.saveSettings({ notify: { tire: true } });
    car.health = { battery: 90, warnAt: 65, psi: { fl: 33, fr: 33, rl: 33, rr: 33 } }; now = Date.parse('2026-11-16T03:00:00Z');
    await svc.read({ reason: 'poll' });

    // ---- the record
    const hist = svc.getHistory('month');
    assert.ok(hist.count >= 5, `samples recorded (${hist.count})`);
    assert.strictEqual(hist.fillups.length, 1);
    assert.ok(hist.trips.length >= 1);
    assert.ok(hist.events.some((e) => e.kind === 'command'));
    const imp = svc.importSamples([{ t: Date.parse('2026-10-01T12:00:00Z'), odo: 46000, fuel: 50 }, { t: Date.parse('2026-10-02T12:00:00Z'), odo: 46050, fuel: 42 }, { t: 'bad' }]);
    assert.strictEqual(imp.added, 2);
    assert.strictEqual(svc.importSamples([{ t: Date.parse('2026-10-01T12:00:00Z'), odo: 1 }]).added, 0, 'an import never replaces a row');

    // ---- maintenance
    let m = lastState().maintenance.find((x) => x.id === 'oil');
    assert.strictEqual(m.milesLeft, 48000 + 8000 - car.odo);
    await svc.serviceDone('oil');
    m = svc.getState().maintenance.find((x) => x.id === 'oil');
    assert.strictEqual(m.milesLeft, 8000);
    assert.strictEqual(m.known, true);

    // ---- settings and picture
    const s = await svc.saveSettings({ climate: { comfort: 72, seats: false }, lowFuelPct: 25, workDays: [1, 2, 3, 4], leaveHome: '7:15', notify: { refuel: false } });
    assert.strictEqual(s.lowFuelPct, 25);
    assert.strictEqual(s.climate.comfort, 72);
    assert.strictEqual(s.climate.seats, false);
    assert.strictEqual(s.climate.coldAt, 33, 'unset anchors keep their defaults');
    assert.deepStrictEqual(s.workDays, [1, 2, 3, 4]);
    assert.strictEqual(s.leaveHome, '07:15');
    assert.strictEqual(s.notify.refuel, false);
    assert.strictEqual(s.notify.unlocked, true);
    await assert.rejects(() => svc.saveSettings({ home: { lat: 'x' } }), /Home needs a position/);
    await assert.rejects(() => svc.savePicture('data:text/html;base64,AAAA'), /PNG, JPEG or WebP/);
    const pic = await svc.savePicture(`data:image/png;base64,${Buffer.from('fake').toString('base64')}`);
    assert.ok(pic.picture.rev);
    assert.match(svc.getPicture().dataUrl, /^data:image\/png;base64,/);
    await svc.savePicture(null);
    assert.strictEqual(svc.getPicture().picture, null);

    // ---- a failed sign-in is reported, not thrown out of the scheduler
    keys.bluelink = [];
    await assert.rejects(() => svc.read({}), /No BlueLink account/);
    assert.strictEqual(svc.getState().configured, false);

    // ---- usage maths
    assert.strictEqual(usage.weekdayOf('2026-11-14'), 6);
    assert.strictEqual(usage.addDays('2026-12-31', 1), '2027-01-01');

    svc._test.reset();
    fs.rmSync(dir, { recursive: true, force: true });
    console.log('lapis service: all checks passed');
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
