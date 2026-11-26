#!/usr/bin/env node
// Phone Tasks (public/scripts/comp/wmTasks.js): the Occurs rule (RRULE) survives parse and write.
// Run: node scripts/test-tasks-occurs.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const classList = { contains: () => true };
const win = { uiShell: 'mobile', addEventListener() {}, melatonSegments: null };
const ctx = { window: win, document: { documentElement: { classList }, addEventListener() {} }, localStorage: {}, console };
win.window = win;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/scripts/comp/wmTasks.js'), 'utf8'), ctx);
const T = win.wmTasks._test;

let pass = 0;
const test = (name, fn) => { try { fn(); pass++; console.log(`ok   ${name}`); } catch (e) { console.error(`FAIL ${name}: ${e.message}`); process.exitCode = 1; } };
const vtodo = (rule, extra = '') => `BEGIN:VTODO\r\nUID:u1\r\nSUMMARY:Water plants\r\nDUE;VALUE=DATE:20261126\r\n${rule ? `RRULE:${rule}\r\n` : ''}${extra}END:VTODO\r\n`;
const ruleLines = (text) => text.replace(/\r\n[ \t]/g, '').split(/\r?\n/).filter((l) => /^RRULE/i.test(l));
const roundTrip = (rule) => { const t = T.parseTodo(vtodo(rule)); const out = T.todoBlock(t); return { t, out, back: T.parseTodo(out) }; };

test('daily rule round-trips', () => {
    const r = roundTrip('FREQ=DAILY');
    assert.strictEqual(r.t.rrule, 'FREQ=DAILY');
    assert.deepStrictEqual(ruleLines(r.out), ['RRULE:FREQ=DAILY']);
    assert.strictEqual(r.back.rrule, 'FREQ=DAILY');
    assert.strictEqual(T.ruleKind(r.t.rrule).kind, 'daily');
    assert.strictEqual(T.ruleText(r.t.rrule), 'Every day');
});
test('weekly BYDAY rule round-trips', () => {
    const r = roundTrip('FREQ=WEEKLY;BYDAY=TH');
    assert.deepStrictEqual(ruleLines(r.out), ['RRULE:FREQ=WEEKLY;BYDAY=TH']);
    assert.strictEqual(r.back.rrule, 'FREQ=WEEKLY;BYDAY=TH');
    assert.strictEqual(T.ruleText(r.t.rrule), 'Every Thursday');
});
test('unknown rule is kept byte-equal', () => {
    const v = 'FREQ=MONTHLY;BYMONTHDAY=3;INTERVAL=2';
    const r = roundTrip(v);
    assert.deepStrictEqual(ruleLines(r.out), [`RRULE:${v}`]);
    assert.strictEqual(r.back.rrule, v);
    assert.strictEqual(T.ruleKind(v).kind, 'other');
    assert.strictEqual(T.ruleText(v), 'Every 2 months');
    assert.ok(!r.t.extra.some((l) => /RRULE/i.test(l)));
});
test('other rules get short labels', () => {
    assert.strictEqual(T.ruleText('FREQ=MONTHLY'), 'Monthly');
    assert.strictEqual(T.ruleText('FREQ=YEARLY'), 'Yearly');
    assert.strictEqual(T.ruleText('FREQ=WEEKLY;INTERVAL=2;BYDAY=TH'), 'Every 2 weeks');
    assert.strictEqual(T.ruleKind('FREQ=WEEKLY;BYDAY=MO,TH').kind, 'other');
    assert.strictEqual(T.ruleKind('FREQ=DAILY;INTERVAL=2').kind, 'other');
});
test('a task without a rule writes no RRULE line', () => {
    const r = roundTrip('');
    assert.strictEqual(r.t.rrule, '');
    assert.deepStrictEqual(ruleLines(r.out), []);
});
test('Every <Weekday> for a Thursday due date writes FREQ=WEEKLY;BYDAY=TH', () => {
    const due = new Date(2026, 10, 26); // Thursday
    assert.strictEqual(due.getDay(), 4);
    const t = T.parseTodo(vtodo(''));
    t.due = due;
    t.rrule = T.ruleWeekly(due.getDay());
    assert.deepStrictEqual(ruleLines(T.todoBlock(t)), ['RRULE:FREQ=WEEKLY;BYDAY=TH']);
});
test('editText replaces the VTODO and keeps its rule; completing keeps it', () => {
    const t = T.parseTodo(vtodo('FREQ=DAILY'));
    t.completed = true;
    const out = T.editText(`BEGIN:VCALENDAR\r\n${vtodo('FREQ=DAILY')}END:VCALENDAR\r\n`, 'u1', t);
    assert.deepStrictEqual(ruleLines(out), ['RRULE:FREQ=DAILY']);
    assert.ok(/STATUS:COMPLETED/.test(out));
});

console.log(`${pass} passed`);
