#!/usr/bin/env node
/**
 * #1289 acceptance, the page closed: the phone's CaféReady task (public/scripts/tasks, a bare VM context as in
 * test-cafe-drive-alerts.js) tells the REAL server modules where the phone is, and the Leave Work / Leave Home minute
 * then passes on the real clock (trafficService tick -> runScheduled -> notificationInbox -> activeSync.sendInboxNotice).
 * No page client exists: the fake ws server holds the primary phone's background link and its task socket only (a
 * check before every pass says so). Google, TomTom and Overpass are a fake fetch; every state file is a temp path.
 *
 *   - the task's ctx.request actions go to the real registered handlers (wsPacketRegistry) with the task socket's
 *     clientInfo (light, no `as`: the phone is found by the session it shares with the background link), and each
 *     answer goes back into the task as the event `reply { tag, type, ok, data, error }`
 *   - the phone's background link is a socket of the fake server; the real sendInboxNotice hands the notice to it as an
 *     as_event 'inbox.notice' (nothing is wrapped: the link's inbox is read)
 *
 *   node scripts/test-traffic-place-acceptance.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-place-acceptance-'));
process.env.TRAFFIC_USAGE_FILE = path.join(tmp, 'usage.json');
process.env.TRAFFIC_PHONE_FILE = path.join(tmp, 'phone.json');
process.env.NOTIFICATION_INBOX_DB = ':memory:'; // never the live inbox
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
process.env.TRAFFIC_LATEST_FILE = path.join(tmp, 'latest.json');
process.env.TRAFFIC_CAMERA_FILE = path.join(tmp, 'cameras.json');
process.env.TRAFFIC_PLACES_FILE = path.join(tmp, 'places.json');
process.env.LOCATION_GEO_FILE = path.join(tmp, 'location-geo.json');
const FOLD = 'f'.repeat(32); // the primary phone, "Galaxy Fold"
const A53 = 'a'.repeat(32); // the desk phone, "A53 Test"
const EMU = 'ab'.repeat(16); // a test device (the emulator)
process.env.TEST_DEVICES_FILE = path.join(tmp, 'test-devices.json');
fs.writeFileSync(process.env.TEST_DEVICES_FILE, JSON.stringify({ devices: { [EMU]: { name: 'Emulator', markedAt: 1 } }, sessions: { 'sess-emu': EMU } }));

const svc = require('../modules/trafficService');
const T = svc._test;
const inbox = require('../modules/notificationInbox');
const registry = require('../modules/ws/wsPacketRegistry');

// ------------------------------------------------------------------ the server side: the fake ws server, gr, fetch
const broadcasts = [];
const server = {
    clients: new Map(),
    broadcast: (msg) => { broadcasts.push(msg); },
    sendToClient: (ws, msg) => { ws.got.push(msg); return true; }
};
const sock = (label, info) => {
    const ws = { label, readyState: 1, got: [] };
    server.clients.set(ws, info);
    return ws;
};
// "Galaxy Fold": its background link (the real sendInboxNotice reads speaker 'service' and session 'partner') and its
// task socket (the app's CaféReady task host: a light sub-socket with no `as` of its own, the same session)
const SINCE = Date.now() - 60000;
const foldService = sock('fold-service', { authenticated: true, userType: 'admin', sessionId: 'sess-fold', as: { kind: 'device', id: FOLD, name: 'Galaxy Fold', speaker: 'service', session: 'partner', since: SINCE } });
const foldTaskInfo = { authenticated: true, userType: 'admin', sessionId: 'sess-fold', light: true, lightSubs: new Set() };
const foldTask = sock('fold-task', foldTaskInfo);
// the desk phone has a page socket of its own only (no background link: nothing of the household's is sent to it)
const a53Info = { authenticated: true, userType: 'admin', sessionId: 'sess-a53', as: { kind: 'device', id: A53, name: 'A53 Test', speaker: 'webview', session: 'partner', since: SINCE } };
const a53Page = sock('a53-page', a53Info);
// a test device (modules/testDevices.js) with a page socket
const emuInfo = { authenticated: true, userType: 'admin', sessionId: 'sess-emu', as: { kind: 'device', id: EMU, name: 'Emulator', speaker: 'webview', session: 'partner', since: SINCE } };
const emuPage = sock('emu-page', emuInfo);

const cfg = { traffic: { area: 'Testville, SD', streets: [] } };
const keys = { googlemaps: [{ apiKey: 'g-key' }], tomtom: [{ apiKey: 't-key' }] };
const gr = {
    getConfig: ({ path: p }) => p.split('.').reduce((o, k) => (o ? o[k] : undefined), cfg),
    modifyConfig: () => ({ assign: (pathArr, value) => { cfg[pathArr[0]] = value; return Promise.resolve(); } }),
    getApiKeyManager: () => ({ getServiceKeys: (s) => keys[s] || [], getSelectedIndex: () => 0 }),
    getWebSocketServer: () => server
};
svc.bind(gr);
inbox.bind(gr);
T.setPrimaryLookup(() => FOLD);

function encode(points) {
    let out = ''; let pl = 0; let pn = 0;
    const one = (v) => { let n = v < 0 ? ~(v << 1) : v << 1; let s = ''; while (n >= 0x20) { s += String.fromCharCode((0x20 | (n & 0x1f)) + 63); n >>= 5; } return s + String.fromCharCode(n + 63); };
    points.forEach(([lat, lon]) => { const a = Math.round(lat * 1e5); const b = Math.round(lon * 1e5); out += one(a - pl) + one(b - pn); pl = a; pn = b; });
    return out;
}
// Home and Work ~22 km apart (the server drops a place at exactly 0,0, so the pair sits at 10 degrees north / east)
const HOME = { lat: 10.0, lon: 10.0 };
const WORK = { lat: 10.2, lon: 10.0 };
const northLine = Array.from({ length: 11 }, (_, i) => [HOME.lat + i * 0.02, HOME.lon]);
const route = { duration: '1500s', staticDuration: '900s', distanceMeters: 22000, description: 'I-90 N', polyline: { encodedPolyline: encode(northLine) }, legs: [{ steps: [{ distanceMeters: 22000, navigationInstruction: { instructions: 'Head north on Main St' } }] }] };
const calls = [];
T.setFetch(async (url) => {
    calls.push({ url });
    const json = (o) => ({ ok: true, status: 200, text: async () => JSON.stringify(o) });
    if (/routes\.googleapis/.test(url)) return json({ routes: [route] });
    if (/api\.tomtom\.com/.test(url)) return json({ incidents: [] });
    if (/overpass/.test(url)) return json({ elements: [] });
    throw new Error(`unexpected ${url}`);
});
const googleFetches = () => calls.filter((c) => /routes\.googleapis/.test(c.url)).length;

// the real packet handlers: what the app's link talks to
const answers = [];
const handlersCtx = {
    globalResources: gr,
    sendToClient: (ws, m) => answers.push(m),
    sendError: (ws, msg, code, requestId) => answers.push({ error: msg, code, requestId })
};
require('../modules/ws/handlers/292-trafficHandler').registerPackets(handlersCtx);
if (T.sched.timer) clearInterval(T.sched.timer); // the 30 s scheduler stays out of the way: the test calls tick itself

// ------------------------------------------------------------------ the phone side: the real task in a bare VM
const taskDir = path.join(__dirname, '..', 'public', 'scripts', 'tasks');
const manifest = JSON.parse(fs.readFileSync(path.join(taskDir, 'manifest.json'), 'utf8'));
let seq = 0;

/** One packet to the real registered handler as `ws` / `info` and its answer ({ data } or { error, code }). */
async function deliver(type, data, ws, info) {
    const handler = registry.getWsPacketHandler(type);
    assert.ok(handler, `the server registers ${type}`);
    const requestId = `r${++seq}`;
    answers.length = 0;
    const realLog = console.log;
    console.log = () => {}; // the module's own "[traffic] ..." lines are not the evidence here
    try {
        await handler({ ws, message: Object.assign({ type, requestId }, data), clientInfo: info, wsServer: server });
    } finally {
        console.log = realLog;
    }
    const m = answers.find((x) => x.requestId === requestId);
    assert.ok(m, `the server answered ${type}`);
    return m;
}

