'use strict';

/**
 * Continuity shared connection (Yozora #798 slice F): a page that reaches the server through another
 * page's socket. On a hybrid phone the DeX window has no socket of its own: the phone window carries
 * its packets over the app's in-process bus (DSApp ContinuityBus, melatonContinuity.js) and over its own
 * socket, wrapped:
 *
 *   phone page -> server   { type: 'sub_open', sub }              a sub-client starts
 *                          { type: 'sub_packet', sub, data }      one packet of it (the raw JSON text)
 *                          { type: 'sub_close', sub }             it ended (the DeX window closed)
 *   server -> phone page   { type: 'sub_packet', sub, data }      a packet for it
 *                          { type: 'sub_closed', sub }            the server ended it
 *
 * The server builds a VirtualSocket for each sub-client and hands it to its normal connection handler
 * with the carrier's HTTP request (same session cookie, same address), so the sub-client is a full
 * client of its own: its own clientId, shell, workspace, ActiveSync role, subscriptions. No handler
 * knows the difference. The carrier closing closes its sub-clients.
 */

const EventEmitter = require('events');

const OPEN = 1;
const CLOSED = 3;
const MAX_SUBS = 4;

class VirtualSocket extends EventEmitter {
    constructor(carrier, sub) {
        super();
        this.carrier = carrier;
        this.sub = sub;
        this.readyState = OPEN;
        this.bufferedAmount = 0;
        this.binaryType = 'nodebuffer';
        this.virtual = true;
    }

    send(data, opts, cb) {
        const done = typeof opts === 'function' ? opts : cb;
        if (this.readyState !== OPEN || !this.carrier || this.carrier.readyState !== OPEN) {
            if (done) done(new Error('closed'));
            return;
        }
        // a phone page that said so (sub_open raw) takes text packets as "\u0001<sub>\u0001<packet>": it
        // relays them to the DeX window without parsing them first (#798)
        if (!Buffer.isBuffer(data) && this.carrier._dsRaw) {
            this.carrier.send(`\u0001${this.sub}\u0001${String(data)}`, done);
            return;
        }
        // text packets travel as they are; a binary frame (rare: HTTP carries files) as base64
        const packet = Buffer.isBuffer(data) ? { type: 'sub_packet', sub: this.sub, binary: data.toString('base64') } : { type: 'sub_packet', sub: this.sub, data: String(data) };
        this.carrier.send(JSON.stringify(packet), done);
    }

    // the carrier is alive while it answers its own heartbeat: the sub-client answers at once
    ping() { setImmediate(() => { if (this.readyState === OPEN) this.emit('pong'); }); }

    pong() { /* nothing to answer */ }

    close(code = 1000, reason = '') {
        if (this.readyState === CLOSED) return;
        this.readyState = CLOSED;
        // the phone page drops it too (unless the carrier itself is what went away)
        if (this.carrier && this.carrier.readyState === OPEN && !this._fromCarrier) {
            try { this.carrier.send(JSON.stringify({ type: 'sub_closed', sub: this.sub })); } catch (_) { /* carrier gone */ }
        }
        setImmediate(() => this.emit('close', code, Buffer.from(String(reason || ''))));
    }

    terminate() { this.close(1006, 'terminated'); }
}

const subsOf = new WeakMap(); // carrier socket -> Map(sub -> VirtualSocket)

/**
 * One message to many sockets (broadcast, sendToUser): a sub-client whose carrier gets the same message
 * is not sent its own copy over the same socket; the carrier's copy names it in _cc and the phone page
 * relays that text to the DeX window (#798). send(ws, payloadString) does the sending.
 */
function sendCoalesced(recipients, message, send) {
    const all = new Set(recipients);
    const cc = new Map();
    for (const ws of recipients) {
        const c = ws && ws.virtual ? ws.carrier : null;
        if (c && c._dsCc && all.has(c) && c.readyState === OPEN && ws.readyState === OPEN) {
            if (!cc.has(c)) cc.set(c, []);
            cc.get(c).push(ws.sub);
            all.delete(ws);
        }
    }
    let plain = null;
    for (const ws of all) {
        const subs = cc.get(ws);
        if (subs) { send(ws, JSON.stringify(Object.assign({}, message, { _cc: subs }))); continue; }
        if (plain === null) plain = JSON.stringify(message);
        send(ws, plain);
    }
}

/**
 * A carrier's sub_* packet. connect(vws, req) runs the server's connection handler for a new sub-client.
 * True when the packet was one of these (the caller then stops).
 */
function handle(carrier, message, connect) {
    const type = message && message.type;
    if (type !== 'sub_open' && type !== 'sub_packet' && type !== 'sub_close') return false;
    const sub = String(message.sub || '').slice(0, 32);
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(sub)) return true;
    let subs = subsOf.get(carrier);
    if (!subs) { subs = new Map(); subsOf.set(carrier, subs); }
    if (type === 'sub_open') {
        // what the phone page understands: raw relayed packets, and broadcasts sent once with _cc (#798)
        if (message.raw) carrier._dsRaw = true;
        if (message.cc) carrier._dsCc = true;
        const old = subs.get(sub);
        if (old) { old._fromCarrier = true; old.close(1001, 'reopened'); subs.delete(sub); }
        if (subs.size >= MAX_SUBS) return true;
        const vws = new VirtualSocket(carrier, sub);
        subs.set(sub, vws);
        vws.once('close', () => { if (subs.get(sub) === vws) subs.delete(sub); });
        connect(vws, carrier._dsReq || { headers: {}, url: '/' });
        return true;
    }
    const vws = subs.get(sub);
    if (!vws) {
        // a packet for a sub-client the server no longer has: tell the phone page to start it again
        if (type === 'sub_packet' && carrier.readyState === OPEN) carrier.send(JSON.stringify({ type: 'sub_closed', sub }));
        return true;
    }
    if (type === 'sub_close') { vws._fromCarrier = true; vws.close(1000, 'closed by the phone'); return true; }
    if (typeof message.data === 'string') vws.emit('message', Buffer.from(message.data));
    return true;
}

/** The carrier went away: its sub-clients go with it. */
function closeAll(carrier) {
    const subs = subsOf.get(carrier);
    if (!subs) return;
    subs.forEach((vws) => { vws._fromCarrier = true; vws.close(1001, 'carrier closed'); });
    subs.clear();
}

module.exports = { VirtualSocket, handle, closeAll, sendCoalesced };
