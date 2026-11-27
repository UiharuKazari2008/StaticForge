#!/usr/bin/env node
/**
 * modules/trafficService.js (Yozora #795) without live calls: street matching, polyline and corridor
 * geometry, slowdowns, TomTom incidents and OpenStreetMap cameras on the route, the preferred / better route choice, budgets, the
 * leave advisor and the scheduler's due times. Google, TomTom and Overpass are answered by a fake fetch.
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
// never the live notification inbox (.cache/notifications.db, #1061)
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.TRAFFIC_LATEST_FILE = path.join(tmp, 'latest.json');
process.env.TRAFFIC_CAMERA_FILE = path.join(tmp, 'cameras.json');
process.env.TRAFFIC_PLACES_FILE = path.join(tmp, 'places.json');
process.env.LOCATION_GEO_FILE = path.join(tmp, 'location-geo.json');
// the test devices' list (modules/testDevices.js): one emulator, and the session its task socket uses; never the live file
const TEST_ID = 'ab'.repeat(16);
process.env.TEST_DEVICES_FILE = path.join(tmp, 'test-devices.json');
fs.writeFileSync(process.env.TEST_DEVICES_FILE, JSON.stringify({ devices: { [TEST_ID]: { name: 'Emulator', markedAt: 1 } }, sessions: { 'sess-test': TEST_ID } }));

const svc = require('../modules/trafficService');
const T = svc._test;
T.setPrimaryLookup(() => ''); // no primary phone unless a test sets one (never the live ActiveSync database)

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
const keys = { googlemaps: [{ apiKey: 'g-key' }], tomtom: [{ apiKey: 't-key' }] };
const sent = [];
const gr = {
    getConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o ? o[k] : undefined), cfg),
    modifyConfig: () => ({ assign: (pathArr, value) => { cfg[pathArr[0]] = value; return Promise.resolve(); } }),
    getApiKeyManager: () => ({ getServiceKeys: (s) => keys[s] || [], getSelectedIndex: () => 0 }),
    getWebSocketServer: () => ({ broadcast: (msg, filter) => sent.push({ msg, filter, admin: filter({ userType: 'admin' }), user: filter({ userType: 'user' }) }) })
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
const baseFetch = async (url, init) => {
    calls.push({ url, init });
    const body = init && init.body && /routes\.googleapis/.test(url) ? JSON.parse(init.body) : null;
    const json = (o, status = 200) => ({ ok: status < 400, status, text: async () => JSON.stringify(o) });
    if (/routes\.googleapis/.test(url)) {
        assert.strictEqual(init.headers['X-Goog-Api-Key'], 'g-key');
        if (body.intermediates) {
            // one point per preferred street, taken from the alternative that drives them (Main St, then I-90 E)
            assert.strictEqual(body.intermediates.length, 2);
            body.intermediates.forEach((w) => assert.ok(w.via && Number.isFinite(w.location.latLng.latitude), JSON.stringify(w)));
            assert.ok(body.intermediates[0].location.latLng.longitude < body.intermediates[1].location.latLng.longitude, 'in driving order');
            return json({ routes: [prefRoute] });
        }
        if (body.computeAlternativeRoutes) return json({ routes: [prefRoute, fastRoute] });
        return json({ routes: [prefRoute] });
    }
    if (/api\.tomtom\.com\/traffic\/services\/5\/incidentDetails/.test(url)) {
        const q = new URL(url).searchParams;
        assert.strictEqual(q.get('key'), 't-key');
        assert.ok(/^-103\.\d+,43\.\d+,-102\.\d+,44\.\d+$/.test(q.get('bbox')), q.get('bbox'));
        return json({ incidents: [
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-102.98, 44.0] }, properties: { id: 'i1', iconCategory: 1, magnitudeOfDelay: 3, events: [{ description: 'accident', code: 201 }], from: 'Main St', to: '5th St', roadNumbers: [], delay: 240 } },
            { type: 'Feature', geometry: { type: 'LineString', coordinates: [[-102.96, 44.0], [-102.95, 44.0], [-102.94, 44.0]] }, properties: { id: 'j1', iconCategory: 6, magnitudeOfDelay: 4, events: [{ description: 'stationary traffic' }], roadNumbers: ['I-90'], delay: 300, length: 1600 } },
            { type: 'Feature', geometry: { type: 'Point', coordinates: [-102.95, 44.05] }, properties: { id: 'far', iconCategory: 9, magnitudeOfDelay: 1, events: [{ description: 'roadworks' }] } }
        ] });
    }
    if (/overpass/.test(url)) {
        assert.ok(/speed_camera/.test(decodeURIComponent(init.body)));
        return json({ elements: [
            { type: 'node', id: 11, lat: 44.0002, lon: -102.95, tags: { highway: 'speed_camera', maxspeed: '65 mph' } },
            { type: 'node', id: 12, lat: 44.03, lon: -102.95, tags: { highway: 'speed_camera' } },
            { type: 'relation', id: 90, tags: { type: 'enforcement', enforcement: 'traffic_signals' }, members: [{ type: 'node', ref: 13, role: 'device' }] },
            { type: 'node', id: 13, lat: 44.0, lon: -102.92, tags: {} },
            // a police zone (#907): an enforcement relation with no device, from / to on the route
            { type: 'relation', id: 91, tags: { type: 'enforcement', enforcement: 'maxspeed', maxspeed: '55 mph' }, members: [{ type: 'node', ref: 14, role: 'from' }, { type: 'node', ref: 15, role: 'to' }] },
            { type: 'node', id: 14, lat: 44.0, lon: -102.97, tags: {} },
            { type: 'node', id: 15, lat: 44.0, lon: -102.965, tags: {} }
        ] });
    }
    if (/waze\.p\.rapidapi\.com/.test(url)) {
        assert.strictEqual(init.headers['X-RapidAPI-Key'], 'w-key');
        assert.ok(/alert_types=POLICE/.test(url));
        return json({ data: { alerts: [
            { alert_id: 'p1', type: 'POLICE', subtype: 'POLICE_HIDING', latitude: 44.0001, longitude: -102.93, street: 'I-90 E', publish_datetime_utc: '2026-11-17T12:00:00Z' },
            { alert_id: 'p2', type: 'POLICE', latitude: 44.06, longitude: -102.93 }
        ] } });
    }
    throw new Error(`unexpected ${url}`);
};
T.setFetch(baseFetch);

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
        assert.strictEqual(r.preferred.summary, 'your streets');
        assert.strictEqual(r.preferred.googleSummary, 'I-90 E');
        assert.ok(r.preferred.viaPreferred);
        assert.strictEqual(r.routes.length, 2, 'the twin alternative is folded into the via route');
        assert.ok(r.better && r.better.summary === 'Omaha St (6 mi)' && r.better.savesSec === 500);
        assert.deepStrictEqual(r.traps.map((t) => t.id), ['osm:11', 'osm:13'], JSON.stringify(r.errors));
        assert.strictEqual(r.traps[0].label, 'Speed camera');
        assert.strictEqual(r.traps[0].maxspeed, '65 mph');
        assert.strictEqual(r.traps[1].label, 'Red light camera');
        assert.deepStrictEqual(r.alerts.map((a) => a.label), ['Accident']);
        assert.ok(r.alerts[0].major && r.alerts[0].street === 'Main St');
        assert.strictEqual(r.jams.length, 1);
        assert.ok(r.jams[0].major && r.jams[0].street === 'I-90');
        assert.ok(r.incidentsChecked && r.camerasChecked);
        assert.strictEqual(r.slowdowns.length, 1);
        assert.strictEqual(r.slowdowns[0].speed, 'TRAFFIC_JAM');
        assert.strictEqual(r.slowdowns[0].street, 'I-90 E');
        // 10 min late with major alerts: clear - only the yellow / red minutes (25 / 45 by default) colour it (#902)
        assert.strictEqual(r.level, 'clear');
        assert.strictEqual(r.delaySec, 600);
        assert.ok(/2 speed cameras on route/.test(r.summary), r.summary);
        assert.ok(/Faster: via Omaha St \(6 mi\) saves 8 min/.test(r.summary), r.summary);
        assert.deepStrictEqual(r.police.map((p) => [p.id, p.label]), [['osmz:91', 'Speed enforcement zone']], 'the police zone on the route');
        assert.ok(!r.preferred._points && Array.isArray(r.preferred.line));
        const b = sent.find((s) => s.msg.type === 'traffic_updated');
        assert.ok(b && b.admin && !b.user, 'updates go to admins only');
    });

    await ok('nearby: a point on no route gets the stored area\'s cameras and police zones', async () => {
        const r = await svc.nearby(44.0, -102.95);
        assert.ok(r.box && r.cameras.some((c) => c.id === 'osm:11'), JSON.stringify(r.cameras.map((c) => c.id)));
        assert.ok(r.police.some((z) => z.id === 'osmz:91' && Array.isArray(z.line) && z.line.length === 2));
        await assert.rejects(() => svc.nearby('x', 1), /lat and lon/);
    });

    await ok('police feed: OSM zones always, Waze live reports on the route with a key, read once per 25 min', async () => {
        let items = await svc.policeSample('work');
        assert.deepStrictEqual(Object.keys(items), ['osmz:91'], 'no Waze key: the zones only');
        keys.waze = [{ apiKey: 'w-key' }];
        const before = calls.filter((c) => /waze/.test(c.url)).length;
        items = await svc.policeSample('work');
        assert.deepStrictEqual(Object.keys(items).sort(), ['osmz:91', 'waze:p1'], 'the report off the route is dropped');
        assert.strictEqual(items['waze:p1'].label, 'Hidden police reported');
        await svc.policeSample('work');
        assert.strictEqual(calls.filter((c) => /waze/.test(c.url)).length - before, 1, 'the second read uses the kept answer');
        delete keys.waze;
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

    await ok('to Home from the phone\'s position routes from there, without the preferred streets', async () => {
        T.routeCache.clear();
        const n = calls.length;
        const r = await svc.check('home', { force: true, origin: { lat: 44.1234567, lon: -103.2345678 } });
        assert.strictEqual(r.fromHere, true);
        assert.deepStrictEqual(r.origin, { lat: 44.123, lon: -103.235 }, 'rounded to ~110 m');
        assert.deepStrictEqual(r.streets, []);
        const g = calls.slice(n).filter((c) => /routes\.googleapis/.test(c.url)).map((c) => JSON.parse(c.init.body));
        assert.ok(g.length >= 1 && g.every((b) => !b.intermediates), 'no via streets');
        assert.strictEqual(g[0].origin.location.latLng.latitude, 44.123);
        const w = await svc.check('work', { force: true, origin: { lat: 1, lon: 2 } });
        assert.strictEqual(w.fromHere, false, 'only the way home takes an origin');
    });

    await ok('one TomTom / Overpass call serves both directions', async () => {
        T.routeCache.clear();
        T.cameraState.store = {};
        const before = calls.filter((c) => /tomtom|overpass/.test(c.url)).length;
        await svc.check('work');
        await svc.check('home');
        const n = calls.filter((c) => /tomtom|overpass/.test(c.url)).length - before;
        assert.strictEqual(n, 2, `calls ${n}`);
    });

    await ok('budgets stop calls; TomTom past its budget leaves the routes', async () => {
        T.routeCache.clear();
        cfg.traffic.budgets = { google: 4500, tomtom: 0 };
        const r = await svc.check('work', { force: true });
        assert.ok(!r.incidentsChecked && r.camerasChecked && r.errors.some((e) => /TomTom/.test(e)));
        T.routeCache.clear();
        cfg.traffic.budgets = { google: 0, tomtom: 0 };
        await assert.rejects(svc.check('work', { force: true }), /budget/i);
        cfg.traffic.budgets = { google: 4500, tomtom: 2000 };
        const p = svc.providers();
        assert.ok(p.google.used > 0 && p.google.configured && p.tomtom.configured && p.tomtom.per === 'day');
    });

    await ok('Overpass at capacity: the mirror answers; all down: the report goes on, with a backoff', async () => {
        const real = calls.length;
        T.routeCache.clear();
        T.cameraState.store = {};
        T.cameraState.backoff.clear();
        const orig = T.getFetch();
        T.setFetch(async (url, init) => (/overpass-api\.de/.test(url) ? { ok: false, status: 502, text: async () => 'at capacity' } : orig(url, init)));
        const r = await svc.check('work', { force: true });
        assert.ok(r.camerasChecked && r.traps.length === 2, JSON.stringify(r.errors));
        T.routeCache.clear();
        T.cameraState.store = {};
        T.setFetch(async (url, init) => (/overpass/.test(url) ? { ok: false, status: 502, text: async () => 'at capacity' } : orig(url, init)));
        const r2 = await svc.check('work', { force: true });
        assert.ok(!r2.camerasChecked && r2.preferred && r2.errors.some((e) => /Speed cameras/.test(e)));
        assert.ok(T.cameraState.backoff.size === 1);
        T.setFetch(orig);
        T.cameraState.backoff.clear();
        assert.ok(calls.length >= real);
    });

    await ok('cameras are saved to disk and survive an outage (and a restart)', async () => {
        T.routeCache.clear();
        T.cameraState.store = {};
        T.cameraState.backoff.clear();
        await svc.check('work', { force: true });
        const file = JSON.parse(fs.readFileSync(process.env.TRAFFIC_CAMERA_FILE, 'utf8'));
        const keysOnDisk = Object.keys(file);
        assert.ok(keysOnDisk.length === 1 && file[keysOnDisk[0]].cameras.length >= 2, 'list on disk');
        // a restart: memory empty, the list comes back from disk; Overpass down and the list a year old
        T.cameraState.store = null;
        const store = JSON.parse(fs.readFileSync(process.env.TRAFFIC_CAMERA_FILE, 'utf8'));
        store[keysOnDisk[0]].at = Date.now() - 365 * 24 * 3600 * 1000;
        fs.writeFileSync(process.env.TRAFFIC_CAMERA_FILE, JSON.stringify(store));
        const orig = T.getFetch();
        T.setFetch(async (url, init) => (/overpass/.test(url) ? { ok: false, status: 502, text: async () => 'at capacity' } : orig(url, init)));
        T.routeCache.clear();
        const r = await svc.check('work', { force: true });
        assert.ok(r.camerasChecked && r.traps.length === 2, 'the old list is used');
        await new Promise((res) => setTimeout(res, 50));
        assert.ok(T.cameraState.store[keysOnDisk[0]].cameras.length >= 2, 'a failed refresh keeps the list');
        T.setFetch(orig);
        T.cameraState.backoff.clear();
    });

    await ok('street lookups: only inside the corridor and naming the street; a far preferred route is dropped', async () => {
        T.resetPlaces();
        const route = T.normaliseGoogle(prefRoute);
        const orig = T.getFetch();
        T.setFetch(async (url, init) => {
            if (/geocode\/json/.test(url)) {
                const q = new URL(url).searchParams.get('address');
                const results = /Far Rd/.test(q) ? [{ formatted_address: 'Far Rd, Pennsylvania', types: ['route'], geometry: { location: { lat: 40.1, lng: -74.9 } } }]
                    : /Side St & /.test(q) ? [{ formatted_address: 'Other Ave & Main St, Testville', types: ['intersection'], geometry: { location: { lat: 44.0, lng: -102.97 } } }]
                    : /Side St/.test(q) ? [{ formatted_address: 'Side St, Testville, SD', types: ['route'], geometry: { location: { lat: 44.001, lng: -102.96 } } }] : [];
                return { ok: true, status: 200, text: async () => JSON.stringify({ status: results.length ? 'OK' : 'ZERO_RESULTS', results }) };
            }
            return orig(url, init);
        });
        const a = await T.anchorStreets(['Main Street', 'Side St', 'Far Rd'], [route]);
        assert.deepStrictEqual(a.points.map((p) => `${p.street}:${p.how}`), ['Main Street:route', 'Side St:lookup']);
        assert.ok(/Side St, Testville/.test(a.points[1].address), 'the crossing that does not name Side St is refused');
        assert.deepStrictEqual(a.missing, ['Far Rd']);
        // a via route 2x the shortest is dropped with a note
        T.setFetch(async (url, init) => {
            const body = /routes\.googleapis/.test(url) ? JSON.parse(init.body) : null;
            if (body && body.intermediates) return { ok: true, status: 200, text: async () => JSON.stringify({ routes: [Object.assign({}, prefRoute, { distanceMeters: 30000 })] }) };
            return orig(url, init);
        });
        T.routeCache.clear();
        T.anchorCache.clear();
        const r = await svc.check('work', { force: true });
        assert.ok(!r.preferred.viaPreferred && r.errors.some((e) => /closest Google route/.test(e)), JSON.stringify(r.errors));
        T.setFetch(orig);
        T.routeCache.clear();
        T.anchorCache.clear();
    });

    await ok('TomTom: a box over 10,000 km2 is split into tiles', () => {
        assert.ok(T.boxAreaKm2({ s: 38, n: 39, w: -77.5, e: -76.5 }) > 9000);
        assert.ok(T.boxAreaKm2({ s: 38.5, n: 38.9, w: -77.1, e: -76.7 }) < 9000);
    });

    await ok('no Google key: a clear error', async () => {
        T.routeCache.clear();
        const g = keys.googlemaps;
        delete keys.googlemaps;
        await assert.rejects(svc.check('work', { force: true }), /Google Maps key/);
        keys.googlemaps = g;
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

    await ok('wire report (#890 W4): preferredIndex, preferred left out when routes[0], lines on the preferred route only, hash; the asker is left out of traffic_updated', async () => {
        T.routeCache.clear();
        const asker = { userType: 'admin', authenticated: true };
        const other = { userType: 'admin', authenticated: true };
        sent.length = 0;
        const r = await svc.check('work', { force: true, requester: asker });
        const w = svc.wireReport(r);
        assert.strictEqual(svc.wireReport(r), w, 'made once per report');
        const idx = r.routes.findIndex((x) => x.preferred);
        assert.strictEqual(idx, 0, 'the via route leads');
        assert.strictEqual(w.preferredIndex, 0);
        assert.ok(!('preferred' in w), 'not sent twice');
        assert.deepStrictEqual(w.preferred || w.routes[w.preferredIndex || 0], r.preferred, 'the page rule finds the preferred route, line included');
        w.routes.forEach((x, i) => { if (i !== idx) { assert.ok(!('line' in x), 'no line off the preferred route'); assert.ok(Array.isArray(x.steps), 'steps stay (Directions)'); } });
        assert.ok(r.preferred && r.routes.every((x) => Array.isArray(x.line)), 'the stored report keeps its full shape');
        assert.match(w.hash, /^[0-9a-f]{40}$/);
        const b = sent.find((x) => x.msg.type === 'traffic_updated');
        assert.ok(b && b.filter(other) && !b.filter(asker), 'the asker gets it in its reply only');
        assert.ok(!b.filter({ userType: 'user' }), 'still admins only');
        assert.strictEqual(b.msg.data.report, w, 'the broadcast carries the wire report');
        // a preferred route that is not first keeps preferred (and its line)
        const syn = { routes: [{ id: 'r0', preferred: false, line: [[1, 2]], steps: [] }, { id: 'r1', preferred: true, line: [[3, 4]], steps: [] }], preferred: { id: 'r1', preferred: true, line: [[3, 4]], steps: [] } };
        const ws = svc.wireReport(syn);
        assert.strictEqual(ws.preferredIndex, 1);
        assert.deepStrictEqual(ws.preferred, syn.preferred);
        assert.ok(!('line' in ws.routes[0]) && Array.isArray(ws.routes[1].line));
        assert.ok(Array.isArray(syn.routes[0].line), 'the source is not changed');
    });

    await ok('traffic_get (#890 W4): hash of both reports; have unchanged -> same: true without latest; traffic_check replies the wire report', async () => {
        const registry = require('../modules/ws/wsPacketRegistry');
        const out = [];
        const ctx = { globalResources: gr, sendToClient: (ws, m) => out.push(m), sendError: (ws, msg) => out.push({ error: msg }) };
        require('../modules/ws/handlers/292-trafficHandler').registerPackets(ctx);
        const get = registry.getWsPacketHandler('traffic_get');
        const info = { userType: 'admin', authenticated: true };
        await get({ ws: {}, message: { type: 'traffic_get', requestId: 'g1' }, clientInfo: info });
        const full = out.pop().data;
        assert.ok(full.latest && full.latest.work && full.latest.home, 'both reports');
        assert.strictEqual(full.hash, `${full.latest.work.hash}|${full.latest.home.hash}`);
        assert.ok(!('preferred' in full.latest.work) && full.latest.work.preferredIndex === 0);
        await get({ ws: {}, message: { type: 'traffic_get', requestId: 'g2', have: full.hash }, clientInfo: info });
        const same = out.pop().data;
        assert.strictEqual(same.same, true);
        assert.ok(!('latest' in same), 'nothing sent again');
        assert.ok(same.settings && same.providers && same.hash === full.hash);
        await get({ ws: {}, message: { type: 'traffic_get', requestId: 'g3', have: { work: full.latest.work.hash, home: full.latest.home.hash } }, clientInfo: info });
        assert.strictEqual(out.pop().data.same, true, 'have as { work, home }');
        await get({ ws: {}, message: { type: 'traffic_get', requestId: 'g4', have: `${full.latest.work.hash}|old` }, clientInfo: info });
        assert.ok(out.pop().data.latest, 'one report differs: the whole reply');
        sent.length = 0;
        T.routeCache.clear();
        await registry.getWsPacketHandler('traffic_check')({ ws: {}, message: { type: 'traffic_check', requestId: 'c1', direction: 'home', force: true }, clientInfo: info });
        const rep = out.pop().data.report;
        assert.strictEqual(typeof rep.preferredIndex, 'number');
        assert.match(rep.hash, /^[0-9a-f]{40}$/);
        const b = sent.find((x) => x.msg.type === 'traffic_updated');
        assert.ok(b && !b.filter(info) && b.filter({ userType: 'admin' }), 'the asking socket is left out of the broadcast');
    });

    // ---- the phone's place (#1289): per phone, the primary phone decides, 7 days, test devices ignored
    const HOURS = 3600 * 1000;
    const DAYS = 24 * HOURS;
    const quiet = (fn) => { // the module's "[traffic] phone place" log lines, captured
        const lines = [];
        const real = console.log;
        console.log = (...a) => lines.push(a.join(' '));
        return Promise.resolve().then(fn).then((r) => { console.log = real; return { r, lines }; }, (e) => { console.log = real; throw e; });
    };
    const phoneFile = () => JSON.parse(fs.readFileSync(T.PHONE_FILE, 'utf8'));
    const rep = (device, place, at = Date.now(), via = 'task') => svc.setPhonePlace(place, { device, name: `Phone ${device}`, via, at });
    const FOLD = 'f'.repeat(32);
    const A53 = 'a'.repeat(32);
    const EMU = TEST_ID;

    await ok('phone place: bad place refused, v2 file persisted and read back, nothing reported = nothing known', async () => {
        T.setPrimaryLookup(() => '');
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        assert.strictEqual(svc.phonePlaceNow(), null, 'nothing reported');
        let d = svc.phoneDecision('home');
        assert.deepStrictEqual([d.skip, d.why], [false, 'no phone has said where it is']);
        for (const bad of ['garage', undefined, 'Home', 7, {}]) assert.strictEqual(svc.setPhonePlace(bad, { device: 'x' }), false, `refused: ${String(bad)}`);
        assert.strictEqual(fs.existsSync(T.PHONE_FILE), false, 'a refused report writes nothing');
        assert.deepStrictEqual(svc.phonePlaces().devices, []);
        const t0 = Date.now();
        const { lines } = await quiet(() => svc.setPhonePlace('home', { device: FOLD, name: 'Galaxy Fold', via: 'task', at: t0 }));
        assert.deepStrictEqual(lines, ['[traffic] phone place: Galaxy Fold none -> home (task)']);
        assert.strictEqual(svc.phonePlaceNow(t0 + 1000), 'home');
        const f = phoneFile();
        assert.strictEqual(f.v, 2);
        assert.deepStrictEqual(f.devices[FOLD], { name: 'Galaxy Fold', place: 'home', at: t0, via: 'task' });
        assert.deepStrictEqual(f.log, [{ at: t0, device: FOLD, name: 'Galaxy Fold', place: 'home', via: 'task' }]);
        assert.ok(!fs.existsSync(`${T.PHONE_FILE}.tmp`), 'written tmp + rename');
        // a restart (the module state gone) reads the file back
        T.resetPhone();
        assert.strictEqual(svc.phonePlaceNow(t0 + 1000), 'home', 'persisted');
        const got = svc.phonePlaces(t0 + 1000);
        assert.deepStrictEqual(got.devices.map((x) => [x.device, x.name, x.place, x.at, x.via, x.fresh, x.decides]), [[FOLD, 'Galaxy Fold', 'home', t0, 'task', true, true]]);
        assert.strictEqual(got.primary, '');
        d = svc.phoneDecision('home', t0 + 1000);
        assert.strictEqual(d.skip, true);
        assert.strictEqual(d.why, `Galaxy Fold is at Home (told by its task, ${new Date(t0).toISOString()})`);
        assert.strictEqual(svc.phoneDecision('work', t0 + 1000).skip, false);
        // away is an answer too
        const r2 = await quiet(() => svc.setPhonePlace(null, { device: FOLD, via: 'task', at: t0 + 5 }));
        assert.deepStrictEqual(r2.lines, ['[traffic] phone place: Galaxy Fold home -> away (task)'], 'the stored name is kept when a report has none');
        assert.strictEqual(svc.phoneDecision('home', t0 + 10).why, 'Galaxy Fold is away');
        assert.strictEqual(svc.phonePlaceNow(t0 + 10), null);
        // the old format, a corrupt file and a missing file read as empty
        fs.writeFileSync(T.PHONE_FILE, JSON.stringify({ place: 'home', at: t0 }));
        T.resetPhone();
        assert.strictEqual(svc.phonePlaceNow(t0 + 1000), null, 'the old { place, at } format is empty');
        assert.deepStrictEqual(svc.phonePlaces().devices, []);
        fs.writeFileSync(T.PHONE_FILE, '{not json');
        T.resetPhone();
        assert.strictEqual(svc.phonePlaceNow(), null, 'a corrupt file is empty');
        fs.rmSync(T.PHONE_FILE, { force: true });
        T.resetPhone();
        assert.strictEqual(svc.phonePlaceNow(), null, 'a missing file is empty');
        assert.deepStrictEqual(svc.phonePlaces().log, []);
    });

    await ok('phone place: a report lives 7 days (6 d 23 h counts, 7 d + 1 ms does not)', async () => {
        T.setPrimaryLookup(() => '');
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        assert.strictEqual(T.PHONE_PLACE_TTL, 7 * DAYS);
        const t0 = Date.now();
        await quiet(() => rep(FOLD, 'home', t0));
        assert.strictEqual(svc.phonePlaceNow(t0 + 6 * DAYS + 23 * HOURS), 'home', '6 d 23 h still counts');
        assert.strictEqual(svc.phonePlaceNow(t0 + 7 * DAYS), 'home', 'exactly 7 d still counts');
        assert.strictEqual(svc.phonePlaceNow(t0 + 7 * DAYS + 1), null, '7 d + 1 ms: nothing');
        assert.strictEqual(svc.phoneDecision('home', t0 + 7 * DAYS).skip, true);
        const stale = svc.phoneDecision('home', t0 + 7 * DAYS + 1);
        assert.deepStrictEqual([stale.skip, stale.why], [false, 'no phone has said where it is']);
        assert.strictEqual(svc.phonePlaces(t0 + 7 * DAYS + 1).devices[0].fresh, false);
        assert.strictEqual(svc.phonePlaces(t0 + 7 * DAYS + 1).devices[0].decides, false);
    });

    await ok('phone place: the log keeps the last 20 changes; a repeat is no change; the file is not rewritten for a repeat inside an hour; old and surplus phones are dropped', async () => {
        T.setPrimaryLookup(() => '');
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        const t0 = Date.now();
        await quiet(async () => { for (let i = 0; i < 25; i++) rep(FOLD, i % 2 ? 'home' : 'work', t0 + i); });
        let f = phoneFile();
        assert.strictEqual(f.log.length, 20);
        assert.deepStrictEqual(f.log.map((e) => e.at), Array.from({ length: 20 }, (_, i) => t0 + 5 + i), 'the newest 20, newest last');
        assert.strictEqual(f.log[19].place, 'work');
        // an unchanged repeat: in memory at once, the file not rewritten inside an hour
        fs.writeFileSync(T.PHONE_FILE, 'SENTINEL');
        const r = await quiet(() => rep(FOLD, 'work', t0 + 30 * 1000));
        assert.deepStrictEqual(r.lines, [], 'an unchanged report is not logged');
        assert.strictEqual(fs.readFileSync(T.PHONE_FILE, 'utf8'), 'SENTINEL', 'not rewritten inside an hour');
        assert.strictEqual(svc.phonePlaces(t0 + 31 * 1000).devices[0].at, t0 + 30 * 1000, 'but its time is kept in memory');
        await quiet(() => rep(FOLD, 'work', t0 + 30 * 1000 + HOURS + 1));
        f = phoneFile();
        assert.strictEqual(f.devices[FOLD].at, t0 + 30 * 1000 + HOURS + 1, 'rewritten when the stored copy is older than an hour');
        assert.strictEqual(f.log.length, 20, 'still no new log entry');
        // a change always writes
        fs.writeFileSync(T.PHONE_FILE, 'SENTINEL');
        await quiet(() => rep(FOLD, null, t0 + 30 * 1000 + HOURS + 2));
        assert.strictEqual(phoneFile().devices[FOLD].place, null);
        // a phone silent for 30 days is dropped on the next write
        const now = Date.now();
        fs.writeFileSync(T.PHONE_FILE, JSON.stringify({ v: 2, devices: { gone: { name: 'Gone', place: 'home', at: now - 31 * DAYS, via: 'task' }, kept: { name: 'Kept', place: 'home', at: now - 29 * DAYS, via: 'task' } }, log: [] }));
        T.resetPhone();
        assert.strictEqual(svc.phonePlaces().devices.length, 2);
        await quiet(() => rep(A53, 'work', now));
        assert.deepStrictEqual(Object.keys(phoneFile().devices).sort(), [A53, 'kept'].sort());
        // at most 16 phones: the oldest go
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        await quiet(async () => { for (let i = 0; i < 18; i++) rep(`dev${i}`, 'home', now - 1000 + i); });
        const keys = Object.keys(phoneFile().devices);
        assert.strictEqual(keys.length, 16);
        assert.ok(!keys.includes('dev0') && !keys.includes('dev1') && keys.includes('dev17'), 'the two oldest were dropped');
    });

    await ok('scheduled notice: the PRIMARY phone decides, no API call / broadcast / publish / go when skipped', async () => {
        const inboxMod = require('../modules/notificationInbox');
        inboxMod.bind(gr);
        T.setFetch(baseFetch); // earlier tests may leave their own fake
        // a spy on publish: a cleared notice keeps its state when published again, so the call itself is what counts
        const realPublish = inboxMod.publish;
        const published = [];
        inboxMod.publish = (n) => { published.push(n.id); return realPublish(n); };
        const noticeId = (kind, direction) => `traffic:${kind}:${direction}:${T.localNow(svc.getSettings()).date}`;
        // one scheduled check after `setup` has told the service what the phones said
        const run = async (setup, direction, kind = 'scheduled') => {
            T.resetPhone();
            fs.rmSync(T.PHONE_FILE, { force: true });
            await quiet(setup);
            fs.rmSync(process.env.TRAFFIC_USAGE_FILE, { force: true });
            T.resetUsage();
            T.routeCache.clear();
            T.sched.go.clear();
            calls.length = 0;
            sent.length = 0;
            published.length = 0;
            const { lines } = await quiet(() => T.runScheduled(direction, kind));
            return {
                published: published.includes(noticeId(kind, direction)),
                fetched: calls.filter((c) => /routes\.googleapis|api\.tomtom\.com/.test(c.url)).length,
                broadcast: sent.some((x) => x.msg.type === 'traffic_report'),
                go: T.sched.go.has(direction),
                skipLine: lines.find((l) => /skipped/.test(l)) || ''
            };
        };
        const SKIPPED = { published: false, fetched: 0, broadcast: false, go: false };
        const asSkipped = (r) => ({ published: r.published, fetched: r.fetched, broadcast: r.broadcast, go: r.go });
        const sent1 = (r) => r.published && r.fetched > 0 && r.broadcast;
        try {
            // a primary phone is set: only its reports decide
            T.setPrimaryLookup(() => FOLD);
            const atHomeOtherWork = () => { rep(FOLD, 'home'); rep(A53, 'work'); };
            let r = await run(atHomeOtherWork, 'home');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'primary at Home, desk phone at Work: To Home skipped');
            assert.match(r.skipLine, /^\[traffic\] scheduled home skipped: Phone f{32} is at Home \(told by its task, \d{4}-/);
            r = await run(atHomeOtherWork, 'work');
            assert.ok(sent1(r), `primary at Home: To Work still published ${JSON.stringify(r)}`);
            const atWorkOtherHome = () => { rep(FOLD, 'work'); rep(A53, 'home'); };
            r = await run(atWorkOtherHome, 'home');
            assert.ok(sent1(r), `primary at Work, desk phone at Home: To Home published ${JSON.stringify(r)}`);
            r = await run(atWorkOtherHome, 'work');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'primary at Work: To Work skipped');
            const away = () => { rep(FOLD, null); rep(A53, 'home'); };
            for (const direction of ['home', 'work']) {
                r = await run(away, direction);
                assert.ok(sent1(r), `primary away: To ${direction} published ${JSON.stringify(r)}`);
            }
            const onlyOther = () => { rep(A53, 'home'); };
            r = await run(onlyOther, 'home');
            assert.ok(sent1(r), `primary set but only another phone reported: published ${JSON.stringify(r)}`);
            assert.strictEqual(svc.phoneDecision('home').why, 'the primary phone has not said where it is');
            assert.strictEqual(svc.phonePlaceNow(), null);
            // the stay-home day: Home told 23 h ago still counts; 7 d + 1 s ago does not
            r = await run(() => rep(FOLD, 'home', Date.now() - 23 * HOURS), 'home');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'a 23 h old Home report still skips');
            r = await run(() => rep(FOLD, 'home', Date.now() - 7 * DAYS - 1000), 'home');
            assert.ok(sent1(r), `older than 7 days does not skip ${JSON.stringify(r)}`);
            // the go run follows the same rule
            r = await run(atHomeOtherWork, 'home', 'go');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'go: primary at Home');
            r = await run(atWorkOtherHome, 'work', 'go');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'go: primary at Work');
            r = await run(atHomeOtherWork, 'work', 'go');
            assert.ok(r.published || r.fetched > 0, `go: primary at Home, To Work runs ${JSON.stringify(r)}`);
            assert.strictEqual(svc.phonePlaces().primary, FOLD);
            assert.deepStrictEqual(svc.phonePlaces().devices.map((x) => [x.device, x.decides]).sort(), [[A53, false], [FOLD, true]].sort());

            // no primary: every fresh phone counts and they must agree
            T.setPrimaryLookup(() => '');
            r = await run(() => rep(FOLD, 'home'), 'home');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'no primary, one phone at Home: skipped');
            r = await run(() => { rep(FOLD, 'home'); rep(A53, 'home'); }, 'home');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'no primary, two phones at Home: skipped');
            assert.strictEqual(svc.phonePlaceNow(), 'home');
            r = await run(() => { rep(FOLD, 'home'); rep(A53, 'work'); }, 'home');
            assert.ok(sent1(r), `no primary, the phones disagree: published ${JSON.stringify(r)}`);
            assert.strictEqual(svc.phonePlaceNow(), null);
            r = await run(() => { rep(FOLD, 'home'); rep(A53, null); }, 'home');
            assert.ok(sent1(r), `no primary, one phone away: published ${JSON.stringify(r)}`);
            r = await run(() => { rep(FOLD, 'home'); rep(A53, 'work', Date.now() - 8 * DAYS); }, 'home');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'a stale report of another phone does not count');
            r = await run(() => rep(FOLD, 'home'), 'work');
            assert.ok(sent1(r), `no primary, Home: To Work published ${JSON.stringify(r)}`);
            r = await run(() => rep(FOLD, 'home'), 'home', 'go');
            assert.deepStrictEqual(asSkipped(r), SKIPPED, 'no primary: the go run follows the same rule');
            // nothing reported: the notice as before
            r = await run(() => {}, 'home');
            assert.ok(sent1(r), `nothing reported: published ${JSON.stringify(r)}`);
        } finally {
            inboxMod.publish = realPublish;
            T.setPrimaryLookup(() => '');
            T.resetPhone();
            fs.rmSync(T.PHONE_FILE, { force: true });
            T.sched.go.clear();
        }
    });

    await ok('test lane: its reports never change the household decision and the other way round; the lane run publishes into the test lane only', async () => {
        const inboxMod = require('../modules/notificationInbox');
        inboxMod.bind(gr);
        T.setFetch(baseFetch);
        const realPublish = inboxMod.publish;
        const publishes = [];
        inboxMod.publish = (n) => { publishes.push(n); return realPublish(n); };
        const date = () => T.localNow(svc.getSettings()).date;
        const lane = { lane: 'test' };
        const reset = () => {
            T.resetPhone();
            fs.rmSync(T.PHONE_FILE, { force: true });
            fs.rmSync(process.env.TRAFFIC_USAGE_FILE, { force: true });
            T.resetUsage();
            T.routeCache.clear();
            T.sched.go.clear();
            calls.length = 0;
            sent.length = 0;
            publishes.length = 0;
            inboxMod._test.reset();
        };
        const testRep = (device, place, at = Date.now()) => svc.setPhonePlace(place, { device, name: `Test ${device}`, via: 'page', at, lane: 'test' });
        const fetched = () => calls.filter((c) => /routes\.googleapis|api\.tomtom\.com/.test(c.url)).length;
        try {
            T.setPrimaryLookup(() => FOLD);
            // storage: separate lanes, one file, restart-proof
            reset();
            const logs = await quiet(() => { testRep(A53, 'home'); rep(FOLD, 'work'); });
            assert.deepStrictEqual(logs.lines, ['[traffic] test lane phone place: Test aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa none -> home (page)', '[traffic] phone place: Phone ffffffffffffffffffffffffffffffff none -> work (task)']);
            assert.deepStrictEqual(svc.phonePlaces().devices.map((x) => x.device), [FOLD], 'the household never sees a test device');
            assert.deepStrictEqual(svc.phonePlaces(Date.now(), lane).devices.map((x) => x.device), [A53], 'the lane holds it');
            assert.strictEqual(svc.phonePlaces(Date.now(), lane).primary, '', 'the test lane has no primary');
            assert.strictEqual(svc.phonePlaces(Date.now(), lane).log.length, 1);
            assert.strictEqual(svc.phonePlaces().log.length, 1);
            let f = phoneFile();
            assert.deepStrictEqual([Object.keys(f.devices), Object.keys(f.test.devices), f.log.length, f.test.log.length], [[FOLD], [A53], 1, 1]);
            T.resetPhone();
            assert.strictEqual(svc.phonePlaceNow(Date.now(), lane), 'home', 'the test lane is read back from the file');
            assert.strictEqual(svc.phonePlaceNow(), 'work');
            // a test-lane report never changes the household's decision (the primary at Home, a test phone at Work, and the other way round)
            reset();
            await quiet(() => { rep(FOLD, 'home'); testRep(A53, 'work'); });
            assert.strictEqual(svc.phoneDecision('home').skip, true);
            assert.strictEqual(svc.phoneDecision('work').skip, false);
            assert.strictEqual(svc.phoneDecision('home', Date.now(), lane).skip, false, 'the test lane decides from its own reports');
            assert.strictEqual(svc.phoneDecision('work', Date.now(), lane).skip, true);
            // with no primary the household's decision still does not see a test device
            T.setPrimaryLookup(() => '');
            reset();
            await quiet(() => { testRep(A53, 'home'); });
            assert.strictEqual(svc.phonePlaceNow(), null);
            assert.deepStrictEqual([svc.phoneDecision('home').skip, svc.phoneDecision('home').why], [false, 'no phone has said where it is']);
            // the lane: every fresh test device counts and all must agree, the primary is never used
            T.setPrimaryLookup(() => FOLD);
            await quiet(() => { testRep(EMU, 'home'); });
            assert.strictEqual(svc.phoneDecision('home', Date.now(), lane).skip, true, 'two test phones at Home');
            await quiet(() => { testRep(EMU, 'work'); });
            assert.strictEqual(svc.phoneDecision('home', Date.now(), lane).skip, false, 'two test phones that disagree');
            assert.strictEqual(svc.phonePlaceNow(Date.now(), lane), null);

            // the lane run: skipped (the test phone is at the destination)
            reset();
            await quiet(() => { testRep(EMU, 'home'); });
            let res;
            const out = await quiet(async () => { res = await T.runScheduled('home', 'scheduled', lane); });
            assert.strictEqual(res.skipped, true);
            assert.match(res.why, /^Test (ab)+ is at Home \(told by its page, \d{4}-/);
            assert.strictEqual(out.lines.length, 1);
            assert.ok(out.lines[0].startsWith('[traffic] test lane scheduled home skipped: Test '), out.lines[0]);
            assert.deepStrictEqual([fetched(), sent.length, publishes.length, T.sched.go.size], [0, 0, 0, 0], 'no call, no broadcast, no publish, no go');
            // the lane run: published into the test lane, and only there
            reset();
            await quiet(() => { testRep(EMU, 'work'); rep(FOLD, 'home'); }); // the household's primary is AT Home: its own run would be skipped
            await quiet(async () => { res = await T.runScheduled('home', 'scheduled', lane); });
            const id = `traffic:scheduled:home:${date()}`;
            assert.deepStrictEqual([res.skipped, res.noticeId], [false, id]);
            assert.match(res.title, /^To Home/);
            assert.ok(fetched() > 0, 'the route was read');
            assert.strictEqual(sent.filter((x) => x.msg.type === 'traffic_report').length, 0, 'no traffic_report to any household page');
            assert.strictEqual(T.sched.go.size, 0, 'no go');
            const laneReads = calls.filter((c) => /routes\.googleapis/.test(c.url)).length;
            T.routeCache.clear();
            calls.length = 0;
            await svc.check('home', { force: true });
            assert.strictEqual(laneReads, calls.filter((c) => /routes\.googleapis/.test(c.url)).length, 'the lane run reads what one check reads: no leave advisor');
            assert.strictEqual(publishes.length, 1);
            assert.deepStrictEqual([publishes[0].user, publishes[0].push, publishes[0].alert, publishes[0].id, publishes[0].cls, publishes[0].ttlMs], ['test', true, true, id, 'notification', 3 * 3600 * 1000]);
            assert.deepStrictEqual(publishes[0].actions, ['view']);
            assert.deepStrictEqual(publishes[0].data, { app: 'traffic', direction: 'home', open: 'home' });
            assert.ok(inboxMod.get('test', id), 'in the test lane');
            assert.strictEqual(inboxMod.get('admin', id), null, 'not in the household\'s inbox');
            assert.strictEqual(res.title, inboxMod.get('test', id).title);
            // the household's own run is skipped at Home and published when the test device is at Home (it never counts)
            reset();
            await quiet(() => { testRep(EMU, 'home'); });
            await quiet(async () => { res = await T.runScheduled('home', 'scheduled'); });
            assert.strictEqual(res.skipped, false, 'a test device at Home does not skip the household notice');
            assert.ok(inboxMod.get('admin', id) && !inboxMod.get('test', id), 'published for the household only');
            assert.strictEqual(publishes[0].user, undefined, 'the household notice names no lane');
            assert.ok(sent.some((x) => x.msg.type === 'traffic_report'), 'and its page broadcast is as before');
            reset();
            await quiet(() => { rep(FOLD, 'home'); });
            await quiet(async () => { res = await T.runScheduled('home', 'scheduled'); });
            assert.deepStrictEqual([res.skipped, /^Phone f+ is at Home/.test(res.why)], [true, true], 'the household run returns the same shape');
            // go kind in the lane, and the lane run for Work
            reset();
            await quiet(async () => { res = await T.runScheduled('work', 'go', lane); });
            assert.deepStrictEqual([res.skipped, res.noticeId], [false, `traffic:go:work:${date()}`]);
            assert.strictEqual(res.why, 'no phone has said where it is');
            assert.ok(inboxMod.get('test', `traffic:go:work:${date()}`));
        } finally {
            inboxMod.publish = realPublish;
            T.setPrimaryLookup(() => '');
            reset();
        }
    });

    await ok('test lane: clearPhoneLane forgets the lane only; /api/test-devices/traffic routes (GET, POST run, DELETE)', async () => {
        const inboxMod = require('../modules/notificationInbox');
        const testDevices = require('../modules/testDevices');
        T.setPrimaryLookup(() => FOLD);
        T.setFetch(baseFetch);
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        inboxMod._test.reset();
        await quiet(() => { rep(FOLD, 'home'); svc.setPhonePlace('home', { device: EMU, name: 'Emulator', via: 'task', lane: 'test' }); });
        assert.strictEqual(svc.clearPhoneLane('house'), false, 'only the test lane can be cleared');
        // the routes, mounted on a tiny app
        const routes = {};
        const app = {};
        ['get', 'post', 'put', 'delete'].forEach((m) => { app[m] = (p, ...h) => { routes[`${m.toUpperCase()} ${p}`] = h; }; });
        require('../modules/trafficTestLaneRoute').mount(app, null);
        for (const k of ['GET /api/test-devices/traffic', 'POST /api/test-devices/traffic/run', 'DELETE /api/test-devices/traffic']) assert.ok(routes[k], `${k} is mounted`);
        const call = async (key, body = {}, userType = 'admin') => {
            const res = { code: 200, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
            // auth, admin, handler: the chain as express runs it
            const fns = routes[key];
            const pending = [];
            let i = 0;
            const next = () => { const fn = fns[i++]; if (fn) pending.push(Promise.resolve(fn({ body, query: {}, params: {}, userType }, res, next))); };
            next();
            await Promise.all(pending);
            return res;
        };
        let r = await call('GET /api/test-devices/traffic');
        assert.strictEqual(r.body.success, true);
        assert.deepStrictEqual(r.body.places.devices.map((x) => [x.device, x.place, x.via]), [[EMU, 'home', 'task']], 'the test lane only, no household phone');
        assert.strictEqual(r.body.decision.home.skip, true);
        assert.strictEqual(r.body.decision.work.skip, false);
        // the run: the emulator is at Home -> To Home skipped, To Work published into the test lane
        r = await call('POST /api/test-devices/traffic/run', { direction: 'home' });
        assert.deepStrictEqual([r.body.success, r.body.result.skipped], [true, true]);
        r = await call('POST /api/test-devices/traffic/run', { direction: 'work', kind: 'scheduled' });
        assert.strictEqual(r.body.success, true);
        assert.strictEqual(r.body.result.skipped, false);
        const wid = `traffic:scheduled:work:${T.localNow(svc.getSettings()).date}`;
        assert.strictEqual(r.body.result.noticeId, wid);
        assert.ok(inboxMod.get('test', wid) && !inboxMod.get('admin', wid));
        assert.strictEqual((await call('POST /api/test-devices/traffic/run', { direction: 'sideways' })).code, 400);
        assert.strictEqual((await call('POST /api/test-devices/traffic/run', { direction: 'home', kind: 'x' })).code, 400);
        assert.strictEqual((await call('POST /api/test-devices/traffic/run', { direction: 'home' }, 'user')).code, 403, 'admin only');
        assert.strictEqual((await call('GET /api/test-devices/traffic', {}, 'user')).code, 403);
        assert.strictEqual((await call('DELETE /api/test-devices/traffic', {}, 'user')).code, 403);
        // no test device set: refused like the notice route
        testDevices.unmark(TEST_ID);
        try {
            r = await call('POST /api/test-devices/traffic/run', { direction: 'work' });
            assert.deepStrictEqual([r.code, r.body.code], [409, 'NO_TEST_DEVICE']);
        } finally {
            testDevices.mark(TEST_ID, { name: 'Emulator' });
            testDevices.noteHello({ id: TEST_ID, sessionId: 'sess-test' });
        }
        // the clear: the test lane is empty, the household's phone is not
        r = await call('DELETE /api/test-devices/traffic');
        assert.deepStrictEqual(r.body, { success: true });
        assert.deepStrictEqual(svc.phonePlaces(Date.now(), { lane: 'test' }), { primary: '', devices: [], log: [] });
        assert.deepStrictEqual(svc.phonePlaces().devices.map((x) => x.device), [FOLD], 'the household phone stays');
        assert.deepStrictEqual(Object.keys(phoneFile().test.devices), [], 'and the file says so');
        T.setPrimaryLookup(() => '');
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        inboxMod._test.reset();
    });

    await ok('primary lookup: the default asks nothing of a gr without a path to its databases (no live activesync.db is opened)', async () => {
        T.setPrimaryLookup(null);
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        assert.strictEqual(svc.phonePlaces().primary, '', 'the stub gr has no getPath: no primary');
        T.setPrimaryLookup(() => '');
    });

    await ok('traffic_place packet: per phone from `as` or the session mate, via page / task, test devices and non-admins stored nowhere', async () => {
        const registry = require('../modules/ws/wsPacketRegistry');
        const out = [];
        const ctx = { globalResources: gr, sendToClient: (ws, m) => out.push(m), sendError: (ws, msg, code) => out.push({ error: msg, code }) };
        require('../modules/ws/handlers/292-trafficHandler').registerPackets(ctx);
        const h = registry.getWsPacketHandler('traffic_place');
        assert.ok(h, 'registered');
        T.setPrimaryLookup(() => '');
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        const call = async (place, clientInfo, wsServer, extra = {}) => {
            await quiet(() => h({ ws: {}, message: Object.assign({ type: 'traffic_place', requestId: 'p', place }, extra), clientInfo, wsServer }));
            return out.pop();
        };
        const devices = () => svc.phonePlaces().devices;
        const admin = { userType: 'admin', authenticated: true };
        // a non-admin is refused and changes nothing
        let m = await call('home', { userType: 'user' });
        assert.strictEqual(m.code, 'INSUFFICIENT_PERMISSIONS');
        assert.deepStrictEqual(devices(), [], 'a non-admin changes nothing');
        // the device of the socket's own `as`, source page
        m = await call('work', Object.assign({}, admin, { sessionId: 'sess-fold', as: { kind: 'device', id: FOLD, name: 'Galaxy Fold', speaker: 'webview' } }));
        assert.deepStrictEqual(m.data, { ok: true });
        assert.deepStrictEqual(devices().map((x) => [x.device, x.name, x.place, x.via]), [[FOLD, 'Galaxy Fold', 'work', 'page']]);
        // a light task socket (no `as`): the live device socket that shares its session; via task
        const server = { clients: new Map([
            [{ readyState: 1 }, { userType: 'admin', sessionId: 'sess-other', as: { kind: 'device', id: A53, name: 'A53 Test', speaker: 'service' } }],
            [{ readyState: 3 }, { userType: 'admin', sessionId: 'sess-closed', as: { kind: 'device', id: 'c'.repeat(32), name: 'Closed', speaker: 'service' } }],
            [{ readyState: 1 }, { userType: 'admin', sessionId: 'sess-fold', as: { kind: 'device', id: FOLD, name: 'Galaxy Fold', speaker: 'service' } }],
            [{ readyState: 1 }, { userType: 'admin', sessionId: 'sess-fold', light: true, lightSubs: new Set() }]
        ]) };
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        m = await call('home', Object.assign({}, admin, { sessionId: 'sess-fold', light: true }), server);
        assert.deepStrictEqual(m.data, { ok: true });
        assert.deepStrictEqual(devices().map((x) => [x.device, x.name, x.place, x.via]), [[FOLD, 'Galaxy Fold', 'home', 'task']], 'the session mate of the light socket');
        // a page before its hello: no `as`, not light: the mate again, via page
        m = await call('work', Object.assign({}, admin, { sessionId: 'sess-other' }), server);
        assert.deepStrictEqual(devices().map((x) => [x.device, x.place, x.via]).sort(), [[A53, 'work', 'page'], [FOLD, 'home', 'task']].sort());
        // no live mate (its socket is closed): a key from a hash of the session, never the session id
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        const logs = await quiet(() => h({ ws: {}, message: { type: 'traffic_place', requestId: 'p', place: 'home' }, clientInfo: Object.assign({}, admin, { sessionId: 'sess-closed', light: true }), wsServer: server }));
        out.pop();
        const key = `s:${require('crypto').createHash('sha1').update('sess-closed').digest('hex').slice(0, 12)}`;
        assert.deepStrictEqual(devices().map((x) => [x.device, x.name, x.place, x.via]), [[key, 'Phone', 'home', 'task']]);
        assert.ok(!JSON.stringify(phoneFile()).includes('sess-closed') && !logs.lines.join('\n').includes('sess-closed'), 'the session id is never stored or logged');
        // no ws server and no session at all: still one key, no throw
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        m = await call('work', admin);
        assert.deepStrictEqual(m.data, { ok: true });
        assert.strictEqual(devices().length, 1);
        assert.match(devices()[0].device, /^s:[0-9a-f]{12}$/);
        // a bad place: BAD_PLACE, nothing changes
        const before = JSON.stringify(devices());
        for (const bad of ['garage', undefined, 3]) {
            m = await call(bad, Object.assign({}, admin, { as: { kind: 'device', id: FOLD, name: 'Galaxy Fold' } }));
            assert.strictEqual(m.code, 'BAD_PLACE');
            assert.strictEqual(m.error, 'place must be home, work or null');
        }
        assert.strictEqual(JSON.stringify(devices()), before, 'a bad place changes nothing');
        // a test device (modules/testDevices.js, TEST_DEVICES_FILE): answered ok, kept in the test lane, the household's store untouched
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
        const lane = () => svc.phonePlaces(Date.now(), { lane: 'test' }).devices;
        m = await call('home', Object.assign({}, admin, { as: { kind: 'device', id: TEST_ID, name: 'Emulator', speaker: 'webview' } }));
        assert.deepStrictEqual(m.data, { ok: true }, 'a test device is answered ok');
        assert.deepStrictEqual(lane().map((x) => [x.device, x.name, x.place, x.via]), [[TEST_ID, 'Emulator', 'home', 'page']], 'kept in the test lane');
        assert.deepStrictEqual(devices(), [], 'the household store is untouched');
        m = await call('work', Object.assign({}, admin, { sessionId: 'sess-test', light: true }));
        assert.deepStrictEqual(m.data, { ok: true }, 'its light task socket (known by the session) too');
        assert.strictEqual(lane().length, 2);
        assert.ok(lane().some((x) => /^s:[0-9a-f]{12}$/.test(x.device) && x.place === 'work' && x.via === 'task'), 'no live mate in the ws server: a hashed key, in the test lane');
        assert.deepStrictEqual(devices(), [], 'the household store is still untouched');
        const server2 = { clients: new Map([[{ readyState: 1 }, { userType: 'admin', sessionId: 'sess-test', as: { kind: 'device', id: TEST_ID, name: 'Emulator', speaker: 'service' } }]]) };
        m = await call('work', Object.assign({}, admin, { sessionId: 'sess-test', light: true }), server2);
        assert.deepStrictEqual(lane().map((x) => [x.device, x.place, x.via]).filter((x) => x[0] === TEST_ID), [[TEST_ID, 'work', 'task']], 'the light task socket finds its device through the session mate');
        assert.deepStrictEqual(devices(), [], 'and the household store stays untouched');
        assert.ok(!fs.readFileSync(T.PHONE_FILE, 'utf8').includes('sess-test'), 'the session id is not in the file');
        assert.ok(Object.keys(phoneFile().test.devices).includes(TEST_ID));
        assert.deepStrictEqual(phoneFile().devices, {}, 'nothing in the household part of the file');
        m = await call('garage', Object.assign({}, admin, { as: { kind: 'device', id: TEST_ID, name: 'Emulator' } }));
        assert.strictEqual(m.code, 'BAD_PLACE', 'a bad place from a test device is refused too');
        // a test device's report cannot stand in for the household's phone
        m = await call('home', Object.assign({}, admin, { as: { kind: 'device', id: FOLD, name: 'Galaxy Fold' } }));
        assert.deepStrictEqual(devices().map((x) => x.device), [FOLD]);
        assert.ok(!lane().some((x) => x.device === FOLD), 'and a household phone is not in the test lane');
        T.resetPhone();
        fs.rmSync(T.PHONE_FILE, { force: true });
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