/** The phone's task host, like DSApp's: events in, actions out; every request goes to the server and its answer comes back as a reply event. */
class Phone {
    constructor() {
        const sandbox = {};
        sandbox.globalThis = sandbox;
        vm.createContext(sandbox);
        manifest.files.forEach((f) => vm.runInContext(fs.readFileSync(path.join(taskDir, f), 'utf8'), sandbox, { filename: f }));
        this.g = sandbox;
        this.state = null;
        this.first = true;
        this.requests = []; // [type, place?] of every request the task made
    }

    async send(type, data) {
        const res = JSON.parse(this.g.CafeTasks.dispatch('drive-alerts', type, JSON.stringify(data || {}), this.first && this.state ? JSON.stringify(this.state) : null));
        this.first = false;
        if (res.error) throw new Error(res.error);
        if (res.patch) this.state = Object.assign(this.state || {}, res.patch);
        (res.drop || []).forEach((k) => { delete this.state[k]; });
        for (const a of res.actions || []) {
            if (a.op !== 'request') continue;
            this.requests.push(a.type === 'traffic_place' ? `${a.type}:${a.data.place === null ? 'away' : a.data.place}` : a.type);
            const m = await deliver(a.type, a.data, foldTask, foldTaskInfo);
            // the tag goes back as it came: nothing here depends on its text
            await this.send('reply', m.error ? { tag: a.tag, type: a.type, ok: false, error: m.error } : { tag: a.tag, type: a.type, ok: true, data: m.data });
        }
        return res.actions;
    }

