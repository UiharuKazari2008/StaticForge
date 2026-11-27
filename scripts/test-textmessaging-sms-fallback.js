#!/usr/bin/env node
'use strict';
// #1279: a first iMessage text that fails (error 22) is sent again as SMS, settled by the pushed failure (no polling).
const assert = require('assert');
const { BlueBubblesProvider } = require('../modules/textMessagingBlueBubbles');

function make() {
    const calls = [];
    const p = new BlueBubblesProvider({ id: 'imessage', url: 'http://127.0.0.1:1', password: 'x' }, { emit() {}, log() {} });
    p.call = async (method, path, opts) => {
        calls.push({ method, path, body: opts && opts.body });
        if (path === 'chat/new') {
            // the Mac pushes the failure while chat/new is still answering
            if (opts.body.service !== 'SMS') p.onMessage({ guid: 'g1', isFromMe: true, error: 22, text: opts.body.message + ' ', chats: [{ guid: 'iMessage;-;+15551230000' }] }, true);
            return { guid: 'iMessage;-;+15551230000', lastMessage: null };
        }
        return null;
    };
    p.storeLive = () => {};
    p.normalizeMessage = (m) => m;
    return { p, calls };
}

(async () => {
    // 1. a failed one-person iMessage send is repeated once as SMS to the same address
    let { p, calls } = make();
    await p.sendText({ addresses: ['+15551230000'], text: 'hello' });
    await new Promise((r) => setImmediate(r));
    const news = calls.filter((c) => c.path === 'chat/new');
    assert.strictEqual(news.length, 2, 'the iMessage send and one SMS resend');
    assert.strictEqual(news[1].body.service, 'SMS');
    assert.deepStrictEqual(news[1].body.addresses, ['+15551230000']);
    assert.strictEqual(news[1].body.message, 'hello');
    assert.strictEqual(p.smsPending.size, 0, 'the waiting send is settled');

    // 2. the same failure pushed again does not resend
    p.onMessage({ guid: 'g1', isFromMe: true, error: 22, text: 'hello', chats: [{ guid: 'iMessage;-;+15551230000' }] }, true);
    await new Promise((r) => setImmediate(r));
    assert.strictEqual(calls.filter((c) => c.path === 'chat/new').length, 2);

    // 3. a group send, or a send that did not fail, waits for nothing and resends nothing
    ({ p, calls } = make());
    await p.sendText({ addresses: ['+15551230000', '+15551230001'], text: 'hi' });
    assert.ok(!p.smsPending || p.smsPending.size === 0);
    p.onMessage({ guid: 'g2', isFromMe: true, error: 0, text: 'hi', chats: [{ guid: 'iMessage;-;+15551230000' }] }, true);
    assert.strictEqual(calls.filter((c) => c.path === 'chat/new' && c.body.service === 'SMS').length, 0);
    console.log('ok: textmessaging sms fallback');
})().catch((e) => { console.error(e); process.exit(1); });
