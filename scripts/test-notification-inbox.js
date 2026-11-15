#!/usr/bin/env node
'use strict';
// Notification inbox checks (Yozora #845): node scripts/test-notification-inbox.js
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
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

    inbox._test.reset();
    console.log('notification inbox: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
