#!/usr/bin/env node
'use strict';
process.env.DEVICE_QUEUE_TEST_PHONES = '1'; // these tests model the phones; the server refuses physical phones to agents

/**
 * modules/agentCoord/deviceQueue.js: grant, FIFO order, release handing on with a steer message, expiry by
 * time, by a gone session and by idleness, renew, releaseAgent, aliases, and the MCP tool round trip.
 * Consent for phones is switched off here (settings consentDevices empty); see test-device-consent.js.
 *
 *   node scripts/test-device-queue.js
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'devq-'));
process.env.AGENT_COORD_DB = path.join(tmp, 'coord.db');
process.env.DREAMSCAPE_CLAUDE_HOME = tmp;
fs.mkdirSync(path.join(tmp, '.claude', 'sessions'), { recursive: true });

const store = require('../modules/agentCoord/store');
const dq = require('../modules/agentCoord/deviceQueue');
// this test is about the queue itself: phones asking Yukimi for consent (#1284) is scripts/test-device-consent.js
store.setSetting('deviceConsent', { consentDevices: [] });
const mcp = require('../modules/agentCoord/mcpServer');

let n = 0;
function t(name, fn) { fn(); n += 1; console.log(`ok - ${name}`); }
const asyncTests = [];
function at(name, fn) { asyncTests.push([name, fn]); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const alive = new Set();
store._setPidAlive((pid) => alive.has(pid));
let pid = 5000;
function agent(id, extra = {}) {
    pid += 1;
    alive.add(pid);
    store.upsertAgent(Object.assign({ id, kind: 'other', name: id, pid, status: 'active' }, extra));
    return pid;
}
const steers = [];
const testNotifier = (a, body) => { steers.push({ to: a.id, body }); return 'test'; };
dq.setNotifier(testNotifier);
const steerTo = (id) => store.recentMessages({ limit: 100 }).filter((m) => m.to === id && m.kind === 'steer');
const q = (d) => dq.status(d).devices[0];

const pidA = agent('a'); agent('b'); agent('c');

t('aliases and normalising', () => {
    assert.strictEqual(dq.normalise(' Samsung-A53 '), 'a53');
    assert.strictEqual(dq.normalise('Ruiko'), 'ruiko-chrome');
    assert.strictEqual(dq.normalise('Headless Chrome'), 'headless-chrome');
    assert.strictEqual(dq.normalise('My Board'), 'my-board');
    assert.throws(() => dq.normalise('  '));
});

t('first request is granted with a lease', () => {
    const r = dq.request('a', 'A53', { why: 'tap test', minutes: 20 });
    assert.strictEqual(r.granted, true);
    assert.strictEqual(r.device, 'a53');
    assert.strictEqual(r.lease.minutes, 20);
    assert.ok(r.lease.endsAt > Date.now() + 19 * 60000);
    assert.strictEqual(q('a53').holder.agentId, 'a');
});

t('minutes default 15 and cap 60', () => {
    assert.strictEqual(dq.request('a', 'fold', {}).lease.minutes, 15);
    assert.strictEqual(dq.request('a', 'fold', { minutes: 500 }).lease.minutes, 60);
    dq.release('a', 'fold');
});

t('others queue in FIFO order with position, holder and eta', () => {
    const rb = dq.request('b', 'a53', { why: 'install' });
    assert.strictEqual(rb.granted, false);
    assert.strictEqual(rb.position, 1);
    assert.strictEqual(rb.holder.agentId, 'a');
    assert.ok(rb.eta >= q('a53').holder.endsAt);
    const rc = dq.request('c', 'a53', { why: 'screens', minutes: 5 });
    assert.strictEqual(rc.position, 2);
    assert.ok(rc.eta >= rb.eta + 15 * 60000 - 1000);
    assert.strictEqual(dq.request('b', 'a53', {}).position, 1, 'asking again keeps the place');
    assert.deepStrictEqual(q('a53').queue.map((x) => x.agentId), ['b', 'c']);
});

t('release hands to the next with a steer message', () => {
    const r = dq.release('a', 'a53');
    assert.strictEqual(r.next, 'b');
    assert.strictEqual(q('a53').holder.agentId, 'b');
    const m = steerTo('b').pop();
    assert.ok(m && /Device a53 is yours until \d\d:\d\d \(install\)/.test(m.body) && /coord_device_release/.test(m.body), m && m.body);
    assert.ok(steers.some((s) => s.to === 'b'));
    assert.strictEqual(m.delivered, 'test');
    assert.deepStrictEqual(q('a53').queue.map((x) => x.agentId), ['c']);
});

t('renew extends the lease; a non-holder cannot renew', () => {
    const before = q('a53').holder.endsAt;
    const r = dq.renew('b', 'a53', 40);
    assert.ok(r.lease.endsAt > before + 20 * 60000);
    assert.throws(() => dq.renew('c', 'a53', 5), /do not hold/);
});

t('expiry by time hands on', () => {
    store.open().prepare("UPDATE device_queue SET ends_at = ? WHERE device = 'a53' AND state = 'held'").run(Date.now() - 1000);
    const s = q('a53');
    assert.strictEqual(s.holder.agentId, 'c');
    assert.strictEqual(s.queue.length, 0);
    assert.ok(steerTo('c').some((m) => /Device a53 is yours/.test(m.body)));
});

t('expiry when the holder session is gone', () => {
    dq.release('c', 'a53');
    dq.request('a', 'fold', { why: 'x' });
    dq.request('b', 'fold', { why: 'y' });
    alive.delete(pidA);
    assert.strictEqual(q('fold').holder.agentId, 'b');
    assert.ok(steerTo('b').some((m) => /Device fold is yours/.test(m.body)));
    alive.add(pidA);
});

t('expiry when the holder is idle for 10 minutes', () => {
    dq.release('b', 'fold');
    store.upsertAgent({ id: 'a', status: 'idle' });
    dq.request('a', 'ruiko', {});
    dq.request('b', 'ruiko', {});
    assert.strictEqual(q('ruiko-chrome').holder.agentId, 'a', 'just idle is fine');
    store.open().prepare("UPDATE agents SET seen_at = ? WHERE id = 'a'").run(Date.now() - 11 * 60000);
    store.open().prepare("UPDATE device_queue SET started_at = ? WHERE agent_id = 'a' AND state = 'held'").run(Date.now() - 11 * 60000);
    assert.strictEqual(q('ruiko-chrome').holder.agentId, 'b');
    store.upsertAgent({ id: 'a', status: 'active' });
    dq.release('b', 'ruiko-chrome');
});

t('a waiter whose session is gone is skipped', () => {
    dq.request('a', 'headless', {});
    dq.request('b', 'headless', {});
    dq.request('c', 'headless', {});
    store.setStatus('b', 'gone');
    dq.release('a', 'headless');
    assert.strictEqual(q('headless-chrome').holder.agentId, 'c');
    dq.release('c', 'headless-chrome');
    store.upsertAgent({ id: 'b', status: 'active' });
});

t('releaseAgent frees every lease and queue place, handing on', () => {
    dq.request('a', 'a53', {});
    dq.request('a', 'fold', {});
    dq.request('b', 'a53', {});
    dq.request('c', 'fold', {});
    dq.request('c', 'a53', {});
    assert.strictEqual(dq.releaseAgent('a'), 2);
    assert.strictEqual(q('a53').holder.agentId, 'b');
    assert.strictEqual(q('fold').holder.agentId, 'c');
    assert.strictEqual(dq.releaseAgent('c'), 2);
    assert.strictEqual(q('a53').queue.length, 0);
    assert.strictEqual(q('fold').holder, null);
    dq.release('b', 'a53');
});

t('forceRelease (Fleet) frees a stuck device and tells the holder', () => {
    dq.request('a', 'a53', {});
    dq.request('b', 'a53', {});
    const r = dq.forceRelease('a53', 'Yukimi');
    assert.strictEqual(r.next, 'b');
    assert.ok(steerTo('a').some((m) => /ended by Yukimi/.test(m.body)));
    dq.release('b', 'a53');
});

t('status lists the known devices and a custom one in use', () => {
    dq.request('a', 'board-7', { why: 'flash' });
    const ids = dq.status().devices.map((d) => d.device);
    ['a53', 'fold', 'ruiko-chrome', 'headless-chrome', 'board-7'].forEach((d) => assert.ok(ids.includes(d), d));
    dq.release('a', 'board-7');
    assert.ok(!dq.status().devices.some((d) => d.device === 'board-7'));
});

t('MCP tools round trip', () => {
    process.env.AGENT_COORD_ID = 'a';
    alive.add(process.ppid);
    const names = mcp.TOOLS.map((x) => x.name);
    ['coord_device_request', 'coord_device_release', 'coord_device_renew', 'coord_devices'].forEach((x) => {
        assert.ok(names.includes(x), x);
        const tool = mcp.TOOLS.find((y) => y.name === x);
        assert.ok(/device/i.test(tool.description), x);
    });
    assert.ok(/BEFORE any test, install, reboot, screenshot run or tap-through/.test(mcp.TOOLS.find((x) => x.name === 'coord_device_request').description));
    const r = mcp.run('coord_device_request', { device: 'fold', why: 'mcp', minutes: 5 });
    assert.strictEqual(r.granted, true);
    const s = mcp.run('coord_devices', { device: 'fold' });
    assert.strictEqual(s.devices[0].holder.agentId, 'a');
    assert.strictEqual(mcp.run('coord_device_renew', { device: 'fold', minutes: 30 }).renewed, true);
    assert.strictEqual(mcp.run('coord_device_release', { device: 'fold' }).released, true);
    assert.strictEqual(mcp.run('coord_devices', {}).holding, 0);
});


// ---------------------------------------------------------------- #1305 server consent core

const msgs = (id) => store.recentMessages({ limit: 200 }).filter((m) => m.to === id && m.kind === 'steer');
const pidOf = (id) => store.getAgent(id).pid;

t('S6: a lease that ends by expiry or loss of its session tells its holder; a normal release says nothing', () => {
    ['a', 'b', 'c'].forEach((id) => dq.releaseAgent(id));
    const before = msgs('a').length;
    dq.request('a', 'headless-chrome', { why: 's6' });
    dq.release('a', 'headless-chrome');
    assert.strictEqual(msgs('a').length, before, 'a normal release is silent');
    dq.request('a', 'headless-chrome', { why: 's6' });
    store.open().prepare("UPDATE device_queue SET ends_at = ? WHERE agent_id = 'a' AND device = 'headless-chrome' AND state = 'held'").run(Date.now() - 1000);
    dq.status('headless-chrome');
    let m = msgs('a').pop();
    assert.ok(m && /Your lease on device headless-chrome ended \(lease ran out\)/.test(m.body), m && m.body);
    // the session is gone
    dq.request('b', 'headless-chrome', { why: 's6b' });
    const pb = pidOf('b');
    alive.delete(pb);
    dq.status('headless-chrome');
    alive.add(pb);
    store.upsertAgent({ id: 'b', status: 'active' });
    m = msgs('b').pop();
    assert.ok(m && /ended \(its session (is gone|ended)\)/.test(m.body), m && m.body);
    // a pending ask whose agent is gone
    store.setSetting('deviceConsent', { consentDevices: ['a53'] });
    const r = dq.request('c', 'a53', { why: 'pending then gone' });
    assert.strictEqual(r.consent, 'pending');
    const pc = pidOf('c');
    alive.delete(pc);
    dq.status('a53');
    alive.add(pc);
    store.upsertAgent({ id: 'c', status: 'active' });
    m = msgs('c').pop();
    assert.ok(/Your request for device a53 ended \(its session (is gone|ended)\) before Yukimi answered/.test(m.body), m.body);
    store.setSetting('deviceConsent', { consentDevices: [] });
});

at('S7: an async notifier marks the steer delivered only once it succeeded; a failure leaves it unread', async () => {
    ['a', 'b', 'c'].forEach((id) => dq.releaseAgent(id));
    const mine = (id) => msgs(id).pop();
    dq.setNotifier(async () => { await sleep(40); return 'tmux'; });
    dq.request('a', 'headless-chrome', {});
    dq.request('b', 'headless-chrome', { why: 's7 ok' });
    dq.release('a', 'headless-chrome');
    assert.ok(!mine('b').delivered, 'not delivered before the steer ran');
    await sleep(120);
    assert.strictEqual(mine('b').delivered, 'tmux');
    dq.release('b', 'headless-chrome');
    dq.setNotifier(async () => { await sleep(10); throw new Error('NEEDS_TAKEOVER'); });
    dq.request('a', 'headless-chrome', {});
    dq.request('b', 'headless-chrome', { why: 's7 fail' });
    const unreadBefore = store.unreadCount('b');
    dq.release('a', 'headless-chrome');
    await sleep(80);
    assert.ok(!mine('b').delivered, 'a failed steer is not delivered');
    assert.ok(store.unreadCount('b') >= unreadBefore, 'it stays unread for coord_inbox');
    dq.setNotifier(async () => '');
    dq.release('b', 'headless-chrome');
    dq.request('a', 'headless-chrome', {});
    dq.request('b', 'headless-chrome', { why: 's7 empty' });
    dq.release('a', 'headless-chrome');
    await sleep(40);
    assert.ok(!mine('b').delivered, "'' means not delivered");
    dq.release('b', 'headless-chrome');
    dq.setNotifier(testNotifier);
});

at('S7: the desk notifier (314) awaits launcher.steer and reports failure instead of marking delivered first', async () => {
    const desk = require('../modules/ws/handlers/314-claudeDeskHandler'); // sets its own notifier: ours is put back below
    const launcher = require('../modules/claudeSessionLauncher');
    const realSteer = launcher.steer;
    const calls = [];
    try {
        let mode = 'ok';
        launcher.steer = async (id, text) => { calls.push([id, text]); await sleep(30); if (mode === 'fail') throw Object.assign(new Error('Not sent: the session is showing a question'), { code: 'SESSION_DIALOG' }); return { sent: true }; };
        assert.strictEqual(await desk._steerNotifier(null, 'x'), '');
        assert.strictEqual(await desk._steerNotifier({ id: 'z' }, 'x'), '', 'no session: not delivered');
        const p = desk._steerNotifier({ id: 'z', sessionId: 'sess-1' }, 'hello');
        assert.ok(p && typeof p.then === 'function', 'a promise: the steer has not finished when it returns');
        assert.strictEqual(await p, 'tmux');
        assert.ok(/^\[steering from agent-coord\] hello$/.test(calls[0][1]), calls[0][1]);
        mode = 'fail';
        assert.strictEqual(await desk._steerNotifier({ id: 'z', sessionId: 'sess-1' }, 'hello'), '');
        // through the queue: the message stays unread when the steer fails, and is delivered when it works
        store.upsertAgent({ id: 'd', kind: 'other', name: 'd', pid: pidOf('a'), status: 'active', sessionId: 'sess-d' });
        dq.setNotifier(desk._steerNotifier);
        dq.request('a', 'headless-chrome', {});
        dq.request('d', 'headless-chrome', { why: 'desk fail' });
        dq.release('a', 'headless-chrome');
        const failedMsg = msgs('d').pop();
        await sleep(100);
        assert.ok(!msgs('d').find((m) => m.id === failedMsg.id).delivered, 'a failed steer leaves the message unread');
        dq.release('d', 'headless-chrome');
        mode = 'ok';
        dq.request('a', 'headless-chrome', {});
        dq.request('d', 'headless-chrome', { why: 'desk ok' });
        dq.release('a', 'headless-chrome');
        const okMsg = msgs('d').pop();
        assert.ok(!msgs('d').find((m) => m.id === okMsg.id).delivered, 'not marked before the steer ran');
        await sleep(100);
        assert.strictEqual(msgs('d').find((m) => m.id === okMsg.id).delivered, 'tmux');
        dq.release('d', 'headless-chrome');
    } finally {
        launcher.steer = realSteer;
        dq.setNotifier(testNotifier);
    }
});

t('S12: after Yukimi denies an agent, the same agent may not ask for the same phone for 10 minutes', () => {
    ['a', 'b', 'c'].forEach((id) => dq.releaseAgent(id));
    store.open().prepare("UPDATE device_queue SET state = 'cancelled' WHERE state IN ('held', 'waiting')").run();
    store.setSetting('deviceConsent', { consentDevices: ['a53'] });
    const r = dq.request('a', 'a53', { why: 'first ask' });
    assert.strictEqual(r.consent, 'pending');
    assert.strictEqual(dq.setConsent(r.lease.id, 'denied', 'household:x').ok, true);
    assert.throws(() => dq.request('a', 'a53', { why: 'again' }), /Yukimi denied your request for A53 phone .* Do not ask again for 10 minutes: ask her in chat first/);
    assert.strictEqual(store.open().prepare("SELECT COUNT(*) n FROM device_queue WHERE agent_id = 'a' AND state IN ('held', 'waiting')").get().n, 0, 'nothing was queued');
    assert.strictEqual(dq.request('b', 'a53', { why: 'another agent' }).consent, 'pending', 'another agent is not held back');
    dq.release('b', 'a53');
    assert.strictEqual(dq.request('a', 'headless-chrome', {}).granted, true, 'another device is not held back');
    dq.release('a', 'headless-chrome');
    // a timeout denial is not Yukimi saying no
    store.open().prepare("UPDATE device_queue SET ended_at = ? WHERE agent_id = 'a' AND state = 'denied'").run(Date.now() - 11 * 60000);
    const r2 = dq.request('a', 'a53', { why: 'after ten minutes' });
    assert.strictEqual(r2.consent, 'pending', 'ten minutes later it may ask again');
    assert.strictEqual(dq.setConsent(r2.lease.id, 'denied', 'timeout').ok, true);
    assert.strictEqual(dq.request('a', 'a53', { why: 'after a timeout' }).consent, 'pending', 'no answer in time is not a no');
    dq.release('a', 'a53');
    store.setSetting('deviceConsent', { consentDevices: [] });
});

t('S16: setConsent writes only while the ask is still held and pending: a lost race answers "not pending"', () => {
    store.open().prepare("UPDATE device_queue SET state = 'cancelled' WHERE state IN ('held', 'waiting')").run();
    store.setSetting('deviceConsent', { consentDevices: ['a53'] });
    const d = store.open();
    const mk = (agent) => { const r = dq.request(agent, 'a53', { why: 's16' }); assert.strictEqual(r.consent, 'pending'); return r.lease.id; };
    // another process answered between our read and our write: the UPDATE matches nothing (modelled by a trigger that skips it)
    let id = mk('a');
    const steersBefore = steerTo('a').length;
    d.exec("CREATE TEMP TRIGGER race_skip BEFORE UPDATE ON device_queue WHEN OLD.consent = 'pending' BEGIN SELECT RAISE(IGNORE); END");
    let r = dq.setConsent(id, 'allowed', 'household:x');
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.error, 'That ask is no longer pending');
    r = dq.setConsent(id, 'denied', 'household:x');
    assert.strictEqual(r.ok, false);
    d.exec('DROP TRIGGER race_skip');
    const row = d.prepare('SELECT * FROM device_queue WHERE id = ?').get(id);
    assert.strictEqual(row.consent, 'pending');
    assert.strictEqual(row.state, 'held');
    assert.strictEqual(steerTo('a').length, steersBefore, 'no steer for a lost race');
    // the same without a race: it works once, and a second answer is "not pending"
    assert.strictEqual(dq.setConsent(id, 'allowed', 'household:x').ok, true);
    assert.strictEqual(dq.setConsent(id, 'allowed', 'household:x').ok, false);
    assert.strictEqual(dq.setConsent(id, 'denied', 'household:x').ok, false);
    dq.release('a', 'a53');
    store.setSetting('deviceConsent', { consentDevices: [] });
});

t('S2: forceRelease with a lease id ends only that lease while it is the held, allowed one', () => {
    store.open().prepare("UPDATE device_queue SET state = 'cancelled' WHERE state IN ('held', 'waiting')").run();
    store.setSetting('deviceConsent', { consentDevices: ['a53'] });
    const a = dq.request('a', 'a53', { why: 'A' });
    dq.setConsent(a.lease.id, 'allowed', 'h');
    dq.request('b', 'a53', { why: 'B' });
    dq.release('a', 'a53'); // B is a pending ask now
    const bId = dq.snapshotConsent().asks[0].leaseId;
    const stale = dq.forceRelease('a53', 'household:x', { leaseId: a.lease.id });
    assert.strictEqual(stale.released, false, 'the stale lease is not the held one');
    assert.strictEqual(dq.forceRelease('a53', 'household:x', { leaseId: bId }).released, false, 'a pending ask is not an allowed hold');
    assert.strictEqual(dq.snapshotConsent().asks.length, 1, 'B untouched');
    assert.ok(!msgs('b').some((m) => /was ended by/.test(m.body)), 'B was not told it was ended');
    dq.setConsent(bId, 'allowed', 'h');
    assert.strictEqual(dq.forceRelease('a53', 'household:x', { leaseId: bId }).released, true);
    store.setSetting('deviceConsent', { consentDevices: [] });
});

t('S1: a test-lane device (settings testConsentDevices) asks like a phone, on the test lane; the Fold and the browsers can never be one', () => {
    store.open().prepare("UPDATE device_queue SET state = 'cancelled' WHERE state IN ('held', 'waiting')").run();
    const prev = process.env.DEVICE_QUEUE_TEST_PHONES;
    delete process.env.DEVICE_QUEUE_TEST_PHONES; // the server's own rules: the a53 never asks, the Fold is off limits
    try {
        store.setSetting('deviceConsent', { consentDevices: ['fold'] });
        assert.strictEqual(dq.needsConsent('emulator-5554'), false, 'off by default');
        assert.strictEqual(dq.needsConsent('a53'), false);
        assert.strictEqual(dq.isTestLane('a53'), false);
        assert.strictEqual(dq.request('a', 'emulator-5554', { why: 'plain' }).granted, true, 'nothing changes while the list is empty');
        dq.release('a', 'emulator-5554');
        store.setSetting('deviceConsent', { consentDevices: ['fold'], testConsentDevices: ['emulator-5554', 'a53', 'aemu-fold-1', 'fold', 'ruiko'] });
        assert.deepStrictEqual(['emulator-5554', 'a53', 'aemu-fold-1'].map((d) => dq.isTestLane(d)), [true, true, true]);
        assert.strictEqual(dq.isTestLane('fold'), false, 'the Fold is never a test device');
        assert.strictEqual(dq.isTestLane('ruiko-chrome'), false, 'a test browser never asks');
        assert.strictEqual(dq.needsConsent('a53'), true, 'the a53 on the test lane asks (test lane only)');
        assert.strictEqual(dq.needsConsent('ruiko-chrome'), false);
        const r = dq.request('a', 'emulator-5554', { why: 'lane' });
        assert.strictEqual(r.consent, 'pending');
        const snap = dq.snapshotConsent();
        assert.strictEqual(snap.asks.length, 1);
        assert.strictEqual(snap.asks[0].lane, 'test');
        dq.setConsent(r.lease.id, 'allowed', 'h');
        assert.strictEqual(dq.snapshotConsent().holds[0].lane, 'test');
        dq.release('a', 'emulator-5554');
        // a normal phone's ask has no lane
        store.setSetting('deviceConsent', { consentDevices: ['pixel-9'], testConsentDevices: ['emulator-5554'] });
        const n = dq.request('a', 'pixel-9', { why: 'household' });
        assert.strictEqual(n.consent, 'pending');
        assert.strictEqual(dq.snapshotConsent().asks[0].lane, undefined);
        dq.release('a', 'pixel-9');
    } finally {
        if (prev !== undefined) process.env.DEVICE_QUEUE_TEST_PHONES = prev;
        store.setSetting('deviceConsent', { consentDevices: [] });
    }
});

// ---- shape aliases (aemu-a53, aemu-fold, emulator): a free instance at once, a queue on the shape only when all are held
function shapeFixture() {
    store.open().prepare("UPDATE device_queue SET state = 'cancelled' WHERE state IN ('held', 'waiting')").run();
    store.setSetting('deviceConsent', { consentDevices: [] });
    ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'].forEach((id) => agent(id));
}

t('shape alias: aemu-a53 grants the first free instance and names it', () => {
    shapeFixture();
    assert.deepStrictEqual(dq.EMULATOR_IDS.filter((i) => i.startsWith('aemu-a53-')), ['aemu-a53-1', 'aemu-a53-2', 'aemu-a53-3', 'aemu-a53-4']);
    const r = dq.request('s1', 'aemu-a53', { why: 'shape', minutes: 10 });
    assert.strictEqual(r.granted, true);
    assert.strictEqual(r.device, 'aemu-a53-1');
    assert.strictEqual(r.instance, 'aemu-a53-1');
    assert.strictEqual(r.shape, 'aemu-a53');
    assert.strictEqual(r.lease.minutes, 10);
    assert.strictEqual(q('aemu-a53-1').holder.agentId, 's1');
});

t('shape alias: the second request gets the next free instance; a repeat renews the same one', () => {
    const r = dq.request('s2', 'aemu-a53', { why: 'second' });
    assert.strictEqual(r.granted, true);
    assert.strictEqual(r.instance, 'aemu-a53-2');
    const again = dq.request('s1', 'aemu-a53', { why: 'again', minutes: 20 });
    assert.strictEqual(again.instance, 'aemu-a53-1');
    assert.strictEqual(again.renewed, true);
    assert.strictEqual(q('aemu-a53-3').holder, null);
    assert.strictEqual(dq.request('s3', 'aemu-a53', {}).instance, 'aemu-a53-3');
    assert.strictEqual(dq.request('s4', 'aemu-a53', {}).instance, 'aemu-a53-4');
});

t('shape alias: all instances held -> queued on the shape, FIFO, answer shows position and holders', () => {
    const r = dq.request('s5', 'aemu-a53', { why: 'waits', minutes: 7 });
    assert.strictEqual(r.granted, false);
    assert.strictEqual(r.shape, 'aemu-a53');
    assert.strictEqual(r.position, 1);
    assert.strictEqual(r.holders.length, 4);
    assert.ok(r.holder && /^aemu-a53-\d$/.test(r.holder.instance));
    const r6 = dq.request('s6', 'aemu-a53', { why: 'waits too' });
    assert.strictEqual(r6.position, 2);
    assert.strictEqual(dq.request('s5', 'aemu-a53', {}).position, 1, 'asking again keeps the place');
    const st = q('aemu-a53');
    assert.deepStrictEqual(st.queue.map((x) => x.agentId), ['s5', 's6']);
    assert.ok(/aemu-a53|A53 emulator/.test(st.label));
    // the Fold shape and an exact id of another shape are unaffected
    assert.strictEqual(dq.request('s7', 'aemu-fold', {}).instance, 'aemu-fold-1');
});

t('shape alias: a release of any instance grants the first shape waiter and steers it with the instance id', () => {
    const before = steerTo('s5').length;
    const rel = dq.release('s3', 'aemu-a53-3');
    assert.strictEqual(rel.released, true);
    assert.strictEqual(rel.next, 's5');
    assert.strictEqual(q('aemu-a53-3').holder.agentId, 's5');
    const sm = steerTo('s5');
    assert.strictEqual(sm.length, before + 1);
    assert.ok(/Device aemu-a53-3 is yours/.test(sm[sm.length - 1].body), sm[sm.length - 1].body);
    assert.deepStrictEqual(q('aemu-a53').queue.map((x) => x.agentId), ['s6']);
    // s6 gets the next freed instance (another one), not lost to a later request
    dq.request('s8', 'aemu-a53', { why: 'later' });
    dq.release('s1', 'aemu-a53'); // release by the shape name frees the instance the agent holds
    assert.strictEqual(q('aemu-a53-1').holder.agentId, 's6');
    assert.ok(/Device aemu-a53-1 is yours/.test(steerTo('s6').pop().body));
    assert.deepStrictEqual(q('aemu-a53').queue.map((x) => x.agentId), ['s8']);
});

t('shape alias: an earlier instance-specific waiter keeps its place; a shape waiter ahead of a later exact waiter wins', () => {
    shapeFixture();
    ['aemu-a53-1', 'aemu-a53-2', 'aemu-a53-3', 'aemu-a53-4'].forEach((i, k) => dq.request(`s${k + 1}`, i, {}));
    dq.request('s5', 'aemu-a53-2', { why: 'exact first' }); // earlier than the shape waiter
    dq.request('s6', 'aemu-a53', { why: 'shape second' });
    dq.request('s7', 'aemu-a53-1', { why: 'exact third' });
    dq.release('s1', 'aemu-a53-1'); // s6 (shape, id order) is ahead of s7 (exact on -1)
    assert.strictEqual(q('aemu-a53-1').holder.agentId, 's6');
    dq.release('s2', 'aemu-a53-2'); // s5 asked for -2 by id and is first for it
    assert.strictEqual(q('aemu-a53-2').holder.agentId, 's5');
    dq.release('s3', 'aemu-a53-3');
    assert.strictEqual(q('aemu-a53-3').holder, null, 'nobody waits on -3 or the shape');
    assert.strictEqual(q('aemu-a53-1').queue.length, 1, 's7 still waits on -1');
});

t('shape alias: "emulator" picks any shape; a waiter on it takes whichever instance frees first', () => {
    shapeFixture();
    const ids = dq.EMULATOR_IDS;
    ids.forEach((i, k) => assert.strictEqual(dq.request(`s${(k % 8) + 1}`, i, {}).granted, true));
    // eight instances held by s1..s8 (s9 and s10 free to ask)
    const r = dq.request('s9', 'emulator', { why: 'any' });
    assert.strictEqual(r.granted, false);
    assert.strictEqual(r.shape, 'emulator');
    assert.strictEqual(dq.request('s10', 'aemu-fold', { why: 'fold only' }).position, 2, 'behind the older emulator waiter');
    dq.release('s5', 'aemu-fold-1');
    assert.strictEqual(q('aemu-fold-1').holder.agentId, 's9', 'the older waiter on the generic shape wins');
    assert.deepStrictEqual(q('aemu-fold').queue.map((x) => x.agentId), ['s10']);
    // with free instances of both shapes the generic ask takes the first listed free one
    shapeFixture();
    dq.request('s1', 'aemu-a53-1', {});
    assert.strictEqual(dq.request('s2', 'emulator', {}).instance, 'aemu-a53-2');
    // leaving the shape queue
    ids.forEach((i, k) => { try { dq.request(`s${(k % 8) + 3}`, i, {}); } catch (_) { /* held */ } });
});

