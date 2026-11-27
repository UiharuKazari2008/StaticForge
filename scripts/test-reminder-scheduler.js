#!/usr/bin/env node
'use strict';
// Server reminder scheduler (Yozora #876): node scripts/test-reminder-scheduler.js
// Appointment reminders per occurrence (RRULE daily / weekly BYDAY / monthly, EXDATE, COUNT), all-day
// events, relative and absolute triggers, task reminders (completed ones never), the phone mirror and
// hidden calendars left out, the inbox notice's id / wording / data, one timer for the next one, restart
// catch-up (once, only within 15 minutes), a change re-arming the timer, snooze and dismiss; the task due notice
// (#1290: 8:00 AM or the DUE time, once per due date, same-day catch-up, not after a later write except in the
// agents' calendar, its own switch). Every reminder shape passes the inbox's guard (#1299: a body and a call to
// action); nothing here may be refused.
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
// the inbox files a refused notice in the server's fault store: caught here, so a test run never writes it
const refusals = [];
require('../modules/serverFaultCapture').capture = (err, kind, extra) => { refusals.push((extra && extra.id) || err.message); };

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
    // #1305 S18: a phone-consent question or in-use status is answered, never snoozed: an error, nothing stored, nothing cleared
    for (const pid of ['device-ask:LS18', 'device-hold:a53']) {
        inbox.publish({ user: 'admin', app: 'claudedesk', id: pid, cls: 'notification', title: 'Phone consent', text: 'x', alert: false, data: { answerType: 'device_consent_answer' } });
        const refused = rem.snooze('admin', pid, { minutes: 5 });
        assert.strictEqual(refused.ok, false, `${pid}: refused`);
        assert.ok(/phone request/.test(refused.error), 'the caller is told why');
        assert.strictEqual(byId(pid).state, 'new', `${pid}: still waiting, not cleared`);
        assert.deepStrictEqual(rem.status().snoozed.filter((x) => x.id === pid), [], `${pid}: nothing stored to bring it back`);
        assert.ok(!clearedOnPhones.includes(pid), 'the phones do not take it down');
        inbox.ack('admin', pid, 'cleared');
    }
    assert.strictEqual(rem._test.timerDelay(), 5 * 60000, 'the timer is still the reminder snooze\'s');
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

    // ==== the task due notice (#1290): a task with a DUE and no absolute reminder
    const todo = (uid, lines) => `BEGIN:VTODO\r\nUID:${uid}\r\nSUMMARY:Task ${uid}\r\n${lines.join('\r\n')}\r\nEND:VTODO\r\n`;
    const stampAt = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
    const dueDate = (d) => `DUE;VALUE=DATE:202611${d}`;
    const dueId = (uid, ms) => `rem:task:${uid}:due:${ms}`;
    const REG = 'HKCU\\Software\\Xyridian\\Melaton\\Windows Calendar';
    const restart = () => { rem._test.reset(); rem._test.setSource(async () => files); rem._test.startNoTimer(); };
    const sent = (id) => toPhones.filter((x) => x.id === id).length;
    registry = {};
    restart();

    // ---- a date-only DUE fires at 8:00, once; the timer wakes for it
    at(local(2026, 11, 19, 7, 0));
    const before8 = `DTSTAMP:${stampAt(local(2026, 11, 18, 12, 0))}`;
    // a relative VALARM on a task is not fired, so it counts as no reminder
    files = [file('t1', ics(todo('d1', [dueDate('19'), before8]) + todo('rel', [dueDate('19'), before8, alarm('TRIGGER:-PT15M')]) + todo('nostamp', [dueDate('19')])))];
    await rem.tick();
    const d1 = dueId('d1', local(2026, 11, 19));
    assert.deepStrictEqual(ids().sort(), [d1, dueId('nostamp', local(2026, 11, 19)), dueId('rel', local(2026, 11, 19))].sort());
    assert.ok(rem._test.items().every((i) => i.at === local(2026, 11, 19, 8, 0) && i.dueNotice === true));
    assert.strictEqual(rem._test.timerDelay(), 3600000, 'armed for 8:00');
    assert.ok(!byId(d1), 'not before 8:00');
    at(local(2026, 11, 19, 8, 0));
    await rem.tick();
    n = byId(d1);
    assert.ok(n, 'fired at 8:00');
    assert.deepStrictEqual([n.app, n.cls, n.title, n.text], ['tasks', 'reminder', '8:00 | Reminder', 'Task d1\nDue: 11/19/2026']);
    assert.deepStrictEqual(n.actions, ['dismiss', 'snooze']);
    assert.deepStrictEqual([n.data.app, n.data.kind, n.data.task, n.data.uid, n.data.start, n.data.due, n.data.dueNotice, n.data.fileId], ['tasks', 'reminder', true, 'd1', local(2026, 11, 19, 8, 0), local(2026, 11, 19), true, 't1']);
    assert.strictEqual(n.expiresAt, local(2026, 11, 19, 8, 0) + 24 * 3600000);
    at(local(2026, 11, 19, 8, 0) + 1000);
    await rem.tick();
    assert.strictEqual(sent(d1), 1, 'once');
    // the desktop Calendar's save rewrites every DTSTAMP, and a rescan after it (or after a restart) repeats nothing
    for (const stamp of [local(2026, 11, 19, 8, 30), local(2026, 11, 18, 12, 0)]) {
        files = [file('t1', ics(todo('d1', [dueDate('19'), `DTSTAMP:${stampAt(stamp)}`])))];
        at(local(2026, 11, 19, 9, 0));
        await rem.tick();
        restart();
        at(local(2026, 11, 19, 23, 0));
        await rem.tick();
        assert.strictEqual(sent(d1), 1, 'never again for this due date');
    }

    // ---- a DUE with a time: at that time (UTC and TZID forms)
    at(local(2026, 11, 19, 12, 0));
    files = [file('t2', ics(todo('tm', ['DUE:20261119T203000Z', before8]) + todo('tz', ['DUE;TZID=America/New_York:20261119T170000', before8])))];
    await rem.tick();
    const tm = dueId('tm', Date.UTC(2026, 10, 19, 20, 30));
    assert.deepStrictEqual(rem._test.items().map((i) => [i.id, i.at]), [[tm, local(2026, 11, 19, 15, 30)], [dueId('tz', local(2026, 11, 19, 17, 0)), local(2026, 11, 19, 17, 0)]]);
    assert.strictEqual(rem._test.timerDelay(), 3.5 * 3600000);
    at(local(2026, 11, 19, 15, 30));
    await rem.tick();
    assert.strictEqual(byId(tm).title, '3:30 | Reminder');

    // ---- an absolute reminder (ahead or long past): that one only; completed / cancelled / no DUE / no UID: none
    at(local(2026, 11, 19, 7, 0));
    files = [
        file('t3', ics(
            todo('has', [dueDate('19'), before8, alarm('TRIGGER;VALUE=DATE-TIME:20261119T150000Z')])
            + todo('had', [dueDate('19'), before8, alarm('TRIGGER;VALUE=DATE-TIME:20261110T150000Z')])
            + todo('done', [dueDate('19'), before8, 'STATUS:COMPLETED', 'PERCENT-COMPLETE:100'])
            + todo('pct', [dueDate('19'), before8, 'PERCENT-COMPLETE:100'])
            + todo('comp', [dueDate('19'), before8, 'COMPLETED:20261118T150000Z'])
            + todo('canc', [dueDate('19'), before8, 'STATUS:CANCELLED'])
            + todo('undated', [before8])
            + `BEGIN:VTODO\r\nSUMMARY:No uid\r\n${dueDate('19')}\r\nEND:VTODO\r\n`
        )),
        file('t3p', ics(todo('mirror', [dueDate('19'), before8]), 'X-MELATON-SOURCE:phone:Xperia\r\n')),
        file('t3h', ics(todo('hidden', [dueDate('19'), before8])).replace('X-WR-CALNAME:Mine', 'X-WR-CALNAME:Work')),
    ];
    registry = { [REG]: { Hidden: '["Work"]' } };
    await rem.tick();
    assert.deepStrictEqual(ids(), [`rem:task:has:${Date.UTC(2026, 10, 19, 15, 0)}`]);
    assert.ok(!('dueNotice' in rem._test.items()[0].notice.data), 'her own reminder is not a due notice');
    registry = {};

    // ---- an earlier day's DUE: never (no flood on deploy), not even minutes after midnight; tomorrow's waits
    at(local(2026, 11, 20, 0, 5));
    files = [file('t4', ics(todo('y', [dueDate('19'), before8]) + todo('old', ['DUE;VALUE=DATE:20250101', 'DTSTAMP:20241201T000000Z']) + todo('late', ['DUE;TZID=America/New_York:20261119T235500', before8]) + todo('tom', [dueDate('21'), before8])))];
    toPhones.length = 0;
    await rem.tick();
    assert.deepStrictEqual(ids(), [dueId('tom', local(2026, 11, 21))]);
    assert.strictEqual(toPhones.length, 0);
    at(local(2026, 11, 20, 23, 59));
    await rem.tick();
    assert.strictEqual(toPhones.length, 0);

    // ---- the server was down at 8:00: it fires later the same day, once; a day later it does not
    restart();
    files = [file('t5', ics(todo('down', [dueDate('20'), before8]) + todo('gone', [dueDate('19'), before8])))];
    at(local(2026, 11, 20, 17, 45));
    toPhones.length = 0;
    await rem.tick();
    assert.deepStrictEqual(toPhones.map((x) => x.id), [dueId('down', local(2026, 11, 20))]);
    assert.strictEqual(byId(dueId('down', local(2026, 11, 20))).title, '8:00 | Reminder');
    restart();
    await rem.tick();
    assert.strictEqual(toPhones.length, 1, 'not again after a restart');

    // ---- written after the moment (the newest of LAST-MODIFIED / DTSTAMP): none; the agents' calendar still does
    restart();
    at(local(2026, 11, 22, 10, 0));
    const early = stampAt(local(2026, 11, 22, 7, 59));
    const after = stampAt(local(2026, 11, 22, 9, 0));
    const body = (p) => todo(`${p}s`, [dueDate('22'), `DTSTAMP:${after}`])
        + todo(`${p}m`, [dueDate('22'), `DTSTAMP:${early}`, `LAST-MODIFIED:${after}`])
        + todo(`${p}r`, [dueDate('22'), `LAST-MODIFIED:${early}`, `DTSTAMP:${after}`])
        + todo(`${p}ok`, [dueDate('22'), `DTSTAMP:${early}`, `LAST-MODIFIED:${early}`]);
    files = [file('t6', ics(body('mine-'))), file('t6a', ics(body('ag-'), 'X-MELATON-OWNER:agents\r\n'))];
    toPhones.length = 0;
    await rem.tick();
    assert.deepStrictEqual(toPhones.map((x) => x.data.uid).sort(), ['ag-m', 'ag-ok', 'ag-r', 'ag-s', 'mine-ok']);
    // a timed DUE already past when it was written: none
    files = [file('t6t', ics(todo('past', ['DUE;TZID=America/New_York:20261122T083000', `DTSTAMP:${after}`])))];
    await rem.tick();
    assert.deepStrictEqual(ids(), []);

    // ---- the switch (TaskDueNotice), read at fire time: off fires none and marks none; her own reminders still fire
    restart();
    at(local(2026, 11, 23, 7, 0));
    const early23 = `DTSTAMP:${stampAt(local(2026, 11, 22, 12, 0))}`;
    files = [file('t7', ics(todo('sw', [dueDate('23'), early23]) + todo('own', [dueDate('23'), early23, alarm('TRIGGER;VALUE=DATE-TIME:20261123T130000Z')])))];
    const sw = dueId('sw', local(2026, 11, 23));
    toPhones.length = 0;
    registry = { [REG]: { TaskDueNotice: 0 } };
    await rem.tick();
    assert.strictEqual(rem._test.timerDelay(), 3600000, 'still armed: the switch is read when it fires');
    for (const [off, mins] of [[0, 0], ['0', 5], [false, 10]]) {
        registry = { [REG]: { TaskDueNotice: off } };
        at(local(2026, 11, 23, 8, mins));
        await rem.tick();
        assert.ok(!byId(sw), `off (${JSON.stringify(off)}): none`);
    }
    assert.deepStrictEqual(toPhones.map((x) => x.id), [`rem:task:own:${Date.UTC(2026, 10, 23, 13, 0)}`], 'her own reminder is not switched off');
    registry = { [REG]: { TaskDueNotice: 1 } };
    at(local(2026, 11, 23, 14, 0));
    await rem.tick(); // no calendar change
    assert.strictEqual(sent(sw), 1, 'back on the same day: it fires (so it was not marked fired)');
    for (const on of ['1', true, undefined]) {
        registry = { [REG]: on === undefined ? {} : { TaskDueNotice: on } };
        const uid = `on-${String(on)}`;
        files = [file(`t7-${uid}`, ics(todo(uid, [dueDate('23'), early23])))];
        await rem.tick();
        assert.strictEqual(sent(dueId(uid, local(2026, 11, 23))), 1, `on (${String(on)})`);
    }
    registry = {};

    // ---- a repeating task: the server's own reset (modules/taskRecurrence.js, just after midnight) gives the new date its own id
    restart();
    at(local(2026, 11, 24, 8, 0));
    let text = ics(todo('rep', [dueDate('24'), 'RRULE:FREQ=DAILY', `DTSTAMP:${stampAt(local(2026, 11, 23, 12, 0))}`]));
    files = [file('t8', text)];
    await rem.tick();
    assert.strictEqual(sent(dueId('rep', local(2026, 11, 24))), 1);
    const reset = require('../modules/taskRecurrence').resetText(text, local(2026, 11, 25) + 1000);
    assert.strictEqual(reset.resets.length, 1);
    text = reset.text;
    files = [file('t8', text)];
    at(local(2026, 11, 25) + 2000);
    await rem.tick();
    assert.deepStrictEqual(ids(), [dueId('rep', local(2026, 11, 25))]);
    assert.strictEqual(rem._test.timerDelay(), 8 * 3600000 - 2000);
    at(local(2026, 11, 25, 8, 0));
    await rem.tick();
    assert.strictEqual(sent(dueId('rep', local(2026, 11, 25))), 1, 'the new due date fires too');

    // ---- snooze on the new id (also after a Calendar save took the task out of the computed list); dismiss before it fires
    const repId = dueId('rep', local(2026, 11, 25));
    files = [file('t8', text.replace(/DTSTAMP:\w+/, `DTSTAMP:${stampAt(local(2026, 11, 25, 8, 1))}`).replace(/LAST-MODIFIED:\w+\r\n/, ''))];
    at(local(2026, 11, 25, 8, 2));
    await rem.tick();
    assert.deepStrictEqual(ids(), []);
    assert.ok(rem.snooze('admin', repId, { minutes: 10 }).ok);
    assert.strictEqual(byId(repId).state, 'cleared');
    assert.strictEqual(rem._test.timerDelay(), 10 * 60000);
    at(local(2026, 11, 25, 8, 12));
    await rem.tick();
    assert.deepStrictEqual([byId(repId).state, byId(repId).title, sent(repId)], ['new', '8:12 | Reminder', 2]);
    at(local(2026, 11, 25, 8, 20));
    await rem.tick();
    assert.strictEqual(sent(repId), 2, 'nothing more');
    at(local(2026, 11, 26, 7, 0));
    files = [file('t9', ics(todo('dis', [dueDate('26'), `DTSTAMP:${stampAt(local(2026, 11, 25, 12, 0))}`])))];
    await rem.tick();
    assert.ok(rem.dismiss('admin', dueId('dis', local(2026, 11, 26))).ok);
    at(local(2026, 11, 26, 8, 0));
    await rem.tick();
    assert.ok(!byId(dueId('dis', local(2026, 11, 26))), 'dismissed first: never fires');

    // ==== the inbox guard (#1299): every shape of calendar / task reminder and due notice registers, and comes back from a snooze
    restart();
    at(local(2026, 11, 27, 7, 0));
    const g = `DTSTAMP:${stampAt(local(2026, 11, 26, 12, 0))}`;
    const at8 = alarm('TRIGGER;VALUE=DATE-TIME:20261127T130000Z');
    const bare = (uid, lines) => `BEGIN:VTODO\r\nUID:${uid}\r\n${lines.join('\r\n')}\r\nEND:VTODO\r\n`;
    files = [file('g', ics(
        ev('g-rel', ['DTSTART:20261127T131500Z', 'DTEND:20261127T140000Z', 'SUMMARY:Timed', alarm('TRIGGER:-PT15M')])
        + ev('g-allday', ['DTSTART;VALUE=DATE:20261128', 'DTEND;VALUE=DATE:20261129', 'SUMMARY:All day', alarm('TRIGGER:-PT16H')])
        + ev('g-nosubject', ['DTSTART:20261127T130000Z', 'DTEND:20261127T130000Z', alarm('TRIGGER:PT0S')])
        + todo('g-own-due', [dueDate('27'), g, at8])
        + todo('g-own', [g, at8])
        + bare('g-own-empty', [g, at8])
        + bare('g-own-blank', ['SUMMARY:   ', g, at8])
        + todo('g-due', [dueDate('27'), g])
        + todo('g-due-timed', ['DUE:20261127T130000Z', g])
        + bare('g-due-blank', ['SUMMARY:   ', dueDate('27'), g])
    ))];
    await rem.tick();
    const shapes = rem._test.items().slice();
    assert.strictEqual(shapes.length, 10, 'all ten shapes computed');
    at(local(2026, 11, 27, 8, 0));
    await rem.tick();
    const passes = (nt, label) => {
        assert.ok(String(nt.text || '').trim(), `${label}: a body`);
        assert.ok(nt.actions.length && nt.app && nt.data.app, `${label}: a call to action`);
        if (typeof inbox.noticeGap === 'function') assert.strictEqual(inbox.noticeGap(nt), '', `${label}: the guard`);
    };
    for (const s of shapes) {
        passes(s.notice, s.id);
        assert.ok(byId(s.id) && byId(s.id).state === 'new', `${s.id}: registered in the inbox`);
        assert.strictEqual(sent(s.id), 1, `${s.id}: sent to the phones`);
        assert.ok(rem.snooze('admin', s.id, { minutes: 5 }).ok);
    }
    assert.strictEqual(byId('rem:task:g-own-blank:' + local(2026, 11, 27, 8, 0)).text, 'No Subject');
    at(local(2026, 11, 27, 8, 5));
    await rem.tick();
    for (const s of shapes) {
        passes(byId(s.id), `${s.id} after snooze`);
        assert.deepStrictEqual([byId(s.id).state, sent(s.id)], ['new', 2], `${s.id}: back after the snooze`);
    }
    assert.deepStrictEqual(refusals, [], 'the guard refused nothing in this whole run');
    if (typeof inbox.noticeGap === 'function') { // the guard really was in the way of the notices above
        assert.strictEqual(inbox.publish({ user: 'admin', app: 'tasks', id: 'rem:guard-control', cls: 'reminder', title: 't', text: ' ', actions: ['dismiss'] }), null);
        assert.deepStrictEqual(refusals, ['rem:guard-control']);
    }

    rem._test.reset();
    inbox._test.reset();
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('reminder scheduler: all tests passed');
})().catch((e) => {
    console.error(e);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) { /* gone */ }
    process.exit(1);
});
