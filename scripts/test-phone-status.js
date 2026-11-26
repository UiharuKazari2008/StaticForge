#!/usr/bin/env node
'use strict';
// #908 phase 3: the phone's status icon inputs, computed by the server and sent to each partnered phone's background
// link as status.snapshot - all of it after a hello, then only the fields that changed; nothing when nothing changed.
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
const as = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');
const ps = require('../modules/phoneStatus');

const sentEv = [];
as.partnerLinks = () => [{ deviceId: 'fold', service: { ws: {} }, foreground: false }];
as.receivedUnseen = () => 2;
as.sendServerEvent = (_g, _w, _s, name, detail) => { sentEv.push({ name, detail }); return true; };
as.sendInboxNotice = () => 1;
const gr = { getWebSocketServer: () => ({ broadcast: () => {} }), getGenerationJobQueue: () => null };
inbox.bind(gr);
ps.bind(gr);

(async () => {
    await ps._test.run();
    assert.strictEqual(sentEv.length, 1);
    assert.strictEqual(sentEv[0].name, 'status.snapshot');
    assert.strictEqual(sentEv[0].detail.full, true, 'the first send is whole');
    assert.deepStrictEqual(sentEv[0].detail.fields.received, { unseen: 2 });
    assert.ok('mail' in sentEv[0].detail.fields && 'director' in sentEv[0].detail.fields && 'prefs' in sentEv[0].detail.fields);

    await ps._test.run();
    assert.strictEqual(sentEv.length, 1, 'nothing changed: nothing sent');

    inbox.publish({ id: 'dmail:7', title: 'New E-mail Message', text: 'x', cls: 'mail' });
    ps.directorStatus({ running: true });
    await ps._test.run();
    const d = sentEv[1].detail;
    assert.strictEqual(d.full, false);
    // the holder lists every waiting notice, mail included (#1056), so the notices field moves with a new mail too
    assert.deepStrictEqual(Object.keys(d.fields).sort(), ['director', 'mail', 'notices'], 'only what changed');
    assert.strictEqual(d.fields.mail.fresh, 1);
    assert.strictEqual(d.fields.director.running, true);

    inbox.setPref('admin', 'icon.mailAll', '1');
    await ps._test.run();
    // only prefs moved; prefs also carries popupApps (the Messaging accounts' Android apps, #885) since this was written
    assert.deepStrictEqual(Object.keys(sentEv[2].detail.fields), ['prefs']);
    assert.strictEqual(sentEv[2].detail.fields.prefs.mailAll, true);
    assert.strictEqual(sentEv[2].detail.fields.prefs.smsAll, false);

    inbox.clear('admin', 'dmail:7', 'test');
    await ps._test.run();
    assert.strictEqual(sentEv[3].detail.fields.mail.fresh, 0, 'read: the icon input drops');

    // #1098: a flood of mail is one stack:mail row; the icon input counts the mails in it, the holder carries the count
    for (let i = 1; i <= 3; i++) inbox.publish({ id: `dmail:s${i}`, stack: 'mail', title: 'New E-mail Message', text: `From: a${i}\nhi`, cls: 'mail', data: { from: `a${i}`, subject: 'hi' } });
    await ps._test.run();
    const last = sentEv[sentEv.length - 1].detail.fields;
    assert.strictEqual(last.mail.fresh, 3, 'a stack of three counts three');
    const entry = last.notices.list.find((n) => n.id === 'stack:mail');
    assert.ok(entry, 'the stack is one holder entry');
    assert.strictEqual(entry.count, 3, 'the holder entry carries the count');
    assert.strictEqual(last.notices.list.filter((n) => /^dmail:s/.test(n.id)).length, 0, 'no entry per mail');
    console.log('test-phone-status: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