    start() { return this.send('start', { host: { api: 1, ops: ['approach'] } }); }
    drive(state) { return this.send('drive', { state, since: Date.now() }); }
    fix(p) { return this.send('fix', Object.assign({ accuracyM: 10, speed: 20, heading: 0 }, p)); }
}

// ------------------------------------------------------------------ the world, the leave-time passes, the evidence
const pad = (n) => String(n).padStart(2, '0');
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The page-closed guarantee: no client of the Fold exists that is neither its background link nor a light task socket. */
function assertNoFoldPage(where) {
    const pages = [...server.clients.values()].filter((i) => ((i.as && i.as.id === FOLD) || i.sessionId === 'sess-fold') && !i.light && !(i.as && i.as.speaker === 'service'));
    assert.strictEqual(pages.length, 0, `${where}: a page socket of the Fold exists`);
    const fold = [...server.clients.entries()].filter(([, i]) => (i.as && i.as.id === FOLD) || i.sessionId === 'sess-fold').map(([w]) => w.label).sort();
    assert.deepStrictEqual(fold, ['fold-service', 'fold-task'], `${where}: the Fold has its background link and its task socket only`);
}

const ROAD = { lat: 10.1, lon: 10.0 }; // 11 km from both places
const AT_HOME = { lat: 10.002, lon: 10.0 }; // 220 m from Home
const AT_WORK = { lat: 10.198, lon: 10.0 };
const ISO = (t) => new Date(t).toISOString();

function holds() {
    const list = svc.phonePlaces().devices;
    return list.length ? list.map((d) => `${d.name || d.device} ${d.place || 'away'} via ${d.via || '-'} at ${ISO(d.at)}${d.decides ? ' [decides]' : ''}`).join('; ') : 'nothing';
}

/** A clean slate between cases: no inbox row, no fired minute, no go, no reports, no counted calls. */
async function reset(keepPhones = false) {
    inbox._test.reset(); // the :memory: inbox starts empty again (tick does not run a direction whose notice of the day exists)
    T.sched.fired.clear();
    T.sched.go.clear();
    if (!keepPhones) { T.resetPhone(); fs.rmSync(process.env.TRAFFIC_PHONE_FILE, { force: true }); }
    fs.rmSync(process.env.TRAFFIC_USAGE_FILE, { force: true });
    T.resetUsage();
    T.routeCache.clear();
    [foldService, foldTask, a53Page, emuPage].forEach((w) => { w.got.length = 0; });
    calls.length = 0;
    broadcasts.length = 0;
}

