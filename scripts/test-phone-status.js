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

    // #1305 S20: an answerable notice (data.answerType) carries answerType + at most three keys (label <= 20 chars) in the holder
    // list; every other notice carries neither field (a small packet)
    inbox.publish({ id: 'device-ask:S20', cls: 'notification', title: 'Claude 3 wants the A53 phone', text: 'For up to 20 min. Why: x.', actions: [{ id: 'allow', label: 'Allow' }],
        data: { kind: 'device-ask', answerType: 'device_consent_answer', buttons: [{ id: 'allow', label: 'Allow' }, { id: 'deny', label: 'Deny' }, { id: 'long', label: 'A label that is far too long to show' }, { id: 'fourth', label: 'Fourth' }] } });
    inbox.publish({ id: 'plain:S20', cls: 'notification', title: 'Plain', text: 'nothing to answer', data: { buttons: [{ id: 'x', label: 'X' }] } });
    await ps._test.run();
    const list20 = sentEv[sentEv.length - 1].detail.fields.notices.list;
    const ask20 = list20.find((n) => n.id === 'device-ask:S20');
    assert.strictEqual(ask20.answerType, 'device_consent_answer', 'the answer packet is named');
    assert.strictEqual(ask20.buttons.length, 3, 'three keys at most');
    assert.deepStrictEqual(ask20.buttons[0], { id: 'allow', label: 'Allow' });
    assert.deepStrictEqual(ask20.buttons.map((b) => b.id), ['allow', 'deny', 'long']);
    assert.ok(ask20.buttons.every((b) => b.label.length <= 20), 'labels clipped to 20');
    assert.strictEqual(ask20.buttons[2].label, 'A label that is far ');
    const plain20 = list20.find((n) => n.id === 'plain:S20');
    assert.ok(plain20 && !('answerType' in plain20) && !('buttons' in plain20), 'no answer fields on a notice nobody answers');
    assert.ok(!('answerType' in entry) && !('buttons' in entry), 'nor on a stack');
    console.log('test-phone-status: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
