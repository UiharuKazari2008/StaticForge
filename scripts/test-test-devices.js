#!/usr/bin/env node
/*
 * Test devices (modules/testDevices.js): the Android emulator is partnered with the live server for notification tests
 * and must never reach a real phone (Yukimi, Nov 18 2026). The household's notices never go to a test device, the test
 * lane's never to a real phone, a test device's acks / prefs / snoozes land in the test lane only, and its snapshot is
 * built from the test lane.
 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const WebSocket = require('ws');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'test-devices-'));
process.env.TEST_DEVICES_FILE = path.join(tmp, 'test-devices.json');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

const testDevices = require('../modules/testDevices');
const as = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');
const phoneStatus = require('../modules/phoneStatus');

const FOLD = 'f40910c077e218f55a6020767818c5f8';
const EMU = '0123456789abcdef0123456789abcdef';

// a fake websocket server: each phone's background link (speaker service, partner) and the emulator's page
const sent = [];
function sock(name) { return { readyState: WebSocket.OPEN, name }; }
const clients = new Map();
const link = (id, speaker, sessionId) => {
    const ws = sock(`${id.slice(0, 4)}:${speaker}`);
    clients.set(ws, { authenticated: true, userType: 'admin', sessionId, as: { kind: 'device', id, speaker, session: 'partner', since: Date.now(), permissions: [] } });
    return ws;
};
link(FOLD, 'service', 'sess-fold');
link(EMU, 'service', 'sess-emu');
const server = { clients, sendToClient: (ws, msg) => { sent.push({ to: ws.name, msg }); }, broadcast: (msg, want) => { for (const [ws, info] of clients) if (want(info)) sent.push({ to: ws.name, msg }); } };
const gr = { getWebSocketServer: () => server, getPath: () => null };
inbox.bind(gr);

const eventsTo = (who, name) => sent.filter((s) => s.to.startsWith(who) && s.msg.type === 'as_event' && s.msg.data.event === name);
const reset = () => { sent.length = 0; };

// ---- before the emulator is marked: it is a household phone like any other (nothing changes for real phones)
inbox.publish({ id: 'sms:1', title: 'New Text Message', text: 'hi' });
assert.strictEqual(eventsTo('f409', 'inbox.notice').length, 1, 'the Fold gets household notices');
assert.strictEqual(eventsTo('0123', 'inbox.notice').length, 1, 'an unmarked emulator does too');

// ---- marked a test device
assert.ok(testDevices.mark(EMU, { name: 'Test Fold (emulator)' }));
assert.ok(!testDevices.mark('nope'), 'a bad id is refused');
assert.ok(testDevices.isTestDevice(EMU) && !testDevices.isTestDevice(FOLD));
reset();
inbox.publish({ id: 'mail:a:1', title: 'New E-mail Message', text: 'x' });
assert.strictEqual(eventsTo('f409', 'inbox.notice').length, 1, 'the Fold still gets household notices');
assert.strictEqual(eventsTo('0123', 'inbox.notice').length, 0, 'a test device never gets a household notice');
assert.ok(!sent.some((s) => s.to.startsWith('0123')), 'nor any household broadcast');

reset();
inbox.publish({ user: 'test', id: 'test:1', title: 'Test notice', text: 'push' });
assert.strictEqual(eventsTo('0123', 'inbox.notice').length, 1, 'a test notice goes to the test device');
assert.strictEqual(eventsTo('f409', 'inbox.notice').length, 0, 'never to the Fold');
assert.ok(!sent.some((s) => s.to.startsWith('f409')), 'and no page or phone outside the lane hears of it');
assert.strictEqual(inbox.list('admin').filter((n) => n.id === 'test:1').length, 0, 'not in the household queue');

// get mode: stored, not sent live; the hello catch-up sends it, the test lane only
reset();
inbox.publish({ user: 'test', id: 'test:2', title: 'Fetched notice', push: false });
assert.strictEqual(eventsTo('0123', 'inbox.notice').length, 0, 'get: not sent live');
inbox.catchUpPhone(EMU);
const caught = eventsTo('0123', 'inbox.notice').map((e) => e.msg.data.detail.id);
assert.ok(caught.includes('test:2') && caught.includes('test:1'), 'the catch-up sends the test lane');
assert.ok(!caught.some((id) => !id.startsWith('test:')), 'and nothing of the household');
reset();
inbox.catchUpPhone(FOLD);
assert.ok(!eventsTo('f409', 'inbox.notice').some((e) => e.msg.data.detail.id.startsWith('test:')), 'the Fold never catches up on the test lane');
assert.ok(!eventsTo('0123', 'inbox.notice').length, 'the Fold\'s catch-up sends the emulator nothing');

// the emulator's acks: its link's socket and its page (known by session before its own hello) land in the test lane
const emuLinkInfo = [...clients.values()].find((i) => i.as.id === EMU);
assert.strictEqual(inbox.userOf(emuLinkInfo), 'test');
const pageInfo = { authenticated: true, userType: 'admin', sessionId: 'sess-emu' };
assert.strictEqual(inbox.userOf(pageInfo), 'admin', 'an unknown session is the household until the device says hello');
testDevices.noteHello({ id: EMU, sessionId: 'sess-emu' });
assert.strictEqual(inbox.userOf(pageInfo), 'test', 'its page is fenced by its session');
assert.strictEqual(inbox.userOf({ authenticated: true, userType: 'admin', sessionId: 'sess-fold' }), 'admin', 'the Fold\'s page is not');
reset();
assert.strictEqual(inbox.ack(inbox.userOf(emuLinkInfo), 'sms:1', 'cleared', EMU), false, 'a test device cannot clear a household notice');
assert.strictEqual(inbox.list('admin').find((n) => n.id === 'sms:1').state, 'new', 'the Fold\'s notice is untouched');
assert.strictEqual(eventsTo('f409', 'inbox.cleared').length, 0);
assert.strictEqual(inbox.ack('test', 'test:1', 'cleared', EMU), true, 'it clears its own');
assert.strictEqual(eventsTo('0123', 'inbox.cleared').length, 1, 'the test device takes it down');
assert.strictEqual(eventsTo('f409', 'inbox.cleared').length, 0, 'the Fold hears nothing');
// a household clear reaches the Fold only
reset();
inbox.clear('admin', 'mail:a:1', 'desktop');
assert.strictEqual(eventsTo('f409', 'inbox.cleared').length, 1);
assert.strictEqual(eventsTo('0123', 'inbox.cleared').length, 0, 'a test device hears no household clear');

// prefs from the test device stay in the lane
inbox.setQuiet('test', ['mail']);
assert.ok(!inbox.quietClasses('admin').has('mail'), 'quiet classes set by a test device do not quiet the household');

// the snapshot: the test lane, household fields neutral, a test's own fields over it
inbox.publish({ user: 'test', id: 'test:3', title: 'Waiting', text: 'icon' });
inbox.publish({ user: 'test', id: 'sms:t1', title: 'Test text' });
testDevices.setStatusOverrides(EMU, { mail: { unread: 4 }, weather: { alerts: 1 } });
const snap = phoneStatus.buildTest(EMU);
assert.ok(snap.notices.waiting >= 2 && snap.notices.list.every((n) => !n.id.startsWith('sms:')), 'notices from the test lane');
assert.strictEqual(snap.sms.fresh, 1);
assert.strictEqual(snap.mail.unread, 4, 'a test sets mail unread');
assert.strictEqual(snap.mail.fresh, 0, 'merged per field');
assert.strictEqual(snap.weather.alerts, 1);
assert.deepStrictEqual(snap.prefs.popupApps, ['com.android.shell'], 'the shell\'s test posts pop up');
assert.ok(!snap.notices.list.some((n) => n.id === 'sms:1'), 'no household notice in it');

// a test device's own Android notifications are not the household's
let tapped = 0;
as.onDeviceEvent(() => { tapped += 1; });
as.event(gr, server, emuLinkInfo, { event: 'notify.posted', detail: { package: 'com.discord', key: 'k' } });
assert.strictEqual(tapped, 0, 'notify.posted from a test device reaches no tap');

// unmarked: a household phone again, its sessions forgotten
assert.ok(testDevices.unmark(EMU));
assert.strictEqual(inbox.userOf(pageInfo), 'admin');
const stored = JSON.parse(fs.readFileSync(process.env.TEST_DEVICES_FILE, 'utf8'));
assert.deepStrictEqual(stored.sessions, {}, 'sessions dropped with the device');

fs.rmSync(tmp, { recursive: true, force: true });
console.log('test-test-devices: ok');
process.exit(0);
