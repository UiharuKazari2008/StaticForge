#!/usr/bin/env node
/**
 * modules/ws/snapshotStream.js: one sampler for every subscriber, each at its own rate; a subscriber
 * whose page sleeps (asleep(ws), a phone's DeX window with the screen off, #890) is sent nothing, and
 * while every subscriber sleeps nothing is sampled; it gets a fresh snapshot after it wakes.
 *   node scripts/test-snapshot-stream-sleep.js
 */
'use strict';

const assert = require('assert');
const { createSnapshotStream } = require('../modules/ws/snapshotStream');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    let samples = 0;
    const got = new Map();
    const dormant = new Set();
    const feed = createSnapshotStream({
        name: 'test',
        pushType: 'test_push',
        minIntervalMs: 50,
        sample: async () => ({ n: ++samples }),
        sendToClient: (ws, msg) => { got.set(ws, (got.get(ws) || []).concat(msg.data.n)); },
        asleep: (ws) => dormant.has(ws)
    });
    const a = { readyState: 1, once() {} };
    const b = { readyState: 1, once() {} };
    const first = await feed.subscribe(a, { intervalMs: 50 });
    assert.strictEqual(first.n, 1, 'a snapshot at once on subscribe');
    await feed.subscribe(b, { intervalMs: 200 });
    await sleep(260);
    assert.ok((got.get(a) || []).length >= 3, 'the fast subscriber at its rate');
    assert.ok((got.get(b) || []).length >= 1 && got.get(b).length < got.get(a).length, 'the slow one at its own');

    // both asleep: no pushes, no samples
    dormant.add(a); dormant.add(b);
    await sleep(80);
    const s0 = samples;
    const a0 = got.get(a).length;
    const b0 = got.get(b).length;
    await sleep(300);
    assert.strictEqual(samples, s0, 'nothing sampled while every subscriber sleeps');
    assert.strictEqual(got.get(a).length, a0);
    assert.strictEqual(got.get(b).length, b0);

    // one wakes: it gets fresh snapshots again, the other still nothing
    dormant.delete(a);
    await sleep(160);
    assert.ok(got.get(a).length > a0, 'awake again: pushes resume');
    assert.ok(samples > s0);
    assert.strictEqual(got.get(b).length, b0, 'the sleeping one still gets nothing');

    feed.unsubscribe(a);
    feed.unsubscribe(b);
    assert.strictEqual(feed.size, 0);
    console.log('snapshot stream sleep: ok');
    process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
