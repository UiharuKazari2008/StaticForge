#!/usr/bin/env node
'use strict';
// Server task recurrence (Yozora #1203): node scripts/test-task-recurrence.js
// A repeating task (VTODO with an RRULE) is unchecked and moved to its current date by the server: daily /
// weekly BYDAY / interval, missed dates skipped, an unfinished task rolls on too, DTSTART and an absolute
// VALARM move with it (across a DST change), UNTIL honoured, subscriptions untouched, every other line
// byte for byte, idempotent, the scheduler writing once and arming its one timer for the next midnight.
process.env.TZ = 'America/New_York';
const assert = require('assert');
const tr = require('../modules/taskRecurrence');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed += 1; };
const eq = (a, b, msg) => { assert.deepStrictEqual(a, b, msg); passed += 1; };

const local = (y, mo, d, h = 0, mi = 0) => new Date(y, mo - 1, d, h, mi).getTime();
const NL = '\r\n';
const cal = (body, head = '') => `BEGIN:VCALENDAR${NL}VERSION:2.0${NL}X-WR-CALNAME:Mine${NL}${head}${body}END:VCALENDAR${NL}`;
const todo = (lines) => `BEGIN:VTODO${NL}${lines.join(NL)}${NL}END:VTODO${NL}`;
const done = ['STATUS:COMPLETED', 'PERCENT-COMPLETE:100', 'COMPLETED:20261125T150000Z'];
const lineOf = (text, prefix) => text.split(/\r\n/).find((l) => l.startsWith(prefix));
const has = (text, prefix) => lineOf(text, prefix) !== undefined;

const NOW = local(2026, 11, 26, 9, 30); // Thu Nov 26 2026 09:30 local
const daily = (due, extra = []) => cal(todo(['UID:t1', 'SUMMARY:Water the plants', 'RRULE:FREQ=DAILY', `DUE;VALUE=DATE:${due}`, ...extra]));

