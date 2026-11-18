#!/usr/bin/env node
/**
 * The server's phone rules from #890 round 5, without a live server (traffic W4 and the inbox's W2 live in
 * test-traffic-service.js and test-notification-inbox.js):
 *  - audiences: every round 5 type in exactly one of DESKTOP_ONLY / PHONE_ONLY / BROADCAST_ALL
 *  - W5 tm_event: sync / syncprogress and a catch-up that changed nothing stay off phone pages; typing is
 *    dropped for a sleeping page, account events wait as the newest per account, texts go at once; a
 *    BlueBubbles catch-up tells the phones only when what they list changed (textMessagingStore.fingerprint)
 *  - W6 ma_event: progress never to phones, a sync's end only when the worker reported changes (or its
 *    error line moved)
 *  - W7 inbox_updated: an ack skips a sleeping phone page, a new notice goes; desktop pages get neither
 *  - W3 status_subscribe_response carries the snapshot once (data.items); a snapshot younger than one
 *    interval answers a quick resubscribe without reading upstream
 *  - W1 weather: unread fields left out, part hashes, delta replies a client merges into the same model,
 *    weather_watch pushes only changes (a sleeping page's copy is held cumulative and newest-only)
 *  - finding 35: socket dials during boot get 503, not Express's 302 /launch; released before the real
 *    WebSocket server attaches
 *  - W8 /dist/workbox/*.js a day's public cache; W9 a phone's file list gets fit previews
 *   node scripts/test-ws-phone-round5.js
 */
'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

// child processes (the BlueBubbles catch-up, the mail sync) are fakes; mailAccounts takes fork at load
const cp = require('child_process');
const realFork = cp.fork;
let forkImpl = null;
cp.fork = (...args) => (forkImpl ? forkImpl(...args) : realFork(...args));
function fakeChild() {
    const c = new EventEmitter();
    c.send = () => {};
    c.kill = () => {};
    return c;
}

const { WebSocketServer, _test: wst } = require('../modules/websocket');

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
const types = (ws) => ws.sent.map((m) => JSON.parse(m));
const settle = (ms = 15) => new Promise((r) => setTimeout(r, ms));
const PHONE = () => ({ authenticated: true, userType: 'admin', sessionId: 'S', phone: { shell: 'mobile' }, desktopState: 'ready' });
const DESK = () => ({ authenticated: true, userType: 'admin', sessionId: 'S', desktopState: 'desktop' });

