#!/usr/bin/env node
'use strict';

/**
 * apps/calendar/client/calendar.js: a task's RRULE survives parse -> adopt -> toIcs (Yozora #1203), the
 * Recurrence choice reads and sets it, and appointments' RRULEs round-trip as before.
 *
 *   node scripts/test-calendar-task-recurrence.js
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const ctx = { document: {}, console };
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../apps/calendar/client/calendar.js'), 'utf8'), ctx);
const C = ctx.melatonCalendar;

let failed = 0;
let passed = 0;
function test(name, fn) {
    try { fn(); passed += 1; console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 3).join('\n     ')}`); }
}

const vtodo = (uid, extra) => ['BEGIN:VTODO', `UID:${uid}`, `SUMMARY:${uid}`, 'DUE;VALUE=DATE:20261126', ...extra, 'END:VTODO'];
const SRC = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'X-WR-CALNAME:T',
    ...vtodo('daily', ['RRULE:FREQ=DAILY']),
    ...vtodo('weekly', ['RRULE:FREQ=WEEKLY;BYDAY=TH']),
    ...vtodo('monthly', ['RRULE:FREQ=MONTHLY;BYMONTHDAY=3;INTERVAL=2']),
    ...vtodo('odd', ['RRULE:FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=1,15;UNTIL=20300101;WKST=SU', 'STATUS:COMPLETED']),
    ...vtodo('plain', []),
    'BEGIN:VEVENT', 'UID:ev', 'DTSTART:20261126T100000Z', 'DTEND:20261126T110000Z', 'SUMMARY:ev', 'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=5', 'END:VEVENT',
    'END:VCALENDAR'].join('\r\n');

// what Calendar.adopt does with a parsed file's tasks
function load(text) {
    const p = C.parseIcs(text);
    return { tasks: p.tasks.map((t) => C.adoptTask(t)), events: p.events, name: 'T', color: '#ccffcc' };
}
const rules = (text) => Object.fromEntries(C.parseIcs(text).tasks.map((t) => [t.uid, t.rruleRaw || null]));
const unfold = (s) => s.replace(/\r\n /g, '');

test('every task rule is written back as read', () => {
    const out = unfold(C.toIcs(load(SRC)));
    const r = rules(out);
    assert.strictEqual(r.daily, 'FREQ=DAILY');
    assert.strictEqual(r.weekly, 'FREQ=WEEKLY;BYDAY=TH');
    assert.strictEqual(r.monthly, 'FREQ=MONTHLY;BYMONTHDAY=3;INTERVAL=2');
    assert.strictEqual(r.odd, 'FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=1,15;UNTIL=20300101;WKST=SU');
});
test('a task without a rule gets none', () => {
    const out = unfold(C.toIcs(load(SRC)));
    const plain = out.split('BEGIN:VTODO').find((x) => x.includes('UID:plain')).split('END:VTODO')[0];
    assert.ok(!plain.includes('RRULE'));
});
test('the due date stays a date beside the rule, and done keeps the rule', () => {
    const out = unfold(C.toIcs(load(SRC)));
    const odd = out.split('BEGIN:VTODO').find((x) => x.includes('UID:odd')).split('END:VTODO')[0];
    assert.ok(odd.includes('DUE;VALUE=DATE:20261126') && odd.includes('STATUS:COMPLETED') && odd.includes('RRULE:'));
});
test('a second save is stable', () => {
    const a = C.toIcs(load(SRC));
    const b = C.toIcs(load(a));
    assert.deepStrictEqual(rules(b), rules(a));
});
test('the appointment RRULE round-trips as before', () => {
    const out = unfold(C.toIcs(load(SRC)));
    assert.ok(out.includes('RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5;BYDAY=MO,WE'));
});
test('Recurrence choice: none, daily, weekly on the due weekday, custom', () => {
    const t = load(SRC).tasks;
    const by = (u) => t.find((x) => x.uid === u);
    assert.strictEqual(C.taskRecurPreset(by('plain')), '');
    assert.strictEqual(C.taskRecurPreset(by('daily')), 'DAILY');
    assert.strictEqual(C.taskRecurPreset(by('weekly')), 'WEEKLY'); // 26 Nov 2026 is a Thursday
    assert.strictEqual(C.taskRecurPreset(by('monthly')), 'CUSTOM');
    assert.strictEqual(C.taskRecurPreset(by('odd')), 'CUSTOM');
});
test('choosing a recurrence writes the new rule and drops the raw text', () => {
    const t = load(SRC).tasks.find((x) => x.uid === 'monthly');
    C.setTaskRecur(t, 'WEEKLY', new Date(2026, 10, 27)); // a Friday
    const out = unfold(C.toIcs({ name: 'T', color: '#ccffcc', events: [], tasks: [t] }));
    assert.ok(out.includes('RRULE:FREQ=WEEKLY;BYDAY=FR'));
    C.setTaskRecur(t, 'DAILY', new Date(2026, 10, 27));
    assert.ok(unfold(C.toIcs({ name: 'T', color: '#ccffcc', events: [], tasks: [t] })).includes('RRULE:FREQ=DAILY'));
    C.setTaskRecur(t, '', null);
    assert.ok(!C.toIcs({ name: 'T', color: '#ccffcc', events: [], tasks: [t] }).includes('RRULE'));
});

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
