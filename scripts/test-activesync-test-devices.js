'use strict';

// Test devices and the ActiveSync store (StaticForge #1334, modules/activeSync.js + modules/testDevices.js): an
// emulator and a DreamOS test VM never get a row or a log line in activesync.db; they live in the test lane's
// registry, are the lane's partner on an administrator's sign-in, are in no household list, broadcast, event or
// primary-device choice, rows already stored are moved by the server, and gone entries are dropped with what was kept
// beside them. The household's phones (the Fold, the A53) and computers are unchanged and cannot be marked.

const assert = require('assert');
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'activesync-test-devices-'));
const REGISTRY = path.join(tmp, 'test-devices.json');
// before any module: nothing of this test may touch the server's registry, database or adb
process.env.TEST_DEVICES_FILE = REGISTRY;
process.env.DREAMSCAPE_ADB = '/bin/false';

const Database = require('better-sqlite3');
const testDevices = require('../modules/testDevices');
const as = require('../modules/activeSync');
const walls = require('../modules/activeSyncWallpapers');
// no ADB looking at a hello: its late answer would be a change of its own in the lists
require('../modules/deviceAdb').noteOnline = () => {};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const settle = () => sleep(320); // as_peers_updated is coalesced over 250 ms
const HOUR = 60 * 60 * 1000;
const hex = (c) => c.repeat(32);

const FOLD = hex('f');
const MAC = hex('6');
const PIXEL = hex('9');
const EMU = hex('e');
const EMU2 = hex('d');
const A53 = hex('b');
const VM = hex('c');
const PC = hex('1');
const HARNESS = hex('2');
const DEX = hex('3');
const SHARED = hex('4');
const LINKED = hex('0'); // an emulator whose background link is the first thing heard of it
const HERS = [MAC, FOLD, A53].sort();

const PICTURE = `data:image/png;base64,${Buffer.from('a small picture').toString('base64')}`;
const wallDir = (id) => path.join(dir, 'activesync-wallpapers', id);
const addWallpaper = (id) => { walls.store({ getPath: () => dir }, id, { inner: PICTURE }); assert.ok(fs.existsSync(wallDir(id)) && walls.stampOf({ getPath: () => dir }, id) > 0); };
const hasWallpaper = (id) => fs.existsSync(wallDir(id));

const vmStatus = (vendor) => ({ host: { base: '0.2.50', slot: 'A', vendor, allow: { commands: true } } });
const readRegistry = () => JSON.parse(fs.readFileSync(REGISTRY, 'utf8'));

function fakeServer() {
    const server = {
        clients: new Map(),
        broadcasts: [],
        sendToClient(ws, msg) {
            ws.inbox.push(msg);
            // a peer with an answer set replies to what it is asked
            if (ws.answer && msg.type === 'as_request') setImmediate(() => as.reply(ws.info, { callId: msg.data.callId, ok: true, result: ws.answer }));
        },
        broadcast(msg, filter) {
            const to = [];
            for (const [ws, info] of server.clients) if (!filter || filter(info)) { to.push(info); ws.inbox.push(msg); }
            server.broadcasts.push({ msg, to });
        }
    };
    return server;
}

let server = fakeServer();
let dir = tmp;
const gr = { getPath: () => dir, getWebSocketServer: () => server };
// the same folder as a script sees it: no websocket server, so opening the database moves nothing
const scriptGr = { getPath: () => dir };

function connect(userType = 'admin', extra = {}) {
    const ws = { readyState: WebSocket.OPEN, inbox: [] };
    const info = Object.assign({ authenticated: true, userType, clientId: Math.random().toString(16).slice(2, 14) }, extra);
    ws.info = info;
    server.clients.set(ws, info);
    return { ws, info };
}

/** A DreamOS machine's socket: a sub-client of its own Miniport. */
function connectHost(id) {
    const peer = connect('admin');
    peer.ws.virtual = true;
    peer.ws.carrier = { _dsMiniport: true, _dsDevice: id };
    return peer;
}

function close(peer) {
    server.clients.delete(peer.ws);
    as.onSocketClosed(gr, server, peer.info);
}

const phoneHello = (peer, id, model, more = {}) => as.hello(gr, server, peer.info, Object.assign({ kind: 'device', id, name: model, model, os: 'Android 16', app: 'Dreamscape', ops: ['status.*', 'partnership.*'] }, more));
const hostHello = (peer, id, model, vendor, more = {}) => as.hello(gr, server, peer.info, Object.assign({ kind: 'device', id, name: 'dreamos', model, speaker: 'host', os: 'DreamOS', app: 'CaféReady', ops: ['status.*'], status: vmStatus(vendor) }, more));