t('shape alias: leaving the queue, a gone waiter is skipped, and an exact instance id works as before', () => {
    shapeFixture();
    dq.EMULATOR_IDS.slice(0, 4).forEach((i, k) => dq.request(`s${k + 1}`, i, {}));
    dq.request('s5', 'aemu-a53', {});
    dq.request('s6', 'aemu-a53', {});
    assert.strictEqual(dq.release('s5', 'aemu-a53').leftQueue, true);
    assert.deepStrictEqual(q('aemu-a53').queue.map((x) => x.agentId), ['s6']);
    store.upsertAgent({ id: 's6', kind: 'other', name: 's6', status: 'gone' });
    dq.release('s2', 'aemu-a53-2');
    assert.strictEqual(q('aemu-a53-2').holder, null, 'a gone waiter does not take it');
    store.upsertAgent({ id: 's6', kind: 'other', name: 's6', pid: 1, status: 'active' });
    agent('s6');
    // exact id: held -> queue on the instance, release hands on
    assert.strictEqual(dq.request('s2', 'aemu-a53-1', {}).granted, false);
    assert.strictEqual(dq.release('s1', 'aemu-a53-1').next, 's2');
    assert.strictEqual(dq.request('s7', 'aemu-fold-3', {}).device, 'aemu-fold-3');
});

