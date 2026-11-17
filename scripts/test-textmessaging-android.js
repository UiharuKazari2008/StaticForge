#!/usr/bin/env node
/**
 * Text Messaging: Android app accounts (Yozora #885). The core with an Android app account, fed fake
 * ActiveSync notify.posted / notify.removed events; device calls are recorded, nothing reaches a phone.
 * Config and the store live in a scratch folder.
 *   node scripts/test-textmessaging-android.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(process.env.TM_TEST_DIR || os.tmpdir(), 'tm-android-'));
const config = { textMessaging: { accounts: [] } };
const secure = {};
const calls = [];
const broadcasts = [];
let tap = null;

const stub = (name, exports) => { require.cache[require.resolve(`../modules/${name}`)] = { id: name, filename: name, loaded: true, exports }; };
stub('globalResources', {
    getPath: () => tmp,
    getConfig: ({ path: p }) => config[p],
    getSecureConfig: ({ path: p }) => secure[p],
    updateConfigValue: (which, keys, value) => { (which === 'config' ? config : secure)[keys[0]] = value; },
    getWebSocketServer: () => ({ broadcast: (msg) => broadcasts.push(msg.data) }),
    getVfsManager: () => { throw new Error('no vfs in the test'); },
    getWorkspaceManager: () => ({ getWorkspaces: () => ({}) })
});
stub('activeSync', {
    onDeviceEvent: (fn) => { tap = fn; },
    partnerLinks: () => [],
    serverCall: async (_g, _w, deviceId, op, args) => { calls.push({ deviceId, op, args }); return true; }
});
const inbox = [];
stub('notificationInboxSources', { onTextEvent: (p) => { if (!p.native) inbox.push(p); } });

const tm = require('../modules/textMessaging');
const phone = require('../modules/textMessagingPhone');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const device = { id: 'dev-fold', name: 'Galaxy Z Fold7' };
const post = (d) => tap('notify.posted', Object.assign({ package: 'com.discord', app: 'Discord' }, d), device);

(async () => {
    tm.init(require('../modules/globalResources'));
    await assert.rejects(async () => tm.saveAccount({ kind: 'android' }), (e) => e.code === 'NO_PACKAGE');
    const acct = tm.saveAccount({ kind: 'android', package: 'com.discord', label: 'Discord' });
    assert.strictEqual(acct.kind, 'android');
    assert.strictEqual(acct.id, 'app-discord');
    assert.strictEqual(acct.name, 'Discord');
    assert.strictEqual(acct.settings.notify, false, 'the app already notifies on the phone');
    await assert.rejects(async () => tm.saveAccount({ kind: 'android', package: 'com.discord' }), (e) => e.code === 'EXISTS');
    await wait(20);
    assert.ok(tap, 'the provider listens to the phone');

    // a channel with two lines, a quick reply and two buttons
    const base = {
        key: '0|com.discord|1|ch1|10123', title: 'Mio', text: 'see you', time: 2000, sub: 'Night Owls',
        conv: { title: '#general', group: true, shortcut: 'channel-1' },
        messages: [{ text: 'hello', time: 1000, sender: 'Aki', senderKey: 'u1' }, { text: 'see you', time: 2000, sender: 'Mio', senderKey: 'u2' }],
        actions: [{ i: 0, title: 'Reply', reply: true }, { i: 1, title: 'Mark as Read', semantic: 2 }, { i: 2, title: 'Mute', semantic: 6 }]
    };
    post(base);
    post(base); // posted again: nothing new
    await wait(50);
    const msgEvents = broadcasts.filter((b) => b.event === 'message');
    assert.strictEqual(msgEvents.length, 2);
    assert.ok(msgEvents.every((b) => b.native === true && b.notify === false), 'no alert of our own by default');
    assert.strictEqual(inbox.filter((p) => p.event === 'message').length, 0, 'nothing for the inbox');

    phone.init(require('../modules/globalResources'));
    phone._onEvent(Object.assign({}, msgEvents[0], { notify: true }));
    assert.ok(!calls.some((c) => c.op === 'tm.notify'), 'no tm.notify for an app account');

    const { chats } = await tm.listChats('app-discord', { folder: 'inbox' });
    assert.strictEqual(chats.length, 1, 'the channel is a known conversation');
    const chat = chats[0];
    assert.strictEqual(chat.title, '#general');
    assert.strictEqual(chat.identifier, 'Night Owls');
    assert.strictEqual(chat.canReply, true);
    assert.deepStrictEqual(chat.actions.map((a) => a.title), ['Mark as Read', 'Mute']);
    assert.strictEqual(chat.unread, true);
    assert.strictEqual(chat.unreadCount, 2);
    const sum = await tm.summary();
    assert.strictEqual(sum.find((a) => a.id === 'app-discord').unread, 2);

    // a reply goes through the notification's quick reply
    const sent = await tm.send('app-discord', { chatGuid: chat.guid, text: 'on my way' });
    assert.deepStrictEqual(calls.pop(), { deviceId: 'dev-fold', op: 'notify.reply', args: { key: base.key, action: 0, text: 'on my way' } });
    assert.ok(sent.message && sent.message.fromMe);
    // Discord posts the channel again with the reply in it: still one copy of the reply
    post(Object.assign({}, base, { messages: base.messages.concat([{ text: 'on my way', time: Date.now(), me: true }]) }));
    await wait(20);
    const page = await tm.listMessages('app-discord', chat.guid);
    assert.deepStrictEqual(page.messages.map((m) => `${m.fromMe ? 'me' : m.sender.name}: ${m.text}`), ['Aki: hello', 'Mio: see you', 'me: on my way']);

    // a new line, read in Messaging: the app's own Mark as Read runs on the phone
    post(Object.assign({}, base, { messages: [{ text: 'k', time: Date.now() + 10, sender: 'Aki', senderKey: 'u1' }] }));
    await wait(20);
    assert.strictEqual((await tm.getChat('app-discord', chat.guid)).unread, true);
    await tm.markRead('app-discord', { chatGuid: chat.guid });
    await wait(10);
    assert.deepStrictEqual(calls.pop(), { deviceId: 'dev-fold', op: 'notify.action', args: { key: base.key, action: 1 } });
    assert.strictEqual((await tm.getChat('app-discord', chat.guid)).unread, false);

    // the other buttons
    await tm.action('app-discord', { chatGuid: chat.guid, action: 2 });
    assert.deepStrictEqual(calls.pop(), { deviceId: 'dev-fold', op: 'notify.action', args: { key: base.key, action: 2 } });
    await assert.rejects(tm.action('app-discord', { chatGuid: chat.guid, action: 9 }), (e) => e.code === 'NO_ACTION');

    // gone from the phone: no reply, no buttons
    tap('notify.removed', { key: base.key }, device);
    const gone = await tm.getChat('app-discord', chat.guid);
    assert.strictEqual(gone.canReply, false);
    assert.strictEqual(gone.actions.length, 0);
    await assert.rejects(tm.send('app-discord', { chatGuid: chat.guid, text: 'x' }), (e) => e.code === 'NO_REPLY');
    await assert.rejects(tm.send('app-discord', { addresses: ['someone'], text: 'x' }), (e) => e.code === 'UNSUPPORTED');

    // a removal of an unread one marks it read (read in Discord itself)
    post(Object.assign({}, base, { key: 'k2', conv: { title: 'Ren', shortcut: 'dm-ren' }, messages: [{ text: 'yo', time: Date.now() + 20, sender: 'Ren', senderKey: 'u3' }] }));
    await wait(20);
    const dm = (await tm.listChats('app-discord')).chats.find((c) => c.title === 'Ren');
    assert.strictEqual(dm.unread, true);
    broadcasts.length = 0;
    tap('notify.removed', { key: 'k2' }, device);
    assert.ok(broadcasts.some((b) => b.event === 'read' && b.chatGuid === dm.guid));
    assert.strictEqual((await tm.getChat('app-discord', dm.guid)).unread, false);

    // a plain notification (no MessagingStyle) is one line under its title
    post({ key: 'k3', title: 'Discord', text: 'Ren sent you a friend request', time: 50 });
    await wait(20);
    assert.ok((await tm.listChats('app-discord')).chats.some((c) => c.last && c.last.text === 'Ren sent you a friend request'));

    // another app is only remembered for the list
    tap('notify.posted', { package: 'com.kick.mobile', app: 'Kick', key: 'k9', title: 'Live', text: 'x is live', time: 1 }, device);
    const apps = tm.recentAndroidApps().apps;
    assert.ok(apps.find((a) => a.package === 'com.discord').added);
    assert.ok(apps.find((a) => a.package === 'com.kick.mobile' && !a.added));

    // the Notify switch turns the shell's notice on (still never Android's)
    tm.saveAccount({ id: 'app-discord', kind: 'android', settings: { notify: true } });
    await wait(20);
    broadcasts.length = 0;
    post(Object.assign({}, base, { messages: [{ text: 'ping', time: Date.now() + 30, sender: 'Aki', senderKey: 'u1' }] }));
    await wait(50);
    const pinged = broadcasts.find((b) => b.event === 'message');
    assert.ok(pinged && pinged.notify === true && pinged.native === true);

    const s = (await tm.search('ping', { accountId: 'app-discord' })).results;
    assert.strictEqual(s.length, 1);

    tm.deleteAccount('app-discord');
    tm._reset();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('test-textmessaging-android: ok');
    process.exit(0);
})().catch((e) => {
    console.error(e);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* gone */ }
    process.exit(1);
});
