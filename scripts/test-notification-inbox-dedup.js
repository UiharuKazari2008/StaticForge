#!/usr/bin/env node
'use strict';
// One weather event is one notice, and a dismissed alert never sounds twice (Yozora #1194):
//   node scripts/test-notification-inbox-dedup.js
const assert = require('assert');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

const activeSync = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');
const src = require('../modules/notificationInboxSources');

const toPhones = [];
activeSync.sendInboxNotice = (gr, ws, notice) => { toPhones.push(notice); return 1; };
activeSync.sendInboxCleared = () => 1;
const pushed = [];
const gr = { getWebSocketServer: () => ({ broadcast: (m) => pushed.push(m) }) };
let now = Date.parse('2026-11-25T12:00:00Z');
inbox._test.setNow(() => now);
inbox.bind(gr);

const get = (id) => inbox.get('admin', id);
const loudPhones = (id) => toPhones.filter((n) => n.id === id && n.alert === true).length;
const newBroadcasts = (id) => pushed.filter((m) => m.type === 'inbox_updated' && m.data.reason === 'new' && m.data.notice.id === id).length;
const home = { id: 'home', label: 'Home', name: 'Jersey City' };
const work = { id: 'work', label: 'Work', name: 'Manhattan' };
const third = { id: 'cur', label: 'Here', name: 'Newark' };
const wx = (extra) => Object.assign({ id: 'A', title: 'Wind Advisory', severity: 'moderate', expires: '2026-11-27T11:00', area: 'NYC metro' }, extra);

