#!/usr/bin/env node
'use strict';
// A flood of mail is one stacked notice, one sound; the order is time first (Yozora #1098):
//   node scripts/test-notification-inbox-stack.js
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

const activeSync = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');
const src = require('../modules/notificationInboxSources');

const toPhones = [];
const clearedOnPhones = [];
activeSync.sendInboxNotice = (gr, ws, notice) => { toPhones.push(notice); return 1; };
activeSync.sendInboxCleared = (gr, ws, n) => { clearedOnPhones.push(n.id); return 1; };
const pushed = [];
const gr = { getWebSocketServer: () => ({ broadcast: (m) => pushed.push(m) }) };
let now = Date.parse('2026-11-25T12:00:00Z');
inbox._test.setNow(() => now);
inbox.bind(gr);

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed += 1; };

const mail = (uid, extra) => Object.assign({ event: 'new', notify: true, accountId: 'acc1', folder: 'INBOX', uids: [uid], message: { uid, folder: 'INBOX', seen: false, from: [{ name: `Sender ${uid}`, address: `s${uid}@x.test` }], subject: `Subject ${uid}` } }, extra);
const stackRow = () => inbox.list('admin').find((n) => n.id === 'stack:mail');
const mailRows = () => inbox.list('admin').filter((n) => /^(mail|dmail|stack):/.test(n.id));

