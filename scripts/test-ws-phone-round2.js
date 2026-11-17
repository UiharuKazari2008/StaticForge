#!/usr/bin/env node
/**
 * The socket server's phone rules from #890 rounds 2 and 3, without a live server:
 *  - heartbeat: quiet windows, the 35 s keep-alive towards the client (sentAt), probes after a
 *    reconnect, the long window for native links and sleeping pages (DeX windows included)
 *  - socketWantsBroadcast: desktop-only types skip phone pages, phone-only types skip desktop pages
 *    (a DeX window is a desktop page), light sockets get only what they subscribed to, the app's
 *    background link no broadcast
 *  - dormant holds: a sleeping phone page or DeX window is held for (broadcast and sendToUser), its
 *    Continuity carrier's copy leaves it out, and waking sends what was held, over the carrier too
 *  - ActiveSync: a phone's own report does not come back to it as the whole peer list (ownPeersKey);
 *    as_credits goes to the background links once after hello and again only on a change
 *   node scripts/test-ws-phone-round2.js
 */
'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const hb = require('../modules/wsSocketHeartbeat');
const { WebSocketServer, _test: wst } = require('../modules/websocket');
const vs = require('../modules/ws/virtualSocket');

// ---------------------------------------------------------------- heartbeat
{
    const t0 = 1_000_000;
    const e = hb.createSocketHeartbeatEntry(t0);
    const opts = (now) => ({ windowMs: hb.QUIET_WINDOW_LONG_MS, keepaliveMs: hb.KEEPALIVE_MS, now });
    // heard and sent to within the windows: no ping
    e.sentAt = t0;
    assert.strictEqual(hb.tickSocketHeartbeat(e, 2, opts(t0 + 20000)), 'skip');
    // heard lately but nothing sent towards it for 35 s: the keep-alive ping (the proxy's ~60 s idle cut)
    hb.noteSocketHeard(e, t0 + 30000);
    assert.strictEqual(hb.tickSocketHeartbeat(e, 2, opts(t0 + hb.KEEPALIVE_MS + 1)), 'ping', 'keep-alive');
    // the pong comes, the ping went out (sentAt): quiet again
    hb.noteSocketHeard(e, t0 + 36000);
    e.sentAt = t0 + 36000;
    assert.strictEqual(hb.tickSocketHeartbeat(e, 2, opts(t0 + 50000)), 'skip');
    // without a keep-alive (the old rule) only the window counts
    const e2 = hb.createSocketHeartbeatEntry(t0);
    e2.sentAt = t0 - 3600000;
    assert.strictEqual(hb.tickSocketHeartbeat(e2, 2, { windowMs: hb.QUIET_WINDOW_MS, now: t0 + 10000 }), 'skip');
    // silent a whole window: ping, then two misses end it
    const e3 = hb.createSocketHeartbeatEntry(t0);
    assert.strictEqual(hb.tickSocketHeartbeat(e3, 2, { windowMs: hb.QUIET_WINDOW_MS, now: t0 + hb.QUIET_WINDOW_MS + 1 }), 'ping');
    assert.strictEqual(hb.tickSocketHeartbeat(e3, 2, { windowMs: hb.QUIET_WINDOW_MS, now: t0 + hb.QUIET_WINDOW_MS + 15001 }), 'ping');
    assert.strictEqual(hb.tickSocketHeartbeat(e3, 2, { windowMs: hb.QUIET_WINDOW_MS, now: t0 + hb.QUIET_WINDOW_MS + 30001 }), 'terminate');

    // a probe (a reconnect elsewhere): pinged now, given a grace, then the missed-pong rule
    const pinged = [];
    const link = { readyState: 1, ping() { pinged.push(1); } };
    const pe = hb.createSocketHeartbeatEntry(t0);
    link._dsHeartbeat = pe;
    assert.strictEqual(hb.probeSocketLink(link, null, null, t0 + 1000), true);
    assert.strictEqual(pinged.length, 1);
    assert.strictEqual(hb.socketLinkUnanswered(link, null, null), true, 'unanswered until a frame comes');
    assert.strictEqual(hb.probeSocketLink(link, null, null, t0 + 1100), false, 'already waiting on one');
    assert.strictEqual(hb.tickSocketHeartbeat(pe, 2, { windowMs: hb.QUIET_WINDOW_LONG_MS, keepaliveMs: hb.KEEPALIVE_MS, now: t0 + 5000 }), 'skip', 'within the grace');
    hb.noteSocketHeard(pe, t0 + 6000);
    assert.strictEqual(hb.socketLinkUnanswered(link, null, null), false);

    // quiet windows
    assert.strictEqual(hb.quietWindowFor({ virtual: true }, {}), Infinity, 'a sub-client lives on its carrier');
    assert.strictEqual(hb.quietWindowFor({ _dsMiniport: true }, null), hb.QUIET_WINDOW_LONG_MS);
    assert.strictEqual(hb.quietWindowFor({}, { as: { speaker: 'service' } }), hb.QUIET_WINDOW_LONG_MS);
    assert.strictEqual(hb.quietWindowFor({}, { dormant: true, phone: { shell: 'mobile' } }), hb.QUIET_WINDOW_LONG_MS);
    assert.strictEqual(hb.quietWindowFor({}, { dormant: true, dexWindow: true }), hb.QUIET_WINDOW_LONG_MS, 'a sleeping DeX window (own socket)');
    assert.strictEqual(hb.quietWindowFor({}, { dormant: true }), hb.QUIET_WINDOW_MS, 'a desktop tab never sleeps this way');
    assert.strictEqual(hb.quietWindowFor({}, { phone: { shell: 'mobile' } }), hb.QUIET_WINDOW_MS);

    // every frame counts as heard; what goes out moves sentAt
    const sock = new EventEmitter();
    sock.send = () => {};
    sock.ping = () => {};
    const we = hb.createSocketHeartbeatEntry(1);
    we.alive = false;
    hb.watchSocketFrames(sock, we);
    sock.emit('message', 'x');
    assert.strictEqual(we.alive, true);
    we.sentAt = 1;
    sock.send('y');
    assert.ok(we.sentAt > 1, 'send moves sentAt');
    we.sentAt = 1;
    sock.emit('ping');
    assert.ok(we.sentAt > 1, 'the auto pong to a client ping counts as sent');
}