(async () => {
    // 1. one alert for two places: one row, both places, one sound
    const r1 = src.onWeatherAlert({ alert: wx(), place: home });
    assert.strictEqual(r1.alert, true, 'the first report sounds');
    now += 1000;
    const r2 = src.onWeatherAlert({ alert: wx(), place: work });
    assert.strictEqual(r2.alert, false, 'a second place on a live alert is silent');
    const rows = inbox.list('admin').filter((n) => n.id.startsWith('wx:'));
    assert.deepStrictEqual(rows.map((n) => n.id), ['wx:A'], 'one row for the event');
    assert.deepStrictEqual(rows[0].data.places.map((p) => p.id), ['home', 'work']);
    assert.strictEqual(rows[0].data.alertId, 'A');
    assert.match(rows[0].text, /^Home, Work: /, 'the text names both places');
    assert.strictEqual(loudPhones('wx:A'), 1, 'the phones got one loud notice');
    assert.strictEqual(toPhones.filter((n) => n.id === 'wx:A').length, 2, 'the silent update still reaches the phones (in place)');
    src.onWeatherAlert({ alert: wx(), place: work });
    assert.strictEqual(get('wx:A').data.places.length, 2, 'places are deduped by id');

    // 2. dismissed: more places, nothing comes back
    inbox.clear('admin', 'wx:A', 'page');
    toPhones.length = 0;
    pushed.length = 0;
    const r3 = src.onWeatherAlert({ alert: wx(), place: home });
    const r4 = src.onWeatherAlert({ alert: wx({ title: 'Wind Advisory' }), place: third });
    assert.strictEqual(r3.alert, false);
    assert.strictEqual(r4.alert, false);
    assert.strictEqual(r4.state, 'cleared', 'the kept state is returned');
    assert.strictEqual(get('wx:A').state, 'cleared');
    assert.deepStrictEqual(get('wx:A').data.places.map((p) => p.id), ['home', 'work', 'cur'], 'the places are still merged');
    assert.strictEqual(toPhones.length, 0, 'no phone push for a dismissed alert');
    assert.strictEqual(newBroadcasts('wx:A'), 0, 'no inbox_updated new');
    assert.ok(!inbox.list('admin').some((n) => n.id === 'wx:A'), 'not in the default list');
    assert.ok(!inbox.pendingForPhones('admin').some((n) => n.id === 'wx:A'), 'not replayed to a phone that says hello');

    // 3. escalation sounds, a downgrade is silent
    const e1 = src.onWeatherAlert({ alert: wx({ severity: 'severe' }), place: home });
    assert.strictEqual(e1.alert, true, 'escalation to severe sounds');
    assert.strictEqual(e1.state, 'new');
    assert.strictEqual(e1.cls, 'weather-severe');
    assert.strictEqual(loudPhones('wx:A'), 1);
    const d1 = src.onWeatherAlert({ alert: wx({ severity: 'moderate' }), place: home });
    assert.strictEqual(d1.alert, false, 'a downgrade is silent');
    assert.strictEqual(loudPhones('wx:A'), 1);
    inbox.clear('admin', 'wx:A', 'page');
    assert.strictEqual(src.onWeatherAlert({ alert: wx({ severity: 'moderate' }), place: work }).alert, false, 'dismissed stays dismissed');

    // 4. another end day is a different alert; the same day is not
    assert.strictEqual(src.onWeatherAlert({ alert: wx({ expires: '2026-11-27T18:00' }), place: home }).alert, false, 'a same-day extension is no news');
    assert.strictEqual(get('wx:A').state, 'cleared');
    const m1 = src.onWeatherAlert({ alert: wx({ expires: '2026-11-28T06:00' }), place: home });
    assert.strictEqual(m1.alert, true, 'another day sounds');
    assert.strictEqual(m1.state, 'new');
    assert.strictEqual(src.onWeatherAlert({ alert: wx({ title: 'High Wind Warning', expires: '2026-11-28T06:00' }), place: home }).alert, true, 'another title sounds');

    // 5. texts: the message is what is news
    const sms = (guid, text, extra) => src.onTextEvent(Object.assign({ accountId: 'acc', chatGuid: 'c1', event: 'message', notify: true, chatTitle: 'Rin', message: { guid, date: 1000, text, sender: { name: 'Rin' } } }, extra));
    toPhones.length = 0;
    sms('g1', 'ok');
    sms('g2', 'ok');
    assert.strictEqual(loudPhones('sms:acc:c1'), 2, 'two separate identical texts both sound');
    sms('g2', 'ok');
    assert.strictEqual(loudPhones('sms:acc:c1'), 2, 'the same message twice is silent');
    inbox.clear('admin', 'sms:acc:c1', 'page');
    sms('g2', 'ok');
    assert.strictEqual(get('sms:acc:c1').state, 'cleared', 'the cleared conversation stays cleared for the same message');
    assert.strictEqual(loudPhones('sms:acc:c1'), 2);
    sms('g3', 'ok');
    assert.strictEqual(loudPhones('sms:acc:c1'), 3, 'a new message in a cleared conversation sounds');
    assert.strictEqual(get('sms:acc:c1').state, 'new');

    // 6. a live countdown-style notice is updated in place, silent
    const c1 = inbox.publish({ app: 'lapis', id: 'lapis:run-left', cls: 'lapis-run-left', title: '5 minutes left', text: 'x' });
    const c2 = inbox.publish({ app: 'lapis', id: 'lapis:run-left', cls: 'lapis-run-left', title: '4 minutes left', text: 'x' });
    assert.deepStrictEqual([c1.alert, c2.alert], [true, false]);

    // 7. different notices all sound
    toPhones.length = 0;
    for (let i = 0; i < 5; i += 1) inbox.publish({ app: 'x', id: `n:${i}`, cls: 'notification', title: `T${i}`, text: 'same text' });
    assert.strictEqual(toPhones.filter((n) => n.alert === true).length, 5, 'five different notices, five loud pushes');

    // 8. a cleared notice again with the same words (no producer digest) stays cleared and silent
    inbox.publish({ app: 'x', id: 'dup', cls: 'notification', title: 'Same', text: 'words', ttlMs: 1000 });
    inbox.clear('admin', 'dup', 'page');
    toPhones.length = 0;
    pushed.length = 0;
    const created = get('dup').createdAt;
    const again = inbox.publish({ app: 'x', id: 'dup', cls: 'notification', title: 'Same', text: 'words', ttlMs: 60000 });
    assert.strictEqual(again.alert, false);
    assert.strictEqual(again.state, 'cleared');
    assert.strictEqual(get('dup').createdAt, created, 'createdAt kept');
    assert.strictEqual(get('dup').expiresAt, now + 60000, 'expiresAt is the later one');
    assert.strictEqual(toPhones.length, 0);
    assert.strictEqual(newBroadcasts('dup'), 0);
    const changed = inbox.publish({ app: 'x', id: 'dup', cls: 'notification', title: 'Same', text: 'other words' });
    assert.strictEqual(changed.alert, true, 'other words are news');
    assert.strictEqual(changed.state, 'new');

    // a legacy row (no digest) is judged on what it stored; the test lane follows the same rule
    inbox.publish({ app: 'x', id: 'old', cls: 'notification', title: 'Old', text: 'row' });
    inbox._test.database().prepare("UPDATE notices SET digest = NULL, state = 'cleared' WHERE id = 'old'").run();
    assert.strictEqual(inbox.publish({ app: 'x', id: 'old', cls: 'notification', title: 'Old', text: 'row' }).alert, false, 'legacy row, same words: unchanged');
    inbox._test.database().prepare("UPDATE notices SET digest = NULL WHERE id = 'old'").run();
    assert.strictEqual(inbox.publish({ app: 'x', id: 'old', cls: 'notification', title: 'Old', text: 'row', digest: 'k' }).alert, false, 'legacy row, custom digest, same title and class: unchanged');
    inbox.publish({ user: 'test', app: 'x', id: 't', cls: 'notification', title: 'T', text: 't', alert: true });
    inbox.clear('test', 't', 'x');
    assert.strictEqual(inbox.publish({ user: 'test', app: 'x', id: 't', cls: 'notification', title: 'T', text: 't', alert: true }).alert, false, 'the test lane follows the same rule: dismissed and unchanged stays quiet');
    assert.strictEqual(inbox.publish({ user: 'test', app: 'x', id: 't', cls: 'notification', title: 'T', text: 't', alert: true, returning: true }).alert, true, 'a snooze ending comes back loud');
    assert.strictEqual(inbox.get('test', 't').state, 'new');

    // a rain alarm is once per spell: a later spell with the same words is a new event, loud even after a dismissal
    const rain = { place: { id: 'home', label: 'Home' }, startsInMin: 10, endsInMin: 40, kind: 'Rain' };
    assert.strictEqual(src.onRainAlarm(rain).alert, true, 'the first spell sounds');
    inbox.clear('admin', 'rain:home', 'x');
    now += 1000;
    assert.strictEqual(src.onRainAlarm(rain).alert, true, 'the next spell sounds though its words are the same');

    console.log('notification inbox dedup: ok');
    process.exit(0); // phoneStatus.touch leaves a debounce timer open
})().catch((e) => { console.error(e); process.exit(1); });
