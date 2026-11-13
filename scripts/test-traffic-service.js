#!/usr/bin/env node
/**
 * modules/trafficService.js (Yozora #795) without live calls: street matching, polyline and corridor
 * geometry, slowdowns, Waze alerts on the route, the preferred / better route choice, budgets, the
 * leave advisor and the scheduler's due times. Google and Waze are answered by a fake fetch.
 *
 *   node scripts/test-traffic-service.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-test-'));
process.env.TRAFFIC_USAGE_FILE = path.join(tmp, 'usage.json');
process.env.TRAFFIC_LATEST_FILE = path.join(tmp, 'latest.json');

const svc = require('../modules/trafficService');
const T = svc._test;

let pass = 0;
function ok(name, fn) {
    return Promise.resolve().then(fn).then(() => { pass++; console.log(`  ok  ${name}`); }, (e) => { console.error(`  FAIL ${name}\n${e.stack}`); process.exitCode = 1; });
}

// ---- a fake server
let cfg = {
    traffic: {
        home: { address: '100 Home Rd, Testville', lat: 44.0, lon: -103.0 },
        work: { address: '1 Work Plaza, Testville', lat: 44.0, lon: -102.9 },
        area: 'Testville, SD',
        streets: ['Main Street', 'Interstate 90 East'],
        leaveHome: '07:45', leaveWork: '17:15', leadMin: 10, days: [1, 2, 3, 4, 5]
    }
};
const keys = { googlemaps: [{ apiKey: 'g-key' }], waze: [{ apiKey: 'w-key' }] };
const sent = [];
const gr = {
    getConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o ? o[k] : undefined), cfg),
    modifyConfig: () => ({ assign: (pathArr, value) => { cfg[pathArr[0]] = value; return Promise.resolve(); } }),
    getApiKeyManager: () => ({ getServiceKeys: (s) => keys[s] || [], getSelectedIndex: () => 0 }),
    getWebSocketServer: () => ({ broadcast: (msg, filter) => sent.push({ msg, admin: filter({ userType: 'admin' }), user: filter({ userType: 'user' }) }) })
};
svc.bind(gr);

// Google's polyline encoding, for fixtures
function encode(points) {
    let out = '';
    let pl = 0;
    let pn = 0;
    const one = (v) => {
        let n = v < 0 ? ~(v << 1) : v << 1;
        let s = '';
        while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; }
        return s + String.fromCharCode(n + 63);
    };
    points.forEach(([lat, lon]) => {
        const a = Math.round(lat * 1e5);
        const b = Math.round(lon * 1e5);
        out += one(a - pl) + one(b - pn);
        pl = a; pn = b;
    });
    return out;
}

// straight east along lat 44.0 (preferred, Main St then I-90), and a detour north (faster today)
const line = Array.from({ length: 11 }, (_, i) => [44.0, -103.0 + i * 0.01]);
const north = [[44.0, -103.0], [44.01, -103.0], [44.01, -102.9], [44.0, -102.9]];
const prefRoute = {
    duration: '1500s', staticDuration: '900s', distanceMeters: 8000, description: 'I-90 E',
    polyline: { encodedPolyline: encode(line) },
    travelAdvisory: { speedReadingIntervals: [{ startPolylinePointIndex: 0, endPolylinePointIndex: 4, speed: 'NORMAL' }, { startPolylinePointIndex: 4, endPolylinePointIndex: 7, speed: 'TRAFFIC_JAM' }, { startPolylinePointIndex: 7, endPolylinePointIndex: 10, speed: 'NORMAL' }] },
    legs: [{ steps: [
        { distanceMeters: 3000, navigationInstruction: { instructions: 'Head east on Main St' } },
        { distanceMeters: 5000, navigationInstruction: { instructions: 'Merge onto I-90 E' } }
    ] }]
};
const fastRoute = {
    duration: '1000s', staticDuration: '950s', distanceMeters: 9500, description: 'Omaha St',
    polyline: { encodedPolyline: encode(north) },
    legs: [{ steps: [{ distanceMeters: 9500, navigationInstruction: { instructions: 'Turn left onto Omaha St' } }] }]
};
const calls = [];
T.setFetch(async (url, init) => {
    calls.push({ url, init });
    const body = init && init.body ? JSON.parse(init.body) : null;
    const json = (o, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(o) });
    if (/routes\.googleapis/.test(url)) {
        assert.strictEqual(init.headers['X-Goog-Api-Key'], 'g-key');
        if (body.intermediates) {
            assert.deepStrictEqual(body.intermediates, [{ address: 'Main Street & Interstate 90 East, Testville, SD', via: true }]);
            return json({ routes: [prefRoute] });
        }
        if (body.computeAlternativeRoutes) return json({ routes: [prefRoute, fastRoute] });
        return json({ routes: [prefRoute] });
    }
    if (/waze\.p\.rapidapi\.com\/alerts-and-jams/.test(url)) {
        assert.strictEqual(init.headers['X-RapidAPI-Key'], 'w-key');
        return json({ status: 'OK', data: {
            alerts: [
                { alert_id: 'a1', type: 'POLICE', subtype: 'POLICE_HIDING', street: 'I-90 E', latitude: 44.0005, longitude: -102.95, publish_datetime_utc: '2026-11-13T12:00:00.000Z', num_thumbs_up: 3 },
                { alert_id: 'a2', type: 'ACCIDENT', subtype: 'ACCIDENT_MAJOR', street: 'Main St', latitude: 44.0, longitude: -102.98 },
                { alert_id: 'a3', type: 'POLICE', subtype: '', street: 'Far Rd', latitude: 44.05, longitude: -102.95 }
            ],
            jams: [{ jam_id: 'j1', level: 4, street: 'I-90 E', delay_seconds: 300, line_coordinates: [{ lat: 44.0, lon: -102.96 }, { lat: 44.0, lon: -102.94 }] }]
        } });
    }
    throw new Error(`unexpected ${url}`);
});

(async () => {
    console.log('trafficService');

    await ok('street names normalise', () => {
        assert.strictEqual(T.normStreet('Interstate 90 East'), 'i90 e');
        assert.strictEqual(T.normStreet('I-90 E'), 'i90 e');
        assert.strictEqual(T.normStreet('Main Street'), 'main st');
        assert.strictEqual(T.streetCore('I-90 E'), 'i90');
        assert.strictEqual(T.streetOfInstruction('Turn left onto Main St'), 'Main St');
        assert.strictEqual(T.streetOfInstruction('Merge onto I-90 E toward Sioux Falls'), 'I-90 E');
    });

    await ok('streets match route text', () => {
        const m = T.matchStreets('Head east on Main St | Merge onto I-90 E', ['Main Street', 'Interstate 90 East', 'Omaha St']);
        assert.deepStrictEqual(m.hit, ['Main Street', 'Interstate 90 East']);
        assert.ok(Math.abs(m.coverage - 2 / 3) < 1e-9);
        assert.strictEqual(T.matchStreets('I-190', ['I-90']).hit.length, 0);
    });

    await ok('via waypoints are street intersections', () => {
        assert.deepStrictEqual(T.viaWaypoints(['A St', 'B Ave', 'C Rd'], 'Town'), ['A St & B Ave, Town', 'B Ave & C Rd, Town']);
        assert.deepStrictEqual(T.viaWaypoints(['A St'], 'Town'), ['A St, Town']);
    });

    await ok('polyline round trip and corridor distance', () => {
        const pts = T.decodePolyline(encode(line));
        assert.strictEqual(pts.length, 11);
        assert.ok(Math.abs(pts[10].lon + 102.9) < 1e-6);
        const cum = T.cumulative(pts);
        const loc = T.locate(pts, cum, { lat: 44.0009, lon: -102.95 });
        assert.ok(loc.distM > 90 && loc.distM < 110, `dist ${loc.distM}`);
        assert.ok(Math.abs(loc.alongM / cum[10] - 0.5) < 0.01);
    });

    await ok('check: preferred via route, better route, traps, alerts, jams, slowdowns', async () => {
        const r = await svc.check('work', { force: true });
        assert.strictEqual(r.provider, 'google');
        assert.strictEqual(r.preferred.summary, 'I-90 E');
        assert.ok(r.preferred.viaPreferred);
        assert.strictEqual(r.routes.length, 2, 'the twin alternative is folded into the via route');
        assert.ok(r.better && r.better.summary === 'Omaha St' && r.better.savesSec === 500);
        assert.deepStrictEqual(r.traps.map((t) => t.id), ['a1']);
        assert.strictEqual(r.traps[0].label, 'Speed trap (hidden)');
        assert.deepStrictEqual(r.alerts.map((a) => a.label), ['Major accident']);
        assert.strictEqual(r.jams.length, 1);
        assert.ok(r.jams[0].major);
        assert.strictEqual(r.slowdowns.length, 1);
        assert.strictEqual(r.slowdowns[0].speed, 'TRAFFIC_JAM');
        assert.strictEqual(r.slowdowns[0].street, 'I-90 E');
        assert.strictEqual(r.level, 'heavy');
        assert.strictEqual(r.delaySec, 600);
        assert.ok(/1 speed trap on route/.test(r.summary), r.summary);
        assert.ok(/Faster: via Omaha St saves 8 min/.test(r.summary), r.summary);
        assert.ok(!r.preferred._points && Array.isArray(r.preferred.line));
        const b = sent.find((s) => s.msg.type === 'traffic_updated');
        assert.ok(b && b.admin && !b.user, 'updates go to admins only');
    });

    await ok('cache: a second check without force makes no call', async () => {
        const n = calls.length;
        await svc.check('work');
        assert.strictEqual(calls.length, n);
    });

    await ok('home direction reverses the streets', async () => {
        T.routeCache.clear();
        cfg.traffic.streets = ['Main Street'];
        const r = await svc.check('home', { force: true });
        assert.deepStrictEqual(r.streets, ['Main Street']);
        cfg.traffic.streets = ['Main Street', 'Interstate 90 East'];
    });

    await ok('budgets stop calls', async () => {
        T.routeCache.clear();
        cfg.traffic.budgets = { google: 0, waze: 0 };
        await assert.rejects(svc.check('work', { force: true }), /budget/i);
        cfg.traffic.budgets = { google: 4500, waze: 90 };
        const p = svc.providers();
        assert.ok(p.google.used > 0 && p.google.configured && p.waze.configured);
    });

    await ok('leave advisor suggests waiting when it saves enough', async () => {
        T.setFetch(async (url, init) => {
            const body = JSON.parse(init.body);
            const later = body.departureTime ? (Date.parse(body.departureTime) - Date.now()) / 60000 : 0;
            // 35 min now, 20 min from 30 min on
            const sec = later >= 29 ? 1200 : 2100;
            return { ok: true, status: 200, text: async () => JSON.stringify({ routes: [Object.assign({}, prefRoute, { duration: `${sec}s` })] }) };
        });
        T.routeCache.clear();
        const a = await svc.advise('home', { force: true });
        assert.ok(a.wait, JSON.stringify(a));
        assert.strictEqual(a.wait.offsetMin, 30);
        assert.strictEqual(a.wait.savesSec, 900);
        assert.ok(/Waiting 30 min saves 15 min/.test(a.summary), a.summary);
    });

    await ok('scheduler: due at leave time minus lead on set days, once', () => {
        const s = svc.getSettings();
        const fired = new Set();
        // Monday 07:35 -> work report; 17:05 -> home report
        assert.deepStrictEqual(T.dueNow(s, { date: '2026-11-16', minutes: 7 * 60 + 35, weekday: 1 }, fired).map((d) => d.direction), ['work']);
        assert.deepStrictEqual(T.dueNow(s, { date: '2026-11-16', minutes: 17 * 60 + 5, weekday: 1 }, fired).map((d) => d.direction), ['home']);
        assert.deepStrictEqual(T.dueNow(s, { date: '2026-11-16', minutes: 17 * 60 + 6, weekday: 1 }, fired).map((d) => d.direction), ['home'], 'a late tick still fires');
        fired.add('2026-11-16:home');
        assert.strictEqual(T.dueNow(s, { date: '2026-11-16', minutes: 17 * 60 + 6, weekday: 1 }, fired).length, 0);
        assert.strictEqual(T.dueNow(s, { date: '2026-11-15', minutes: 7 * 60 + 35, weekday: 0 }, new Set()).length, 0, 'not on Sunday');
        assert.strictEqual(T.dueNow(Object.assign({}, s, { notify: false }), { date: '2026-11-16', minutes: 7 * 60 + 35, weekday: 1 }, new Set()).length, 0);
    });

    await ok('settings save cleans input', async () => {
        const s = await svc.saveSettings({ leaveWork: '5:30', streets: 'A St\nB Ave\n', days: [5, 1, 1, 9] });
        assert.strictEqual(s.leaveWork, '05:30');
        assert.deepStrictEqual(s.streets, ['A St', 'B Ave']);
        assert.deepStrictEqual(s.days, [1, 5]);
        await assert.rejects(svc.saveSettings({ leaveHome: '25:00' }), /HH:MM/);
    });

    console.log(`${pass} passed`);
    fs.rmSync(tmp, { recursive: true, force: true });
})();
