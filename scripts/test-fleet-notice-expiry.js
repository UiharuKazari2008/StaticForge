#!/usr/bin/env node
'use strict';
// Notices expire where the phones, the app's mirror and the pages can see it (Yozora #1291, point 4):
//   - prune() tells the pages (inbox_updated) and the phone status (touch('inbox')) once it removed something, and the phones take
//     their Android copy down; a stack's item past its own expiry leaves the stack (the row's expiry is the LATEST item's);
//   - one timer sleeps to the next expiry (no poll, no wait for the 10 minute tick or the next publish);
//   - the status snapshot's notice list carries exp (and expFirst for a stack) so the app drops an expired one from its own mirror.
//   node scripts/test-fleet-notice-expiry.js
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

const activeSync = require('../modules/activeSync');
const phoneStatus = require('../modules/phoneStatus');
const inbox = require('../modules/notificationInbox');

const toPhones = [];
const cleared = [];
const touches = [];
const pushed = [];
activeSync.sendInboxNotice = (g, ws, n) => { toPhones.push(n); return 1; };
activeSync.sendInboxCleared = (g, ws, n) => { cleared.push(n.id); return 1; };
phoneStatus.touch = (r) => { touches.push(r); };
const gr = { getWebSocketServer: () => ({ broadcast: (m) => pushed.push(m) }) };
const H = 3600000;
let now = Date.parse('2026-11-26T08:00:00Z');
const realNow = Date.now;
Date.now = () => now; // phoneStatus's 24 h rule reads the clock itself
inbox._test.setNow(() => now);
inbox.bind(gr);

let passed = 0;
const ok = (c, m) => { assert.ok(c, m); passed += 1; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); passed += 1; };
const reset = () => { toPhones.length = 0; cleared.length = 0; touches.length = 0; pushed.length = 0; inbox._test.reset(); inbox._test.setNow(() => now); };
const snapshot = async () => (await phoneStatus._test.build()).notices;
const ids = (a) => a.map((n) => n.id);
const expired = (id) => pushed.filter((m) => m.type === 'inbox_updated' && m.data.reason === 'ack' && m.data.id === id && m.data.state === 'cleared' && m.data.expired === true).length;
const fleet = (n, extra) => Object.assign({ app: 'claudedesk', cls: 'fleet', alert: true, text: 't', data: { app: 'claudedesk' } }, n, extra);

