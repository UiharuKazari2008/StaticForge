'use strict';

// ActiveSync (Yozora #747, modules/activeSync.js): hello for both kinds, pending -> guest / partner
// through the phone's answer, permission checks, the call relay both ways, events, the offline queue
// and its delivery after hello, ending a partnership, forget, and that a closing socket fails its calls.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'activesync-'));
const as = require('../modules/activeSync');
as.resetForTests(tmpDir);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeServer() {
    const server = {
        clients: new Map(),
        broadcasts: [],
        sendToClient(ws, msg) { ws.inbox.push(msg); if (ws.onMessage) ws.onMessage(msg); },
        broadcast(msg, filter) {
            const to = [];
            for (const info of server.clients.values()) if (!filter || filter(info)) to.push(info);
            server.broadcasts.push({ msg, to });
        }
    };
    return server;
}

const server = fakeServer();
const gr = { getPath: () => tmpDir, getWebSocketServer: () => server };

function connect(userType = 'admin') {
    const ws = { readyState: WebSocket.OPEN, inbox: [], onMessage: null };
    const info = { authenticated: true, userType, clientId: Math.random().toString(16).slice(2, 14), connectedAt: new Date() };
    server.clients.set(ws, info);
    return { ws, info };
}

/** The phone answers requests with fn(op, args) -> result, or throws { code, message }. */
function answer(peer, fn) {
    peer.ws.onMessage = (msg) => {
        if (msg.type !== 'as_request') return;
        const { callId, op, args, from } = msg.data;
        Promise.resolve().then(() => fn(op, args, from)).then(
            (result) => as.reply(peer.info, { callId, ok: true, result }),
            (error) => as.reply(peer.info, { callId, ok: false, error: { code: error.code, message: error.message } })
        );
    };
}

