#!/usr/bin/env node
/**
 * SideShow live screen watch (#890 P16, modules/slideshowDevices.js): the server keeps who looks at a
 * device's live screen (device_screen_watch from a page, until off or its socket closes; a screen.jpg
 * fetch for a while) and tells the device device_command screen_watch on / off when the first viewer
 * comes and the last goes; client_identify_response carries screenWatch.
 *   node scripts/test-sideshow-screen-watch.js
 */
'use strict';

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sideshow-watch-'));
const devices = require('../modules/slideshowDevices');
devices.resetForTests(tmpDir);

const sent = [];
const server = {
    clients: new Map(),
    sendToClient(ws, msg) { sent.push({ ws, msg }); },
    broadcast() {}
};
const gr = { getPath: () => tmpDir, getWebSocketServer: () => server };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const commands = (ws) => sent.filter((x) => x.ws === ws && x.msg.type === 'device_command').map((x) => x.msg.data);

(async () => {
    const ID = '0a1b2c3d4e5f';
    const frame = { readyState: 1 };
    const frameInfo = { authenticated: true, userType: 'readonly', clientId: ID, connectedAt: new Date(), deviceApp: 'DreamscapeFrame/1.1' };
    server.clients.set(frame, frameInfo);
    let r = devices.identify(gr, server, frameInfo, { kind: 'slideshow', deviceId: ID, name: 'Frame' });
    assert.strictEqual(r.screenWatch, false, 'nobody looks: no captures wanted');

    const deskA = { authenticated: true, userType: 'admin' };
    const deskB = { authenticated: true, userType: 'admin' };
    assert.strictEqual(devices.setScreenWatch(gr, server, deskA, { deviceId: ID, on: true }), true);
    assert.deepStrictEqual(commands(frame), [{ command: 'screen_watch', on: true }], 'the first viewer turns it on');
    devices.setScreenWatch(gr, server, deskB, { deviceId: ID, on: true });
    devices.setScreenWatch(gr, server, deskA, { deviceId: ID, on: true });
    assert.strictEqual(commands(frame).length, 1, 'more viewers: no more commands');
    devices.setScreenWatch(gr, server, deskA, { deviceId: ID, on: false });
    assert.strictEqual(commands(frame).length, 1, 'one viewer left: still on');

    // the device reconnects while watched: its identify reply says so
    r = devices.identify(gr, server, frameInfo, { kind: 'slideshow', deviceId: ID, name: 'Frame' });
    assert.strictEqual(r.screenWatch, true);

    // the last viewer's socket closes: off
    devices.onSocketClosed(gr, server, deskB);
    assert.deepStrictEqual(commands(frame)[1], { command: 'screen_watch', on: false });
    assert.strictEqual(devices.screenWatched(ID), false);

    // a screen.jpg fetch is a viewer for a while, then it ends by itself
    devices.addScreenViewer(gr, server, ID, 'http:sess-1', 20);
    assert.deepStrictEqual(commands(frame)[2], { command: 'screen_watch', on: true });
    devices.addScreenViewer(gr, server, ID, 'http:sess-1', 20);
    assert.strictEqual(commands(frame).length, 3, 'a second fetch only renews it');
    await sleep(1200);
    assert.deepStrictEqual(commands(frame)[3], { command: 'screen_watch', on: false }, 'expired: off');

    // not an admin page / not a device id: nothing
    assert.strictEqual(devices.setScreenWatch(gr, server, deskA, { deviceId: 'nope', on: true }), false);
    assert.strictEqual(commands(frame).length, 4);

    // an offline device: no command, and its next identify gets the state
    server.clients.delete(frame);
    devices.setScreenWatch(gr, server, deskA, { deviceId: ID, on: true });
    assert.strictEqual(commands(frame).length, 4, 'offline: nothing sent');
    server.clients.set(frame, frameInfo);
    r = devices.identify(gr, server, frameInfo, { kind: 'slideshow', deviceId: ID, name: 'Frame' });
    assert.strictEqual(r.screenWatch, true);
    devices.setScreenWatch(gr, server, deskA, { deviceId: ID, on: false });
    assert.deepStrictEqual(commands(frame)[4], { command: 'screen_watch', on: false });

    devices.resetForTests(tmpDir);
    fs.rmSync(tmpDir, { recursive: true, force: true });
    console.log('sideshow screen watch: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
