#!/usr/bin/env node
'use strict';
// Server reminder scheduler (Yozora #876): node scripts/test-reminder-scheduler.js
// Appointment reminders per occurrence (RRULE daily / weekly BYDAY / monthly, EXDATE, COUNT), all-day
// events, relative and absolute triggers, task reminders (completed ones never), the phone mirror and
// hidden calendars left out, the inbox notice's id / wording / data, one timer for the next one, restart
// catch-up (once, only within 15 minutes), a change re-arming the timer, snooze and dismiss.
process.env.TZ = 'America/New_York';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(process.env.REMINDER_TEST_DIR || os.tmpdir(), 'rem-test-'));
process.env.REMINDER_DB = path.join(tmp, 'reminders.db');
process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';

const activeSync = require('../modules/activeSync');
const inbox = require('../modules/notificationInbox');
const rem = require('../modules/reminderScheduler');

const toPhones = [];
const clearedOnPhones = [];
activeSync.sendInboxNotice = (gr, ws, n) => { toPhones.push(n); return 1; };
activeSync.sendInboxCleared = (gr, ws, n) => { clearedOnPhones.push(n.id); return 1; };

let registry = {};
const gr = {
    getWebSocketServer: () => ({ broadcast: () => {} }),
    getConfig: ({ path: p } = {}) => (p === 'userGlobalSettings' ? { registry } : {}),
};
let now = new Date(2026, 10, 16, 9, 0).getTime(); // Mon Nov 16 2026 09:00 local
inbox._test.setNow(() => now);
inbox.bind(gr);
rem._test.setNow(() => now);
rem._test.bind(gr);