// ---------------------------------------------------------------- broadcast audiences
{
    const want = wst.socketWantsBroadcast;
    const phone = { phone: { shell: 'mobile' }, desktopState: 'ready' };
    const dex = { desktopState: 'desktop' };
    const desk = { desktopState: 'desktop' };
    const unknown = {};
    assert.strictEqual(want(phone, 'print_queue_state'), false, 'desktop-only: not to a phone page');
    assert.strictEqual(want(dex, 'print_queue_state'), true, 'a DeX window is a desktop page');
    assert.strictEqual(want(phone, 'lapis_updated'), true);
    assert.strictEqual(want(desk, 'lapis_updated'), false, 'phone-only: not to a desktop page');
    assert.strictEqual(want(unknown, 'lapis_updated'), true, 'a page that has not said what it is gets it');
    assert.strictEqual(want(phone, 'print_queue_state', true), true, 'sendToUser: no per-shell filter');
    assert.strictEqual(want({ as: { speaker: 'service' } }, 'queue_update'), false, 'the background link reads no broadcast');
    assert.strictEqual(want({ as: { speaker: 'service' } }, 'queue_update', true), false);
    const light = { light: true, lightSubs: new Set(['gallery_updated']) };
    assert.strictEqual(want(light, 'gallery_updated'), true, 'a light socket: what it subscribed to');
    assert.strictEqual(want(light, 'queue_update'), false);
    assert.strictEqual(want(light, 'queue_update', true), false);
    assert.strictEqual(want({ light: true }, 'gallery_updated'), false, 'a light socket that subscribed to nothing');
    assert.strictEqual(wst.isDesktopPage({ phone: { shell: 'mobile' }, desktopState: 'desktop' }), false);
}

