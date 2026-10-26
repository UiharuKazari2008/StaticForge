'use strict';

// Slideshow devices (Yozora #654, modules/slideshowDevices.js): identify, state, commands and
// their acks, offline queueing into the next identify reply, forget, and that device sockets
// stay out of agent auto-bind (listClients) while list_clients still shows them.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const WebSocket = require('ws');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slideshow-devices-'));
const devices = require('../modules/slideshowDevices');
devices.resetForTests(tmpDir);

function fakeServer() {
    const sent = [];
    const broadcasts = [];
    const server = {
        clients: new Map(),
        sent,
        broadcasts,
        sendToClient(ws, msg) { sent.push({ ws, msg }); },
        broadcast(msg, filter) {
            const to = [];
            for (const info of server.clients.values()) if (!filter || filter(info)) to.push(info);
            broadcasts.push({ msg, to });
        }
    };
    return server;
}

function socket() {
    return { readyState: WebSocket.OPEN };
}

const gr = { getPath: () => tmpDir, getWebSocketServer: () => server };
const server = fakeServer();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
    const ID = '3fa94c0e12ab';
    const desk = socket();
    server.clients.set(desk, { authenticated: true, userType: 'admin', clientId: 'aaaaaaaaaaaa', connectedAt: new Date() });

    // bad kind / id
    assert.throws(() => devices.identify(gr, server, {}, { kind: 'toaster', deviceId: ID }), /kind/);
    assert.throws(() => devices.identify(gr, server, {}, { kind: 'slideshow', deviceId: 'XYZ' }), /deviceId/);

    // first identify
    const tab = socket();
    const tabInfo = { authenticated: true, userType: 'readonly', clientId: ID, connectedAt: new Date(), deviceApp: 'DreamscapeFrame/1.1' };
    server.clients.set(tab, tabInfo);
    const r1 = devices.identify(gr, server, tabInfo, {
        kind: 'slideshow', deviceId: ID, name: 'Living room tablet '.repeat(10), app: 'DreamscapeFrame/1.1',
        model: 'Pixel Tablet', os: 'Android 17', display: { width: 2560, height: 1600, orientation: 'landscape' },
        settings: { viewType: 'images', intervalSec: 45, poolSize: 60, shuffle: true, pairPortraits: true, infoOverlay: 'minimal', bogus: 1 }
    });
    assert.strictEqual(r1.success, true);
    assert.ok(r1.name.length <= 64);
    assert.strictEqual(r1.settings, undefined);
    assert.strictEqual(tabInfo.deviceId, ID);
    let list = devices.listDevices(gr, server);
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].online, true);
    assert.deepStrictEqual(list[0].settings, { viewType: 'images', intervalSec: 45, poolSize: 60, shuffle: true, pairPortraits: true, infoOverlay: 'minimal' });

    // devices_updated goes to the admin desktop only, coalesced
    await sleep(300);
    assert.ok(server.broadcasts.length >= 1);
    const last = server.broadcasts[server.broadcasts.length - 1];
    assert.strictEqual(last.msg.type, 'devices_updated');
    assert.ok(last.to.every((i) => !i.deviceId && !i.deviceApp));

    // state
    assert.strictEqual(devices.deviceState(gr, server, tabInfo, { deviceId: ID, state: 'showing', showing: ['../a.png', 'b.png', 'c.png'], since: 1761400000000 }), true);
    assert.strictEqual(devices.deviceState(gr, server, tabInfo, { deviceId: ID, state: 'dancing' }), false);
    list = devices.listDevices(gr, server);
    assert.deepStrictEqual(list[0].showing, ['a.png', 'b.png']);
    assert.strictEqual(list[0].state, 'showing');

    // command + ack
    const pending = devices.sendCommand(gr, server, { deviceId: ID, command: 'next' });
    const cmd = server.sent.find((s) => s.ws === tab && s.msg.type === 'device_command');
    assert.ok(cmd && cmd.msg.commandId);
    assert.strictEqual(devices.commandAck({ deviceId: 'ffffffffffff' }, { commandId: cmd.msg.commandId, data: { ok: true } }), false);
    assert.strictEqual(devices.commandAck(tabInfo, { commandId: cmd.msg.commandId, data: { ok: true } }), true);
    const res = await pending;
    assert.strictEqual(res.success, true);

    await assert.rejects(devices.sendCommand(gr, server, { deviceId: ID, command: 'explode' }), /Unknown device command/);
    await assert.rejects(devices.sendCommand(gr, server, { deviceId: ID, command: 'show' }), /filename/);

    // offline: stopped, then the socket closes
    devices.deviceState(gr, server, tabInfo, { deviceId: ID, state: 'stopped', showing: [] });
    server.clients.delete(tab);
    devices.onSocketClosed(gr, server, tabInfo);
    list = devices.listDevices(gr, server);
    assert.strictEqual(list[0].online, false);
    await assert.rejects(devices.sendCommand(gr, server, { deviceId: ID, command: 'next' }), /offline/);
    const q1 = await devices.sendCommand(gr, server, { deviceId: ID, command: 'set_settings', settings: { intervalSec: 2, shuffle: false, viewType: 'nope' } });
    assert.strictEqual(q1.queued, true);
    const q2 = await devices.sendCommand(gr, server, { deviceId: ID, command: 'rename', name: 'Kitchen' });
    assert.strictEqual(q2.queued, true);
    list = devices.listDevices(gr, server);
    assert.strictEqual(list[0].name, 'Kitchen');
    assert.strictEqual(list[0].settings.intervalSec, 5);
    assert.deepStrictEqual(list[0].pendingSettings, { intervalSec: 5, shuffle: false });

    // reconnect: the identify reply carries the queued changes, then they are cleared
    const tab2 = socket();
    const tab2Info = { authenticated: true, userType: 'readonly', clientId: ID, connectedAt: new Date(), deviceApp: 'DreamscapeFrame/1.1' };
    server.clients.set(tab2, tab2Info);
    const r2 = devices.identify(gr, server, tab2Info, { kind: 'slideshow', deviceId: ID, name: 'Living room tablet', settings: { intervalSec: 45, shuffle: true } });
    assert.strictEqual(r2.name, 'Kitchen');
    assert.deepStrictEqual(r2.settings, { intervalSec: 5, shuffle: false });
    list = devices.listDevices(gr, server);
    assert.strictEqual(list[0].online, true, 'a fresh identify is online even after a stopped last_state');
    assert.strictEqual(list[0].pendingSettings, null);
    assert.strictEqual(list[0].settings.intervalSec, 5);
    const r3 = devices.identify(gr, server, tab2Info, { kind: 'slideshow', deviceId: ID, name: 'Kitchen', settings: {} });
    assert.strictEqual(r3.settings, undefined);

    // agent bind: the tablet is hidden from auto-bind, shown on list_clients
    const bridge = require('../modules/agentClientBridge');
    const bindable = bridge.listClients(gr, null);
    assert.ok(bindable.every((c) => c.clientId !== ID));
    const all = bridge.listClients(gr, null, { includeDevices: true });
    const dev = all.find((c) => c.clientId === ID);
    assert.ok(dev && dev.kind === 'slideshow' && dev.name === 'Kitchen' && dev.bindable === false && dev.desktopReady === false);

    // picture sources: workspaces, age, Image Search
    const now = Date.now();
    const fakeDb = {
        async listWorkspaceGalleryItemsPaginated(id) {
            const rows = { a: [{ original: 'a1.png', mtime: now - 1000 }, { original: 'a2.png', mtime: now - 40 * 86400000 }], b: [{ original: 'b1.png', mtime: now - 2000, width: 10, height: 20 }] };
            return { items: rows[id] || [] };
        },
        async getLightweightMetadata(names) { return Object.fromEntries(names.map((n) => [n, { mtime: now, width: 1, height: 1 }])); }
    };
    const wm = { getWorkspaces: () => ({ a: {}, b: {} }), getActiveWorkspace: () => 'b' };
    const ctx = { metadataDb: fakeDb, workspaceManager: wm, sessionId: 's', runSearch: async () => [`${now - 3 * 86400000}_old.png`, 's2.png', `${now - 1000}_new.png`] };
    let pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ workspaces: ['*'] }));
    assert.deepStrictEqual(pics.items.map((i) => i.filename), ['a1.png', 'b1.png', 'a2.png']);
    pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ workspaces: ['*'], maxAgeDays: 30 }));
    assert.deepStrictEqual(pics.items.map((i) => i.filename), ['a1.png', 'b1.png']);
    pics = await devices.resolveImages(ctx, {});
    assert.deepStrictEqual(pics.items.map((i) => i.filename), ['b1.png'], 'no workspaces = the active one');
    pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ search: { blocks: [{ terms: ['cat'] }] }, poolSize: 2 }));
    assert.deepStrictEqual(pics.items.map((i) => i.filename), [`${now - 1000}_new.png`, `${now - 3 * 86400000}_old.png`], 'search: newest first by filename time');
    assert.strictEqual(pics.total, 3);
    pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ search: { blocks: [{ terms: ['cat'] }] }, maxAgeDays: 2 }));
    assert.deepStrictEqual(pics.items.map((i) => i.filename), [`${now - 1000}_new.png`]);
    assert.strictEqual(devices.sanitizeSettings({ search: { blocks: [] } }).search, undefined);

    // forget
    assert.strictEqual(devices.forget(gr, server, ID), true);
    assert.strictEqual(devices.listDevices(gr, server).length, 0);

    console.log('slideshow devices: ok');
}

main().then(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    process.exit(0);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
