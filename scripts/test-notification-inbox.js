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

    inbox._test.reset();
    console.log('notification inbox: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
