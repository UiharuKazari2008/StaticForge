#!/usr/bin/env node
/**
 * modules/ws/virtualSocket.js (Yozora #798 slice F): a sub-client carried by another socket.
 *   node scripts/test-virtual-socket.js
 */
'use strict';

const assert = require('assert');
const EventEmitter = require('events');
const vs = require('../modules/ws/virtualSocket');

const tick = () => new Promise((r) => setImmediate(r));

class FakeCarrier extends EventEmitter {
    constructor() { super(); this.readyState = 1; this.out = []; this._dsReq = { headers: { cookie: 'sid=1' }, url: '/' }; }
    send(text, cb) { this.out.push(JSON.parse(text)); if (cb) cb(); }
}

(async () => {
    const carrier = new FakeCarrier();
    let accepted = null;
    let acceptedReq = null;
    const connect = (vws, req) => { accepted = vws; acceptedReq = req; };

    // not ours: the normal handler runs
    assert.strictEqual(vs.handle(carrier, { type: 'ping' }, connect), false);

    // open: the server's connection handler gets a socket with the carrier's request
    assert.strictEqual(vs.handle(carrier, { type: 'sub_open', sub: 'desktop' }, connect), true);
    assert.ok(accepted && accepted.virtual && accepted.sub === 'desktop');
    assert.strictEqual(acceptedReq, carrier._dsReq);

    // the server sends: it goes out wrapped on the carrier
    accepted.send(JSON.stringify({ type: 'connection', status: 'connected' }));
    assert.deepStrictEqual(carrier.out.pop(), { type: 'sub_packet', sub: 'desktop', data: '{"type":"connection","status":"connected"}' });

    // the page sends: the virtual socket hears it as a message
    const got = [];
    accepted.on('message', (d) => got.push(String(d)));
    vs.handle(carrier, { type: 'sub_packet', sub: 'desktop', data: '{"type":"ping"}' }, connect);
    assert.deepStrictEqual(got, ['{"type":"ping"}']);

    // heartbeat: a ping is answered
    let ponged = false;
    accepted.on('pong', () => { ponged = true; });
    accepted.ping();
    await tick();
    assert.ok(ponged);

    // a packet for an unknown sub: the phone is told to start again
    vs.handle(carrier, { type: 'sub_packet', sub: 'other', data: '{}' }, connect);
    assert.deepStrictEqual(carrier.out.pop(), { type: 'sub_closed', sub: 'other' });

    // the server closes it: the phone hears sub_closed, close fires
    let closed = 0;
    accepted.on('close', () => { closed++; });
    accepted.close(1000, 'bye');
    await tick();
    assert.strictEqual(closed, 1);
    assert.deepStrictEqual(carrier.out.pop(), { type: 'sub_closed', sub: 'desktop' });
    assert.strictEqual(accepted.readyState, 3);

    // reopened, then the carrier goes away: the sub-client closes without writing to it
    vs.handle(carrier, { type: 'sub_open', sub: 'desktop' }, connect);
    const second = accepted;
    let closed2 = 0;
    second.on('close', () => { closed2++; });
    const before = carrier.out.length;
    vs.closeAll(carrier);
    await tick();
    assert.strictEqual(closed2, 1);
    assert.strictEqual(carrier.out.length, before);

    // bad sub ids are ignored
    assert.strictEqual(vs.handle(carrier, { type: 'sub_open', sub: '../x' }, () => { throw new Error('no'); }), true);
    console.log('virtualSocket: ok');
})().catch((e) => { console.error(e); process.exit(1); });