const db = () => as.db(scriptGr);
const count = (table, id) => db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE device_id = ?`).get(id).n;
const storedIds = () => db().prepare('SELECT device_id FROM as_devices ORDER BY device_id').all().map((r) => r.device_id);
const ids = (data) => data.devices.map((d) => d.deviceId).sort();
const computerIds = (data) => data.computers.map((c) => c.computerId).sort();
const pushes = (peer) => peer.ws.inbox.filter((m) => m.type === 'as_peers_updated');
const clearPushes = (...peers) => { for (const p of peers) p.ws.inbox.length = 0; server.broadcasts.length = 0; };

/** Every id ever written to as_devices or as_log from here on, whatever deletes it later. */
function watchWrites() {
    db().exec(`
        CREATE TABLE written (tbl TEXT, device_id TEXT);
        CREATE TRIGGER w1 AFTER INSERT ON as_devices BEGIN INSERT INTO written VALUES ('as_devices', NEW.device_id); END;
        CREATE TRIGGER w2 AFTER UPDATE ON as_devices BEGIN INSERT INTO written VALUES ('as_devices', NEW.device_id); END;
        CREATE TRIGGER w3 AFTER INSERT ON as_log BEGIN INSERT INTO written VALUES ('as_log', NEW.device_id); END;
    `);
}
const written = () => [...new Set(db().prepare('SELECT device_id FROM written').all().map((r) => r.device_id))].sort();

async function rejects(promise, code) {
    try {
        await promise;
    } catch (err) {
        assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
        return;
    }
    assert.fail(`expected ${code}`);
}
const throwsCode = (fn, code) => assert.throws(fn, (e) => e.code === code, `expected ${code}`);

function freshStore(name) {
    dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    server = fakeServer();
    as.resetForTests(dir);
}

function freshRegistry(content) {
    if (content) fs.writeFileSync(REGISTRY, JSON.stringify(content));
    else fs.rmSync(REGISTRY, { force: true });
    testDevices._test.reset();
}

// ---------------------------------------------------------------- classify

function classifyCases() {
    const c = testDevices.classify;
    assert.strictEqual(c({ id: EMU, model: 'sdk_gphone64_x86_64' }), 'emulator');
    assert.strictEqual(c({ id: 'emulator-5554', model: '' }), 'emulator');
    assert.strictEqual(c({ id: VM, model: 'VMware7,1', platform: 'cafeready' }), 'test-vm');
    assert.strictEqual(c({ id: VM, model: 'Standard PC (Q35 + ICH9, 2009)', platform: 'cafeready' }), 'test-vm');
    assert.strictEqual(c({ id: VM, model: 'X', platform: 'cafeready', vendor: 'innotek GmbH' }), 'test-vm');
    assert.strictEqual(c({ id: VM, model: 'X', platform: 'cafeready', vendor: 'QEMU' }), 'test-vm');
    assert.strictEqual(c({ id: VM, model: 'VMware7,1' }), null, 'a VM is a test device only as a CaféReady host');
    // hers
    assert.strictEqual(c({ id: FOLD, model: 'SM-F966U' }), null);
    assert.strictEqual(c({ id: A53, model: 'SM-A536U1' }), null, 'the A53 is the household\'s');
    assert.strictEqual(c({ id: MAC, model: 'MacBookPro11,4', platform: 'cafeready', vendor: 'Apple Inc.' }), null);
    assert.strictEqual(c({ id: FOLD, model: 'SM-F966U', name: 'my emulator aemu' }), null, 'never by the name');
    assert.strictEqual(c(), null);
    assert.strictEqual(testDevices.isEmulatorShape(FOLD, '', 'Test Fold Emulator'), true, 'isEmulatorShape is unchanged');
}

// ---------------------------------------------------------------- hello, lists, events, primary

async function lane() {
    freshRegistry(null);
    freshStore('lane');
    watchWrites();

    const pc = connect();
    as.hello(gr, server, pc.info, { kind: 'computer', id: PC, name: 'LUMINA-XR7', ops: ['partnership.*', 'studio.*'] });

    // the household's phone and computer are stored as before
    const fold = connect();
    let r = phoneHello(fold, FOLD, 'SM-F966U', { name: 'Galaxy Fold' });
    assert.strictEqual(r.session, 'pending');
    assert.deepStrictEqual(storedIds(), [FOLD]);
    assert.deepStrictEqual(as.getLog(gr, FOLD, 10).map((e) => e.text), ['Connected (webview)']);
    const mac = connectHost(MAC);
    r = hostHello(mac, MAC, 'MacBookPro11,4', 'Apple Inc.');
    assert.strictEqual(r.session, 'partner');
    assert.deepStrictEqual(storedIds(), [MAC, FOLD].sort());
    assert.deepStrictEqual(r.permissions, ['files', 'control']);
    assert.strictEqual(as.deviceRow(gr, MAC).platform, 'cafeready');
    // the A53 is the household's too: stored, logged, asked how to connect, listed
    const a53 = connect();
    r = phoneHello(a53, A53, 'SM-A536U1', { name: 'A53 Test' });
    assert.strictEqual(r.session, 'pending', 'no lane partnership for it');
    assert.deepStrictEqual(storedIds(), HERS);
    assert.deepStrictEqual(as.getLog(gr, A53, 10).map((e) => e.text), ['Connected (webview)']);
    assert.ok(!testDevices.isTestDevice(MAC) && !testDevices.isTestDevice(FOLD) && !testDevices.isTestDevice(A53));

    // an emulator's page: the lane's partner at once, no row, no log line
    const emu = connect('admin', { sessionId: 'sess-emu' });
    r = phoneHello(emu, EMU, 'sdk_gphone64_x86_64');
    assert.strictEqual(r.session, 'partner');
    assert.deepStrictEqual(r.permissions, as.PERMISSIONS);
    assert.strictEqual(r.device.partner, true);
    assert.strictEqual(r.device.test, true);
    assert.strictEqual(testDevices.kindOf(EMU), 'emulator');
    assert.strictEqual(count('as_devices', EMU) + count('as_log', EMU), 0);
    assert.deepStrictEqual(ids(r), [EMU], 'its own view: none of the household devices');
    assert.deepStrictEqual(computerIds(r), [PC]);
    // its background link
    const emuLink = connect('admin', { sessionId: 'sess-emu' });
    r = phoneHello(emuLink, EMU, 'sdk_gphone64_x86_64', { speaker: 'service', name: 'x', ops: ['status.*'] });
    assert.strictEqual(r.session, 'partner');
    assert.strictEqual(as.deviceRow(gr, EMU).name, 'sdk_gphone64_x86_64');
    // a service speaker whose first hello is the first thing heard of it: accepted, with no row
    const bare = connect();
    r = phoneHello(bare, LINKED, 'sdk_gphone64_arm64', { speaker: 'service', name: 'bare', ops: ['status.*'] });
    assert.strictEqual(r.session, 'partner');
    assert.strictEqual(testDevices.kindOf(LINKED), 'emulator');
    assert.strictEqual(count('as_devices', LINKED) + count('as_log', LINKED), 0);
    // a DreamOS test machine, known by its maker
    const vm = connectHost(VM);
    r = hostHello(vm, VM, 'Server', 'VMware, Inc.');
    assert.strictEqual(r.session, 'partner');
    assert.deepStrictEqual(r.permissions, ['files', 'control']);
    assert.strictEqual(testDevices.kindOf(VM), 'test-vm');
    assert.strictEqual(testDevices.row(VM).platform, 'cafeready');
    assert.strictEqual(count('as_devices', VM) + count('as_log', VM), 0);

    // not from anyone but an administrator: pending, and no background link
    const guest = connect('readonly');
    r = phoneHello(guest, EMU2, 'sdk_gphone64_x86_64');
    assert.strictEqual(r.session, 'pending', 'a non-admin is never auto-partnered');
    assert.strictEqual(testDevices.row(EMU2).partner, null, 'undecided, not ended');
    const guestLink = connect('readonly');
    throwsCode(() => phoneHello(guestLink, EMU2, 'sdk_gphone64_x86_64', { speaker: 'service' }), 'NOT_PARTNER');
    const stranger = connect('readonly');
    throwsCode(() => phoneHello(stranger, hex('8'), 'sdk_gphone64_x86_64', { speaker: 'service' }), 'NOT_PARTNER');
    assert.strictEqual(testDevices.row(hex('8')), null, 'a refused link leaves no record');
    testDevices.unmark(hex('8'));
    close(guest);
    assert.strictEqual(readRegistry().devices[EMU2].record.partner, null);
    // an administrator's next hello decides it, the background link's too
    const decided = connect();
    r = phoneHello(decided, EMU2, 'sdk_gphone64_x86_64', { speaker: 'service', ops: ['status.*'] });
    assert.strictEqual(r.session, 'partner');
    assert.deepStrictEqual(r.permissions, as.PERMISSIONS);
    assert.strictEqual(readRegistry().devices[EMU2].record.partner, 1);
    close(decided);
    assert.strictEqual(count('as_devices', EMU2) + count('as_log', EMU2), 0);

    // test-lane computers: a DeX window of the emulator, a harness that says so, a computer on a test device's session
    const dex = connect();
    r = as.hello(gr, server, dex.info, { kind: 'computer', id: DEX, name: 'DeX', link: 'usb', usbDevice: EMU });
    assert.deepStrictEqual(ids(r), [EMU], 'its DeX window is answered with the phone\'s own view');
    assert.deepStrictEqual(computerIds(r), [PC, DEX].sort());
    assert.strictEqual(r.devices[0].link, 'usb');
    const harness = connect();
    r = as.hello(gr, server, harness.info, { kind: 'computer', id: HARNESS, name: 'lane harness', testLane: true });
    assert.deepStrictEqual(ids(r), HERS, 'any other test-lane computer is told the household list');
    assert.deepStrictEqual(computerIds(r), [PC]);
    const shared = connect('admin', { sessionId: 'sess-emu' });
    r = as.hello(gr, server, shared.info, { kind: 'computer', id: SHARED, name: 'same session' });
    assert.deepStrictEqual(ids(r), HERS);
    assert.ok(testDevices.row(EMU).settings.includes('continuitySeen'), 'the DeX window is noted in the registry');

    const household = as.list(gr, server);
    assert.deepStrictEqual(ids(household), HERS);
    assert.deepStrictEqual(computerIds(household), [PC]);
    const all = as.list(gr, server, { includeTest: true });
    assert.deepStrictEqual(ids(all), [...HERS, EMU, EMU2, LINKED, VM].sort());
    assert.deepStrictEqual(computerIds(all), [PC, HARNESS, DEX, SHARED].sort());
    assert.strictEqual(all.devices.find((d) => d.deviceId === EMU).link, 'usb');
    for (const asker of [emu, dex]) {
        const view = as.listFor(gr, server, asker.info);
        assert.deepStrictEqual(ids(view), [EMU]);
        assert.deepStrictEqual(computerIds(view), [PC, HARNESS, DEX, SHARED].sort());
    }
    for (const asker of [pc, fold, a53, harness, shared]) assert.deepStrictEqual(ids(as.listFor(gr, server, asker.info)), HERS);

    // broadcasts
    await settle();
    clearPushes(pc, fold, a53, emu, emuLink, bare, vm, harness, dex);
    // a test device's own churn: nobody in the household hears, and its page reads none of what changed
    as.status(gr, server, emu.info, { battery: { level: 10 }, foreground: true });
    as.status(gr, server, bare.info, { battery: { level: 55 } });
    as.status(gr, server, vm.info, Object.assign(vmStatus('VMware, Inc.'), { battery: { level: 3 } }));
    await settle();
    assert.strictEqual(pushes(pc).length, 0, 'no broadcast to the household for a test device');
    assert.strictEqual(pushes(fold).length + pushes(a53).length + pushes(harness).length, 0);
    assert.strictEqual(pushes(emu).length, 0, 'its own report does not come back to it');
    assert.strictEqual(pushes(dex).length, 1, 'its DeX window shows the phone, so the phone\'s change reaches it');
    assert.deepStrictEqual(ids(pushes(dex)[0].data), [EMU]);
    assert.strictEqual(pushes(dex)[0].data.devices[0].status.battery.level, 10);
    clearPushes(pc, fold, a53, emu, emuLink, bare, vm, harness, dex);
    // a household change: the household hears it; the test page's view is the same, so it hears nothing
    as.status(gr, server, fold.info, { battery: { level: 42 } });
    await settle();
    assert.strictEqual(pushes(pc).length, 1);
    assert.deepStrictEqual(ids(pushes(pc)[0].data), HERS);
    assert.deepStrictEqual(computerIds(pushes(pc)[0].data), [PC]);
    assert.strictEqual(pushes(harness).length, 1, 'a test-lane computer gets the household list');
    assert.deepStrictEqual(ids(pushes(harness)[0].data), HERS);
    assert.strictEqual(pushes(emu).length, 0, 'a household change never reaches a test page');
    assert.strictEqual(pushes(dex).length, 0, 'nor a test DeX window');
    assert.strictEqual(pushes(emuLink).length + pushes(bare).length + pushes(vm).length, 0, 'native links read no list');
    // a computer joins: the household list changes and so does the test device's own view
    clearPushes(pc, fold, emu, harness, dex);
    const pc2 = connect();
    as.hello(gr, server, pc2.info, { kind: 'computer', id: hex('5'), name: 'SECOND' });
    await settle();
    assert.strictEqual(pushes(emu).length, 1);
    assert.deepStrictEqual(ids(pushes(emu)[0].data), [EMU], 'its pushes keep its own row and nothing of the household');
    assert.strictEqual(pushes(dex).length, 1);
    assert.deepStrictEqual(ids(pushes(dex)[0].data), [EMU], 'the DeX window\'s pushes too');
    assert.ok(computerIds(pushes(dex)[0].data).includes(hex('5')));
    assert.strictEqual(pushes(pc).length, 1);
    assert.deepStrictEqual(ids(pushes(pc)[0].data), HERS);
    close(pc2);
    // a household phone's DeX window is a household computer like before
    const foldDex = connect();
    r = as.hello(gr, server, foldDex.info, { kind: 'computer', id: hex('a'), name: 'Fold DeX', link: 'usb', usbDevice: FOLD });
    assert.deepStrictEqual(ids(r), HERS);
    assert.ok(computerIds(as.list(gr, server)).includes(hex('a')));
    close(foldDex);

    // events: a test device's news reaches no computer; the server's taps hear what they heard before
    const tapped = [];
    as.onDeviceEvent((name, detail, me) => { if (testDevices.isTestDevice(me.id)) tapped.push(name); });
    await settle();
    clearPushes(pc, harness, dex);
    for (const name of ['storage.changed', 'studio.changed', 'inbox.posted', 'apps.updateWaiting', 'notify.posted']) {
        assert.strictEqual(as.event(gr, server, emu.info, { event: name, detail: {} }), 0, name);
    }
    assert.deepStrictEqual(tapped, ['inbox.posted', 'apps.updateWaiting']);
    assert.strictEqual([pc, harness, dex].reduce((n, p) => n + p.ws.inbox.filter((m) => m.type === 'as_event').length, 0), 0);
    assert.ok(as.event(gr, server, mac.info, { event: 'storage.changed', detail: {} }) > 0, 'the household\'s events are relayed');
    assert.strictEqual(as.tellComputers(gr, server, 'notify.filter', { deviceId: EMU }), 0);
    assert.ok(as.tellComputers(gr, server, 'notify.filter', { deviceId: FOLD }) > 0);

    // primary: never a test device
    throwsCode(() => as.setPrimary(gr, server, EMU), 'TEST_DEVICE');
    throwsCode(() => as.setPrimary(gr, server, LINKED), 'TEST_DEVICE');
    throwsCode(() => as.setPrimary(gr, server, A53), 'NOT_PARTNER'); // hers: the household's own rule
    assert.strictEqual(as.primaryOf(gr), '');
    db().prepare("INSERT INTO as_prefs (owner, name, value) VALUES ('other', 'primary', ?)").run(EMU);
    assert.strictEqual(as.primaryOf(gr, 'other'), '', 'a stored test id is never the primary');

    // the transport the lane uses still knows them
    const links = as.partnerLinks(gr, server);
    assert.strictEqual(links.find((l) => l.deviceId === EMU).name, 'sdk_gphone64_x86_64');
    assert.ok(links.find((l) => l.deviceId === LINKED).service);
    assert.strictEqual(as.markSynced(gr, server, EMU, 'Notes: 3 items'), true);
    assert.ok(testDevices.row(EMU).last_sync > 0);
    as.logEvent(gr, EMU, 'info', 'Remote: shell');
    assert.deepStrictEqual(as.getLog(gr, EMU, 10), []);

    // the partnership: the household's names and a test device's never clash, and the lane's name is the registry's
    emu.ws.inbox.length = 0;
    fold.ws.answer = { accept: true };
    r = await as.partnership(gr, server, pc.info, { action: 'propose', deviceId: FOLD, mode: 'partner', name: 'Galaxy Fold' });
    assert.strictEqual(r.accepted, true);
    emu.ws.answer = { accept: true };
    r = await as.partnership(gr, server, harness.info, { action: 'propose', deviceId: EMU, mode: 'partner', name: 'Galaxy Fold' });
    assert.strictEqual(r.accepted, true, 'NAME_IN_USE is the household\'s rule');
    assert.strictEqual(testDevices.row(EMU).name, 'Galaxy Fold');
    assert.strictEqual(testDevices.list().find((d) => d.id === EMU).name, 'Galaxy Fold');
    r = await as.partnership(gr, server, harness.info, { action: 'update', deviceId: EMU, name: 'Lane aemu-fold-1', syncItems: ['notes'], settings: { a: 1 } });
    assert.strictEqual(r.device.name, 'Lane aemu-fold-1');
    assert.deepStrictEqual(r.device.syncItems, ['notes']);
    assert.strictEqual(readRegistry().devices[EMU].record.name, 'Lane aemu-fold-1', 'saved at once');
    // the lane's PUT renames; a later hello (even one whose owner named the phone) does not undo it
    testDevices.mark(EMU, { name: 'Lane again' });
    const emuAgain = connect('admin', { sessionId: 'sess-emu' });
    r = phoneHello(emuAgain, EMU, 'sdk_gphone64_x86_64', { name: 'Phone says', nameSet: true });
    assert.strictEqual(r.name, 'Lane again');
    close(emuAgain);
    // a name given before the first hello wins over the hello's
    const EARLY = hex('7');
    testDevices.mark(EARLY, { name: 'Lane early' });
    const early = connect();
    r = phoneHello(early, EARLY, 'sdk_gphone64_x86_64');
    assert.strictEqual(r.name, 'Lane early');
    assert.strictEqual(r.session, 'partner');

    // ended stays ended
    r = await as.partnership(gr, server, early.info, { action: 'end' });
    assert.strictEqual(r.device.partner, false);
    assert.strictEqual(readRegistry().devices[EARLY].record.partner, 0);
    close(early);
    const earlyLink = connect();
    throwsCode(() => phoneHello(earlyLink, EARLY, 'sdk_gphone64_x86_64', { speaker: 'service' }), 'NOT_PARTNER');
    const early2 = connect();
    assert.strictEqual(phoneHello(early2, EARLY, 'sdk_gphone64_x86_64').session, 'pending');
    close(early2);

    // the queue and Received Items work for a test device
    close(emu);
    close(emuLink);
    r = await as.call(gr, server, pc.info, { to: EMU, op: 'clipboard.set', args: { text: 'queued' }, queue: true });
    assert.strictEqual(r.queued, true);
    assert.strictEqual(count('as_queue', EMU), 1);
    as.__test.noteReceived(gr, server, EMU, 'open.item', { kind: 'url', url: 'https://example.com' }, 'PC');
    assert.strictEqual(as.listReceived(gr, EMU).length, 1);

    // not one write about a test device, from the first hello on
    assert.deepStrictEqual(written(), HERS);
}

// ---------------------------------------------------------------- the spoof guard

function spoof() {
    freshRegistry(null);
    freshStore('spoof');
    let fold = connect();
    phoneHello(fold, FOLD, 'SM-F966U', { name: 'Galaxy Fold' });
    db().prepare("UPDATE as_devices SET partner = 1, permissions = '[\"files\"]' WHERE device_id = ?").run(FOLD);
    close(fold);
    let mac = connectHost(MAC);
    hostHello(mac, MAC, 'MacBookPro11,4', 'Apple Inc.');
    close(mac);
    let a53 = connect();
    phoneHello(a53, A53, 'SM-A536U1', { name: 'A53 Test' });
    db().prepare("UPDATE as_devices SET partner = 1, permissions = '[\"files\"]' WHERE device_id = ?").run(A53);
    close(a53);
    // twice: the first must not store anything the second would be believed by
    for (let i = 0; i < 2; i += 1) {
        fold = connect();
        const r = phoneHello(fold, FOLD, 'sdk_gphone64_x86_64');
        assert.strictEqual(r.session, 'partner');
        close(fold);
        a53 = connect();
        assert.strictEqual(phoneHello(a53, A53, 'sdk_gphone64_x86_64', { speaker: 'service' }).session, 'partner');
        close(a53);
        mac = connectHost(MAC);
        hostHello(mac, MAC, 'VMware7,1', 'VMware, Inc.');
        as.status(gr, server, mac.info, vmStatus('VMware, Inc.'));
        close(mac);
    }
    assert.ok(!testDevices.isTestDevice(FOLD) && !testDevices.isTestDevice(MAC) && !testDevices.isTestDevice(A53), 'a spoofed hello moves none of her devices');
    assert.strictEqual(as.deviceRow(gr, A53).model, 'SM-A536U1');
    assert.strictEqual(as.deviceRow(gr, FOLD).model, 'SM-F966U');
    assert.strictEqual(as.deviceRow(gr, MAC).model, 'MacBookPro11,4');
    assert.strictEqual(JSON.parse(as.deviceRow(gr, MAC).last_status).host.vendor, 'Apple Inc.');
    // and the server's next opening of the database moves nothing either
    as.resetForTests(dir);
    assert.deepStrictEqual(ids(as.list(gr, server)), HERS);
}

// ---------------------------------------------------------------- her devices cannot be marked

function quietly(fn) {
    const warn = console.warn;
    const lines = [];
    console.warn = (...a) => lines.push(a.join(' '));
    try { return { value: fn(), lines }; } finally { console.warn = warn; }
}

function guard() {
    freshRegistry(null);
    freshStore('guard');
    const PRIMARY_ONLY = HARNESS; // the primary device, whatever its partner column says
    seed([
        rowFor(FOLD, 'Galaxy Fold', 'SM-F966U', 1), rowFor(A53, 'A53 Test', 'SM-A536U1', 1), machine(MAC, 'MacBookPro11,4', 'Apple Inc.'),
        rowFor(PRIMARY_ONLY, 'Primary', 'Pixel 9', 0), rowFor(PIXEL, 'A guest', 'Pixel 7', 0)
    ], PRIMARY_ONLY);
    as.list(gr, server);
    const hers = [FOLD, A53, MAC, PRIMARY_ONLY];
    addWallpaper(FOLD);
    addWallpaper(A53);
    const before = db().prepare('SELECT * FROM as_devices ORDER BY device_id').all();
    for (const id of hers) {
        const asked = quietly(() => testDevices.mark(id, { name: 'Lane', kind: 'emulator' }));
        assert.strictEqual(asked.value, null, `${id.slice(0, 4)} is hers: not marked`);
        assert.ok(asked.lines.some((l) => /one of the household's devices/.test(l)));
        assert.ok(!testDevices.isTestDevice(id));
        assert.strictEqual(testDevices.unmark(id), false);
    }
    assert.deepStrictEqual(db().prepare('SELECT * FROM as_devices ORDER BY device_id').all(), before, 'nothing changed');
    assert.deepStrictEqual(testDevices.list(), []);
    assert.ok(hasWallpaper(FOLD) && hasWallpaper(A53));
    for (const id of hers) assert.strictEqual(count('as_log', id), 1);

    // an unpartnered row, an emulator's row even with a partnership, and an id nothing knows yet: the lane's to mark
    assert.ok(testDevices.mark(PIXEL, { name: 'Lane guest' }));
    assert.strictEqual(count('as_devices', PIXEL) + count('as_log', PIXEL), 0);
    assert.strictEqual(testDevices.row(PIXEL).partner, null);
    seedOne(rowFor(EMU, 'Lane emulator', 'sdk_gphone64_x86_64', 1));
    assert.ok(testDevices.mark(EMU, { name: 'Lane aemu-fold-1' }));
    assert.strictEqual(count('as_devices', EMU), 0);
    assert.strictEqual(testDevices.row(EMU).partner, 1);
    assert.strictEqual(testDevices.row(EMU).name, 'Lane aemu-fold-1');
    assert.ok(testDevices.mark(EMU2, { name: 'Lane not seen yet' }));
    assert.deepStrictEqual(storedIds(), [...hers].sort());
}

/**
 * The test lane's route as the first thing to touch ActiveSync after a start: a process of its own in which the
 * server's resources are loaded and nothing has required modules/activeSync.js. PUTs every id, then (open) lets the
 * server use the database for the first time.
 */
const ROUTE_FIRST = `
const path = require('path');
const Database = require('better-sqlite3');
const mod = (n) => path.join(process.env.ROOT, 'modules', n);
const dir = process.env.STORE_DIR;
const server = { clients: new Map(), sendToClient() {}, broadcast() {} };
const gr = { getPath: () => dir, getWebSocketServer: () => server };
const grPath = require.resolve(mod('globalResources'));
require.cache[grPath] = { id: grPath, filename: grPath, loaded: true, exports: gr };
const routes = {};
const app = {};
for (const m of ['get', 'put', 'post', 'delete']) app[m] = (p, ...h) => { routes[m + ' ' + p] = h[h.length - 1]; };
require(mod('testDevicesRoute')).mount(app, null, gr);
const out = { loadedBefore: !!require.cache[require.resolve(mod('activeSync'))], codes: [] };
const stored = () => { const d = new Database(path.join(dir, 'activesync.db'), { readonly: true }); try { return d.prepare('SELECT device_id FROM as_devices ORDER BY device_id').all().map((r) => r.device_id); } finally { d.close(); } };
const put = (id) => new Promise((resolve) => {
    const res = { headersSent: false, code: 200, status(c) { this.code = c; return this; }, json() { this.headersSent = true; resolve(this.code); } };
    routes['put /api/test-devices/:id']({ params: { id }, body: { name: 'Lane' }, userType: 'admin' }, res);
});
(async () => {
    for (const id of process.env.IDS.split(',')) out.codes.push(await put(id));
    if (process.env.OPEN === '1') {
        out.storedAfterAsking = stored();
        require(mod('activeSync')).list(gr, null);
        out.storedAfterOpen = stored();
    }
    const testDevices = require(mod('testDevices'));
    out.registry = Object.fromEntries(testDevices.list().map((e) => [e.id, testDevices.row(e.id)]));
    process.stdout.write('\\nRESULT ' + JSON.stringify(out) + '\\n');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
`;

function runRoute(storeDir, idList, open) {
    const text = execFileSync(process.execPath, ['-e', ROUTE_FIRST], {
        cwd: path.join(__dirname, '..'), timeout: 60000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        env: Object.assign({}, process.env, {
            ROOT: path.join(__dirname, '..'), STORE_DIR: storeDir, IDS: idList.join(','), OPEN: open ? '1' : '0',
            TEST_DEVICES_FILE: path.join(storeDir, 'route-registry.json'), DREAMSCAPE_ADB: '/bin/false',
            NOTIFICATION_INBOX_DB: ':memory:', NOTIFICATION_INBOX_NO_TIMER: '1', AGENT_COORD_DB: path.join(storeDir, 'coord.db')
        })
    });
    return JSON.parse(text.split('\n').find((l) => l.startsWith('RESULT ')).slice(7));
}

function routeFirst() {
    freshRegistry(null);
    freshStore('route-first');
    const store = dir;
    seed([rowFor(FOLD, 'Galaxy Fold', 'SM-F966U', 1), rowFor(A53, 'A53 Test', 'SM-A536U1', 1), rowFor(EMU, 'sdk_gphone64_x86_64', 'sdk_gphone64_x86_64', 0)], FOLD);
    as.resetForTests(); // closed, as before a start
    const out = runRoute(store, [FOLD, A53, EMU, EMU2], true);
    assert.strictEqual(out.loadedBefore, false, 'the route is the first to load ActiveSync');
    assert.deepStrictEqual(out.codes, [400, 400, 200, 200], 'hers are refused, the lane\'s are marked');
    assert.deepStrictEqual(out.storedAfterAsking, [A53, EMU, FOLD].sort(), 'asking moved and wrote nothing');
    assert.deepStrictEqual(out.storedAfterOpen, [A53, FOLD].sort(), 'the server\'s first open moves the lane\'s row');
    assert.deepStrictEqual(Object.keys(out.registry).sort(), [EMU, EMU2].sort());
    assert.strictEqual(out.registry[EMU].partner, null);

    // a store that is there and cannot be asked: the answer is no
    const broken = path.join(tmp, 'route-broken');
    fs.mkdirSync(broken);
    fs.writeFileSync(path.join(broken, 'activesync.db'), 'not a database '.repeat(300));
    const refused = runRoute(broken, [EMU2], false);
    assert.deepStrictEqual(refused.codes, [400]);
    assert.deepStrictEqual(refused.registry, {});
}

// ---------------------------------------------------------------- rows already in the store are moved

const COLUMNS = ['device_id', 'name', 'model', 'os', 'app', 'partner', 'permissions', 'sync_items', 'settings', 'last_status', 'first_seen', 'last_seen', 'last_sync', 'platform'];

function seed(rows, primary) {
    const d = db(); // a script's resources: nothing is moved yet
    d.exec(`
        CREATE TABLE IF NOT EXISTS as_notify_apps (device_id TEXT NOT NULL, package TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS as_notify_prefs (device_id TEXT PRIMARY KEY, prefs TEXT NOT NULL, updated INTEGER NOT NULL);
    `);
    for (const r of rows) {
        d.prepare(`INSERT INTO as_devices (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`).run(...COLUMNS.map((c) => r[c]));
        d.prepare("INSERT INTO as_log (device_id, at, level, text) VALUES (?, 1, 'info', 'Connected (webview)')").run(r.device_id);
        d.prepare("INSERT INTO as_queue (device_id, op, args, created) VALUES (?, 'clipboard.set', '{}', 1)").run(r.device_id);
        d.prepare("INSERT INTO as_received (device_id, kind, op, created) VALUES (?, 'link', 'open.item', 1)").run(r.device_id);
        d.prepare("INSERT INTO as_notify_apps (device_id, package) VALUES (?, 'com.example.app')").run(r.device_id);
        d.prepare("INSERT INTO as_notify_prefs (device_id, prefs, updated) VALUES (?, '{}', 1)").run(r.device_id);
    }
    d.prepare("INSERT INTO as_prefs (owner, name, value) VALUES ('admin', 'primary', ?)").run(primary);
}

let clockBase = 0;
function rowFor(id, name, model, partner, more = {}) {
    clockBase += 1000;
    return Object.assign({
        device_id: id, name, model, os: 'Android 16', app: 'Dreamscape', partner,
        permissions: partner ? JSON.stringify(as.PERMISSIONS) : '[]', sync_items: partner ? '["notes"]' : '[]',
        settings: partner ? '{"favoritesOnly":true}' : '{}', last_status: null,
        first_seen: Date.now() - 100000 + clockBase, last_seen: Date.now() - 50000 + clockBase, last_sync: partner ? Date.now() - 60000 : null, platform: ''
    }, more);
}

const machine = (id, model, vendor) => rowFor(id, 'dreamos', model, 1, { os: 'DreamOS', app: 'CaféReady', platform: 'cafeready', permissions: '["files","control"]', last_status: JSON.stringify(vmStatus(vendor)) });

function adoption() {
    const GUEST_EMU = hex('a');
    const LANE0 = hex('2'); // a lane emulator left without a partnership
    const VM2 = hex('7');
    const VM3 = hex('8');
    const HAND = hex('5'); // one of the household's (partnered, no test shape) with a mark left on it
    const HAND_GUEST = hex('4'); // marked by hand, never partnered
    const marked = { name: 'Fold7 test emulator (fold7-test)', markedAt: Date.now() - 5000, status: { prefs: { popupApps: ['com.android.shell'] } } };
    freshRegistry({
        devices: {
            [GUEST_EMU]: marked,
            [HAND]: { name: 'A mark on one of hers', markedAt: Date.now(), status: {} },
            [HAND_GUEST]: { name: 'Marked by hand', markedAt: Date.now(), status: {} }
        },
        sessions: {}
    });
    freshStore('adopt');
    const rows = [
        rowFor(FOLD, 'Galaxy Fold', 'SM-F966U', 1),
        rowFor(A53, 'A53 Test', 'SM-A536U1', 1),
        machine(MAC, 'MacBookPro11,4', 'Apple Inc.'),
        rowFor(PIXEL, 'Old Pixel emulator I named', 'Pixel 7', 0),
        rowFor(HAND, 'Hand', 'Pixel 5', 1),
        rowFor(GUEST_EMU, 'sdk_gphone64_x86_64', 'sdk_gphone64_x86_64', 0),
        rowFor(LANE0, 'sdk_gphone64_x86_64', 'sdk_gphone64_x86_64', 0),
        rowFor(EMU, 'Test Fold Emulator', 'sdk_gphone64_x86_64', 1),
        machine(VM, 'VMware7,1', 'VMware, Inc.'),
        machine(VM2, 'VMware7,1', 'VMware, Inc.'),
        machine(VM3, 'VMware7,1', 'VMware, Inc.'),
        rowFor(HAND_GUEST, 'Hand guest', 'Pixel 4', 0)
    ];
    seed(rows, FOLD);
    const moved = [GUEST_EMU, LANE0, EMU, VM, VM2, VM3, HAND_GUEST];
    const stay = [FOLD, A53, MAC, PIXEL, HAND].sort();
    const stayRows = () => db().prepare(`SELECT * FROM as_devices WHERE device_id IN (${stay.map(() => '?').join(', ')}) ORDER BY device_id`).all(...stay);
    const pictured = [FOLD, A53, HAND, EMU, VM, GUEST_EMU];
    for (const id of pictured) addWallpaper(id);
    as.db({ getWebSocketServer: () => server }); // not the server's shape: no databases folder of its own
    testDevices.mark(PIXEL, { name: 'marked before the server opened it' });
    testDevices.unmark(PIXEL);
    assert.deepStrictEqual(storedIds(), rows.map((r) => r.device_id).sort(), 'a script\'s opening moves nothing');
    const keptBefore = stayRows();

    const lines = [];
    const log = console.log;
    console.log = (...a) => lines.push(a.join(' '));
    let warned;
    try { warned = quietly(() => as.list(gr, server)).lines; } finally { console.log = log; } // the running server's first use of the database
    assert.strictEqual(lines.filter((l) => /moved from the ActiveSync store/.test(l)).length, moved.length, 'one line for each device moved');
    assert.ok(warned.some((l) => /household's devices: its test mark is removed/.test(l)));

    assert.deepStrictEqual(storedIds(), stay);
    assert.deepStrictEqual(stayRows(), keptBefore, 'the others are untouched');
    for (const t of ['as_log', 'as_notify_apps', 'as_notify_prefs', 'as_queue', 'as_received']) for (const id of stay) assert.strictEqual(count(t, id), 1, `${t} of a household device stays`);
    for (const id of moved) {
        for (const t of ['as_devices', 'as_log', 'as_notify_apps', 'as_notify_prefs']) assert.strictEqual(count(t, id), 0, `${t} ${id.slice(0, 4)}`);
        assert.strictEqual(count('as_queue', id), 1, 'the queue stays');
        assert.strictEqual(count('as_received', id), 1, 'Received Items stay');
        const was = rows.find((r) => r.device_id === id);
        const now = testDevices.row(id);
        // a partnership is kept; a row without one was never ended by anyone: undecided
        const expected = (c) => (c === 'partner' ? (was.partner ? 1 : null) : was[c]);
        for (const c of COLUMNS) if (c !== 'name') assert.strictEqual(now[c], expected(c), `${c} of ${id.slice(0, 4)}`);
        assert.strictEqual(readRegistry().devices[id].record.partner, expected('partner'), 'on disk');
    }
    for (const id of pictured) assert.ok(hasWallpaper(id), 'moving a device keeps its wallpapers (and her stale mark\'s removal does too)');
    assert.strictEqual(testDevices.row(EMU).name, 'Test Fold Emulator');
    assert.strictEqual(testDevices.row(GUEST_EMU).name, marked.name, 'the registry\'s own name wins');
    assert.deepStrictEqual(testDevices.statusOverrides(GUEST_EMU), marked.status, 'status overrides are kept');
    assert.strictEqual(testDevices.row(HAND_GUEST).name, 'Marked by hand');
    assert.strictEqual(testDevices.kindOf(VM2), 'test-vm');
    assert.strictEqual(testDevices.kindOf(HAND_GUEST), 'marked');
    for (const id of [FOLD, A53, MAC, PIXEL, HAND]) assert.ok(!testDevices.isTestDevice(id) && !readRegistry().devices[id], `${id.slice(0, 4)} is the household's`);
    assert.strictEqual(as.primaryOf(gr), FOLD, 'the primary is intact');
    assert.deepStrictEqual(ids(as.list(gr, server)), stay);

    // idempotent
    const before = fs.readFileSync(REGISTRY, 'utf8');
    as.resetForTests(dir);
    as.list(gr, server);
    assert.strictEqual(fs.readFileSync(REGISTRY, 'utf8'), before);
    assert.deepStrictEqual(storedIds(), stay);

    // the A53 connects as the household's partner, as ever
    const a53 = connect();
    assert.strictEqual(phoneHello(a53, A53, 'SM-A536U1', { speaker: 'service' }).session, 'partner');
    assert.ok(!testDevices.isTestDevice(A53) && count('as_log', A53) === 2);

    // the adopted partner's background link needs no row
    const link = connect();
    let r = phoneHello(link, EMU, 'sdk_gphone64_x86_64', { speaker: 'service' });
    assert.strictEqual(r.session, 'partner');
    assert.strictEqual(r.name, 'Test Fold Emulator');
    assert.strictEqual(count('as_devices', EMU) + count('as_log', EMU), 0);

    // one moved without a partnership heals at an administrator's next hello, the background link's as the first
    const notAdmin = connect('readonly');
    throwsCode(() => phoneHello(notAdmin, LANE0, 'sdk_gphone64_x86_64', { speaker: 'service' }), 'NOT_PARTNER');
    assert.strictEqual(phoneHello(notAdmin, LANE0, 'sdk_gphone64_x86_64').session, 'pending');
    assert.strictEqual(readRegistry().devices[LANE0].record.partner, null);
    close(notAdmin);
    const first = connect();
    r = phoneHello(first, LANE0, 'sdk_gphone64_x86_64', { speaker: 'service', ops: ['status.*'] });
    assert.strictEqual(r.session, 'partner');
    assert.deepStrictEqual(r.permissions, as.PERMISSIONS);
    assert.strictEqual(readRegistry().devices[LANE0].record.partner, 1);
    // and a page's hello
    const page = connect();
    r = phoneHello(page, GUEST_EMU, 'sdk_gphone64_x86_64');
    assert.strictEqual(r.session, 'partner');
    assert.strictEqual(r.name, marked.name);
    assert.deepStrictEqual(r.permissions, as.PERMISSIONS);
    assert.strictEqual(count('as_devices', LANE0) + count('as_log', LANE0) + count('as_devices', GUEST_EMU) + count('as_log', GUEST_EMU), 0);

    // a row that turns up later is moved at that device's hello
    const LATE = hex('0');
    seedOne(rowFor(LATE, 'Late lane', 'sdk_gphone64_x86_64', 1));
    const late = connect();
    assert.strictEqual(phoneHello(late, LATE, 'sdk_gphone64_x86_64', { speaker: 'service' }).name, 'Late lane');
    assert.strictEqual(count('as_devices', LATE) + count('as_log', LATE), 0);
}

function seedOne(r) {
    db().prepare(`INSERT INTO as_devices (${COLUMNS.join(', ')}) VALUES (${COLUMNS.map(() => '?').join(', ')})`).run(...COLUMNS.map((c) => r[c]));
}

function adoptionClearsPrimary() {
    freshRegistry(null);
    freshStore('adopt-primary');
    seed([rowFor(EMU, 'Lane one', 'sdk_gphone64_x86_64', 1), rowFor(FOLD, 'Galaxy Fold', 'SM-F966U', 1)], EMU);
    // the server's very first use of the database is the primary lookup itself: the move happens inside it
    assert.strictEqual(as.primaryOf(gr), '');
    assert.strictEqual(db().prepare("SELECT COUNT(*) AS n FROM as_prefs WHERE name = 'primary'").get().n, 0);
    assert.deepStrictEqual(storedIds(), [FOLD]);
}

function notMovedUnlessSaved() {
    freshRegistry(null);
    freshStore('adopt-unsaved');
    seed([rowFor(EMU, 'Lane one', 'sdk_gphone64_x86_64', 1)], '');
    // the registry cannot be written (a folder is in its way): the row must stay in the store
    const blocker = `${REGISTRY}.${process.pid}.tmp`;
    fs.mkdirSync(blocker);
    const warn = console.warn;
    console.warn = () => {};
    try { as.list(gr, server); } finally { console.warn = warn; fs.rmdirSync(blocker); }
    assert.deepStrictEqual(storedIds(), [EMU], 'nothing is deleted before the registry is on disk');
    const link = connect();
    assert.strictEqual(phoneHello(link, EMU, 'sdk_gphone64_x86_64', { speaker: 'service' }).name, 'Lane one');
    assert.deepStrictEqual(storedIds(), [], 'moved at its next hello');
    assert.strictEqual(readRegistry().devices[EMU].record.partner, 1);
}

// ---------------------------------------------------------------- the registry's writes

function writes() {
    freshRegistry(null);
    freshStore('writes');
    let now = Date.now();
    testDevices._test.setClock(() => now);
    const emu = connect();
    phoneHello(emu, EMU, 'sdk_gphone64_x86_64', { status: { battery: { level: 90 } } });
    const first = readRegistry().devices[EMU].record;
    assert.strictEqual(JSON.parse(first.last_status).battery.level, 90, 'saved on hello');
    const text = fs.readFileSync(REGISTRY, 'utf8');
    // status reports (ActiveSync asks the registry at most every 30 s per device): clocks and status wait
    testDevices.setRow(EMU, { last_status: '{"at":1}', last_seen: now + 1000 });
    now += 9 * 60 * 1000;
    testDevices.setRow(EMU, { last_status: '{"at":2}', last_seen: now });
    assert.strictEqual(fs.readFileSync(REGISTRY, 'utf8'), text, 'no write within 10 minutes for clocks and status');
    now += 2 * 60 * 1000;
    testDevices.setRow(EMU, { last_status: '{"at":3}', last_seen: now });
    assert.strictEqual(readRegistry().devices[EMU].record.last_status, '{"at":3}');
    as.status(gr, server, emu.info, { battery: { level: 12 } });
    close(emu);
    assert.strictEqual(JSON.parse(readRegistry().devices[EMU].record.last_status).battery.level, 12, 'saved on close');
    // anything else is saved at once
    testDevices.setRow(EMU, { model: 'sdk_gphone64_arm64' });
    assert.strictEqual(readRegistry().devices[EMU].record.model, 'sdk_gphone64_arm64');
    testDevices._test.setClock(null);
}

// ---------------------------------------------------------------- gone for a day

function cleanup() {
    freshRegistry(null);
    freshStore('cleanup');
    const GONE = hex('a');
    const HERE = hex('b');
    const HAND = hex('c');
    const released = [];
    as.onQueueItemDone((item) => released.push(item.deviceId));
    const ended = [];
    as.onPartnershipEnded((id) => ended.push(id));
    const pc = connect();
    as.hello(gr, server, pc.info, { kind: 'computer', id: PC, name: 'LUMINA-XR7' });
    const gone = connect();
    phoneHello(gone, GONE, 'sdk_gphone64_x86_64');
    const here = connect();
    phoneHello(here, HERE, 'sdk_gphone64_x86_64');
    testDevices.mark(HAND, { name: 'A phone marked by hand' });
    const hand = connect();
    phoneHello(hand, HAND, 'Pixel 5');
    close(gone);
    close(hand);
    for (const id of [GONE, HERE, HAND, FOLD]) addWallpaper(id); // FOLD: a household phone's, no registry entry
    for (const id of [GONE, HAND]) {
        db().prepare("INSERT INTO as_queue (device_id, op, args, created) VALUES (?, 'clipboard.set', '{}', 1)").run(id);
        db().prepare("INSERT INTO as_received (device_id, kind, op, created) VALUES (?, 'link', 'open.item', 1)").run(id);
    }
    const online = (id) => id === HERE;
    const start = testDevices._test.startedAt;
    let now = start + 5 * 60 * 1000;
    testDevices._test.setClock(() => now);
    assert.deepStrictEqual(testDevices.sweep(online), [], 'never in the first 10 minutes after a start');
    now = Date.now() + 23 * HOUR;
    assert.deepStrictEqual(testDevices.sweep(online), [], 'not before a day');
    now = Date.now() + 25 * HOUR;
    assert.deepStrictEqual(testDevices.sweep(online), [GONE]);
    assert.ok(!testDevices.isTestDevice(GONE));
    assert.ok(testDevices.isTestDevice(HERE), 'a connected one stays');
    assert.ok(testDevices.isTestDevice(HAND), 'one the lane would not recognise again stays until DELETE');
    assert.ok(!hasWallpaper(GONE), 'its wallpapers go with it');
    assert.strictEqual(walls.stampOf(gr, GONE), 0);
    assert.ok(hasWallpaper(HERE) && hasWallpaper(HAND) && hasWallpaper(FOLD));
    assert.strictEqual(count('as_queue', GONE) + count('as_received', GONE), 0);
    assert.strictEqual(count('as_queue', HAND) + count('as_received', HAND), 2);
    assert.deepStrictEqual(released, [GONE], 'what its queue pointed at is released');
    assert.ok(ended.includes(GONE), 'its per-partnership state goes');
    assert.deepStrictEqual(testDevices.sweep(() => false), [], 'looked at most every 10 minutes');

    // a hello is the occasion
    close(here);
    now += 48 * HOUR;
    const other = connect();
    as.hello(gr, server, other.info, { kind: 'computer', id: hex('2'), name: 'later' });
    assert.ok(!testDevices.isTestDevice(HERE), 'dropped at a hello');
    assert.ok(!hasWallpaper(HERE) && hasWallpaper(FOLD));
    assert.ok(testDevices.isTestDevice(HAND));
    testDevices._test.setClock(null);

    // and the next hello registers it again
    const back = connect();
    const r = phoneHello(back, GONE, 'sdk_gphone64_x86_64', { speaker: 'service' });
    assert.strictEqual(r.session, 'partner');
    assert.strictEqual(testDevices.kindOf(GONE), 'emulator');
    assert.strictEqual(count('as_devices', GONE) + count('as_log', GONE), 0);

    // unmarked while connected: its link has no partnership any more
    const page = connect();
    phoneHello(page, GONE, 'sdk_gphone64_x86_64');
    db().prepare("INSERT INTO as_queue (device_id, op, args, created) VALUES (?, 'clipboard.set', '{}', 1)").run(GONE);
    addWallpaper(GONE);
    assert.strictEqual(testDevices.unmark(GONE), true);
    assert.ok(!hasWallpaper(GONE), 'unmarked: its wallpapers go');
    assert.strictEqual(page.info.as.session, 'pending');
    assert.strictEqual(back.info.as, null);
    assert.strictEqual(count('as_queue', GONE), 0);
    close(page);
    assert.strictEqual(count('as_devices', GONE) + count('as_log', GONE), 0, 'its closing socket writes nothing');

    // forget: a recognised one leaves the registry, a hand-marked one keeps its mark
    const again = connect();
    phoneHello(again, GONE, 'sdk_gphone64_x86_64');
    throwsCode(() => as.forget(gr, server, GONE), 'ONLINE');
    close(again);
    addWallpaper(GONE);
    assert.strictEqual(as.forget(gr, server, GONE), true);
    assert.ok(!testDevices.isTestDevice(GONE) && !hasWallpaper(GONE));
    assert.ok(hasWallpaper(HAND));
    assert.strictEqual(as.forget(gr, server, HAND), true);
    assert.ok(!hasWallpaper(HAND), 'forgotten: its wallpapers go, mark or no mark');
    assert.ok(testDevices.isTestDevice(HAND), 'else its next hello would put it in the store');
    assert.strictEqual(testDevices.row(HAND), null);
    assert.strictEqual(count('as_queue', HAND) + count('as_received', HAND), 0);
    assert.deepStrictEqual(storedIds(), []);

    // dropped before the server has the database open (a DELETE right after a start): cleaned up when it opens
    const EARLY_DROP = hex('d');
    const brief = connect();
    phoneHello(brief, EARLY_DROP, 'sdk_gphone64_x86_64');
    close(brief);
    db().prepare("INSERT INTO as_queue (device_id, op, args, created) VALUES (?, 'clipboard.set', '{}', 1)").run(EARLY_DROP);
    addWallpaper(EARLY_DROP);
    as.resetForTests(); // closed
    assert.strictEqual(testDevices.unmark(EARLY_DROP), true);
    assert.ok(hasWallpaper(EARLY_DROP));
    as.list(gr, server);
    assert.ok(!hasWallpaper(EARLY_DROP) && hasWallpaper(FOLD));
    assert.strictEqual(count('as_queue', EARLY_DROP), 0);

    // the registry is capped: the longest unseen recognised ones that are offline go first
    const many = [];
    let t = Date.now();
    testDevices._test.setClock(() => t);
    for (let i = 0; i < testDevices.MAX_ENTRIES + 3; i += 1) {
        const id = i.toString(16).padStart(32, '0');
        many.push(id);
        t += 1000;
        testDevices.mark(id, { name: `n${i}` });
        testDevices.setRow(id, { model: 'sdk_gphone64_x86_64', last_seen: t }, { create: true });
    }
    const dropped = testDevices.cap((id) => id === many[0]);
    assert.strictEqual(testDevices.list().length, testDevices.MAX_ENTRIES);
    assert.deepStrictEqual(dropped, many.slice(1, 1 + dropped.length));
    assert.ok(testDevices.isTestDevice(many[0]) && testDevices.isTestDevice(HAND));
    testDevices._test.setClock(null);
}

// the module's timers are unref'd (they never hold the server open): keep this process alive for them
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    classifyCases();
    await lane();
    spoof();
    guard();
    routeFirst();
    adoption();
    adoptionClearsPrimary();
    notMovedUnlessSaved();
    writes();
    cleanup();
    assert.strictEqual(process.env.TEST_DEVICES_FILE, REGISTRY);
    as.resetForTests();
    testDevices._test.reset();
    fs.rmSync(tmp, { recursive: true, force: true });
    clearInterval(keepAlive);
    console.log('activesync-test-devices: ok');
    process.exit(0);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