/**
 * The leave time of `direction` passes: its leave time (Leave Work for 'home', Leave Home for 'work') is the current
 * local minute plus the lead, the other one 6 hours away, the fired set is cleared and the real tick runs on the real clock.
 * Returns what happened: { notice: inbox row | null, phone: titles handed to the phone's background link, google, reports }.
 */
async function pass(direction) {
    assertNoFoldPage(`before the ${direction} pass`);
    const s0 = svc.getSettings();
    const due = (T.localNow(s0).minutes + s0.leadMin) % 1440;
    const far = (due + 360) % 1440;
    await svc.saveSettings(direction === 'home' ? { leaveWork: hhmm(due), leaveHome: hhmm(far) } : { leaveHome: hhmm(due), leaveWork: hhmm(far) });
    T.sched.fired.clear();
    calls.length = 0;
    broadcasts.length = 0;
    foldService.got.length = 0;
    const id = `traffic:scheduled:${direction}:${T.localNow(svc.getSettings()).date}`;
    const realLog = console.log;
    const lines = [];
    console.log = (...a) => lines.push(a.join(' '));
    try {
        T.tick();
        await sleep(300); // the fake fetch answers at once
    } finally {
        console.log = realLog;
    }
    assertNoFoldPage(`after the ${direction} pass`);
    const notice = inbox.get('admin', id);
    const phone = foldService.got.filter((m) => m.type === 'as_event' && m.data.event === 'inbox.notice' && m.data.detail.id === id).map((m) => m.data.detail.title);
    return {
        notice, phone, google: googleFetches(),
        reports: broadcasts.filter((m) => m.type === 'traffic_report').length,
        skipped: lines.find((l) => /skipped/.test(l)) || ''
    };
}

const describe = (r) => (r.notice ? `inbox row "${r.notice.title}"` : 'no inbox row') + `, phone link got ${r.phone.length ? JSON.stringify(r.phone) : 'nothing'}, ${r.google} Google call(s), ${r.reports} traffic_report broadcast(s)`;
const expectNothing = (r, why) => {
    assert.strictEqual(r.notice, null, `${why}: no inbox row`);
    assert.deepStrictEqual(r.phone, [], `${why}: nothing to the phone`);
    assert.strictEqual(r.google, 0, `${why}: 0 Google calls`);
    assert.strictEqual(r.reports, 0, `${why}: no traffic_report broadcast`);
    assert.ok(/skipped/.test(r.skipped), `${why}: the service said it skipped (${r.skipped})`);
};
const expectNotice = (r, title, why) => {
    assert.ok(r.notice, `${why}: the inbox row exists`);
    assert.ok(r.notice.title.startsWith(title), `${why}: the title starts "${title}" (${r.notice.title})`);
    assert.strictEqual(r.phone.length, 1, `${why}: the phone's link got it once`);
    assert.ok(r.phone[0].startsWith(title), `${why}: what the link got starts "${title}"`);
    assert.ok(r.google > 0, `${why}: the route was read`);
    assert.strictEqual(r.reports, 1, `${why}: one traffic_report broadcast`);
};
const foldEntry = () => svc.phonePlaces().devices.find((d) => d.device === FOLD);

// ------------------------------------------------------------------ the cases
let passed = 0;
let failed = 0;
async function kase(label, fn) {
    try {
        await reset();
        assertNoFoldPage(`${label} start`);
        const text = await fn();
        passed += 1;
        console.log(`PASS ${label} | ${text}`);
    } catch (e) {
        failed += 1;
        console.log(`FAIL ${label}\n${e.stack}`);
    }
}