// ---------------------------------------------------------------- dormant holds over Continuity / Miniport
function fakeServer() {
    const srv = Object.create(WebSocketServer.prototype);
    srv.clients = new Map();
    srv.wss = { clients: new Set() };
    srv.globalResources = {};
    return srv;
}
function socket(name) {
    const ws = new EventEmitter();
    ws.name = name;
    ws.readyState = 1;
    ws.sent = [];
    ws.send = (d, cb) => { ws.sent.push(d); if (typeof cb === 'function') cb(); };
    ws.ping = () => {};
    ws.close = () => { ws.readyState = 3; };
    ws.terminate = () => { ws.readyState = 3; };
    return ws;
}
{
    const srv = fakeServer();
    const log = console.log;
    console.log = () => {}; // the asleep / awake lines
    const mp = socket('miniport');
    mp._dsMiniport = true;
    const subs = {};
    vs.acceptMiniport(mp, { headers: {}, url: '/?miniport=1' }, { authenticated: true, sessionId: 'S' }, (v) => { subs[v.sub] = v; });
    mp.sent.length = 0;
    mp.emit('message', Buffer.from(JSON.stringify({ type: 'sub_open', sub: 'phone', raw: 1, cc: 1 })));
    mp.emit('message', Buffer.from(JSON.stringify({ type: 'sub_open', sub: 'desktop', raw: 1, cc: 1 })));
    const desk = socket('desk');
    srv.wss.clients.add(desk);
    srv.clients.set(desk, { authenticated: true, sessionId: 'S', desktopState: 'desktop' });
    srv.clients.set(subs.phone, { authenticated: true, sessionId: 'S', phone: { shell: 'mobile' }, desktopState: 'ready' });
    srv.clients.set(subs.desktop, { authenticated: true, sessionId: 'S', desktopState: 'desktop' });

    // both awake: one copy over the Miniport for both pages
    srv.broadcast({ type: 'queue_update', data: { n: 1 } });
    assert.strictEqual(mp.sent.length, 1);
    assert.deepStrictEqual(JSON.parse(mp.sent[0]), { type: 'queue_update', data: { n: 1 }, _cc: ['phone', 'desktop'] });
    assert.strictEqual(desk.sent.length, 1);
    mp.sent.length = 0; desk.sent.length = 0;

    // the DeX window sleeps (client_dormant dex: 1): held for it; the phone's copy goes alone, raw
    srv.clients.get(subs.desktop).dexWindow = true;
    srv.setDormant(subs.desktop, true);
    srv.broadcast({ type: 'queue_update', data: { n: 2 } });
    srv.broadcast({ type: 'queue_update', data: { n: 3 } });
    assert.deepStrictEqual(mp.sent, ['\u0001phone\u0001{"type":"queue_update","data":{"n":2}}', '\u0001phone\u0001{"type":"queue_update","data":{"n":3}}'], 'the carrier copy leaves the sleeping DeX window out');
    // not held: a reply, or a type nothing waits on
    srv.broadcast({ type: 'gallery_updated', data: {} });
    assert.ok(JSON.parse(mp.sent[2])._cc.includes('desktop'), 'a type that is not held still goes to it');
    mp.sent.length = 0;

    // sendToUser decides per socket as well: the DeX window's copy is held, the phone's goes
    srv.sendToUser('S', { type: 'xlink_status', data: { a: 1 } });
    assert.deepStrictEqual(mp.sent, ['\u0001phone\u0001{"type":"xlink_status","data":{"a":1}}']);
    mp.sent.length = 0;
    // a reply to the session is never held
    srv.sendToUser('S', { type: 'xlink_status', requestId: 'r1', data: { a: 2 } });
    assert.deepStrictEqual(JSON.parse(mp.sent[0])._cc, ['phone', 'desktop']);
    mp.sent.length = 0;

    // it wakes: the newest queue_update and the xlink_status go to it over the Miniport, in order
    srv.setDormant(subs.desktop, false);
    assert.deepStrictEqual(mp.sent, [
        '\u0001desktop\u0001{"type":"queue_update","data":{"n":3}}',
        '\u0001desktop\u0001{"type":"xlink_status","data":{"a":1}}'
    ]);
    mp.sent.length = 0;

    // a sleeping phone page with an awake DeX window: the DeX window's copy is not held with the phone's
    srv.setDormant(subs.phone, true);
    srv.sendToUser('S', { type: 'queue_update', data: { n: 4 } });
    assert.deepStrictEqual(mp.sent, ['\u0001desktop\u0001{"type":"queue_update","data":{"n":4}}']);
    srv.setDormant(subs.phone, false);
    assert.strictEqual(mp.sent[1], '\u0001phone\u0001{"type":"queue_update","data":{"n":4}}');
    console.log = log;
}

