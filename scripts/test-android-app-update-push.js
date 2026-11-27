#!/usr/bin/env node
// #821 part 2: modules/androidAppUpdatePush.js with stubbed activeSync, androidBuilds and transfer sender.
'use strict';
process.env.ANDROID_UPDATES_TEST_UNHELD = '1'; // the deliveries are held by default in the server

const assert = require('assert');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
// the held() path reads the coord settings and the test-device marks: both in a temp folder, never the live ones
const tmpDir = require('fs').mkdtempSync(path.join(os.tmpdir(), 'update-push-'));
process.env.AGENT_COORD_DB = path.join(tmpDir, 'coord.db');
process.on('exit', () => { try { require('fs').rmSync(tmpDir, { recursive: true, force: true }); } catch (_) { /* a temp folder */ } });
process.env.TEST_DEVICES_FILE = path.join(tmpDir, 'test-devices.json');
// the Fleet notice is stubbed: the real one tells the Supervisor and the inbox
const raised = [];
const fleetPath = require.resolve('../modules/fleetNotices');
require.cache[fleetPath] = { id: fleetPath, filename: fleetPath, loaded: true, exports: { routine: (kind, n) => { raised.push({ kind, n }); return { told: true, published: false }; } } };
const push = require('../modules/androidAppUpdatePush');
const testDevices = require('../modules/testDevices');

const tick = () => new Promise((r) => setImmediate(r));
async function settle() { for (let i = 0; i < 6; i += 1) await tick(); }

function world() {
    const rows = new Map();          // deviceId -> { app, name, platform }
    const online = new Map();        // deviceId -> 'partner' | 'pending' | undefined
    const deliveries = new Map();
    const reported = [];
    const sends = [];
    const calls = [];
    const taps = [];
    const evTaps = [];
    const log = [];
    const state = { updateAnswer: { state: 'staged', versionCode: 0 }, sendFails: false };
    const release = { id: 7, versionCode: 200, versionName: '1.0.200', sha: 'a'.repeat(40), sha256: 'b'.repeat(64), size: 1234, branches: [], commits: [], apkFile: '200-aaaaaaa.apk' };
    const builds = Object.assign(new EventEmitter(), {});
    const androidBuilds = {
        events: builds,
        latestRelease: () => release,
        releaseApkPath: (r) => `/data/android-builds/apk/${r.apkFile}`,
        recordDeviceVersion: (id, v) => reported.push({ id, ...v }),
        recordDelivery: (id, versionCode, st, detail) => { deliveries.set(id, { versionCode, state: st, at: Date.now(), detail }); log.push(`${id}:${versionCode}:${st}`); },
        deliveryOf: (id) => deliveries.get(id) || null,
        maxReportedVersionCode: () => 0,
        deviceVersionOf: (id) => { const r = reported.filter((x) => x.id === id).pop(); return r ? { versionCode: r.versionCode, versionName: r.versionName } : null; }
    };
    const as = {
        onDeviceHello: (fn) => taps.push(fn),
        onDeviceEvent: (fn) => evTaps.push(fn),
        deviceRow: (gr, id) => rows.get(id) || null,
        deviceOnline: (gr, ws, id) => online.get(id) || null,
        devicePermits: () => true,
        serverCall: async (gr, ws, id, op, args) => { calls.push({ id, op, args }); return { ...state.updateAnswer, versionCode: args.versionCode }; },
        list: () => ({ devices: [...rows.entries()].map(([deviceId, r]) => ({ deviceId, name: r.name || deviceId, app: r.app, platform: 'android', online: !!online.get(deviceId), test: false })) })
    };
    const sendFile = async (gr, id, file, opts) => {
        if (state.sendFails) throw Object.assign(new Error('phone said no'), { code: 'TIMEOUT' });
        sends.push({ id, file, opts });
        return `${'0'.repeat(31)}${sends.length}`;
    };
    return { rows, online, deliveries, reported, sends, calls, taps, evTaps, log, state, release, androidBuilds, as, sendFile };
}

const dev = 'aaaaaaaaaaaaaaaa';
const hello = (w, extra = {}) => w.taps[0]({ id: dev, speaker: 'service', session: 'partner', name: 'A53', test: false, ops: ['storage.list', 'stream.receive', 'apps.update'], ...extra });

