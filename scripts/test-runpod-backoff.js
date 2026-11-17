#!/usr/bin/env node
/**
 * RunPod pod watcher (#890, modules/runpodPodManager.js): a failed status read backs off 1, 2, 4 ...
 * minutes up to 15 (no request and no log line every 30 s while DNS is down); every managed pod
 * stopped: read every 5 minutes; a running pod: every 30 s (its idle auto-shutdown); a viewer's
 * runpod_pods_status reads fresh except while reads are failing.
 *   node scripts/test-runpod-backoff.js
 */
'use strict';

const assert = require('assert');
const { RunpodPodManager } = require('../modules/runpodPodManager');

const logs = [];
const gr = {
    getSecureConfig: () => ({ managedPods: [{ id: 'pod1', name: 'GPU' }] }),
    getLogger: () => ({ runpod: (level, msg) => logs.push(`${level}: ${msg}`) }),
    getWebSocketServer: () => ({ getConnectedUsers: () => [{ authenticated: true }], broadcast() {} }),
    getApiKeyManager: () => ({ getActiveApiKey: () => 'key' })
};
const m = new RunpodPodManager(gr);
let reads = 0;
let mode = 'dns';
m._getRemotePod = async () => {
    reads += 1;
    if (mode === 'dns') throw new Error('getaddrinfo ENOTFOUND rest.runpod.io');
    return { desiredStatus: mode === 'running' ? 'RUNNING' : 'EXITED', costPerHr: 0.5 };
};

(async () => {
    let now = Date.now();
    const tickAt = async (ms) => { now += ms; await m.tick(now); };

    await m.tick(now);
    assert.strictEqual(reads, 1);
    // the next 30 s ticks wait: 1 min after the first failure
    await tickAt(30000);
    assert.strictEqual(reads, 1, 'backing off');
    await tickAt(31000);
    assert.strictEqual(reads, 2, 'tried again after a minute');
    // then 2, 4, 8 minutes ... capped at 15
    const waits = [];
    for (let i = 0; i < 6; i++) {
        const before = reads;
        let waited = 0;
        while (reads === before) { await tickAt(30000); waited += 30000; }
        waits.push(Math.round(waited / 60000));
    }
    assert.deepStrictEqual(waits, [2, 4, 8, 15, 15, 15]);
    const failLogs = logs.filter((l) => /Status pod1/.test(l)).length;
    assert.strictEqual(failLogs, reads, 'one log line per read, not per 30 s');

    // a viewer while failing: the cached snapshot, no read
    const before = reads;
    await m.refreshForViewer(now + 1000);
    assert.strictEqual(reads, before);

    // DNS back, the pod stopped: read every 5 minutes
    mode = 'stopped';
    while (m._failures) await tickAt(30000);
    const r0 = reads;
    await tickAt(30000);
    await tickAt(30000);
    assert.strictEqual(reads, r0, 'all stopped: no 30 s reads');
    for (let i = 0; i < 8; i++) await tickAt(30000);
    assert.strictEqual(reads, r0 + 1, 'one read in 5 minutes');

    // a viewer asks: fresh read; the pod runs now: every 30 s
    mode = 'running';
    await m.refreshForViewer(now);
    assert.strictEqual(reads, r0 + 2);
    await tickAt(30000);
    await tickAt(30000);
    assert.strictEqual(reads, r0 + 4, 'running: every 30 s');
    assert.ok(logs.some((l) => /work again/.test(l)));

    console.log('runpod backoff: ok');
})().catch((e) => { console.error(e); process.exit(1); });