async function rejects(promise, code) {
    try {
        await promise;
    } catch (err) {
        assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`);
        return;
    }
    assert.fail(`expected ${code}`);
}

// the module's timers are unref'd (they never hold the server open): keep this process alive for them
const keepAlive = setInterval(() => {}, 1000);

async function main() {
    const DEV = 'a1b2c3d4e5f60718';
    const PC = '00112233445566778899aabbccddeeff';

    // hello: bad input
    const pc = connect();
    assert.throws(() => as.hello(gr, server, pc.info, { kind: 'toaster', id: PC }), (e) => e.code === 'BAD_KIND');
    assert.throws(() => as.hello(gr, server, pc.info, { kind: 'computer', id: 'xyz' }), (e) => e.code === 'BAD_ID');
    assert.throws(() => as.hello(gr, server, { authenticated: false }, { kind: 'computer', id: PC }), (e) => e.code === 'NOT_AUTHENTICATED');

    let r = as.hello(gr, server, pc.info, { kind: 'computer', id: PC, name: 'LUMINA-XR7', ops: ['studio.*', 'clipboard.set'] });
    assert.strictEqual(r.kind, 'computer');
    assert.deepStrictEqual(r.devices, []);
    assert.strictEqual(r.computers.length, 1);

    // a call before any device exists
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'status.get' }), 'UNKNOWN_DEVICE');

    // the phone connects: pending
    const phone = connect();
    r = as.hello(gr, server, phone.info, {
        kind: 'device', id: DEV, name: 'Galaxy Z Fold7', model: 'SM-F966B', os: 'Android 16', app: 'Dreamscape/1.4', speaker: 'webview',
        ops: ['status.*', 'storage.*', 'studio.*', 'clipboard.*', 'partnership.*', 'device.ring', 'bad op', 'x'],
        status: { battery: { level: 81, charging: true, bogus: 1 }, wifi: { connected: true, level: 9, ssid: 'home' }, storage: [{ id: 'primary', name: 'Phone', total: 256e9, free: 100e9 }] }
    });
    assert.strictEqual(r.session, 'pending');
    assert.deepStrictEqual(phone.info.as.ops, ['status.*', 'storage.*', 'studio.*', 'clipboard.*', 'partnership.*', 'device.ring']);
    assert.strictEqual(r.device.status.battery.level, 81);
    assert.strictEqual(r.device.status.wifi.level, 4, 'levels are clamped');
    assert.strictEqual(r.device.status.battery.bogus, undefined);
    assert.strictEqual(r.device.online, true);

    // pending: nothing may be called yet, not even by name
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'storage.list', args: { root: 'primary', path: '' } }), 'NOT_CONNECTED');
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'bogus.thing' }), 'UNKNOWN_OP');
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'nodot' }), 'BAD_OP');
    await rejects(as.call(gr, server, phone.info, { to: PC, op: 'studio.getSession' }), 'NOT_CONNECTED');

    // the phone refuses a guest connection
    let asked = [];
    answer(phone, (op, args) => { asked.push({ op, args }); return { accept: false }; });
    r = await as.partnership(gr, server, pc.info, { action: 'propose', deviceId: DEV, mode: 'guest' });
    assert.strictEqual(r.accepted, false);
    assert.strictEqual(asked[0].op, 'partnership.propose');
    assert.strictEqual(asked[0].args.computer, 'LUMINA-XR7');
    assert.strictEqual(phone.info.as.session, 'pending');

    // it accepts as a guest with files only
    answer(phone, (op) => {
        if (op === 'partnership.propose') return { accept: true, permissions: ['files', 'sync', 'nonsense'] };
        if (op === 'storage.list') return { entries: [{ name: 'DCIM', dir: true }] };
        if (op === 'status.get') return { battery: { level: 80 } };
        throw Object.assign(new Error('nope'), { code: 'EFAIL' });
    });
    r = await as.partnership(gr, server, pc.info, { action: 'propose', deviceId: DEV, mode: 'guest' });
    assert.strictEqual(r.accepted, true);
    assert.strictEqual(r.device.session, 'guest');
    assert.deepStrictEqual(r.device.permissions, ['files'], 'a guest never gets sync, unknown names drop');
    assert.strictEqual(r.device.partner, false);

    r = await as.call(gr, server, pc.info, { to: DEV, op: 'storage.list', args: { root: 'primary', path: '' } });
    assert.deepStrictEqual(r.result.entries, [{ name: 'DCIM', dir: true }]);
    r = await as.call(gr, server, pc.info, { to: DEV, op: 'status.get' });
    assert.strictEqual(r.result.battery.level, 80, 'status needs no permission');
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'studio.getSession' }), 'NOT_PERMITTED');
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'screen.capture' }), 'NOT_PERMITTED');
    // the phone's own error comes back with its code
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'storage.delete', args: {} }), 'EFAIL');
    // too large
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'storage.list', args: { blob: 'x'.repeat(1100000) } }), 'TOO_LARGE');
    // a guest is not queued for
    phone.ws.readyState = WebSocket.CLOSED;
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'clipboard.set', args: { text: 'hi' }, queue: true }), 'OFFLINE');
    phone.ws.readyState = WebSocket.OPEN;

    // device -> computer
    answer(pc, (op, args, from) => ({ op, args, from }));
    r = await as.call(gr, server, phone.info, { to: PC, op: 'studio.setSession', args: { prompt: '1girl' } });
    assert.strictEqual(r.result.from.kind, 'device');
    assert.strictEqual(r.result.from.id, DEV);
    assert.strictEqual(r.result.args.prompt, '1girl');
    await rejects(as.call(gr, server, phone.info, { to: PC, op: 'storage.list' }), 'UNKNOWN_OP');
    await rejects(as.call(gr, server, phone.info, { to: PC, op: 'notify.show' }), 'OFFLINE'); // the computer does not list it

    // events: the device's go to administrators' computers, permission checked
    const before = pc.ws.inbox.length;
    assert.strictEqual(as.event(gr, server, phone.info, { event: 'storage.changed', detail: { root: 'primary' } }), 1);
    assert.strictEqual(as.event(gr, server, phone.info, { event: 'studio.changed', detail: {} }), 0, 'session is not granted');
    assert.strictEqual(pc.ws.inbox.length, before + 1);
    assert.strictEqual(pc.ws.inbox[before].data.event, 'storage.changed');
    assert.deepStrictEqual(pc.ws.inbox[before].data.detail, { root: 'primary' });

    // a second socket of the same device (the background service) joins the guest connection
    const svc = connect();
    r = as.hello(gr, server, svc.info, { kind: 'device', id: DEV, name: 'Galaxy Z Fold7', speaker: 'service', ops: ['status.*', 'storage.list', 'device.ring'] });
    assert.strictEqual(r.session, 'guest');
    assert.deepStrictEqual(r.device.speakers.sort(), ['service', 'webview']);
    // an op both list goes to the service (native, alive while the WebView is paused); one only the
    // WebView lists goes to the WebView
    let svcAsked = 0;
    answer(svc, () => { svcAsked += 1; return { entries: [] }; });
    await as.call(gr, server, pc.info, { to: DEV, op: 'storage.list', args: {} });
    assert.strictEqual(svcAsked, 1);
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'storage.delete', args: {} }), 'EFAIL'); // the WebView's own answer
    assert.strictEqual(svcAsked, 1);
    // the WebView goes away: the service answers, the device stays connected
    server.clients.delete(phone.ws);
    as.onSocketClosed(gr, server, phone.info);
    r = await as.call(gr, server, pc.info, { to: DEV, op: 'storage.list', args: {} });
    assert.strictEqual(svcAsked, 2);
    assert.strictEqual(as.list(gr, server).devices[0].session, 'guest');
    await rejects(as.partnership(gr, server, pc.info, { action: 'propose', deviceId: DEV, mode: 'partner', name: 'Fold' }), 'OFFLINE'); // the service shows no question
    server.clients.delete(svc.ws);
    as.onSocketClosed(gr, server, svc.info);
    assert.strictEqual(as.list(gr, server).devices[0].online, false);

    // back as a fresh connection: a guest is forgotten
    const phone2 = connect();
    r = as.hello(gr, server, phone2.info, { kind: 'device', id: DEV, name: 'Galaxy Z Fold7', ops: ['status.*', 'storage.*', 'studio.*', 'clipboard.*', 'partnership.*', 'notify.*'] });
    assert.strictEqual(r.session, 'pending');

    // partnership
    const got = [];
    answer(phone2, (op, args, from) => {
        got.push({ op, args, from });
        if (op === 'partnership.propose') return { accept: true };
        return { done: op };
    });
    r = await as.partnership(gr, server, pc.info, { action: 'propose', deviceId: DEV, mode: 'partner', name: "Yukimi's Fold!", syncItems: ['notes', 'favorites', 'junk'] });
    assert.strictEqual(r.accepted, true);
    assert.strictEqual(r.device.partner, true);
    assert.strictEqual(r.device.name, 'Yukimis Fold', 'punctuation is dropped, as Device Center refuses it');
    assert.deepStrictEqual(r.device.syncItems, ['notes', 'favorites']);
    assert.deepStrictEqual(r.device.permissions, as.PERMISSIONS);
    const changed = phone2.ws.inbox.filter((m) => m.type === 'as_event' && m.data.event === 'partnership.changed').pop();
    assert.strictEqual(changed.data.detail.session, 'partner');
    assert.strictEqual(changed.data.from.kind, 'server');

    // a second device may not take the same name
    const other = connect();
    as.hello(gr, server, other.info, { kind: 'device', id: 'ffeeddccbbaa9988', name: 'A53', ops: ['partnership.*'] });
    answer(other, () => ({ accept: true }));
    await rejects(as.partnership(gr, server, pc.info, { action: 'propose', deviceId: 'ffeeddccbbaa9988', mode: 'partner', name: 'yukimis fold' }), 'NAME_IN_USE');

    // update: name, items, settings (merged); the phone narrows permissions
    r = await as.partnership(gr, server, pc.info, { action: 'update', deviceId: DEV, syncItems: ['prints'], settings: { printsAlbum: 'Dreamscape' } });
    assert.deepStrictEqual(r.device.syncItems, ['prints']);
    r = await as.partnership(gr, server, pc.info, { action: 'update', deviceId: DEV, settings: { favoritesOnly: true } });
    assert.deepStrictEqual(r.device.settings, { printsAlbum: 'Dreamscape', favoritesOnly: true });
    r = await as.partnership(gr, server, phone2.info, { action: 'update', permissions: ['files', 'session', 'clipboard', 'notify'] });
    assert.deepStrictEqual(r.device.permissions, ['files', 'session', 'clipboard', 'notify']);
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'device.ring' }), 'NOT_PERMITTED');

    // offline: queueable ops wait, others fail; the queue goes out after hello, in order
    server.clients.delete(phone2.ws);
    as.onSocketClosed(gr, server, phone2.info);
    r = await as.call(gr, server, pc.info, { to: DEV, op: 'studio.setSession', args: { prompt: 'a' }, queue: true });
    assert.strictEqual(r.queued, true);
    r = await as.call(gr, server, pc.info, { to: DEV, op: 'clipboard.set', args: { text: 'b' }, queue: true });
    assert.strictEqual(r.queued, true);
    await as.call(gr, server, pc.info, { to: DEV, op: 'notify.show', args: { text: 'c' }, queue: true });
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'storage.list', args: {}, queue: true }), 'OFFLINE');
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'clipboard.set', args: { text: 'x' } }), 'OFFLINE');
    assert.strictEqual(as.list(gr, server).devices.find((d) => d.deviceId === DEV).queued, 3);

    const phone3 = connect();
    const delivered = [];
    answer(phone3, (op, args, from) => {
        delivered.push({ op, args, from });
        if (op === 'clipboard.set') throw Object.assign(new Error('clipboard is busy'), { code: 'BUSY' });
        return true;
    });
    // notify is granted but this socket does not list it: dropped with a log line, not kept forever
    r = as.hello(gr, server, phone3.info, { kind: 'device', id: DEV, name: 'whatever the phone says', ops: ['status.*', 'studio.*', 'clipboard.*', 'partnership.*'] });
    assert.strictEqual(r.session, 'partner');
    assert.strictEqual(r.name, 'Yukimis Fold', 'a partner keeps its partnership name');
    assert.strictEqual(await as.deliverQueue(gr, server, DEV), 2);
    assert.deepStrictEqual(delivered.map((d) => d.op), ['studio.setSession', 'clipboard.set']);
    assert.strictEqual(delivered[0].from.name, 'LUMINA-XR7');
    assert.ok(delivered[0].from.queuedAt > 0);
    assert.strictEqual(as.list(gr, server).devices.find((d) => d.deviceId === DEV).queued, 0);
    const log = as.getLog(gr, DEV, 50).map((e) => e.text);
    assert.ok(log.some((t) => /Refused by the device: clipboard\.set/.test(t)));
    assert.ok(log.some((t) => /Not delivered.*notify\.show/.test(t)));
    assert.ok(log.some((t) => /Partnership set up as "Yukimis Fold"/.test(t)));

    // a call in flight fails at once when the socket closes
    phone3.ws.onMessage = null;
    const inFlight = as.call(gr, server, pc.info, { to: DEV, op: 'studio.getSession', timeoutMs: 60000 });
    await sleep(5);
    server.clients.delete(phone3.ws);
    as.onSocketClosed(gr, server, phone3.info);
    await rejects(inFlight, 'DISCONNECTED');

    // a timeout
    const phone4 = connect();
    as.hello(gr, server, phone4.info, { kind: 'device', id: DEV, ops: ['studio.*', 'partnership.*'] });
    await rejects(as.call(gr, server, pc.info, { to: DEV, op: 'studio.getSession', timeoutMs: 1000 }), 'TIMEOUT');

    // a reply from the wrong socket is ignored
    assert.strictEqual(as.reply(pc.info, { callId: 'nope', ok: true }), false);

    // synced
    assert.strictEqual(as.markSynced(gr, server, DEV, 'Notes: 3 items'), true);
    assert.ok(as.list(gr, server).devices.find((d) => d.deviceId === DEV).lastSync > 0);

    // read-only computers get no device events
    const ro = connect('readonly');
    as.hello(gr, server, ro.info, { kind: 'computer', id: 'abcdefabcdefabcd', name: 'KIOSK', ops: ['studio.*'] });
    const roBefore = ro.ws.inbox.length;
    as.event(gr, server, phone4.info, { event: 'studio.changed', detail: {} });
    assert.strictEqual(ro.ws.inbox.length, roBefore);
    await rejects(as.call(gr, server, phone4.info, { to: 'abcdefabcdefabcd', op: 'studio.getSession' }), 'NOT_PERMITTED');

    // end: from the phone; queue cleared, session back to pending
    await as.call(gr, server, pc.info, { to: DEV, op: 'studio.setSession', args: {}, timeoutMs: 1000 }).catch(() => {});
    r = await as.partnership(gr, server, phone4.info, { action: 'end' });
    assert.strictEqual(r.device.partner, false);
    assert.strictEqual(r.device.session, 'pending');
    await rejects(as.partnership(gr, server, pc.info, { action: 'update', deviceId: DEV, name: 'x' }), 'NOT_PARTNER');

    // forget: only offline
    await rejects(Promise.resolve().then(() => as.forget(gr, server, DEV)), 'ONLINE');
    server.clients.delete(phone4.ws);
    as.onSocketClosed(gr, server, phone4.info);
    assert.strictEqual(as.forget(gr, server, DEV), true);
    assert.strictEqual(as.list(gr, server).devices.some((d) => d.deviceId === DEV), false);
    assert.deepStrictEqual(as.getLog(gr, DEV, 10), []);

    // broadcasts go to administrators that said hello only
    await sleep(350);
    const last = server.broadcasts.pop();
    assert.strictEqual(last.msg.type, 'as_peers_updated');
    assert.ok(last.to.every((info) => info.userType === 'admin' && info.as));

    as.resetForTests();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearInterval(keepAlive);
    console.log('activesync: ok');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