// ---------------------------------------------------------------- ActiveSync own peers key, as_credits
{
    const as = require('../modules/activeSync');
    const os = require('os');
    const fs = require('fs');
    const path = require('path');
    const { ownPeersKey } = as.__test;
    const me = 'a1b2c3d4e5f60718';
    const base = { devices: [{ deviceId: me, name: 'Phone', session: 'partner', status: { battery: 50 }, lastSync: 1 }, { deviceId: 'b1b2c3d4e5f60718', name: 'Other', status: { battery: 10 } }], computers: [{ id: 'pc', name: 'PC' }] };
    const k1 = ownPeersKey(base, me);
    const k2 = ownPeersKey({ ...base, devices: [{ ...base.devices[0], status: { battery: 40 }, lastSync: 2 }, base.devices[1]] }, me);
    assert.strictEqual(k1, k2, 'its own status report does not change what it reads');
    const k3 = ownPeersKey({ ...base, devices: [{ ...base.devices[0], name: 'Renamed' }, base.devices[1]] }, me);
    assert.notStrictEqual(k1, k3, 'its name does');
    const k4 = ownPeersKey({ ...base, devices: [base.devices[0], { ...base.devices[1], status: { battery: 11 } }] }, me);
    assert.notStrictEqual(k1, k4, 'another phone\'s row is read whole');

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-credits-'));
    as.resetForTests(tmp);
    const out = [];
    const server = { clients: new Map(), sendToClient: (ws, msg) => out.push({ ws, msg }), broadcast() {} };
    const svc = socket('svc');
    const page = socket('page');
    server.clients.set(svc, { authenticated: true, as: { kind: 'device', id: me, speaker: 'service', since: 2 } });
    server.clients.set(page, { authenticated: true, as: { kind: 'device', id: me, speaker: 'webview', since: 1 } });
    let credits = { free: 100, paid: 0, daysLeft: 3 };
    as.setCreditsProvider(() => credits);
    const gr = { getWebSocketServer: () => server };
    assert.strictEqual(as.pushCredits(gr, server, server.clients.get(svc)), 1, 'once after its hello');
    assert.deepStrictEqual(out[0].msg.data, { free: '100', paid: '0', daysLeft: '3' });
    assert.strictEqual(out[0].ws, svc, 'only the background link');
    assert.strictEqual(as.pushCredits(gr, server), 0, 'the status round: nothing new');
    credits = { free: 90, paid: 0, daysLeft: 3 };
    assert.strictEqual(as.pushCredits(gr, server), 1, 'a change goes');
    assert.strictEqual(as.pushCredits(gr, server), 0);
    as.setCreditsProvider(null);
    as.resetForTests();
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log('ws phone round 2/3: ok');
process.exit(0);
