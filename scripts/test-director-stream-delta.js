#!/usr/bin/env node
/**
 * Director streaming updates and chat reloads for phones (#890 round 3), modules/cursorDirector.js:
 *  - a sleeping phone page / DeX window gets no streaming update and does not pace the stream; on
 *    waking it is sent the newest update whole (resendDirectorStream)
 *  - fullContent is left out when rows or a live row are there (P11)
 *  - live text deltas (P11): a page that said liveDelta and has the update this one builds on gets
 *    live { ...row without text, textAppend, textFrom }; others get the text whole
 *  - director_get_messages sinceId: only the messages after it, plus total; the whole list when the
 *    anchor is unknown or a draft a page was handed while its turn ran
 *   node scripts/test-director-stream-delta.js
 */
'use strict';

const assert = require('assert');
const director = require('../modules/cursorDirector');

const t = director._test;

const clients = new Map(); // ws -> info
let sent = [];
const server = {
    clients,
    broadcast(message, filter) {
        for (const [ws, info] of clients) {
            if (!filter || filter(info)) sent.push({ ws, data: JSON.parse(JSON.stringify(message.data)) });
        }
    }
};
const gr = { getWebSocketServer: () => server };
const handlerSent = [];
const handler = { sendToClient(ws, message) { handlerSent.push({ ws, data: JSON.parse(JSON.stringify(message.data)) }); } };

function client(name, info) {
    const ws = { name, readyState: 1 };
    clients.set(ws, Object.assign({ authenticated: true }, info));
    return ws;
}

const SID = 'chat-delta';
const desk = client('desk', {});
const old = client('old', {});
const phone = client('phone', { phone: { shell: 'mobile' }, lastClientRttMs: 2000 });
const dex = client('dex', {});

// pages say what they watch: the desk with row + live deltas, the old page with row deltas only
director.watchDirectorStream(handler, desk, clients.get(desk), SID, 1, 1);
director.watchDirectorStream(handler, old, clients.get(old), SID, 1);
director.watchDirectorStream(handler, phone, clients.get(phone), SID, 1, 1);
director.watchDirectorStream(handler, dex, clients.get(dex), SID, 1, 1);
assert.strictEqual(handlerSent.length, 0, 'no turn yet: nothing to send on watch');

// the phone and the DeX window fall asleep
clients.get(phone).dormant = true;
clients.get(dex).dormant = true;
clients.get(dex).dexWindow = true;
assert.strictEqual(t.watchesDirectorStream(clients.get(phone), SID), false, 'a sleeping phone page watches nothing');
assert.strictEqual(t.watchesDirectorStream(clients.get(dex), SID), false, 'a sleeping DeX window watches nothing');
assert.strictEqual(t.watchesDirectorStream(clients.get(desk), SID), true);

function push(rows, live) {
    director.queueDirectorStream(gr, {
        sessionId: SID,
        persona: 'wren',
        rows,
        live,
        fullContent: (live && live.text) || '',
        context: null,
        model: null
    }, handler, desk);
    const gate = t.streamGates.get(SID);
    assert.ok(gate, 'a gate for the chat');
    // the gaps between updates are the gate's business: this test flushes at once
    if (gate.timer) { clearTimeout(gate.timer); gate.timer = null; }
    gate.lastSent = 0;
    if (gate.inflight) gate.inflight.acked = true;
    sent = [];
    t.flushDirectorStream(SID);
    return gate;
}

const row1 = { type: 'tool', name: 'Read', detail: 'a.txt' };
let gate = push([row1], { type: 'assistant', name: null, text: 'Hel' });
assert.strictEqual(gate.rtt, 80, 'the sleeping phone (2000 ms) does not pace the stream');
let byName = (n) => sent.filter((x) => x.ws.name === n).map((x) => x.data);
assert.strictEqual(byName('phone').length, 0, 'nothing to the sleeping phone');
assert.strictEqual(byName('dex').length, 0, 'nothing to the sleeping DeX window');
let d = byName('desk')[0];
assert.ok(d && !('fullContent' in d), 'fullContent left out when rows / live are there');
assert.strictEqual(d.live.text, 'Hel', 'first update: the live text whole');
assert.strictEqual(d.rowsFrom, 0);

// the live text grows: the desk gets only the tail, the old page the text whole
gate = push([row1], { type: 'assistant', name: null, text: 'Hello, world' });
d = byName('desk')[0];
assert.strictEqual(d.live.text, undefined, 'no text on a live delta');
assert.strictEqual(d.live.textAppend, 'lo, world');
assert.strictEqual(d.live.textFrom, 3);
assert.strictEqual(d.live.type, 'assistant', 'the row\'s other fields stay');
assert.strictEqual(d.rowsFrom, 1, 'row deltas as before');
assert.strictEqual(d.prevSeq, 1);
let o = byName('old')[0];
assert.strictEqual(o.live.text, 'Hello, world', 'a page without liveDelta gets the text whole');
assert.ok(!('textAppend' in o.live));
assert.ok(!('fullContent' in o), 'never on a delta');

// another live row (a new one starts): whole again
gate = push([row1, { type: 'assistant', text: 'Hello, world' }], { type: 'thinking', name: null, text: 'Hmm' });
d = byName('desk')[0];
assert.strictEqual(d.live.text, 'Hmm', 'another row: its text whole');
assert.ok(!('textAppend' in d.live));