async function main() {
    const log = console.log;

    // ------------------------------------------------------------ audiences
    {
        const lists = [wst.DESKTOP_ONLY_TYPES, wst.PHONE_ONLY_TYPES, wst.BROADCAST_ALL];
        const seen = new Map();
        lists.forEach((l, i) => l.forEach((t) => { assert.ok(!seen.has(t), `${t} is in one list only`); seen.set(t, i); }));
        ['inbox_updated', 'traffic_settings_changed', 'traffic_report'].forEach((t) => assert.ok(wst.PHONE_ONLY_TYPES.has(t), t));
        ['sidebar_updated'].forEach((t) => assert.ok(wst.DESKTOP_ONLY_TYPES.has(t), t));
        assert.ok(wst.BROADCAST_ALL.has('novel_updated'), 'novel_updated reaches the phone (Rentan novel view)');
        assert.ok(typeof wst.DORMANT_HOLD.get('novel_updated') === 'function', 'novel_updated held per note');
        ['tm_event', 'ma_event', 'weather_rain_status', 'weather_alert_issued', 'weather_rain_alarm', 'note_updated', 'gallery_updated', 'system_message'].forEach((t) => assert.ok(wst.BROADCAST_ALL.has(t), t));
        // notification drivers are never held
        ['weather_alert_issued', 'weather_rain_alarm', 'system_message', 'agent_notice', 'receipt_notification'].forEach((t) => assert.ok(!wst.DORMANT_HOLD.has(t), `${t} is never held`));
        // the perf checker finds no unclassified broadcast in the files this round touched
        const { scanFile } = require('./check-perf-rules');
        ['modules/websocket.js', 'modules/textMessaging.js', 'modules/weatherService.js', 'modules/trafficService.js', 'modules/ws/handlers/30-notesHandler.js', 'modules/vfsWebSocketHandlers.js', 'modules/websocketHandlers.js']
            .forEach((f) => assert.strictEqual(scanFile(f).filter((h) => h.rule === 'unclassified-broadcast').length, 0, f));
    }

    // ------------------------------------------------------------ W5: tm_event holds
    {
        const k = wst.tmEventHoldKey;
        assert.strictEqual(k({ event: 'typing', accountId: 'a' }), false, 'typing: dropped');
        assert.strictEqual(k({ event: 'message', accountId: 'a' }), null, 'a text goes at once');
        assert.strictEqual(k({ event: 'signin_lost', accountId: 'a' }), null);
        assert.strictEqual(k({ event: 'account', accountId: 'a' }), 'account:a');
        assert.strictEqual(k({ event: 'reload', accountId: 'a', chatGuid: 'c' }), 'reload:a:c');

        const srv = fakeServer();
        const ph = socket('phone');
        srv.wss.clients.add(ph);
        srv.clients.set(ph, PHONE());
        console.log = () => {};
        srv.setDormant(ph, true);
        const tm = (data) => srv.broadcast({ type: 'tm_event', data });
        tm({ event: 'typing', accountId: 'a', chatGuid: 'c', typing: true });
        tm({ event: 'account', accountId: 'a', n: 1 });
        tm({ event: 'account', accountId: 'a', n: 2 });
        assert.strictEqual(ph.sent.length, 0, 'nothing over the radio for typing or account');
        tm({ event: 'message', accountId: 'a', chatGuid: 'c' });
        assert.deepStrictEqual(types(ph).map((m) => m.data.event), ['message'], 'a text wakes the page');
        ph.sent.length = 0;
        srv.setDormant(ph, false);
        console.log = log;
        assert.deepStrictEqual(types(ph).map((m) => [m.data.event, m.data.n]), [['account', 2]], 'on waking: the newest account event, no typing');
        // an awake page gets typing
        ph.sent.length = 0;
        tm({ event: 'typing', accountId: 'a', chatGuid: 'c', typing: true });
        assert.strictEqual(ph.sent.length, 1);
    }

    // ------------------------------------------------------------ W5: who gets which subtype (textMessaging)
    {
        const tmod = require('../modules/textMessaging');
        const got = [];
        tmod._test.setResources({
            getWebSocketServer: () => ({ broadcast: (m, f) => got.push({ m, f }) }),
            getConfig: () => ({ accounts: [] }),
            getPath: () => os.tmpdir()
        });
        const last = () => got[got.length - 1];
        await tmod._test.onProviderEvent('a', 'syncprogress', { accountId: 'a', running: true, done: 1, total: 9 });
        assert.ok(!last().f(PHONE()) && last().f(DESK()), 'syncprogress: desktop only');
        await tmod._test.onProviderEvent('a', 'sync', { accountId: 'a' });
        assert.ok(!last().f(PHONE()) && last().f(DESK()), 'sync: desktop only');
        await tmod._test.onProviderEvent('a', 'account', { accountId: 'a', phones: false });
        assert.ok(!last().f(PHONE()) && last().f(DESK()), 'a catch-up that changed nothing: desktop only');
        assert.ok(!('phones' in last().m.data), 'the hint is not part of the event');
        await tmod._test.onProviderEvent('a', 'account', { accountId: 'a', phones: true });
        assert.ok(last().f(PHONE()), 'a real change reaches the phones');
        await tmod._test.onProviderEvent('a', 'typing', { accountId: 'a', chatGuid: 'c', typing: true });
        assert.ok(last().f(PHONE()), 'typing goes to an awake phone (the sleeping one drops it)');
        assert.ok(!last().f({ authenticated: true, userType: 'user', phone: { shell: 'mobile' } }), 'admins only');
    }

    // ------------------------------------------------------------ W5: a BlueBubbles catch-up's end
    {
        const store = require('../modules/textMessagingStore');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tm-r5-'));
        store.open(dir);
        const { BlueBubblesProvider } = require('../modules/textMessagingBlueBubbles');
        const emitted = [];
        const p = new BlueBubblesProvider({ id: 'bb1', url: 'http://127.0.0.1:9', password: 'x' }, { emit: (e, d) => emitted.push([e, d]), log: () => {} });
        p.store = store;
        p.status = 'connected';
        store.putChats('bb1', [{ guid: 'c0', raw: { a: 1 }, lastDate: 1 }]);
        let child = null;
        forkImpl = () => { child = fakeChild(); return child; };
        p.startSync();
        child.emit('exit');
        assert.deepStrictEqual(emitted.pop(), ['account', { accountId: 'bb1', phones: false }], 'nothing new: desktop only');
        p.startSync();
        store.putChats('bb1', [{ guid: 'c1', raw: { b: 2 }, lastDate: 5 }]);
        child.emit('exit');
        assert.deepStrictEqual(emitted.pop(), ['account', { accountId: 'bb1', phones: true }], 'a new conversation reaches the phones');
        p.startSync();
        store.putChats('bb1', [{ guid: 'c0', raw: { a: 1, read: true }, lastDate: 1 }]);
        child.emit('exit');
        assert.strictEqual(emitted.pop()[1].phones, true, 'a read state in a chat row counts');
        forkImpl = null;
        store._close();
        fs.rmSync(dir, { recursive: true, force: true });
    }

    // ------------------------------------------------------------ W6: mail sync events
    {
        const ma = require('../modules/mailAccounts');
        const got = [];
        ma._test.setResources({
            getWebSocketServer: () => ({ broadcast: (m, f) => got.push({ m, f }) }),
            getConfig: () => null,
            getSecureConfig: () => null,
            getPath: () => os.tmpdir()
        });
        const ev = (e) => got.filter((g) => g.m.data.event === e);
        let child = null;
        forkImpl = () => { child = fakeChild(); return child; };
        console.log = () => {};
        const rt = { account: { id: 'm1' }, status: 'connected', error: '' };
        ma._test.runSync(rt);
        child.emit('message', { progress: { phase: 'INBOX', done: 1 } });
        assert.ok(!ev('progress')[0].f(PHONE()) && ev('progress')[0].f(DESK()), 'progress: desktop only');
        child.emit('message', { done: true, changes: [] });
        child.emit('exit');
        let end = ev('sync').pop();
        assert.strictEqual(end.m.data.changed, false);
        assert.ok(!end.f(PHONE()) && end.f(DESK()), 'nothing changed: the desktop hears the end, the phones nothing');
        ma._test.runSync(rt);
        child.emit('message', { done: true, changes: [{ folder: 'INBOX', fetched: 2, removed: 0, flagsChanged: 0 }] });
        assert.ok(ev('folders').pop().f(PHONE()), 'folders go to the phones');
        child.emit('exit');
        end = ev('sync').pop();
        assert.ok(end.m.data.changed === true && end.f(PHONE()), 'a reported change reaches the phones');
        ma._test.runSync(rt);
        child.emit('message', { error: 'Command failed' });
        child.emit('exit');
        assert.ok(ev('sync').pop().f(PHONE()), 'an error line that came counts');
        ma._test.runSync(rt);
        child.emit('message', { error: 'Command failed' });
        child.emit('exit');
        assert.ok(!ev('sync').pop().f(PHONE()), 'the same error again does not');
        console.log = log;
        forkImpl = null;
    }

    // ------------------------------------------------------------ W7: inbox_updated
    {
        const srv = fakeServer();
        const ph = socket('phone');
        const desk = socket('desk');
        srv.wss.clients.add(ph); srv.wss.clients.add(desk);
        srv.clients.set(ph, PHONE());
        srv.clients.set(desk, DESK());
        console.log = () => {};
        srv.setDormant(ph, true);
        srv.broadcast({ type: 'inbox_updated', data: { reason: 'ack', id: 'n1', state: 'cleared' } });
        assert.strictEqual(ph.sent.length, 0, 'an ack skips the sleeping phone');
        srv.broadcast({ type: 'inbox_updated', data: { reason: 'new', notice: { id: 'n2' } } });
        assert.strictEqual(types(ph).length, 1, 'a new notice goes at once');
        ph.sent.length = 0;
        srv.setDormant(ph, false);
        console.log = log;
        assert.strictEqual(ph.sent.length, 0, 'nothing held: it lists what changed on waking');
        assert.strictEqual(desk.sent.length, 0, 'desktop pages never get it');
        srv.broadcast({ type: 'inbox_updated', data: { reason: 'ack', id: 'n3', state: 'acted' } });
        assert.strictEqual(ph.sent.length, 1, 'an awake phone gets the ack');
    }

    // ------------------------------------------------------------ W3: statusHub
    {
        const statusHub = require('../modules/ws/statusHub');
        let reads = 0;
        const feed = statusHub.define({ name: 'r5test', pushType: 'r5_status', intervalMs: 60, sample: async () => { reads++; return { a: 1 }; } });
        statusHub.setSender(() => {});
        const s1 = socket('s1');
        let r = await feed.subscribe(s1, {});
        assert.strictEqual(reads, 1);
        assert.deepStrictEqual(r.items, { a: 1 });
        feed.unsubscribe(s1);
        r = await feed.subscribe(s1, {});
        assert.strictEqual(reads, 1, 'a quick return: the kept snapshot, no upstream read');
        assert.deepStrictEqual(r.items, { a: 1 });
        feed.unsubscribe(s1);
        await settle(80);
        await feed.subscribe(s1, {});
        assert.strictEqual(reads, 2, 'older than an interval: read again');
        feed.unsubscribe(s1);
        feed.poke();
        await feed.subscribe(s1, {});
        assert.strictEqual(reads, 3, 'a poke with nobody watching drops the kept snapshot');
        feed.unsubscribe(s1);

        // a subscribe while others watch never reads upstream itself, even when the snapshot is an interval
        // old (the feed's tick is reading): the tick's change push still reaches the existing subscriber
        {
            let v = 1; let started = null; let release = null; let sampleN = 0;
            const sent = [];
            const slow = statusHub.define({ name: 'r5race', pushType: 'r5_race', intervalMs: 40, sample: async () => {
                sampleN++;
                if (sampleN === 2) { if (started) started(); await new Promise((res) => { release = res; }); }
                return { a: v };
            } });
            statusHub.setSender((ws, m) => sent.push([ws.name, m]));
            const w1 = socket('w1'); const w2 = socket('w2');
            await slow.subscribe(w1, {});
            v = 2;
            await new Promise((res) => { started = res; }); // the tick's read is in flight
            await settle(5);
            const r2 = await slow.subscribe(w2, {});
            assert.strictEqual(sampleN, 2, 'the second subscriber did not read upstream beside the tick');
            assert.deepStrictEqual(r2.items, { a: 1 });
            release();
            await settle(5);
            const toW1 = sent.filter(([id, m]) => id === 'w1' && m.type === 'r5_race');
            assert.strictEqual(toW1.length, 1, 'the existing subscriber got the change push');
            assert.deepStrictEqual(toW1[0][1].changed, { a: 2 });
            slow.unsubscribe(w1); slow.unsubscribe(w2);
            statusHub.setSender(() => {});
        }

        const registry = require('../modules/ws/wsPacketRegistry');
        const out = [];
        require('../modules/ws/handlers/294-statusHubHandler').registerPackets({ sendToClient: (ws, m) => out.push(m), sendError: (ws, msg) => out.push({ error: msg }) });
        await registry.getWsPacketHandler('status_subscribe')({ ws: s1, message: { type: 'status_subscribe', feed: 'r5test', requestId: 'q' }, clientInfo: {} });
        const resp = out.pop();
        assert.ok(!('items' in resp), 'no top-level copy');
        assert.deepStrictEqual(resp.data, { feed: 'r5test', items: { a: 1 } }, 'data.items once');
        feed.unsubscribe(s1);
    }

    // ------------------------------------------------------------ W1: the forecast on the wire
    const ws5 = require('../modules/weatherService');
    const row = (time, t, extra = {}) => Object.assign({ time, tempC: t, feelsC: t - 1, dewC: 1, code: 0, text: 'Clear', conditionCode: 'Clear', isDay: true, rain: 0, precipMm: 0, precipType: 'clear', snowMm: 0, humidity: 50, windKmh: 5, windDir: 90, gustKmh: 8, uv: 1, pressure: 1010, pressureTrend: 'steady', visibilityM: 10000, cloud: 10, missing: null }, extra);
    const model = (over = {}) => Object.assign({
        provider: 'apple', tz: 'America/Denver', offset: -25200, fetchedAt: '2026-11-17T17:00:00.000Z', expiresAt: null, place: { code: 'US' },
        current: { time: '2026-11-17T10:00', tempC: 5, code: 0, conditionCode: 'Clear', cloudLow: 1, cloudMid: 2, cloudHigh: 3, pressureTrend: 'rising', visibilityM: 9000, dewC: 0 },
        minutely: { source: 'apple', stepMinutes: 1, summary: 'No precipitation', periods: [{ from: 'x' }], minutes: [{ time: '2026-11-17T10:00', rain: 0, mmh: 0 }] },
        hourly: [row('2026-11-17T22:00', 4), row('2026-11-17T23:00', 3), row('2026-11-18T00:00', 2), row('2026-11-18T01:00', 1)],
        daily: [{ date: '2026-11-17', code: 0, conditionCode: 'Clear', maxC: 8, minC: 1, maxAt: 'a', minAt: 'b', precipType: 'clear', snowMm: 1, day: { code: 0, conditionCode: 'Clear', precipType: 'clear', snowMm: 2 }, night: null }],
        alerts: []
    }, over);
    const m1 = model();
    const w1 = ws5.forecastWire(m1);
    {
        assert.strictEqual(ws5.forecastWire(m1), w1, 'made once per forecast');
        const mo = w1.model;
        assert.ok(!('place' in mo));
        ['conditionCode', 'cloudLow', 'cloudMid', 'cloudHigh'].forEach((f) => assert.ok(!(f in mo.current), `current.${f}`));
        assert.ok(mo.current.pressureTrend && mo.current.visibilityM, 'the current tiles keep theirs');
        assert.ok(!('periods' in mo.minutely) && mo.minutely.minutes.length === 1);
        ['conditionCode', 'precipType', 'pressureTrend', 'visibilityM', 'snowMm', 'missing'].forEach((f) => assert.ok(!(f in mo.hourly[0]), `hourly.${f}`));
        assert.strictEqual(mo.hourly[0].dewC, 1, 'the hour row\'s dew point stays');
        ['conditionCode', 'precipType', 'maxAt', 'minAt'].forEach((f) => assert.ok(!(f in mo.daily[0]), `daily.${f}`));
        assert.strictEqual(mo.daily[0].snowMm, 1);
        assert.deepStrictEqual(mo.daily[0].day, { code: 0, snowMm: 2 }, 'day / night parts lose the same two fields');
        assert.ok(!('night' in mo.daily[0]), 'nulls are left out as before');
        assert.ok(m1.current.conditionCode && m1.place, 'getForecast\'s own model is not changed');
        assert.deepStrictEqual(Object.keys(w1.hashes.hourly), ['2026-11-17', '2026-11-18'], 'hourly per local day, in order');
        const sha = (v) => crypto.createHash('sha1').update(JSON.stringify(v)).digest('hex');
        assert.strictEqual(w1.hashes.current, sha(mo.current));
        assert.strictEqual(w1.hashes.hourly['2026-11-18'], sha(mo.hourly.slice(2)));
    }
    // a client's merge of a delta into what it holds
    const PARTS = ['current', 'minutely', 'daily', 'alerts'];
    function merge(base, r) {
        const out = {};
        Object.keys(r).forEach((k) => { if (!['same', 'hashes', 'hourly'].concat(PARTS).includes(k)) out[k] = r[k]; });
        const same = new Set(r.same || []);
        PARTS.forEach((k) => { const v = same.has(k) ? base[k] : r[k]; if (v !== undefined) out[k] = v; });
        const days = {};
        (base.hourly || []).forEach((h) => { const d = String(h.time).slice(0, 10); (days[d] = days[d] || []).push(h); });
        out.hourly = [].concat(...Object.keys(r.hashes.hourly).map((d) => (same.has(`hourly:${d}`) ? days[d] : r.hourly[d])));
        out.hashes = r.hashes;
        return out;
    }
    const m2 = model({
        fetchedAt: '2026-11-17T17:10:00.000Z',
        current: Object.assign({}, m1.current, { tempC: 6 }),
        hourly: [row('2026-11-17T23:00', 3), row('2026-11-18T00:00', 2), row('2026-11-18T01:00', 0), row('2026-11-18T02:00', -1)]
    });
    const w2 = ws5.forecastWire(m2);
    {
        const full1 = ws5.forecastReply(w1);
        assert.ok(Array.isArray(full1.hourly) && full1.hashes && !('same' in full1), 'no have: the whole model and its hashes');
        const none = ws5.forecastReply(w1, w1.hashes);
        assert.deepStrictEqual(none.same.sort(), ['alerts', 'current', 'daily', 'hourly:2026-11-17', 'hourly:2026-11-18', 'minutely'].sort());
        assert.ok(!('hourly' in none) && !('current' in none), 'unchanged: no parts');
        assert.strictEqual(none.fetchedAt, m1.fetchedAt, 'scalars always');
        const d = ws5.forecastReply(w2, w1.hashes);
        assert.ok(d.current && d.current.tempC === 6);
        assert.ok(d.same.includes('daily') && d.same.includes('minutely') && d.same.includes('alerts'));
        assert.deepStrictEqual(Object.keys(d.hourly).sort(), ['2026-11-17', '2026-11-18'], 'both days moved (the window slid)');
        assert.deepStrictEqual(merge(full1, d), ws5.forecastReply(w2), 'the merge is the full reply');
        // only the second day changes
        const m3 = model({ hourly: m1.hourly.slice(0, 2).concat([row('2026-11-18T00:00', 9), row('2026-11-18T01:00', 1)]) });
        const d3 = ws5.forecastReply(ws5.forecastWire(m3), w1.hashes);
        assert.deepStrictEqual(Object.keys(d3.hourly), ['2026-11-18']);
        assert.ok(d3.same.includes('hourly:2026-11-17'));
        assert.deepStrictEqual(merge(full1, d3), ws5.forecastReply(ws5.forecastWire(m3)));
        assert.strictEqual(ws5.wireDiffers(w1, w1.hashes), false);
        assert.strictEqual(ws5.wireDiffers(w2, w1.hashes), true);
        assert.strictEqual(ws5.wireDiffers(w1, Object.assign({}, w1.hashes, { hourly: Object.assign({ '2026-11-16': 'x' }, w1.hashes.hourly) })), true, 'a day the page holds that went: differs');
    }

    // ------------------------------------------------------------ W1 stage 2: weather_watch
    {
        const watch = require('../modules/weatherWatch');
        let current = m1;
        const realGet = ws5.getForecast;
        ws5.getForecast = async () => current;
        const srvLike = { sendToClient: (ws, m) => ws.sent.push(m), isDormantSocket: (ws) => !!ws.asleep };
        watch.bind(srvLike);
        const a = socket('a');
        assert.deepStrictEqual(watch.watch(a, [{ key: 'home', lat: 44.08, lon: -103.23 }, { key: 'bad', lat: 'x' }]), ['home'], 'bad places are left out');
        await settle();
        assert.strictEqual(a.sent.length, 1, 'no have: caught up at once');
        assert.strictEqual(a.sent[0].type, 'weather_delta');
        assert.strictEqual(a.sent[0].data.key, 'home');
        assert.ok(Array.isArray(a.sent[0].data.hourly), 'the whole model');
        assert.strictEqual(await watch.tick(), 0, 'unchanged: nothing');
        a.sent.length = 0;
        watch.watch(a, [{ key: 'home', lat: 44.08, lon: -103.23, have: w1.hashes }]);
        await settle();
        assert.strictEqual(a.sent.length, 0, 'a page whose have is current gets nothing');
        current = model(Object.assign({}, m1, { fetchedAt: 'later' }));
        assert.strictEqual(await watch.tick(), 0, 'fetchedAt alone is a clock: nothing');
        current = m2;
        assert.strictEqual(await watch.tick(), 1);
        const d = a.sent.pop().data;
        assert.ok(d.current && d.same.includes('daily'), 'only what changed');
        assert.strictEqual(await watch.tick(), 0);
        // asleep: held cumulative against what it had before it slept
        a.asleep = true;
        const m4 = model({ current: Object.assign({}, m2.current, { tempC: 7 }), hourly: m2.hourly });
        current = m4;
        assert.strictEqual(await watch.tick(), 1);
        const m5 = model({ current: m4.current, hourly: m2.hourly, daily: [Object.assign({}, m1.daily[0], { maxC: 12 })] });
        current = m5;
        assert.strictEqual(await watch.tick(), 1);
        const held = a.sent.pop().data;
        assert.ok(held.current && held.daily, 'the newest copy carries every change since it slept');
        assert.ok(held.key === 'home' && held.available === true);
        const { key: _k, available: _a, ...heldBody } = held;
        assert.deepStrictEqual(merge(ws5.forecastReply(w2), heldBody), ws5.forecastReply(ws5.forecastWire(m5)));
        assert.strictEqual(await watch.tick(), 0, 'nothing new while asleep');
        a.asleep = false;
        assert.strictEqual(await watch.tick(), 0, 'awake: its have moved on with the held copy');
        a.emit('close');
        assert.ok(!watch._test.watchers.has(a), 'a closed socket stops watching');
        const b = socket('b');
        watch.watch(b, [{ key: 'home', lat: 44.08, lon: -103.23, have: ws5.forecastWire(m5).hashes }]);
        watch.unwatch(b);
        assert.strictEqual(watch._test.watchers.size, 0);
        ws5.getForecast = realGet;
        watch._test.reset();

        // the server holds a sleeping page's deltas newest-only per place
        const srv = fakeServer();
        const ph = socket('phone');
        srv.clients.set(ph, PHONE());
        console.log = () => {};
        srv.setDormant(ph, true);
        assert.strictEqual(srv.isDormantSocket(ph), true);
        srv.sendToClient(ph, { type: 'weather_delta', data: { key: 'home', n: 1 } });
        srv.sendToClient(ph, { type: 'weather_delta', data: { key: 'work', n: 1 } });
        srv.sendToClient(ph, { type: 'weather_delta', data: { key: 'home', n: 2 } });
        assert.strictEqual(ph.sent.length, 0);
        srv.setDormant(ph, false);
        console.log = log;
        assert.deepStrictEqual(types(ph).map((m) => [m.data.key, m.data.n]), [['work', 1], ['home', 2]]);
    }

    // ------------------------------------------------------------ W1: the packets (291-weatherHandler)
    {
        const registry = require('../modules/ws/wsPacketRegistry');
        const out = [];
        const realGet = ws5.getForecast;
        ws5.getForecast = async () => m2;
        const ctx = { globalResources: { getConfig: () => undefined, getSecureConfig: () => null }, sendToClient: (ws, m) => out.push(m), sendError: (ws, msg, code) => out.push({ error: msg, code }) };
        require('../modules/ws/handlers/291-weatherHandler').registerPackets(ctx);
        const fc = registry.getWsPacketHandler('weather_forecast');
        await fc({ ws: {}, message: { type: 'weather_forecast', requestId: 'f1', lat: 44.08, lon: -103.23 }, clientInfo: {} });
        const full = out.pop();
        assert.strictEqual(full.type, 'weather_forecast_response');
        assert.strictEqual(full.data.available, true);
        assert.ok(Array.isArray(full.data.hourly) && full.data.hashes && !('place' in full.data), 'today\'s shape plus hashes, unread fields left out');
        await fc({ ws: {}, message: { type: 'weather_forecast', requestId: 'f2', lat: 44.08, lon: -103.23, have: w1.hashes }, clientInfo: {} });
        const delta = out.pop().data;
        assert.ok(delta.available && delta.current && delta.same.includes('daily') && !Array.isArray(delta.hourly));
        const fakeSrv = { sendToClient: (ws, m) => ws.sent.push(m), isDormantSocket: () => false };
        const c = socket('c');
        await registry.getWsPacketHandler('weather_watch')({ ws: c, message: { type: 'weather_watch', requestId: 'w1', places: [{ key: 'k', lat: 44.08, lon: -103.23, have: w2.hashes }] }, clientInfo: {}, wsServer: fakeSrv });
        assert.deepStrictEqual(out.pop().data, { ok: true, keys: ['k'] });
        await settle();
        assert.strictEqual(c.sent.length, 0, 'its have is current');
        await registry.getWsPacketHandler('weather_unwatch')({ ws: c, message: { type: 'weather_unwatch', requestId: 'w2' }, clientInfo: {}, wsServer: fakeSrv });
        assert.deepStrictEqual(out.pop().data, { ok: true });
        assert.strictEqual(require('../modules/weatherWatch')._test.watchers.size, 0);
        ws5.getForecast = realGet;
        require('../modules/weatherWatch')._test.reset();
    }

    // ------------------------------------------------------------ finding 35: socket dials during boot
    {
        const early = require('../modules/earlyHttpServer');
        const port = await new Promise((resolve) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
        const root = fs.mkdtempSync(path.join(os.tmpdir(), 'early-r5-'));
        fs.writeFileSync(path.join(root, 'config.json'), JSON.stringify({ port }));
        const srv = early.bindEarly(root);
        assert.strictEqual(await srv.earlyListen, true);
        const dial = () => new Promise((resolve, reject) => {
            const req = http.request({ host: '127.0.0.1', port, path: '/?miniport=1', headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==', 'Sec-WebSocket-Version': '13' } });
            req.on('response', (res) => { res.resume(); resolve({ status: res.statusCode, retry: res.headers['retry-after'], location: res.headers.location }); });
            req.on('upgrade', (res, sock) => { sock.destroy(); resolve({ status: 101 }); });
            req.on('error', reject);
            req.end();
        });
        // the Express app is attached at once in the real boot; a redirecting stand-in shows it is not asked
        srv.on('request', (req, res) => { res.writeHead(302, { Location: '/launch' }); res.end(); });
        const r1 = await dial();
        assert.strictEqual(r1.status, 503, 'a dial during boot: 503');
        assert.strictEqual(r1.retry, '5');
        assert.ok(!r1.location, 'not the 302 to /launch');
        srv.releaseEarlyUpgrade();
        assert.strictEqual(srv.listenerCount('upgrade'), 0, 'gone before the real listeners attach');
        const WS = require('ws');
        const wss = new WS.Server({ server: srv });
        const r2 = await dial();
        assert.strictEqual(r2.status, 101, 'the WebSocket server answers once attached');
        wss.close();
        await new Promise((r) => srv.close(() => r()));
        fs.rmSync(root, { recursive: true, force: true });
    }

    // ------------------------------------------------------------ W8: workbox modules
    {
        const aab = require('../modules/agentAssetBundle');
        const hdr = (url, session = {}) => {
            const h = {};
            aab.applyServedAssetCacheHeaders({ originalUrl: url, url, path: url.split('?')[0], query: /\?sha=/.test(url) ? { sha: 'x' } : {}, session }, { setHeader: (k, v) => { h[k] = v; }, removeHeader: (k) => { delete h[k]; } });
            return h['Cache-Control'];
        };
        assert.strictEqual(hdr('/dist/workbox/workbox-sw.js'), 'public, max-age=86400');
        assert.strictEqual(hdr('/dist/workbox/workbox-core.prod.js'), 'public, max-age=86400');
        assert.strictEqual(hdr('/dist/workbox/workbox-core.prod.js', { authenticated: true, devLogin: true }), 'public, max-age=86400', 'the agent tab too');
        assert.strictEqual(hdr('/dist/workbox/workbox-sw.js.map'), 'no-cache', 'only the scripts');
        assert.strictEqual(hdr('/scripts/comp/wmShell.js'), 'no-cache', 'other files unchanged');
        assert.strictEqual(hdr('/scripts/comp/wmShell.js?sha=abc'), 'public, max-age=31536000, immutable');
    }

    // ------------------------------------------------------------ W9: a phone's file list thumbnails
    {
        const { VfsManager } = require('../modules/vfsManager');
        const v = Object.create(VfsManager.prototype);
        const pic = { targetKind: 'image', previewImageFilename: 'abc_123.png' };
        assert.strictEqual(v.buildItemPreviewUrl(pic, 'u', { fit: true }), '/previews/abc_123%40fit.webp?wait=1');
        assert.strictEqual(v.buildItemPreviewUrl(pic, 'u'), '/images/abc_123.png', 'desktop pages keep the picture');
        assert.strictEqual(v.buildItemPreviewUrl(Object.assign({ galleryPreview: 'abc_123.webp' }, pic), 'u', { fit: true }), '/previews/abc_123.webp', 'a gallery preview wins');
        assert.strictEqual(v.buildItemPreviewUrl({ previewImageFilename: 'x.gif' }, 'u', { fit: true }), '/images/x.gif');
        assert.deepStrictEqual(v.enrichItemsWithPreviewUrls([pic], 'u', { fit: true }).map((i) => i.previewUrl), ['/previews/abc_123%40fit.webp?wait=1']);
        const pu = require('../modules/previewUtils');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-r5-'));
        fs.writeFileSync(path.join(dir, 'abc_123.png'), 'x');
        assert.strictEqual(path.basename((await pu.fitPreviewSource(dir, 'abc_123@fit.webp')).path), 'abc_123.png');
        assert.strictEqual(await pu.fitPreviewSource(dir, 'nope@fit.webp'), null);
        fs.rmSync(dir, { recursive: true, force: true });
    }

    console.log('ws phone round 5: ok');
}

main().then(() => process.exit(0), (e) => { console.log = console.info; console.error(e); process.exit(1); });
