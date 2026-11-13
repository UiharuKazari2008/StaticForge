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
    assert.strictEqual(list[0].title, '+15559990000', 'newest conversation first');
    assert.strictEqual(list[1].title, 'Alice', 'contact name from the iPhone contacts');
    assert.strictEqual(list[1].unread, true);

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

    // RCS: Google Messages protojson into the same shapes
    const { RcsProvider, unb64url } = require('../modules/textMessagingRcs');
    const rev = [];
    const r = new RcsProvider({ id: 'rcs' }, { emit: (e, d) => rev.push([e, d]) }, { cacheDir: '/nonexistent' });
    r.onSettings({ SIMCards: [{ SIMData: { formattedPhoneNumber: '(555) 010-7788' } }] });
    assert.strictEqual(r.identity(), '(555) 010-7788');
    const conv = { conversationID: 'c1', name: '', isGroupChat: false, unread: true, type: 'RCS', defaultOutgoingID: 'p0', lastMessageTimestamp: '1731400000000000',
        latestMessage: { displayContent: 'yo', fromMe: '0' }, participants: [{ ID: { participantID: 'p0', number: '+15550107788' }, isMe: true }, { ID: { participantID: 'p1', number: '+15553330003' }, fullName: 'Kenji', contactID: '42' }] };
    const chat = r.normalizeChat(conv);
    assert.strictEqual(chat.title, 'Kenji');
    assert.strictEqual(chat.last.date, 1731400000000);
    assert.strictEqual(chat.unread, true);
    const raw = { messageID: 'm1', conversationID: 'c1', participantID: 'p1', timestamp: '1731400001000000', messageStatus: { status: 'INCOMING_COMPLETE' },
        messageInfo: [{ messageContent: { content: 'look' } }, { mediaContent: { mediaID: 'MID', decryptionKey: 'S0VZ', mimeType: 'image/jpeg', mediaName: 'a.jpg', thumbnailMediaID: 'TID', thumbnailDecryptionKey: 'VEs=' } }],
        reactions: [{ data: { unicode: '\u2764\uFE0F', type: 'LOVE' }, participantIDs: ['p0'] }], replyMessage: { messageID: 'm0' } };
    r.onMessage(raw, false);
    r.onMessage(Object.assign({}, raw), false);
    r.onMessage(Object.assign({}, raw, { reactions: [] }), false);
    assert.deepStrictEqual(rev.map((e) => e[0]), ['account', 'message', 'updated'], 'a repeat is quiet, a change is an update');
    const m = rev[1][1].message;
    assert.strictEqual(m.sender.name, 'Kenji');
    assert.strictEqual(m.text, 'look');
    assert.strictEqual(m.replyTo, 'm0');
    assert.deepStrictEqual(m.reactions.map((x) => [x.type, x.fromMe]), [['love', true]]);
    assert.strictEqual(unb64url(m.attachments[0].guid.slice(1)).m, 'MID');
    assert.ok(m.attachments[0].thumbUrl.endsWith('?thumb=1'));
    assert.strictEqual(r.normalizeMessage({ messageID: 'm2', conversationID: 'c1', messageStatus: { status: 'OUTGOING_DISPLAYED' }, timestamp: '1' }).dateRead, 1 / 1000 > 0 ? 1 : 1);

    // the store: chats newest first, messages by chat, full-text search, delete
    const os = require('os'); const fs = require('fs'); const pth = require('path');
    const dir = fs.mkdtempSync(pth.join(os.tmpdir(), 'tmstore-'));
    const store = require('../modules/textMessagingStore');
    store.open(dir);
    store.putChats('a', [{ guid: 'c1', raw: { guid: 'c1' }, lastDate: 10 }, { guid: 'c2', raw: { guid: 'c2' }, lastDate: 20 }]);
    assert.deepStrictEqual(store.listChats('a').map((c) => c.guid), ['c2', 'c1']);
    store.putMessages('a', [{ guid: 'm1', chatGuid: 'c1', date: 1, text: 'Pizza tonight?', raw: { guid: 'm1' } }, { guid: 'm2', chatGuid: 'c1', date: 2, text: 'sure', raw: { guid: 'm2' } }]);
    assert.deepStrictEqual(store.listMessages('a', ['c1'], { limit: 1 }).map((m) => m.guid), ['m2']);
    assert.deepStrictEqual(store.listMessages('a', ['c1'], { before: 2 }).map((m) => m.guid), ['m1']);
    assert.deepStrictEqual(store.search('piz').map((r) => r.guid), ['m1'], 'prefix search');
    store.putMessages('a', [{ guid: 'm1', chatGuid: 'c1', date: 1, text: 'edited text', raw: { guid: 'm1' } }]);
    assert.strictEqual(store.search('pizza').length, 0, 'an edit replaces the indexed text');
    store.deleteChat('a', 'c1');
    assert.strictEqual(store.messageCount('a'), 0);
    store._close();
    fs.rmSync(dir, { recursive: true, force: true });

    console.log('test-textmessaging: ok');
})().catch((error) => { console.error(error); process.exit(1); });