(async () => {
    // 1. (a) a plain notice expires with nothing else going on: pages, phone status and phones are told by prune, not left to the next event
    inbox.publish(fleet({ id: 'fleet-work:1:done', title: 'Fleet: A is done', ttlMs: 4 * H }));
    now += 5 * H;
    eq(inbox.list('admin'), [], 'list() never shows an expired notice');
    eq(inbox.count('admin'), 0);
    eq((await snapshot()).list, [], 'a snapshot built now has none (it is rebuilt only when something touches it)');
    pushed.length = 0; touches.length = 0; cleared.length = 0;
    inbox.prune('admin');
    ok(touches.includes('inbox'), 'prune rebuilds the phone status: the app mirror drops it');
    eq(expired('fleet-work:1:done'), 1, 'the pages get inbox_updated for it');
    eq(cleared, ['fleet-work:1:done'], 'the phones take their Android copy down');
    eq(inbox.get('admin', 'fleet-work:1:done'), null, 'and it is gone from the store');
    // nothing to remove: no news
    pushed.length = 0; touches.length = 0; cleared.length = 0;
    inbox.prune('admin');
    eq([pushed.length, touches.length, cleared.length], [0, 0, 0], 'a prune that removes nothing says nothing');

    // 2. the snapshot's notice list carries exp: the notice's end; a stack's is its latest item's, expFirst its earliest
    reset();
    inbox.publish(fleet({ id: 'plain:a', title: 'Plain', ttlMs: 4 * H }));
    inbox.publish(fleet({ id: 'plain:b', title: 'No end', ttlMs: 0 }));
    const T = now;
    inbox.publish(fleet({ id: 'fleet-work:1:done', title: 'Fleet: A is done', stack: 'fleetdone', ttlMs: 4 * H }));
    now += 3 * H;
    inbox.publish(fleet({ id: 'fleet-work:2:done', title: 'Fleet: B is done', stack: 'fleetdone', ttlMs: 4 * H }));
    let sn = await snapshot();
    const by = (id) => sn.list.find((n) => n.id === id);
    eq(by('plain:a').exp, T + 4 * H, 'exp is the notice\'s expiresAt');
    eq(by('plain:b').exp, 0, 'no end: 0');
    eq([by('stack:fleetdone').exp, by('stack:fleetdone').expFirst, by('stack:fleetdone').count], [T + 7 * H, T + 4 * H, 2], 'a stack: latest item, earliest item, count');
    ok(!('expFirst' in by('plain:a')), 'only a stack carries expFirst');
    eq(by('stack:fleetdone').kind !== undefined, true);

    // 3. (d) a stack's items have their own life; the row lives with the latest
    now = T + 4 * H + 60000;
    sn = await snapshot();
    eq([by('stack:fleetdone').count, by('stack:fleetdone').title], [1, 'Fleet: B is done'], 'the snapshot built after the first item\'s end reads one item');
    eq(by('stack:fleetdone') === undefined, false);
    // a flood does not keep the oldest alive: twenty items, one an hour, ttl 4 h
    reset();
    now = Date.parse('2026-11-26T08:00:00Z');
    const t0 = now;
    for (let i = 1; i <= 20; i += 1) { inbox.publish(fleet({ id: `fleet-work:${i}:done`, title: `Fleet: W${i} is done`, stack: 'fleetdone', ttlMs: 4 * H })); now += H; }
    // now = t0 + 20 h: items 1..16 ended (item i ends at t0 + (i-1)h + 4h <= t0 + 20h  <=>  i <= 17)
    let st = inbox.list('admin').find((n) => n.id === 'stack:fleetdone');
    eq(st.data.items.map((x) => x.id), [20, 19, 18].map((i) => `fleet-work:${i}:done`), 'only the three still inside their 4 h');
    eq(st.data.count, 3);
    toPhones.length = 0; pushed.length = 0; touches.length = 0;
    inbox.prune('admin');
    eq(inbox.list('admin').map((n) => n.data.count), [3]);
    eq(toPhones.map((n) => [n.id, n.alert]), [['stack:fleetdone', false]], 'one silent re-announce for the lot');
    ok(touches.includes('inbox'));

    // 4. (c) a notice put away with Hide counts as waiting for 24 h (by design, #907); a Fleet one cannot outlast its own life
    reset();
    now = Date.parse('2026-11-26T08:00:00Z');
    inbox.publish(fleet({ id: 'other:seen', title: 'Seen one', ttlMs: 2 * 24 * H, cls: 'notification', app: 'x' }));
    inbox.ack('admin', 'other:seen', 'seen');
    inbox.publish(fleet({ id: 'fleet-work:9:attention', title: 'Fleet: X needs you', stack: 'fleetattn', ttlMs: 12 * H }));
    inbox.ack('admin', 'stack:fleetattn', 'seen');
    now += 11 * H;
    eq(ids((await snapshot()).list).sort(), ['other:seen', 'stack:fleetattn'], 'seen counts as waiting');
    now += 2 * H; // 13 h: the Fleet one is over, the other is still a seen row inside its 24 h
    inbox.prune('admin');
    eq(ids((await snapshot()).list), ['other:seen'], 'a seen Fleet notice goes at its own end, not at 24 h');
    now += 12 * H; // 25 h
    eq(ids((await snapshot()).list), [], 'a seen notice older than a day is no waiting notice (the 24 h rule)');

    // 5. nextExpiry: the soonest end of any live notice or stack item
    reset();
    now = Date.parse('2026-11-26T08:00:00Z');
    eq(inbox._test.nextExpiry(), 0, 'nothing to expire: nothing to wait for');
    inbox.publish(fleet({ id: 'p:1', title: 'p1', ttlMs: 9 * H }));
    inbox.publish(fleet({ id: 'fleet-work:1:done', title: 'a', stack: 'fleetdone', ttlMs: 4 * H }));
    now += 1 * H;
    inbox.publish(fleet({ id: 'fleet-work:2:done', title: 'b', stack: 'fleetdone', ttlMs: 7 * H }));
    eq(inbox._test.nextExpiry(), Date.parse('2026-11-26T12:00:00Z'), 'the first stack item\'s end, not the row\'s');
    inbox.ack('admin', 'fleet-work:1:done', 'cleared');
    eq(inbox._test.nextExpiry(), Date.parse('2026-11-26T16:00:00Z'), 'an item that left no longer counts');
    inbox.clear('admin', 'fleet-work:2:done');
    eq(inbox._test.nextExpiry(), Date.parse('2026-11-26T17:00:00Z'), 'only p:1 is left');
    Date.now = realNow;

    // 6. one real timer, no poll: a notice and a stack item expire on their own, the pages and the phone status are told
    reset();
    inbox._test.setNow(null); // the real clock
    delete process.env.NOTIFICATION_INBOX_NO_TIMER; // the timer is armed (bind already ran without the 10 minute tick)
    inbox.publish(fleet({ id: 'rt:plain', title: 'Short life', ttlMs: 500 }));
    inbox.publish(fleet({ id: 'rt:a', title: 'Fleet: A is done', stack: 'fleetdone', ttlMs: 700 }));
    inbox.publish(fleet({ id: 'rt:b', title: 'Fleet: B is done', stack: 'fleetdone', ttlMs: 60 * 1000 }));
    ok(inbox._test.expiryDue() > 0, 'a timer is armed');
    eq(inbox._test.expiryDue(), inbox._test.nextExpiry(), 'for the soonest end');
    ok(inbox.list('admin').some((n) => n.id === 'rt:plain'));
    toPhones.length = 0; pushed.length = 0; touches.length = 0; cleared.length = 0;
    await new Promise((r) => setTimeout(r, 1500));
    eq(ids(inbox.list('admin')).sort(), ['stack:fleetdone'], 'the short one left by itself');
    eq(inbox.list('admin')[0].data.items.map((x) => x.id), ['rt:b'], 'and the stack item at its own end, the other stays');
    ok(expired('rt:plain') === 1, 'the pages were told');
    ok(touches.includes('inbox'), 'the phone status was rebuilt');
    ok(cleared.includes('rt:plain'), 'the phones took it down');
    ok(toPhones.some((n) => n.id === 'stack:fleetdone' && n.alert === false), 'the stack was re-posted silently');
    ok(inbox._test.expiryDue() > Date.now() + 30 * 1000, 'and the timer now sleeps to the remaining item\'s end');
    inbox._test.reset(); // clears the timer
    process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

    console.log(`test-fleet-notice-expiry: ${passed} checks passed`);
    process.exit(0); // phoneStatus.touch leaves a debounce timer open
})().catch((e) => { Date.now = realNow; console.error(e); process.exit(1); });