/** The task drives the phone: start, a drive, the fixes, the drive ends. */
async function drive(fixes, { stop = true } = {}) {
    const phone = new Phone();
    await phone.start();
    await phone.drive('driving');
    for (const f of fixes) await phone.fix(f);
    if (stop) await phone.drive('stopped');
    assert.ok(phone.requests.includes('traffic_get'), 'the task asked the real handler for Home and Work');
    assert.ok(phone.state.places && phone.state.places.home && phone.state.places.work && phone.state.places.radiusM === 1000, 'Home, Work and the radius came from the real traffic_get reply');
    return phone;
}

(async () => {
    try {
        await svc.saveSettings({ home: { address: '1 Home Rd', ...HOME }, work: { address: '1 Work Plaza', ...WORK }, radiusKm: 1, notify: true, days: [0, 1, 2, 3, 4, 5, 6], leadMin: 10 });
        const s = svc.getSettings();
        assert.ok(s.home && s.home.lat === HOME.lat && s.work && s.work.lat === WORK.lat && s.radiusKm === 1 && s.leadMin === 10, 'the settings took Home, Work, the radius and the lead');
        assert.strictEqual(svc.phonePlaces().primary, FOLD, 'the Fold is the primary phone');

        await kase('A1 To Home, the phone drove home      ', async () => {
            const phone = await drive([ROAD, AT_HOME]);
            const e = foldEntry();
            assert.deepStrictEqual([e.place, e.via, e.name], ['home', 'task', 'Galaxy Fold'], 'the server holds Home, told by the task');
            const before = holds();
            const r = await pass('home');
            expectNothing(r, 'A1');
            return `server holds [${before}]; task sent ${JSON.stringify(phone.requests.filter((x) => x.startsWith('traffic_place')))}; Leave Work minute passed: ${describe(r)}`;
        });

        await kase('A2 To Home, the stay-home day (23 h) ', async () => {
            await drive([ROAD, AT_HOME]);
            assert.strictEqual(svc.setPhonePlace('home', { device: FOLD, name: 'Galaxy Fold', via: 'task', at: Date.now() - 23 * 3600 * 1000 }), true);
            const e = foldEntry();
            assert.ok(Date.now() - e.at > 22.9 * 3600 * 1000 && e.place === 'home' && e.via === 'task', 'the report is 23 hours old');
            const before = holds();
            const r = await pass('home');
            expectNothing(r, 'A2');
            return `server holds [${before}]; Leave Work minute passed: ${describe(r)}`;
        });

        await kase('A3 To Home, the phone is away         ', async () => {
            await drive([ROAD], { stop: false }); // a new drive starts; a fix lies outside both places
            const e = foldEntry();
            assert.deepStrictEqual([e.place, e.via], [null, 'task'], 'the server holds away, told by the task');
            const before = holds();
            const r = await pass('home');
            expectNotice(r, 'To Home', 'A3');
            return `server holds [${before}]; Leave Work minute passed: ${describe(r)}`;
        });

        await kase('A4 To Home, the phone is at Work      ', async () => {
            await drive([AT_WORK]);
            assert.strictEqual(foldEntry().place, 'work');
            const before = holds();
            const r = await pass('home');
            expectNotice(r, 'To Home', 'A4');
            return `server holds [${before}]; Leave Work minute passed: ${describe(r)}`;
        });

        await kase('B1 To Work, the phone is at Work      ', async () => {
            await drive([ROAD, AT_WORK]);
            assert.strictEqual(foldEntry().place, 'work');
            const before = holds();
            const r = await pass('work');
            expectNothing(r, 'B1');
            return `server holds [${before}]; Leave Home minute passed: ${describe(r)}`;
        });

        await kase('B2 To Work, the phone is at Home      ', async () => {
            await drive([ROAD, AT_HOME]);
            assert.strictEqual(foldEntry().place, 'home');
            const before = holds();
            const r = await pass('work');
            expectNotice(r, 'To Work', 'B2');
            return `server holds [${before}]; Leave Home minute passed: ${describe(r)}`;
        });

        await kase('B3 To Work, the phone is away         ', async () => {
            await drive([ROAD], { stop: false });
            assert.strictEqual(foldEntry().place, null);
            const before = holds();
            const r = await pass('work');
            expectNotice(r, 'To Work', 'B3');
            return `server holds [${before}]; Leave Home minute passed: ${describe(r)}`;
        });

        await kase('C1 the desk phone reports Home        ', async () => {
            await drive([ROAD, AT_WORK]); // the primary is at Work
            const m = await deliver('traffic_place', { place: 'home' }, a53Page, a53Info); // the A53 reports through its own page socket
            assert.deepStrictEqual(m.data, { ok: true });
            const places = svc.phonePlaces();
            const fold = places.devices.find((d) => d.device === FOLD);
            const desk = places.devices.find((d) => d.device === A53);
            assert.deepStrictEqual([fold.place, fold.via, fold.decides], ['work', 'task', true], 'the Fold (primary) holds Work');
            assert.deepStrictEqual([desk.name, desk.place, desk.via, desk.decides], ['A53 Test', 'home', 'page', false], 'the desk phone holds Home and decides nothing');
            const before = holds();
            const home = await pass('home');
            expectNotice(home, 'To Home', 'C1 To Home');
            await reset(true);
            const work = await pass('work');
            expectNothing(work, 'C1 To Work');
            return `server holds [${before}]; Leave Work minute: ${describe(home)}; then Leave Home minute: ${describe(work)}`;
        });

        await kase('C2 a test device reports Home         ', async () => {
            await drive([ROAD, AT_WORK]); // the primary is at Work
            const lane = { lane: 'test' };
            const before = JSON.stringify(svc.phonePlaces());
            for (const place of ['home', null, 'home']) {
                const m = await deliver('traffic_place', { place }, emuPage, emuInfo);
                assert.deepStrictEqual(m.data, { ok: true }, 'a test device is answered ok');
            }
            // its task socket (light, known only by the session it shares with its link) too
            const m2 = await deliver('traffic_place', { place: 'home' }, foldTask, { authenticated: true, userType: 'admin', sessionId: 'sess-emu', light: true, lightSubs: new Set() });
            assert.deepStrictEqual(m2.data, { ok: true });
            // it lands in the test lane ...
            const testLane = svc.phonePlaces(Date.now(), lane);
            assert.deepStrictEqual(testLane.devices.map((d) => [d.device, d.name, d.place, d.via]), [[EMU, 'Emulator', 'home', 'task']], 'the test lane holds the emulator at Home');
            assert.strictEqual(svc.phoneDecision('home', Date.now(), lane).skip, true, 'a test-lane run would skip To Home');
            // ... and changes nothing for the household
            assert.strictEqual(JSON.stringify(svc.phonePlaces()), before, 'the household store is unchanged');
            assert.ok(!svc.phonePlaces().devices.some((d) => d.device === EMU || /^s:/.test(d.device)), 'nothing of the test device is in the household store');
            const r = await pass('home');
            expectNotice(r, 'To Home', 'C2');
            return `server holds [${holds()}]; test lane holds [${testLane.devices.map((d) => `${d.name} ${d.place || 'away'} via ${d.via}`).join('; ')}]; Leave Work minute passed: ${describe(r)}`;
        });

        await kase('C3 the primary has reported nothing   ', async () => {
            // the desk phone has said Home, the primary nothing: the other phone never decides while a primary is set
            const m = await deliver('traffic_place', { place: 'home' }, a53Page, a53Info);
            assert.deepStrictEqual(m.data, { ok: true });
            assert.strictEqual(foldEntry(), undefined, 'the Fold has not reported');
            assert.strictEqual(svc.phoneDecision('home').why, 'the primary phone has not said where it is');
            const before = holds();
            const r = await pass('home');
            expectNotice(r, 'To Home', 'C3');
            return `server holds [${before}]; Leave Work minute passed: ${describe(r)}`;
        });
    } catch (e) {
        failed += 1;
        console.log(`FAIL setup\n${e.stack}`);
    }
    console.log(`test-traffic-place-acceptance: ${passed} passed, ${failed} failed`);
    fs.rmSync(tmp, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
})();