(async () => {
    // parse
    assert.deepStrictEqual(push.parseApp('Dreamscape/1.0.3612345+3612345'), { versionName: '1.0.3612345', versionCode: 3612345 });
    assert.strictEqual(push.parseApp('Dreamscape/1.0').versionCode, 0);
    assert.strictEqual(push.parseApp('').versionCode, 0);

    // 1. an old app (no +code) gets nothing, and nothing is recorded as its version
    {
        push._test.resetForTests();
        const w = world();
        const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
        w.rows.set(dev, { app: 'Dreamscape/1.0' });
        w.online.set(dev, 'partner');
        hello(w); await settle();
        w.androidBuilds.events.emit('release', w.release); await settle();
        assert.strictEqual(w.sends.length, 0);
        assert.strictEqual(w.calls.length, 0);
        assert.strictEqual(w.reported.length, 0);
        h.stop();
        console.log('ok  old app (no +code): nothing sent');
    }

    // 2. a phone below the release: exactly one send + apps.update over two hellos and a release event
    {
        push._test.resetForTests();
        const w = world();
        const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
        w.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        w.online.set(dev, 'partner');
        hello(w); hello(w); await settle();
        w.androidBuilds.events.emit('release', w.release); await settle();
        hello(w); await settle();
        assert.strictEqual(w.sends.length, 1, 'one send');
        assert.strictEqual(w.sends[0].file, '/data/android-builds/apk/200-aaaaaaa.apk');
        assert.strictEqual(w.sends[0].opts.name, 'dsapp-200.apk');
        assert.strictEqual(w.sends[0].opts.temp, true);
        assert.strictEqual(w.calls.length, 1, 'one apps.update');
        assert.strictEqual(w.calls[0].op, 'apps.update');
        assert.deepStrictEqual(w.calls[0].args, { temp: '0'.repeat(31) + '1', name: 'dsapp-200.apk', versionCode: 200, versionName: '1.0.200', sha256: 'b'.repeat(64), size: 1234, buildId: 7, sha: 'a'.repeat(40) });
        assert.strictEqual(w.deliveries.get(dev).state, 'staged');
        assert.deepStrictEqual(w.reported[0], { id: dev, versionCode: 100, versionName: '1.0.100', name: 'A53' });
        console.log('ok  below the release: one send + apps.update after 3 hellos and a release event; log', w.log.join(' '));

        // 3. a hello at the new versionCode records installed, and nothing more is sent
        w.rows.set(dev, { app: 'Dreamscape/1.0.200+200' });
        hello(w); await settle();
        assert.strictEqual(w.deliveries.get(dev).state, 'installed');
        assert.strictEqual(w.sends.length, 1);
        console.log('ok  hello at the delivered versionCode: installed; log', w.log.join(' '));
        h.stop();
    }

    // 4. a failed delivery is retried at the next hello, not by a timer
    {
        push._test.resetForTests();
        const w = world();
        const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
        w.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        w.online.set(dev, 'partner');
        w.state.sendFails = true;
        hello(w); await settle();
        assert.strictEqual(w.deliveries.get(dev).state, 'failed');
        assert.ok(/TIMEOUT/.test(w.deliveries.get(dev).detail));
        assert.strictEqual(JSON.parse(w.deliveries.get(dev).detail).attempts, 1);
        await new Promise((r) => setTimeout(r, 60));          // no timer retries it
        await settle();
        assert.strictEqual(w.sends.length, 0);
        assert.strictEqual(w.calls.length, 0);
        w.state.sendFails = false;
        hello(w); await settle();
        assert.strictEqual(w.sends.length, 1);
        assert.strictEqual(w.deliveries.get(dev).state, 'staged');
        // a non-staged answer from the phone is a failed delivery too
        const w2 = world();
        push._test.resetForTests();
        push.start({}, { activeSync: w2.as, androidBuilds: w2.androidBuilds, sendFile: w2.sendFile });
        w2.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        w2.online.set(dev, 'partner');
        w2.state.updateAnswer = { state: 'bad_apk' };
        hello(w2); await settle();
        assert.strictEqual(w2.deliveries.get(dev).state, 'failed');
        assert.ok(/bad_apk/.test(w2.deliveries.get(dev).detail));
        console.log('ok  failed delivery: no timer retry, retried once at the next hello; bad_apk answer is failed');
        h.stop();
    }

    // 5. conditions: offline, pending, no apps.update in the service's ops, page-only hello, release for online phones only
    {
        push._test.resetForTests();
        const w = world();
        const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
        w.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        w.online.set(dev, 'partner');
        hello(w, { ops: ['storage.list'] }); await settle();
        hello(w, { speaker: 'webview', ops: ['apps.update'] }); await settle();
        assert.strictEqual(w.sends.length, 0, 'no apps.update from the service: no push');
        w.online.set(dev, 'pending');
        hello(w); await settle();
        assert.strictEqual(w.sends.length, 0, 'pending: no push');
        w.online.set(dev, 'partner');
        w.online.set('bbbbbbbbbbbbbbbb', undefined);
        w.rows.set('bbbbbbbbbbbbbbbb', { app: 'Dreamscape/1.0.100+100' });
        w.androidBuilds.events.emit('release', w.release); await settle();
        assert.strictEqual(w.sends.length, 1, 'release: only the online phone that said apps.update');
        assert.strictEqual(w.sends[0].id, dev);
        const snap = push.deliveriesSnapshot();
        assert.strictEqual(snap.length, 1);
        assert.strictEqual(snap[0].state, 'staged');
        assert.strictEqual(snap[0].reportedVersionCode, 100);
        console.log('ok  conditions (ops, pending, offline) and deliveriesSnapshot');
        h.stop();
    }
    // 6. sendServerFile: the transfers folder holds a committed description the data route can load while stream.receive runs
    {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const realAs = require('../modules/activeSync');
        const transfers = require('../modules/activeSyncTransfers');
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apkpush-'));
        const apk = path.join(tmp, 'x.apk');
        fs.writeFileSync(apk, Buffer.from('PK-fake-apk'));
        const gr = { getPath: () => tmp };
        transfers.resetForTests();
        const realCall = realAs.serverCall;
        let seen = null;
        realAs.serverCall = async (g, ws, id, op, args, opts) => {
            const meta = await transfers._test.loadMeta(gr, args.transferId);
            seen = { id, op, args, meta: meta && { ...meta }, bytes: fs.readFileSync(path.join(tmp, 'activesync-transfers', args.transferId), 'utf8'), timeoutMs: opts.timeoutMs };
            return { path: '/x' };
        };
        try {
            const tid = await push.sendServerFile(gr, dev, apk, { name: 'dsapp-200.apk', temp: true });
            assert.strictEqual(seen.op, 'stream.receive');
            assert.strictEqual(seen.args.transferId, tid);
            assert.strictEqual(seen.args.temp, true);
            assert.strictEqual(seen.args.conflict, 'replace');
            assert.strictEqual(seen.args.name, 'dsapp-200.apk');
            assert.strictEqual(seen.args.size, 11);
            assert.strictEqual(seen.bytes, 'PK-fake-apk');
            assert.ok(seen.meta && seen.meta.committed && seen.meta.deviceId === dev && seen.meta.size === 11);
            assert.deepStrictEqual(fs.readdirSync(path.join(tmp, 'activesync-transfers')), [], 'server copy removed after the phone confirmed');
            assert.ok(fs.existsSync(apk), 'the release file itself is untouched');
            assert.strictEqual(transfers._test.metas.has(tid), false);
            // a refused call leaves nothing behind either
            realAs.serverCall = async () => { throw Object.assign(new Error('offline'), { code: 'OFFLINE' }); };
            await assert.rejects(() => push.sendServerFile(gr, dev, apk, { name: 'dsapp-200.apk' }), /offline/);
            assert.deepStrictEqual(fs.readdirSync(path.join(tmp, 'activesync-transfers')), []);
            console.log('ok  sendServerFile: committed description loadable by the data route, cleaned up on success and failure');
        } finally {
            realAs.serverCall = realCall;
            transfers.resetForTests();
            fs.rmSync(tmp, { recursive: true, force: true });
        }
    }
    // 7. the cap: 3 attempts per versionCode (a restart-cut 'sending' counts), then gaveUp and never again; a new release starts again
    {
        push._test.resetForTests();
        const w = world();
        const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
        w.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        w.online.set(dev, 'partner');
        w.state.sendFails = true;
        // attempt 1 was cut by a restart: only its 'sending' record remains
        w.deliveries.set(dev, { versionCode: 200, state: 'sending', at: 0, detail: JSON.stringify({ attempts: 1, info: 'build 7' }) });
        hello(w); await settle();                                   // attempt 2
        assert.strictEqual(JSON.parse(w.deliveries.get(dev).detail).attempts, 2);
        assert.strictEqual(w.deliveries.get(dev).state, 'failed');
        assert.ok(!JSON.parse(w.deliveries.get(dev).detail).gaveUp);
        hello(w); await settle();                                   // attempt 3: gives up
        const d3 = JSON.parse(w.deliveries.get(dev).detail);
        assert.strictEqual(w.deliveries.get(dev).state, 'failed');
        assert.strictEqual(d3.attempts, 3);
        assert.strictEqual(d3.gaveUp, true);
        // no more tries for this versionCode: not at a hello, not at the same release again, even when the phone could take it
        w.state.sendFails = false;
        const logBefore = w.log.length;
        hello(w); hello(w); await settle();
        w.androidBuilds.events.emit('release', w.release); await settle();
        assert.strictEqual(w.sends.length, 0);
        assert.strictEqual(w.calls.length, 0);
        assert.strictEqual(w.log.length, logBefore, 'nothing recorded either');
        assert.strictEqual(w.deliveries.get(dev).state, 'failed');
        // a new release starts again
        w.release.versionCode = 201; w.release.apkFile = '201-bbbbbbb.apk';
        w.androidBuilds.events.emit('release', w.release); await settle();
        assert.strictEqual(w.sends.length, 1);
        assert.strictEqual(w.deliveries.get(dev).versionCode, 201);
        assert.strictEqual(w.deliveries.get(dev).state, 'staged');
        assert.strictEqual(JSON.parse(w.deliveries.get(dev).detail).attempts, 1);
        // a stale 3rd 'sending' (cut by a restart) is given up too, without another send
        const w2 = world();
        push._test.resetForTests();
        push.start({}, { activeSync: w2.as, androidBuilds: w2.androidBuilds, sendFile: w2.sendFile });
        w2.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        w2.online.set(dev, 'partner');
        w2.deliveries.set(dev, { versionCode: 200, state: 'sending', at: 0, detail: JSON.stringify({ attempts: 3, info: 'build 7' }) });
        hello(w2); await settle();
        assert.strictEqual(w2.sends.length, 0);
        assert.strictEqual(JSON.parse(w2.deliveries.get(dev).detail).gaveUp, true);
        console.log('ok  cap: 3 attempts per versionCode (restart-cut counts), gaveUp, never again; a new release starts again');
        h.stop();
    }
    // the page's hello overwrites the row's app string with plain "Dreamscape": a release built after it still
    // finds the version the background service reported
    {
        push._test.resetForTests();
        const w = world();
        let latest = null;
        w.androidBuilds.latestRelease = () => latest;
        push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
        w.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        w.online.set(dev, 'partner');
        hello(w); await settle();
        w.rows.set(dev, { app: 'Dreamscape' });
        hello(w, { speaker: 'page', ops: [] }); await settle();
        assert.strictEqual(w.sends.length, 0, 'nothing before a release');
        latest = w.release;
        w.androidBuilds.events.emit('release', w.release); await settle();
        assert.strictEqual(w.sends.length, 1, 'the release reaches the phone whose page spoke last');
        assert.strictEqual(w.deliveries.get(dev).state, 'staged');
        console.log('ok  page hello last: the release still goes by the service-reported version');
    }

    // 9. held (the default in the server): a real phone gets nothing, a marked test device gets the real delivery path (#1309)
    {
        delete process.env.ANDROID_UPDATES_TEST_UNHELD;
        try {
            push._test.resetForTests();
            const w = world();
            const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
            const lane = 'c'.repeat(32);
            testDevices.mark(lane, { name: 'aemu-fold-1' });
            for (const id of [dev, lane]) { w.rows.set(id, { app: 'Dreamscape/1.0.100+100', name: id }); w.online.set(id, 'partner'); }
            w.taps[0]({ id: dev, speaker: 'service', session: 'partner', name: 'A53', test: false, ops: ['apps.update', 'stream.receive'] });
            w.taps[0]({ id: lane, speaker: 'service', session: 'partner', name: 'lane', test: true, ops: ['apps.update', 'stream.receive'] });
            await settle();
            w.androidBuilds.events.emit('release', w.release); await settle();
            assert.deepStrictEqual(w.sends.map((x) => x.id), [lane], 'held: only the test device is delivered to');
            assert.strictEqual(w.deliveries.get(lane).state, 'staged');
            assert.strictEqual(w.deliveries.has(dev), false, 'a real phone: nothing recorded, nothing sent');
            h.stop();
        } finally { process.env.ANDROID_UPDATES_TEST_UNHELD = '1'; }
        console.log('ok  hold: a real phone gets nothing, a marked test device is delivered to');
    }

    // 10. the app's report that its staged update waits: delivery 'waiting' + why, ONE quiet Fleet notice per phone + versionCode + why
    {
        push._test.resetForTests();
        raised.length = 0;
        const w = world();
        const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
        const other = 'dddddddddddddddd';
        for (const id of [dev, other]) { w.rows.set(id, { app: 'Dreamscape/1.0.100+100', name: id === dev ? 'A53 Test' : 'Other' }); w.online.set(id, 'partner'); }
        hello(w); await settle();
        assert.strictEqual(w.deliveries.get(dev).state, 'staged');
        const sends = w.sends.length;
        const tap = w.evTaps[0];
        const report = (why, extra = {}) => tap('apps.updateWaiting', { package: 'jp.net.seventhreeseven.dreamscape', versionCode: 200, versionName: '1.0.200', state: 'waiting', why, tries: 0, ...extra }, { id: dev });
        report('Shizuku is not running or does not allow Dreamscape; local ADB (port 5555) is not listening');
        let d = w.deliveries.get(dev);
        assert.strictEqual(d.state, 'waiting');
        assert.strictEqual(d.versionCode, 200);
        assert.strictEqual(JSON.parse(d.detail).why, 'Shizuku is not running or does not allow Dreamscape; local ADB (port 5555) is not listening');
        assert.strictEqual(JSON.parse(d.detail).attempts, 1, 'the delivery attempts stay');
        assert.strictEqual(raised.length, 1);
        assert.strictEqual(raised[0].kind, 'appUpdate');
        assert.strictEqual(raised[0].n.alert, false, 'no sound');
        assert.strictEqual(raised[0].n.id, `app-update-waiting:${dev}:200`);
        assert.strictEqual(raised[0].n.data.kind, 'app-update-waiting');
        assert.strictEqual(raised[0].n.data.page, 'devices', 'a click target');
        assert.ok(/A53 Test/.test(raised[0].n.title) && /1\.0\.200/.test(raised[0].n.title));
        // the app repeats the report when its link returns: the same why is not told again
        report('Shizuku is not running or does not allow Dreamscape; local ADB (port 5555) is not listening');
        report('Shizuku is not running or does not allow Dreamscape; local ADB (port 5555) is not listening');
        assert.strictEqual(raised.length, 1, 'once per phone + versionCode + why');
        // another reason is another wait
        report('Shizuku and local ADB could not install it');
        assert.strictEqual(raised.length, 2);
        // another phone has its own
        tap('apps.updateWaiting', { package: 'jp.net.seventhreeseven.dreamscape', versionCode: 200, state: 'waiting', why: 'x' }, { id: other });
        assert.strictEqual(raised.length, 3);
        // not the app's own package, not a wait, no reason, a phone already at that version: nothing
        report('y', { package: 'com.other' });
        report('y', { state: 'installing' });
        report('', {});
        w.rows.set(dev, { app: 'Dreamscape/1.0.200+200' });
        report('late');
        assert.strictEqual(raised.length, 3);
        // a waiting delivery is left alone by hello and release (nothing sent again), and the phone's hello at the version is installed
        w.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        hello(w); w.androidBuilds.events.emit('release', w.release); await settle();
        assert.strictEqual(w.sends.length, sends, 'waiting: not delivered again');
        w.rows.set(dev, { app: 'Dreamscape/1.0.200+200' });
        hello(w); await settle();
        assert.strictEqual(w.deliveries.get(dev).state, 'installed');
        h.stop();
        console.log('ok  waiting: delivery waiting + why, one Fleet notice per phone + versionCode + why (silent, click target), left alone, installed at the hello');
    }
    // 11-16: apps.updateWaiting 'resend' (#1332): the newer app keeps no APK, so the server sends it again
    const OWN = 'jp.net.seventhreeseven.dreamscape';
    const tellApp = (w, versionCode, state, why = '', extra = {}) => w.evTaps[0]('apps.updateWaiting', { package: OWN, versionCode, versionName: `1.0.${versionCode}`, state, why, tries: 0, ...extra }, { id: dev });
    const resend = (w, versionCode = 200, extra = {}) => tellApp(w, versionCode, 'resend', '', extra);
    const detail = (w) => JSON.parse(w.deliveries.get(dev).detail);
    /** A phone at 100 whose delivery of 200 is staged; the store cuts a detail at 300 characters like androidBuilds. */
    async function behind({ greet = true } = {}) {
        push._test.resetForTests();
        raised.length = 0;
        const w = world();
        const store = w.androidBuilds.recordDelivery;
        w.androidBuilds.recordDelivery = (id, code, st, text) => store(id, code, st, String(text).slice(0, 300));
        const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile });
        w.rows.set(dev, { app: 'Dreamscape/1.0.100+100', name: 'A53' });
        w.online.set(dev, 'partner');
        if (greet) { hello(w); await settle(); }
        return { w, h };
    }

    // 11. accepted from 'waiting' and from 'staged': sent once each, counted in every later record, no Fleet notice
    {
        const { w, h } = await behind();
        tellApp(w, 200, 'waiting', 'Shizuku is not running');
        assert.strictEqual(raised.length, 1);
        w.log.length = 0;
        resend(w); await settle();
        assert.strictEqual(w.sends.length, 2, 're-sent once');
        assert.strictEqual(w.calls.length, 2);
        assert.deepStrictEqual(w.log, [`${dev}:200:failed`, `${dev}:200:sending`, `${dev}:200:staged`]);
        assert.strictEqual(detail(w).resends, 1);
        assert.strictEqual(detail(w).attempts, 1, 'attempts start again');
        assert.strictEqual(raised.length, 1, 'no Fleet notice for a resend');
        hello(w); w.androidBuilds.events.emit('release', w.release); await settle();
        assert.strictEqual(w.sends.length, 2, 'staged again: hello and release send nothing');
        tellApp(w, 200, 'waiting', 'Shizuku is not running'); await settle();
        assert.strictEqual(detail(w).resends, 1, 'the waiting record keeps the count');
        assert.strictEqual(detail(w).attempts, 1);
        resend(w); await settle();
        assert.strictEqual(w.sends.length, 3);
        assert.strictEqual(detail(w).resends, 2);
        // gave up after failed attempts: a resend starts them again, the failed records keep the count
        w.state.sendFails = true;
        resend(w); await settle();
        hello(w); await settle(); hello(w); await settle();
        assert.strictEqual(detail(w).gaveUp, true);
        assert.strictEqual(detail(w).resends, 3);
        w.state.sendFails = false;
        resend(w); await settle();
        assert.strictEqual(w.deliveries.get(dev).state, 'staged');
        assert.strictEqual(detail(w).resends, 4);
        assert.ok(!detail(w).gaveUp);
        // the installed record keeps it too, and then a resend is ignored (phone at the version)
        w.rows.set(dev, { app: 'Dreamscape/1.0.200+200' });
        hello(w); await settle();
        assert.strictEqual(w.deliveries.get(dev).state, 'installed');
        assert.strictEqual(detail(w).resends, 4);
        const before = w.log.length;
        resend(w); await settle();
        assert.strictEqual(w.log.length, before, 'phone already at the version: ignored');
        // ... and 'installed' alone is enough, whatever version the phone says
        w.rows.set(dev, { app: 'Dreamscape/1.0.100+100' });
        w.reported.length = 0;
        resend(w); await settle();
        assert.strictEqual(w.log.length, before, 'installed delivery: ignored');
        h.stop();
        console.log('ok  resend: accepted and re-sent once, attempts start again, count kept in every record, ignored when installed, no notice');
    }

    // 12. capped at 6 per phone + versionCode, logged once; another package or a bad code is nothing
    {
        const { w, h } = await behind();
        const warned = [];
        const warn = console.warn;
        console.warn = (m) => warned.push(String(m));
        try {
            for (const [code, extra] of [[200, { package: 'com.other' }], [0, {}], [-1, {}], [200, { state: 'again' }]]) resend(w, code, extra);
            await settle();
            assert.strictEqual(w.sends.length, 1, 'validation');
            for (let i = 0; i < 6; i += 1) { resend(w); await settle(); }
            assert.strictEqual(w.sends.length, 7);
            assert.strictEqual(detail(w).resends, 6);
            const before = w.log.length;
            resend(w); await settle(); resend(w); await settle(); resend(w); await settle();
            assert.strictEqual(w.sends.length, 7, 'the 7th and later: ignored');
            assert.strictEqual(w.log.length, before, 'nothing recorded');
            assert.strictEqual(warned.filter((m) => /asked for 200 again/.test(m)).length, 1, 'logged once');
        } finally { console.warn = warn; }
        // a new release has its own count
        Object.assign(w.release, { versionCode: 201, apkFile: '201-bbbbbbb.apk' });
        w.androidBuilds.events.emit('release', w.release); await settle();
        resend(w, 201); await settle();
        assert.strictEqual(detail(w).resends, 1);
        assert.strictEqual(w.sends.length, 9);
        assert.strictEqual(raised.length, 0);
        h.stop();
        console.log('ok  resend: capped at 6 per phone + versionCode (logged once), validated like waiting, a new release counts anew');
    }

    // 13. ignored while 'sending'; hold, offline, pending, permissions and the missing op are still gates
    {
        const { w, h } = await behind({ greet: false });
        let answer;
        w.as.serverCall = (gr, ws, id, op, args) => { w.calls.push({ id, op, args }); return new Promise((r) => { answer = r; }); };
        hello(w); await settle();
        assert.strictEqual(w.deliveries.get(dev).state, 'sending');
        const before = w.log.length;
        resend(w); await settle();
        assert.strictEqual(w.log.length, before, 'sending: ignored');
        answer({ state: 'staged' }); await settle();
        assert.strictEqual(w.deliveries.get(dev).state, 'staged');
        assert.strictEqual(w.sends.length, 1, 'and nothing is sent after it');
        w.as.serverCall = async (gr, ws, id, op, args) => { w.calls.push({ id, op, args }); return { state: 'staged' }; };

        delete process.env.ANDROID_UPDATES_TEST_UNHELD;
        try { resend(w); await settle(); } finally { process.env.ANDROID_UPDATES_TEST_UNHELD = '1'; }
        assert.strictEqual(w.sends.length, 1, 'held: nothing sent');
        assert.strictEqual(w.deliveries.get(dev).state, 'failed');
        assert.strictEqual(detail(w).attempts, 0);
        assert.strictEqual(detail(w).resends, 1);
        assert.ok(/asked again/.test(detail(w).info));
        hello(w); await settle();                                  // the hold is over: the next hello sends it
        assert.strictEqual(w.sends.length, 2);
        assert.strictEqual(detail(w).attempts, 1);
        assert.strictEqual(detail(w).resends, 1);

        for (const [close, open] of [
            [() => w.online.set(dev, undefined), () => w.online.set(dev, 'partner')],
            [() => w.online.set(dev, 'pending'), () => w.online.set(dev, 'partner')],
            [() => { w.as.devicePermits = () => false; }, () => { w.as.devicePermits = () => true; }]
        ]) {
            const n = w.sends.length;
            close(); resend(w); await settle();
            assert.strictEqual(w.sends.length, n, 'gated');
            assert.strictEqual(w.deliveries.get(dev).state, 'failed');
            open(); hello(w); await settle();
            assert.strictEqual(w.sends.length, n + 1, 'sent at the next hello');
        }
        hello(w, { ops: ['storage.list'] }); await settle();
        const n = w.sends.length;
        resend(w); await settle();
        assert.strictEqual(w.sends.length, n, 'no apps.update in the service ops');
        assert.strictEqual(raised.length, 0);
        h.stop();
        console.log('ok  resend: ignored while sending; hold, offline, pending, permissions and ops still gate it (sent at a later hello)');
    }

    // 14. another versionCode than the latest, and no prior record (the server lost its data)
    {
        // older than the latest, its record still the phone's: the latest is sent
        let { w, h } = await behind();
        tellApp(w, 200, 'waiting', 'x');
        assert.strictEqual(raised.length, 1);
        Object.assign(w.release, { versionCode: 201, apkFile: '201-bbbbbbb.apk' });
        w.log.length = 0;
        resend(w, 200); await settle();
        assert.strictEqual(raised.length, 1, 'no notice for the resend');
        assert.deepStrictEqual(w.log, [`${dev}:200:failed`, `${dev}:201:sending`, `${dev}:201:staged`]);
        assert.strictEqual(w.calls[w.calls.length - 1].args.versionCode, 201);
        assert.ok(!detail(w).resends);
        // then the older one again: the newer record stands, nothing happens
        let sends = w.sends.length;
        w.log.length = 0;
        resend(w, 200); await settle();
        assert.strictEqual(w.sends.length, sends);
        assert.strictEqual(w.log.length, 0);
        // the newer one 'failed': tried again within its own attempts, which an old resend never resets
        w.state.sendFails = true;
        resend(w, 201); await settle();
        resend(w, 200); await settle(); resend(w, 200); await settle();
        assert.strictEqual(detail(w).attempts, 3);
        assert.strictEqual(detail(w).resends, 1);
        const records = w.log.length;
        resend(w, 200); await settle(); resend(w, 150); await settle(); resend(w, 300); await settle();
        assert.strictEqual(w.log.length, records, 'gave up: another versionCode changes nothing');
        h.stop();
        // no record at all
        for (const code of [200, 150]) {
            ({ w, h } = await behind());
            w.deliveries.clear();                                   // the server lost what it had delivered
            w.sends.length = 0;
            w.log.length = 0;
            resend(w, code); await settle();
            assert.strictEqual(w.sends.length, 1, `no record, resend ${code}: the latest is sent`);
            assert.strictEqual(w.calls[w.calls.length - 1].args.versionCode, 200);
            assert.strictEqual(w.log[0], `${dev}:${code}:failed`);
            assert.strictEqual(w.deliveries.get(dev).state, 'staged');
            assert.strictEqual(detail(w).resends, code === 200 ? 1 : undefined);
            h.stop();
        }
        // no record and no release known: remembered, nothing sent, nothing thrown
        ({ w, h } = await behind({ greet: false }));
        w.androidBuilds.latestRelease = () => null;
        resend(w, 200); await settle();
        assert.strictEqual(w.sends.length, 0);
        assert.strictEqual(w.deliveries.get(dev).state, 'failed');
        h.stop();
        console.log('ok  resend: older than the latest sends the latest; a newer or latest record is not rewritten; no prior record handled');
    }

    // 15. the app reports while apps.update is being answered: 'staged' (or an error) does not overwrite its word
    {
        for (const ending of ['staged', 'error']) {
            const { w, h } = await behind({ greet: false });
            const plain = w.as.serverCall;
            w.as.serverCall = async (...a) => {
                const got = await plain(...a);
                tellApp(w, 200, 'waiting', 'every silent route failed');
                if (ending === 'error') throw Object.assign(new Error('gone'), { code: 'TIMEOUT' });
                return got;
            };
            hello(w); await settle();
            assert.strictEqual(w.deliveries.get(dev).state, 'waiting', ending);
            assert.strictEqual(detail(w).why, 'every silent route failed');
            assert.strictEqual(detail(w).attempts, 1);
            assert.strictEqual(raised.length, 1);
            // a 'waiting' left from that earlier round does not stop the next round's 'staged'
            w.as.serverCall = plain;
            resend(w); await settle();
            assert.strictEqual(w.deliveries.get(dev).state, 'staged');
            h.stop();
        }
        {
            const { w, h } = await behind({ greet: false });
            w.deliveries.set(dev, { versionCode: 199, state: 'waiting', at: 0, detail: JSON.stringify({ attempts: 1, why: 'old' }) });
            hello(w); await settle();
            assert.strictEqual(w.deliveries.get(dev).state, 'staged', 'an earlier round\'s waiting');
            h.stop();
        }
        // waiting AND resend before the answer: the resend is not lost, it is sent again when the round ends
        const { w, h } = await behind({ greet: false });
        const plain = w.as.serverCall;
        let first = true;
        w.as.serverCall = async (...a) => {
            const got = await plain(...a);
            if (first) {
                first = false;
                tellApp(w, 200, 'waiting', 'route lost');
                resend(w);
                assert.strictEqual(w.sends.length, 1, 'one at a time');
            }
            return got;
        };
        hello(w); await settle(); await settle();
        assert.strictEqual(w.sends.length, 2, 'sent again after the running delivery');
        assert.deepStrictEqual(w.log, [`${dev}:200:sending`, `${dev}:200:waiting`, `${dev}:200:failed`, `${dev}:200:sending`, `${dev}:200:staged`]);
        assert.strictEqual(detail(w).resends, 1);
        assert.strictEqual(detail(w).attempts, 1);
        h.stop();
        console.log('ok  while apps.update is answered: waiting is not overwritten (also on error); an earlier waiting does not count; a resend then is sent after');
    }

    // 16. the detail always fits the 300 characters androidBuilds keeps, so the counts survive any text
    {
        const { w, h } = await behind({ greet: false });
        const nasty = '"\\\u0001'.repeat(100);
        w.state.updateAnswer = { state: 'bad_apk', error: nasty };
        hello(w); await settle();
        assert.ok(w.deliveries.get(dev).detail.length <= 300);
        assert.strictEqual(detail(w).attempts, 1);
        resend(w); await settle();
        assert.strictEqual(detail(w).resends, 1);
        tellApp(w, 200, 'waiting', nasty);
        assert.ok(w.deliveries.get(dev).detail.length <= 300);
        assert.strictEqual(detail(w).resends, 1);
        const told = raised.length;
        const records = w.log.length;
        tellApp(w, 200, 'waiting', nasty);
        assert.strictEqual(raised.length, told);
        assert.strictEqual(w.log.length, records, 'the same shortened why is the same report');
        h.stop();
        console.log('ok  detail: at most 300 characters whatever the text, counts kept');
    }

    // 17. the accepted mark (#1371): the setting is injected (deps.getSetting), the hold is the setting's own (the env switch is off)
    {
        const lane = 'c'.repeat(32);
        const A = 'a1a1a1a1a1a1a1a1';        // a household phone one build below the mark
        const B = 'b2b2b2b2b2b2b2b2';        // a household phone at the mark
        const C = 'e5e5e5e5e5e5e5e5';        // a household phone far behind
        const rel = (code, kept = true) => ({ id: code, versionCode: code, versionName: `1.0.${code}`, sha: String(code).padStart(40, 'a'), sha256: 'b'.repeat(64), size: 1234, branches: [], commits: [], apkFile: `${code}-aaaaaaa.apk`, kept });
        /** A world whose releases are 198, 199, 200 (N) and 201 (N+1, the latest); the setting is the caller's. */
        async function marked(setting, { phones = { [A]: 199, [B]: 200, [lane]: 100 }, greet = true } = {}) {
            push._test.resetForTests();
            const w = world();
            w.setting = setting;
            w.releases = [rel(198), rel(199), rel(200), rel(201)];
            w.androidBuilds.latestRelease = () => w.releases[w.releases.length - 1];
            w.androidBuilds.newestReleaseUpTo = (n) => w.releases.filter((r) => r.versionCode <= n && r.kept).sort((x, y) => y.versionCode - x.versionCode)[0] || null;
            const h = push.start({}, { activeSync: w.as, androidBuilds: w.androidBuilds, sendFile: w.sendFile, getSetting: (key) => { if (w.setting instanceof Error) throw w.setting; return key === 'androidUpdates' ? w.setting : null; } });
            for (const [id, code] of Object.entries(phones)) { w.rows.set(id, { app: `Dreamscape/1.0.${code}+${code}`, name: id }); w.online.set(id, 'partner'); }
            w.helloOf = (id) => w.taps[0]({ id, speaker: 'service', session: 'partner', name: id, test: false, ops: ['apps.update', 'stream.receive'] });
            if (greet) { for (const id of Object.keys(phones)) w.helloOf(id); await settle(); }
            return { w, h };
        }
        const sentTo = (w) => Object.fromEntries(w.calls.map((c) => [c.id, c.args.versionCode]));
        const ownApp = (w, id, versionCode, state) => w.evTaps[0]('apps.updateWaiting', { package: OWN, versionCode, versionName: `1.0.${versionCode}`, state, why: '', tries: 0 }, { id });
        delete process.env.ANDROID_UPDATES_TEST_UNHELD;
        try {
            testDevices.mark(lane, { name: 'aemu-fold-1' });

            // (a) hold false, no accepted: the latest release, as before the mark existed
            {
                const { w, h } = await marked({ hold: false });
                assert.deepStrictEqual(sentTo(w), { [A]: 201, [B]: 201, [lane]: 201 }, 'no mark: everybody gets the latest');
                h.stop();
            }

            // (b) accepted 200 while the latest is 201
            {
                const { w, h } = await marked({ hold: false, accepted: 200 });
                assert.deepStrictEqual(sentTo(w), { [A]: 200, [lane]: 201 }, 'N-1 gets N, N gets nothing, the lane device gets the latest');
                assert.strictEqual(w.deliveries.get(A).state, 'staged');
                assert.strictEqual(w.deliveries.get(A).versionCode, 200);
                assert.strictEqual(w.deliveries.has(B), false, 'a phone at the mark: nothing recorded');
                assert.strictEqual(w.sends.length, 2);
                assert.ok(w.sends.find((x) => x.id === A).file.endsWith('200-aaaaaaa.apk'), 'the APK of the accepted release');
                // a release event and a hello change nothing: the household phones are never offered 201
                w.releases.push(rel(202));
                w.androidBuilds.events.emit('release', w.releases[w.releases.length - 1]); await settle();
                for (const id of [A, B]) w.helloOf(id);
                await settle();
                assert.deepStrictEqual(sentTo(w), { [A]: 200, [lane]: 202 }, 'a new release: the lane device takes it, the household phones stay at the mark');
                assert.strictEqual(w.deliveries.has(B), false);
                // an offer with the same mark changes nothing
                const n = w.sends.length;
                w.androidBuilds.events.emit('offer'); await settle();
                assert.strictEqual(w.sends.length, n, 'the same mark offered again: nothing new');

                // (c) the mark raised to 201 and an offer: the phone at 200 is offered 201 now, with no hello and no release
                w.setting = { hold: false, accepted: 201 };
                w.androidBuilds.events.emit('offer'); await settle();
                assert.strictEqual(w.calls.filter((c) => c.id === B).length, 1);
                assert.strictEqual(w.calls.filter((c) => c.id === B)[0].args.versionCode, 201, 'N is offered N+1 after the mark was raised');
                assert.strictEqual(w.calls.filter((c) => c.id === A).pop().args.versionCode, 201, 'N-1 too, its delivery of 200 is staged: a new versionCode');
                assert.ok(w.calls.every((c) => c.id === lane || c.args.versionCode <= 201));
                h.stop();
            }

            // (d) a resend from a phone never yields a release above the mark
            {
                const { w, h } = await marked({ hold: false, accepted: 200 }, { phones: { [A]: 199, [C]: 150 } });
                assert.deepStrictEqual(sentTo(w), { [A]: 200, [C]: 200 });
                // the record is of the release the phone is offered (not the latest, 201): another versionCode's resend does not rewrite it
                ownApp(w, A, 250, 'resend'); await settle();
                assert.deepStrictEqual([w.deliveries.get(A).versionCode, w.deliveries.get(A).state], [200, 'staged'], 'the offered release\'s record stands');
                assert.strictEqual(w.calls.length, 2, 'and nothing is sent');
                // consider() itself refuses a release above the mark, whoever hands it over
                assert.strictEqual(await push._test.consider(C, w.releases[3]), null);
                assert.strictEqual(w.calls.length, 2, 'consider(201) sent nothing');
                // it lost the file of 200: asked again, sent 200 again
                ownApp(w, A, 200, 'resend'); await settle();
                assert.strictEqual(w.calls.filter((c) => c.id === A).length, 2);
                // it names a versionCode above the mark (a delivery from before the mark; the record is rewritten by the resend)
                for (const code of [201, 202, 300]) { ownApp(w, A, code, 'resend'); ownApp(w, C, code, 'resend'); await settle(); }
                // a record of a newer release than the offered one, and the same resend
                w.deliveries.set(C, { versionCode: 201, state: 'failed', at: 0, detail: JSON.stringify({ attempts: 1, info: 'x' }) });
                ownApp(w, C, 150, 'resend'); await settle();
                ownApp(w, C, 201, 'resend'); await settle();
                assert.ok(w.calls.length >= 3);
                assert.ok(w.calls.every((c) => c.args.versionCode <= 200), `a resend sent a release above the mark: ${JSON.stringify(sentTo(w))}`);
                assert.ok(w.sends.every((x) => !/^20[1-9]|^2[1-9]\d|^[3-9]\d\d/.test(path.basename(x.file))), 'no APK above the mark left the server');
                // the mark raised: the resend is the new mark's release
                w.setting = { hold: false, accepted: 201 };
                ownApp(w, A, 200, 'resend'); await settle();
                assert.strictEqual(w.calls[w.calls.length - 1].args.versionCode, 201);
                h.stop();
            }

            // (e) a mark below every release: nothing is offered by any path, and a bad mark is no mark at all (nothing)
            for (const accepted of [100, 0, -5, 'soon', false, NaN]) {
                const { w, h } = await marked({ hold: false, accepted }, { phones: { [A]: 50, [lane]: 50 } });
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 }, `accepted ${String(accepted)}: only the lane device`);
                w.androidBuilds.events.emit('release', w.releases[3]); w.androidBuilds.events.emit('offer'); await settle();
                ownApp(w, A, 198, 'resend'); await settle();
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 });
                h.stop();
            }

            // (f) hold true with accepted set: nothing for a household phone, whatever the mark; the lane is never held
            {
                const { w, h } = await marked({ hold: true, accepted: 200 });
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 });
                w.androidBuilds.events.emit('release', w.releases[3]); w.androidBuilds.events.emit('offer'); await settle();
                ownApp(w, A, 199, 'resend'); await settle();
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 });
                h.stop();
            }
            // an unreadable setting: held, so nothing, and the mark logic never offers on a failure either
            {
                const { w, h } = await marked(new Error('db gone'));
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 });
                w.androidBuilds.events.emit('offer'); await settle();
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 });
                h.stop();
            }
            // an unset setting stays held (the default)
            {
                const { w, h } = await marked(null);
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 });
                h.stop();
            }

            // the accepted release's APK is gone: nothing, never an older release in its place (199 was not accepted)
            {
                const { w, h } = await marked({ hold: false, accepted: 200 }, { greet: false });
                w.releases[2].kept = false;                      // 200's APK was pruned
                for (const id of [A, B, lane]) w.helloOf(id);
                await settle();
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 }, 'only the lane device');
                w.rows.set(C, { app: 'Dreamscape/1.0.150+150', name: C }); w.online.set(C, 'partner');
                w.helloOf(C); await settle();
                w.androidBuilds.events.emit('offer'); await settle();
                ownApp(w, C, 199, 'resend'); await settle();
                assert.strictEqual(w.calls.filter((c) => c.id === C).length, 0, 'a phone far behind is not offered 199 or 198');
                assert.strictEqual(w.calls.filter((c) => c.id === A).length, 0);
                assert.strictEqual(w.calls.filter((c) => c.id === B).length, 0);
                h.stop();
            }
            // a mark that names no release (between 199 and 200 there is none; 199 exists below it): nothing
            {
                const { w, h } = await marked({ hold: false, accepted: 199.5 }, { phones: { [C]: 150, [lane]: 100 } });
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 });
                w.setting = { hold: false, accepted: 205 };      // above every release: no release has that versionCode
                w.androidBuilds.events.emit('offer'); await settle();
                assert.deepStrictEqual(sentTo(w), { [lane]: 201 }, 'a mark that is not a release offers nothing');
                h.stop();
            }
            // an old fake without newestReleaseUpTo (a builds module that cannot answer): a mark offers nothing
            {
                const { w, h } = await marked({ hold: false, accepted: 200 }, { greet: false });
                w.androidBuilds.newestReleaseUpTo = undefined;
                for (const id of [A, B]) w.helloOf(id);
                await settle();
                assert.strictEqual(w.calls.length, 0);
                h.stop();
            }
        } finally { process.env.ANDROID_UPDATES_TEST_UNHELD = '1'; }
        console.log('ok  accepted mark: no mark = latest; N-1 gets N, N nothing, lane the latest; raised mark + offer; resends never above it; low / bad mark and hold: nothing');
    }

    console.log('all passed');
})().catch((error) => { console.error(error); process.exit(1); });
