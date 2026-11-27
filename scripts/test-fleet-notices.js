#!/usr/bin/env node
'use strict';

/**
 * Fleet notices (Yozora #1196, #1291): modules/fleetNotices.js and its hooks in agentSupervisor.setWork.
 * Exactly two work notices reach the phone (done, needs her); routine alerts tell the Supervisor first and reach the
 * phone only on their Fleet Manager switch. Every notice is cls 'fleet'; the work notices STACK (stack:fleetdone and
 * stack:fleetattn, one sound per stack, each item keeping its own id and workId) and have lives: done 4 h, needs you 12 h,
 * account login 24 h, routine 4 h, each stack item its own.
 *
 *   NOTIFICATION_INBOX_DB=:memory: NOTIFICATION_INBOX_NO_TIMER=1 node scripts/test-fleet-notices.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

process.env.NOTIFICATION_INBOX_DB = ':memory:';
process.env.NOTIFICATION_INBOX_NO_TIMER = '1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fleet-notices-'));
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_COORD_DB = path.join(tmp, 'state', 'coord.db');
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'state', 'supervisor.sock');
process.env.AGENT_SUPERVISOR_NO_REVIVE = '1';

const activeSync = require('../modules/activeSync');
const phoneStatus = require('../modules/phoneStatus');
const inbox = require('../modules/notificationInbox');
const sup = require('../modules/agentSupervisor');
const fn = require('../modules/fleetNotices');
const store = require('../modules/agentCoord/store');
// no Yozora: every call answers empty
require('../modules/fleetYozora')._setFetch(async () => ({ ok: true, status: 200, text: async () => '{}' }));

const sent = [];
// what the phones' background links get and what the phone status is told (nothing real is touched)
const toPhones = [];
const clearedOnPhones = [];
const touches = [];
activeSync.sendInboxNotice = (g, ws, notice) => { toPhones.push(notice); return 1; };
activeSync.sendInboxCleared = (g, ws, n) => { clearedOnPhones.push(n.id); return 1; };
phoneStatus.touch = (reason) => { touches.push(reason); };
const cfg = { agentSupervisor: { enabled: true, engine: 'tokenrouter' } };
const gr = {
    getConfig: () => cfg,
    modifyConfig: () => ({ assign: async (p, v) => { cfg[p[0]] = v; } }),
    getWebSocketServer: () => ({ broadcast: (m) => sent.push(m) }),
    getApiKeyManager: () => ({ getActiveApiKey: () => '' })
};
inbox.bind(gr);
sup.bind(gr);

const loud = () => sent.filter((m) => m && m.type === 'inbox_updated' && m.data.reason === 'new' && m.data.notice.alert).length;
const mark = () => { sent.length = 0; toPhones.length = 0; clearedOnPhones.length = 0; touches.length = 0; };
// the notices held, a stack row as its items (each with its row's app / cls / state): what one tap can open
const flat = () => inbox.list('admin').flatMap((n) => (n.data && Array.isArray(n.data.items) && n.id.startsWith('stack:')
    ? n.data.items.map((it) => Object.assign({}, it, { app: n.app, cls: n.cls, state: n.state, stack: n.id }))
    : [n]));
const live = (idPart) => flat().filter((n) => !idPart || n.id.includes(idPart));
const stackRow = (key) => inbox.list('admin').find((n) => n.id === `stack:${key}`);

let failed = 0;
async function test(name, f) {
    try { inbox._test.reset(); mark(); await f(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 6).join('\n     ')}`); }
}

sup.getWork(0); // creates the tables in the temp coord DB
const d = () => store.open();
let seq = 0;
function item(over = {}) {
    const o = Object.assign({ title: `Item ${(seq += 1)}`, prompt: 'p', source: 'fleet', state: 'running', message: '', parent_id: null, joined_into: null, input_questions: null }, over);
    const r = d().prepare('INSERT INTO supervisor_work (title, prompt, source, state, message, parent_id, joined_into, input_questions, created_at) VALUES (@title, @prompt, @source, @state, @message, @parent_id, @joined_into, @input_questions, @now)').run(Object.assign({}, o, { now: Date.now() }));
    return Number(r.lastInsertRowid);
}
const row = (id) => d().prepare('SELECT * FROM supervisor_work WHERE id = ?').get(id);
const qs = (list) => JSON.stringify(list);

(async () => {
    await test('defaults: work on, routine off, unknown kinds never', () => {
        assert.strictEqual(sup.notifyOn('workDone'), true);
        assert.strictEqual(sup.notifyOn('workAttention'), true);
        assert.strictEqual(sup.notifyOn('maintenance'), false);
        assert.strictEqual(sup.notifyOn('usage'), false);
        assert.strictEqual(sup.notifyOn('cleanup'), false);
        assert.strictEqual(sup.notifyOn('__proto__'), false);
    });

    await test('a started item done: one notice, loud', () => {
        mark();
        const id = item();
        sup.setWork(id, { state: 'done', ended_at: Date.now(), message: 'All built and tested' });
        const n = live(`fleet-work:${id}:done`);
        assert.strictEqual(n.length, 1);
        assert.match(n[0].title, /is done$/);
        assert.strictEqual(n[0].text, '', 'a done notice says what is done and nothing else (Yukimi, Nov 26 2026: too wordy)');
        assert.strictEqual(n[0].data.app, 'claudedesk');
        assert.strictEqual(n[0].data.workId, id);
        assert.strictEqual(n[0].cls, 'fleet', 'its own class, not "Other notifications"');
        assert.strictEqual(n[0].stack, 'stack:fleetdone');
        assert.strictEqual(loud(), 1);
    });

    await test('the same done event again does not sound', () => {
        const id = item();
        const at = 1000;
        mark();
        sup.setWork(id, { state: 'done', ended_at: at, message: 'ok' });
        assert.strictEqual(loud(), 1);
        mark();
        fn.workChanged(row(id), 'running', 5); // a repeat of the same transition
        fn.workChanged(row(id), 'running', 6);
        assert.strictEqual(loud(), 0, 'a repeat publish of the same event is quiet');
        inbox.clear('admin', `fleet-work:${id}:done`, 'x'); // she dismissed it
        mark();
        fn.workChanged(row(id), 'running', 7);
        assert.strictEqual(loud(), 0, 'a dismissed one stays dismissed');
        assert.strictEqual(live(`fleet-work:${id}:done`).length, 0);
    });

    await test('a new done event of the same item sounds again (sent back to work, done again)', () => {
        const id = item();
        sup.setWork(id, { state: 'done', ended_at: 1000, message: 'first' });
        assert.strictEqual(live(`fleet-work:${id}:done`).length, 1);
        sup.setWork(id, { state: 'running', message: 'Gaps sent back' });
        assert.strictEqual(live(`fleet-work:${id}:done`).length, 0, 'leaving done clears the notice');
        mark();
        sup.setWork(id, { state: 'done', ended_at: 2000, message: 'first' });
        assert.strictEqual(loud(), 1, 'the new event sounds although the words are the same');
        assert.strictEqual(live(`fleet-work:${id}:done`).length, 1);
    });

    await test('a kid of a planner or group: nothing; its parent settling is the one notice', () => {
        mark();
        const par = item({ state: 'running' });
        const kid = item({ parent_id: par });
        sup.setWork(kid, { state: 'done', ended_at: Date.now(), message: 'part done' });
        assert.strictEqual(live(`fleet-work:${kid}`).length, 0);
        sup.setWork(par, { state: 'done', ended_at: Date.now(), message: 'All 1 parts done' });
        assert.strictEqual(live(`fleet-work:${par}:done`).length, 1);
        assert.strictEqual(loud(), 1);
    });

    await test('source agent (Supervisor / agent follow-up): nothing', () => {
        mark();
        const id = item({ source: 'agent' });
        sup.setWork(id, { state: 'done', ended_at: Date.now(), message: 'follow-up done' });
        sup.setWork(id, { state: 'failed', message: 'x' });
        assert.strictEqual(live(`fleet-work:${id}`).length, 0);
        assert.strictEqual(loud(), 0);
    });

    await test('input with AskUserQuestion asks: nothing (the request form notifies)', () => {
        mark();
        const id = item();
        sup.setWork(id, { state: 'input', message: 'Input Required: which?', input_questions: qs([{ question: 'which?', answer: '', ask: true }]) });
        assert.strictEqual(live(`fleet-work:${id}`).length, 0);
        assert.strictEqual(loud(), 0);
    });

    await test('input with plain questions: one attention notice naming the open questions', () => {
        mark();
        const id = item();
        sup.setWork(id, { state: 'input', message: 'Input Required: x', input_questions: qs([{ question: 'Pay for the plan?', answer: '' }, { question: 'Already settled', answer: 'yes' }]) });
        const n = live(`fleet-work:${id}:attention`);
        assert.strictEqual(n.length, 1);
        assert.match(n[0].title, /needs you$/);
        assert.strictEqual(n[0].text, 'Pay for the plan?');
        assert.strictEqual(n[0].data.kind, 'work-attention');
        assert.strictEqual(loud(), 1);
    });

    await test('input -> running clears the notice; a later input sounds again', () => {
        const id = item();
        const q = qs([{ question: 'Same question?', answer: '' }]);
        sup.setWork(id, { state: 'input', message: 'm', input_questions: q });
        assert.strictEqual(live(`fleet-work:${id}:attention`).length, 1);
        sup.setWork(id, { state: 'running', message: 'answered', input_questions: null });
        assert.strictEqual(live(`fleet-work:${id}:attention`).length, 0);
        mark();
        sup.setWork(id, { state: 'input', message: 'm', input_questions: q });
        assert.strictEqual(live(`fleet-work:${id}:attention`).length, 1);
        assert.strictEqual(loud(), 1, 'the second Input Required is a new event');
    });

    await test('failed: attention notice; failed -> queued (started again) clears it', () => {
        mark();
        const id = item();
        sup.setWork(id, { state: 'failed', ended_at: Date.now(), message: 'No account with a working login' });
        const n = live(`fleet-work:${id}:attention`);
        assert.strictEqual(n.length, 1);
        assert.match(n[0].title, /stopped$/);
        assert.strictEqual(n[0].text, '', 'stopped: the title says it, no reason text');
        assert.strictEqual(loud(), 1);
        sup.setWork(id, { state: 'queued', ended_at: null });
        assert.strictEqual(live(`fleet-work:${id}:attention`).length, 0);
    });

    await test('input -> failed keeps one attention notice (new event, sounds)', () => {
        const id = item();
        sup.setWork(id, { state: 'input', message: 'm', input_questions: qs([{ question: 'Q?', answer: '' }]) });
        mark();
        sup.setWork(id, { state: 'failed', ended_at: Date.now(), message: 'gave up' });
        const n = live(`fleet-work:${id}:attention`);
        assert.strictEqual(n.length, 1);
        assert.match(n[0].title, /stopped$/);
        assert.strictEqual(loud(), 1);
    });

    await test('workDone switched off: no done notice; leaving done still clears', async () => {
        const id = item();
        sup.setWork(id, { state: 'done', ended_at: 1, message: 'ok' });
        assert.strictEqual(live(`fleet-work:${id}:done`).length, 1);
        await sup.saveSettings(gr, { notify: { workDone: false } });
        assert.strictEqual(live(`fleet-work:${id}:done`).length, 0, 'switching off takes the live notice down');
        mark();
        const id2 = item();
        sup.setWork(id2, { state: 'done', ended_at: 2, message: 'ok' });
        assert.strictEqual(live(`fleet-work:${id2}`).length, 0);
        assert.strictEqual(loud(), 0);
        assert.strictEqual(sup.notifyOn('workAttention'), true, 'a partial save keeps the other switches');
        await sup.saveSettings(gr, { notify: { workDone: true } });
    });

    await test('workAttention switched off: no attention notice', async () => {
        await sup.saveSettings(gr, { notify: { workAttention: false } });
        mark();
        const id = item();
        sup.setWork(id, { state: 'failed', ended_at: 1, message: 'x' });
        assert.strictEqual(live(`fleet-work:${id}`).length, 0);
        assert.strictEqual(loud(), 0);
        await sup.saveSettings(gr, { notify: { workAttention: true } });
    });

    // ---- routine ----
    const mgrSid = 'bbbbbbbb-1111-2222-3333-444444444444';
    const maint = (id) => ({ id, title: 'Fleet maintenance: needs a look', text: 'Disk usage: 91% full', data: { app: 'claudedesk', kind: 'maintenance', runId: 1 }, ttlMs: 86400000 });
    const flag = (id) => ({ id, title: 'Heavy usage: a session', text: '3M tokens in an hour', data: { app: 'claudedesk', kind: 'usage-flag', sessionId: 's', reason: 'tokens_hour' }, ttlMs: 86400000 });
    const managerNotes = () => d().prepare("SELECT body FROM messages WHERE to_agent = ? AND kind = 'note'").all(`claude-${mgrSid.slice(0, 8)}`).map((r) => r.body);

    await test('routine with no Manager Session: no phone notice, one log line, no note', () => {
        mark();
        const r = fn.routine('maintenance', maint('fleet-maintenance:2026-11-25'));
        assert.deepStrictEqual(r, { told: false, published: false });
        assert.strictEqual(live('fleet-maintenance').length, 0);
    });

    await test('routine with the switch off: Supervisor note posted, nothing on the phone', async () => {
        await sup.saveSettings(gr, { managerSessionId: mgrSid });
        mark();
        const r = fn.routine('maintenance', maint('fleet-maintenance:2026-11-25'));
        const u = fn.routine('usage', flag('usage-flag:k1'));
        assert.deepStrictEqual(r, { told: true, published: false });
        assert.deepStrictEqual(u, { told: true, published: false });
        assert.strictEqual(live('fleet-maintenance').length + live('usage-flag').length, 0);
        assert.strictEqual(loud(), 0);
        const notes = managerNotes();
        assert.strictEqual(notes.length, 2);
        assert.match(notes[0], /Fleet maintenance: needs a look\nDisk usage: 91% full/);
    });

    await test('the real maintenance producer goes through routine (fleetMaintenance.notify)', () => {
        mark();
        const before = managerNotes().length;
        require('../modules/fleetMaintenance')._test.notify({ state: 'warn', startedAt: Date.now(), id: 3, checks: [{ state: 'warn', title: 'Thermals', summary: 'hot' }] });
        assert.strictEqual(managerNotes().length, before + 1);
        assert.strictEqual(live('fleet-maintenance').length, 0);
    });

    await test('routine with the switch on: the notice reaches the phone, the Supervisor still hears first', async () => {
        await sup.saveSettings(gr, { notify: { maintenance: true } });
        mark();
        const before = managerNotes().length;
        const r = fn.routine('maintenance', maint('fleet-maintenance:2026-11-26'));
        assert.deepStrictEqual(r, { told: true, published: true });
        assert.strictEqual(managerNotes().length, before + 1);
        const n = live('fleet-maintenance:2026-11-26');
        assert.strictEqual(n.length, 1);
        assert.strictEqual(n[0].cls, 'fleet');
        assert.strictEqual(n[0].app, 'claudedesk');
        assert.strictEqual(loud(), 1);
        assert.strictEqual(fn.routine('usage', flag('usage-flag:k2')).published, false, 'usage is still off');
    });

    await test('an unknown kind never publishes', () => {
        mark();
        const r = fn.routine('cleanup', { id: 'x:1', title: 'Cleanup done', text: 't', data: {} });
        assert.strictEqual(r.published, false);
        assert.strictEqual(live('x:1').length, 0);
        assert.strictEqual(fn.routine('__proto__', { id: 'x:2', title: 't' }).published, false);
        assert.strictEqual(fn.routine('workDone', { id: 'x:3', title: 't' }).published, true, 'only a listed kind that is on');
        inbox.clear('admin', 'x:3', 'x');
    });

    await test('sweepRoutine clears old maintenance / usage-flag notices whose switch is off; turning one off later does the same', async () => {
        // from before the switches: published straight to the inbox
        inbox.publish({ user: 'admin', app: 'claudedesk', id: 'usage-flag:old', cls: 'maintenance', title: 'Heavy usage: x', text: 't', data: { app: 'claudedesk', kind: 'usage-flag' }, ttlMs: 86400000 });
        inbox.publish({ user: 'admin', app: 'claudedesk', id: 'fleet-maintenance:old', cls: 'maintenance', title: 'Fleet maintenance', text: 't', data: { app: 'claudedesk', kind: 'maintenance' }, ttlMs: 86400000 });
        inbox.publish({ user: 'admin', app: 'weather', id: 'wx:keep', cls: 'weather-alert', title: 'Not Fleet', text: 't', data: { app: 'weather', kind: 'maintenance' }, ttlMs: 86400000 });
        assert.strictEqual(fn.sweepRoutine(gr), 1, 'usage is off: its old flag goes; maintenance is on: its notices stay');
        assert.strictEqual(live('usage-flag:old').length, 0);
        assert.strictEqual(live('fleet-maintenance:old').length, 1);
        await sup.saveSettings(gr, { notify: { maintenance: false } });
        assert.strictEqual(live('fleet-maintenance').length, 0, 'switching maintenance off takes its live notices down');
        assert.strictEqual(live('wx:keep').length, 1, 'a notice of another app is never touched');
        // start() sweeps too (before the watcher): the same rule at boot
        inbox.publish({ user: 'admin', app: 'claudedesk', id: 'usage-flag:boot', cls: 'maintenance', title: 'Heavy usage', text: 't', data: { app: 'claudedesk', kind: 'usage-flag' }, ttlMs: 86400000 });
        process.env.AGENT_SUPERVISOR_DISABLED = '1';
        sup.start(gr);
        assert.strictEqual(live('usage-flag:boot').length, 0);
    });

    await test('a Claude account entering the login state: one notice, once per change; leaving it takes the notice down; the switch turns it off', () => {
        const fs8 = require('../modules/claudeFleetSettings');
        const u = { index: 61, id: 'dddddddddddddddd', name: 'Douglas', needsLogin: true, limits: [] };
        mark();
        fs8.availability(u, fs8.DEFAULTS);
        fs8.availability(u, fs8.DEFAULTS);
        fs8.availability(u, fs8.DEFAULTS);
        const n = live('fleet-account:dddddddddddddddd:login');
        assert.strictEqual(n.length, 1, 'three reads, one notice');
        assert.strictEqual(loud(), 1);
        assert.strictEqual(n[0].title, 'Claude account Douglas needs signing in');
        assert.strictEqual(n[0].text, 'Sign in again: Fleet > Accounts.');
        assert.strictEqual(n[0].data.kind, 'account-login');
        // it works again
        fs8.availability({ index: 61, id: 'dddddddddddddddd', name: 'Douglas', limits: [{ kind: 'session', label: 's', percent: 3, resetsAt: 1 }] }, fs8.DEFAULTS);
        assert.strictEqual(live('fleet-account:dddddddddddddddd:login').length, 0, 'the notice came down');
        // entering again sounds again (a new event)
        mark();
        fn.accountLogin({ index: 61, id: 'dddddddddddddddd', name: 'Douglas', since: 99 });
        assert.strictEqual(loud(), 1);
        // the switch: only an explicit false turns it off; sweepRoutine takes a live one down
        cfg.agentSupervisor.notify = { accountLogin: false };
        assert.strictEqual(fn.accountLoginOn(gr), false);
        assert.strictEqual(fn.sweepRoutine(gr) >= 1, true);
        assert.strictEqual(live('fleet-account:dddddddddddddddd:login').length, 0);
        mark();
        assert.strictEqual(fn.accountLogin({ index: 62, id: 'eeeeeeeeeeeeeeee', name: 'Other', since: 1 }, gr), false);
        assert.strictEqual(live('fleet-account:eeeeeeeeeeeeeeee').length, 0);
        delete cfg.agentSupervisor.notify;
        assert.strictEqual(fn.accountLoginOn(gr), true, 'a missing key means on');
    });

    // ---- stacking (#1291): the work notices of a kind are one row with a count, one sound ----
    const H = 60 * 60 * 1000;
    const finish = (n, at0 = 1000) => Array.from({ length: n }, (_x, i) => { const id = item(); sup.setWork(id, { state: 'done', ended_at: at0 + i, message: `built ${i}` }); return id; });
    const workIds = (key) => stackRow(key).data.items.map((x) => x.data.workId);

    await test('twenty items finishing in a row: ONE row with a count of 20, one loud publish, every item keeps its own id and workId', () => {
        const ids = finish(20);
        assert.deepStrictEqual(inbox.list('admin').map((n) => n.id), ['stack:fleetdone'], 'one row, not twenty');
        const st = stackRow('fleetdone');
        assert.strictEqual(st.cls, 'fleet');
        assert.strictEqual(st.app, 'claudedesk');
        assert.strictEqual(st.data.count, 20);
        assert.strictEqual(st.title, '20 Fleet items are done');
        const lines = st.text.split('\n');
        assert.strictEqual(lines.length, 7);
        assert.strictEqual(lines[0], `${row(ids[19]).title} is done`, 'a line is the item title without the Fleet: prefix, the newest first');
        assert.strictEqual(lines[6], '+ 14 more');
        assert.deepStrictEqual(workIds('fleetdone'), ids.slice().reverse(), 'newest first, each its own workId');
        st.data.items.forEach((it) => {
            assert.strictEqual(it.id, `fleet-work:${it.data.workId}:done`, 'the item keeps its own id');
            assert.strictEqual(it.data.app, 'claudedesk');
            assert.strictEqual(it.data.kind, 'work-done');
            assert.match(it.title, /^Item \d+ is done$/, 'and its own title');
            assert.ok(it.expiresAt - it.at === 4 * H, 'and its own life: four hours');
        });
        // ONE sound: the row new was loud, the 19 joining items silent; one notification id on the phones
        assert.strictEqual(loud(), 1, 'one loud publish');
        assert.deepStrictEqual(toPhones.map((n) => n.alert), [true].concat(Array(19).fill(false)));
        assert.deepStrictEqual([...new Set(toPhones.map((n) => n.id))], ['stack:fleetdone'], 'one Android notification, re-posted in place');
        assert.strictEqual(sent.filter((m) => m.type === 'inbox_updated' && m.data.reason === 'new' && !m.data.notice.alert).length, 19);
        assert.strictEqual(inbox.count('admin'), 1, 'the title bar counts one notice');
    });

    await test('an item whose notice comes down leaves the count: a state change, an item ended quietly; the last one clears the row', () => {
        const [a, b, c, e] = finish(4);
        assert.strictEqual(stackRow('fleetdone').data.count, 4);
        mark();
        sup.setWork(b, { state: 'running', message: 'sent back' });
        assert.strictEqual(stackRow('fleetdone').data.count, 3, 'leaving done takes its entry out');
        assert.ok(!workIds('fleetdone').includes(b));
        assert.strictEqual(loud(), 0, 'silent');
        assert.deepStrictEqual(toPhones.map((n) => [n.id, n.alert]), [['stack:fleetdone', false]], 'the phones re-post the stack in place');
        assert.ok(touches.includes('inbox'), 'the phone status is told');
        fn.workEndedQuietly(c);
        assert.strictEqual(stackRow('fleetdone').data.count, 2, 'an item ended quietly leaves its done stack too');
        assert.strictEqual(stackRow('fleetdone').title, '2 Fleet items are done');
        // a "needs you" item ended quietly leaves the attention stack; its last one clears that row
        const q = item();
        sup.setWork(q, { state: 'input', message: 'm', input_questions: qs([{ question: 'Q?', answer: '' }]) });
        assert.strictEqual(stackRow('fleetattn').data.count, 1);
        mark();
        fn.workEndedQuietly(q);
        assert.strictEqual(stackRow('fleetattn'), undefined, 'the last item clears the row');
        assert.ok(clearedOnPhones.includes('stack:fleetattn'), 'and the phones take their notification down');
        sup.setWork(a, { state: 'running', message: 'again' });
        assert.strictEqual(stackRow('fleetdone').data.count, 1);
        assert.strictEqual(stackRow('fleetdone').title, `${row(e).title} is done`, 'one item left reads as itself again');
        sup.setWork(e, { state: 'running', message: 'again' });
        assert.strictEqual(stackRow('fleetdone'), undefined);
        assert.ok(clearedOnPhones.includes('stack:fleetdone'));
        assert.strictEqual(inbox.count('admin'), 0);
    });

    await test('"needs you" / "stopped" are their own stack: one sound each, the done stack is untouched', () => {
        const d1 = item();
        sup.setWork(d1, { state: 'done', ended_at: 1, message: 'ok' });
        assert.strictEqual(loud(), 1);
        const i1 = item();
        const i2 = item();
        sup.setWork(i1, { state: 'input', message: 'm', input_questions: qs([{ question: 'Which?', answer: '' }]) });
        assert.strictEqual(loud(), 2, 'the attention stack is a new row: it sounds');
        sup.setWork(i2, { state: 'failed', ended_at: 2, message: 'gave up' });
        assert.strictEqual(loud(), 2, 'a second one joins silently');
        const at = stackRow('fleetattn');
        assert.strictEqual(at.data.count, 2);
        assert.strictEqual(at.title, '2 Fleet items need you');
        assert.deepStrictEqual(at.text.split('\n'), [`${row(i2).title} stopped`, `${row(i1).title} needs you`]);
        assert.deepStrictEqual(at.data.items.map((x) => [x.data.workId, x.data.state, x.data.kind, x.id]),
            [[i2, 'failed', 'work-attention', `fleet-work:${i2}:attention`], [i1, 'input', 'work-attention', `fleet-work:${i1}:attention`]]);
        assert.ok(at.data.items.every((x) => x.expiresAt - x.at === 12 * H), 'twelve hours');
        assert.strictEqual(stackRow('fleetdone').data.count, 1);
        assert.strictEqual(stackRow('fleetdone').title, `${row(d1).title} is done`);
        sup.setWork(item(), { state: 'done', ended_at: 3, message: 'ok' });
        assert.strictEqual(loud(), 2, 'another done joins its stack silently');
        assert.strictEqual(stackRow('fleetattn').data.count, 2);
        assert.deepStrictEqual(inbox.list('admin').map((n) => n.id).sort(), ['stack:fleetattn', 'stack:fleetdone']);
    });

    await test('sweepRoutine reaches the items inside a stack row: a kind switched off leaves its stack, the other stack stays', () => {
        finish(3);
        const i1 = item();
        sup.setWork(i1, { state: 'input', message: 'm', input_questions: qs([{ question: 'Q?', answer: '' }]) });
        assert.strictEqual(stackRow('fleetdone').data.count, 3);
        const keep = cfg.agentSupervisor;
        cfg.agentSupervisor = Object.assign({}, keep, { notify: { workDone: false } });
        try {
            mark();
            assert.strictEqual(fn.sweepRoutine(gr), 3, 'three items cleared (not the row)');
            assert.strictEqual(stackRow('fleetdone'), undefined, 'the last item cleared the row');
            assert.ok(clearedOnPhones.includes('stack:fleetdone'));
            assert.strictEqual(stackRow('fleetattn').data.count, 1, 'workAttention is on: its stack stays');
            cfg.agentSupervisor = Object.assign({}, keep, { notify: { workAttention: false } });
            assert.strictEqual(fn.sweepRoutine(gr), 1);
            assert.strictEqual(stackRow('fleetattn'), undefined);
            assert.strictEqual(inbox.list('admin').length, 0);
        } finally { cfg.agentSupervisor = keep; }
    });

    await test('a dismissed item stays dismissed, a swiped stack too: the same event published again neither joins nor sounds (#1194)', () => {
        const [a, b] = finish(2, 5000);
        inbox.clear('admin', `fleet-work:${a}:done`, 'page');
        assert.strictEqual(stackRow('fleetdone').data.count, 1);
        mark();
        fn.workChanged(row(a), 'running', 1); // the same event again
        assert.strictEqual(stackRow('fleetdone').data.count, 1, 'it does not rejoin');
        assert.strictEqual(loud(), 0);
        assert.strictEqual(toPhones.length, 0, 'and nothing is posted');
        // the stack swiped away as a whole (the app's dismissal): every item of it is dealt with
        inbox.ack('admin', 'stack:fleetdone', 'cleared', 'phone');
        assert.strictEqual(stackRow('fleetdone'), undefined);
        mark();
        fn.workChanged(row(b), 'running', 2);
        assert.strictEqual(stackRow('fleetdone'), undefined, 'a swiped stack does not come back for an event it already held');
        assert.strictEqual(loud(), 0);
        // a new event (ended again later) is news: a new stack, loud
        sup.setWork(b, { state: 'running', message: 'again' });
        sup.setWork(b, { state: 'done', ended_at: 9000, message: 'again' });
        assert.strictEqual(stackRow('fleetdone').data.count, 1);
        assert.strictEqual(loud(), 1);
    });

    await test('lives: done 4 h, needs you / stopped 12 h, account login 24 h, routine 4 h whatever its producer asked', async () => {
        sup.setWork(item(), { state: 'done', ended_at: 1, message: 'ok' });
        sup.setWork(item(), { state: 'failed', ended_at: 2, message: 'x' });
        const d = stackRow('fleetdone');
        assert.strictEqual(d.expiresAt - d.data.items[0].at, 4 * H);
        const a = stackRow('fleetattn');
        assert.strictEqual(a.expiresAt - a.data.items[0].at, 12 * H);
        fn.accountLogin({ index: 71, id: 'ffffffffffffffff', name: 'Fiona', since: 1 });
        const l = inbox.get('admin', 'fleet-account:ffffffffffffffff:login');
        assert.strictEqual(l.expiresAt - l.createdAt, 24 * H);
        assert.strictEqual(l.cls, 'fleet');
        assert.ok(!stackRow('login'), 'the account notice is a single row, not stacked');
        await sup.saveSettings(gr, { notify: { maintenance: true, usage: true } });
        fn.routine('maintenance', { id: 'fleet-maintenance:life', title: 'Fleet maintenance: needs a look', text: 't', data: { kind: 'maintenance' }, ttlMs: 2 * 24 * H });
        fn.routine('usage', { id: 'usage-flag:life', title: 'Heavy usage', text: 't', data: { kind: 'usage-flag' }, ttlMs: 3 * 24 * H });
        fn.routine('usage', { id: 'usage-flag:short', title: 'Heavy usage 2', text: 't', data: { kind: 'usage-flag' }, ttlMs: 1 * H });
        fn.routine('maintenance', { id: 'fleet-maintenance:none', title: 'Fleet maintenance 2', text: 't', data: { kind: 'maintenance' } });
        const life = (id) => { const n = inbox.get('admin', id); return n.expiresAt - n.createdAt; };
        assert.strictEqual(life('fleet-maintenance:life'), 4 * H, 'a two day ask is four hours');
        assert.strictEqual(life('usage-flag:life'), 4 * H);
        assert.strictEqual(life('usage-flag:short'), 1 * H, 'a shorter ask is kept');
        assert.strictEqual(life('fleet-maintenance:none'), 4 * H, 'no ask: four hours');
        assert.strictEqual(inbox.get('admin', 'usage-flag:life').cls, 'fleet');
        await sup.saveSettings(gr, { notify: { maintenance: false, usage: false } });
    });

    await test('an item leaves its stack at its own expiry while the others stay; prune tells the pages and the phone status', () => {
        let t = Date.parse('2026-11-26T08:00:00Z');
        const T0 = t;
        inbox._test.setNow(() => t);
        try {
            const a = item();
            sup.setWork(a, { state: 'done', ended_at: 1, message: 'a' });
            t += 3 * H;
            const b = item();
            sup.setWork(b, { state: 'done', ended_at: 2, message: 'b' });
            assert.strictEqual(stackRow('fleetdone').data.count, 2);
            assert.strictEqual(stackRow('fleetdone').expiresAt, T0 + 7 * H, 'the row ends with the LATEST item');
            // a's four hours are over; nothing has pruned yet: no reader shows it
            t = T0 + 4 * H + 60000;
            let st = stackRow('fleetdone');
            assert.deepStrictEqual(st.data.items.map((x) => x.data.workId), [b], 'list() leaves the expired item out');
            assert.strictEqual(st.data.count, 1);
            assert.strictEqual(st.title, `${row(b).title} is done`);
            assert.strictEqual(inbox.get('admin', 'stack:fleetdone').data.count, 1, 'get() too');
            assert.strictEqual(inbox._test.database().prepare("SELECT data FROM notices WHERE id = 'stack:fleetdone'").all().map((r) => JSON.parse(r.data).count)[0], 2, 'the stored row still holds it until prune');
            mark();
            inbox.prune('admin');
            st = stackRow('fleetdone');
            assert.deepStrictEqual(st.data.items.map((x) => x.data.workId), [b]);
            assert.strictEqual(st.data.count, 1);
            assert.strictEqual(inbox._test.database().prepare("SELECT data FROM notices WHERE id = 'stack:fleetdone'").all().map((r) => JSON.parse(r.data).count)[0], 1, 'prune took it out of the stored row');
            assert.strictEqual(st.expiresAt, T0 + 7 * H);
            assert.ok(touches.includes('inbox'), 'the phone status is rebuilt');
            assert.strictEqual(loud(), 0, 'silently');
            assert.deepStrictEqual(toPhones.map((n) => [n.id, n.alert]), [['stack:fleetdone', false]], 'the phones re-post the stack in place');
            assert.ok(sent.some((m) => m.type === 'inbox_updated' && m.data.reason === 'new' && m.data.notice.id === 'stack:fleetdone' && m.data.notice.data.count === 1), 'the pages get the stack with one item');
            // b's end: the last item, so the row goes and everything is told
            t = T0 + 7 * H + 60000;
            mark();
            inbox.prune('admin');
            assert.strictEqual(stackRow('fleetdone'), undefined);
            assert.deepStrictEqual(clearedOnPhones, ['stack:fleetdone'], 'the phones take their notification down');
            assert.ok(touches.includes('inbox'));
            assert.ok(sent.some((m) => m.type === 'inbox_updated' && m.data.reason === 'ack' && m.data.id === 'stack:fleetdone' && m.data.state === 'cleared'), 'the pages close their copy');
        } finally { inbox._test.setNow(null); }
    });

    await test('sweepRoutine takes down a notice raised under the old two-day life once its kind\'s new life is over (one row per item, never stacked)', () => {
        const old = (id, kind, hoursAgo) => {
            inbox._test.setNow(() => Date.now() - hoursAgo * 3600000);
            try { inbox.publish({ user: 'admin', app: 'claudedesk', id, cls: 'notification', title: `Fleet: ${id}`, text: 't', data: { app: 'claudedesk', kind }, ttlMs: 2 * 86400000 }); } finally { inbox._test.setNow(null); }
        };
        old('fleet-work:901:done', 'work-done', 5);
        old('fleet-work:902:done', 'work-done', 1);
        old('fleet-work:903:attention', 'work-attention', 13);
        old('fleet-work:904:attention', 'work-attention', 2);
        assert.strictEqual(fn.sweepRoutine(gr), 2, 'a done one 5 h old and a needs-you one 13 h old are past their lives');
        assert.strictEqual(live('fleet-work:901:done').length, 0);
        assert.strictEqual(live('fleet-work:903:attention').length, 0);
        assert.strictEqual(live('fleet-work:902:done').length, 1, 'inside its life it stays');
        assert.strictEqual(live('fleet-work:904:attention').length, 1);
    });

    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
