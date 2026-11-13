#!/usr/bin/env node
/**
 * Text Messaging (Yozora #779): the BlueBubbles provider against a fake BlueBubbles REST server,
 * and the core's known / unknown sorting and notify rule. No real server, no socket.io.
 *   node scripts/test-textmessaging.js
 */
'use strict';

const http = require('http');
const assert = require('assert');
const { BlueBubblesProvider, reactionOf, handleKey } = require('../modules/textMessagingBlueBubbles');

const PASSWORD = 'pw';
const sent = [];
const chats = [
    { guid: 'iMessage;-;+15551230001', chatIdentifier: '+15551230001', displayName: '', style: 45, participants: [{ address: '+15551230001', service: 'iMessage' }],
        lastMessage: { guid: 'm2', text: 'hello', isFromMe: false, dateCreated: 2000, handle: { address: '+15551230001', service: 'iMessage' } } },
    { guid: 'SMS;-;+15559990000', chatIdentifier: '+15559990000', displayName: '', style: 45, participants: [{ address: '+15559990000', service: 'SMS' }],
        lastMessage: { guid: 'm9', text: 'Your code is 1234', isFromMe: false, dateCreated: 3000, handle: { address: '+15559990000', service: 'SMS' } } }
];
const messages = [
    { guid: 'm1', text: 'hi ￼', isFromMe: true, dateCreated: 1000, attachments: [{ guid: 'a1', transferName: 'IMG_1.HEIC', mimeType: 'image/heic', totalBytes: 10 }] },
    { guid: 'm2', text: 'hello', isFromMe: false, dateCreated: 2000, handle: { address: '+15551230001' } },
    { guid: 'r1', associatedMessageGuid: 'p:0/m1', associatedMessageType: 'love', isFromMe: false, dateCreated: 2100, handle: { address: '+15551230001' } },
    { guid: 'r2', associatedMessageGuid: 'p:0/m1', associatedMessageType: 2001, isFromMe: true, dateCreated: 2200 },
    { guid: 'r3', associatedMessageGuid: 'p:0/m1', associatedMessageType: '-love', isFromMe: false, dateCreated: 2300, handle: { address: '+15551230001' } }
];

function server() {
    return http.createServer((req, res) => {
        const u = new URL(req.url, 'http://x');
        const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ status, data })); };
        if (u.searchParams.get('password') !== PASSWORD) { send(401, null); return; }
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
            const p = u.pathname.replace('/api/v1/', '');
            if (p === 'ping') return send(200, 'pong');
            if (p === 'server/info') return send(200, { private_api: true, detected_icloud: 'me@icloud.com', server_version: '1.9.9' });
            if (p === 'contact') return send(200, [{ displayName: 'Alice', phoneNumbers: [{ address: '(555) 123-0001' }], emails: [] }]);
            if (p === 'chat/query') return send(200, chats);
            if (p.startsWith('chat/') && p.endsWith('/message')) return send(200, messages.slice().reverse());
            if (p === 'message/text') { const b = JSON.parse(raw); sent.push(b); return send(200, { guid: 'm10', text: b.message, isFromMe: true, dateCreated: 4000 }); }
            send(404, null);
        });
    });
}

(async () => {
    assert.strictEqual(reactionOf('love'), 'love');
    assert.strictEqual(reactionOf(3003), '-laugh');
    assert.strictEqual(reactionOf('sticker'), null);
    assert.strictEqual(handleKey('+1 (555) 123-0001'), handleKey('5551230001'));

    const srv = server();
    await new Promise((r) => srv.listen(0, '127.0.0.1', r));
    const url = `http://127.0.0.1:${srv.address().port}`;

    const bad = new BlueBubblesProvider({ id: 't', url, password: 'nope' }, {});
    await assert.rejects(bad.test(), (e) => e.code === 'BAD_PASSWORD');

    const events = [];
    const p = new BlueBubblesProvider({ id: 't', url, password: PASSWORD }, { emit: (e, d) => events.push([e, d]) });
    p.info = await p.test();
    assert.strictEqual(p.identity(), 'me@icloud.com');
    assert.strictEqual(p.features().tapbacks, true);

    const list = await p.listChats();
    assert.strictEqual(list.length, 2);
    assert.strictEqual(list[0].title, 'Alice', 'contact name from the iPhone contacts');
    assert.strictEqual(list[0].unread, true);
    assert.strictEqual(list[1].title, '+15559990000');

    const page = await p.listMessages(chats[0].guid);
    assert.deepStrictEqual(page.messages.map((m) => m.guid), ['m1', 'm2'], 'tapbacks fold into their targets, oldest first');
    const m1 = page.messages[0];
    assert.strictEqual(m1.text, 'hi', 'the attachment placeholder goes');
    assert.strictEqual(m1.attachments[0].thumbUrl, '/api/textmessaging/t/attachment/a1?thumb=1');
    assert.deepStrictEqual(m1.reactions.map((r) => r.type), ['like'], "Alice's love was taken back; my like stays");

    const out = await p.sendText({ chatGuid: chats[0].guid, text: 'yo', replyTo: 'm2' });
    assert.strictEqual(out.message.text, 'yo');
    assert.strictEqual(sent[0].method, 'private-api');
    assert.strictEqual(sent[0].selectedMessageGuid, 'm2');

    p.onMessage({ guid: 'r9', associatedMessageGuid: 'p:0/m2', associatedMessageType: 'laugh', isFromMe: true, chats: [{ guid: chats[0].guid }] }, false);
    p.onMessage({ guid: 'm11', text: 'new', isFromMe: false, handle: { address: '+15551230001' }, chats: [{ guid: chats[0].guid }] }, false);
    assert.strictEqual(events[0][0], 'reaction');
    assert.strictEqual(events[0][1].targetGuid, 'm2');
    assert.strictEqual(events[1][0], 'message');
    assert.strictEqual(events[1][1].message.sender.name, 'Alice');

    srv.close();
    console.log('test-textmessaging: ok');
})().catch((error) => { console.error(error); process.exit(1); });