let files = [];
rem._test.setSource(async () => files);
const ics = (body, head = '') => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Mine\r\n${head}${body}END:VCALENDAR\r\n`;
const ev = (uid, lines) => `BEGIN:VEVENT\r\nUID:${uid}\r\n${lines.join('\r\n')}\r\nEND:VEVENT\r\n`;
const alarm = (trigger) => `BEGIN:VALARM\r\nACTION:DISPLAY\r\n${trigger}\r\nEND:VALARM`;
let hashN = 0;
const file = (fileId, text, name = `${fileId}.ics`) => ({ fileId, name, workspace: 'default', hash: `h${(hashN += 1)}`, text });
const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const byId = (id) => inbox.list('admin', { includeCleared: true }).find((n) => n.id === id);
const at = (ms) => { now = ms; };
const ids = () => rem._test.items().map((i) => i.id);

(async () => {
    rem._test.startNoTimer();

    // ---- a single appointment, -PT15M: computed, the timer waits for it, fires once on time
    files = [file('f1', ics(ev('ev1', ['DTSTART:20261116T150000Z', 'DTEND:20261116T160000Z', 'SUMMARY:Team sync', 'LOCATION:Room 3', alarm('TRIGGER:-PT15M')])))];
    await rem.tick();
    const start1 = Date.UTC(2026, 10, 16, 15, 0);
    const id1 = `rem:f1:ev1:${start1}`;
    assert.deepStrictEqual(ids(), [id1]);
    assert.strictEqual(rem._test.items()[0].at, start1 - 15 * 60000, '15 minutes before');
    assert.ok(!byId(id1), 'not yet');
    assert.strictEqual(rem._test.timerDelay(), 45 * 60000, 'one timer for the next one (9:45)');
    at(local(2026, 11, 16, 9, 45));
    await rem.tick();
    let n = byId(id1);
    assert.ok(n, 'fired at 9:45');
    assert.strictEqual(n.cls, 'reminder');
    assert.strictEqual(n.app, 'calendar');
    assert.strictEqual(n.title, '9:45 | Reminder');
    assert.strictEqual(n.text, 'Team sync\n10:00 AM-11:00 AM\nRoom 3');
    assert.deepStrictEqual([n.data.app, n.data.kind, n.data.uid, n.data.start, n.data.calendar, n.data.fileId], ['calendar', 'reminder', 'ev1', start1, 'Mine', 'f1']);
    assert.strictEqual(n.expiresAt, Date.UTC(2026, 10, 16, 16, 0), 'until the appointment ends');
    assert.strictEqual(toPhones.length, 1, 'sent to the phones');
    assert.strictEqual(toPhones[0].id, id1);
    at(now + 1000);
    await rem.tick();
    assert.strictEqual(toPhones.length, 1, 'never twice');

    // ---- weekly BYDAY with EXDATE, interval: Wed 18 excluded, Thu not a BYDAY
    const weekly = (exdate) => file('f2', ics(ev('wk', ['DTSTART;TZID=America/New_York:20261102T080000', 'DTEND;TZID=America/New_York:20261102T083000', 'RRULE:FREQ=WEEKLY;BYDAY=MO,WE', 'SUMMARY:Standup', ...(exdate ? ['EXDATE;TZID=America/New_York:20261118T080000'] : []), alarm('TRIGGER:-PT10M')])));
    at(local(2026, 11, 17, 20, 0));
    files = [weekly(true)];
    await rem.tick();
    assert.deepStrictEqual(ids(), [], 'EXDATE honoured');
    files = [weekly(false)];
    await rem.tick();
    assert.deepStrictEqual(ids(), [`rem:f2:wk:${local(2026, 11, 18, 8, 0)}`], 'the Wednesday occurrence without the EXDATE');
    assert.strictEqual(rem._test.items()[0].at, local(2026, 11, 18, 7, 50));
    assert.strictEqual(rem._test.items()[0].notice.text, 'Standup\nWed 11/18 8:00 AM-8:30 AM', 'another day: the date in front');
    // biweekly: every other Monday from Nov 2 -> Nov 16, Nov 30 (not Nov 23)
    at(local(2026, 11, 22, 8, 0));
    files = [file('f2b', ics(ev('bw', ['DTSTART:20261102T140000Z', 'DTEND:20261102T150000Z', 'RRULE:FREQ=WEEKLY;INTERVAL=2', 'SUMMARY:Payday', alarm('TRIGGER:-PT1440M')])))];
    await rem.tick();
    assert.deepStrictEqual(ids(), [], 'Nov 23 is the off week');
    at(local(2026, 11, 29, 8, 0));
    await rem.tick();
    assert.deepStrictEqual(ids(), [`rem:f2b:bw:${Date.UTC(2026, 10, 30, 14, 0)}`], 'Nov 30 (a day ahead)');

    // ---- daily with INTERVAL and COUNT
    at(local(2026, 11, 16, 9, 0));
    files = [file('f3', ics(ev('d', ['DTSTART:20261110T150000Z', 'DTEND:20261110T153000Z', 'RRULE:FREQ=DAILY;INTERVAL=2;COUNT=4', 'SUMMARY:Pills', alarm('TRIGGER:PT0S')])))];
    await rem.tick();
    assert.deepStrictEqual(ids(), [`rem:f3:d:${Date.UTC(2026, 10, 16, 15, 0)}`], 'Nov 16 is the 4th (10, 12, 14, 16)');
    at(local(2026, 11, 17, 9, 0));
    await rem.tick();
    assert.deepStrictEqual(ids(), [], 'COUNT ends it');

    // ---- monthly 3rd Monday
    at(local(2026, 11, 15, 12, 0));
    files = [file('f3m', ics(ev('m', ['DTSTART:20260119T170000Z', 'DTEND:20260119T180000Z', 'RRULE:FREQ=MONTHLY;BYDAY=3MO', 'SUMMARY:Club', alarm('TRIGGER:-PT1H')])))];
    await rem.tick();
    assert.deepStrictEqual(ids(), [`rem:f3m:m:${local(2026, 11, 16, 12, 0)}`], 'Nov 16 is the third Monday');

    // ---- all-day, a day-before reminder: "Tue 11/17 All Day"
    at(local(2026, 11, 16, 8, 0));
    files = [file('f4', ics(ev('ad', ['DTSTART;VALUE=DATE:20261117', 'DTEND;VALUE=DATE:20261118', 'SUMMARY:Holiday', alarm('TRIGGER:-PT15H')])))];
    await rem.tick();
    let it = rem._test.items()[0];
    assert.strictEqual(it.id, `rem:f4:ad:${local(2026, 11, 17)}`);
    assert.strictEqual(it.at, local(2026, 11, 16, 9, 0), '15 h before midnight');
    assert.strictEqual(it.notice.text, 'Holiday\nTue 11/17 All Day');
    assert.strictEqual(it.notice.data.allDay, true);

    // ---- absolute trigger on an appointment
    files = [file('f5', ics(ev('abs', ['DTSTART:20261117T150000Z', 'DTEND:20261117T160000Z', 'SUMMARY:Dentist', alarm('TRIGGER;VALUE=DATE-TIME:20261116T200000Z')])))];
    await rem.tick();
    it = rem._test.items()[0];
    assert.strictEqual(it.id, `rem:f5:abs:${Date.UTC(2026, 10, 17, 15, 0)}`);
    assert.strictEqual(it.at, Date.UTC(2026, 10, 16, 20, 0), 'at the given moment');

    // ---- tasks: reminderAt, completed ones never; the phone mirror and hidden calendars left out
    const task = (uid, extra) => `BEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:Task ${uid}\r\nDUE;VALUE=DATE:20261117\r\n${extra.join('\r\n')}${extra.length ? '\r\n' : ''}${alarm('TRIGGER;VALUE=DATE-TIME:20261116T150000Z')}\r\nEND:VTODO\r\n`;
    files = [
        file('f6', ics(task('t1', []) + task('t2', ['STATUS:COMPLETED']))),
        file('f7', ics(ev('ph', ['DTSTART:20261116T160000Z', 'DTEND:20261116T170000Z', 'SUMMARY:Phone one', alarm('TRIGGER:-PT15M')]), 'X-MELATON-SOURCE:phone:Xperia\r\n')),
        file('f8', ics(ev('hid', ['DTSTART:20261116T160000Z', 'DTEND:20261116T170000Z', 'SUMMARY:Hidden one', alarm('TRIGGER:-PT15M')])).replace('X-WR-CALNAME:Mine', 'X-WR-CALNAME:Work')),
    ];
    registry = { 'HKCU\\Software\\Xyridian\\Melaton\\Windows Calendar': { Hidden: '["Work"]' } };
    await rem.tick();
    const tid = `rem:task:t1:${Date.UTC(2026, 10, 16, 15, 0)}`;
    assert.deepStrictEqual(ids(), [tid], 'the open task only');
    it = rem._test.items()[0];
    assert.strictEqual(it.notice.app, 'tasks');
    assert.strictEqual(it.notice.text, 'Task t1\nDue: 11/17/2026');
    assert.strictEqual(it.notice.expiresAt, it.at + 24 * 3600000, 'a day for tasks');
    registry = {};
    await rem.tick();
    assert.deepStrictEqual(ids().sort(), [tid, `rem:f8:hid:${Date.UTC(2026, 10, 16, 16, 0)}`].sort(), 'shown again when not hidden; phone mirror still out');

    // ---- restart catch-up: due 10 min ago fires once; 40 min ago does not; nothing repeats after a restart
    rem._test.reset();
    rem._test.setSource(async () => files);
    rem._test.startNoTimer();
    files = [file('f9', ics(
        ev('late', ['DTSTART:20261116T160000Z', 'DTEND:20261116T170000Z', 'SUMMARY:Late one', alarm('TRIGGER:-PT15M')]) +
        ev('old', ['DTSTART:20261116T153000Z', 'DTEND:20261116T163000Z', 'SUMMARY:Old one', alarm('TRIGGER:-PT15M')])
    ))];
    // late: 11:00 local, due 10:45; old: 10:30 local, due 10:15. The server comes back at 10:55.
    at(local(2026, 11, 16, 10, 55));
    toPhones.length = 0;
    await rem.tick();
    const lateId = `rem:f9:late:${Date.UTC(2026, 10, 16, 16, 0)}`;
    const oldId = `rem:f9:old:${Date.UTC(2026, 10, 16, 15, 30)}`;
    assert.ok(byId(lateId), 'due 10 min ago: fired on start');
    assert.ok(!byId(oldId), 'due 40 min ago: too late, left out');
    assert.strictEqual(toPhones.length, 1);
    rem._test.reset(); // a restart: the fired ids are in sqlite
    rem._test.setSource(async () => files);
    rem._test.startNoTimer();
    at(now + 60000);
    await rem.tick();
    assert.strictEqual(toPhones.length, 1, 'not again after a restart');

    // ---- a change re-arms the timer (debounced rescan); a non-.ics write is ignored
    at(local(2026, 11, 16, 12, 0));
    files = [];
    await rem.tick();
    assert.strictEqual(rem._test.timerDelay(), 12 * 3600000, 'nothing due: the window rolls on in 12 h');
    files = [file('f10', ics(ev('new', ['DTSTART:20261116T173000Z', 'DTEND:20261116T180000Z', 'SUMMARY:Added', alarm('TRIGGER:-PT5M')])))];
    rem.changed({ name: 'photo.png' });
    await new Promise((r) => setTimeout(r, 2800));
    assert.strictEqual(rem._test.timerDelay(), 12 * 3600000, 'a picture does not rescan');
    rem.changed({ name: 'Mine.ics' });
    await new Promise((r) => setTimeout(r, 2800));
    assert.strictEqual(rem._test.timerDelay(), 25 * 60000, 're-armed for 12:25');
    assert.strictEqual(typeof require('../modules/vfsDatabase').onUserFilesChanged, 'function', 'the VFS change hook exists');

    // ---- snooze: cleared now (the phones take it down), back with the same id later
    at(local(2026, 11, 16, 12, 25));
    await rem.tick();
    const addId = `rem:f10:new:${Date.UTC(2026, 10, 16, 17, 30)}`;
    assert.strictEqual(byId(addId).state, 'new');
    const sn = rem.snooze('admin', addId, { minutes: 5 });
    assert.ok(sn.ok);
    assert.strictEqual(byId(addId).state, 'cleared');
    assert.ok(clearedOnPhones.includes(addId), 'the phones cancel theirs');
    assert.strictEqual(rem._test.timerDelay(), 5 * 60000, 'armed for the snooze');
    assert.ok(!rem.snooze('dev_admin', addId, { minutes: 5 }).ok, 'not for dev_admin');
    at(local(2026, 11, 16, 12, 30));
    const before = toPhones.length;
    await rem.tick();
    n = byId(addId);
    assert.strictEqual(n.state, 'new', 'back');
    assert.strictEqual(n.title, '12:30 | Reminder', 'with the time it came back');
    assert.strictEqual(toPhones.length, before + 1);
    assert.deepStrictEqual(rem.status().snoozed, []);

    // ---- dismissed in the desktop Calendar before the server fired it: never fires
    files = [file('f11', ics(ev('dd', ['DTSTART:20261116T180000Z', 'DTEND:20261116T183000Z', 'SUMMARY:Gone', alarm('TRIGGER:-PT10M')])))];
    await rem.tick();
    const ddId = `rem:f11:dd:${Date.UTC(2026, 10, 16, 18, 0)}`;
    assert.ok(!rem.dismiss('dev_admin', ddId).ok, 'dev_admin cannot silence the phone');
    assert.ok(rem.dismiss('admin', ddId).ok);
    at(local(2026, 11, 16, 12, 50));
    await rem.tick();
    assert.ok(!byId(ddId), 'dismissed: not fired');

    rem._test.reset();
    inbox._test.reset();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('reminder scheduler: all tests passed');
})().catch((e) => {
    console.error(e);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* gone */ }
    process.exit(1);
});
