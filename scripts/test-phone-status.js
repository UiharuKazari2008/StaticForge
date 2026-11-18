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
    assert.deepStrictEqual(Object.keys(d.fields).sort(), ['director', 'mail'], 'only what changed');
    assert.strictEqual(d.fields.mail.fresh, 1);
    assert.strictEqual(d.fields.director.running, true);

    inbox.setPref('admin', 'icon.mailAll', '1');
    await ps._test.run();
    assert.deepStrictEqual(sentEv[2].detail.fields, { prefs: { mailAll: true, smsAll: false } });

    inbox.clear('admin', 'dmail:7', 'test');
    await ps._test.run();
    assert.strictEqual(sentEv[3].detail.fields.mail.fresh, 0, 'read: the icon input drops');
    console.log('test-phone-status: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
