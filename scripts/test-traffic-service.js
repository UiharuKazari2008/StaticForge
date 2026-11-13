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
process.env.TRAFFIC_LATEST_FILE = path.join(tmp, 'latest.json');
process.env.TRAFFIC_CAMERA_FILE = path.join(tmp, 'cameras.json');
process.env.TRAFFIC_PLACES_FILE = path.join(tmp, 'places.json');

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
const keys = { googlemaps: [{ apiKey: 'g-key' }], tomtom: [{ apiKey: 't-key' }] };
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
            { type: 'node', id: 13, lat: 44.0, lon: -102.92, tags: {} }
        ] });
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
        assert.strictEqual(r.level, 'heavy');
        assert.strictEqual(r.delaySec, 600);
        assert.ok(/2 speed cameras on route/.test(r.summary), r.summary);
        assert.ok(/Faster: via Omaha St \(6 mi\) saves 8 min/.test(r.summary), r.summary);
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
