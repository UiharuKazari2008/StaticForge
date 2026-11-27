#!/usr/bin/env node
'use strict';

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
dq.setNotifier((a, body) => { steers.push({ to: a.id, body }); return 'test'; });
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

console.log(`${n} tests passed`);
store.close();
fs.rmSync(tmp, { recursive: true, force: true });
