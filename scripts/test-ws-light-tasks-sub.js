#!/usr/bin/env node
/*
 * #908: the app's CaféReady task host is a light Miniport sub-client (sub_open { light: 1 }): it hears only the
 * broadcast types it subscribed to (light_subscribe), never a page's boot pushes or other broadcasts.
 */
'use strict';
const assert = require('assert');
const { EventEmitter } = require('events');
const vs = require('../modules/ws/virtualSocket');
const { _test } = require('../modules/websocket');
const wsPacketRegistry = require('../modules/ws/wsPacketRegistry');

// sub_open light: the sub-client is light, a plain one is not
const carrier = new EventEmitter(); carrier.readyState = 1; carrier.send = () => {};
const made = [];
vs.handle(carrier, { type: 'sub_open', sub: 'tasks', light: 1 }, (vws) => made.push(vws));
vs.handle(carrier, { type: 'sub_open', sub: 'phone', raw: 1 }, (vws) => made.push(vws));
assert.strictEqual(made[0].light, true);
assert.ok(!made[1].light);

// broadcasts: only the subscribed types
const info = { authenticated: true, light: true, lightSubs: new Set() };
require('../modules/ws/handlers/169-lightSubscribeHandler').registerPackets();
const sent = [];
const handlers = { sendToClient: (_ws, m) => sent.push(m), sendError: (_ws, e) => sent.push({ error: e }) };
const run = (message, ci) => wsPacketRegistry.getWsPacketHandler('light_subscribe')({ ws: {}, message, clientInfo: ci, handlers });
(async () => {
    {
        await run({ type: 'light_subscribe', requestId: 'r1', types: ['traffic_updated', 'traffic_police', 'BAD TYPE', 7] }, info);
        assert.deepStrictEqual([...info.lightSubs].sort(), ['traffic_police', 'traffic_updated']);
        assert.deepStrictEqual(sent[0].data.types.sort(), ['traffic_police', 'traffic_updated']);
        const page = { authenticated: true };
        await run({ type: 'light_subscribe', types: ['x'] }, page);
        assert.ok(sent[1].error, 'a page socket is refused');
        assert.ok(!page.lightSubs);
    }
    info.lightSubs = new Set(['traffic_updated']);
    assert.strictEqual(_test.socketWantsBroadcast(info, 'traffic_updated'), true);
    assert.strictEqual(_test.socketWantsBroadcast(info, 'gallery_update'), false);
    assert.strictEqual(_test.socketWantsBroadcast(info, 'ping'), false);
    console.log('test-ws-light-tasks-sub: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
