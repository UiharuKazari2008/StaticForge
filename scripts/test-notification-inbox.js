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

    inbox._test.reset();
    console.log('notification inbox: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
