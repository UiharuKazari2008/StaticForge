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
    console.log('all passed');
})().catch((error) => { console.error(error); process.exit(1); });
