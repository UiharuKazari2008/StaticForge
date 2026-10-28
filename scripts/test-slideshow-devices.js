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
            return { items: rows[id] || [], totalItems: (rows[id] || []).length };
        },
        async getLightweightMetadata(names) { return Object.fromEntries(names.map((n) => [n, { mtime: now, width: 1, height: 1 }])); }
    };
    const wm = { getWorkspaces: () => ({ a: {}, b: {} }), getActiveWorkspace: () => 'b' };
    const ctx = { metadataDb: fakeDb, workspaceManager: wm, sessionId: 's', runSearch: async () => [`${now - 3 * 86400000}_old.png`, 's2.png', `${now - 1000}_new.png`] };
    devices.clearImageCache();
    let pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ workspaces: ['*'] }));
    assert.deepStrictEqual(pics.items.map((i) => i.filename), ['a1.png', 'b1.png', 'a2.png']);
    devices.clearImageCache();
    pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ workspaces: ['*'], maxAgeDays: 30 }));
    assert.deepStrictEqual(pics.items.map((i) => i.filename), ['a1.png', 'b1.png']);
    devices.clearImageCache();
    pics = await devices.resolveImages(ctx, {});
    assert.deepStrictEqual(pics.items.map((i) => i.filename), ['b1.png'], 'no workspaces = the active one');
    devices.clearImageCache();
    pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ search: { blocks: [{ terms: ['cat'] }] }, poolSize: 2 }));
    assert.deepStrictEqual(pics.items.map((i) => i.filename), [`${now - 1000}_new.png`, `${now - 3 * 86400000}_old.png`], 'search: newest first by filename time');
    assert.strictEqual(pics.total, 2, 'poolSize caps the rotation');
    pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ search: { blocks: [{ terms: ['cat'] }] } }), { offset: 1, limit: 1 });
    assert.strictEqual(pics.total, 3, 'no poolSize = every match');
    assert.strictEqual(pics.items.length, 1);
    const a1 = await devices.resolveImages(ctx, devices.sanitizeSettings({ workspaces: ['*'] }), { seed: 42, limit: 10 });
    const a2 = await devices.resolveImages(ctx, devices.sanitizeSettings({ workspaces: ['*'] }), { seed: 42, limit: 10 });
    assert.deepStrictEqual(a1.items.map((i) => i.filename), a2.items.map((i) => i.filename), 'same seed, same order');
    assert.strictEqual(a1.items.length, 3);
    pics = await devices.resolveImages(ctx, devices.sanitizeSettings({ search: { blocks: [{ terms: ['cat'] }] }, maxAgeDays: 2 }));
    assert.deepStrictEqual(pics.items.map((i) => i.filename), [`${now - 1000}_new.png`]);
    assert.strictEqual(devices.sanitizeSettings({ search: { blocks: [] } }).search, undefined);

    // forget
    assert.strictEqual(devices.forget(gr, server, ID), true);
    assert.strictEqual(devices.listDevices(gr, server).length, 0);

    await deviceConfigCases();

    console.log('slideshow devices: ok');
}

// device-specific settings and gadgets (DS-SlideShow-win64/docs/DEVICE_CONFIG_PROTOCOL.md)
const FACES = [{ id: 'swiss-railway', name: 'Swiss railway', kind: 'analog' }, { id: 'digital-seconds', name: 'Digital with seconds', kind: 'digital' }];
const SCHEMA = [
    { key: 'mode', label: 'Showing', group: 'Display', type: 'enum', live: true, options: [{ value: 'slideshow', label: 'Slideshow' }, { value: 'clock', label: 'Clock' }] },
    { key: 'clockFace', label: 'Clock face', group: 'Display', type: 'enum', live: true, options: FACES.map((f) => ({ value: f.id, label: f.name })) },
    { key: 'ring.offsetY', label: 'Ring offset Y', group: 'Ring', type: 'int', min: -4000, max: 4000, step: 1, unit: 'px', futureProp: 'ignored' },
    { key: 'ring.feather', label: 'Feather', group: 'Ring', type: 'number', min: 0, max: 1 },
    { key: 'overlay.notice', label: 'Notice text', group: 'Overlay', type: 'string', maxLength: 40 },
    { key: 'weather.enabled', label: 'Weather', group: 'Weather', type: 'bool' },
    { key: 'future.thing', label: 'Future', group: 'Other', type: 'color' },
    { key: 'schedule.enabled', label: 'Use time frames', group: 'Clock time frames', type: 'bool', live: true },
    {
        key: 'schedule.entries', label: 'Time frames', group: 'Clock time frames', type: 'list', live: true, maxItems: 2,
        item: [
            { key: 'start', label: 'From', type: 'time' }, { key: 'end', label: 'Until', type: 'time' }, { key: 'days', label: 'Days', type: 'days' },
            { key: 'mode', label: 'Show', type: 'enum', options: [{ value: 'clock', label: 'Clock' }, { value: 'slideshow', label: 'Slideshow' }] },
            { key: 'face', label: 'Clock face', type: 'enum', options: FACES.map((f) => ({ value: f.id, label: f.name })) }
        ]
    }
];
const VALUES = { mode: 'slideshow', clockFace: 'swiss-railway', 'ring.offsetY': -54, 'ring.feather': 0.2, 'overlay.notice': 'Energy Saving Mode', 'weather.enabled': true, 'future.thing': '#fff', 'schedule.enabled': false, 'schedule.entries': [], bogus: 1 };
const GADGETS = {
    mode: 'slideshow', face: 'swiss-railway', selectedMode: 'slideshow', selectedFace: 'swiss-railway', scheduleEntry: null,
    available: [{ id: 'slideshow', name: 'Slideshow' }, { id: 'clock', name: 'Clock', faces: FACES }]
};

