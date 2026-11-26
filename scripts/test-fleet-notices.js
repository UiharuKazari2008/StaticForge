#!/usr/bin/env node
'use strict';

/**
 * Fleet notices (Yozora #1196): modules/fleetNotices.js and its hooks in agentSupervisor.setWork.
 * Exactly two work notices reach the phone (done, needs her); routine alerts tell the Supervisor first and reach the
 * phone only on their Fleet Manager switch.
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

const inbox = require('../modules/notificationInbox');
const sup = require('../modules/agentSupervisor');
const fn = require('../modules/fleetNotices');
const store = require('../modules/agentCoord/store');
// no Yozora: every call answers empty
require('../modules/fleetYozora')._setFetch(async () => ({ ok: true, status: 200, text: async () => '{}' }));

const sent = [];
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
const mark = () => { sent.length = 0; };
const live = (idPart) => inbox.list('admin').filter((n) => !idPart || n.id.includes(idPart));

let failed = 0;
async function test(name, f) {
    try { await f(); console.log(`ok   ${name}`); } catch (e) { failed += 1; console.log(`FAIL ${name}\n     ${e.stack.split('\n').slice(0, 6).join('\n     ')}`); }
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
        assert.strictEqual(n[0].text, 'All built and tested');
        assert.strictEqual(n[0].data.app, 'claudedesk');
        assert.strictEqual(n[0].data.workId, id);
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
        assert.strictEqual(n[0].text, 'No account with a working login');
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
        assert.strictEqual(n[0].cls, 'notification');
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

    console.log(failed ? `\n${failed} FAILED` : '\nall passed');
    process.exit(failed ? 1 : 0);
})();
