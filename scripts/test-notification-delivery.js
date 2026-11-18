#!/usr/bin/env node
/*
 * #908 (rule cafeready-background, "as if a life depends on it"): a notice sent to a phone's background link stays a
 * delivery until the app confirms it (as_event inbox.posted); unconfirmed it is sent again on a backoff and on the
 * phone's hello; a notice seen / cleared anywhere is not sent again.
 */
'use strict';
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
const as = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');

let now = 1_000_000;
inbox._test.setNow(() => now);
inbox.bind({ getPath: () => null });

// a fake phone link: the notices it was sent
let linkUp = true;
const got = [];
as.sendInboxNotice = (_gr, _ws, notice, opts = {}) => {
    if (!linkUp) return 0;
    if (opts.deviceId && opts.deviceId !== 'fold') return 0;
    got.push(notice);
    if (Array.isArray(opts.sentTo)) opts.sentTo.push('fold');
    return 1;
};

inbox.publish({ id: 'sms:1', title: 'New Text Message', text: 'hi', app: 'Text Messages' });
assert.strictEqual(got.length, 1);
assert.strictEqual(inbox.openDeliveries('fold').length, 1, 'waits for its confirmation');

// not confirmed: sent again after 15 s, then 45 s
now += 10000; inbox._test.resendDue();
assert.strictEqual(got.length, 1, 'not yet');
now += 6000; inbox._test.resendDue();
assert.strictEqual(got.length, 2, 'sent again after 15 s');
assert.strictEqual(got[1].resent, true);
now += 46000; inbox._test.resendDue();
assert.strictEqual(got.length, 3, 'and again after 45 s more');

// the app confirms: no more
inbox.confirmed('fold', 'sms:1', 'posted');
assert.strictEqual(inbox.openDeliveries('fold').length, 0);
now += 600000; inbox._test.resendDue();
assert.strictEqual(got.length, 3, 'confirmed: never again');

// link down at publish: nothing recorded as sent; the hello catches up and that delivery is tracked
linkUp = false;
inbox.publish({ id: 'mail:9', title: 'New E-mail Message', text: 'x' });
assert.strictEqual(got.length, 3);
linkUp = true;
const before = got.length;
inbox.catchUpPhone('fold');
assert.ok(got.length > before, 'caught up on hello');
assert.ok(inbox.openDeliveries('fold').some((r) => r.id === 'mail:9'), 'the catch-up waits for its confirmation too');
assert.ok(!got.slice(before).some((g) => g.id === 'sms:1'), 'what the phone confirmed is not sent again on hello');

// seen on another device: not sent again
inbox.ack('admin', 'mail:9', 'seen', 'desktop');
now += 20000; const n0 = got.length; inbox._test.resendDue();
assert.ok(!got.slice(n0).some((g) => g.id === 'mail:9'), 'seen elsewhere: not sent again');

// a link that stays silent: attempts are counted while it is down, and stop after the backoff runs out
inbox.publish({ id: 'dir:1', title: 'Turn finished' });
linkUp = false;
for (let i = 0; i < 8; i++) { now += 400000; inbox._test.resendDue(); }
const row = inbox.openDeliveries('fold').find((r) => r.id === 'dir:1');
assert.ok(row && row.attempts > 4, 'gave up resending on a timer (the hello sends it again)');

console.log('test-notification-delivery: ok');
