#!/usr/bin/env node
'use strict';
// Notification inbox checks (Yozora #845): node scripts/test-notification-inbox.js
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
const inbox = require('../modules/notificationInbox');
const sent = [];
const gr = { getWebSocketServer: () => ({ broadcast: (m, filter) => sent.push({ m, adminWanted: filter({ authenticated: true, userType: 'admin' }), devWanted: filter({ authenticated: true, userType: 'dev_admin' }) }) }) };
let now = Date.parse('2026-11-15T12:00:00Z');
inbox._test.setNow(() => now);
inbox.bind(gr);

(async () => {
    // publish + list
    const a = inbox.publish({ app: 'lapis', id: 'lapis:unlocked', cls: 'notification', title: 'Sonata is unlocked', text: 'Parked at Home', actions: ['lock'] });
    assert.ok(a && a.state === 'new');
    assert.strictEqual(sent.pop().adminWanted, true, 'broadcast to admin');
    let list = inbox.list('admin');
    assert.strictEqual(list.length, 1);
    assert.strictEqual(list[0].id, 'lapis:unlocked');
    assert.deepStrictEqual(list[0].actions, ['lock']);
    assert.strictEqual(inbox.list('dev_admin').length, 0, 'queues are per user type');

    // the same id supersedes (a countdown step) and resets to new
    inbox.ack('admin', 'lapis:unlocked', 'seen');
    assert.strictEqual(inbox.list('admin')[0].state, 'seen');
    inbox.publish({ app: 'lapis', id: 'lapis:unlocked', title: 'Sonata is unlocked', text: 'Parked at Home for 20 minutes', actions: ['lock'] });
    assert.strictEqual(inbox.list('admin')[0].state, 'new', 'a replaced notice is new again');
    assert.match(inbox.list('admin')[0].text, /20 minutes/);

    // expiry: a run countdown with a short life is gone once past
    inbox.publish({ app: 'lapis', id: 'lapis:run-left', cls: 'lapis-run-left', title: '5 minutes left', text: 'ends soon', actions: ['stop'], expiresAt: now + 60000 });
    assert.ok(inbox.list('admin').some((n) => n.id === 'lapis:run-left'));
    assert.strictEqual(inbox.publish({ id: 'x', title: 'past', expiresAt: now - 1 }), null, 'already expired is not stored');
    now += 120000;
    assert.ok(!inbox.list('admin').some((n) => n.id === 'lapis:run-left'), 'expired notice is not listed');

    // ack states never step back; cleared drops from the default list
    inbox.ack('admin', 'lapis:unlocked', 'acted', 'fold');
    assert.strictEqual(inbox.list('admin')[0].state, 'acted');
    assert.strictEqual(inbox.list('admin')[0].actedBy, 'fold');
    inbox.ack('admin', 'lapis:unlocked', 'seen');
    assert.strictEqual(inbox.list('admin')[0].state, 'acted', 'seen does not overwrite acted');
    inbox.ack('admin', 'lapis:unlocked', 'cleared');
    assert.strictEqual(inbox.list('admin').length, 0, 'cleared is hidden by default');
    assert.strictEqual(inbox.list('admin', { includeCleared: true }).length, 1);

    // #889: which publishes sound on the phones, and what a reconnecting phone catches up on
    const c1 = inbox.publish({ app: 'messaging', id: 'sms:a:chat1', cls: 'sms', title: 'Rin', text: 'hi', alert: true });
    assert.strictEqual(c1.alert, true, 'a new notice sounds');
    now += 1000;
    const c2 = inbox.publish({ app: 'messaging', id: 'sms:a:chat1', cls: 'sms', title: 'Rin', text: 'are you there?', alert: true });
    assert.strictEqual(c2.alert, true, 'the next message in a conversation sounds');
    assert.strictEqual(inbox.list('admin').find((n) => n.id === 'sms:a:chat1').createdAt, now, 'a new event moves createdAt');
    const t1 = inbox.publish({ app: 'traffic', id: 'traffic:commute', cls: 'traffic', title: 'Leave in 5 min', text: 'A' });
    now += 1000;
    const t2 = inbox.publish({ app: 'traffic', id: 'traffic:commute', cls: 'traffic', title: 'Leave in 4 min', text: 'A' });
    assert.strictEqual(t1.alert, true);
    assert.strictEqual(t2.alert, false, 'an update in place is silent');
    assert.strictEqual(inbox.list('admin').find((n) => n.id === 'traffic:commute').createdAt, t1.createdAt, 'an update keeps createdAt');
    inbox.ack('admin', 'traffic:commute', 'cleared');
    assert.strictEqual(inbox.publish({ app: 'traffic', id: 'traffic:commute', cls: 'traffic', title: 'Leave now', text: 'A' }).alert, true, 'after a clear it sounds again');
    inbox.ack('admin', 'sms:a:chat1', 'seen');
    const pend = inbox.pendingForPhones('admin').map((n) => n.id);
    assert.ok(pend.includes('traffic:commute') && !pend.includes('sms:a:chat1') && !pend.includes('lapis:unlocked'), 'catch-up: only notices still new');
    now += 25 * 60 * 60 * 1000;
    assert.ok(!inbox.pendingForPhones('admin').some((n) => n.id === 'traffic:commute'), 'catch-up: not older than 24 h');

    // #890 round 5 W2: inbox_list since returns the rows created or changed at or after it (cleared ones
    // included, so the page closes its copy); total is the full list's size. W7: a 'seen' ack is no news
    // to any page (no broadcast); acted / cleared still go
    inbox._test.reset();
    now += 60000;
    const n1 = inbox.publish({ app: 'messaging', id: 'sms:b:1', cls: 'sms', title: 'A', text: 'one' });
    now += 1000;
    const n2 = inbox.publish({ app: 'messaging', id: 'sms:b:2', cls: 'sms', title: 'B', text: 'two' });
    const mark = now;
    assert.deepStrictEqual(inbox.list('admin', { since: mark }).map((n) => n.id), ['sms:b:2'], 'since: the newest row at the mark');
    now += 1000;
    sent.length = 0;
    inbox.ack('admin', n1.id, 'seen');
    assert.strictEqual(sent.length, 0, 'a seen ack broadcasts nothing');
    assert.strictEqual(inbox.list('admin', { since: mark + 1 }).map((n) => n.id).join(','), n1.id, 'a state change counts as changed');
    { const row = inbox.list('admin', { since: mark + 1 })[0];
      assert.ok(row.updatedAt === now && row.updatedAt > row.createdAt, 'rows carry updatedAt (the page\'s next since)'); }
    assert.strictEqual(inbox.list('admin').find((n) => n.id === n2.id).updatedAt, n2.createdAt, 'unchanged: updatedAt is createdAt');
    const mark2 = now;
    now += 1000;
    inbox.ack('admin', n2.id, 'cleared', 'fold');
    assert.strictEqual(sent.length, 1, 'cleared goes');
    assert.strictEqual(sent[0].m.data.reason, 'ack');
    assert.strictEqual(sent[0].m.data.state, 'cleared');
    const since = inbox.list('admin', { since: mark2 + 1 });
    assert.deepStrictEqual(since.map((n) => [n.id, n.state]), [['sms:b:2', 'cleared']], 'a cleared row comes with since');
    assert.ok(!inbox.list('admin').some((n) => n.id === 'sms:b:2'), 'without since: unchanged (cleared hidden)');
    assert.strictEqual(inbox.count('admin'), 1, 'total: the notices a full list holds');
    assert.strictEqual(inbox.list('admin', { since: now + 1 }).length, 0, 'nothing newer: empty');

    // ---- #1305: phone-consent notices (S5 done rows with alert: false, S9 answerable beats the quiet class, S10 catch-up) ----
    {
        inbox._test.reset();
        const asSync = require('../modules/activeSync');
        const origSend = asSync.sendInboxNotice;
        const pushed = [];
        asSync.sendInboxNotice = (g, ws, n, o) => { pushed.push(n); if (o && o.sentTo) o.sentTo.push((o && o.deviceId) || 'fold'); return 1; };
        try {
            // S5: the second hold on a device (the first cleared) is shown again but never sounds when the producer said alert: false
            const hold = (lease, over) => inbox.publish(Object.assign({ app: 'claudedesk', id: 'device-hold:fold', cls: 'notification', title: 'Fold is in use by A', text: `build. Until 10:00. ${lease}`, digest: `hold:${lease}`, alert: false }, over));
            now += 1000;
            assert.strictEqual(hold('L1').alert, false, 'S5: a new in-use row is silent');
            inbox.ack('admin', 'device-hold:fold', 'cleared');
            pushed.length = 0;
            const h2 = hold('L2');
            assert.strictEqual(h2.alert, false, 'S5: the same device held again (digest changed) stays silent');
            assert.strictEqual(h2.state, 'new', 'S5: but it is new, shown again');
            assert.strictEqual(pushed.length, 1, 'S5: the phone still gets it');
            assert.strictEqual(pushed[0].alert, false, 'S5: and not as a push that sounds');
            inbox.ack('admin', 'device-hold:fold', 'acted');
            assert.strictEqual(hold('L3', { alert: undefined }).alert, true, 'S5: a producer that did not say alert: false still sounds when a done row comes back changed');
            inbox.ack('admin', 'device-hold:fold', 'cleared');
            assert.strictEqual(hold('L4', { returning: true }).alert, true, 'S5: returning (a snooze ending) sounds whatever alert says');
            // escalation (a worse class) sounds too
            inbox.publish({ app: 'x', id: 'esc:1', cls: 'weather-alert', title: 'Storm', text: 's', alert: false });
            inbox.ack('admin', 'esc:1', 'cleared');
            assert.strictEqual(inbox.publish({ app: 'x', id: 'esc:1', cls: 'weather-severe', title: 'Storm', text: 's', alert: false }).alert, true, 'S5: escalation still sounds');

            // S9: an answerable notice is never swallowed by the class's quiet setting; a plain one still is
            inbox._test.reset();
            inbox.setQuiet('admin', ['notification']);
            pushed.length = 0;
            const plain = inbox.publish({ app: 'x', id: 'plain:q', cls: 'notification', title: 'Plain', text: 'p' });
            assert.strictEqual(plain.state, 'seen', 'S9: a plain notice of a quiet class is stored seen');
            assert.strictEqual(pushed.length, 0, 'S9: and never pushed');
            const ans = (id, over) => inbox.publish(Object.assign({ app: 'claudedesk', id, cls: 'notification', title: 'Claude wants the phone', text: 't', alert: true, digest: id, data: { answerType: 'device_consent_answer', buttons: [{ id: 'allow', label: 'Allow' }] } }, over));
            const a1 = ans('device-ask:Q1');
            assert.strictEqual(a1.state, 'new', 'S9: an answerable notice is new in a quiet class');
            assert.strictEqual(a1.alert, true, 'S9: and still sounds when the producer says alert');
            assert.strictEqual(pushed.length, 1, 'S9: it is pushed to the phones');
            const a2 = ans('device-ask:Q2', { alert: false });
            assert.strictEqual(a2.state, 'new');
            assert.strictEqual(a2.alert, false, 'S9: alert: false keeps it silent');
            assert.strictEqual(pushed.length, 2);
            // the catch-up list keeps it even though the class is quiet; a plain new row of that class (stored before) is dropped
            inbox.setQuiet('admin', []);
            const old = inbox.publish({ app: 'x', id: 'plain:old', cls: 'notification', title: 'Old', text: 'o' });
            assert.strictEqual(old.state, 'new');
            inbox.setQuiet('admin', ['notification']);
            const pend2 = inbox.pendingForPhones('admin').map((n) => n.id);
            assert.ok(pend2.includes('device-ask:Q1') && pend2.includes('device-ask:Q2'), 'S9: answerable ones stay in the phones\' catch-up list');
            assert.ok(!pend2.includes('plain:old'), 'S9: a plain quiet-class row is not');
            inbox.setQuiet('admin', []);

            // S10: a real phone's catch-up sends every unconfirmed answerable notice first (quiet), then the top one (not twice)
            inbox._test.reset();
            now += 1000; ans('device-ask:C1');
            now += 1000; ans('device-ask:C2');
            now += 1000; inbox.publish({ app: 'mail', id: 'mail:top', cls: 'mail', title: 'New E-mail Message', text: 'hi' });
            now += 1000; inbox.publish({ app: 'x', id: 'plain:mid', cls: 'notification', title: 'Mid', text: 'm' });
            now += 1000; inbox.publish({ app: 'mail', id: 'mail:newest', cls: 'mail', title: 'New E-mail Message', text: 'newest' });
            pushed.length = 0;
            inbox.catchUpPhone('fold');
            assert.deepStrictEqual(pushed.map((n) => n.id).slice(0, 2).sort(), ['device-ask:C1', 'device-ask:C2'], 'S10: both asks go first');
            assert.strictEqual(pushed.length, 3, 'S10: then the one top notice, nothing else');
            assert.strictEqual(pushed[2].id, 'mail:newest', 'S10: the top notice is the newest');
            assert.ok(pushed.every((n) => n.alert === false && n.catchUp === true), 'S10: all quiet, all marked catch-up');
            // one the phone confirmed is not sent again
            inbox.confirmed('fold', 'device-ask:C1', 'posted');
            pushed.length = 0;
            inbox.catchUpPhone('fold');
            assert.ok(!pushed.some((n) => n.id === 'device-ask:C1'), 'S10: a confirmed ask is not sent again');
            assert.ok(pushed.some((n) => n.id === 'device-ask:C2'), 'S10: an unconfirmed one is');
            // the top notice is itself an ask: it is sent once
            inbox._test.reset();
            now += 1000; inbox.publish({ app: 'mail', id: 'mail:one', cls: 'mail', title: 'New E-mail Message', text: 'hi' });
            now += 1000; ans('device-ask:T1');
            pushed.length = 0;
            inbox.catchUpPhone('fold');
            assert.deepStrictEqual(pushed.map((n) => n.id), ['device-ask:T1'], 'S10: the top notice that is an ask goes once, and no other notice with it');
        } finally { asSync.sendInboxNotice = origSend; }
    }

    inbox._test.reset();
    console.log('notification inbox: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
