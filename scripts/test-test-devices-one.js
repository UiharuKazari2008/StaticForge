#!/usr/bin/env node
'use strict';

/**
 * The one-device test notice (#1309 / #1312): POST /api/test-devices/:id/notice in modules/testDevicesRoute.js.
 * The inbox is stubbed and the routes are mounted on a fake app, so nothing reaches a phone or a real inbox.
 *
 *   node scripts/test-test-devices-one.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-devices-one-'));
process.env.TEST_DEVICES_FILE = path.join(tmp, 'test-devices.json');

const testDevices = require('../modules/testDevices');
const inboxPath = require.resolve('../modules/notificationInbox');
const published = [];
const caughtUp = [];
require.cache[inboxPath] = {
    id: inboxPath, filename: inboxPath, loaded: true,
    exports: {
        publish: (n) => { published.push(n); return Object.assign({ createdAt: 1 }, n); },
        catchUpPhone: (id) => { caughtUp.push(id); return 1; },
        list: () => [], clear: () => true, deliveries: () => []
    }
};

const routes = { get: {}, post: {}, put: {}, delete: {} };
const chains = {};
const app = {};
for (const m of Object.keys(routes)) app[m] = (p, ...handlers) => { routes[m][p] = handlers[handlers.length - 1]; chains[`${m} ${p}`] = handlers; };
require('../modules/testDevicesRoute').mount(app, (req, res, next) => next(), {});

function call(handler, { params = {}, body = {}, userType = 'admin' } = {}) {
    return new Promise((resolve) => {
        const res = {
            headersSent: false, code: 200,
            status(c) { this.code = c; return this; },
            json(o) { this.headersSent = true; resolve({ code: this.code, body: o }); }
        };
        const req = { params, body, userType, query: {} };
        handler(req, res);
    });
}

(async () => {
    const route = routes.post['/api/test-devices/:id/notice'];
    assert.ok(route, 'the one-device route is mounted');
    const dev = 'a'.repeat(32);
    const other = 'b'.repeat(32);

    // admin only: the chain is auth, admin, handler
    let r = await new Promise((resolve) => {
        const chain = chains['post /api/test-devices/:id/notice'];
        const res = { headersSent: false, code: 200, status(c) { this.code = c; return this; }, json(o) { this.headersSent = true; resolve({ code: this.code, body: o }); } };
        chain[1]({ userType: 'user', params: { id: dev }, body: { title: 'x' } }, res, () => resolve({ code: 200, passed: true }));
    });
    assert.strictEqual(r.code, 403);

    // not marked: 404, nothing stored
    r = await call(route, { params: { id: dev }, body: { title: 'x' } });
    assert.strictEqual(r.code, 404);
    assert.strictEqual(published.length, 0);

    testDevices.mark(dev, { name: 'Lane aemu-fold-1' });
    testDevices.mark(other, { name: 'Lane aemu-a53-1' });

    // push: stored without the live send to all, then THAT device's catch-up only
    r = await call(route, { params: { id: dev.toUpperCase() }, body: { title: 'One', text: 't', id: 'lane:1' } });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body.deviceId, dev);
    assert.strictEqual(r.body.mode, 'push');
    assert.strictEqual(r.body.sent, 1);
    assert.strictEqual(published.length, 1);
    assert.strictEqual(published[0].push, false, 'no live send to every test device');
    assert.strictEqual(published[0].user, 'test');
    assert.strictEqual(published[0].id, 'lane:1');
    assert.strictEqual(published[0].data.kind, 'test');
    assert.deepStrictEqual(caughtUp, [dev]);

    // get: stored only, no catch-up
    r = await call(route, { params: { id: other }, body: { title: 'Two', mode: 'get', cls: 'sms', data: { kind: 'sms', chatGuid: 'g' } } });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(r.body.mode, 'get');
    assert.strictEqual(r.body.sent, 0);
    assert.strictEqual(published.length, 2);
    assert.strictEqual(published[1].cls, 'sms');
    assert.strictEqual(published[1].data.kind, 'sms');
    assert.deepStrictEqual(caughtUp, [dev]);

    // not stored: 400 (no catch-up)
    require.cache[inboxPath].exports.publish = () => null;
    r = await call(route, { params: { id: dev }, body: { title: 'Three' } });
    assert.strictEqual(r.code, 400);
    assert.deepStrictEqual(caughtUp, [dev]);

    // the all-devices route still pushes live
    require.cache[inboxPath].exports.publish = (n) => { published.push(n); return Object.assign({ createdAt: 1 }, n); };
    r = await call(routes.post['/api/test-devices/notice'], { body: { title: 'All' } });
    assert.strictEqual(r.code, 200);
    assert.strictEqual(published[published.length - 1].push, true);

    console.log('test-test-devices-one: ok');
})().catch((e) => { console.error(e); process.exit(1); });