(async () => {
    // ---- daily, done yesterday -> undone today, DUE today
    let r = tr.resetText(daily('20261125', done), NOW);
    eq(r.resets, [{ uid: 't1', from: '2026-11-25', to: '2026-11-26' }], 'reset recorded');
    ok(has(r.text, 'DUE;VALUE=DATE:20261126'), 'DUE today');
    ok(!has(r.text, 'STATUS') && !has(r.text, 'PERCENT-COMPLETE') && !has(r.text, 'COMPLETED'), 'done lines gone');
    ok(has(r.text, 'LAST-MODIFIED:20261126T143000Z') && has(r.text, 'DTSTAMP:20261126T143000Z'), 'stamps set to now (UTC)');
    eq(r.nextAt, local(2026, 11, 27), 'next reset: tomorrow midnight');
    ok(!/[^\r]\n/.test(r.text), 'CRLF kept');

    // ---- idempotent: the second run changes nothing
    const again = tr.resetText(r.text, NOW);
    eq(again.text, r.text, 'idempotent');
    eq(again.resets, [], 'second run: no resets');
    eq(again.nextAt, local(2026, 11, 27), 'still tomorrow midnight');

    // ---- daily, done today -> unchanged until midnight
    const doneToday = daily('20261126', done);
    r = tr.resetText(doneToday, NOW);
    eq(r.text, doneToday, 'unchanged today');
    eq(r.nextAt, local(2026, 11, 27), 'nextAt is the next local midnight');
    r = tr.resetText(doneToday, local(2026, 11, 26, 23, 59));
    eq(r.resets, [], 'still unchanged at 23:59');
    r = tr.resetText(doneToday, local(2026, 11, 27, 0, 0));
    eq(r.resets.length, 1, 'reset at midnight');
    ok(has(r.text, 'DUE;VALUE=DATE:20261127') && !has(r.text, 'STATUS'), 'due on the 27th, undone');

    // ---- weekly BYDAY=TH: done on Thu Nov 26 -> unchanged for 6 days, reset on the 7th (Thu Dec 3)
    const weekly = cal(todo(['UID:w1', 'SUMMARY:Bins', 'RRULE:FREQ=WEEKLY;BYDAY=TH', 'DUE;VALUE=DATE:20261126', ...done]));
    for (let d = 26; d <= 30; d += 1) eq(tr.resetText(weekly, local(2026, 11, d, 12)).resets, [], `Nov ${d}: unchanged`);
    eq(tr.resetText(weekly, local(2026, 12, 2, 12)).resets, [], 'Dec 2: unchanged (6th day)');
    eq(tr.resetText(weekly, local(2026, 11, 26, 12)).nextAt, local(2026, 12, 3), 'nextAt: next Thursday');
    r = tr.resetText(weekly, local(2026, 12, 3, 8));
    eq(r.resets, [{ uid: 'w1', from: '2026-11-26', to: '2026-12-03' }], 'reset on the 7th day');
    ok(!has(r.text, 'STATUS'), 'unchecked');

    // ---- several missed days -> one reset to the latest rule date <= today
    r = tr.resetText(daily('20261110', done), NOW);
    eq(r.resets, [{ uid: 't1', from: '2026-11-10', to: '2026-11-26' }], 'one reset to today');
    const wk2 = cal(todo(['UID:w2', 'SUMMARY:Gym', 'RRULE:FREQ=WEEKLY;BYDAY=MO,TH', 'DUE;VALUE=DATE:20261102']));
    r = tr.resetText(wk2, NOW); // Mon Nov 2 ... latest MO/TH <= Thu Nov 26 is Nov 26
    eq(r.resets[0].to, '2026-11-26', 'weekly: the latest MO/TH');
    r = tr.resetText(wk2, local(2026, 11, 25, 9)); // Wed: latest is Mon Nov 23
    eq(r.resets[0].to, '2026-11-23', 'weekly: Monday before');
    const every2 = cal(todo(['UID:i2', 'SUMMARY:Fortnightly', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU', 'DUE;VALUE=DATE:20261103']));
    eq(tr.resetText(every2, local(2026, 11, 16, 9)).resets, [], 'INTERVAL=2: nothing a week on');
    eq(tr.resetText(every2, local(2026, 11, 17, 9)).resets[0].to, '2026-11-17', 'INTERVAL=2: two weeks on');
    const monthly = cal(todo(['UID:m1', 'SUMMARY:Rent', 'RRULE:FREQ=MONTHLY;BYMONTHDAY=1', 'DUE;VALUE=DATE:20261001']));
    eq(tr.resetText(monthly, NOW).resets[0].to, '2026-11-01', 'MONTHLY works through the same maths');
    const yearly = cal(todo(['UID:y1', 'SUMMARY:Birthday', 'RRULE:FREQ=YEARLY', 'DUE;VALUE=DATE:20250305']));
    eq(tr.resetText(yearly, NOW).resets[0].to, '2026-03-05', 'YEARLY');
    const counted = cal(todo(['UID:c1', 'SUMMARY:Count', 'RRULE:FREQ=DAILY;COUNT=2', 'DUE;VALUE=DATE:20261120']));
    eq(tr.resetText(counted, NOW).resets[0].to, '2026-11-26', 'COUNT is ignored');

    // ---- a task that was not completed rolls too, and a STATUS other than COMPLETED goes
    r = tr.resetText(daily('20261124', ['STATUS:IN-PROCESS']), NOW);
    eq(r.resets[0].to, '2026-11-26', 'not completed: due moves on');
    ok(!has(r.text, 'STATUS'), 'any STATUS is absent after a reset');
    r = tr.resetText(daily('20261125'), NOW);
    ok(!has(r.text, 'STATUS') && has(r.text, 'DUE;VALUE=DATE:20261126'), 'no STATUS stays absent (not completed)');
    const cancelled = daily('20261120', ['STATUS:CANCELLED']);
    eq(tr.resetText(cancelled, NOW).text, cancelled, 'a cancelled task is left alone');

    // ---- DTSTART moves with DUE, SEQUENCE bumped, a VALARM with an absolute trigger moves too
    const full = cal(todo(['UID:f1', 'SUMMARY:Full', 'DTSTART;VALUE=DATE:20261124', 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261125', 'SEQUENCE:3', 'DTSTAMP:20261124T100000Z', 'LAST-MODIFIED:20261124T100000Z', ...done,
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Reminder', 'TRIGGER;VALUE=DATE-TIME:20261125T130000Z', 'END:VALARM']));
    r = tr.resetText(full, NOW);
    ok(has(r.text, 'DTSTART;VALUE=DATE:20261125'), 'DTSTART +1 day');
    ok(has(r.text, 'DUE;VALUE=DATE:20261126'), 'DUE today');
    ok(has(r.text, 'SEQUENCE:4'), 'SEQUENCE bumped');
    ok(has(r.text, 'TRIGGER;VALUE=DATE-TIME:20261126T130000Z'), 'absolute alarm +1 day');
    ok(has(r.text, 'DESCRIPTION:Reminder') && has(r.text, 'ACTION:DISPLAY'), 'the rest of the alarm kept');
    ok(!has(r.text, 'SEQUENCE:3'), 'one SEQUENCE line');
    eq(r.text.match(/LAST-MODIFIED/g).length, 1, 'one LAST-MODIFIED');
    const relAlarm = cal(todo(['UID:f2', 'SUMMARY:Rel', 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261125', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'END:VALARM']));
    ok(has(tr.resetText(relAlarm, NOW).text, 'TRIGGER:-PT15M'), 'relative trigger untouched');

    // ---- across a DST change (New York falls back Sun Nov 1 2026): same local clock time, other UTC value
    const dst = cal(todo(['UID:d1', 'SUMMARY:DST', 'DTSTART;VALUE=DATE:20261030', 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261030', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER;VALUE=DATE-TIME:20261030T120000Z', 'END:VALARM']));
    r = tr.resetText(dst, local(2026, 11, 4, 9)); // 5 days on
    ok(has(r.text, 'DUE;VALUE=DATE:20261104') && has(r.text, 'DTSTART;VALUE=DATE:20261104'), 'five days');
    ok(has(r.text, 'TRIGGER;VALUE=DATE-TIME:20261104T130000Z'), '08:00 EDT (12:00Z) becomes 08:00 EST (13:00Z)');
    eq(tr._test.shiftLine('TRIGGER;VALUE=DATE-TIME:20261104T130000Z', -5), 'TRIGGER;VALUE=DATE-TIME:20261030T120000Z', 'and back');
    eq(tr._test.shiftLine('DUE:20261028T0930', 1), 'DUE:20261029T0930', 'floating time keeps its clock');

    // ---- no DUE: DTSTART is the anchor and a DUE is written; neither: left alone
    const noDue = cal(todo(['UID:n1', 'SUMMARY:Start only', 'DTSTART;VALUE=DATE:20261124', 'RRULE:FREQ=DAILY', ...done]));
    r = tr.resetText(noDue, NOW);
    eq(r.resets, [{ uid: 'n1', from: null, to: '2026-11-26' }], 'reset from DTSTART');
    ok(has(r.text, 'DUE;VALUE=DATE:20261126') && has(r.text, 'DTSTART;VALUE=DATE:20261126'), 'DUE written, DTSTART moved');
    ok(r.text.indexOf('DUE;') > r.text.indexOf('DTSTART;'), 'DUE written after DTSTART');
    eq(tr.resetText(r.text, NOW).text, r.text, 'idempotent');
    const bare = cal(todo(['UID:n2', 'SUMMARY:No dates', 'RRULE:FREQ=DAILY', ...done]));
    eq(tr.resetText(bare, NOW).text, bare, 'no DUE and no DTSTART: untouched');
    eq(tr.resetText(bare, NOW).nextAt, null, 'no nextAt');

    // ---- UNTIL in the past: no reset; UNTIL ahead: reset
    const until = (u) => cal(todo(['UID:u1', 'SUMMARY:Until', `RRULE:FREQ=DAILY;UNTIL=${u}`, 'DUE;VALUE=DATE:20261120', ...done]));
    eq(tr.resetText(until('20261122'), NOW).text, until('20261122'), 'UNTIL passed: no reset');
    eq(tr.resetText(until('20261122'), NOW).nextAt, null, 'UNTIL passed: no nextAt');
    eq(tr.resetText(until('20261231'), NOW).resets[0].to, '2026-11-26', 'UNTIL ahead: reset');
    eq(tr.resetText(until('20261128'), NOW).resets[0].to, '2026-11-26', 'UNTIL a day or two ahead: reset');

    // ---- a subscription / phone mirror is never written; an agents' file is
    const sub = daily('20261125', done).replace(`X-WR-CALNAME:Mine${NL}`, `X-WR-CALNAME:Mine${NL}X-MELATON-SOURCE:phone:abc${NL}`);
    eq(tr.resetText(sub, NOW).text, sub, 'X-MELATON-SOURCE: untouched');
    eq(tr.resetText(sub, NOW).resets, [], 'no resets in a subscription');
    const owned = daily('20261125', done).replace(`X-WR-CALNAME:Mine${NL}`, `X-WR-CALNAME:Mine${NL}X-MELATON-OWNER:agents${NL}`);
    eq(tr.resetText(owned, NOW).resets.length, 1, 'X-MELATON-OWNER: reset as any other');

    // ---- everything else byte for byte (events, other tasks, header, folding, odd spacing)
    const longSummary = `SUMMARY:${'A long summary that is folded by the writer. '.repeat(4)}end`;
    const foldedByWriter = longSummary.replace(/(.{70})/g, `$1${NL} `); // folded at 70, not 75
    const ev = `BEGIN:VEVENT${NL}UID:e1${NL}DTSTART:20261126T150000Z${NL}RRULE:FREQ=DAILY${NL}${foldedByWriter}${NL}X-CUSTOM;FOO=bar:keep  this${NL}END:VEVENT${NL}`;
    const other = todo(['UID:o1', 'SUMMARY:Plain task', 'DUE;VALUE=DATE:20261101', ...done]); // no RRULE: not a repeating task
    const head = `PRODID:-//Someone//Else//EN${NL}X-CUSTOM-HEADER:yes${NL}`;
    const body = `${ev}${other}${todo(['UID:t1', foldedByWriter, 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261125', ...done, 'X-APPLE-SORT:7'])}${todo(['UID:t2', 'SUMMARY:Stays', 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261126', ...done])}`;
    const text = cal(body, head);
    r = tr.resetText(text, NOW);
    eq(r.resets.map((x) => x.uid), ['t1'], 'only t1 reset');
    const strip = (t) => t.split(NL).filter((l) => !/^(STATUS|PERCENT-COMPLETE|COMPLETED|LAST-MODIFIED|DTSTAMP|DUE)/.test(l)).join(NL);
    // the file minus the changed t1 lines equals the original minus the same lines: nothing else moved
    eq(strip(r.text), strip(text.replace('DUE;VALUE=DATE:20261125', 'DUE;VALUE=DATE:20261126')).replace(/^/, ''), 'every other line byte for byte');
    ok(r.text.startsWith(`BEGIN:VCALENDAR${NL}VERSION:2.0${NL}X-WR-CALNAME:Mine${NL}${head}`), 'header kept');
    ok(r.text.includes(ev), 'the VEVENT, with its own folding, kept');
    ok(r.text.includes(other), 'a non-repeating task kept');
    ok(r.text.includes(foldedByWriter), 'the long folded SUMMARY of the reset task kept as written');
    ok(r.text.includes(todo(['UID:t2', 'SUMMARY:Stays', 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261126', ...done])), 'a task not due kept');
    ok(r.text.endsWith(`END:VCALENDAR${NL}`), 'file ends as it did');
    eq(r.nextAt, local(2026, 11, 27), 'nextAt over all tasks');

    // an unfolded 300-character SUMMARY (a writer that never folded) survives; written lines stay <= 75 octets
    const flat = `SUMMARY:${'x'.repeat(300)}`;
    r = tr.resetText(cal(todo(['UID:l1', flat, 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261125', ...done])), NOW);
    ok(r.text.includes(`${flat}${NL}`), 'an unfolded long SUMMARY survives as it was');
    const folded = tr._test.fold(`DESCRIPTION:${'é'.repeat(100)}`);
    ok(folded.split(NL).every((l) => Buffer.byteLength(l, 'utf8') <= 75), 'fold keeps lines <= 75 octets, never cutting a character');
    eq(folded.replace(/\r\n /g, ''), `DESCRIPTION:${'é'.repeat(100)}`, 'fold loses nothing');
    // LF-only files stay LF
    r = tr.resetText(daily('20261125', done).replace(/\r\n/g, '\n'), NOW);
    ok(r.resets.length === 1 && !r.text.includes('\r'), 'LF file stays LF');

    // ---- garbage in: never throws
    for (const junk of ['', 'hello', 'BEGIN:VCALENDAR\nBEGIN:VTODO\nRRULE:FREQ=DAILY\n', cal(todo(['UID:g', 'RRULE:BOGUS', 'DUE;VALUE=DATE:2026']))]) {
        r = tr.resetText(junk, NOW);
        eq(r.text, junk, 'unreadable: unchanged');
    }

    // ---- the scheduler: fake clock, fake source, one write, the timer armed for the next midnight
    let clock = NOW;
    let store = daily('20261125', done);
    const writes = [];
    const broadcasts = [];
    tr._test.bind({ getWebSocketServer: () => ({ broadcast: (m) => broadcasts.push(m) }) });
    tr._test.setNow(() => clock);
    tr._test.setSource(async () => [{ fileId: 'f1', name: 'Mine.ics', workspace: 'default', folderId: 'c', mime: 'text/calendar', text: store }]);
    tr._test.setWriter(async (file, text) => { writes.push({ file, text }); store = text; });
    tr._test.startNoTimer();
    await tr.tick();
    eq(writes.length, 1, 'one write');
    eq(writes[0].file.fileId, 'f1', 'to that file');
    ok(has(writes[0].text, 'DUE;VALUE=DATE:20261126') && !has(writes[0].text, 'STATUS'), 'reset text written');
    eq(tr._test.timerDelay(), 12 * 3600000, 'one timer, capped at 12 h while midnight is further off (14.5 h)');
    clock = local(2026, 11, 26, 20, 0);
    await tr.tick();
    eq(tr._test.timerDelay(), local(2026, 11, 27) - clock + 1000, 'one timer, armed for the next midnight (+1 s)');
    eq(writes.length, 1, 'a tick with nothing due writes nothing');
    await tr.tick();
    eq(writes.length, 1, 'a second tick (its own write fired the hook) writes nothing');
    eq(tr.status().recent.length, 1, 'status keeps the reset');
    // the next day: the user ticked it done in between, and the timer's tick resets it again
    store = store.replace('DUE;VALUE=DATE:20261126', `DUE;VALUE=DATE:20261126${NL}STATUS:COMPLETED`);
    clock = local(2026, 11, 27, 0, 0, 1);
    await tr.tick();
    eq(writes.length, 2, 'next midnight: written again');
    ok(has(store, 'DUE;VALUE=DATE:20261127') && !has(store, 'STATUS'), 'due the 27th, undone');
    // a file that changed between the pass and the lock is re-read under the lock
    let n = 0;
    tr._test.setSource(async () => {
        n += 1;
        return [{ fileId: 'f1', name: 'Mine.ics', workspace: 'default', text: n === 1 ? daily('20261120', done) : daily('20261127', done) }];
    });
    clock = local(2026, 11, 27, 12);
    const before = writes.length;
    await tr.tick();
    eq(writes.length, before, 'changed under the lock: the fresh text needs nothing, no write');
    // a failing read arms a retry in a minute
    tr._test.setSource(async () => { throw new Error('vfs not up'); });
    await tr.tick();
    eq(tr._test.timerDelay(), 60000, 'failed read: retry in a minute');
    eq(tr.status().lastError, 'vfs not up', 'status shows the error');

    tr._test.reset();

    // ---- the real path: a temp VFS, the Default workspace's Calendars folder, VfsManager's own overwrite
    {
        const fs = require('fs');
        const os = require('os');
        const path = require('path');
        const crypto = require('crypto');
        const vfsDatabase = require('../modules/vfsDatabase');
        const { VfsManager } = require('../modules/vfsManager');
        const bases = require('../modules/calendarBases');
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-rec-'));
        const cache = path.join(dir, '.cache');
        fs.mkdirSync(path.join(cache, 'userFiles'), { recursive: true });
        bases.setDir(path.join(dir, 'bases'));
        try {
            ok(await vfsDatabase.initializeVfsDatabase(dir), 'vfs database up');
            const sent = [];
            const real = {
                getPath: (k) => ({ cache, userFiles: path.join(cache, 'userFiles'), tempDownload: path.join(cache, 'tempDownload'), databases: dir }[k]),
                getWorkspaceManager: () => ({ getWorkspaces: () => ({ default: { name: 'Default' }, other: { name: 'Other' } }) }),
                getVfsPathUuid: () => 'uuid-test',
                getVfsDatabase: () => vfsDatabase,
                getSystemInfoCache: () => null,
                getWebSocketServer: () => ({ broadcast: (m) => sent.push(m) }),
            };
            real.getVfsManager = () => vfs;
            const vfs = new VfsManager(real);
            const folder = await vfsDatabase.createFolder({ scope: 'workspace', workspaceId: 'default', parentId: null, name: 'Calendars' });
            const loc = { scope: 'workspace', workspaceId: 'default', folderId: folder.id };
            const oldText = cal(todo(['UID:r1', 'SUMMARY:Real', 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261125', ...done]));
            const other = cal(todo(['UID:r2', 'SUMMARY:Never', 'RRULE:FREQ=DAILY', 'DUE;VALUE=DATE:20261101']));
            const saved = await vfs.saveUserFileBuffer(Buffer.from(oldText), { originalName: 'Mine.ics', mimeType: 'text/calendar', ...loc });
            await vfs.saveUserFileBuffer(Buffer.from(other), { originalName: 'Other.ics', mimeType: 'text/calendar', scope: 'workspace', workspaceId: 'other', folderId: null });
            const oldHash = saved.content_hash;
            const changes = [];
            const unhook = vfsDatabase.onUserFilesChanged((i) => changes.push(i));
            require('../modules/reminderScheduler')._test.bind(real);
            tr._test.bind(real);
            tr._test.setNow(() => NOW);
            tr._test.startNoTimer();
            await tr.tick();
            const after = await vfsDatabase.getUserFileById(saved.id);
            ok(after.content_hash !== oldHash, 'the content hash changed (same file id)');
            eq(after.id, saved.id, 'same file');
            const written = fs.readFileSync(path.join(cache, 'userFiles', after.content_hash), 'utf8');
            ok(has(written, 'DUE;VALUE=DATE:20261126') && !has(written, 'STATUS'), 'the stored text is reset');
            eq(await bases.read(oldHash, real), oldText, 'the replaced text is kept in calendarBases');
            ok(changes.some((c) => c.name === 'Mine.ics'), 'onUserFilesChanged fired');
            eq(sent.filter((m) => m.type === 'vfs_updated').map((m) => m.data.path), ['/Workspaces/default/Calendars'], 'one vfs_updated for the Default Calendars folder');
            eq((await vfsDatabase.getUserFilesByLocation('workspace', 'default', folder.id)).length, 1, 'no duplicate file');
            await tr.tick();
            eq((await vfsDatabase.getUserFileById(saved.id)).content_hash, after.content_hash, 'second pass: nothing written');
            eq(sent.length, 1, 'second pass: no second push');
            // a stale window's save (base = the old text, the task unchanged there) of another change keeps the reset
            const staleIn = oldText.replace(`END:VCALENDAR${NL}`, `${todo(['UID:r3', 'SUMMARY:Added in a stale window'])}END:VCALENDAR${NL}`);
            const merge = require('../modules/calendarMerge').mergeSave({ baseText: oldText, currentText: written, incomingText: staleIn }, require('../modules/calendarMcp').joinCalendar);
            ok(has(merge.text, 'SUMMARY:Added in a stale window') && has(merge.text, 'DUE;VALUE=DATE:20261126') && !has(merge.text, 'STATUS'), 'a stale save merges three-way and keeps the reset');
            unhook();
        } finally {
            tr._test.reset();
            bases.setDir(null);
            fs.rmSync(dir, { recursive: true, force: true });
        }
    }
    console.log(`task recurrence: all ${passed} checks passed`);
    process.exit(0); // the temp VFS database keeps its handle open
})().catch((e) => {
    console.error(e);
    process.exit(1);
});
