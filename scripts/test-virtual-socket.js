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

    // raw + cc (#798): a phone page that asked gets unwrapped packets, and a broadcast once with _cc
    const rawOut = [];
    const raw = { readyState: 1, send(d, cb) { rawOut.push(d); if (cb) cb(); } };
    let sub3 = null;
    vs.handle(raw, { type: 'sub_open', sub: 'desktop', raw: 1, cc: 1 }, (v) => { sub3 = v; });
    sub3.send('{"type":"x"}');
    assert.strictEqual(rawOut.pop(), '\u0001desktop\u0001{"type":"x"}');
    const other = { readyState: 1 };
    const sent = [];
    vs.sendCoalesced([raw, sub3, other], { type: 'b' }, (ws, p) => sent.push([ws, p]));
    assert.strictEqual(sent.length, 2);
    assert.deepStrictEqual(JSON.parse(sent.find((x) => x[0] === raw)[1]), { type: 'b', _cc: ['desktop'] });
    assert.deepStrictEqual(JSON.parse(sent.find((x) => x[0] === other)[1]), { type: 'b' });
    // the sub-client alone (its carrier not a recipient): its own copy
    const alone = [];
    vs.sendCoalesced([sub3], { type: 'c' }, (ws, p) => alone.push(ws));
    assert.deepStrictEqual(alone, [sub3]);

    // Melaton Miniport (#815): no session -> refused; with one it carries subs, answers ping, one _cc copy
    {
        const EventEmitter = require('events');
        const mk = () => { const e = new EventEmitter(); e.readyState = 1; e.sent = []; e.send = (d, cb) => { e.sent.push(d); if (cb) cb(); }; e.closed = null; e.close = (c) => { e.closed = c; }; e.ping = () => {}; e.terminate = () => {}; return e; };
        const anon = mk();
        vs.acceptMiniport(anon, { headers: {} }, { authenticated: false }, () => { throw new Error('no'); });
        assert.strictEqual(anon.closed, 1008);
        const mp = mk();
        const subs = {};
        vs.acceptMiniport(mp, { headers: {}, url: '/?miniport=1' }, { authenticated: true, sessionId: 's1' }, (v) => { subs[v.sub] = v; });
        assert.strictEqual(JSON.parse(mp.sent.shift()).type, 'miniport_ready');
        mp.emit('message', Buffer.from(JSON.stringify({ type: 'sub_open', sub: 'phone' })));
        mp.emit('message', Buffer.from(JSON.stringify({ type: 'sub_open', sub: 'desktop' })));
        assert.ok(subs.phone && subs.desktop, 'both pages are sub-clients');
        mp.emit('message', Buffer.from(JSON.stringify({ type: 'ping', t: 5 })));
        assert.deepStrictEqual(JSON.parse(mp.sent.pop()), { type: 'pong', t: 5 });
        subs.desktop.send('{"type":"only-dex"}');
        assert.strictEqual(mp.sent.pop(), '\u0001desktop\u0001{"type":"only-dex"}', 'targeted packets raw');
        const out = [];
        vs.sendCoalesced([subs.phone, subs.desktop], { type: 'bc' }, (ws, p) => out.push([ws, p]));
        assert.strictEqual(out.length, 1, 'one copy for both pages');
        assert.strictEqual(out[0][0], mp);
        assert.deepStrictEqual(JSON.parse(out[0][1]), { type: 'bc', _cc: ['phone', 'desktop'] });
        let gone = 0;
        subs.phone.on('close', () => { gone++; });
        mp.emit('close');
        await tick();
        assert.strictEqual(gone, 1, 'subs end with the Miniport');
    }

    // bad sub ids are ignored
    assert.strictEqual(vs.handle(carrier, { type: 'sub_open', sub: '../x' }, () => { throw new Error('no'); }), true);
    console.log('virtualSocket: ok');
})().catch((e) => { console.error(e); process.exit(1); });