t('shape alias: status and coord_devices stay readable, per shape and overall', () => {
    shapeFixture();
    dq.EMULATOR_IDS.slice(0, 4).forEach((i, k) => dq.request(`s${k + 1}`, i, {}));
    dq.request('s5', 'aemu-a53', { why: 'queued' });
    const all = dq.status();
    assert.ok(all.devices.some((x) => x.device === 'aemu-a53' && x.queue.length === 1 && /queue on the shape/.test(x.label)));
    assert.ok(all.devices.some((x) => x.device === 'aemu-a53-1' && x.holder));
    assert.ok(!all.devices.some((x) => x.device === 'aemu-fold-1'), 'idle instances are not listed');
    const one = dq.status('aemu-a53');
    assert.strictEqual(one.devices.length, 5);
    assert.strictEqual(one.holding, 4);
    const m = mcp.run('coord_devices', { device: 'aemu-a53' });
    assert.strictEqual(m.devices.length, 5);
    const mr = mcp.run('coord_device_request', { device: 'emulator', why: 'mcp shape' });
    assert.strictEqual(mr.granted !== undefined, true);
    JSON.stringify(m);
    JSON.stringify(mr);
    store.open().prepare("UPDATE device_queue SET state = 'cancelled' WHERE state IN ('held', 'waiting')").run();
});

(async () => {
    for (const [name, fn] of asyncTests) {
        await fn();
        n += 1;
        console.log(`ok - ${name}`);
    }
    console.log(`${n} tests passed`);
    store.close();
    fs.rmSync(tmp, { recursive: true, force: true });
})().catch((e) => { console.log(`FAIL - ${e && e.stack}`); process.exit(1); });