// a text that is not the old one with more at its end: whole
gate = push([row1, { type: 'assistant', text: 'Hello, world' }], { type: 'thinking', name: null, text: 'Hm, no' });
d = byName('desk')[0];
assert.strictEqual(d.live.text, 'Hm, no');

// the phone wakes: the newest update whole, then live deltas build on it
clients.get(phone).dormant = false;
handlerSent.length = 0;
assert.strictEqual(director.resendDirectorStream(handler, phone, clients.get(phone)), true);
assert.strictEqual(handlerSent.length, 1);
assert.strictEqual(handlerSent[0].data.live.text, 'Hm, no', 'the whole newest update');
assert.strictEqual(handlerSent[0].data.rowsFrom, undefined, 'a full update (no rowsFrom): a new base');
assert.ok(!('fullContent' in handlerSent[0].data));
gate = push([row1, { type: 'assistant', text: 'Hello, world' }], { type: 'thinking', name: null, text: 'Hm, no, yes' });
const p = byName('phone')[0];
assert.ok(p, 'the awake phone gets updates again');
assert.strictEqual(p.live.textAppend, ', yes');
assert.strictEqual(p.live.textFrom, 6);
assert.strictEqual(byName('dex').length, 0, 'the DeX window still sleeps');

// a page that just opened the chat: the whole update now, deltas after it
const late = client('late', {});
handlerSent.length = 0;
director.watchDirectorStream(handler, late, clients.get(late), SID, 1, 1);
assert.strictEqual(handlerSent.length, 1);
assert.strictEqual(handlerSent[0].data.live.text, 'Hm, no, yes');
gate = push([row1, { type: 'assistant', text: 'Hello, world' }], { type: 'thinking', name: null, text: 'Hm, no, yes!' });
assert.strictEqual(byName('late')[0].live.textAppend, '!');

// a page that missed an update (its seq is not the one this builds on) gets the text whole
clients.get(late).directorStreamSeq = 1;
gate = push([row1, { type: 'assistant', text: 'Hello, world' }], { type: 'thinking', name: null, text: 'Hm, no, yes!!' });
assert.strictEqual(byName('late')[0].live.text, 'Hm, no, yes!!');

// a new turn of the same chat (a new gate) never builds on the old one's seq
director._test.dropDirectorStream(SID);
gate = push([], { type: 'assistant', name: null, text: 'A' });
gate = push([], { type: 'assistant', name: null, text: 'AB' });
assert.strictEqual(byName('desk')[0].live.textAppend, 'B');
director._test.dropDirectorStream(SID);

// streamWireData / liveTextAppend
assert.deepStrictEqual(t.streamWireData({ rows: [], fullContent: 'x' }), { rows: [] });
assert.deepStrictEqual(t.streamWireData({ fullContent: 'x' }), { fullContent: 'x' }, 'kept without rows or live');
assert.strictEqual(t.liveTextAppend({ type: 'a', name: 'n', text: 'ab' }, { type: 'a', name: 'm', text: 'abc' }), null, 'another name');
assert.strictEqual(t.liveTextAppend(null, { type: 'a', text: 'x' }), null);

// ---- director_get_messages sinceId
const msgs = [{ id: 'u1', role: 'user', content: 'hi' }, { id: 'a1', role: 'assistant' }, { id: 'u2', role: 'user', content: 'more' }, { id: 'a2', role: 'assistant' }];
const chat = { id: 'chat-since', name: 'C', messages: msgs, images: [], prints: [], tasks: [] };
let r = director.messagesReply(chat, msgs, null, null, 'Director');
assert.strictEqual(r.messages.length, 4, 'no sinceId: the whole chat');
assert.strictEqual(r.total, 4);
assert.ok(!r.partial && !('sinceId' in r));
r = director.messagesReply(chat, msgs, 'a1', null, 'Director');
assert.deepStrictEqual(r.messages.map((m) => m.id), ['u2', 'a2'], 'only what came after');
assert.strictEqual(r.total, 4);
assert.strictEqual(r.partial, true);
assert.strictEqual(r.sinceId, 'a1');
r = director.messagesReply(chat, msgs, 'a2', null, 'Director');
assert.deepStrictEqual(r.messages, [], 'nothing new');
assert.strictEqual(r.partial, true);
r = director.messagesReply(chat, msgs, 'gone', null, 'Director');
assert.strictEqual(r.messages.length, 4, 'an unknown anchor: the whole chat');
assert.ok(!r.partial);
// a turn runs (draft a2): the draft is no anchor, and a page handed it keeps getting the whole chat
r = director.messagesReply(chat, msgs, 'a2', 'a2', 'Director');
assert.strictEqual(r.messages.length, 4, 'the running draft: the whole chat');
r = director.messagesReply(chat, msgs, 'a1', 'a2', 'Director');
assert.deepStrictEqual(r.messages.map((m) => m.id), ['u2', 'a2'], 'a partial reply may carry the draft');
r = director.messagesReply(chat, msgs, 'a2', null, 'Director');
assert.strictEqual(r.messages.length, 4, 'the turn ended: a draft a page was handed is still no anchor');
assert.strictEqual(r.messages[0].content, 'hi', 'public message shape');
r = director.messagesReply(chat, msgs, 'u2', null, 'Director');
assert.deepStrictEqual(r.messages.map((m) => m.id), ['a2'], 'messages before the handed draft still anchor');

console.log('director stream delta: ok');
process.exit(0);