async function deviceConfigCases() {
    const ID = '98c028fab534';
    const OLD = 'aabbccddeeff';
    const ident = (info, extra) => devices.identify(gr, server, info, Object.assign({ kind: 'slideshow', deviceId: info.clientId, name: 'plgwacca', app: 'DreamscapeFrame-Win/1.0' }, extra));
    const connect = (id) => {
        const ws = socket();
        const info = { authenticated: true, userType: 'readonly', clientId: id, connectedAt: new Date(), deviceApp: 'DreamscapeFrame-Win/1.0' };
        server.clients.set(ws, info);
        return { ws, info };
    };
    const lastCommand = (ws) => server.sent.filter((s) => s.ws === ws && s.msg.type === 'device_command').pop();
    const find = (id) => devices.listDevices(gr, server).find((x) => x.deviceId === id);

    // identify with deviceConfig + gadgets; a device without them has none
    const cab = connect(ID);
    ident(cab.info, { deviceConfig: { version: 1, schema: SCHEMA, values: VALUES }, gadgets: GADGETS });
    const tablet = connect(OLD);
    ident(tablet.info, {});
    let d = find(ID);
    assert.strictEqual(d.deviceConfig.schema.length, SCHEMA.length);
    assert.strictEqual(d.deviceConfig.schema[2].futureProp, 'ignored', 'unknown descriptor properties are kept for the panel');
    assert.strictEqual(d.deviceConfig.values['ring.offsetY'], -54);
    assert.strictEqual(d.deviceConfig.values.bogus, undefined, 'values for keys outside the schema are dropped');
    assert.deepStrictEqual(d.gadgets.available.map((g) => g.id), ['slideshow', 'clock']);
    assert.strictEqual(d.gadgets.available[1].faces[1].kind, 'digital');
    assert.strictEqual(d.pendingDeviceConfig, null);
    assert.strictEqual(find(OLD).deviceConfig, null);
    assert.strictEqual(find(OLD).gadgets, null);
    await sleep(300);
    const upd = server.broadcasts[server.broadcasts.length - 1];
    assert.strictEqual(upd.msg.type, 'devices_updated');
    assert.ok(upd.msg.data.devices.find((x) => x.deviceId === ID).deviceConfig, 'devices_updated carries deviceConfig');

    // validation against the stored schema
    const v = devices.validateDeviceConfig(d.deviceConfig, {
        'ring.offsetY': 4001, 'ring.feather': 0.5, 'overlay.notice': 'x'.repeat(41), 'weather.enabled': 'yes', mode: 'tv', nope: 1, 'future.thing': '#000',
        'schedule.entries': [{ start: '22:00', end: '07:00', days: [], mode: 'clock', face: 'swiss-railway', extra: 1 }]
    });
    assert.deepStrictEqual(Object.keys(v.config).sort(), ['ring.feather', 'schedule.entries']);
    assert.deepStrictEqual(v.config['schedule.entries'], [{ start: '22:00', end: '07:00', days: [], mode: 'clock', face: 'swiss-railway' }]);
    assert.deepStrictEqual(Object.keys(v.rejected).sort(), ['future.thing', 'mode', 'nope', 'overlay.notice', 'ring.offsetY', 'weather.enabled']);
    const listErr = (entries) => devices.validateDeviceConfig(d.deviceConfig, { 'schedule.entries': entries }).rejected['schedule.entries'];
    assert.match(listErr([{ start: '24:00' }]), /time/);
    assert.match(listErr([{ days: [7] }]), /weekdays/);
    assert.match(listErr([{ days: [1, 1] }]), /twice/);
    assert.match(listErr([{ face: 'sundial' }]), /choices/);
    assert.match(listErr([{}, {}, {}]), /at most 2/);
    assert.match(listErr('x'), /list/);
    assert.strictEqual(devices.validateDeviceConfig(d.deviceConfig, { 'ring.offsetY': 1.5 }).rejected['ring.offsetY'], 'must be a whole number');

    // invalid set_device_config: nothing is sent, the reasons come back per key
    const before = server.sent.length;
    await assert.rejects(devices.sendCommand(gr, server, { deviceId: ID, command: 'set_device_config', config: { 'ring.offsetY': 9999, 'overlay.notice': 'Closed' } }),
        (err) => err.code === 'BAD_DEVICE_CONFIG' && /at most 4000/.test(err.rejected['ring.offsetY']) && !err.rejected['overlay.notice']);
    assert.strictEqual(server.sent.length, before);
    await assert.rejects(devices.sendCommand(gr, server, { deviceId: OLD, command: 'set_device_config', config: { a: 1 } }), (err) => err.code === 'NO_DEVICE_CONFIG');
    await assert.rejects(devices.sendCommand(gr, server, { deviceId: OLD, command: 'set_mode', mode: 'clock' }), (err) => err.code === 'BAD_MODE');

    // valid set_device_config: relayed, the ack's applied / rejected / restarting come back
    let p = devices.sendCommand(gr, server, { deviceId: ID, command: 'set_device_config', config: { 'ring.offsetY': -60, 'overlay.notice': 'Closed' } });
    let cmd = lastCommand(cab.ws);
    assert.deepStrictEqual(cmd.msg.data, { command: 'set_device_config', config: { 'ring.offsetY': -60, 'overlay.notice': 'Closed' } });
    devices.commandAck(cab.info, { commandId: cmd.msg.commandId, data: { ok: false, applied: ['ring.offsetY'], rejected: { 'overlay.notice': 'the cabinet said no' }, restarting: true } });
    let res = await p;
    assert.strictEqual(res.success, false);
    assert.deepStrictEqual(res.applied, ['ring.offsetY']);
    assert.deepStrictEqual(res.rejected, { 'overlay.notice': 'the cabinet said no' });
    assert.strictEqual(res.restarting, true);

    // client_device_config replaces the stored copy and refreshes the panels
    assert.strictEqual(devices.deviceConfigReport(gr, server, tablet.info, { deviceId: ID, deviceConfig: { schema: SCHEMA, values: {} } }), false, 'another device cannot report for it');
    const nBroadcasts = server.broadcasts.length;
    assert.strictEqual(devices.deviceConfigReport(gr, server, cab.info, {
        deviceId: ID, deviceConfig: { version: 1, schema: SCHEMA, values: Object.assign({}, VALUES, { 'ring.offsetY': -60 }) }, gadgets: GADGETS
    }), true);
    assert.strictEqual(find(ID).deviceConfig.values['ring.offsetY'], -60);
    await sleep(300);
    assert.ok(server.broadcasts.length > nBroadcasts);
    assert.strictEqual(server.broadcasts[server.broadcasts.length - 1].msg.data.devices.find((x) => x.deviceId === ID).deviceConfig.values['ring.offsetY'], -60);

    // set_mode round trip, then the state report moves the gadgets
    await assert.rejects(devices.sendCommand(gr, server, { deviceId: ID, command: 'set_mode', mode: 'clock', face: 'sundial' }), (err) => err.code === 'BAD_FACE');
    p = devices.sendCommand(gr, server, { deviceId: ID, command: 'set_mode', mode: 'clock', face: 'digital-seconds' });
    cmd = lastCommand(cab.ws);
    assert.deepStrictEqual(cmd.msg.data, { command: 'set_mode', mode: 'clock', face: 'digital-seconds' });
    devices.commandAck(cab.info, { commandId: cmd.msg.commandId, data: { ok: true, applied: ['mode', 'clockFace'], rejected: {}, restarting: false } });
    res = await p;
    assert.strictEqual(res.success, true);
    assert.deepStrictEqual(res.applied, ['mode', 'clockFace']);
    devices.deviceState(gr, server, cab.info, { deviceId: ID, state: 'showing', showing: [], mode: 'clock', face: 'digital-seconds', scheduleEntry: 1 });
    d = find(ID);
    assert.strictEqual(d.gadgets.mode, 'clock');
    assert.strictEqual(d.gadgets.face, 'digital-seconds');
    assert.strictEqual(d.gadgets.scheduleEntry, 1);
    devices.deviceState(gr, server, cab.info, { deviceId: ID, state: 'showing', showing: ['a.png'], mode: 'slideshow', face: 'digital-seconds', scheduleEntry: null });
    assert.strictEqual(find(ID).gadgets.mode, 'slideshow');
    assert.strictEqual(find(ID).gadgets.scheduleEntry, null);

    // offline: both queue into pending_device_config (set_mode as mode / clockFace) ...
    devices.deviceState(gr, server, cab.info, { deviceId: ID, state: 'stopped', showing: [] });
    server.clients.delete(cab.ws);
    devices.onSocketClosed(gr, server, cab.info);
    const q1 = await devices.sendCommand(gr, server, { deviceId: ID, command: 'set_device_config', config: { 'overlay.notice': 'Closed', 'schedule.enabled': true } });
    assert.strictEqual(q1.queued, true);
    const q2 = await devices.sendCommand(gr, server, { deviceId: ID, command: 'set_mode', mode: 'clock', face: 'swiss-railway' });
    assert.strictEqual(q2.queued, true);
    await assert.rejects(devices.sendCommand(gr, server, { deviceId: ID, command: 'set_device_config', config: { 'ring.offsetY': 'far' } }), /Not valid/);
    d = find(ID);
    assert.strictEqual(d.online, false);
    assert.deepStrictEqual(d.pendingDeviceConfig, { 'overlay.notice': 'Closed', 'schedule.enabled': true, mode: 'clock', clockFace: 'swiss-railway' });
    assert.strictEqual(d.deviceConfig.values['ring.offsetY'], -60, 'an offline device still shows its last-known config');

    // ... and go out as one set_device_config right after the next identify, then are cleared
    const cab2 = connect(ID);
    const r = ident(cab2.info, { deviceConfig: { version: 1, schema: SCHEMA, values: VALUES }, gadgets: GADGETS });
    assert.strictEqual(r.success, true);
    const commandId = devices.deliverPendingDeviceConfig(gr, server, cab2.info);
    assert.ok(commandId);
    cmd = lastCommand(cab2.ws);
    assert.strictEqual(cmd.msg.commandId, commandId);
    assert.deepStrictEqual(cmd.msg.data, { command: 'set_device_config', config: { 'overlay.notice': 'Closed', 'schedule.enabled': true, mode: 'clock', clockFace: 'swiss-railway' } });
    assert.strictEqual(find(ID).pendingDeviceConfig, null);
    assert.strictEqual(devices.commandAck(cab2.info, { commandId, data: { ok: true, applied: ['overlay.notice'], rejected: {}, restarting: false } }), true);
    assert.strictEqual(devices.deliverPendingDeviceConfig(gr, server, cab2.info), null, 'nothing left to send');

    // the sqlite columns survive a reopen (an offline device keeps its config)
    devices.resetForTests(tmpDir);
    assert.strictEqual(devices.listDevices(gr, server).find((x) => x.deviceId === ID).deviceConfig.schema.length, SCHEMA.length);

    // a database from before device config is migrated in place
    const oldDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slideshow-devices-old-'));
    const Database = require('better-sqlite3');
    const old = new Database(path.join(oldDir, 'slideshow_devices.db'));
    old.exec(`CREATE TABLE slideshow_devices (device_id TEXT PRIMARY KEY, kind TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', app TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '', os TEXT NOT NULL DEFAULT '', display TEXT NOT NULL DEFAULT '{}', settings TEXT NOT NULL DEFAULT '{}',
        pending_settings TEXT, pending_name TEXT, last_state TEXT, first_seen INTEGER NOT NULL, last_seen INTEGER NOT NULL)`);
    old.prepare("INSERT INTO slideshow_devices (device_id, kind, name, first_seen, last_seen) VALUES ('0123456789ab', 'slideshow', 'Old tablet', 1, 1)").run();
    old.close();
    const migrated = devices.resetForTests(oldDir);
    assert.ok(['device_config', 'gadgets', 'pending_device_config'].every((c) => migrated.prepare('PRAGMA table_info(slideshow_devices)').all().some((x) => x.name === c)));
    const oldGr = { getPath: () => oldDir, getWebSocketServer: () => server };
    const oldDev = devices.listDevices(oldGr, server).find((x) => x.deviceId === '0123456789ab');
    assert.strictEqual(oldDev.name, 'Old tablet');
    assert.strictEqual(oldDev.deviceConfig, null);
    assert.strictEqual(oldDev.pendingDeviceConfig, null);
}

main().then(() => {
    try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) { /* Windows: the sqlite file is still open */ }
    process.exit(0);
}).catch((err) => {
    console.error(err);
    process.exit(1);
});
