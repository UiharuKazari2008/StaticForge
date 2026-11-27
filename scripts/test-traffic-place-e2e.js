#!/usr/bin/env node
/**
 * #1289 end to end, no page, no browser, no phone: the real CaféReady task (public/scripts/tasks, a bare VM context as in
 * test-cafe-drive-alerts.js) fed drive / fix events by a fake host; every ctx.request the task emits (traffic_get,
 * traffic_place, traffic_nearby) goes to the REAL server handler (modules/ws/handlers/292-trafficHandler.js through the
 * wsPacketRegistry, an admin clientInfo) and its reply goes back to the task. The handler lands in trafficService, whose
 * runScheduled('home' | 'work', 'scheduled') then runs with the real notificationInbox. Google, TomTom and Overpass are a
 * fake fetch; every state file is a temp path.
 *
 *   node scripts/test-traffic-place-e2e.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-place-e2e-'));
process.env.TRAFFIC_USAGE_FILE = path.join(tmp, 'usage.json');
process.env.TRAFFIC_PHONE_FILE = path.join(tmp, 'phone.json');
process.env.NOTIFICATION_INBOX_DB = ':memory:'; // never the live inbox
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.TRAFFIC_LATEST_FILE = path.join(tmp, 'latest.json');
process.env.TRAFFIC_CAMERA_FILE = path.join(tmp, 'cameras.json');
process.env.TRAFFIC_PLACES_FILE = path.join(tmp, 'places.json');
process.env.LOCATION_GEO_FILE = path.join(tmp, 'location-geo.json');
process.env.TEST_DEVICES_FILE = path.join(tmp, 'test-devices.json'); // never the live list of test devices

const svc = require('../modules/trafficService');
const T = svc._test;
const inboxMod = require('../modules/notificationInbox');
const registry = require('../modules/ws/wsPacketRegistry');

// ------------------------------------------------------------------ the server side: a fake gr, a fake fetch
// Home and Work ~8 km apart on lat 44.0; the default radius is 1.5 km
const HOME = { lat: 44.0, lon: -103.0 };
const WORK = { lat: 44.0, lon: -102.9 };
const cfg = { traffic: { home: { address: '100 Home Rd, Testville', ...HOME }, work: { address: '1 Work Plaza, Testville', ...WORK }, area: 'Testville, SD', streets: [], leaveHome: '07:45', leaveWork: '17:15', leadMin: 10, days: [1, 2, 3, 4, 5] } };
const keys = { googlemaps: [{ apiKey: 'g-key' }], tomtom: [{ apiKey: 't-key' }] };
const gr = {
    getConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o ? o[k] : undefined), cfg),
    modifyConfig: () => ({ assign: (pathArr, value) => { cfg[pathArr[0]] = value; return Promise.resolve(); } }),
    getApiKeyManager: () => ({ getServiceKeys: (s) => keys[s] || [], getSelectedIndex: () => 0 }),
    getWebSocketServer: () => ({ broadcast: () => {} })
};
svc.bind(gr);
inboxMod.bind(gr);

function encode(points) {
    let out = ''; let pl = 0; let pn = 0;
    const one = (v) => { let n = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; } return s + String.fromCharCode(n + 63); };
    points.forEach(([lat, lon]) => { const a = Math.round(lat * 1e5); const b = Math.round(lon * 1e5); out += one(a - pl) + one(b - pn); pl = a; pn = b; });
    return out;
}
const eastLine = Array.from({ length: 11 }, (_, i) => [44.0, -103.0 + i * 0.01]);
const route = { duration: '1500s', staticDuration: '900s', distanceMeters: 8000, description: 'I-90 E', polyline: { encodedPolyline: encode(eastLine) }, legs: [{ steps: [{ distanceMeters: 8000, navigationInstruction: { instructions: 'Head east on Main St' } }] }] };
const calls = [];
T.setFetch(async (url, init) => {
    calls.push({ url });
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (/routes\.googleapis/.test(url)) return json({ routes: [route] });
    if (/api\.tomtom\.com/.test(url)) return json({ incidents: [] });
    if (/overpass/.test(url)) return json({ elements: [] });
    throw new Error(`unexpected ${url}`);
});
const apiFetches = () => calls.filter((c) => /routes\.googleapis|api\.tomtom\.com/.test(c.url)).length;

// the real packet handlers, an admin client: what the app's CaféReady link is to the server
const out = [];
require('../modules/ws/handlers/292-trafficHandler').registerPackets({
    globalResources: gr,
    sendToClient: (ws, m) => out.push(m),
    sendError: (ws, msg, code, requestId) => out.push({ error: msg, code, requestId })
});

// ------------------------------------------------------------------ the phone side: the real task in a bare VM
const taskDir = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(taskDir, 'manifest.json'), 'utf8'));

class Phone {
    constructor() {
        const sandbox = {};
        sandbox.globalThis = sandbox;
        vm.createContext(sandbox);
        manifest.files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(taskDir, f), 'utf8'), sandbox, { filename: f }));
        this.g = sandbox;
        this.state = null;
        this.first = true;
        this.sentPlaces = []; // every traffic_place the task asked for, in order
        this.requests = []; // every request type
        this.seq = 0;
    }

    // one host event into the task; its requests go to the server handler and the replies come straight back
    async send(type, data) {
        const res = JSON.parse(this.g.CafeTasks.dispatch('drive-alerts', type, JSON.stringify(data || {}), this.first && this.state ? JSON.stringify(this.state) : null));
        this.first = false;
        if (res.error) throw new Error(res.error);
        if (res.patch) this.state = Object.assign(this.state || {}, res.patch);
        (res.drop || []).forEach((k) => { delete this.state[k]; });
        for (const a of res.actions) {
            if (a.op !== 'request') continue;
            this.requests.push(a.type);
            if (a.type === 'traffic_place') this.sentPlaces.push(a.data.place);
            const handler = registry.getWsPacketHandler(a.type);
            assert.ok(handler, `the server registers ${a.type}`);
            out.length = 0;
            const requestId = `r${++this.seq}`;
            await handler({ ws: {}, message: Object.assign({ type: a.type, requestId }, a.data), clientInfo: { userType: 'admin', authenticated: true } });
            const m = out.find((x) => x.requestId === requestId);
            assert.ok(m, `the server answered ${a.type}`);
            await this.send('reply', m.error ? { tag: a.tag, type: a.type, ok: false, error: m.error } : { tag: a.tag, type: a.type, ok: true, data: m.data });
        }
        return res.actions;
    }

    async start() {
        await this.send('start', { host: { api: 1, ops: ['approach'] } });
    }

    drive(state) { return this.send('drive', { state, since: Date.now() }); }
    fix(p) { return this.send('fix', Object.assign({ accuracyM: 10, speed: 20, heading: 90 }, p)); }
}

// ------------------------------------------------------------------ the scheduled run, the evidence
const published = [];
const realPublish = inboxMod.publish;
inboxMod.publish = (n) => { published.push(n.id); return realPublish(n); };
const noticeId = (direction) => `traffic:scheduled:${direction}:${T.localNow(svc.getSettings()).date}`;

async function scheduled(direction) {
    // a fresh day's budget and no cached route, so an API fetch is counted when (and only when) a check really runs
    fs.rmSync(process.env.TRAFFIC_USAGE_FILE, { force: true });
    T.resetUsage();
    T.routeCache.clear();
    calls.length = 0;
    published.length = 0;
    await T.runScheduled(direction, 'scheduled');
    const id = noticeId(direction);
    return { id, published: published.includes(id), inbox: !!inboxMod.get('admin', id), fetches: apiFetches() };
}

function line(label, phone, run) {
    console.log(`${label} | task sent traffic_place ${JSON.stringify(phone.sentPlaces)} | server phonePlaceNow=${JSON.stringify(svc.phonePlaceNow())} | ${run.id} published=${run.published} inbox=${run.inbox} | api fetches=${run.fetches}`);
}

const ROAD = { lat: 44.0, lon: -102.95 }; // 4 km from both, outside both radii
const AT_HOME = { lat: 44.001, lon: -103.0 }; // ~110 m from Home
const AT_WORK = { lat: 44.001, lon: -102.9 };

function fresh() {
    // a clean slate: no phone has said anything (a phone's place is kept per phone since #1289, so "null" is no longer a clear)
    T.resetPhone();
    fs.rmSync(process.env.TRAFFIC_PHONE_FILE, { force: true });
    T.sched.go.clear();
}

(async () => {
    try {
        // sanity: the same-day notice id the server uses, and the radius the task will be given
        assert.strictEqual(svc.getSettings().radiusKm, 1.5);
        let r;

        // A. the phone at Home: the task's own fix inside the Home radius
        fresh();
        let phone = new Phone();
        await phone.start();
        await phone.drive('driving');
        assert.deepStrictEqual(phone.sentPlaces, [null], 'the drive start tells the server it is on the road');
        assert.ok(phone.requests.includes('traffic_get'), 'the task asked the server for its settings');
        assert.ok(phone.state.places && phone.state.places.home && phone.state.places.radiusM === 1500, 'the task got Home / Work / radius from the real traffic_get reply');
        await phone.fix(AT_HOME);
        assert.deepStrictEqual(phone.sentPlaces, [null, 'home'], 'a fix inside the Home radius sends home');
        await phone.fix({ lat: 44.0011, lon: -103.0 });
        assert.deepStrictEqual(phone.sentPlaces, [null, 'home'], 'once per change');
        assert.strictEqual(svc.phonePlaceNow(), 'home', 'the real handler stored it');
        r = await scheduled('home');
        line('A  phone at Home, Leave Work time -> To Home   ', phone, r);
        assert.deepStrictEqual([r.published, r.inbox, r.fetches], [false, false, 0], 'A: no notice, 0 fetches');
        const phoneFileA = fs.readFileSync(process.env.TRAFFIC_PHONE_FILE, 'utf8');

        // D. restart-proof: the server module state is gone, the file stays
        T.resetPhone();
        assert.strictEqual(fs.readFileSync(process.env.TRAFFIC_PHONE_FILE, 'utf8'), phoneFileA, 'the file is kept');
        assert.strictEqual(svc.phonePlaceNow(), 'home', 'read back from the file after the reset');
        r = await scheduled('home');
        line('D  after a server restart (state reset, file kept)', phone, r);
        assert.deepStrictEqual([r.published, r.inbox, r.fetches], [false, false, 0], 'D: still skipped');

        // B. away from Home: the drive starts at Home (null), the fix is on the road
        fresh();
        phone = new Phone();
        await phone.start();
        await phone.drive('driving');
        await phone.fix(ROAD);
        assert.deepStrictEqual(phone.sentPlaces, [null], 'on the road nothing but the start null is sent');
        assert.strictEqual(svc.phonePlaceNow(), null);
        r = await scheduled('home');
        line('B  phone on the road, Leave Work time -> To Home', phone, r);
        assert.ok(r.published && r.inbox && r.fetches > 0, 'B: notice published, API fetched');

        // C. at Work: To Work is skipped; after the drive starts it is published
        fresh();
        phone = new Phone();
        await phone.start();
        await phone.drive('driving');
        await phone.fix(AT_WORK);
        assert.deepStrictEqual(phone.sentPlaces, [null, 'work']);
        assert.strictEqual(svc.phonePlaceNow(), 'work');
        r = await scheduled('work');
        line('C1 phone at Work, Leave Home time -> To Work    ', phone, r);
        assert.deepStrictEqual([r.published, r.inbox, r.fetches], [false, false, 0], 'C1: no notice at Work');
        await phone.drive('parked_in_car');
        await phone.drive('driving'); // a new drive: the task sends null again (it knew work)
        assert.deepStrictEqual(phone.sentPlaces, [null, 'work', null], 'the next drive start sends null');
        assert.strictEqual(svc.phonePlaceNow(), null);
        r = await scheduled('work');
        line('C2 drive started (null), To Work again          ', phone, r);
        assert.ok(r.published && r.inbox && r.fetches > 0, 'C2: published after the drive starts');

        console.log('test-traffic-place-e2e: ok');
    } catch (e) {
        console.error(`test-traffic-place-e2e: FAIL\n${e.stack}`);
        process.exitCode = 1;
    } finally {
        inboxMod.publish = realPublish;
        fs.rmSync(tmp, { recursive: true, force: true });
        process.exit(process.exitCode || 0);
    }
})();