(async () => {
    // 1. ten mails in a row: one row, count 10, one sound, items newest first with their own ids / data
    const outs = [];
    for (let i = 1; i <= 10; i += 1) {
        now += 1000;
        src.onMailEvent(mail(i));
        outs.push(toPhones[toPhones.length - 1]);
    }
    eq(mailRows().map((n) => n.id), ['stack:mail'], 'ten mails are one row');
    const st = stackRow();
    eq(st.cls, 'mail'); eq(st.app, 'messaging'); eq(st.actions, ['view']);
    eq(st.data.stack, 'mail'); eq(st.data.count, 10); eq(st.data.lastAt, now);
    eq(st.title, '10 New E-mail Messages');
    eq(st.data.items.map((x) => x.id), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((i) => `mail:acc1:INBOX:${i}`), 'items newest first, each with its own id');
    eq(st.data.items[0].data, { app: 'messaging', kind: 'mail', accountId: 'acc1', folder: 'INBOX', uid: 10, from: 'Sender 10', subject: 'Subject 10' }, 'an item keeps its own data');
    eq(st.data.items[0].title, 'New E-mail Message'); eq(st.data.items[0].actions, ['view']);
    eq(st.text.split('\n'), ['Sender 10 - Subject 10', 'Sender 9 - Subject 9', 'Sender 8 - Subject 8', 'Sender 7 - Subject 7', 'Sender 6 - Subject 6', 'Sender 5 - Subject 5', '+ 4 more'], 'six lines then + k more');
    eq(toPhones.length, 10, 'every update reaches the phones (a silent one posts in place)');
    eq(outs.map((n) => n.alert), [true, false, false, false, false, false, false, false, false, false], 'one sound, nine silent');
    eq(new Set(toPhones.map((n) => n.id)), new Set(['stack:mail']), 'one notification id on the phones');
    const sounds = pushed.filter((m) => m.type === 'inbox_updated' && m.data.reason === 'new' && m.data.notice.alert === true).length;
    eq(sounds, 1, 'one loud inbox_updated');
    eq(st.createdAt, Date.parse('2026-11-25T12:00:01Z'), 'createdAt kept from the first');
    eq(inbox.count('admin'), 1, 'the title bar counts one notice');

    // 2. one mail alone is itself
    // (checked in step 5 after a fresh stack) - 3. the same item again stays one, silent
    toPhones.length = 0;
    now += 1000;
    src.onMailEvent(mail(5, { message: Object.assign(mail(5).message, { subject: 'Subject 5 edited' }) }));
    let r = stackRow();
    eq(r.data.count, 10, 're-published item: count unchanged');
    eq(r.data.items.length, 10);
    eq(r.data.items.map((x) => x.id), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((i) => `mail:acc1:INBOX:${i}`), 'in place');
    eq(r.data.items[5].data.subject, 'Subject 5 edited', 'replaced content');
    eq(toPhones.map((n) => n.alert), [false], 'silent');

    // 4. clear one item: count 9, silent; the phones and pages are told like a silent update
    toPhones.length = 0;
    pushed.length = 0;
    now += 1000;
    ok(inbox.clear('admin', 'mail:acc1:INBOX:3', 'page'), 'clear of an item answers true');
    r = stackRow();
    eq(r.data.count, 9); eq(r.title, '9 New E-mail Messages');
    ok(!r.data.items.some((x) => x.id === 'mail:acc1:INBOX:3'));
    eq(toPhones.map((n) => [n.id, n.alert]), [['stack:mail', false]], 'silent update to the phones');
    eq(pushed.filter((m) => m.type === 'inbox_updated').map((m) => [m.data.reason, m.data.notice.alert]), [['new', false]], 'inbox_updated, silent');
    // the same through the source (read elsewhere / removed) and an unknown id
    src.onMailEvent({ event: 'removed', accountId: 'acc1', folder: 'INBOX', uids: [4] });
    eq(stackRow().data.count, 8);
    eq(inbox.clear('admin', 'mail:nowhere:INBOX:1'), false, 'an id that is neither a row nor an item');
    // account deletion removes only that account's items
    now += 1000;
    src.onMailEvent(mail(1, { accountId: 'acc2', message: Object.assign(mail(1).message) }));
    eq(stackRow().data.count, 9);
    src.onMailEvent({ event: 'account', accountId: 'acc2', deleted: true });
    r = stackRow();
    eq(r.data.count, 8, 'clearWhere takes one account out of the live stack');
    ok(!r.data.items.some((x) => x.id.startsWith('mail:acc2:')));

    // 5. clear everything: the stack is cleared
    clearedOnPhones.length = 0;
    for (const uid of [1, 2, 5, 6, 7, 8, 9, 10]) now += 1, src.onMailEvent({ event: 'removed', accountId: 'acc1', folder: 'INBOX', uids: [uid] });
    ok(!stackRow(), 'no stack row once the last item is gone');
    eq(inbox.get('admin', 'stack:mail').state, 'cleared');
    ok(clearedOnPhones.includes('stack:mail'), 'the phones take their notification down');
    eq(inbox.count('admin'), 0);

    // 6. a lone mail is its own title and text; the next one makes a stack, silent
    toPhones.length = 0;
    now += 1000;
    src.onMailEvent(mail(21));
    r = stackRow();
    eq(toPhones[0].alert, true, 'a mail after a cleared stack is loud');
    eq(r.title, 'New E-mail Message'); eq(r.text, 'From: Sender 21\nSubject 21'); eq(r.data.count, 1);
    eq(r.data.items.length, 1);

    // 7. ack the stack (whole), then a new mail -> loud, count 1
    now += 1000;
    src.onMailEvent(mail(22));
    eq(toPhones[1].alert, false); eq(stackRow().data.count, 2);
    ok(inbox.ack('admin', 'stack:mail', 'seen'));
    now += 1000;
    src.onMailEvent(mail(23));
    eq(toPhones[2].alert, false, 'a seen (put away) stack is still live: silent'); eq(stackRow().data.count, 3);
    ok(inbox.ack('admin', 'stack:mail', 'acted', 'phone'));
    eq(stackRow().state, 'acted', 'the whole stack is acted');
    now += 1000;
    src.onMailEvent(mail(24));
    r = stackRow();
    eq(toPhones[3].alert, true, 'the next mail after the ack is loud');
    eq(r.data.count, 1); eq(r.data.items.map((x) => x.id), ['mail:acc1:INBOX:24']); eq(r.state, 'new');
    eq(r.createdAt, now, 'a new stack starts now');

    // 8. Dovecote mail joins the same stack
    toPhones.length = 0;
    now += 1000;
    src.onDovecoteNewMail({ id: 77, mailbox: 'yukimi', from: 'Dove <d@x.test>', subject: 'Hello' });
    r = stackRow();
    eq(r.data.count, 2); eq(r.data.items[0].id, 'dmail:77'); eq(r.data.items[0].data.kind, 'dovecote');
    eq(toPhones[0].alert, false);
    src.onDovecoteDone(77);
    eq(stackRow().data.count, 1, 'a dmail read elsewhere leaves the stack');

    // 9. a text still sounds per message (not stacked)
    toPhones.length = 0;
    const text = (n) => ({ event: 'message', accountId: 'tm1', chatGuid: 'chat-A', notify: true, message: { guid: `g${n}`, date: now, text: `hi ${n}`, sender: { name: 'Ann', address: '+1555' } } });
    for (let n = 1; n <= 3; n += 1) { now += 1000; src.onTextEvent(text(n)); }
    eq(toPhones.filter((n) => n.id === 'sms:tm1:chat-A').map((n) => n.alert), [true, true, true], 'each text sounds');
    ok(!inbox.list('admin').some((n) => n.id === 'stack:sms'), 'texts are not stacked');
    ok(toPhones.every((n) => n.id !== 'stack:mail'), 'and they do not touch the mail stack');

    // 10. order: new first (newest on top), then older ones by prio
    inbox._test.reset();
    inbox._test.setNow(() => now);
    inbox.bind(gr);
    const put = (id, cls, ago, extra) => { const t = now; now -= ago; inbox.publish(Object.assign({ id, cls, title: id, text: id, ttlMs: 86400000 }, extra)); now = t; };
    now = Date.parse('2026-11-25T18:00:00Z');
    put('old-low', 'notification', 5 * 3600000);
    put('old-mail', 'mail', 4 * 3600000);
    put('old-sms', 'sms', 6 * 3600000);
    put('old-sms2', 'sms', 3 * 3600000);
    put('old-rem', 'reminder', 7 * 3600000);
    put('old-wxs', 'weather-severe', 8 * 3600000);
    let rows = inbox.list('admin');
    eq(rows.map((n) => n.id), ['old-sms2', 'old-sms', 'old-wxs', 'old-rem', 'old-mail', 'old-low'], 'older ones: prio desc, then newest');
    eq(rows.map((n) => n.prio), [4, 4, 4, 3, 2, 1], 'prio is sent');
    eq(rows[0].sortAt, now - 3 * 3600000, 'sortAt is sent');
    put('new-low', 'notification', 0);
    rows = inbox.list('admin');
    eq(rows[0].id, 'new-low', 'a new low-prio notice sits above an older high-prio one');
    eq(rows.slice(1).map((n) => n.id), ['old-sms2', 'old-sms', 'old-wxs', 'old-rem', 'old-mail', 'old-low'], 'the rest keep their prio order');
    now += 60000;
    put('newer-mail', 'mail', 0);
    eq(inbox.list('admin').slice(0, 2).map((n) => n.id), ['newer-mail', 'new-low'], 'fresh ones: newest first');
    // fresh window ends: the stack falls in among the older by prio
    now += 20 * 60000;
    eq(inbox.list('admin').slice(0, 3).map((n) => n.id), ['old-sms2', 'old-sms', 'old-wxs'], 'after 15 min prio decides again');
    // the stack's time is its newest item's: a new mail on an old stack lifts it to the top
    inbox._test.reset(); inbox._test.setNow(() => now); inbox.bind(gr);
    put('old-sms', 'sms', 6 * 3600000);
    now += 1000; src.onMailEvent(mail(31));
    const t0 = now;
    now += 3 * 3600000; src.onMailEvent(mail(32)); // still the same live stack
    eq(inbox.list('admin').map((n) => n.id), ['stack:mail', 'old-sms'], 'a stack with a new item is on top');
    eq(stackRow().sortAt, now); ok(stackRow().createdAt === t0, 'createdAt kept'); eq(stackRow().data.count, 2);
    // order is also what catch-up and pendingForPhones use
    now += 3 * 3600000;
    eq(inbox.pendingForPhones('admin').map((n) => n.id), ['old-sms', 'stack:mail'], 'pendingForPhones: the same order');
    eq(inbox.orderNotices([{ id: 'a', cls: 'mail', createdAt: now - 3600000 }, { id: 'b', cls: 'sms', createdAt: now - 7200000 }, { id: 'c', cls: 'x', createdAt: now - 60000 }], now).map((n) => n.id), ['c', 'b', 'a'], 'orderNotices on raw rows');

    console.log(`test-notification-inbox-stack: ${passed} checks passed`);
    process.exit(0); // phoneStatus.touch leaves a debounce timer open
})().catch((e) => { console.error(e); process.exit(1); });
