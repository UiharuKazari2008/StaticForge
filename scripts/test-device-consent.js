#!/usr/bin/env node
'use strict';
process.env.DEVICE_QUEUE_TEST_PHONES = '1'; // these tests model the phones; the server refuses physical phones to agents

/**
 * Consent for shared test phones (#1284): modules/agentCoord/deviceQueue.js (pending / allowed / denied leases,
 * the change hook), modules/deviceConsent.js (settings, per-ask timeout, answer, the gate's check) and the MCP
 * tool answer. A temp agent-coord DB and a temp inbox DB: nothing reaches the real inbox or a real device; the
 * notices module is replaced by a recorder.
 *
 *   node scripts/test-device-consent.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devconsent-'));
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');
process.env.NOTIFICATION_INBOX_DB = path.join(tmp, 'inbox.db');
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
process.env.AGENT_SUPERVISOR_SOCKET = path.join(tmp, 'none.sock');
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const store = require('../modules/agentCoord/store');
const dq = require('../modules/agentCoord/deviceQueue');
const mcp = require('../modules/agentCoord/mcpServer'); // sets its own change hook (to a socket that does not exist); ours replaces it below
const dc = require('../modules/deviceConsent');

const tests = [];
function t(name, fn) { tests.push({ name, fn }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const alive = new Set();
store._setPidAlive((pid) => alive.has(pid));
let pid = 7000;
function agent(id) {
    pid += 1;
    alive.add(pid);
    store.upsertAgent({ id, kind: 'other', name: `${id}-name`, pid, status: 'active' });
    return pid;
}
const steers = [];
dq.setNotifier((a, body) => { steers.push({ to: a.id, body }); return 'test'; });
const steersTo = (id) => steers.filter((s) => s.to === id).map((s) => s.body);
const lastSteer = (id) => steersTo(id).slice(-1)[0] || '';

const syncs = [];
const recorder = { sync(snapshot, cfg, opts) { syncs.push({ snapshot: JSON.parse(JSON.stringify(snapshot)), cfg, quiet: [...opts.quiet] }); } };
dc._setNotices(recorder);
const lastSync = () => syncs[syncs.length - 1];

const hookCalls = [];
dq.setChangeHook((dev) => { hookCalls.push(dev); dc.changed(dev); });

const row = (id) => store.open().prepare('SELECT * FROM device_queue WHERE id = ?').get(id);
const pidA = agent('a'); agent('b'); agent('c');
const reset = (cfg) => { dc._setNotices(recorder); dc._reset(); dc.setSettings(Object.assign({ timeoutSec: 60, onTimeout: 'wait', readOnly: 'ask', consentDevices: ['a53', 'fold'] }, cfg || {})); };
function clearDevice(dev) {
    ['a', 'b', 'c'].forEach((id) => dq.release(id, dev));
    store.open().prepare("UPDATE device_queue SET state = 'cancelled' WHERE device = ? AND state IN ('held', 'waiting')").run(dev);
    store.open().prepare("UPDATE device_queue SET ended_at = ? WHERE device = ? AND state = 'denied'").run(Date.now() - 60 * 60000, dev);
}

t('settings: defaults, patching, validation', () => {
    const s = dc.settings();
    assert.deepStrictEqual(s, { timeoutSec: 60, onTimeout: 'wait', readOnly: 'ask', consentDevices: ['a53', 'fold'], testConsentDevices: [] });
    assert.strictEqual(dc.setSettings({ timeoutSec: 30 }).timeoutSec, 30);
    assert.strictEqual(dc.settings().onTimeout, 'wait', 'a patch keeps the other fields');
    assert.throws(() => dc.setSettings({ onTimeout: 'grant' }), /onTimeout/);
    assert.throws(() => dc.setSettings({ readOnly: 'yes' }), /readOnly/);
    assert.throws(() => dc.setSettings({ timeoutSec: 0 }), /timeoutSec/);
    assert.throws(() => dc.setSettings({ timeoutSec: 'x' }), /timeoutSec/);
    assert.throws(() => dc.setSettings({ consentDevices: 'a53' }), /consentDevices/);
    assert.deepStrictEqual(dc.setSettings({ consentDevices: ['Samsung-A53', 'Board 7', 'A53'] }).consentDevices, ['a53', 'board-7']);
    reset();
});

t('needsConsent: phones yes, test browsers never, free-form names only when listed', () => {
    assert.strictEqual(dq.needsConsent('a53'), true);
    assert.strictEqual(dq.needsConsent('Fold'), true);
    assert.strictEqual(dq.needsConsent('samsung-a53'), true);
    assert.strictEqual(dq.needsConsent('ruiko-chrome'), false);
    assert.strictEqual(dq.needsConsent('headless'), false);
    assert.strictEqual(dq.needsConsent('board-7'), false);
    dc.setSettings({ consentDevices: ['a53', 'fold', 'board-7', 'ruiko-chrome'] });
    assert.strictEqual(dq.needsConsent('board-7'), true);
    assert.strictEqual(dq.needsConsent('ruiko'), false, 'listing a test browser changes nothing');
    assert.strictEqual(dq.needsConsent('  '), false);
    reset();
});

t('request: a phone lease is pending, not started, and the agent is told to wait', () => {
    syncs.length = 0; hookCalls.length = 0;
    const r = dq.request('a', 'A53', { why: 'tap test', minutes: 20 });
    assert.strictEqual(r.granted, false);
    assert.strictEqual(r.consent, 'pending');
    assert.strictEqual(r.device, 'a53');
    assert.ok(/Waiting for Yukimi to tap Allow on the phone\. Do NOT touch the device \(no adb, device_shell, device_screenshot, taps\) until a steer message says it is allowed\./.test(r.note), r.note);
    const rw = row(r.lease.id);
    assert.strictEqual(rw.state, 'held');
    assert.strictEqual(rw.consent, 'pending');
    assert.strictEqual(rw.started_at, null);
    assert.ok(rw.ends_at > Date.now() + 11 * 3600 * 1000, 'a far-future placeholder end (an older agent-coord process reads NULL as run out)');
    assert.strictEqual(r.lease.endsAt, null, 'the lease shows no end while pending');
    assert.ok(rw.consent_at > 0);
    assert.strictEqual(steersTo('a').length, 0, 'no steer message that sounds granted');
    assert.ok(hookCalls.includes('a53'), 'the change hook fired');
    const ls = lastSync();
    assert.ok(ls && ls.snapshot.asks.length === 1 && ls.snapshot.holds.length === 0);
    const ask = ls.snapshot.asks[0];
    assert.strictEqual(ask.leaseId, r.lease.id);
    assert.strictEqual(ask.device, 'a53');
    assert.strictEqual(ask.label, 'A53 phone');
    assert.strictEqual(ask.agentId, 'a');
    assert.strictEqual(ask.agentName, 'a-name');
    assert.strictEqual(ask.why, 'tap test');
    assert.strictEqual(ask.minutes, 20);
    assert.ok(ask.requestedAt > 0 && ask.consentSince > 0);
    const st = dq.status('a53').devices[0];
    assert.strictEqual(st.holder.consent, 'pending');
    assert.strictEqual(st.holder.endsAt, null);
    assert.strictEqual(st.holder.minutesLeft, 20);
    assert.strictEqual(dq.request('a', 'a53', { why: 'tap test 2', minutes: 10 }).consent, 'pending', 'asking again stays pending');
    assert.strictEqual(row(r.lease.id).minutes, 10);
    assert.ok(row(r.lease.id).ends_at > Date.now() + 11 * 3600 * 1000);
    const rn = dq.renew('a', 'a53', 25);
    assert.strictEqual(rn.renewed, false);
    assert.strictEqual(rn.consent, 'pending');
    assert.strictEqual(row(r.lease.id).minutes, 25);
});

t('the gate: pending lease -> DEVICE_PENDING', () => {
    const v = dc.check({ deviceId: 'R5CT123', name: 'Galaxy A53', model: 'SM-A536B' }, { kind: 'shell', command: 'input tap 1 1' });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, 'DEVICE_PENDING');
    assert.strictEqual(v.holder.agentId, 'a');
    assert.strictEqual(v.holder.consent, 'pending');
    assert.strictEqual(v.hint, 'coord_device_request it, then wait for Allow on the phone');
});

t('answer: only allow / deny, only a pending ask', () => {
    const id = lastSync().snapshot.asks[0].leaseId;
    assert.strictEqual(dc.answer(id, 'maybe').ok, false);
    assert.strictEqual(dc.answer(99999, 'allow').ok, false);
    assert.strictEqual(row(id).consent, 'pending');
});

t('allow: the lease starts, the agent gets a steer message, the hold shows', () => {
    const id = lastSync().snapshot.asks[0].leaseId;
    const before = Date.now();
    const r = dc.answer(id, 'allow', 'Yukimi');
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.lease.consent, 'allowed');
    const rw = row(id);
    assert.strictEqual(rw.consent, 'allowed');
    assert.ok(rw.started_at >= before && rw.ends_at >= before + 25 * 60000 - 1000 && rw.ends_at <= Date.now() + 25 * 60000 + 1000);
    assert.ok(/Device a53 is allowed until \d\d:\d\d/.test(lastSteer('a')), lastSteer('a'));
    const ls = lastSync();
    assert.strictEqual(ls.snapshot.asks.length, 0);
    assert.strictEqual(ls.snapshot.holds.length, 1);
    assert.strictEqual(ls.snapshot.holds[0].endsAt, rw.ends_at);
    assert.strictEqual(dc.answer(id, 'allow').ok, false, 'already answered');
    assert.strictEqual(dc.answer(id, 'deny').ok, false);
});

t('the gate: allowed lease -> ok with the lease', () => {
    const v = dc.check({ deviceId: 'a53' }, { kind: 'screenshot' }, { agentId: 'a' });
    assert.strictEqual(v.ok, true);
    assert.strictEqual(v.lease.agentId, 'a');
    assert.strictEqual(v.lease.consent, 'allowed');
});

t('renew keeps consent and extends the clock', () => {
    const id = lastSync().snapshot.holds[0].leaseId;
    const before = row(id).ends_at;
    const r = dq.renew('a', 'a53', 50);
    assert.strictEqual(r.renewed, true);
    assert.strictEqual(r.lease.consent, 'allowed');
    assert.ok(row(id).ends_at > before + 20 * 60000);
    const q = dq.request('a', 'a53', { minutes: 30 });
    assert.strictEqual(q.granted, true);
    assert.strictEqual(q.renewed, true);
    assert.strictEqual(row(id).consent, 'allowed');
});

t('release ends the hold and clears the notice picture', () => {
    const r = dq.release('a', 'a53');
    assert.strictEqual(r.released, true);
    const ls = lastSync();
    assert.strictEqual(ls.snapshot.asks.length, 0);
    assert.strictEqual(ls.snapshot.holds.length, 0);
    const v = dc.check({ deviceId: 'a53' }, { kind: 'screenshot' });
    assert.strictEqual(v.code, 'DEVICE_NOT_GRANTED');
    assert.strictEqual(v.holder, null);
});

t('deny: the lease ends, the agent is told, the next waiter becomes the pending ask', () => {
    clearDevice('a53');
    const ra = dq.request('a', 'a53', { why: 'first' });
    const rb = dq.request('b', 'a53', { why: 'second', minutes: 5 });
    assert.strictEqual(ra.consent, 'pending');
    assert.strictEqual(rb.granted, false);
    assert.strictEqual(rb.position, 1);
    assert.ok(/then Yukimi still has to tap Allow/.test(rb.note), rb.note);
    const r = dc.answer(ra.lease.id, 'deny', 'Yukimi');
    assert.strictEqual(r.ok, true);
    const rw = row(ra.lease.id);
    assert.strictEqual(rw.state, 'denied');
    assert.strictEqual(rw.consent, 'denied');
    assert.strictEqual(rw.end_reason, 'denied by Yukimi');
    assert.ok(/denied your use of device a53/.test(lastSteer('a')) && /Do NOT touch/.test(lastSteer('a')), lastSteer('a'));
    const ask = lastSync().snapshot.asks;
    assert.strictEqual(ask.length, 1);
    assert.strictEqual(ask[0].agentId, 'b');
    assert.ok(/Yukimi has to tap Allow/.test(lastSteer('b')) && /Do NOT touch/.test(lastSteer('b')), lastSteer('b'));
    assert.strictEqual(dq.status('a53').devices[0].holder.agentId, 'b');
    const v = dc.check({ deviceId: 'a53' }, { kind: 'shell', command: 'ls' });
    assert.strictEqual(v.code, 'DEVICE_PENDING', 'the next waiter holds a pending lease now');
    dc.answer(ask[0].leaseId, 'allow');
    assert.strictEqual(dc.check({ deviceId: 'a53' }, { kind: 'shell', command: 'ls' }, { agentId: 'b' }).ok, true);
    dq.release('b', 'a53');
});

t('the gate: a recent denial with nobody holding the device says DEVICE_DENIED', () => {
    clearDevice('fold');
    const r = dq.request('a', 'fold', {});
    dc.answer(r.lease.id, 'deny');
    const v = dc.check({ name: 'Galaxy Z Fold5', model: 'SM-F946B' }, { kind: 'shell', command: 'input tap 1 1' });
    assert.strictEqual(v.code, 'DEVICE_DENIED');
    assert.strictEqual(v.device, 'fold');
    store.open().prepare("UPDATE device_queue SET ended_at = ? WHERE state = 'denied'").run(Date.now() - 60 * 60000);
    assert.strictEqual(dc.check({ deviceId: 'fold' }, { kind: 'screenshot' }).code, 'DEVICE_NOT_GRANTED', 'an old denial is forgotten');
});

t('devices that need no consent behave as before', () => {
    syncs.length = 0;
    const r = dq.request('a', 'ruiko', { why: 'visual', minutes: 10 });
    assert.strictEqual(r.granted, true);
    assert.strictEqual(r.consent, undefined);
    assert.strictEqual(r.lease.consent, 'none');
    assert.ok(r.lease.endsAt > Date.now() + 9 * 60000);
    const rb = dq.request('b', 'ruiko', {});
    assert.strictEqual(rb.granted, false);
    assert.ok(!/Allow/.test(rb.note));
    assert.strictEqual(dq.release('a', 'ruiko').next, 'b');
    assert.ok(/Device ruiko-chrome is yours until \d\d:\d\d/.test(lastSteer('b')), lastSteer('b'));
    assert.strictEqual(store.open().prepare("SELECT consent FROM device_queue WHERE device = 'ruiko-chrome' AND state = 'held'").get().consent, 'none');
    assert.strictEqual(dq.snapshotConsent().asks.length, 0);
    dq.release('b', 'ruiko');
    assert.strictEqual(dc.check({ deviceId: 'ruiko-chrome' }, { kind: 'shell', command: 'rm -rf /' }).ok, true, 'a test browser is no phone');
    const unk = dc.check({ deviceId: 'board-9', name: 'a bench board' }, { kind: 'shell', command: 'x' });
    assert.strictEqual(unk.ok, false, 'a phone the table does not know is closed, never open');
    assert.strictEqual(unk.code, 'DEVICE_NOT_GRANTED');
});

t('a lease an older process granted (consent none) is asked about at its first gated use', () => {
    clearDevice('a53');
    const r0 = dq.request('a', 'a53', { why: 'old code grant' });
    // what code from before consent did: held, consent none, a real end
    store.open().prepare("UPDATE device_queue SET consent = 'none', started_at = ?, ends_at = ? WHERE id = ?").run(Date.now(), Date.now() + 600000, r0.lease.id);
    const g = dc.check({ deviceId: 'a53' }, { kind: 'shell', command: 'input tap 1 1' });
    assert.strictEqual(g.ok, false);
    assert.strictEqual(g.code, 'DEVICE_PENDING');
    assert.strictEqual(row(r0.lease.id).consent, 'pending');
    assert.strictEqual(dq.snapshotConsent().asks.length, 1, 'it is an ask now');
    assert.ok(/needs Yukimi's Allow/.test(lastSteer('a')), lastSteer('a'));
});

t('endHold: End on the in-use notice takes the phone back, tells the holder, hands on', () => {
    clearDevice('a53');
    const r = dq.request('a', 'a53', { why: 'end me' });
    assert.strictEqual(dc.answer(r.lease.id, 'allow', 'test').ok, true);
    const rb = dq.request('b', 'a53', { why: 'next' });
    assert.strictEqual(rb.granted, false);
    const e = dc.endHold('a53', 'household:test', { leaseId: r.lease.id });
    assert.strictEqual(e.ok, true);
    assert.strictEqual(row(r.lease.id).state, 'released');
    assert.ok(/ended by household:test/.test(lastSteer('a')), lastSteer('a'));
    assert.strictEqual(dq.snapshotConsent().holds.length, 0, 'no hold left');
    assert.strictEqual(dq.snapshotConsent().asks.length, 1, 'the next in line is asked about now');
});

t('an older process sweeping the table (code from before consent: ends_at <= now means run out) leaves a pending ask alone', () => {
    clearDevice('a53');
    const r = dq.request('a', 'a53', { why: 'old sweep' });
    assert.strictEqual(r.consent, 'pending');
    const old = row(r.lease.id);
    assert.ok(old.ends_at > Date.now(), 'the old rule `ends_at <= now` is false for a pending ask');
    assert.strictEqual(dq.snapshotConsent().asks.length, 1);
});

t('timeout "wait": the ask stays pending, never granted, the notice goes quiet', async () => {
    clearDevice('a53');
    reset({ timeoutSec: 1, onTimeout: 'wait' });
    const r = dq.request('a', 'a53', { why: 'slow' });
    assert.deepStrictEqual(lastSync().quiet, []);
    await sleep(1300);
    assert.strictEqual(row(r.lease.id).consent, 'pending', 'still pending');
    assert.strictEqual(row(r.lease.id).state, 'held');
    assert.deepStrictEqual(lastSync().quiet, [r.lease.id], 'the notice is re-synced quiet');
    assert.strictEqual(lastSync().snapshot.asks.length, 1, 'the ask stays up');
    assert.strictEqual(dc.check({ deviceId: 'a53' }, { kind: 'screenshot' }).code, 'DEVICE_PENDING');
    assert.strictEqual(dc.answer(r.lease.id, 'allow').ok, true, 'a late Allow still works');
    assert.strictEqual(row(r.lease.id).consent, 'allowed');
    dq.release('a', 'a53');
    reset();
});

t('timeout "deny": the ask is denied, the agent told, the next promoted', async () => {
    clearDevice('a53');
    reset({ timeoutSec: 1, onTimeout: 'deny' });
    const ra = dq.request('a', 'a53', { why: 'x' });
    dq.request('b', 'a53', { why: 'y' });
    await sleep(1300);
    assert.strictEqual(row(ra.lease.id).state, 'denied');
    assert.ok(/denied/i.test(row(ra.lease.id).end_reason), row(ra.lease.id).end_reason);
    assert.ok(/denied/i.test(lastSteer('a')), lastSteer('a'));
    assert.strictEqual(lastSync().snapshot.asks[0].agentId, 'b', 'the next waiter is the ask now (with its own timer)');
    await sleep(1300);
    assert.strictEqual(dq.status('a53').holding, 0, 'b was denied too after its own timeout');
    reset();
});

t('timeout "allow": only when she chose it', async () => {
    clearDevice('a53');
    reset({ timeoutSec: 1, onTimeout: 'allow' });
    const r = dq.request('a', 'a53', { why: 'x', minutes: 5 });
    await sleep(1300);
    assert.strictEqual(row(r.lease.id).consent, 'allowed');
    assert.ok(row(r.lease.id).ends_at > Date.now() + 4 * 60000);
    assert.ok(/allowed until/.test(lastSteer('a')));
    dq.release('a', 'a53');
    reset();
});

t('a released ask loses its timeout (nothing fires later)', async () => {
    clearDevice('a53');
    reset({ timeoutSec: 1, onTimeout: 'deny' });
    const r = dq.request('a', 'a53', { why: 'x' });
    const n = steersTo('a').length;
    dq.release('a', 'a53');
    await sleep(1300);
    assert.strictEqual(row(r.lease.id).state, 'released');
    assert.strictEqual(steersTo('a').length, n, 'no steer after release');
    reset();
});

t('a restarted server rebuilds timers from the DB (timeout counts from consent_since)', async () => {
    clearDevice('a53');
    reset({ timeoutSec: 2, onTimeout: 'wait' });
    const r = dq.request('a', 'a53', { why: 'x' });
    store.open().prepare('UPDATE device_queue SET consent_at = ? WHERE id = ?').run(Date.now() - 5000, r.lease.id);
    dc._reset(); // what a new server process starts with
    syncs.length = 0;
    dc.resync();
    assert.deepStrictEqual(lastSync().quiet, [r.lease.id], 'already past its timeout: quiet at once');
    assert.strictEqual(lastSync().snapshot.asks.length, 1, 'the open ask is shown again');
    // a younger ask gets its remaining time, not a fresh one
    store.open().prepare('UPDATE device_queue SET consent_at = ? WHERE id = ?').run(Date.now() - 1000, r.lease.id);
    dc._reset();
    dc.resync();
    assert.deepStrictEqual(lastSync().quiet, [], 'not yet');
    await sleep(1300);
    assert.deepStrictEqual(lastSync().quiet, [r.lease.id], 'quiet after the remaining ~1 s');
    // deny mode after a restart with an overdue ask: denied right away (she chose it)
    dc.setSettings({ onTimeout: 'deny' });
    await sleep(100);
    assert.strictEqual(row(r.lease.id).state, 'denied');
    reset();
});

t('sweep drops a pending ask whose agent is gone and hands on; an idle agent keeps its ask', () => {
    clearDevice('a53');
    reset();
    const r = dq.request('a', 'a53', { why: 'x' });
    dq.request('b', 'a53', { why: 'y' });
    store.upsertAgent({ id: 'a', status: 'idle' });
    store.open().prepare("UPDATE agents SET seen_at = ? WHERE id = 'a'").run(Date.now() - 30 * 60000);
    store.open().prepare('UPDATE device_queue SET consent_at = ?, requested_at = ? WHERE id = ?').run(Date.now() - 30 * 60000, Date.now() - 30 * 60000, r.lease.id);
    dq.sweep('a53');
    assert.strictEqual(row(r.lease.id).state, 'held', 'idle is not gone: the ask waits for Yukimi');
    alive.delete(pidA);
    hookCalls.length = 0;
    dq.sweep('a53');
    assert.strictEqual(row(r.lease.id).state, 'expired');
    assert.ok(/gone|ended/.test(row(r.lease.id).end_reason), row(r.lease.id).end_reason);
    assert.strictEqual(lastSync().snapshot.asks[0].agentId, 'b');
    assert.ok(hookCalls.includes('a53'));
    alive.add(pidA);
    store.upsertAgent({ id: 'a', status: 'active' });
    clearDevice('a53');
});

t('the change hook fires for every kind of change and not for a no-op sweep', () => {
    clearDevice('fold');
    clearDevice('a53');
    hookCalls.length = 0;
    const r = dq.request('a', 'fold', { why: 'h' });
    assert.ok(hookCalls.length >= 1, 'request');
    hookCalls.length = 0;
    dq.sweep('fold');
    assert.strictEqual(hookCalls.length, 0, 'a no-op sweep is silent');
    dq.status();
    assert.strictEqual(hookCalls.length, 0, 'status without changes is silent');
    dc.answer(r.lease.id, 'allow');
    assert.ok(hookCalls.length >= 1, 'setConsent');
    hookCalls.length = 0;
    dq.renew('a', 'fold', 20);
    assert.ok(hookCalls.length >= 1, 'renew');
    hookCalls.length = 0;
    dq.request('b', 'fold', {});
    hookCalls.length = 0;
    dq.forceRelease('fold', 'Yukimi');
    assert.ok(hookCalls.includes('fold'), 'forceRelease (and the promote)');
    hookCalls.length = 0;
    store.open().prepare("UPDATE device_queue SET consent = 'allowed', started_at = ?, ends_at = ? WHERE device = 'fold' AND state = 'held'").run(Date.now() - 5000, Date.now() - 1000);
    dq.sweep('fold');
    assert.ok(hookCalls.includes('fold'), 'expiry');
    hookCalls.length = 0;
    dq.request('c', 'fold', {});
    hookCalls.length = 0;
    dq.releaseAgent('c');
    assert.ok(hookCalls.includes('fold'), 'releaseAgent');
    clearDevice('fold');
});

t('a lease that ran out ends the hold (sweep by the deadline)', () => {
    clearDevice('fold');
    const r = dq.request('a', 'fold', { minutes: 5 });
    dc.answer(r.lease.id, 'allow');
    assert.strictEqual(lastSync().snapshot.holds.length, 1);
    store.open().prepare('UPDATE device_queue SET ends_at = ? WHERE id = ?').run(Date.now() - 1000, r.lease.id);
    assert.strictEqual(dq.snapshotConsent().holds.length, 0, 'an expired hold is not shown');
    assert.strictEqual(dc.check({ deviceId: 'fold' }, { kind: 'screenshot' }).code, 'DEVICE_NOT_GRANTED');
    assert.strictEqual(lastSync().snapshot.holds.length, 0, 'the check swept it and re-synced');
    clearDevice('fold');
});

t('readOnly setting: a read-only shell or package read passes without a lease only when allowed', () => {
    clearDevice('a53');
    const tgt = { deviceId: 'a53' };
    const ro = (command) => dc.check(tgt, { kind: 'shell', command }).ok;
    reset({ readOnly: 'ask' });
    assert.strictEqual(ro('dumpsys battery'), false, 'default: ask');
    assert.strictEqual(dc.check(tgt, { kind: 'packages-read' }).ok, false);
    reset({ readOnly: 'allow' });
    ['dumpsys battery', 'dumpsys window | grep mCurrentFocus', 'getprop ro.product.model', 'pm list packages -3', 'pm path com.x.y', 'pm dump com.x.y',
        'settings get secure android_id', 'cat /proc/meminfo', 'ls /sdcard/Download', 'df -h', 'uptime', 'wm size', 'wm density', 'ip addr show wlan0', 'ping -c 3 8.8.8.8',
        'getprop ro.build.version.sdk && dumpsys battery'].forEach((c) => assert.strictEqual(ro(c), true, c));
    ['dumpsys battery set level 5', 'dumpsys; reboot', 'getprop; rm -rf /sdcard', 'ls && rm -rf /sdcard', 'dumpsys | sh', 'dumpsys | tee /sdcard/x', 'getprop > /sdcard/p.txt',
        'cat /proc/meminfo > /sdcard/m', 'cat /sdcard/secret', 'cat /proc/../data/x', 'pm uninstall com.x.y', 'pm clear com.x.y', 'settings put global x 1', 'wm size 100x100', 'wm density 100',
        'ip link set wlan0 down', 'ping 8.8.8.8', 'input tap 1 1', 'reboot', 'ls $(reboot)', 'ls `reboot`', 'ls\nreboot', 'dumpsys &', '', 'rm -rf /sdcard'].forEach((c) => assert.strictEqual(ro(c), false, JSON.stringify(c)));
    assert.strictEqual(dc.check(tgt, { kind: 'packages-read' }).ok, true);
    assert.strictEqual(dc.check(tgt, { kind: 'packages-write' }).code, 'DEVICE_NOT_GRANTED');
    assert.strictEqual(dc.check(tgt, { kind: 'screenshot' }).code, 'DEVICE_NOT_GRANTED');
    assert.strictEqual(dc.check(tgt, { kind: 'shell', command: 'dumpsys battery' }).readOnly, true);
    assert.strictEqual(dc.check(tgt, { kind: 'shell' }).ok, false, 'no command');
    reset();
});

t('the gate maps targets by alias, name and model', () => {
    clearDevice('a53'); clearDevice('fold');
    const code = (target) => dc.check(target, { kind: 'screenshot' }).code;
    assert.strictEqual(code({ deviceId: 'fold' }), 'DEVICE_NOT_GRANTED');
    assert.strictEqual(code({ deviceId: '192.168.1.5:5555', name: 'Galaxy Z Fold4' }), 'DEVICE_NOT_GRANTED');
    assert.strictEqual(code({ model: 'SM-F946B' }), 'DEVICE_NOT_GRANTED');
    assert.strictEqual(code({ model: 'SM-A536B' }), 'DEVICE_NOT_GRANTED');
    assert.strictEqual(code({ name: 'Samsung A53' }), 'DEVICE_NOT_GRANTED');
    assert.strictEqual(dc.deviceFor({ model: 'SM-F946B' }), 'fold');
    assert.strictEqual(dc.deviceFor({ model: 'SM-A536B' }), 'a53');
    assert.strictEqual(dc.deviceFor({ deviceId: 'Fold-Phone' }), 'fold');
    assert.strictEqual(dc.deviceFor({ deviceId: 'pixel-8' }), '');
    assert.strictEqual(dc.check({ deviceId: 'pixel-8', model: 'Pixel 8' }, { kind: 'shell', command: 'reboot' }).ok, false, 'an unlisted phone is closed');
    dc.setSettings({ consentDevices: ['a53', 'fold', 'pixel-8'] });
    assert.strictEqual(dc.check({ deviceId: 'pixel-8' }, { kind: 'shell', command: 'reboot' }).code, 'DEVICE_NOT_GRANTED', 'a listed free-form phone needs consent');
    reset();
    assert.strictEqual(dc.check({ deviceId: 'a53' }, null).code, 'DEVICE_NOT_GRANTED');
});

t('a notices module that throws never breaks the queue', () => {
    clearDevice('fold');
    dc._setNotices({ sync() { throw new Error('boom'); } });
    const w = console.warn;
    console.warn = () => {};
    try {
        const r = dq.request('a', 'fold', {});
        assert.strictEqual(r.consent, 'pending');
        assert.strictEqual(dc.answer(r.lease.id, 'allow').ok, true);
    } finally { console.warn = w; }
    dc._setNotices({ sync() {} });
    clearDevice('fold');
});

t('MCP tool round trip: the answer says pending; descriptions tell the agent to wait', () => {
    clearDevice('fold');
    process.env.AGENT_COORD_ID = 'a';
    alive.add(process.ppid);
    const tool = (n) => mcp.TOOLS.find((x) => x.name === n);
    assert.ok(/consent pending/.test(tool('coord_device_request').description) && /Allow/.test(tool('coord_device_request').description) && /do NOT touch/i.test(tool('coord_device_request').description));
    assert.ok(/BEFORE any test, install, reboot, screenshot run or tap-through/.test(tool('coord_device_request').description));
    assert.ok(/Allow/.test(tool('coord_device_renew').description));
    const r = mcp.run('coord_device_request', { device: 'fold', why: 'mcp', minutes: 5 });
    assert.strictEqual(r.granted, false);
    assert.strictEqual(r.consent, 'pending');
    const s = mcp.run('coord_devices', { device: 'fold' });
    assert.strictEqual(s.devices[0].holder.consent, 'pending');
    assert.strictEqual(s.devices[0].holder.endsAt, '');
    assert.strictEqual(mcp.run('coord_device_renew', { device: 'fold', minutes: 30 }).renewed, false);
    assert.strictEqual(mcp.run('coord_device_release', { device: 'fold' }).released, true);
    const text = mcp.handle ? JSON.stringify(mcp.TOOLS.map((x) => x.description)) : '';
    assert.ok(/phone/.test(text));
});


// ---------------------------------------------------------------- #1305 server consent core

const withRealRules = async (fn) => {
    // the server's own rules: the a53 never asks, the Fold is off limits (these tests otherwise model both as asking phones)
    const prev = process.env.DEVICE_QUEUE_TEST_PHONES;
    delete process.env.DEVICE_QUEUE_TEST_PHONES;
    try { await fn(); } finally { if (prev !== undefined) process.env.DEVICE_QUEUE_TEST_PHONES = prev; }
};
const wipe = () => { store.open().prepare("UPDATE device_queue SET state = 'cancelled' WHERE state IN ('held', 'waiting')").run(); store.open().prepare("UPDATE device_queue SET ended_at = ? WHERE state = 'denied'").run(Date.now() - 60 * 60000); };

t('Yukimi Nov 27: a pending A53 ask written by an old agent-coord process is allowed at once by the server, never shown', async () => {
    await withRealRules(async () => {
        wipe(); reset({ consentDevices: ['fold', 'a53'] }); // even a settings list that still names the a53
        // an old process (code from before the A53 change) writes a held, pending lease for the a53
        const now = Date.now();
        const info = store.open().prepare("INSERT INTO device_queue (device, agent_id, why, minutes, state, requested_at, started_at, ends_at, consent, consent_at) VALUES ('a53', 'old', 'old process ask', 15, 'held', ?, ?, ?, 'pending', ?)").run(now, now, now + 24 * 3600000, now);
        dc.changed('a53', true);
        const r = store.open().prepare('SELECT consent, ends_at FROM device_queue WHERE id = ?').get(info.lastInsertRowid);
        assert.strictEqual(r.consent, 'allowed', 'settled by the server');
        assert.ok(r.ends_at <= Date.now() + 15 * 60000 + 1000, 'its clock runs from now');
        const snap = lastSync().snapshot;
        assert.ok(!snap.asks.some((a) => a.device === 'a53'), 'no ask');
        assert.ok(!snap.holds.some((h) => h.device === 'a53'), 'no in-use notice either');
        assert.strictEqual(dc.check({ deviceId: 'a53' }, { kind: 'shell', command: 'input tap 1 1' }, { agentId: 'old' }).ok, true);
        wipe(); reset();
    });
});

t('S1 settings: testConsentDevices defaults to [], is normalised and validated; the Fold and the browsers are refused', () => {
    reset();
    assert.deepStrictEqual(dc.settings().testConsentDevices, []);
    assert.deepStrictEqual(dc.setSettings({ testConsentDevices: ['Emulator 5554', 'AEMU-Fold-1', 'emulator-5554'] }).testConsentDevices, ['emulator-5554', 'aemu-fold-1']);
    assert.deepStrictEqual(dc.setSettings({ timeoutSec: 45 }).testConsentDevices, ['emulator-5554', 'aemu-fold-1'], 'a patch keeps the list');
    assert.throws(() => dc.setSettings({ testConsentDevices: 'a53' }), /testConsentDevices must be a list/);
    assert.throws(() => dc.setSettings({ testConsentDevices: ['a53', 'Fold'] }), /cannot include fold/);
    assert.throws(() => dc.setSettings({ testConsentDevices: ['ruiko'] }), /cannot include ruiko-chrome/);
    assert.deepStrictEqual(dc.settings().testConsentDevices, ['emulator-5554', 'aemu-fold-1'], 'a refused patch saved nothing');
    assert.deepStrictEqual(dc.setSettings({ testConsentDevices: [] }).testConsentDevices, []);
    // a stored bad value reads as the safe subset
    store.setSetting('deviceConsent', Object.assign({}, store.getSetting('deviceConsent'), { testConsentDevices: ['fold', 'a53'] }));
    assert.deepStrictEqual(dc.settings().testConsentDevices, ['a53']);
    reset();
});

t('S1 lane: an emulator on the test lane goes through the full flow (gate pending, then holder only), its ask and hold are lane test; a normal ask has no lane', async () => {
    await withRealRules(async () => {
        wipe(); reset();
        const emu = { deviceId: 'emulator-5554', name: 'aemu', model: 'sdk_gphone64_x86_64' };
        // off by default: the emulator is open, nothing asks
        assert.strictEqual(dc.check(emu, { kind: 'shell', command: 'input tap 1 1' }).emulator, true);
        assert.strictEqual(dq.request('a', 'emulator-5554', {}).granted, true);
        dq.release('a', 'emulator-5554');
        dc.setSettings({ testConsentDevices: ['emulator-5554'] });
        syncs.length = 0;
        const r = dq.request('a', 'emulator-5554', { why: 'lane test', minutes: 5 });
        assert.strictEqual(r.consent, 'pending');
        const ls = lastSync();
        assert.strictEqual(ls.snapshot.asks.length, 1);
        assert.strictEqual(ls.snapshot.asks[0].lane, 'test');
        const v = dc.check(emu, { kind: 'shell', command: 'input tap 1 1' }, { agentId: 'a' });
        assert.strictEqual(v.ok, false, 'the emulator bypass is off for a test-lane device');
        assert.strictEqual(v.code, 'DEVICE_PENDING');
        assert.strictEqual(dc.askLane(r.lease.id), 'test');
        assert.strictEqual(dc.laneOfDevice('emulator-5554'), 'test');
        // a test-lane client answers its own lane's ask; the household's ask stays refused for it
        const ok = dc.answer(r.lease.id, 'allow', 'test-client', { clientLane: 'test' });
        assert.strictEqual(ok.ok, true);
        assert.strictEqual(lastSync().snapshot.holds[0].lane, 'test');
        assert.strictEqual(dc.check(emu, { kind: 'shell', command: 'input tap 1 1' }, { agentId: 'a' }).ok, true);
        dq.release('a', 'emulator-5554');
        // an admin client may answer a test-lane ask too
        const r2 = dq.request('a', 'emulator-5554', { why: 'admin answers' });
        assert.strictEqual(dc.answer(r2.lease.id, 'deny', 'admin', { clientLane: 'admin' }).ok, true);
        wipe();
        // a normal ask: no lane, and a test-lane client may not answer it
        dc.setSettings({ consentDevices: ['pixel-9'], testConsentDevices: ['emulator-5554'] });
        const n = dq.request('a', 'pixel-9', { why: 'household' });
        assert.strictEqual(n.consent, 'pending');
        assert.strictEqual(lastSync().snapshot.asks[0].lane, undefined);
        assert.strictEqual(dc.askLane(n.lease.id), 'admin');
        const refused = dc.answer(n.lease.id, 'allow', 'test-client', { clientLane: 'test' });
        assert.deepStrictEqual(refused, { ok: false, error: 'test device' });
        assert.strictEqual(row(n.lease.id).consent, 'pending', 'still pending');
        assert.strictEqual(dc.answer(n.lease.id, 'allow', 'admin', { clientLane: 'admin' }).ok, true);
        dq.release('a', 'pixel-9');
        wipe(); reset();
    });
});

t('S1 lane: End on a test-lane hold by a test client; a test client never ends a household hold', async () => {
    await withRealRules(async () => {
        wipe(); reset({ consentDevices: ['pixel-9'], testConsentDevices: ['emulator-5554'] });
        const t1 = dq.request('a', 'emulator-5554', { why: 'lane end' });
        dc.answer(t1.lease.id, 'allow', 'x', { clientLane: 'test' });
        assert.deepStrictEqual(dc.endHold('emulator-5554', 'household:t', { leaseId: t1.lease.id, clientLane: 'test' }), { ok: true, device: 'emulator-5554' });
        const h1 = dq.request('b', 'pixel-9', { why: 'household hold' });
        dc.answer(h1.lease.id, 'allow', 'x');
        assert.deepStrictEqual(dc.endHold('pixel-9', 'household:t', { leaseId: h1.lease.id, clientLane: 'test' }), { ok: false, error: 'test device' });
        assert.strictEqual(row(h1.lease.id).state, 'held');
        assert.strictEqual(dc.endHold('pixel-9', 'household:t', { leaseId: h1.lease.id, clientLane: 'admin' }).ok, true);
        wipe(); reset();
    });
});

t('S1: the Fold stays off limits and a53 off the lane never asks (hard rule)', async () => {
    await withRealRules(async () => {
        wipe(); reset({ consentDevices: ['fold'] });
        assert.throws(() => dq.request('a', 'fold', { why: 'explore' }), /off limits/);
        assert.strictEqual(dq.request('a', 'a53', { why: 'test phone' }).granted, true, 'the A53 test phone is open');
        dq.release('a', 'a53');
        assert.throws(() => dc.setSettings({ testConsentDevices: ['fold'] }), /cannot include fold/);
        // what she can see or feel stays closed; a screenshot / read-only shell is open (Yukimi, Nov 27: test-fold-off-limits.js)
        const v = dc.check({ deviceId: 'fold' }, { kind: 'shell', command: 'input tap 1 1' }, { agentId: 'a' });
        assert.strictEqual(v.code, 'DEVICE_OFF_LIMITS');
        assert.strictEqual(dc.check({ deviceId: 'fold' }, { kind: 'screenshot' }, { agentId: 'a' }).ok, true);
        wipe(); reset();
    });
});

t('S2: a stale End ends nothing: A allowed, B queued, A released, B pending, End of A\'s lease leaves B alone', () => {
    clearDevice('a53'); wipe(); reset();
    const a = dq.request('a', 'a53', { why: 'A' });
    dc.answer(a.lease.id, 'allow', 'h');
    dq.request('b', 'a53', { why: 'B' });
    dq.release('a', 'a53'); // B is a pending ask now
    const bId = lastSync().snapshot.asks[0].leaseId;
    const before = steersTo('b').length;
    const stale = dc.endHold('a53', 'household:x', { leaseId: a.lease.id });
    assert.deepStrictEqual(stale, { ok: false, error: 'That hold is over' });
    assert.strictEqual(row(bId).state, 'held');
    assert.strictEqual(row(bId).consent, 'pending', 'B untouched');
    assert.strictEqual(steersTo('b').length, before, 'B was told nothing');
    // no lease id (an old client): nothing ends either
    assert.deepStrictEqual(dc.endHold('a53', 'household:x'), { ok: false, error: 'That hold is over' });
    assert.strictEqual(row(bId).consent, 'pending');
    // B's own lease id while it is only pending: not an allowed hold
    assert.deepStrictEqual(dc.endHold('a53', 'household:x', { leaseId: bId }), { ok: false, error: 'That hold is over' });
    // a lease id of another device does not end this one
    dc.answer(bId, 'allow', 'h');
    assert.deepStrictEqual(dc.endHold('fold', 'household:x', { leaseId: bId }), { ok: false, error: 'That hold is over' });
    assert.strictEqual(row(bId).consent, 'allowed');
    // a lease that ran out is over, not endable
    store.open().prepare('UPDATE device_queue SET ends_at = ? WHERE id = ?').run(Date.now() - 1000, bId);
    assert.deepStrictEqual(dc.endHold('a53', 'household:x', { leaseId: bId }), { ok: false, error: 'That hold is over' });
    clearDevice('a53');
});

t('S3: an allowed lease is its holder\'s alone; a call that names nobody, or somebody else, is refused', () => {
    clearDevice('a53'); wipe(); reset();
    store.upsertAgent({ id: 'a', sessionId: 'aaaaaaaa-0000-4000-8000-000000000001' });
    const a = dq.request('a', 'a53', { why: 'holder', sessionId: '' });
    dc.answer(a.lease.id, 'allow', 'h');
    const tgt = { deviceId: 'a53' };
    const act = { kind: 'shell', command: 'input tap 1 1' };
    assert.strictEqual(dc.check(tgt, act, { agentId: 'a' }).ok, true, 'the holder');
    assert.strictEqual(dc.check(tgt, act, { agentId: 'A ' }).ok, true, 'ids compare trimmed and case-insensitive');
    assert.strictEqual(dc.check(tgt, act, { sessionId: 'aaaaaaaa-0000-4000-8000-000000000001' }).ok, true, 'its registered session');
    const other = dc.check(tgt, act, { agentId: 'b' });
    assert.strictEqual(other.ok, false, 'another agent does not pass on a holder\'s lease');
    assert.strictEqual(other.code, 'DEVICE_NOT_GRANTED');
    assert.ok(/allowed to a-name, not to you/.test(other.error), other.error);
    assert.strictEqual(other.holder.agentId, 'a');
    assert.strictEqual(dc.check(tgt, act, { sessionId: 'bbbbbbbb-0000-4000-8000-000000000002' }).ok, false);
    for (const unknown of [null, {}, { agentId: '' }, { agentId: '  ', sessionId: '' }, 'a']) {
        const v = dc.check(tgt, act, unknown);
        assert.strictEqual(v.ok, false, JSON.stringify(unknown));
        assert.strictEqual(v.code, 'DEVICE_CALLER_UNKNOWN', JSON.stringify(unknown));
    }
    // a call site from before S3 (no caller argument at all) keeps the old rule until deviceAdb passes one; an empty caller is refused
    assert.strictEqual(dc.check(tgt, act).ok, true, 'legacy call site (no caller argument): old rule');
    assert.strictEqual(dc.check(tgt, act, {}).code, 'DEVICE_CALLER_UNKNOWN', 'a caller naming nobody: fail closed');
    assert.strictEqual(dc.check(tgt, act, { human: true }).ok, true, 'Yukimi\'s own UI action (set by server code only)');
    assert.strictEqual(dc.check(tgt, act, { human: 'true' }).code, 'DEVICE_CALLER_UNKNOWN', 'only the boolean true counts');
    // pending / no lease: the caller does not matter, the old codes stay
    dq.release('a', 'a53');
    assert.strictEqual(dc.check(tgt, act, { agentId: 'a' }).code, 'DEVICE_NOT_GRANTED');
    const p = dq.request('b', 'a53', { why: 'pending' });
    assert.strictEqual(p.consent, 'pending');
    assert.strictEqual(dc.check(tgt, act).code, 'DEVICE_PENDING');
    assert.strictEqual(dc.check(tgt, act, { agentId: 'a' }).code, 'DEVICE_PENDING');
    clearDevice('a53');
});

t('S3: a read-only command without a lease needs no caller (readOnly allow), a write does', () => {
    clearDevice('a53'); wipe(); reset({ readOnly: 'allow' });
    assert.strictEqual(dc.check({ deviceId: 'a53' }, { kind: 'shell', command: 'dumpsys battery' }).ok, true);
    assert.strictEqual(dc.check({ deviceId: 'a53' }, { kind: 'shell', command: 'input tap 1 1' }, { agentId: 'a' }).code, 'DEVICE_NOT_GRANTED');
    reset();
});

t('S11: a pending ask whose agent died is swept by one timer within the window (no poke needed), notice picture cleared', async () => {
    clearDevice('a53'); wipe(); reset();
    agent('dead1');
    const dead = store.getAgent('dead1').pid;
    dc._setPendingSweepMs(200);
    let sweeps = 0;
    const realSweep = dq.sweep;
    dq.sweep = (...a) => { sweeps += 1; return realSweep.apply(dq, a); };
    try {
        const r = dq.request('dead1', 'a53', { why: 'dies waiting' });
        assert.strictEqual(r.consent, 'pending');
        alive.delete(dead); // the agent session dies and its MCP process never pokes again
        assert.strictEqual(row(r.lease.id).state, 'held');
        await sleep(1500); // the timer is floored at 1 s
        assert.strictEqual(row(r.lease.id).state, 'expired', 'swept by the server timer');
        assert.ok(/session/.test(row(r.lease.id).end_reason), row(r.lease.id).end_reason);
        assert.ok(sweeps >= 1);
        assert.strictEqual(lastSync().snapshot.asks.length, 0, 'its notice picture was cleared');
        // a live ask keeps one timer going: it sweeps again while pending
        const live = dq.request('a', 'a53', { why: 'alive and waiting' });
        assert.strictEqual(live.consent, 'pending');
        sweeps = 0;
        await sleep(2400);
        assert.ok(sweeps >= 2, `re-armed while an ask is pending (sweeps ${sweeps})`);
        assert.strictEqual(row(live.lease.id).consent, 'pending', 'a live ask is never dropped');
        dq.release('a', 'a53');
        sweeps = 0;
        await sleep(1500);
        assert.strictEqual(sweeps, 0, 'no ask pending: no timer');
        // an ask already older than the window (found at a server start): one sweep soon, then one per window - never a loop
        dc._reset();
        dc._setPendingSweepMs(5000);
        const old = dq.request('a', 'a53', { why: 'old ask' });
        store.open().prepare('UPDATE device_queue SET consent_at = ? WHERE id = ?').run(Date.now() - 60 * 60000, old.lease.id);
        dc.resync();
        sweeps = 0;
        await sleep(2600);
        assert.strictEqual(sweeps, 1, `one sweep for an old ask, not a 1 s loop (sweeps ${sweeps})`);
        dq.release('a', 'a53');
    } finally {
        dq.sweep = realSweep;
        dc._setPendingSweepMs(0);
        alive.add(dead);
    }
});

t('S11: the MCP change hook poke retries twice with 1 s / 4 s backoff (test: scaled), only while no later poke got through', async () => {
    const keep = setInterval(() => {}, 50); // the retry timers are unref'd (the MCP process lives on its stdin); the test needs the loop alive
    const calls = [];
    let fails = 2;
    const ask = async (req) => { calls.push(Date.now()); if (fails > 0) { fails -= 1; throw new Error('ECONNREFUSED'); } return { ok: true }; };
    assert.deepStrictEqual(mcp._pokeServer && 1, 1, 'exported for the test');
    const t0 = Date.now();
    assert.strictEqual(await mcp._pokeServer('a53', { ask, delays: [40, 80] }), true);
    assert.strictEqual(calls.length, 3, 'one try and two retries');
    assert.ok(calls[1] - calls[0] >= 35 && calls[2] - calls[1] >= 75, 'with backoff');
    // gives up after the retries
    calls.length = 0; fails = 99;
    assert.strictEqual(await mcp._pokeServer('a53', { ask, delays: [10, 20] }), false);
    assert.strictEqual(calls.length, 3);
    // a later poke that got through covers an earlier one: no more retries for it
    calls.length = 0; fails = 1;
    const first = mcp._pokeServer('a53', { ask, delays: [60, 120] }); // fails, waits 60 ms
    await sleep(5);
    assert.strictEqual(await mcp._pokeServer('fold', { ask, delays: [60, 120] }), true); // gets through
    assert.strictEqual(await first, false);
    assert.strictEqual(calls.length, 2, 'the first poke did not retry');
    // the real defaults are 1 s and 4 s
    const src = fs.readFileSync(path.join(__dirname, '..', 'modules', 'agentCoord', 'mcpServer.js'), 'utf8');
    assert.ok(/POKE_DELAYS_MS = \[1000, 4000\]/.test(src));
    assert.ok(Date.now() - t0 < 2000);
    clearInterval(keep);
});

t('S13: read-only shell: dumpsys only for allowlisted services without flags; every injection stays refused', () => {
    const ro = dc.isReadOnlyShell;
    ['dumpsys battery', 'dumpsys window', 'dumpsys window windows', 'dumpsys window displays | grep mCurrentFocus', 'dumpsys display', 'dumpsys activity activities', 'dumpsys notification', 'dumpsys power', 'dumpsys SurfaceFlinger',
        'dumpsys battery | grep level', 'ip addr show wlan0', 'ip route', 'ls | tail -n 5', 'ls | grep -F foo', 'ls | cut -d: -f2'].forEach((c) => assert.strictEqual(ro(c), true, c));
    ['dumpsys procstats --clear', 'dumpsys sensorservice restrict com.x', 'dumpsys batterystats --reset', 'dumpsys battery set level 5', 'dumpsys battery reset', 'dumpsys activity broadcasts', 'dumpsys activity service x',
        'dumpsys deviceidle force-idle', 'dumpsys gfxinfo com.x reset', 'dumpsys', 'dumpsys window --proto', 'dumpsys window windows foo', 'dumpsys notification --noredact', 'dumpsys SurfaceFlinger --latency-clear',
        'dumpsys media_session', 'ip addr flush', 'ip route flush', 'ip link set wlan0 down', 'ls | tail -f', 'ls | grep -f /x', 'ls | grep -rn x /data', 'dumpsys battery;reboot', 'dumpsys battery && input tap 1 1', 'dumpsys battery | sh', 'dumpsys battery > /sdcard/x', 'dumpsys $(reboot)', 'dumpsys battery `reboot`', 'dumpsys battery\nreboot', 'dumpsys battery &'
    ].forEach((c) => assert.strictEqual(ro(c), false, JSON.stringify(c)));
    ['input tap 1 1', 'settings put global x 1', 'ls; reboot', 'ls > /x', 'ls $(reboot)', 'cat /proc/../data/x', 'pm uninstall com.x'].forEach((c) => assert.strictEqual(ro(c), false, c));
});

t('S14: the emulator bypass is the adb serial or a model string, never the free-form name', () => {
    clearDevice('a53'); wipe(); reset();
    const emu = dc.isEmulatorTarget;
    assert.strictEqual(emu({ deviceId: 'emulator-5554' }), true);
    assert.strictEqual(emu({ deviceId: 'Emulator-5580', name: 'x' }), true);
    ['sdk_gphone64_x86_64', 'Ranchu', 'goldfish', 'aemu-fold-1', 'google_sdk'].forEach((m) => assert.strictEqual(emu({ deviceId: 'abc', model: m }), true, m));
    ['emulator', 'my emulator', 'AVD phone', 'aemu', 'Fold emulator', 'goldfish phone'].forEach((nm) => assert.strictEqual(emu({ deviceId: '192.168.1.5:5555', name: nm, model: 'SM-F966' }), false, `name ${nm}`));
    assert.strictEqual(emu({ deviceId: 'emulator', name: 'emulator' }), false, 'a serial must be emulator-NNNN');
    // a real phone called "emulator" does not skip the gate
    const real = dc.check({ deviceId: 'R5CT1', name: 'Galaxy A53 emulator', model: 'SM-A536B' }, { kind: 'shell', command: 'input tap 1 1' }, { agentId: 'a' });
    assert.strictEqual(real.ok, false);
    assert.strictEqual(real.code, 'DEVICE_NOT_GRANTED');
    assert.ok(!real.emulator);
    const unknown = dc.check({ deviceId: 'abc123', name: 'emulator', model: 'Pixel 8' }, { kind: 'shell', command: 'id' }, { agentId: 'a' });
    assert.strictEqual(unknown.ok, false, 'an unlisted phone named emulator is closed');
});

t('S17: the tool descriptions and server instructions state the real rule (Fold off limits, A53 test phone, emulators the test lane)', () => {
    const tool = (n) => mcp.TOOLS.find((x) => x.name === n);
    const ins = mcp.INSTRUCTIONS;
    assert.ok(/Fold is Yukimi\'s own phone and OFF LIMITS/.test(ins) && /final-install/.test(ins) && /fold-off-limits/.test(ins), 'instructions: the Fold');
    assert.ok(/A53 is your own test phone/.test(ins) && /emulators are the test lane/.test(ins) && /without asking Yukimi/.test(ins), 'instructions: the A53 and the emulators');
    assert.ok(!/A53 phone, Fold,/.test(ins), 'no a53 / fold in one breath');
    assert.ok(!/(a53, fold, any phone Yukimi listed) also needs her consent/.test(ins), 'the old a53 / fold wait-for-Allow rule is gone');
    assert.ok(!/wait for Allow on the phone/i.test(ins));
    const req = tool('coord_device_request');
    assert.ok(/off limits/.test(req.description) && /final-install/.test(req.description) && /test lane/.test(req.description) && /never ask Yukimi/.test(req.description));
    assert.ok(/consent pending/.test(req.description) && /do NOT touch/i.test(req.description));
    assert.ok(!/a53 \| fold/.test(JSON.stringify(req.inputSchema)), 'the device argument no longer lists fold as a normal choice');
    assert.ok(/waits for an Allow/.test(tool('coord_device_renew').description));
});

(async () => {
    let n = 0;
    for (const x of tests) {
        try {
            await x.fn();
            n += 1;
            console.log(`ok - ${x.name}`);
        } catch (e) {
            console.log(`FAIL - ${x.name}\n${e && e.stack}`);
            process.exitCode = 1;
            break;
        }
    }
    dc._reset();
    console.log(process.exitCode ? `${n}/${tests.length} tests passed` : `${n} tests passed`);
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
})();
